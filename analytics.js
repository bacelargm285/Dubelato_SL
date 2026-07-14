/* ============================================================
   Dubelato BI — analytics.js
   Consultoria Financeira: gera o resumo executivo e insights
   em texto a partir dos números (motor de regras local — roda
   100% no navegador, sem enviar dados para fora).
   ============================================================ */
window.DB = window.DB || {};

DB.analytics = (function () {
  const U = DB.utils;

  function insights(model, inv) {
    const out = [];
    const { cur, prev, kpi, proj, byMonth, meses } = model;
    if (!cur) return out;

    const push = (tipo, texto) => out.push({ tipo, texto });

    // Receita e ritmo
    if (prev && cur.vendaMediaDia && prev.vendaMediaDia) {
      const d = U.delta(cur.vendaMediaDia, prev.vendaMediaDia);
      push(d >= 0 ? 'ok' : 'warn',
        `A venda média diária de ${U.ymLabelFull(cur.mes)} está em ${U.brl(cur.vendaMediaDia)}, ` +
        `${d >= 0 ? 'alta' : 'queda'} de ${U.pct(Math.abs(d))} sobre ${U.ymLabel(prev.mes)} (${U.brl(prev.vendaMediaDia)}).`);
    }

    // CMV
    if (cur.cmvPct != null) {
      const alvoTxt = 'referência saudável: 25–35% para gelateria';
      if (prev && prev.cmvPct != null) {
        const dif = cur.cmvPct - prev.cmvPct;
        push(Math.abs(dif) < 2 ? 'info' : dif > 0 ? 'warn' : 'ok',
          `O CMV está em ${U.pct(cur.cmvPct)} da receita (${dif >= 0 ? '+' : ''}${U.pct(dif)} vs mês anterior; ${alvoTxt}).`);
      } else {
        push('info', `O CMV está em ${U.pct(cur.cmvPct)} da receita (${alvoTxt}).`);
      }
    }

    // iFood vs balcão
    const fat = cur.vendasBalcao + cur.vendasIfood;
    if (fat > 0 && cur.vendasIfood > 0) {
      const share = (cur.vendasIfood / fat) * 100;
      const custoPct = cur.vendasIfood ? (cur.custoIfood / cur.vendasIfood) * 100 : 0;
      push(custoPct > 25 ? 'warn' : 'info',
        `O iFood representa ${U.pct(share)} do faturamento. Os custos diretos do canal (motoboy/taxas lançadas) consomem ` +
        `${U.pct(custoPct)} da receita iFood — o balcão segue mais rentável por não ter esses custos.`);
    }

    // Folha
    if (cur.folhaPct != null && cur.folhaPct > 0) {
      push(cur.folhaPct > 30 ? 'warn' : 'info',
        `A folha (salários + freelancers) pesa ${U.pct(cur.folhaPct)} do faturamento de ${U.ymLabel(cur.mes)} (${U.brl(cur.folha)}).`);
    }

    // Marketing ROI aproximado
    if (prev && cur.marketing > 0) {
      const deltaRec = (cur.receita - prev.receita);
      const roi = ((deltaRec - cur.marketing) / cur.marketing) * 100;
      push(roi >= 0 ? 'ok' : 'warn',
        `Marketing: ${U.brl(cur.marketing)} investidos no mês. A variação de receita vs mês anterior foi ${U.brl(deltaRec)} ` +
        `(ROI aproximado de ${U.pct(roi)} — leitura indicativa, o mês pode estar incompleto).`);
    }

    // Capital de giro e reserva
    if (kpi.capitalGiroMeses != null) {
      const f = DB.finance.nivel(kpi.capitalGiroMeses, DB.finance.FAIXAS_MESES);
      push(f.cls === 'ok' || f.cls === 'good' ? 'ok' : 'warn',
        `O capital de giro (caixa − boletos futuros) é de ${U.brl(kpi.capitalGiro)} e cobre ${kpi.capitalGiroMeses.toFixed(1)} ` +
        `mês(es) de custos fixos + folha — nível ${f.label.toLowerCase()}.`);
    }

    // Projeção
    if (proj.primeiroNegativo != null) {
      push('bad', `No ritmo dos últimos 30 dias, o fluxo de caixa ficará negativo em aproximadamente ${proj.primeiroNegativo} dias. ` +
        `Antecipe renegociação de boletos ou reforço de receita.`);
    } else if (proj.netDia < 0) {
      push('warn', `A operação está consumindo em média ${U.brl(Math.abs(proj.netDia))}/dia de caixa. O saldo atual sustenta ~${proj.diasDeCaixa} dias nesse ritmo — sem déficit no horizonte de 90 dias, mas vale acompanhar.`);
    } else {
      push('ok', `A projeção de 90 dias não indica caixa negativo no ritmo atual (${U.brl(proj.netDia)}/dia líquidos).`);
    }

    // Maior crescimento de despesa por categoria
    if (prev) {
      let pior = null;
      for (const [cat, v] of Object.entries(cur.cats)) {
        const antes = prev.cats[cat]?.sai || 0;
        if (v.sai > 300 && antes > 0) {
          const d = v.sai - antes;
          if (!pior || d > pior.d) pior = { cat, d, de: antes, para: v.sai };
        }
      }
      if (pior && pior.d > 200) {
        push('warn', `A categoria de despesa que mais cresceu foi "${pior.cat}": ${U.brl(pior.de)} → ${U.brl(pior.para)} (+${U.brl(pior.d)}).`);
      }
    }

    // Estoque
    if (inv && (inv.zerados.length || inv.baixos.length)) {
      push('warn', `Estoque: ${inv.zerados.length} item(ns) zerado(s) e ${inv.baixos.length} com nível baixo. ` +
        `Priorize reposição de itens de produção para não travar vendas.`);
    }

    return out;
  }

  /** Resumo executivo em parágrafos, como um consultor escreveria */
  function resumoExecutivo(model, inv) {
    const { cur, prev, kpi, proj } = model;
    if (!cur) return 'Sem dados suficientes para gerar o resumo.';
    const p = [];

    p.push(`Em ${U.ymLabelFull(cur.mes)}, a Dubelato faturou ${U.brl(cur.receita)} ` +
      `(${U.brl(cur.vendasBalcao)} no balcão e ${U.brl(cur.vendasIfood)} no iFood), com saídas totais de ${U.brl(cur.saidas)} ` +
      `e resultado de caixa de ${U.brl(cur.saldo)} no mês. O saldo acumulado da operação está em ${U.brl(kpi.saldoAtual)}.`);

    const partes = [];
    if (cur.cmvPct != null) partes.push(`o CMV consome ${U.pct(cur.cmvPct)} da receita`);
    if (cur.folhaPct != null && cur.folha > 0) partes.push(`a folha pesa ${U.pct(cur.folhaPct)}`);
    if (cur.fixos > 0) partes.push(`os custos fixos somam ${U.brl(cur.fixos)}`);
    if (partes.length) p.push(`Na estrutura de custos, ${partes.join(', ')}. ` +
      (kpi.pontoEquilibrio ? `O ponto de equilíbrio estimado é de ${U.brl(kpi.pontoEquilibrio)} por mês — abaixo disso a operação fica no prejuízo.` : ''));

    if (kpi.capitalGiroMeses != null && kpi.reservaMeses != null) {
      p.push(`O capital de giro cobre ${kpi.capitalGiroMeses.toFixed(1)} mês(es) e a reserva equivale a ${kpi.reservaMeses.toFixed(1)} mês(es) ` +
        `de custos fixos + folha (média de ${U.brl(kpi.custoFixoMedio)}/mês). Há ${U.brl(kpi.totalBoletosFuturos)} em boletos a vencer.`);
    }

    p.push(proj.primeiroNegativo != null
      ? `Atenção: mantido o ritmo dos últimos 30 dias, o caixa fica negativo em ~${proj.primeiroNegativo} dias. Recomenda-se revisar prazos de boletos e reforçar vendas de maior margem (balcão).`
      : `Mantido o ritmo atual (${U.brl(proj.netDia)}/dia líquidos), o caixa permanece positivo no horizonte de 90 dias.`);

    return p;
  }

  return { insights, resumoExecutivo, resumoDoMes };

  /**
   * Resumo narrativo do mês ATUAL, lendo receita, ritmo, custos, DRE, projeção
   * de vendas e comparação com o mês anterior e o mesmo mês do ano passado.
   * Retorna array de parágrafos (HTML) para exibir no Dashboard.
   * @param model  modelo financeiro
   * @param ctx    { getnet, previsaoMes, diaDoMes } opcional
   */
  function resumoDoMes(model, ctx) {
    ctx = ctx || {};
    const U = DB.utils;
    const cur = model.cur;
    if (!cur || cur.receita < 100) return ['<p>Ainda não há lançamentos suficientes no mês atual para uma análise.</p>'];

    const prev = model.byMonth[model.mesAnteriorKey];
    // mesmo mês do ano anterior (ex.: 2025-07 para 2026-07)
    const [y, mo] = cur.mes.split('-');
    const anoAntKey = (y - 1) + '-' + mo;
    const anoAnt = model.byMonth[anoAntKey];

    const hoje = new Date();
    const [cy, cm] = cur.mes.split('-').map(Number);
    const ehMesCorrente = (hoje.getFullYear() === cy && hoje.getMonth() + 1 === cm);
    const diaDoMes = ehMesCorrente ? hoje.getDate() : new Date(cy, cm, 0).getDate();
    const diasNoMes = new Date(cy, cm, 0).getDate();
    const fracaoMes = diaDoMes / diasNoMes;
    const nomeMes = new Date(cy, cm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const paras = [];

    // 1. RECEITA E RITMO
    let p1 = `<strong>${nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)}.</strong> `;
    if (ehMesCorrente) {
      const projFim = cur.receita / fracaoMes;
      p1 += `Até o dia ${diaDoMes}, a loja faturou <strong>${U.brl(cur.receita)}</strong> (${(fracaoMes * 100).toFixed(0)}% do mês transcorrido). Mantido o ritmo, o mês deve fechar por volta de <strong>${U.brl(projFim)}</strong>. `;
      if (prev && prev.receita > 0) {
        const ritmoVsPrev = (projFim / prev.receita - 1) * 100;
        p1 += ritmoVsPrev >= 0
          ? `Isso seria ${U.pct(ritmoVsPrev, 0)} acima do mês anterior (${U.brl(prev.receita)}). `
          : `Isso seria ${U.pct(Math.abs(ritmoVsPrev), 0)} abaixo do mês anterior (${U.brl(prev.receita)}). `;
      }
    } else {
      p1 += `A loja faturou <strong>${U.brl(cur.receita)}</strong> no mês. `;
      if (prev && prev.receita > 0) {
        const d = (cur.receita / prev.receita - 1) * 100;
        p1 += d >= 0 ? `Foi ${U.pct(d, 0)} acima do mês anterior. ` : `Foi ${U.pct(Math.abs(d), 0)} abaixo do mês anterior. `;
      }
    }
    if (anoAnt && anoAnt.receita > 0) {
      const yoy = ((ehMesCorrente ? cur.receita / fracaoMes : cur.receita) / anoAnt.receita - 1) * 100;
      p1 += `Na comparação com ${nomeMes.split(' ')[0]} do ano passado (${U.brl(anoAnt.receita)}), o crescimento projetado é de ${U.pct(yoy, 0)}. `;
    }
    paras.push(p1);

    // 2. CUSTOS E MARGEM (DRE resumido)
    let p2 = '';
    const cmvPct = cur.cmvPct, folhaPct = cur.folhaPct;
    const margem = cur.margem;
    p2 += `Do lado dos custos, `;
    const notas = [];
    if (cmvPct != null) {
      const ok = cmvPct <= 35;
      notas.push(`a matéria-prima (CMV) está em ${U.pct(cmvPct)}${ok ? ', dentro do saudável para gelateria (até 35%)' : ', acima do ideal — vale revisar compras e porcionamento'}`);
    }
    if (folhaPct != null) {
      const ok = folhaPct <= 30;
      notas.push(`a folha em ${U.pct(folhaPct)}${ok ? '' : ' (um pouco alta)'}`);
    }
    p2 += notas.join(', ') + '. ';
    if (margem != null) {
      p2 += margem >= 15
        ? `A margem operacional está confortável, em <strong>${U.pct(margem)}</strong>${cur.resultadoOp != null ? ` (resultado de ${U.brl(cur.resultadoOp)})` : ''}. `
        : margem >= 0
          ? `A margem operacional está apertada, em <strong>${U.pct(margem)}</strong>${cur.resultadoOp != null ? ` (resultado de ${U.brl(cur.resultadoOp)})` : ''} — há espaço para melhorar. `
          : `A operação fechou no <strong>vermelho</strong> este mês (resultado de ${U.brl(cur.resultadoOp)}), puxada por custos acima da receita${ehMesCorrente ? ', mas lembre-se que o mês ainda está em curso' : ''}. `;
    }
    // financiamento
    if (cur.financiamento > 0) {
      p2 += `Além da operação, saíram ${U.brl(cur.financiamento)} de financiamento (Tortelli/Celso) — que não é despesa do negócio, mas consome caixa até terminar em novembro. `;
    }
    paras.push(p2);

    // 3. CAIXA E PROJEÇÃO
    let p3 = '';
    const fluxo = ctx.fluxo;
    if (fluxo && fluxo.saldoHoje != null) {
      p3 += `No caixa real, a conta tem <strong>${U.brl(fluxo.saldoHoje)}</strong>. `;
      if (fluxo.primeiroNeg) {
        p3 += `A projeção acende um alerta: o caixa pode ficar apertado por volta de ${U.fmtDate(fluxo.primeiroNeg)}, então vale segurar compras não essenciais e, se precisar, antecipar um recebível naquela semana. `;
      } else {
        p3 += `A projeção dos próximos 90 dias se mantém positiva, com o caixa se recompondo após os pagamentos fixos do início de cada mês. `;
      }
    }
    // reserva
    if (model.kpi.custoFixoMedio > 0 && fluxo && fluxo.saldoHoje != null) {
      const meses = fluxo.saldoHoje / model.kpi.custoFixoMedio;
      if (meses < 1) p3 += `A reserva de caixa ainda é curta (cobre ${meses.toFixed(1).replace('.', ',')} mês de custo fixo) — reforçá-la é a prioridade antes de qualquer retirada. `;
    }
    if (p3) paras.push(p3);

    // 4. VEREDITO
    let p4 = '<strong>Em resumo:</strong> ';
    const sinais = [];
    if (ehMesCorrente && prev) { const proj = cur.receita / fracaoMes; sinais.push(proj >= prev.receita ? 'vendas em ritmo bom' : 'vendas mais fracas que o mês passado'); }
    if (margem != null) sinais.push(margem >= 15 ? 'margem saudável' : margem >= 0 ? 'margem apertada' : 'operação no vermelho');
    if (cmvPct != null && cmvPct > 35) sinais.push('CMV a vigiar');
    if (fluxo && fluxo.primeiroNeg) sinais.push('atenção ao caixa na virada do mês');
    p4 += sinais.length ? sinais.join(', ') + '. ' : 'mês dentro do esperado. ';
    p4 += ehMesCorrente ? 'Acompanhe os próximos dias para confirmar a tendência.' : 'Use estes números como base para planejar o próximo mês.';
    paras.push(p4);

    return paras.map(p => `<p>${p}</p>`);
  }
})();
