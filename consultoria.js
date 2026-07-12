/* ============================================================
   Dubelato BI — consultoria.js
   Motor de recomendações acionáveis: olha os dados reais
   (planilha + Getnet + banco) e responde três perguntas —
   onde melhorar, como não deixar o caixa ficar negativo, e
   quando dá para retirar pró-labore sem prejudicar o negócio.
   ============================================================ */
window.DB = window.DB || {};

DB.consultoria = (function () {
  const U = DB.utils;

  // Referências de gelateria (mesmas do raio-X de saídas)
  const BENCH = {
    cmv: { min: 25, max: 35, nome: 'CMV (matéria-prima)' },
    folha: { min: 20, max: 30, nome: 'Folha' },
    fixos: { min: 10, max: 20, nome: 'Fixos e administrativo' },
    marketing: { min: 2, max: 6, nome: 'Marketing' },
    impostos: { min: 4, max: 10, nome: 'Impostos' },
  };

  /** Gera o plano completo. Recebe o modelo financeiro (M), análise Getnet (GAN),
   *  análise banco (BAN) e a análise de fluxo já calculada (fluxo, opcional). */
  function gerar(M, GAN, BAN, fluxo) {
    // meses FECHADOS (exclui o mês corrente, que está incompleto e distorce médias)
    const mesesFechados = M.meses.filter(k => k !== M.mesAtualKey && M.byMonth[k].receita > 5000);
    return {
      melhorias: ondeMelhorar(M, mesesFechados),
      seguranca: segurancaCaixa(M, BAN, fluxo),
      retirada: capacidadeRetirada(M, BAN, fluxo, mesesFechados),
    };
  }

  /* ---------- 1. ONDE MELHORAR (problemas com custo em R$) ---------- */

  function ondeMelhorar(M, mesesFechados) {
    const itens = [];
    const meses = mesesFechados.length ? mesesFechados : M.meses.filter(k => M.byMonth[k].receita > 1000);
    if (!meses.length) return itens;

    // média dos últimos 3 meses fechados para estabilidade
    const ult = meses.slice(-3);
    const receitaMedia = U.avg(ult.map(k => M.byMonth[k].receita));

    const grupoPct = grupo => {
      const vals = ult.map(k => {
        const m = M.byMonth[k];
        const g = U.sum(m.txs.filter(t => t.tipo === 'Saída' && t.grupo === grupo), t => t.valor);
        return m.receita ? g / m.receita * 100 : 0;
      });
      return U.avg(vals);
    };

    // custos acima da referência → quanto economizaria voltando ao teto
    for (const [id, ref] of Object.entries(BENCH)) {
      const pct = grupoPct(id);
      if (pct > ref.max) {
        const excedente = (pct - ref.max) / 100 * receitaMedia;
        itens.push({
          prioridade: excedente > 3000 ? 'alta' : 'media',
          titulo: `${ref.nome} está em ${U.pct(pct)} — acima do ideal (até ${ref.max}%)`,
          impacto: excedente,
          texto: comoReduzir(id, pct, ref),
        });
      }
    }

    // financiamento pesando no caixa
    const financMedia = U.avg(ult.map(k => U.sum(M.byMonth[k].txs.filter(t => t.grupo === 'financiamento'), t => t.valor)));
    if (financMedia > 1000) {
      itens.push({
        prioridade: 'info',
        titulo: `Financiamentos consomem ${U.brl(financMedia)}/mês do caixa`,
        impacto: financMedia,
        texto: `As parcelas (Tortelli/Celso) não são despesa operacional, mas saem do caixa todo mês. Enquanto durarem, o negócio precisa gerar esse valor a mais só para empatar. Ao terminarem, esse dinheiro vira folga direta de caixa — planeje o que fazer com ele (reserva, retirada ou reinvestimento) desde já.`,
      });
    }

    // CMV sem receita de margem — sabores caros
    // (aponta para a aba de custo das cubas)
    itens.push({
      prioridade: 'media',
      titulo: 'Complete as receitas dos sabores para achar os que dão menos margem',
      impacto: null,
      texto: `Faltam receitas de alguns sabores rotativos e alguns preços do Cheese Cake. Com elas, a aba Custo das Cubas mostra a margem real de cada sabor — dá para priorizar na vitrine os de maior margem e reduzir a produção dos que dão prejuízo. É o caminho mais direto para melhorar o CMV sem cortar qualidade.`,
    });

    return itens.sort((a, b) => (b.impacto || 0) - (a.impacto || 0));
  }

  function comoReduzir(id, pct, ref) {
    const mapa = {
      cmv: `Três frentes: (1) renegocie os 3 maiores fornecedores de matéria-prima — volume dá desconto; (2) revise porcionamento e perdas (a aba Custo das Cubas mostra o custo por sabor); (3) priorize na vitrine os sabores de maior margem. Cada ponto percentual de CMV a menos volta direto para o lucro.`,
      folha: `A folha inclui a parte flexível (freelancers). Use o Planejador da Semana: os dados mostram que sábado e domingo vendem 4–5× a quarta — concentre reforço no fim de semana e enxugue os dias fracos. Evite hora extra em dia de movimento baixo.`,
      fixos: `Revise os contratos recorrentes (a aba Saídas lista os gastos que se repetem): sistema, contabilidade, aluguel, serviços. Renegociação anual costuma render 5–15%. Cancele assinaturas que não usa.`,
      marketing: `Confira o retorno na aba Marketing. Concentre a verba nas campanhas com retorno comprovado e corte as que não trazem cliente. Marketing acima da faixa só se justifica se o faturamento estiver crescendo na mesma proporção.`,
      impostos: `Acima da faixa típica do Simples para o setor. Vale uma conversa com a contabilidade sobre o enquadramento e possíveis créditos — às vezes há classificação fiscal mais vantajosa para gelateria.`,
    };
    return mapa[id] || 'Analise os lançamentos da categoria para entender o que puxou o custo.';
  }

  /* ---------- 2. SEGURANÇA DE CAIXA (evitar o negativo) ---------- */

  function segurancaCaixa(M, BAN, fluxo) {
    const out = { nivel: 'ok', pontos: [] };
    const saldoReal = BAN && BAN.saldoAtual != null ? BAN.saldoAtual : (M.kpi.saldoAtual || 0);
    const custoFixoMes = M.kpi.custoFixoMedio || 0;

    // meses de reserva
    const mesesReserva = custoFixoMes > 0 ? saldoReal / custoFixoMes : null;
    if (mesesReserva != null) {
      if (mesesReserva < 0.5) {
        out.nivel = 'bad';
        out.pontos.push({ tipo: 'bad', texto: `O saldo em conta (${U.brl(saldoReal)}) cobre menos de duas semanas de custo fixo. É a prioridade número um: construir uma reserva de pelo menos 1 mês de custos (${U.brl(custoFixoMes)}) antes de qualquer retirada.` });
      } else if (mesesReserva < 1.5) {
        out.nivel = 'warn';
        out.pontos.push({ tipo: 'warn', texto: `O saldo cobre cerca de ${mesesReserva.toFixed(1)} mês de custo fixo. Confortável seria 1,5 a 3 meses. Segure retiradas até reforçar essa reserva.` });
      } else {
        out.pontos.push({ tipo: 'ok', texto: `Reserva saudável: o saldo cobre ${mesesReserva.toFixed(1)} meses de custo fixo. Boa base para operar sem sustos.` });
      }
    }

    // projeção de fluxo: se vai ficar negativo
    if (fluxo && fluxo.primeiroNeg) {
      out.nivel = 'bad';
      const dif = fluxo.piorSaldo != null ? Math.abs(fluxo.piorSaldo) : null;
      out.pontos.push({
        tipo: 'bad',
        texto: `A projeção indica caixa negativo por volta de ${U.fmtDate(fluxo.primeiroNeg)}${dif ? ' (faltariam cerca de ' + U.brl(dif) + ')' : ''}. Para evitar: (1) antecipe recebíveis daquela semana; (2) negocie com fornecedor para empurrar um boleto grande para depois da data crítica; (3) segure retiradas e compras não essenciais até passar o aperto. A primeira quinzena concentra os custos fixos, então o reforço precisa estar pronto antes do dia 10.` });
    } else if (fluxo) {
      out.pontos.push({ tipo: 'ok', texto: `A projeção de 90 dias se mantém positiva. O caixa aguenta os compromissos já conhecidos, mas continue acompanhando a cada extrato novo.` });
    }

    // concentração de custo na 1ª quinzena
    if (M.recorrentes && M.recorrentes.length) {
      const q1 = U.sum(M.recorrentes.filter(r => r.grupo !== 'cmv' && r.diaMes <= 10), r => r.valorMedio);
      const total = U.sum(M.recorrentes.filter(r => r.grupo !== 'cmv'), r => r.valorMedio);
      if (total > 0 && q1 / total > 0.45) {
        out.pontos.push({ tipo: 'info', texto: `${U.pct(q1 / total * 100, 0)} das saídas fixas caem até o dia 10 (salário, aluguel, royalty). Entre todo mês com caixa reforçado para a primeira quinzena — é quando o risco de aperto é maior.` });
      }
    }

    return out;
  }

  /* ---------- 3. CAPACIDADE DE RETIRADA (pró-labore) ---------- */

  function capacidadeRetirada(M, BAN, fluxo, mesesFechados) {
    const out = { podeRetirar: false, valorSugerido: 0, texto: '', mesesBons: [], detalhe: [] };
    const saldoReal = BAN && BAN.saldoAtual != null ? BAN.saldoAtual : (M.kpi.saldoAtual || 0);
    const custoFixoMes = M.kpi.custoFixoMedio || 0;
    const reservaMinima = custoFixoMes * 1.5; // 1,5 mês de custo como colchão

    // resultado operacional médio dos últimos 3 meses FECHADOS
    const meses = (mesesFechados && mesesFechados.length ? mesesFechados : M.meses.filter(k => M.byMonth[k].receita > 1000)).slice(-3);
    const resultadoMedio = meses.length ? U.avg(meses.map(k => M.byMonth[k].resultadoOp || 0)) : 0;

    // sobra acima da reserva
    const sobra = saldoReal - reservaMinima;

    if (sobra <= 0) {
      out.texto = `Neste momento, não é recomendável retirada. O saldo (${U.brl(saldoReal)}) está abaixo da reserva de segurança sugerida (${U.brl(reservaMinima)} = 1,5 mês de custo fixo). Primeiro reforce o caixa; retirada agora aumentaria o risco de aperto.`;
      out.detalhe.push({ tipo: 'warn', texto: `Foque em construir a reserva antes de distribuir lucro. Assim que o saldo passar de ${U.brl(reservaMinima)}, a sobra acima disso fica disponível para retirada.` });
      return out;
    }

    // pode retirar: sugere o menor entre (sobra acima da reserva) e (resultado operacional médio)
    // — nunca retirar mais do que o negócio gera de resultado
    const tetoPorResultado = Math.max(0, resultadoMedio);
    const sugestao = Math.min(sobra, tetoPorResultado > 0 ? tetoPorResultado : sobra);
    out.podeRetirar = sugestao > 300;
    out.valorSugerido = Math.max(0, Math.floor(sugestao / 100) * 100);

    if (out.podeRetirar) {
      out.texto = `Há espaço para retirada. O saldo (${U.brl(saldoReal)}) supera a reserva de segurança (${U.brl(reservaMinima)}) em ${U.brl(sobra)}. Considerando também o resultado operacional médio de ${U.brl(resultadoMedio)}/mês, uma retirada de até ${U.brl(out.valorSugerido)} manteria a reserva intacta.`;
      out.detalhe.push({ tipo: 'ok', texto: `Retire preservando sempre a reserva de ${U.brl(reservaMinima)}. Se possível, faça a retirada depois do dia 10 (quando o grosso dos custos fixos já saiu) e não em mês de baixa temporada.` });
    } else {
      out.texto = `O saldo cobre a reserva, mas a sobra (${U.brl(sobra)}) ainda é pequena para uma retirada segura. Aguarde mais um ou dois meses de resultado positivo para distribuir com folga.`;
    }

    // meses historicamente bons para retirada (resultado operacional alto)
    const porMesResultado = (mesesFechados && mesesFechados.length ? mesesFechados : M.meses)
      .filter(k => M.byMonth[k].receita > 1000)
      .map(k => ({ mes: k, resultado: M.byMonth[k].resultadoOp || 0 }))
      .filter(x => x.resultado > 0)
      .sort((a, b) => b.resultado - a.resultado)
      .slice(0, 4);
    out.mesesBons = porMesResultado;

    return out;
  }

  return { gerar, BENCH };
})();
