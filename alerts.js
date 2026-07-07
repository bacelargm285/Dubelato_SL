/* ============================================================
   Dubelato BI — alerts.js
   Motor de alertas: cada regra devolve null (ok) ou um alerta
   { level: 'bad'|'warn'|'info'|'ok', icon, title, text }.
   ============================================================ */
window.DB = window.DB || {};

DB.alerts = (function () {
  const U = DB.utils;

  function run(model, inv) {
    const A = [];
    const { kpi, cur, prev, proj, boletosFuturos } = model;
    const hoje = model.cfg.hoje || new Date();

    // Fluxo projetado negativo
    if (proj.primeiroNegativo != null) {
      A.push({ level: 'bad', icon: 'bi-graph-down-arrow', title: 'Caixa pode ficar negativo',
        text: `No ritmo atual (média líquida de ${U.brl(proj.netDia)}/dia), o caixa fica negativo em aproximadamente ${proj.primeiroNegativo} dias.` });
    } else if (proj.netDia < 0) {
      A.push({ level: 'warn', icon: 'bi-droplet-half', title: 'Operação consumindo caixa',
        text: `Média líquida de ${U.brl(proj.netDia)}/dia nos últimos 30 dias. O saldo atual sustenta ~${proj.diasDeCaixa} dias nesse ritmo (sem déficit nos próximos 90 dias).` });
    } else if (proj.netDia > 0) {
      A.push({ level: 'ok', icon: 'bi-graph-up-arrow', title: 'Fluxo de caixa positivo',
        text: `Média líquida de ${U.brl(proj.netDia)}/dia nos últimos 30 dias. Sem déficit projetado em 90 dias.` });
    }

    // Boletos vencendo em 7 dias
    const seteDias = new Date(hoje); seteDias.setDate(seteDias.getDate() + 7);
    const prox = boletosFuturos.filter(b => b.venc <= seteDias);
    if (prox.length) {
      A.push({ level: 'warn', icon: 'bi-calendar-x', title: `${prox.length} boleto(s) vencem em 7 dias`,
        text: `Total de ${U.brl(U.sum(prox, b => b.valor))}: ` + prox.slice(0, 4).map(b => `${b.desc} (${U.fmtDate(b.venc)})`).join(', ') + (prox.length > 4 ? '…' : '.') });
    }

    // Capital de giro
    if (kpi.capitalGiroMeses != null) {
      if (kpi.capitalGiroMeses < 1) A.push({ level: 'bad', icon: 'bi-wallet2', title: 'Capital de giro crítico',
        text: `Caixa menos boletos futuros cobre ${kpi.capitalGiroMeses.toFixed(1)} mês(es) de custos fixos + folha.` });
      else if (kpi.capitalGiroMeses < 3) A.push({ level: 'warn', icon: 'bi-wallet2', title: 'Capital de giro em atenção',
        text: `Cobertura de ${kpi.capitalGiroMeses.toFixed(1)} meses. O ideal é manter acima de 3 meses.` });
    }

    // Reserva de emergência
    if (kpi.reservaMeses != null && kpi.reservaMeses < 2) {
      A.push({ level: kpi.reservaMeses < 1 ? 'bad' : 'warn', icon: 'bi-shield-exclamation', title: 'Reserva de emergência baixa',
        text: `O saldo atual cobre ${kpi.reservaMeses.toFixed(1)} mês(es) de custos fixos + folha (${U.brl(kpi.custoFixoMedio)}/mês em média).` });
    }

    if (cur && prev) {
      // CMV elevado / subindo
      if (cur.cmvPct != null && prev.cmvPct != null && cur.cmvPct - prev.cmvPct > 3) {
        A.push({ level: 'warn', icon: 'bi-basket', title: 'CMV subiu',
          text: `CMV passou de ${U.pct(prev.cmvPct)} para ${U.pct(cur.cmvPct)} da receita (${U.ymLabel(prev.mes)} → ${U.ymLabel(cur.mes)}).` });
      }
      if (cur.cmvPct != null && cur.cmvPct > 40) {
        A.push({ level: 'bad', icon: 'bi-basket', title: 'CMV acima de 40%',
          text: `CMV de ${U.pct(cur.cmvPct)} em ${U.ymLabel(cur.mes)}. Para gelaterias, a referência saudável fica entre 25% e 35%.` });
      }
      // Receita caindo (compara ritmo diário para não punir mês incompleto)
      if (cur.vendaMediaDia && prev.vendaMediaDia && cur.vendaMediaDia < prev.vendaMediaDia * 0.85) {
        A.push({ level: 'warn', icon: 'bi-cart-dash', title: 'Queda nas vendas',
          text: `Venda média diária caiu ${U.pct(100 - (cur.vendaMediaDia / prev.vendaMediaDia) * 100)}: ${U.brl(prev.vendaMediaDia)} → ${U.brl(cur.vendaMediaDia)}.` });
      }
      // Despesas crescendo mais que receita
      const dRec = U.delta(cur.receita, prev.receita), dDesp = U.delta(cur.saidasOp, prev.saidasOp);
      if (dRec != null && dDesp != null && dDesp > dRec + 10) {
        A.push({ level: 'warn', icon: 'bi-arrows-expand', title: 'Despesas crescendo mais que a receita',
          text: `Despesas ${dDesp >= 0 ? 'subiram' : 'caíram'} ${U.pct(Math.abs(dDesp))} enquanto a receita variou ${U.pct(dRec)}.` });
      }
      // Margem caindo
      if (cur.margem != null && prev.margem != null && prev.margem - cur.margem > 5) {
        A.push({ level: 'warn', icon: 'bi-percent', title: 'Margem em queda',
          text: `Margem operacional caiu de ${U.pct(prev.margem)} para ${U.pct(cur.margem)}.` });
      }
    }

    // Estoque
    if (inv) {
      if (inv.zerados.length) A.push({ level: 'bad', icon: 'bi-box-seam', title: `${inv.zerados.length} item(ns) zerado(s) no estoque`,
        text: inv.zerados.slice(0, 6).map(i => i.item).join(', ') + (inv.zerados.length > 6 ? '…' : '.') });
      if (inv.baixos.length) A.push({ level: 'warn', icon: 'bi-box', title: `${inv.baixos.length} item(ns) com estoque baixo (≤ ${inv.LIMITE_BAIXO})`,
        text: inv.baixos.slice(0, 6).map(i => `${i.item} (${i.qt})`).join(', ') + (inv.baixos.length > 6 ? '…' : '.') });
    }

    if (!A.length) A.push({ level: 'ok', icon: 'bi-check-circle', title: 'Tudo em ordem', text: 'Nenhum alerta com os dados atuais.' });
    return A;
  }

  return { run };
})();
