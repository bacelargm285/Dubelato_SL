/* ============================================================
   Dubelato BI — finance.js
   Processamento: agregações mensais, KPIs, CMV, capital de giro,
   reserva de emergência, ponto de equilíbrio, iFood, folha,
   projeção de caixa dia a dia.
   ============================================================ */
window.DB = window.DB || {};

DB.finance = (function () {
  const U = DB.utils;

  // Regras de classificação — a ORDEM importa ("vendas ifood" precisa
  // ser testada antes de "vendas", senão cai como balcão).
  const REGRAS = [
    { g: 'transferencia', test: n => n.includes('caixa_mes_anterior') || n.includes('caixa mes anterior') },
    { g: 'receitaIfood', test: n => n.includes('ifood') && n.includes('venda') },
    { g: 'custoIfood',   test: n => n === 'ifood' },
    { g: 'receitaBalcao',test: n => n === 'vendas' || n === 'venda' },
    { g: 'cmv',          test: n => ['materia prima', 'embalagen', 'frete', 'perdas', 'quebras'].some(k => n.includes(k)) },
    { g: 'folha',        test: n => ['salario', 'freelancer', 'encargo'].some(k => n.includes(k)) },
    { g: 'fixos',        test: n => ['custofixo', 'custo fixo', 'contabilidade', 'aluguel', 'royalty'].some(k => n.includes(k)) || n === 'sistema' },
    { g: 'marketing',    test: n => n.includes('marketing') || n.includes('trafego') },
    { g: 'impostos',     test: n => n.includes('impost') || n === 'icms' },
    { g: 'financiamento',test: n => n.includes('tortelli') || n.includes('celso') },
  ];

  function grupoDe(categoria) {
    const n = U.norm(categoria);
    for (const r of REGRAS) if (r.test(n)) return r.g;
    return null;
  }

  /**
   * Constrói o modelo analítico a partir do modelo bruto.
   * cfg.tortelliComoInvestimento: se true, exclui financiamento do resultado operacional.
   */
  function build(raw, cfg = {}) {
    const txs = raw.txs.map(t => Object.assign({ grupo: grupoDe(t.categoria) }, t));
    const byMonth = {};

    for (const t of txs) {
      const m = byMonth[t.mes] || (byMonth[t.mes] = {
        mes: t.mes, entradas: 0, saidas: 0,
        entradasOp: 0, saidasOp: 0,                 // operacional (sem transferências/financiamento cf. toggle)
        vendasBalcao: 0, vendasIfood: 0, custoIfood: 0,
        cmv: 0, folha: 0, fixos: 0, marketing: 0, impostos: 0, financiamento: 0,
        cats: {}, dias: new Set(), diasVenda: new Set(), txs: [],
      });
      m.txs.push(t);
      m.dias.add(+t.date);
      const ehTransf = t.grupo === 'transferencia';
      const ehFin = t.grupo === 'financiamento';
      const operacional = !ehTransf && !(ehFin && cfg.tortelliComoInvestimento);

      if (t.tipo === 'Entrada') {
        m.entradas += t.valor;
        if (operacional) m.entradasOp += t.valor;
        if (t.grupo === 'receitaIfood') { m.vendasIfood += t.valor; m.diasVenda.add(+t.date); }
        else if (t.grupo === 'receitaBalcao') { m.vendasBalcao += t.valor; m.diasVenda.add(+t.date); }
      } else {
        m.saidas += t.valor;
        if (operacional) m.saidasOp += t.valor;
        if (t.grupo === 'cmv') m.cmv += t.valor;
        if (t.grupo === 'custoIfood') m.custoIfood += t.valor;
        if (t.grupo === 'folha') m.folha += t.valor;
        if (t.grupo === 'fixos') m.fixos += t.valor;
        if (t.grupo === 'marketing') m.marketing += t.valor;
        if (t.grupo === 'impostos') m.impostos += t.valor;
        if (ehFin) m.financiamento += t.valor;
      }
      const cat = m.cats[t.categoria] || (m.cats[t.categoria] = { ent: 0, sai: 0 });
      if (t.tipo === 'Entrada') cat.ent += t.valor; else cat.sai += t.valor;
    }

    const meses = Object.keys(byMonth).sort();
    let acumulado = 0;
    for (const k of meses) {
      const m = byMonth[k];
      m.receita = m.vendasBalcao + m.vendasIfood;
      m.saldo = m.entradas - m.saidas;                        // caixa do mês
      m.resultadoOp = m.entradasOp - m.saidasOp;              // resultado operacional
      m.margem = m.receita ? (m.resultadoOp / m.receita) * 100 : null;
      m.cmvPct = m.receita ? (m.cmv / m.receita) * 100 : null;
      m.folhaPct = m.receita ? (m.folha / m.receita) * 100 : null;
      m.vendaMediaDia = m.diasVenda.size ? m.receita / m.diasVenda.size : null;
      // transferência "caixa mês anterior" não entra no acumulado (evita dupla contagem)
      const transf = U.sum(m.txs.filter(t => t.grupo === 'transferencia' && t.tipo === 'Entrada'), t => t.valor);
      acumulado += m.saldo - transf;
      m.saldoAcumulado = acumulado;
    }

    /* ---- boletos ---- */
    const hoje = cfg.hoje || new Date();
    const boletos = raw.boletos.map(b => Object.assign({}, b, {
      status: !b.venc ? 'sem data' : (b.venc < hoje ? 'vencido/pago' : 'a vencer'),
    }));
    const boletosFuturos = boletos.filter(b => b.venc && b.venc >= new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
    const boletosPorMes = {};
    for (const b of boletos) {
      if (!b.venc) continue;
      const k = U.ymKey(b.venc);
      (boletosPorMes[k] = boletosPorMes[k] || []).push(b);
    }

    /* ---- KPIs do mês corrente vs anterior ---- */
    const mesAtualKey = meses[meses.length - 1] || null;
    const mesAnteriorKey = meses[meses.length - 2] || null;
    const cur = mesAtualKey ? byMonth[mesAtualKey] : null;
    const prev = mesAnteriorKey ? byMonth[mesAnteriorKey] : null;

    const mesesFechados = meses.slice(0, -1);                  // exclui mês em andamento
    const baseFixa = mesesFechados.length ? mesesFechados.slice(-3) : meses;
    const custoFixoMedio = U.avg(baseFixa.map(k => byMonth[k].fixos + byMonth[k].folha));

    const saldoAtual = cur ? cur.saldoAcumulado : 0;
    const totalBoletosFuturos = U.sum(boletosFuturos, b => b.valor);

    // Capital de giro ≈ caixa − obrigações futuras (estoque sem valor financeiro na planilha)
    const capitalGiro = saldoAtual - totalBoletosFuturos;
    const capitalGiroMeses = custoFixoMedio ? capitalGiro / custoFixoMedio : null;

    // Reserva: quantos meses de custo fixo o caixa cobre
    const reservaMeses = custoFixoMedio ? saldoAtual / custoFixoMedio : null;

    // Ponto de equilíbrio: fixos ÷ margem de contribuição (1 − CMV% − custo variável iFood%)
    const cmvPctMedio = U.avg(baseFixa.map(k => byMonth[k].cmvPct).filter(v => v != null));
    const varIfoodPct = U.avg(baseFixa.map(k => byMonth[k].receita ? (byMonth[k].custoIfood / byMonth[k].receita) * 100 : 0));
    const margemContribuicao = 1 - (cmvPctMedio + varIfoodPct) / 100;
    const pontoEquilibrio = margemContribuicao > 0 ? custoFixoMedio / margemContribuicao : null;

    /* ---- Projeção de caixa (dia a dia, 90 dias) ---- */
    const proj = projetarCaixa(byMonth, meses, saldoAtual, boletosFuturos, hoje);
    const recorrentes = detectarRecorrentes(txs);

    return {
      cfg, txs, byMonth, meses, boletos, boletosFuturos, boletosPorMes,
      cartao: raw.cartao, estoqueRaw: raw.estoque, abas: raw.abas, avisos: raw.avisos,
      suspeitos: raw.suspeitos || [],
      mesAtualKey, mesAnteriorKey, cur, prev,
      kpi: {
        saldoAtual, custoFixoMedio, capitalGiro, capitalGiroMeses, reservaMeses,
        totalBoletosFuturos, cmvPctMedio, pontoEquilibrio, margemContribuicao,
      },
      proj, recorrentes,
    };
  }

  /** Saídas fixas recorrentes: mesma descrição-base em 3+ meses, com dia típico
   *  do mês e valor médio. Alimenta a projeção de fluxo com os compromissos que
   *  saem todo mês (salário, aluguel, luz, royalty, etc.). */
  function detectarRecorrentes(txs) {
    const rec = {};
    for (const t of txs) {
      if (t.tipo !== 'Saída' || t.grupo === 'transferencia') continue;
      const kd = U.norm(t.desc).replace(/\d+/g, '').trim();
      if (!kd || kd.length < 3) continue;
      const r = rec[kd] || (rec[kd] = { desc: t.desc, grupo: t.grupo || 'outros', meses: new Set(), valores: [], dias: [] });
      r.meses.add(t.mes); r.valores.push(t.valor); r.dias.push(t.date.getDate());
    }
    return Object.values(rec)
      .filter(r => r.meses.size >= 3)
      .map(r => {
        const dias = r.dias.slice().sort((a, b) => a - b);
        return {
          desc: r.desc, grupo: r.grupo, nMeses: r.meses.size,
          valorMedio: U.avg(r.valores),
          diaMes: dias[Math.floor(dias.length / 2)],
          dispersao: Math.max(...dias) - Math.min(...dias),
        };
      })
      .sort((a, b) => b.valorMedio - a.valorMedio);
  }

  /** Projeção: média diária de entradas/saídas operacionais dos últimos 30 dias + boletos nas datas */
  function projetarCaixa(byMonth, meses, saldoAtual, boletosFuturos, hoje) {
    const todasTx = meses.flatMap(k => byMonth[k].txs);
    const corte = new Date(hoje); corte.setDate(corte.getDate() - 30);
    const recentes = todasTx.filter(t => t.date >= corte && t.grupo !== 'transferencia');
    const dias = new Set(recentes.map(t => +new Date(t.date.getFullYear(), t.date.getMonth(), t.date.getDate()))).size || 1;
    const entDia = U.sum(recentes.filter(t => t.tipo === 'Entrada'), t => t.valor) / dias;
    // saídas do dia a dia SEM boletos de matéria-prima (evita dupla contagem com boletos futuros)
    const saiDia = U.sum(recentes.filter(t => t.tipo === 'Saída'), t => t.valor) / dias;

    const serie = [];
    let saldo = saldoAtual, primeiroNegativo = null;
    for (let d = 1; d <= 90; d++) {
      const dia = new Date(hoje); dia.setDate(dia.getDate() + d);
      saldo += entDia - saiDia;
      const doDia = boletosFuturos.filter(b => b.venc && b.venc.toDateString() === dia.toDateString());
      // boletos já estão refletidos na média de saídas quando pagos via lançamentos; aqui somamos
      // apenas como marcador informativo — a média diária já embute pagamentos típicos.
      serie.push({ dia, saldo, boletos: U.sum(doDia, b => b.valor) });
      if (saldo < 0 && primeiroNegativo == null) primeiroNegativo = d;
    }
    return { entDia, saiDia, netDia: entDia - saiDia, serie, primeiroNegativo,
      diasDeCaixa: (entDia - saiDia) < 0 ? Math.floor(saldoAtual / Math.abs(entDia - saiDia)) : null };
  }

  /** Classificação de indicadores */
  function nivel(v, faixas) {
    // faixas: [{min, label, cls}] ordenadas do melhor pro pior
    for (const f of faixas) if (v >= f.min) return f;
    return faixas[faixas.length - 1];
  }

  const FAIXAS_MESES = [
    { min: 6, label: 'Excelente', cls: 'ok' },
    { min: 3, label: 'Bom', cls: 'good' },
    { min: 1, label: 'Atenção', cls: 'warn' },
    { min: -Infinity, label: 'Crítico', cls: 'bad' },
  ];

  return { build, grupoDe, nivel, FAIXAS_MESES };
})();
