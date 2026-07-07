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

  return { insights, resumoExecutivo };
})();
