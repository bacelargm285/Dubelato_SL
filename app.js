/* ============================================================
   Dubelato BI — app.js
   Interface: roteamento, upload da planilha, filtros globais,
   tema claro/escuro e renderização de cada view.
   ============================================================ */
(function () {
  const U = DB.utils;
  let RAW = null;        // modelo bruto (excel)
  let M = null;          // modelo analítico (finance)
  let INV = null;        // estoque
  let CUBAS = null;      // custos de produção
  let GETNET = null;     // dados da maquininha (localStorage)
  let PROD = null;       // produção de cubas
  let RECEITAS = null;   // índice de receitas (Sabores_Receitas)
  let RAN = null;        // análise de produção possível
  let GAN = null;        // análise getnet
  let BANCO = null;      // extrato bancário (localStorage)
  let BAN = null;        // análise do banco
  let FLUXO_RESUMO = null; // resumo da projeção de fluxo (para a Consultoria)
  let ALERTAS = [];
  let mesFiltro = 'atual';   // 'atual' | '2026-03' | 'todos'
  let tortelliInvest = localStorage.getItem('db_tortelli') === '1';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* ================= BOOT ================= */

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNav();
    initUpload();
    $('#toggle-tortelli').checked = tortelliInvest;
    $('#toggle-tortelli').addEventListener('change', e => {
      tortelliInvest = e.target.checked;
      localStorage.setItem('db_tortelli', tortelliInvest ? '1' : '0');
      if (RAW) rebuild();
    });
    tentarCarregarAutomatico();
  });

  /** Tenta buscar Controle_Financeiro_Dubelato.xlsx (GitHub Pages) */
  async function tentarCarregarAutomatico() {
    try {
      const res = await fetch('Controle_Financeiro_Dubelato.xlsx', { cache: 'no-store' });
      if (!res.ok) throw 0;
      const buf = await res.arrayBuffer();
      carregar(buf, 'Controle_Financeiro_Dubelato.xlsx');
    } catch {
      mostrarSplash(true); // aguarda upload manual
    }
  }

  function initUpload() {
    const input = $('#file-input');
    const zonas = ['#drop-zone', '#btn-upload-side'];
    input.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) lerArquivo(f);
    });
    $('#drop-zone').addEventListener('click', () => input.click());
    $('#btn-upload-side').addEventListener('click', () => input.click());
    ['dragover', 'dragleave', 'drop'].forEach(ev => {
      $('#drop-zone').addEventListener(ev, e => {
        e.preventDefault();
        $('#drop-zone').classList.toggle('drag', ev === 'dragover');
        if (ev === 'drop' && e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]);
      });
    });
  }

  function lerArquivo(file) {
    const r = new FileReader();
    r.onload = e => carregar(e.target.result, file.name);
    r.readAsArrayBuffer(file);
  }

  // hook para testes automatizados (sem efeito no uso normal)
  window.__dbTest = { carregar: (b, n) => carregar(b, n), irPara: v => { viewAtual = v; render(); }, getModelo: () => M, relatorio: () => gerarRelatorio() };
  window.__dbIrAlertas = () => { viewAtual = 'alertas'; render(); };

  function carregar(buf, nome) {
    try {
      RAW = DB.excel.fromArrayBuffer(buf);
      $('#file-name').textContent = nome;
      rebuild();
      mostrarSplash(false);
    } catch (err) {
      console.error(err);
      alert('Não foi possível ler a planilha. Verifique se o arquivo é um .xlsx válido.');
    }
  }

  function rebuild() {
    M = DB.finance.build(RAW, { tortelliComoInvestimento: tortelliInvest, hoje: new Date() });
    INV = RAW.estoque.length ? DB.inventory.build(RAW.estoque) : null;
    CUBAS = DB.cubas.build(RAW.cubas);
    PROD = RAW.producao && RAW.producao.length ? DB.producao.build(RAW.producao, CUBAS) : null;
    RECEITAS = RAW.receitas && RAW.receitas.length ? DB.receitas.build(RAW.receitas) : null;
    RAN = RECEITAS ? DB.receitas.analisar(RECEITAS, RAW.estoque, PROD) : null;
    GETNET = DB.getnet.carregar();
    GAN = GETNET ? DB.getnet.analisar(GETNET, M) : null;
    BANCO = DB.banco.carregar();
    BAN = BANCO ? DB.banco.analisar(BANCO, GETNET, M) : null;
    // busca a versão publicada no repositório (visível para todos os sócios)
    // abas que dependem de banco/getnet e devem se redesenhar quando os dados publicados chegam
    const VIEWS_DADOS = ['getnet', 'banco', 'antecipacao', 'fluxo', 'dashboard'];
    DB.getnet.carregarPublicado().then(pub => {
      if (!pub) return;
      const localMaisNovo = GETNET?.atualizadoEm && pub.atualizadoEm && GETNET.atualizadoEm > pub.atualizadoEm;
      GETNET = localMaisNovo ? DB.getnet.mesclar(pub, GETNET) : (GETNET ? DB.getnet.mesclar(GETNET, pub) : pub);
      GAN = DB.getnet.analisar(GETNET, M);
      BAN = BANCO ? DB.banco.analisar(BANCO, GETNET, M) : BAN;
      if (VIEWS_DADOS.includes(viewAtual)) render();
    });
    DB.banco.carregarPublicado().then(pub => {
      if (!pub) return;
      const localMaisNovo = BANCO?.atualizadoEm && pub.atualizadoEm && BANCO.atualizadoEm > pub.atualizadoEm;
      BANCO = localMaisNovo ? DB.banco.mesclar(pub, BANCO.txs) : (BANCO ? DB.banco.mesclar(BANCO, pub.txs) : pub);
      BAN = DB.banco.analisar(BANCO, GETNET, M);
      if (VIEWS_DADOS.includes(viewAtual)) render();
    });
    ALERTAS = DB.alerts.run(M, INV);
    montarFiltroMes();
    atualizarBadgeAlertas();
    render();
  }

  function mostrarSplash(v) {
    $('#splash').classList.toggle('hidden', !v);
    $('#app').classList.toggle('hidden', v);
  }

  /* ================= NAVEGAÇÃO ================= */

  const VIEWS = ['dashboard', 'fluxo', 'entradas', 'saidas', 'boletos', 'estoque', 'ifood', 'funcionarios', 'marketing', 'comparativos', 'consultoria', 'alertas', 'config'];
  let viewAtual = 'dashboard';

  function initNav() {
    $$('.nav-item').forEach(b => b.addEventListener('click', () => {
      viewAtual = b.dataset.view;
      $$('.nav-item').forEach(x => x.classList.toggle('active', x === b));
      $('#sidebar').classList.remove('open');
      render();
    }));
    $('#btn-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#backdrop').addEventListener('click', () => $('#sidebar').classList.remove('open'));
    $('#btn-print').addEventListener('click', () => window.print());
    $('#btn-report').addEventListener('click', gerarRelatorio);
  }

  function initTheme() {
    const saved = localStorage.getItem('db_theme') || 'light';
    document.documentElement.dataset.theme = saved;
    $('#btn-theme').addEventListener('click', () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t;
      localStorage.setItem('db_theme', t);
      render(); // re-renderiza gráficos com o novo tema
    });
  }

  function montarFiltroMes() {
    const sel = $('#filtro-mes');
    const opts = ['<option value="atual">Mês atual</option>', '<option value="todos">Todos os meses</option>']
      .concat(M.meses.slice().reverse().map(k => `<option value="${k}">${U.ymLabelFull(k)}</option>`));
    sel.innerHTML = opts.join('');
    sel.value = mesFiltro === 'atual' || mesFiltro === 'todos' || M.byMonth[mesFiltro] ? mesFiltro : 'atual';
    sel.onchange = () => { mesFiltro = sel.value; render(); };
  }

  function mesSelecionado() {
    if (mesFiltro === 'todos') return null;
    if (mesFiltro === 'atual') return M.mesAtualKey;
    return mesFiltro;
  }

  function dadosMes() {
    const k = mesSelecionado();
    return k ? M.byMonth[k] : null;
  }

  function mesAnteriorDe(k) {
    const i = M.meses.indexOf(k);
    return i > 0 ? M.byMonth[M.meses[i - 1]] : null;
  }

  function atualizarBadgeAlertas() {
    const n = ALERTAS.filter(a => a.level === 'bad' || a.level === 'warn').length;
    const b = $('#badge-alertas');
    b.textContent = n;
    b.classList.toggle('hidden', n === 0);
  }

  /* ================= RENDER ================= */

  function render() {
    if (!M) return;
    const main = $('#main-content');
    main.innerHTML = '<div class="skeleton-wrap">' + '<div class="skeleton"></div>'.repeat(4) + '</div>';
    requestAnimationFrame(() => {
      const fn = {
        dashboard: viewDashboard, dre: viewDRE, fluxo: viewFluxo, entradas: () => viewLancamentos('Entrada'),
        saidas: viewSaidas, boletos: viewBoletos, estoque: viewEstoque,
        ifood: viewIfood, funcionarios: viewFuncionarios, marketing: viewMarketing, cubas: viewCubas, getnet: viewGetnet, banco: viewBanco, antecipacao: viewAntecipacao, producao: viewProducao, producaoPossivel: viewProducaoPossivel, nutricional: viewNutricional,
        comparativos: viewComparativos, clima: viewClima, consultoria: viewConsultoria, alertas: viewAlertas, config: viewConfig,
      }[viewAtual] || viewDashboard;
      main.innerHTML = '';
      fn(main);
      main.querySelectorAll('.card, .kpi').forEach((el, i) => {
        el.style.animationDelay = Math.min(i * 40, 400) + 'ms';
        el.classList.add('enter');
      });
    });
  }

  /* ---------- componentes ---------- */

  function kpiCard({ icon, label, valor, deltaPct, invert, sub, cls }) {
    let arrow = '', dcls = '';
    if (deltaPct != null && isFinite(deltaPct)) {
      const up = deltaPct >= 0;
      const bom = invert ? !up : up;
      arrow = `<span class="kpi-delta ${bom ? 'pos' : 'neg'}"><i class="bi bi-arrow-${up ? 'up' : 'down'}-right"></i> ${U.pct(Math.abs(deltaPct))}</span>`;
    }
    return `<div class="kpi ${cls || ''}">
      <div class="kpi-top"><span class="kpi-icon"><i class="bi ${icon}"></i></span>${arrow}</div>
      <div class="kpi-valor">${valor}</div>
      <div class="kpi-label">${label}${sub ? `<span class="kpi-sub">${sub}</span>` : ''}</div>
    </div>`;
  }

  function card(title, bodyHtml, opts = {}) {
    return `<section class="card ${opts.cls || ''}">
      ${title ? `<header class="card-head"><h2>${title}</h2>${opts.right || ''}</header>` : ''}
      <div class="card-body">${bodyHtml}</div>
    </section>`;
  }

  function nivelBadge(meses) {
    if (meses == null) return '<span class="badge">—</span>';
    const f = DB.finance.nivel(meses, DB.finance.FAIXAS_MESES);
    return `<span class="badge ${f.cls}">${f.label}</span>`;
  }

  function tabelaTx(txs, limite) {
    const rows = (limite ? txs.slice(0, limite) : txs).map(t => `
      <tr>
        <td class="mono">${U.fmtDate(t.date)}</td>
        <td>${U.esc(t.desc)}</td>
        <td><span class="chip">${U.esc(t.categoria)}</span></td>
        <td class="mono ${t.tipo === 'Entrada' ? 'pos' : 'neg'}">${t.tipo === 'Entrada' ? '+' : '−'} ${U.brl(t.valor)}</td>
      </tr>`).join('');
    return `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="right">Valor</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Sem lançamentos no período.</td></tr>'}</tbody></table></div>`;
  }

  /* ---------- VIEWS ---------- */

  function viewDashboard(main) {
    const m = dadosMes() || M.cur;
    const prev = m ? mesAnteriorDe(m.mes) : null;
    const k = M.kpi;

    const kpis = [
      kpiCard({ icon: 'bi-cash-coin', label: 'Receita do mês', valor: U.brl(m?.receita), deltaPct: prev ? U.delta(m.receita, prev.receita) : null, sub: m ? U.ymLabel(m.mes) : '' }),
      kpiCard({ icon: 'bi-graph-up', label: 'Resultado operacional', valor: U.brl(m?.resultadoOp), deltaPct: prev ? U.delta(m.resultadoOp, prev.resultadoOp) : null, cls: m && m.resultadoOp < 0 ? 'kpi-bad' : '' }),
      kpiCard({ icon: 'bi-safe', label: 'Saldo acumulado', valor: U.brl(k.saldoAtual), sub: 'toda a operação' }),
      kpiCard({ icon: 'bi-arrow-left-right', label: 'Capital de giro', valor: U.brl(k.capitalGiro), sub: k.capitalGiroMeses != null ? k.capitalGiroMeses.toFixed(1) + ' meses ' + nivelBadge(k.capitalGiroMeses) : '' }),
      kpiCard({ icon: 'bi-receipt', label: 'Boletos a vencer', valor: U.brl(k.totalBoletosFuturos), invert: true, sub: M.boletosFuturos.length + ' boletos' }),
      kpiCard({ icon: 'bi-basket', label: 'CMV', valor: m?.cmvPct != null ? U.pct(m.cmvPct) : '—', deltaPct: prev && m?.cmvPct != null && prev.cmvPct != null ? m.cmvPct - prev.cmvPct : null, invert: true, sub: U.brl(m?.cmv) }),
      kpiCard({ icon: 'bi-percent', label: 'Margem operacional', valor: m?.margem != null ? U.pct(m.margem) : '—', deltaPct: prev && m?.margem != null && prev.margem != null ? m.margem - prev.margem : null }),
      kpiCard({ icon: 'bi-cup-straw', label: 'Venda média / dia', valor: U.brl(m?.vendaMediaDia), deltaPct: prev ? U.delta(m?.vendaMediaDia, prev.vendaMediaDia) : null }),
      kpiCard({ icon: 'bi-shield-check', label: 'Reserva (meses)', valor: k.reservaMeses != null ? k.reservaMeses.toFixed(1) : '—', sub: nivelBadge(k.reservaMeses) }),
      kpiCard({ icon: 'bi-bullseye', label: 'Ponto de equilíbrio', valor: U.brl(k.pontoEquilibrio), sub: 'receita mínima / mês' }),
      kpiCard({ icon: 'bi-phone', label: 'Receita iFood', valor: U.brl(m?.vendasIfood), deltaPct: prev ? U.delta(m?.vendasIfood, prev.vendasIfood) : null }),
      kpiCard({ icon: 'bi-hourglass-split', label: 'Dias de caixa', valor: M.proj.diasDeCaixa != null ? '~' + M.proj.diasDeCaixa : (M.proj.netDia >= 0 ? '∞' : '—'), sub: M.proj.netDia < 0 ? 'queimando ' + U.brl(Math.abs(M.proj.netDia)) + '/dia' : 'fluxo diário positivo', cls: M.proj.diasDeCaixa != null && M.proj.diasDeCaixa < 60 ? 'kpi-warn' : '' }),
      kpiCard({ icon: 'bi-box-seam', label: 'Estoque', valor: INV ? INV.totalItens + ' itens' : '—', sub: INV ? `${INV.zerados.length} zerados · ${INV.baixos.length} baixos` : 'sem aba de estoque', cls: INV && INV.zerados.length ? 'kpi-warn' : '' }),
    ].join('');

    const alertasTop = ALERTAS.filter(a => a.level !== 'ok').slice(0, 3).map(alertaHtml).join('') ||
      '<div class="alerta ok"><i class="bi bi-check-circle"></i><div><strong>Tudo em ordem</strong><p>Nenhum alerta com os dados atuais.</p></div></div>';

    /* --- Visão diária: ontem e a semana --- */
    const porDiaV = {};
    for (const t of M.txs) {
      if (t.tipo !== 'Entrada' || (t.grupo !== 'receitaBalcao' && t.grupo !== 'receitaIfood')) continue;
      const kk = t.date.toDateString();
      porDiaV[kk] = porDiaV[kk] || { data: new Date(t.date.getFullYear(), t.date.getMonth(), t.date.getDate()), v: 0 };
      porDiaV[kk].v += t.valor;
    }
    const diasV = Object.values(porDiaV).sort((a, b) => a.data - b.data);
    let visaoDiaria = '';
    if (diasV.length >= 8) {
      const ult = diasV[diasV.length - 1];
      const mesmoDiaSemPassada = diasV.find(d => +d.data === +ult.data - 7 * 86400000);
      const mediaDowU = U.avg(diasV.filter(d => d.data.getDay() === ult.data.getDay()).map(d => d.v));
      const corte7 = +ult.data - 6 * 86400000, corte14 = +ult.data - 13 * 86400000;
      const sem7 = U.sum(diasV.filter(d => +d.data >= corte7), d => d.v);
      const sem7ant = U.sum(diasV.filter(d => +d.data >= corte14 && +d.data < corte7), d => d.v);
      const NOMES_D = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
      visaoDiaria = card('Visão diária — último dia lançado', `
        <div class="kpi-grid kpi-grid-4">
          ${kpiCard({ icon: 'bi-calendar-check', label: 'Venda de ' + NOMES_D[ult.data.getDay()] + ' ' + U.fmtDate(ult.data), valor: U.brl(ult.v), deltaPct: mesmoDiaSemPassada ? U.delta(ult.v, mesmoDiaSemPassada.v) : null, sub: mesmoDiaSemPassada ? 'vs mesma ' + NOMES_D[ult.data.getDay()] + ' passada (' + U.brl(mesmoDiaSemPassada.v) + ')' : '' })}
          ${kpiCard({ icon: 'bi-bullseye', label: 'vs média de ' + NOMES_D[ult.data.getDay()], valor: mediaDowU ? U.pct(ult.v / mediaDowU * 100) : '—', sub: 'média histórica: ' + U.brl(mediaDowU), cls: mediaDowU && ult.v < mediaDowU * 0.8 ? 'kpi-warn' : '' })}
          ${kpiCard({ icon: 'bi-calendar-week', label: 'Últimos 7 dias', valor: U.brl(sem7), deltaPct: sem7ant ? U.delta(sem7, sem7ant) : null, sub: 'vs 7 dias anteriores (' + U.brl(sem7ant) + ')' })}
          ${kpiCard({ icon: 'bi-speedometer2', label: 'Venda média nos 7 dias', valor: U.brl(sem7 / 7), sub: 'por dia corrido' })}
        </div>`);
    }

    /* --- Metas do mês --- */
    let metasCard = '';
    const MT = RAW.metas;
    const cur = M.cur; // mês corrente (metas sempre acompanham o mês em andamento)
    if (MT && cur) {
      const hoje = new Date();
      const ehMesCorrente = cur.mes === U.ymKey(hoje);
      const [my, mm2] = cur.mes.split('-').map(Number);
      const diasNoMes = new Date(my, mm2, 0).getDate();
      const diasPassados = ehMesCorrente ? hoje.getDate() : diasNoMes;
      const diasRestantes = Math.max(0, diasNoMes - diasPassados);
      const barras = [];
      if (MT.faturamento) {
        const pct = cur.receita / MT.faturamento * 100;
        const ritmoOk = pct >= (diasPassados / diasNoMes) * 100 - 5;
        const precisaDia = diasRestantes ? Math.max(0, MT.faturamento - cur.receita) / diasRestantes : 0;
        barras.push(`<div class="meta-item">
          <div class="meta-head"><span>Faturamento</span><span class="mono">${U.brl(cur.receita)} / ${U.brl(MT.faturamento)} <span class="badge ${pct >= 100 ? 'ok' : ritmoOk ? 'good' : 'warn'}">${U.pct(pct, 0)}</span></span></div>
          <div class="meta-bar"><div class="meta-fill ${pct >= 100 ? 'ok' : ritmoOk ? '' : 'warn'}" style="width:${Math.min(100, pct)}%"></div><div class="meta-mark" style="left:${Math.min(100, diasPassados / diasNoMes * 100)}%"></div></div>
          ${ehMesCorrente && diasRestantes ? `<span class="dim">faltam ${U.brl(MT.faturamento - cur.receita > 0 ? MT.faturamento - cur.receita : 0)} · ritmo necessário: <strong>${U.brl(precisaDia)}/dia</strong> nos ${diasRestantes} dias restantes</span>` : ''}
        </div>`);
      }
      const metaPct = (nome, valorAtual, meta, menorMelhor = true) => {
        if (meta == null || valorAtual == null) return '';
        const ok = menorMelhor ? valorAtual <= meta : valorAtual >= meta;
        const quase = menorMelhor ? valorAtual <= meta * 1.1 : valorAtual >= meta * 0.9;
        return `<div class="meta-mini"><span>${nome}</span><span class="badge ${ok ? 'ok' : quase ? 'warn' : 'bad'}">${U.pct(valorAtual)} <span class="dim">meta ${menorMelhor ? '≤' : '≥'} ${U.pct(meta)}</span></span></div>`;
      };
      const minis = [
        metaPct('CMV', cur.cmvPct, MT.cmvPct),
        metaPct('Folha', cur.folhaPct, MT.folhaPct),
        metaPct('Marketing', cur.receita ? cur.marketing / cur.receita * 100 : null, MT.marketingPct),
        MT.resultado != null ? `<div class="meta-mini"><span>Resultado</span><span class="badge ${cur.resultadoOp >= MT.resultado ? 'ok' : cur.resultadoOp >= 0 ? 'warn' : 'bad'}">${U.brl(cur.resultadoOp)} <span class="dim">meta ${U.brl(MT.resultado)}</span></span></div>` : '',
      ].join('');
      metasCard = card('Metas de ' + U.ymLabelFull(cur.mes) + ' <span class="dim">(aba Metas da planilha)</span>', barras.join('') + `<div class="meta-minis">${minis}</div>
        <p class="note dim">A marquinha na barra indica onde o mês "deveria" estar pelo dia de hoje. Edite as metas na aba <code>Metas</code> da planilha.</p>`);
    }

    /* --- Resumo inteligente do mês --- */
    let resumoMesCard = '';
    try {
      // garante que a projeção de fluxo foi calculada (popula FLUXO_RESUMO)
      if (!FLUXO_RESUMO && BAN && BAN.saldoDiario && BAN.saldoDiario.length >= 5) {
        const tmp = document.createElement('div');
        try { viewFluxoReal(tmp); } catch (e) { /* ignora */ }
      }
      const paras = DB.analytics.resumoDoMes(M, { fluxo: FLUXO_RESUMO, getnet: GAN });
      if (paras && paras.length) {
        resumoMesCard = card('<i class="bi bi-lightbulb"></i> Como está o mês — análise automática', `<div class="resumo">${paras.join('')}</div>`);
      }
    } catch (e) { /* silencioso */ }

    main.innerHTML = `
      ${M.suspeitos && M.suspeitos.length ? `<div class="alerta warn" style="margin-bottom:14px;cursor:pointer" onclick="__dbIrAlertas()"><i class="bi bi-exclamation-triangle"></i><div><strong>${M.suspeitos.length} lançamento(s) com possível erro de digitação</strong><p>Encontrei datas ou valores que parecem digitados errado (ex.: ano trocado). Clique aqui ou veja a aba <strong>Alertas</strong> para conferir e corrigir na planilha.</p></div></div>` : ''}
      <div class="kpi-grid">${kpis}</div>
      ${metasCard}
      ${visaoDiaria}
      ${resumoMesCard}
      <div class="grid-2">
        ${card('Entradas × Saídas por mês', '<div class="chart-box"><canvas id="ch-es"></canvas></div>')}
        ${card('Despesas por categoria' + (m ? ' — ' + U.ymLabel(m.mes) : ''), '<div class="chart-box"><canvas id="ch-cat"></canvas></div>')}
      </div>
      <div class="grid-2">
        ${card('Saldo de caixa por mês', '<div class="chart-box"><canvas id="ch-saldo"></canvas></div>')}
        ${card('Alertas prioritários', `<div class="alerta-list">${alertasTop}</div>`)}
      </div>`;

    const labels = M.meses.map(U.ymLabel);
    DB.charts.linhaEntradasSaidas('ch-es', labels, M.meses.map(x => M.byMonth[x].entradas), M.meses.map(x => M.byMonth[x].saidas));

    if (m) {
      const cats = Object.entries(m.cats).filter(([, v]) => v.sai > 0).sort((a, b) => b[1].sai - a[1].sai).slice(0, 8);
      DB.charts.rosca('ch-cat', cats.map(c => c[0]), cats.map(c => c[1].sai));
    }
    const p = DB.charts.palette();
    DB.charts.barras('ch-saldo', labels, [{ label: 'Saldo do mês', data: M.meses.map(x => M.byMonth[x].saldo), color: p.pistache }]);
  }

  function viewFluxo(main) {
    // Se há extrato bancário, o fluxo é REAL (saldo do banco); senão, projeção da planilha
    const temBanco = BAN && BAN.saldoDiario && BAN.saldoDiario.length >= 5;
    if (temBanco) return viewFluxoReal(main);

    const k = M.kpi, proj = M.proj;
    const status = proj.primeiroNegativo != null
      ? `<div class="alerta bad"><i class="bi bi-exclamation-octagon"></i><div><strong>Déficit projetado</strong><p>No ritmo atual, o caixa fica negativo em ~${proj.primeiroNegativo} dias.</p></div></div>`
      : `<div class="alerta ok"><i class="bi bi-check-circle"></i><div><strong>Caixa saudável</strong><p>Sem déficit projetado nos próximos 90 dias.</p></div></div>`;

    main.innerHTML = `
      <div class="alerta warn"><i class="bi bi-info-circle"></i><div><strong>Fluxo estimado pela planilha</strong><p>Carregue o extrato bancário (aba <strong>Banco</strong>) para ver o fluxo de caixa <em>real</em> — o saldo que de fato esteve na conta, dia a dia, em vez da projeção por média.</p></div></div>
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-arrow-down-circle', label: 'Entrada média / dia (30d)', valor: U.brl(proj.entDia) })}
        ${kpiCard({ icon: 'bi-arrow-up-circle', label: 'Saída média / dia (30d)', valor: U.brl(proj.saiDia) })}
        ${kpiCard({ icon: 'bi-water', label: 'Fluxo líquido / dia', valor: U.brl(proj.netDia), cls: proj.netDia < 0 ? 'kpi-bad' : '' })}
        ${kpiCard({ icon: 'bi-safe', label: 'Saldo estimado', valor: U.brl(k.saldoAtual) })}
      </div>
      ${card('Fluxo realizado × projetado (90 dias)', '<div class="chart-box tall"><canvas id="ch-proj"></canvas></div>')}
      ${status}`;

    const labelsReal = M.meses.map(U.ymLabel);
    const real = M.meses.map(x => M.byMonth[x].saldoAcumulado);
    const passo = 7;
    const labelsProj = [], vals = [];
    for (let i = passo - 1; i < proj.serie.length; i += passo) {
      labelsProj.push('+' + (i + 1) + 'd');
      vals.push(proj.serie[i].saldo);
    }
    DB.charts.linhaProjecao('ch-proj', labelsReal, real, labelsProj, vals);
  }

  // venda média por dia da semana dos últimos ~60 dias de lançamentos (fallback do fluxo)
  function vendaMediaDiaSemana(dow) {
    if (!M || !M.txs) return 0;
    const lim = new Date(); lim.setDate(lim.getDate() - 60);
    const porDia = {};
    for (const t of M.txs) {
      if (t.tipo !== 'Entrada' || (t.grupo !== 'receitaBalcao' && t.grupo !== 'receitaIfood')) continue;
      if (t.date < lim) continue;
      const k = t.date.toDateString();
      porDia[k] = porDia[k] || { dow: t.date.getDay(), v: 0 };
      porDia[k].v += t.valor;
    }
    const doDia = Object.values(porDia).filter(d => d.dow === dow);
    return doDia.length ? U.avg(doDia.map(d => d.v)) : 0;
  }

  function viewFluxoReal(main) {
    const A = BAN;
    const serie = A.saldoDiario;
    const saldoHoje = A.saldoAtual;
    const dataSaldo = A.saldoData;
    const saldos = serie.map(s => s.saldo);
    const saldoMin = Math.min(...saldos);
    const diaMin = serie.find(s => s.saldo === saldoMin);
    const dias = Math.round((A.fim - A.ini) / 86400000) + 1;
    const entDia = A.entradas / dias, saiDia = A.saidas / dias, netDia = entDia - saiDia;

    const hoje = new Date(Math.max(+dataSaldo, +A.fim));
    const horizonte = 90;
    const eventos = [];
    if (M.boletos) for (const b of M.boletos) if (b.venc && b.venc > hoje) eventos.push({ data: b.venc, valor: -b.valor, tipo: 'boleto', desc: b.desc });
    if (GAN && GAN.recebiveis) for (const r of GAN.recebiveis) if (r.venc && r.venc > hoje) eventos.push({ data: r.venc, valor: r.valor, tipo: 'receb', desc: r.bandeira });

    // SAÍDAS FIXAS RECORRENTES (salário, aluguel, luz, royalty, impostos…) no
    // dia típico do mês. Excluímos: boletos de matéria-prima (grupo cmv) e
    // financiamentos (Tortelli/Celso), que entram pela aba Boletos com data
    // exata; pagamento de fatura de cartão (embute despesas já contadas em
    // outras categorias); e adiantamentos de salário (antecipam a folha que já
    // está contada) — tudo isso evita contar o mesmo dinheiro duas vezes.
    const ehPassThrough = r => {
      const d = U.norm(r.desc);
      return /cartao de credito|^cartao$|fatura|adiantament/.test(d);
    };
    const recorrentesFixos = (M.recorrentes || []).filter(r => r.grupo !== 'cmv' && r.grupo !== 'financiamento' && r.valorMedio >= 200 && !ehPassThrough(r));
    const gruposDesc = { financiamento: 'Financiamento', fixos: 'Aluguel/fixos', folha: 'Folha', impostos: 'Impostos', marketing: 'Marketing', outros: 'Outros' };
    function eventosRecorrentesNoMes(ano, mes) {
      const diasNoMes = new Date(ano, mes + 1, 0).getDate();
      return recorrentesFixos.map(r => {
        const dia = Math.min(r.diaMes, diasNoMes);
        return { data: new Date(ano, mes, dia), valor: -r.valorMedio, tipo: 'fixo', desc: r.desc, grupo: r.grupo };
      });
    }
    // gera os recorrentes para cada mês dentro do horizonte
    const fimHoriz = new Date(hoje); fimHoriz.setDate(fimHoriz.getDate() + horizonte);
    for (let mesCursor = new Date(hoje.getFullYear(), hoje.getMonth(), 1); mesCursor <= fimHoriz; mesCursor.setMonth(mesCursor.getMonth() + 1)) {
      for (const ev of eventosRecorrentesNoMes(mesCursor.getFullYear(), mesCursor.getMonth())) {
        if (ev.data > hoje && ev.data <= fimHoriz) eventos.push(ev);
      }
    }

    // ENTRADA DE CAIXA DIÁRIA (loja abre todo dia): débito cai em D+1, PIX,
    // dinheiro e crédito (via previsão após a agenda). A venda de cada dia é
    // dividida entre as formas de pagamento — TUDO junto soma 100% da venda.
    // O mix da Getnet (crédito+débito+PIX) cobre só o que passa na maquininha;
    // o dinheiro é uma fatia à parte do balcão. Reescalamos para que
    // crédito+débito+PIX+dinheiro = 100% da venda total (senão contaria demais).
    const mixG = GAN && GAN.mix ? GAN.mix : { credito: 0.483, debito: 0.396, pix: 0.121, taxaDebito: 0.009, taxaCredito: 0.014 };
    const dinheiroPct = 0.119;                       // ~12% do total de vendas é dinheiro
    const escalaMaq = 1 - dinheiroPct;               // o restante (~88%) passa na maquininha
    const mix = {
      credito: mixG.credito * escalaMaq,
      debito: mixG.debito * escalaMaq,
      pix: mixG.pix * escalaMaq,
      taxaDebito: mixG.taxaDebito || 0.009,
      taxaCredito: mixG.taxaCredito || 0.014,
    };
    // agora credito+debito+pix+dinheiro ≈ 100% da venda total
    function vendaPrevistaDoDia(dia) {
      if (CLIMA && CLIMA.previsaoDemanda) {
        const p = CLIMA.previsaoDemanda.find(x => x.data.getFullYear() === dia.getFullYear() && x.data.getMonth() === dia.getMonth() && x.data.getDate() === dia.getDate());
        if (p) return p.estimativa;
        if (CLIMA.analise) { // além dos 7 dias previstos, usa o modelo base
          const A2 = CLIMA.analise;
          const fx = DB.clima.faixaDe ? null : null;
          return A2.nivelAtual * (A2.fatorDow[dia.getDay()] || 1);
        }
      }
      // fallback: venda média por dia da semana dos últimos 60 dias de lançamentos
      return vendaMediaDiaSemana(dia.getDay());
    }
    // CMV FUTURO (matéria-prima): custo real grande (~28% da receita) que na
    // maior parte não está cadastrado como boleto para os meses à frente. Sem
    // ele, o caixa projetado sobe artificialmente. Injetamos como saída
    // proporcional à venda, MAS só a partir do fim da cobertura dos boletos de
    // CMV já cadastrados, para não contar duas vezes.
    const mesesFech = M.meses.filter(k => k !== M.mesAtualKey && M.byMonth[k].receita > 5000).slice(-3);
    const cmvPct = mesesFech.length ? U.avg(mesesFech.map(k => M.byMonth[k].cmv / M.byMonth[k].receita)) : 0.28;
    // último vencimento de boleto de MATÉRIA-PRIMA já cadastrado (exclui
    // financiamentos como Tortelli, que vão até novembro e não são CMV).
    const ehFinanc = b => /tortelli|celso/i.test(U.norm(b.desc || ''));
    const boletosCmvFut = (M.boletos || []).filter(b => b.venc > hoje && !ehFinanc(b));
    const fimCoberturaCmv = boletosCmvFut.length ? boletosCmvFut.reduce((mx, b) => (b.venc > mx ? b.venc : mx), hoje) : hoje;

    // data em que a agenda de recebíveis de crédito da Getnet termina; depois
    // dela, o crédito não pára de entrar — apenas deixamos de ter a agenda
    // exata, então estimamos pela venda prevista (crédito cai ~D+1 na cessão).
    const ultRecebivel = eventos.filter(e => e.tipo === 'receb').reduce((max, e) => (e.data > max ? e.data : max), hoje);

    const projSerie = [];
    let saldoP = saldoHoje;
    let entradaVendaTotal = 0;
    let cmvTotal = 0;
    for (let d = 1; d <= horizonte; d++) {
      const dia = new Date(hoje); dia.setDate(dia.getDate() + d);
      const venda = vendaPrevistaDoDia(dia) || 0;
      const ontem = new Date(dia); ontem.setDate(ontem.getDate() - 1);
      const vendaOntem = vendaPrevistaDoDia(ontem) || 0;
      const entradaDebito = vendaOntem * mix.debito * (1 - (mix.taxaDebito || 0.009));
      const entradaPix = venda * mix.pix;
      const entradaDinheiro = venda * dinheiroPct;
      const entradaCredito = dia > ultRecebivel ? vendaOntem * mix.credito * (1 - (mix.taxaCredito || 0.014)) : 0;
      const entradaDia = entradaDebito + entradaPix + entradaDinheiro + entradaCredito;
      entradaVendaTotal += entradaDia;
      saldoP += entradaDia;
      // CMV estimado (matéria-prima) proporcional à venda, só após a cobertura
      // dos boletos de CMV já cadastrados (senão conta duas vezes)
      if (dia > fimCoberturaCmv) { const cmvDia = venda * cmvPct; saldoP -= cmvDia; cmvTotal += cmvDia; }
      for (const e of eventos) if (e.data.getFullYear() === dia.getFullYear() && e.data.getMonth() === dia.getMonth() && e.data.getDate() === dia.getDate()) saldoP += e.valor;
      projSerie.push({ data: dia, saldo: saldoP });
    }
    const primeiroNeg = projSerie.find(s => s.saldo < 0);
    // expõe resumo do fluxo para a Consultoria
    FLUXO_RESUMO = { primeiroNeg: primeiroNeg ? primeiroNeg.data : null, piorSaldo: Math.min(...projSerie.map(s => s.saldo)), saldoHoje };
    const totalBoletos = U.sum(eventos.filter(e => e.tipo === 'boleto'), e => Math.abs(e.valor));
    const totalReceb = U.sum(eventos.filter(e => e.tipo === 'receb'), e => e.valor);
    const totalFixos = U.sum(eventos.filter(e => e.tipo === 'fixo'), e => Math.abs(e.valor));

    // perfil de custo por período do mês (soma dos recorrentes fixos + boletos por faixa de dia)
    const saidasFuturas = eventos.filter(e => e.valor < 0);
    const faixa = [{ nome: 'Dias 1–10', min: 1, max: 10, total: 0 }, { nome: 'Dias 11–20', min: 11, max: 20, total: 0 }, { nome: 'Dias 21–31', min: 21, max: 31, total: 0 }];
    for (const e of saidasFuturas) { const d = e.data.getDate(); const f = faixa.find(f => d >= f.min && d <= f.max); if (f) f.total += Math.abs(e.valor); }
    const totalFaixas = U.sum(faixa, f => f.total) || 1;

    const status = primeiroNeg
      ? `<div class="alerta bad"><i class="bi bi-exclamation-octagon"></i><div><strong>Atenção ao caixa</strong><p>Considerando saldo atual, a venda diária estimada, boletos a vencer e recebíveis já agendados, a conta pode ficar negativa por volta de ${U.fmtDate(primeiroNeg.data)}. Vale antecipar recebível, negociar prazo de boleto ou segurar despesa.</p></div></div>`
      : `<div class="alerta ok"><i class="bi bi-check-circle"></i><div><strong>Caixa projetado positivo</strong><p>Com o saldo atual, a venda diária estimada e o que já está agendado, a conta se mantém positiva nos próximos 90 dias.</p></div></div>`;
    const temPrevisao = !!(CLIMA && CLIMA.previsaoDemanda);

    // ===== ANÁLISE NARRATIVA AUTOMÁTICA DA PROJEÇÃO =====
    // Lê a série projetada e explica em português por que o caixa sobe e desce,
    // apontando o(s) vale(s) e o custo do período crítico.
    const narrativa = (() => {
      if (!projSerie.length) return '';
      // saldo por mês projetado: pico e vale de cada mês
      const porMesProj = {};
      for (const p of projSerie) {
        const k = U.ymKey(p.data);
        const m = porMesProj[k] || (porMesProj[k] = { mes: k, min: Infinity, max: -Infinity, minData: null, maxData: null, fimSaldo: 0 });
        if (p.saldo < m.min) { m.min = p.saldo; m.minData = p.data; }
        if (p.saldo > m.max) { m.max = p.saldo; m.maxData = p.data; }
        m.fimSaldo = p.saldo;
      }
      const meses = Object.values(porMesProj);
      // vale global (pior momento)
      const vale = projSerie.reduce((a, b) => (b.saldo < a.saldo ? b : a));
      const pico = projSerie.reduce((a, b) => (b.saldo > a.saldo ? b : a));
      // custos fixos que caem na 1ª quinzena (o que causa a queda) — um de cada tipo
      const fixosQ1 = eventos.filter(e => e.tipo === 'fixo' && e.data.getDate() <= 12);
      const porDesc = {};
      for (const e of fixosQ1) {
        const chave = U.norm((e.desc || '').replace(/\d+/g, '')).trim();
        if (!porDesc[chave] || Math.abs(e.valor) > Math.abs(porDesc[chave].valor)) porDesc[chave] = e;
      }
      const fixosUnicos = Object.values(porDesc).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
      const top3 = fixosUnicos.slice(0, 4).map(e => U.esc((e.desc || '').split(/\s+/).slice(0, 2).join(' ')) + ' (~dia ' + e.data.getDate() + ', ' + U.brl(Math.abs(e.valor)) + ')');
      // custo médio da 1ª quinzena por mês (soma total ÷ nº de meses no horizonte)
      const custoQuinzena1Mes = U.sum(eventos.filter(e => e.tipo === 'fixo' && e.data.getDate() <= 12), e => Math.abs(e.valor)) / Math.max(1, meses.length);

      // mês do vale
      const mesVale = vale.data.toLocaleDateString('pt-BR', { month: 'long' });
      const partes = [];
      partes.push(`<strong>Por que o caixa oscila assim?</strong> O gráfico tem esse formato de "dente de serra" porque, todo mês, a maior parte dos custos fixos sai concentrada na <strong>primeira quinzena</strong> — enquanto as vendas entram diluídas ao longo dos 30 dias. Então o saldo despenca no começo de cada mês e vai se recuperando conforme as vendas pingam no caixa.`);
      if (top3.length) {
        partes.push(`Os grandes responsáveis pela queda no início do mês são ${top3.slice(0, 3).join(', ')}${top3.length > 3 ? ' e outros' : ''} — juntos, cerca de ${U.brl(custoQuinzena1Mes)} saem já nos primeiros dias.`);
      }
      // ponto mais crítico
      if (vale.saldo < 5000) {
        partes.push(`O momento mais apertado da projeção é por volta de <strong>${U.fmtDate(vale.data)}</strong>, quando o saldo chega ao menor ponto (${U.brl(vale.saldo)})${vale.saldo < 0 ? ' — ficando negativo, ou seja, faltaria dinheiro para cobrir tudo naquela data' : ' — perigosamente baixo'}. Esse fundo do vale acontece logo depois dos pagamentos fixos de ${mesVale}, antes das vendas do mês recomporem o caixa.`);
      } else {
        partes.push(`O ponto mais baixo da projeção é em <strong>${U.fmtDate(vale.data)}</strong> (${U.brl(vale.saldo)}), mas ainda dentro de uma margem segura.`);
      }
      partes.push(`Depois de cada fundo, a linha volta a subir porque as vendas de débito, PIX e dinheiro continuam entrando todo dia. O recado para os sócios é simples: <strong>entrar em cada mês com caixa reforçado até o dia 10</strong>, que é quando o aperto é maior. Nos dias mais críticos, dá para suavizar antecipando um recebível ou empurrando um boleto grande para depois do vale.`);
      return partes.map(p => `<p>${p}</p>`).join('');
    })();

    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-safe2', label: A.saldoExato ? 'Saldo real na conta' : 'Saldo (movimento acumulado)', valor: U.brl(saldoHoje), sub: A.saldoExato ? 'em ' + U.fmtDate(dataSaldo) + ' (extrato)' : 'reimporte o OFX para o saldo exato' })}
        ${kpiCard({ icon: 'bi-graph-down', label: 'Menor saldo projetado', valor: U.brl(Math.min(saldoMin, ...projSerie.map(s => s.saldo))), cls: Math.min(...projSerie.map(s => s.saldo)) < 1000 ? 'kpi-warn' : '' })}
        ${kpiCard({ icon: 'bi-cash-stack', label: 'Entrada de venda (90d)', valor: U.brl(entradaVendaTotal), sub: 'débito + PIX + dinheiro estimados' })}
        ${kpiCard({ icon: 'bi-calendar-check', label: 'Saídas fixas / mês', valor: U.brl(totalFixos / 3), sub: 'salário, aluguel, luz, impostos…' })}
      </div>
      ${card('Saldo real na conta × projeção dos próximos 90 dias', '<div class="chart-box tall"><canvas id="ch-fluxo-real"></canvas></div><p class="note">A linha cheia é o saldo que <strong>de fato</strong> esteve na conta (extrato Santander). A pontilhada projeta a partir de hoje: <strong>+</strong> venda diária em débito, PIX e dinheiro' + (temPrevisao ? ' (previsão clima × calendário)' : ' (média por dia da semana)') + ' e recebíveis de crédito da Getnet; <strong>−</strong> as saídas fixas recorrentes no dia típico de cada uma e os boletos que vencem.</p>')}
      ${card('<i class="bi bi-chat-square-text"></i> Entendendo o gráfico — para os sócios', `<div class="resumo">${narrativa}</div>`)}
      ${status}
      ${card('Calendário de custos do mês — quando o caixa aperta', `
        <p class="note" style="margin-top:0">As saídas fixas não se distribuem por igual no mês. Veja onde precisa ter mais dinheiro em caixa:</p>
        <div class="antec-comp">
          ${faixa.map(f => `<div class="antec-row"><div class="antec-lbl">${f.nome}<span class="dim">${U.pct(f.total / totalFaixas * 100, 0)} das saídas</span></div>
            <div class="antec-track"><div class="antec-fill" style="width:${(f.total / totalFaixas * 100).toFixed(1)}%;background:${f.total / totalFaixas > 0.4 ? 'var(--berry)' : f.total / totalFaixas > 0.3 ? 'var(--gold)' : 'var(--teal)'}"></div>
              <span class="antec-val">${U.brl(f.total)}</span></div></div>`).join('')}
        </div>
        <p class="note">${faixa[0].total > faixa[2].total * 1.5 ? 'A <strong>primeira quinzena é a mais pesada</strong> — concentra salários, aluguel e financiamento. É quando o caixa precisa estar mais reforçado.' : 'Os custos estão relativamente distribuídos ao longo do mês.'}</p>`)}
      ${!temPrevisao ? '<div class="alerta warn"><i class="bi bi-lightbulb"></i><div><strong>Dica: melhore a precisão</strong><p>Abra a aba <strong>Clima × Vendas</strong> e carregue a análise. A projeção de venda diária passa a considerar temperatura, feriados e férias.</p></div></div>' : ''}
      ${card('Compromissos dos próximos 90 dias', (() => {
        const evOrd = eventos.filter(e => e.data <= projSerie[projSerie.length - 1].data).sort((a, b) => a.data - b.data).slice(0, 40);
        if (!evOrd.length) return '<p class="note">Sem compromissos agendados no período.</p>';
        const tipoLabel = { boleto: '<i class="bi bi-arrow-up-right neg"></i> Boleto', receb: '<i class="bi bi-arrow-down-left pos"></i> Recebível', fixo: '<i class="bi bi-arrow-repeat warn-text"></i> Fixo mensal' };
        const rows = evOrd.map(e => `<tr>
          <td class="mono">${U.fmtDate(e.data)}</td>
          <td>${tipoLabel[e.tipo] || ''} ${U.esc(e.desc || '')}</td>
          <td class="mono right ${e.valor < 0 ? 'neg' : 'pos'}">${U.brl(e.valor)}</td>
        </tr>`).join('');
        return `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Compromisso</th><th class="right">Valor</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      })())}
      ${card('Como este fluxo é calculado', `<p class="note">Parte do <strong>saldo real</strong> do extrato (${U.brl(saldoHoje)} em ${U.fmtDate(dataSaldo)}). Para frente, cada dia soma a <strong>venda que entra no caixa</strong> — débito (D+1), PIX e dinheiro (~12% do balcão) — mais recebíveis de crédito da Getnet, e subtrai as <strong>saídas fixas recorrentes</strong> no dia típico de cada uma (salário ~dia 6, aluguel ~dia 5, royalty ~dia 10, impostos ~dia 20…) e os boletos da aba Boletos (matéria-prima e financiamentos com data exata). Recorrentes detectados automaticamente: ${recorrentesFixos.length} itens somando ${U.brl(totalFixos / 3)}/mês.</p>`)}`;

    const p = DB.charts.palette();
    const passoR = Math.max(1, Math.floor(serie.length / 30));
    const labelsReal = [], valsReal = [];
    for (let i = 0; i < serie.length; i += passoR) { labelsReal.push(U.fmtDate(serie[i].data)); valsReal.push(serie[i].saldo); }
    labelsReal.push(U.fmtDate(dataSaldo)); valsReal.push(saldoHoje);
    const labelsProj = [], valsProj = [];
    for (let i = 6; i < projSerie.length; i += 7) { labelsProj.push(U.fmtDate(projSerie[i].data)); valsProj.push(projSerie[i].saldo); }
    DB.charts.linhaProjecao('ch-fluxo-real', labelsReal, valsReal, labelsProj, valsProj);
  }

  function viewLancamentos(tipo) {
    const main = $('#main-content');
    const k = mesSelecionado();
    let txs = M.txs.filter(t => t.tipo === tipo);
    if (k) txs = txs.filter(t => t.mes === k);
    txs = txs.slice().sort((a, b) => b.date - a.date);

    const total = U.sum(txs, t => t.valor);
    const porCat = {};
    txs.forEach(t => porCat[t.categoria] = (porCat[t.categoria] || 0) + t.valor);
    const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);

    const buscaId = 'busca-' + tipo;
    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: tipo === 'Entrada' ? 'bi-arrow-down-circle' : 'bi-arrow-up-circle', label: `Total de ${tipo.toLowerCase()}s`, valor: U.brl(total), sub: k ? U.ymLabelFull(k) : 'todos os meses' })}
        ${kpiCard({ icon: 'bi-list-ol', label: 'Lançamentos', valor: String(txs.length) })}
        ${kpiCard({ icon: 'bi-tags', label: 'Categorias', valor: String(cats.length) })}
        ${kpiCard({ icon: 'bi-cash-stack', label: 'Maior categoria', valor: cats[0] ? U.brlShort(cats[0][1]) : '—', sub: cats[0] ? U.esc(cats[0][0]) : '' })}
      </div>
      ${card(`${tipo}s por categoria`, '<div class="chart-box"><canvas id="ch-lc"></canvas></div>')}
      ${card('Lançamentos', `<input id="${buscaId}" class="input busca" type="search" placeholder="Buscar descrição ou categoria…"><div id="tx-list">${tabelaTx(txs, 200)}</div>`)}`;

    DB.charts.barrasHoriz('ch-lc', cats.slice(0, 10).map(c => c[0]), cats.slice(0, 10).map(c => c[1]),
      tipo === 'Entrada' ? DB.charts.palette().pistache : DB.charts.palette().amarena);

    $('#' + buscaId).addEventListener('input', e => {
      const q = U.norm(e.target.value);
      const f = txs.filter(t => U.norm(t.desc).includes(q) || U.norm(t.categoria).includes(q));
      $('#tx-list').innerHTML = tabelaTx(f, 200);
    });
  }

  /* ---------- SAÍDAS (raio-X de custos) ---------- */

  // Referências de mercado (% do faturamento) para gelateria artesanal / food service
  const BENCH = [
    { id: 'cmv', nome: 'CMV (matéria-prima, embalagens, frete)', grupos: ['cmv'], min: 25, max: 35 },
    { id: 'folha', nome: 'Folha (salários, freelancers, encargos)', grupos: ['folha'], min: 20, max: 30 },
    { id: 'fixos', nome: 'Fixos e administrativo (aluguel, contabilidade, sistemas, royalty)', grupos: ['fixos'], min: 10, max: 20 },
    { id: 'ifood', nome: 'Canal iFood (motoboy e taxas)', grupos: ['custoIfood'], min: 0, max: 6 },
    { id: 'marketing', nome: 'Marketing', grupos: ['marketing'], min: 2, max: 6 },
    { id: 'impostos', nome: 'Impostos', grupos: ['impostos'], min: 4, max: 10 },
  ];

  function viewSaidas(main) {
    const k = mesSelecionado();
    const mesKey = k || M.mesAtualKey;
    const m = M.byMonth[mesKey];
    const prev = mesAnteriorDe(mesKey);
    if (!m) { main.innerHTML = card('Saídas', '<p class="note">Sem dados no período.</p>'); return; }

    const txs = m.txs.filter(t => t.tipo === 'Saída').sort((a, b) => b.date - a.date);
    const receita = m.receita || 0;
    const totalSai = U.sum(txs, t => t.valor);
    const porCat = {};
    txs.forEach(t => porCat[t.categoria] = (porCat[t.categoria] || 0) + t.valor);
    const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
    const diasMes = m.dias.size || 1;

    /* ---- 1. KPIs ---- */
    const kpis = `<div class="kpi-grid kpi-grid-4">
      ${kpiCard({ icon: 'bi-arrow-up-circle', label: 'Saídas em ' + U.ymLabel(mesKey), valor: U.brl(totalSai), deltaPct: prev ? U.delta(totalSai, prev.saidas) : null, invert: true })}
      ${kpiCard({ icon: 'bi-percent', label: 'Saídas ÷ faturamento', valor: receita ? U.pct(totalSai / receita * 100) : '—', sub: 'abaixo de 100% = mês no azul', invert: true, cls: receita && totalSai > receita ? 'kpi-bad' : '' })}
      ${kpiCard({ icon: 'bi-cash-stack', label: 'Maior categoria', valor: cats[0] ? U.brlShort(cats[0][1]) : '—', sub: cats[0] ? U.esc(cats[0][0]) + ' (' + (receita ? U.pct(cats[0][1] / receita * 100) : '—') + ' do faturamento)' : '' })}
      ${kpiCard({ icon: 'bi-calendar-day', label: 'Gasto médio por dia', valor: U.brl(totalSai / diasMes), sub: diasMes + ' dias com lançamentos' })}
    </div>`;

    /* ---- 2. Raio-X vs referência de gelateria ---- */
    const grupoTotais = {};
    for (const t of txs) if (t.grupo) grupoTotais[t.grupo] = (grupoTotais[t.grupo] || 0) + t.valor;
    let alertasCusto = [];
    const rowsBench = BENCH.map(b => {
      const val = U.sum(b.grupos, g => grupoTotais[g] || 0);
      const pct = receita ? val / receita * 100 : null;
      const prevVal = prev ? U.sum(b.grupos, g => U.sum(prev.txs.filter(t => t.tipo === 'Saída' && b.grupos.includes(t.grupo)), t => t.valor)) : null;
      const dPct = prevVal != null && prev.receita ? pct - (prevVal / prev.receita * 100) : null;
      let status, cls;
      if (pct == null) { status = '—'; cls = ''; }
      else if (pct > b.max) { status = 'acima da referência'; cls = 'bad'; alertasCusto.push({ b, pct, val }); }
      else if (pct < b.min && b.min > 0) { status = 'abaixo'; cls = 'good'; }
      else { status = 'dentro'; cls = 'ok'; }
      return `<tr>
        <td><strong>${b.nome}</strong></td>
        <td class="mono right">${U.brl(val)}</td>
        <td class="mono right"><strong>${pct != null ? U.pct(pct) : '—'}</strong>${dPct != null ? ` <span class="dim">(${dPct >= 0 ? '+' : ''}${U.pct(dPct)} vs mês ant.)</span>` : ''}</td>
        <td class="mono right dim">${b.min}–${b.max}%</td>
        <td><span class="badge ${cls}">${status}</span></td>
      </tr>`;
    }).join('');
    const semGrupo = totalSai - U.sum(Object.values(grupoTotais));
    const financ = grupoTotais['financiamento'] || 0;

    const raioX = card('Raio-X: cada grupo vs referência de gelateria (% do faturamento do mês)', `
      <div class="table-wrap"><table>
        <thead><tr><th>Grupo</th><th class="right">Gasto no mês</th><th class="right">% faturamento</th><th class="right">Referência</th><th>Status</th></tr></thead>
        <tbody>${rowsBench}</tbody></table></div>
      <p class="note">Referências típicas de gelateria artesanal / food service no Brasil — use como bússola, não como lei: mês parcial ou compra grande de estoque distorce o % momentaneamente. ${financ ? 'Financiamentos (Tortelli/Celso) somam ' + U.brl(financ) + ' e ficam fora das referências por serem investimento.' : ''} ${semGrupo > 0 ? 'Outras saídas não classificadas: ' + U.brl(semGrupo - financ > 0 ? semGrupo - financ : 0) + '.' : ''}</p>`);

    /* ---- 3. O que está destoando ---- */
    let destoando = alertasCusto.map(a => `
      <div class="alerta warn"><i class="bi bi-exclamation-triangle"></i><div>
        <strong>${a.b.nome}: ${U.pct(a.pct)} do faturamento (referência: até ${a.b.max}%)</strong>
        <p>${sugestaoCusto(a.b.id, a)}</p></div></div>`);
    // categorias com salto vs mês anterior
    if (prev) {
      for (const [cat, v] of cats) {
        const antes = prev.cats[cat]?.sai || 0;
        if (antes > 200 && v > antes * 1.4 && v - antes > 400) {
          destoando.push(`<div class="alerta warn"><i class="bi bi-graph-up-arrow"></i><div>
            <strong>"${U.esc(cat)}" saltou ${U.pct((v / antes - 1) * 100)}</strong>
            <p>${U.brl(antes)} → ${U.brl(v)} (${U.ymLabel(prev.mes)} → ${U.ymLabel(mesKey)}). Vale abrir os lançamentos abaixo e entender o que puxou.</p></div></div>`);
        }
      }
    }
    if (!destoando.length) destoando = ['<div class="alerta ok"><i class="bi bi-check-circle"></i><div><strong>Nenhum grupo fora da referência</strong><p>Estrutura de custos saudável para o faturamento do mês.</p></div></div>'];

    /* ---- 4b. Saídas fixas previstas do mês (recorrentes com dia típico) ---- */
    // Regra: matéria-prima em boleto varia demais (sabor, prazo, valor) e já entra
    // na aba Boletos com data exata — fica FORA daqui. Exceção: compras semanais
    // constantes e obrigatórias (creme de leite, leite, água), que são previsíveis.
    const cmvEssencial = /creme de leite|^leite|^agua|^\u00e1gua|^aguas|^\u00e1guas/i;
    const fixasPrev = (M.recorrentes || []).filter(r =>
      r.valorMedio >= 150 &&
      (r.grupo !== 'cmv' || cmvEssencial.test(U.norm(r.desc)))
    );
    const totalFixasMes = U.sum(fixasPrev, r => r.valorMedio);
    // agrupa por período do mês
    const faixasFix = [
      { nome: 'Início do mês (dias 1–10)', min: 1, max: 10, itens: [] },
      { nome: 'Meio do mês (dias 11–20)', min: 11, max: 20, itens: [] },
      { nome: 'Fim do mês (dias 21–31)', min: 21, max: 31, itens: [] },
    ];
    for (const r of fixasPrev) { const f = faixasFix.find(f => r.diaMes >= f.min && r.diaMes <= f.max); if (f) f.itens.push(r); }
    const totalGeral = totalFixasMes || 1;
    const gruposLabel = { financiamento: 'Financiamento', fixos: 'Fixo', folha: 'Folha', impostos: 'Imposto', marketing: 'Marketing', cmv: 'Matéria-prima', outros: 'Outro' };

    const cardFixas = card('Saídas fixas previstas do mês — planejamento', `
      <p class="note" style="margin-top:0">Compromissos que se repetem todo mês, detectados automaticamente dos seus dados, organizados por quando saem. Total fixo mensal estimado: <strong>${U.brl(totalFixasMes)}</strong>.</p>
      ${faixasFix.map(f => {
        const tot = U.sum(f.itens, r => r.valorMedio);
        if (!f.itens.length) return '';
        const pct = tot / totalGeral * 100;
        const cor = pct > 40 ? 'var(--berry)' : pct > 30 ? 'var(--gold)' : 'var(--teal)';
        return `<div class="fix-faixa">
          <div class="fix-faixa-head"><strong>${f.nome}</strong><span class="mono">${U.brl(tot)} <span class="dim">(${U.pct(pct, 0)})</span></span></div>
          <div class="antec-track" style="margin:4px 0 8px"><div class="antec-fill" style="width:${pct.toFixed(1)}%;background:${cor}"></div></div>
          <div class="table-wrap"><table><tbody>${f.itens.sort((a, b) => a.diaMes - b.diaMes).map(r => `<tr>
            <td class="mono" style="width:64px">dia ~${r.diaMes}</td>
            <td>${U.esc(r.desc)} <span class="chip">${gruposLabel[r.grupo] || r.grupo}</span></td>
            <td class="mono right"><strong>${U.brl(r.valorMedio)}</strong></td>
          </tr>`).join('')}</tbody></table></div>
        </div>`;
      }).join('')}
      <p class="note">${faixasFix[0].itens.length && U.sum(faixasFix[0].itens, r => r.valorMedio) > totalGeral * 0.4 ? '<i class="bi bi-exclamation-triangle warn-text"></i> A <strong>primeira quinzena concentra o grosso dos custos fixos</strong> — entre o mês com caixa reforçado até o dia 10.' : 'Os custos fixos estão distribuídos ao longo do mês.'} Aqui ficam só os gastos <strong>previsíveis e constantes</strong> (incluindo as compras semanais de creme de leite, leite e água). Os boletos de matéria-prima variam muito de valor e prazo (15/30/45 dias) conforme o sabor, então aparecem na aba <strong>Boletos</strong> com a data exata de cada um.</p>`);

    /* ---- 4. Gastos recorrentes (assinaturas e compromissos) ---- */
    const recorr = {};
    for (const t of M.txs.filter(t => t.tipo === 'Saída')) {
      const kd = U.norm(t.desc).replace(/\d+/g, '').trim();
      if (!kd) continue;
      const r = recorr[kd] || (recorr[kd] = { desc: t.desc, meses: new Set(), total: 0, cat: t.categoria });
      r.meses.add(t.mes); r.total += t.valor;
    }
    const recorrentes = Object.values(recorr)
      .filter(r => r.meses.size >= 3)
      .map(r => ({ ...r, media: r.total / r.meses.size }))
      .sort((a, b) => b.media - a.media).slice(0, 12);
    const rowsRec = recorrentes.map(r => `<tr>
      <td>${U.esc(r.desc)} <span class="chip">${U.esc(r.cat)}</span></td>
      <td class="mono right">${r.meses.size} meses</td>
      <td class="mono right"><strong>${U.brl(r.media)}</strong>/mês</td>
      <td class="mono right dim">${U.brl(r.media * 12)}/ano</td></tr>`).join('');

    /* ---- 5. Maiores saídas individuais ---- */
    const topTx = txs.slice().sort((a, b) => b.valor - a.valor).slice(0, 8);
    const rowsTop = topTx.map(t => `<tr><td class="mono">${U.fmtDate(t.date)}</td><td>${U.esc(t.desc)}</td><td><span class="chip">${U.esc(t.categoria)}</span></td><td class="mono right neg">${U.brl(t.valor)}</td></tr>`).join('');

    /* ---- monta a tela ---- */
    main.innerHTML = `
      ${kpis}
      ${raioX}
      ${card('O que está destoando', `<div class="alerta-list">${destoando.join('')}</div>`)}
      ${cardFixas}
      <div class="grid-2">
        ${card('Saídas por categoria — ' + U.ymLabel(mesKey), '<div class="chart-box tall"><canvas id="ch-sd-cat"></canvas></div>')}
        ${card('Evolução dos 5 maiores grupos', '<div class="chart-box tall"><canvas id="ch-sd-evo"></canvas></div>')}
      </div>
      ${card('Gastos recorrentes (aparecem em 3+ meses)', recorrentes.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Descrição</th><th class="right">Frequência</th><th class="right">Média</th><th class="right">Projeção anual</th></tr></thead>
        <tbody>${rowsRec}</tbody></table></div>
        <p class="note">Compromissos que se repetem todo mês — o melhor lugar para caçar redução de custo fixo: renegociar, trocar de fornecedor ou cancelar o que não usa mais.</p>` : '<p class="note">Nenhum gasto recorrente identificado ainda.</p>')}
      ${card('Maiores saídas de ' + U.ymLabelFull(mesKey), `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="right">Valor</th></tr></thead><tbody>${rowsTop}</tbody></table></div>`)}
      ${card('Todos os lançamentos', `<input id="busca-Saída" class="input busca" type="search" placeholder="Buscar descrição ou categoria…"><div id="tx-list">${tabelaTx(txs, 200)}</div>`)}`;

    // gráficos
    const p = DB.charts.palette();
    DB.charts.barrasHoriz('ch-sd-cat', cats.slice(0, 10).map(c => c[0]), cats.slice(0, 10).map(c => c[1]), p.amarena);
    const gruposEvo = ['cmv', 'folha', 'fixos', 'custoIfood', 'impostos'];
    const nomesEvo = { cmv: 'CMV', folha: 'Folha', fixos: 'Fixos', custoIfood: 'iFood', impostos: 'Impostos' };
    DB.charts.barras('ch-sd-evo', M.meses.map(U.ymLabel), gruposEvo.map((g, i) => ({
      label: nomesEvo[g],
      data: M.meses.map(mk => U.sum(M.byMonth[mk].txs.filter(t => t.tipo === 'Saída' && t.grupo === g), t => t.valor)),
      color: p.series[i],
    })));

    $('#busca-Saída').addEventListener('input', e => {
      const q = U.norm(e.target.value);
      const f = txs.filter(t => U.norm(t.desc).includes(q) || U.norm(t.categoria).includes(q));
      $('#tx-list').innerHTML = tabelaTx(f, 200);
    });
  }

  /** Sugestões específicas por grupo estourado */
  function sugestaoCusto(id, a) {
    const dicas = {
      cmv: 'Caminhos: renegociar os 3 maiores fornecedores de matéria-prima, revisar porcionamento (o custo/cuba em Custo das Cubas mostra os sabores caros), medir perdas/quebras e priorizar na vitrine sabores de maior margem.',
      folha: 'Compare a escala com o movimento real: os dados da maquininha mostram que sábado e domingo vendem 4–5× mais que meio de semana — concentre freelancers no fim de semana e enxugue dias fracos.',
      fixos: 'Revise os itens da tabela de gastos recorrentes abaixo: contratos de sistema, contabilidade e serviços costumam ter margem de renegociação anual.',
      ifood: 'O custo do canal está pesado para o faturamento. Avalie repassar parte da taxa no preço do cardápio iFood ou incentivar retirada/balcão (o cruzamento em Getnet mostra a economia por venda migrada).',
      marketing: 'Gasto acima da faixa: confira o ROI na aba Marketing e concentre verba nas campanhas com retorno comprovado.',
      impostos: 'Acima da faixa típica do Simples para o setor — vale uma conversa com a contabilidade sobre enquadramento e créditos.',
    };
    return dicas[id] || 'Analise os lançamentos da categoria para entender o que puxou o gasto.';
  }

  function viewBoletos(main) {
    const hoje = new Date();
    const fut = M.boletosFuturos.slice().sort((a, b) => a.venc - b.venc);
    const meses = Object.keys(M.boletosPorMes).sort();
    const seteDias = new Date(hoje); seteDias.setDate(hoje.getDate() + 7);
    const urgentes = fut.filter(b => b.venc <= seteDias);

    const rows = fut.map(b => {
      const diff = Math.ceil((b.venc - hoje) / 86400000);
      const cls = diff <= 3 ? 'bad' : diff <= 7 ? 'warn' : '';
      return `<tr><td class="mono">${U.fmtDate(b.venc)}</td><td>${U.esc(b.desc)}</td><td><span class="badge ${cls}">${diff} dia(s)</span></td><td class="mono right">${U.brl(b.valor)}</td></tr>`;
    }).join('');

    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-receipt', label: 'Total a vencer', valor: U.brl(U.sum(fut, b => b.valor)), sub: fut.length + ' boletos' })}
        ${kpiCard({ icon: 'bi-alarm', label: 'Vencem em 7 dias', valor: U.brl(U.sum(urgentes, b => b.valor)), sub: urgentes.length + ' boletos', cls: urgentes.length ? 'kpi-warn' : '' })}
        ${kpiCard({ icon: 'bi-calendar3', label: 'Próximo vencimento', valor: fut[0] ? U.fmtDate(fut[0].venc) : '—', sub: fut[0] ? U.esc(fut[0].desc) : '' })}
        ${kpiCard({ icon: 'bi-safe', label: 'Saldo atual', valor: U.brl(M.kpi.saldoAtual) })}
      </div>
      ${card('Boletos por mês', '<div class="chart-box"><canvas id="ch-bol"></canvas></div>')}
      ${card('Próximos vencimentos', `<div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Fornecedor / descrição</th><th>Prazo</th><th class="right">Valor</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Nenhum boleto futuro encontrado.</td></tr>'}</tbody></table></div>`)}`;

    DB.charts.barras('ch-bol', meses.map(U.ymLabel),
      [{ label: 'Boletos', data: meses.map(k => U.sum(M.boletosPorMes[k], b => b.valor)), color: DB.charts.palette().gold }]);
  }

  function viewEstoque(main) {
    if (!INV) { main.innerHTML = card('Estoque', '<p class="note">Nenhuma aba de estoque reconhecida na planilha.</p>'); return; }
    const kpis = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-box-seam', label: 'Itens cadastrados', valor: String(INV.totalItens) })}
        ${kpiCard({ icon: 'bi-x-octagon', label: 'Itens zerados', valor: String(INV.zerados.length), cls: INV.zerados.length ? 'kpi-bad' : '' })}
        ${kpiCard({ icon: 'bi-exclamation-triangle', label: `Estoque baixo (≤ ${INV.LIMITE_BAIXO})`, valor: String(INV.baixos.length), cls: INV.baixos.length ? 'kpi-warn' : '' })}
        ${kpiCard({ icon: 'bi-tags', label: 'Categorias', valor: String(INV.categorias.length) })}
      </div>`;

    const blocos = INV.categorias.map(c => {
      const rows = c.itens.slice().sort((a, b) => (a.qt ?? 99) - (b.qt ?? 99)).map(i => {
        const badge = i.qt == null ? `<span class="chip">${U.esc(i.qtTexto || '—')}</span>`
          : i.qt === 0 ? '<span class="badge bad">zerado</span>'
          : i.qt <= INV.LIMITE_BAIXO ? `<span class="badge warn">${i.qt}</span>`
          : `<span class="badge ok">${i.qt}</span>`;
        return `<tr><td>${U.esc(i.item)}</td><td>${badge}</td><td class="dim">${U.esc(i.obs)}</td></tr>`;
      }).join('');
      return card(`${U.esc(c.categoria)} <span class="dim">· ${c.itens.length} itens</span>`,
        `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Qtde</th><th>Obs</th></tr></thead><tbody>${rows}</tbody></table></div>`);
    }).join('');

    main.innerHTML = kpis +
      card('Sobre o valor financeiro do estoque', `<p class="note">A aba de estoque registra <strong>quantidades</strong>, não preços. Para o dashboard calcular capital parado e valor total do estoque, basta adicionar uma coluna <strong>Preço</strong> ao lado de cada bloco na planilha — o leitor já está preparado para evoluir.</p>`) +
      `<div class="grid-2">${blocos}</div>`;
  }

  function viewIfood(main) {
    const meses = M.meses;
    const dados = meses.map(k => M.byMonth[k]);
    const m = dadosMes() || M.cur;
    const taxaPct = m && m.vendasIfood ? (m.custoIfood / m.vendasIfood) * 100 : null;
    const share = m && m.receita ? (m.vendasIfood / m.receita) * 100 : null;

    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-shop', label: 'Venda balcão', valor: U.brl(m?.vendasBalcao) })}
        ${kpiCard({ icon: 'bi-phone', label: 'Venda iFood', valor: U.brl(m?.vendasIfood), sub: share != null ? U.pct(share) + ' do faturamento' : '' })}
        ${kpiCard({ icon: 'bi-bicycle', label: 'Custos do canal (motoboy/taxas)', valor: U.brl(m?.custoIfood), invert: true })}
        ${kpiCard({ icon: 'bi-cash-coin', label: 'iFood líquido', valor: U.brl(m ? m.vendasIfood - m.custoIfood : null), sub: taxaPct != null ? 'custo de ' + U.pct(taxaPct) + ' s/ receita iFood' : '' })}
      </div>
      ${card('Balcão × iFood por mês', '<div class="chart-box tall"><canvas id="ch-if"></canvas></div>')}
      ${card('Qual canal é mais rentável?', `<p class="note">${
        taxaPct == null ? 'Sem dados suficientes do canal iFood no período.' :
        `No balcão a receita chega integral; no iFood os custos diretos lançados (motoboy e taxas) consomem <strong>${U.pct(taxaPct)}</strong> da receita do canal. ` +
        `Cada R$ 100 vendidos no iFood viram ~<strong>${U.brl(100 - taxaPct)}</strong> antes do CMV. O balcão segue sendo o canal mais rentável; o iFood agrega volume e alcance.`
      }</p>`)}`;

    const p = DB.charts.palette();
    DB.charts.barras('ch-if', meses.map(U.ymLabel), [
      { label: 'Balcão', data: dados.map(d => d.vendasBalcao), color: p.pistache },
      { label: 'iFood', data: dados.map(d => d.vendasIfood), color: p.amarena },
      { label: 'Custos iFood', data: dados.map(d => -d.custoIfood), color: p.gold },
    ]);
  }

  function viewFuncionarios(main) {
    const meses = M.meses;
    const m = dadosMes() || M.cur;
    const folhaSal = m ? U.sum(m.txs.filter(t => U.norm(t.categoria).includes('salario') && t.tipo === 'Saída'), t => t.valor) : 0;
    const folhaFree = m ? U.sum(m.txs.filter(t => U.norm(t.categoria).includes('freelancer') && t.tipo === 'Saída'), t => t.valor) : 0;

    /* --- Escala × Movimento: receita média por dia da semana (planilha) --- */
    const NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const porDia = {};
    for (const t of M.txs) {
      if (t.tipo !== 'Entrada' || (t.grupo !== 'receitaBalcao' && t.grupo !== 'receitaIfood')) continue;
      const k = t.date.toDateString();
      porDia[k] = porDia[k] || { dow: t.date.getDay(), v: 0 };
      porDia[k].v += t.valor;
    }
    const dias = Object.values(porDia);
    const mediaDow = Array.from({ length: 7 }, (_, d) => {
      const ds = dias.filter(x => x.dow === d);
      return ds.length ? U.avg(ds.map(x => x.v)) : 0;
    });
    const receitaSemana = U.sum(mediaDow);

    // configuração da escala (persistida no navegador)
    let esc;
    try { esc = JSON.parse(localStorage.getItem('db_escala') || 'null'); } catch { esc = null; }
    if (!esc || !Array.isArray(esc.equipe) || esc.equipe.length !== 7) {
      esc = { diaria: 120, equipe: [3, 1, 1, 1, 1, 2, 3] }; // Dom..Sáb
    }
    const totalFreelaDias = U.sum(esc.equipe);
    // sugestão: distribui os mesmos freelancer-dias proporcionalmente à receita
    const sugestao = mediaDow.map(v => receitaSemana ? Math.max(0, Math.round(totalFreelaDias * v / receitaSemana)) : 0);

    const rowsEscala = NOMES.map((n, d) => {
      const custo = esc.equipe[d] * esc.diaria;
      const pct = mediaDow[d] ? custo / mediaDow[d] * 100 : null;
      const cls = pct == null ? '' : pct > 25 ? 'bad' : pct > 15 ? 'warn' : 'ok';
      return `<tr>
        <td><strong>${n}</strong></td>
        <td class="mono right">${U.brl(mediaDow[d])}</td>
        <td class="right"><input type="number" min="0" max="15" class="input esc-qtd" data-d="${d}" value="${esc.equipe[d]}" style="width:70px;padding:6px 8px;text-align:center"></td>
        <td class="mono right">${U.brl(custo)}</td>
        <td class="right"><span class="badge ${cls}">${pct != null ? U.pct(pct) : '—'}</span></td>
        <td class="mono right dim">${sugestao[d]}</td>
      </tr>`;
    }).join('');

    const custoSemana = totalFreelaDias * esc.diaria;

    /* --- PLANEJADOR DA SEMANA: previsão de vendas → escala e produção --- */
    // parâmetros da equipe (persistidos): quadro fixo de Mauricio = 3 atendimento + 1 gerente + 1 produção
    let eq;
    try { eq = JSON.parse(localStorage.getItem('db_equipe') || 'null'); } catch { eq = null; }
    if (!eq) eq = { atendentes: 3, capacidade: 1800, disponiveis: [2, 3, 3, 3, 3, 3, 3] }; // dom..sáb (dom: folga quinzenal)

    let planejador;
    if (!CLIMA) {
      planejador = card('Planejador da semana — escala pela previsão de vendas', `
        <p class="note">Usa a previsão dos próximos 7 dias (dia da semana × clima × calendário turístico) para dizer <strong>em que dia vale contratar freelancer</strong> e quantas cubas produzir.</p>
        <button class="side-btn" id="btn-clima-fn" style="max-width:300px;margin-top:10px"><i class="bi bi-thermometer-sun"></i> Carregar previsão da semana</button>
        <span id="clima-status" class="dim" style="margin-left:10px"></span>`);
    } else {
      const PD = CLIMA.previsaoDemanda;
      const NOMES2 = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      let totFreelas = 0, totCusto = 0;
      const rowsPlan = PD.map(p => {
        const dow = p.data.getDay();
        const necessarios = Math.max(1, Math.ceil(p.estimativa / Math.max(1, eq.capacidade)));
        const disponiveis = eq.disponiveis[dow];
        const freelas = Math.max(0, necessarios - disponiveis);
        const custo = freelas * esc.diaria;
        totFreelas += freelas; totCusto += custo;
        const ctxChip = p.ctx.contexto !== 'normal' ? `<span class="chip">${U.esc(p.ctx.nome || p.ctx.contexto)}</span>` : '';
        return `<tr>
          <td><strong>${NOMES2[dow]}</strong> <span class="dim">${U.fmtDate(p.data)}</span> ${ctxChip}</td>
          <td class="mono">${Math.round(p.tmax)}° ${p.chove ? '<i class="bi bi-cloud-rain warn-text"></i>' : ''}</td>
          <td class="mono right">${U.brl(p.estimativa)}</td>
          <td class="mono right">${necessarios}</td>
          <td class="right"><input type="number" min="0" max="6" class="input eq-disp" data-d="${dow}" value="${disponiveis}" style="width:64px;padding:5px 6px;text-align:center"></td>
          <td class="right">${freelas > 0 ? `<span class="badge warn"><i class="bi bi-person-plus"></i> ${freelas} freela${freelas > 1 ? 's' : ''}</span>` : '<span class="badge ok">equipe dá conta</span>'}</td>
          <td class="mono right">${freelas ? U.brl(custo) : '—'}</td>
        </tr>`;
      }).join('');

      const receitaPrevista = U.sum(PD, p => p.estimativa);
      // produção sugerida: preço médio por grama dos produtos vendidos → receita por cuba de 8 kg
      let cubasTxt = '';
      if (CUBAS && CUBAS.produtos.length) {
        const precoPorG = U.avg(CUBAS.produtos.map(pr => pr.preco / pr.gramas));
        const receitaPorCuba = precoPorG * 8000;
        const cubas = receitaPrevista / receitaPorCuba;
        cubasTxt = `<p class="note"><strong>Produção sugerida:</strong> ~${Math.ceil(cubas)} cubas de 8 L na semana (receita prevista de ${U.brl(receitaPrevista)} ÷ ~${U.brl(receitaPorCuba)} de venda por cuba). Priorize os 8 fixos e escolha os rotativos pela margem em Custo das Cubas.</p>`;
      }

      planejador = card('Planejador da semana — escala pela previsão de vendas', `
        <div class="cuba-toggle" style="margin-bottom:12px">
          <label class="dim">Venda que 1 atendente dá conta/dia:</label>
          <input type="number" id="eq-cap" class="input" min="500" step="100" value="${eq.capacidade}" style="width:110px;padding:6px 10px">
          <span class="dim" style="margin-left:auto">semana prevista: <strong>${U.brl(receitaPrevista)}</strong> · freelancers sugeridos: <strong>${totFreelas}</strong> (${U.brl(totCusto)}${receitaPrevista ? ' = ' + U.pct(totCusto / receitaPrevista * 100) : ''})</span>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Dia</th><th>Clima</th><th class="right">Venda prevista</th><th class="right">Atend. necessários</th><th class="right">Fixos no dia</th><th class="right">Reforço</th><th class="right">Custo</th></tr></thead>
          <tbody>${rowsPlan}</tbody></table></div>
        ${cubasTxt}
        <p class="note">Quadro fixo: 3 atendentes + 1 gerente + 1 produção. Ajuste <strong>"Fixos no dia"</strong> conforme as folgas da semana (ex.: domingo de folga quinzenal → 2). Quando você enviar a escala de folgas, esse campo passa a preencher sozinho. "Atendentes necessários" = venda prevista ÷ capacidade por pessoa — calibre a capacidade observando um sábado cheio.</p>`);
    }

    const escalaCard = card('Escala × Movimento — simulador pela média histórica', `
      <div class="cuba-toggle" style="margin-bottom:12px">
        <label class="dim">Diária média do freelancer:</label>
        <input type="number" id="esc-diaria" class="input" min="0" step="10" value="${esc.diaria}" style="width:110px;padding:6px 10px">
        <span class="dim" style="margin-left:auto">custo semanal simulado: <strong>${U.brl(custoSemana)}</strong> (${receitaSemana ? U.pct(custoSemana / receitaSemana * 100) : '—'} da receita típica da semana)</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Dia</th><th class="right">Receita média</th><th class="right">Freelancers</th><th class="right">Custo do dia</th><th class="right">Custo ÷ receita</th><th class="right">Sugerido*</th></tr></thead>
        <tbody>${rowsEscala}</tbody></table></div>
      <p class="note">Edite os números e o cálculo atualiza na hora (a configuração fica salva neste navegador). Verde ≤ 15% da receita do dia, amarelo até 25%, vermelho acima. *Sugerido = os mesmos ${totalFreelaDias} freelancer-dias da semana redistribuídos na proporção do movimento real — domingo vende ${mediaDow[3] ? (mediaDow[0] / mediaDow[3]).toFixed(1) : '—'}× a quarta.</p>`);

    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-people', label: 'Folha total do mês', valor: U.brl(m?.folha), sub: m ? U.ymLabel(m.mes) : '' })}
        ${kpiCard({ icon: 'bi-person-badge', label: 'Salários', valor: U.brl(folhaSal) })}
        ${kpiCard({ icon: 'bi-person-plus', label: 'Freelancers', valor: U.brl(folhaFree) })}
        ${kpiCard({ icon: 'bi-percent', label: 'Peso sobre faturamento', valor: m?.folhaPct != null ? U.pct(m.folhaPct) : '—', invert: true, cls: m && m.folhaPct > 30 ? 'kpi-warn' : '' })}
      </div>
      ${planejador}
      ${card('Receita média por dia da semana (histórico completo)', '<div class="chart-box"><canvas id="ch-fn-dow"></canvas></div>')}
      ${escalaCard}
      ${card('Folha × faturamento por mês', '<div class="chart-box tall"><canvas id="ch-folha"></canvas></div>')}
      ${card('Leitura', `<p class="note">Como referência de mercado para food service, a folha saudável fica entre 20% e 30% do faturamento. O simulador acima olha só a parte flexível (freelancers): concentre-os nos dias de pico e enxugue os dias fracos — a coluna "Sugerido" mostra a redistribuição proporcional ao movimento.</p>`)}`;

    const p = DB.charts.palette();
    DB.charts.barras('ch-fn-dow', NOMES, [{ label: 'Receita média/dia', data: mediaDow, color: p.pistache }]);
    DB.charts.barras('ch-folha', meses.map(U.ymLabel), [
      { label: 'Faturamento', data: meses.map(k => M.byMonth[k].receita), color: p.pistache },
      { label: 'Folha', data: meses.map(k => M.byMonth[k].folha), color: p.purple },
    ]);

    // interações do planejador
    const salvarEq = () => { localStorage.setItem('db_equipe', JSON.stringify(eq)); render(); };
    const btnClimaFn = $('#btn-clima-fn');
    if (btnClimaFn) btnClimaFn.addEventListener('click', carregarClima);
    const capInp = $('#eq-cap');
    if (capInp) capInp.addEventListener('change', e => { eq.capacidade = Math.max(500, +e.target.value || 1800); salvarEq(); });
    $$('.eq-disp').forEach(inp => inp.addEventListener('change', e => {
      eq.disponiveis[+e.target.dataset.d] = Math.max(0, Math.min(6, +e.target.value || 0));
      salvarEq();
    }));

    // interações do simulador
    const salvarEsc = () => { localStorage.setItem('db_escala', JSON.stringify(esc)); render(); };
    $('#esc-diaria').addEventListener('change', e => { esc.diaria = Math.max(0, +e.target.value || 0); salvarEsc(); });
    $$('.esc-qtd').forEach(inp => inp.addEventListener('change', e => {
      esc.equipe[+e.target.dataset.d] = Math.max(0, Math.min(15, +e.target.value || 0));
      salvarEsc();
    }));
  }

  function viewMarketing(main) {
    const meses = M.meses;
    const m = dadosMes() || M.cur;
    const prev = m ? mesAnteriorDe(m.mes) : null;
    const roi = m && prev && m.marketing > 0 ? ((m.receita - prev.receita - m.marketing) / m.marketing) * 100 : null;

    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-megaphone', label: 'Investimento no mês', valor: U.brl(m?.marketing) })}
        ${kpiCard({ icon: 'bi-graph-up-arrow', label: 'Variação de receita', valor: prev ? U.brl(m.receita - prev.receita) : '—', sub: prev ? 'vs ' + U.ymLabel(prev.mes) : '' })}
        ${kpiCard({ icon: 'bi-cash-coin', label: 'ROI aproximado', valor: roi != null ? U.pct(roi) : '—', cls: roi != null && roi < 0 ? 'kpi-warn' : '' })}
        ${kpiCard({ icon: 'bi-coin', label: 'Total investido (todos os meses)', valor: U.brl(U.sum(meses, k => M.byMonth[k].marketing)) })}
      </div>
      ${card('Marketing × receita por mês', '<div class="chart-box tall"><canvas id="ch-mkt"></canvas></div>')}
      ${card('Sugestões automáticas', `<ul class="note-list">
          <li>O ROI acima é indicativo: compara a variação de receita com o gasto do mês. Para medir campanha a campanha, registre a campanha no campo <strong>Obs</strong> do lançamento de marketing.</li>
          <li>Concentre verba nos dias/semana de maior conversão histórica (veja a venda média diária no Dashboard).</li>
          <li>Tráfego para o balcão tende a render mais que para o iFood, que perde ${m && m.vendasIfood ? U.pct((m.custoIfood / m.vendasIfood) * 100) : '~15–25%'} em custos de canal.</li>
        </ul>`)}`;

    const p = DB.charts.palette();
    DB.charts.barras('ch-mkt', meses.map(U.ymLabel), [
      { label: 'Receita', data: meses.map(k => M.byMonth[k].receita), color: p.pistache },
      { label: 'Marketing', data: meses.map(k => M.byMonth[k].marketing), color: p.blue },
    ]);
  }

  function viewComparativos(main) {
    const meses = M.meses;
    const rows = meses.slice().reverse().map(k => {
      const m = M.byMonth[k];
      const prev = mesAnteriorDe(k);
      const d = prev ? U.delta(m.receita, prev.receita) : null;
      return `<tr>
        <td><strong>${U.ymLabel(k)}</strong></td>
        <td class="mono">${U.brl(m.receita)}</td>
        <td class="mono">${d != null ? `<span class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${U.pct(d)}</span>` : '—'}</td>
        <td class="mono">${U.brl(m.saidas)}</td>
        <td class="mono ${m.saldo >= 0 ? 'pos' : 'neg'}">${U.brl(m.saldo)}</td>
        <td class="mono">${m.cmvPct != null ? U.pct(m.cmvPct) : '—'}</td>
        <td class="mono">${m.margem != null ? U.pct(m.margem) : '—'}</td>
        <td class="mono">${U.brl(m.vendaMediaDia)}</td>
      </tr>`;
    }).join('');

    main.innerHTML = `
      ${card('Evolução mensal', '<div class="chart-box tall"><canvas id="ch-comp"></canvas></div>')}
      ${card('Mês a mês', `<div class="table-wrap"><table>
        <thead><tr><th>Mês</th><th>Receita</th><th>Δ receita</th><th>Saídas</th><th>Saldo</th><th>CMV</th><th>Margem</th><th>Venda média/dia</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="note">O mês em andamento aparece parcial — compare pelo indicador <strong>venda média/dia</strong>, que neutraliza o efeito de mês incompleto.</p>`)}`;

    const p = DB.charts.palette();
    DB.charts.barras('ch-comp', meses.map(U.ymLabel), [
      { label: 'Receita', data: meses.map(k => M.byMonth[k].receita), color: p.pistache },
      { label: 'Saídas', data: meses.map(k => M.byMonth[k].saidas), color: p.amarena },
      { label: 'Saldo', data: meses.map(k => M.byMonth[k].saldo), color: p.gold },
    ]);
  }

  /* ---------- CUBAS & SABORES ---------- */

  let cubaMl = 8000;        // cuba selecionada (4000 | 8000)
  let cubaSabor = null;     // sabor selecionado p/ tabela de produtos

  function viewCubas(main) {
    if (!CUBAS) {
      main.innerHTML = card('Custo das Cubas', `
        <p class="note">A aba <strong>Valor_Cuba</strong> não foi encontrada na planilha carregada.</p>
        <p class="note">Você pode: (a) copiar a aba Valor_Cuba para dentro da planilha principal
        (no Excel: botão direito na aba → <em>Mover ou Copiar</em> → marcar <em>Criar uma cópia</em>), ou
        (b) carregar o arquivo de cubas separadamente aqui:</p>
        <button class="side-btn" id="btn-upload-cubas" style="max-width:280px"><i class="bi bi-file-earmark-arrow-up"></i> Carregar Valor_da_Cuba.xlsx</button>`);
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.xlsx'; inp.hidden = true;
      main.appendChild(inp);
      $('#btn-upload-cubas').addEventListener('click', () => inp.click());
      inp.addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = ev => {
          const cb = DB.excel.cubasFromArrayBuffer(ev.target.result);
          if (!cb) { alert('Não encontrei a estrutura de receitas nesse arquivo.'); return; }
          RAW.cubas = cb; CUBAS = DB.cubas.build(cb); render();
        };
        r.readAsArrayBuffer(f);
      });
      return;
    }

    const sel = ml => ml === cubaMl ? 'active' : '';
    if (!cubaSabor || !CUBAS.porSabor.some(s => s.sabor === cubaSabor && (cubaMl === 8000 ? s.c8000 : s.c4000).completo)) {
      cubaSabor = (CUBAS.completos[0] || CUBAS.porSabor[0])?.sabor || null;
    }

    // cards por sabor (sem expor a receita — só custos agregados)
    const cardsSabores = CUBAS.porSabor.map(s => {
      const c = cubaMl === 8000 ? s.c8000 : s.c4000;
      if (!c.completo) {
        return `<div class="kpi kpi-warn">
          <div class="kpi-top"><span class="kpi-icon"><i class="bi bi-question-circle"></i></span></div>
          <div class="kpi-valor dim">incompleto</div>
          <div class="kpi-label">${U.esc(s.sabor)}<span class="kpi-sub">falta preço: ${c.faltantes.map(U.esc).join(', ')}</span></div>
        </div>`;
      }
      return `<div class="kpi">
        <div class="kpi-top"><span class="kpi-icon"><i class="bi bi-cup-straw"></i></span>
          <span class="kpi-delta pos">${U.brl(c.custoPorKg)}/kg</span></div>
        <div class="kpi-valor">${U.brl(c.custoTotal)}</div>
        <div class="kpi-label">${U.esc(s.sabor)}<span class="kpi-sub">${(c.pesoTotalG / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg · mescla ${U.brl(c.custoMescla)}</span></div>
      </div>`;
    }).join('');

    // tabela de produtos vendidos para o sabor selecionado
    const saborObj = CUBAS.porSabor.find(s => s.sabor === cubaSabor);
    const prods = saborObj ? CUBAS.produtosDoSabor(saborObj, cubaMl) : null;
    const rowsProd = prods ? prods.map(p => `
      <tr>
        <td>${U.esc(p.nome)}</td>
        <td class="mono">${p.gramas} g</td>
        <td class="mono">${U.brl(p.custo)}</td>
        <td class="mono">${U.brl(p.preco)}</td>
        <td class="mono pos">${U.brl(p.margem)}</td>
        <td class="mono">${U.pct(p.margemPct)} <span class="dim">(CMV ${U.pct(p.cmvPct)})</span></td>
      </tr>`).join('') : '';

    const opcoesSabor = CUBAS.porSabor
      .filter(s => (cubaMl === 8000 ? s.c8000 : s.c4000).completo)
      .map(s => `<option ${s.sabor === cubaSabor ? 'selected' : ''}>${U.esc(s.sabor)}</option>`).join('');

    const pend = CUBAS.incompletos.length ? card('Preços pendentes na planilha', `
      <p class="note">Para calcular estes sabores, lance o preço da matéria-prima na tabela de valores da aba <strong>Valor_Cuba</strong> (colunas de preço e peso da embalagem):</p>
      <ul class="note-list">${CUBAS.incompletos.map(s =>
        `<li><strong>${U.esc(s.sabor)}</strong>: falta ${s.c4000.faltantes.map(U.esc).join(', ')}</li>`).join('')}</ul>`) : '';

    main.innerHTML = `
      ${card('Custo de produção por cuba', `
        <div class="cuba-toggle">
          <button class="cuba-btn ${sel(4000)}" data-ml="4000">Cuba 4.000 ml</button>
          <button class="cuba-btn ${sel(8000)}" data-ml="8000">Cuba 8.000 ml</button>
          <span class="dim cuba-hint">mescla (cobertura) tem a mesma quantidade nas duas cubas</span>
        </div>
        <div class="kpi-grid" style="margin-top:14px">${cardsSabores}</div>`)}
      ${card('Custo por cuba — comparativo dos sabores', '<div class="chart-box tall"><canvas id="ch-cubas"></canvas></div>')}
      ${card('Rentabilidade dos produtos vendidos', `
        <div class="cuba-toggle" style="margin-bottom:14px">
          <label class="dim" style="margin-right:8px">Sabor:</label>
          <select id="sel-sabor" class="input" style="max-width:280px">${opcoesSabor}</select>
        </div>
        ${prods ? `<div class="table-wrap"><table>
          <thead><tr><th>Produto</th><th>Gelato</th><th>Custo do gelato</th><th>Preço de venda</th><th>Margem</th><th>Margem %</th></tr></thead>
          <tbody>${rowsProd}</tbody></table></div>
          <p class="note">Custo do gelato = gramas do produto × custo/kg do sabor (cuba de ${cubaMl.toLocaleString('pt-BR')} ml). Não inclui casquinha/copo/colher — quando quiser, adicionamos esses custos de embalagem por produto.</p>`
          : '<p class="note">Nenhum sabor com custo completo para calcular.</p>'}`)}
      ${pend}`;

    // interações
    $$('.cuba-btn').forEach(b => b.addEventListener('click', () => { cubaMl = +b.dataset.ml; render(); }));
    const selS = $('#sel-sabor');
    if (selS) selS.addEventListener('change', () => { cubaSabor = selS.value; render(); });

    // gráfico comparativo
    const comp = CUBAS.porSabor.filter(s => s.c4000.completo);
    const p = DB.charts.palette();
    DB.charts.barras('ch-cubas', comp.map(s => s.sabor), [
      { label: 'Cuba 4.000 ml', data: comp.map(s => s.c4000.custoTotal), color: p.pistache },
      { label: 'Cuba 8.000 ml', data: comp.map(s => s.c8000.custoTotal), color: p.amarena },
    ]);
  }

  /* ---------- CARTÕES (GETNET) ---------- */

  async function processarPdfsGetnet(files) {
    const status = $('#getnet-status');
    if (status) status.textContent = 'Lendo arquivo(s)…';
    try {
      let novo = { cartoes: [], pix: [], agenda: [], resumo: {} };
      for (const f of files) {
        const buf = await f.arrayBuffer();
        const ehCsv = /\.csv$/i.test(f.name);
        const p = ehCsv
          ? DB.getnet.parsearCsv(buf)
          : DB.getnet.parsearLinhas(await DB.getnet.extrairLinhas(buf));
        novo.cartoes.push(...p.cartoes);
        novo.pix.push(...p.pix);
        if (p.agenda.length) { novo.agenda = p.agenda; novo.resumo = Object.assign(novo.resumo, p.resumo); }
      }
      if (!novo.cartoes.length && !novo.agenda.length && !novo.pix.length) {
        alert('Não reconheci os dados nesses arquivos. Use os CSVs "extrato_consolidado_cartao", "extrato_consolidado_pix" e "AgendaFinanceiraSimplificada" (ou os PDFs equivalentes) do portal Getnet.');
        if (status) status.textContent = '';
        return;
      }
      GETNET = DB.getnet.mesclar(GETNET, novo);
      DB.getnet.salvar(GETNET);
      GAN = DB.getnet.analisar(GETNET, M);
      render();
    } catch (err) {
      console.error(err);
      alert('Erro ao ler o arquivo: ' + err.message);
      if (status) status.textContent = '';
    }
  }

  function viewGetnet(main) {
    const uploader = `
      <div class="cuba-toggle" style="margin-bottom:4px">
        <button class="side-btn" id="btn-getnet-up" style="max-width:340px"><i class="bi bi-file-earmark-arrow-up"></i> Carregar arquivos da Getnet (CSV ou PDF)</button>
        ${GETNET ? `<button class="side-btn" id="btn-getnet-pub" style="max-width:330px"><i class="bi bi-cloud-arrow-up"></i> Baixar arquivo para publicar no GitHub</button>` : ''}
        <span id="getnet-status" class="dim"></span>
        ${GETNET ? `<button class="side-btn" id="btn-getnet-clear" style="max-width:170px;margin-left:auto"><i class="bi bi-trash3"></i> Limpar dados</button>` : ''}
      </div>
      <p class="note dim">Aceita os <strong>CSVs</strong> do portal Getnet (extrato_consolidado_cartao, extrato_consolidado_pix e AgendaFinanceiraSimplificada) ou os <strong>PDFs</strong> equivalentes — pode arrastar todos juntos; os demais CSVs (totais, recarga, van, voucher) são ignorados sem problema. Obs.: o indicador de cessão só vem no PDF da agenda. Os dados ficam salvos neste navegador e relatórios de meses seguintes são somados automaticamente (sem duplicar).${GETNET?.atualizadoEm ? ' Última atualização: ' + GETNET.atualizadoEm.toLocaleString('pt-BR') + '.' : ''}</p>
      ${GETNET ? `<p class="note"><strong>Para os sócios verem estes dados:</strong> clique em <em>Baixar arquivo para publicar no GitHub</em> e suba o <code>getnet_dados.json</code> gerado no repositório (Add file → Upload files), igual faz com a planilha. Quem abrir o site carrega esse arquivo automaticamente.</p>` : ''}`;

    if (!GAN) {
      main.innerHTML = card('Getnet · Maquininha', uploader + '<p class="note" style="margin-top:10px">Nenhum dado carregado ainda. Baixe os dois relatórios no portal da Getnet e arraste aqui.</p>');
      ligarUploadGetnet();
      return;
    }

    const A = GAN;
    const cessaoPct = A.agendaTotal ? (A.cessao / A.agendaTotal) * 100 : null;

    const kpis = `
      <div class="kpi-grid">
        ${kpiCard({ icon: 'bi-credit-card', label: 'Vendas no cartão (período)', valor: U.brl(A.cartaoBruto), sub: A.cartaoQtd + ' transações' })}
        ${kpiCard({ icon: 'bi-percent', label: 'Taxas pagas à maquininha', valor: U.brl(A.cartaoTaxa), sub: U.pct(A.taxaMediaPct, 2) + ' em média', invert: true, cls: 'kpi-warn' })}
        ${kpiCard({ icon: 'bi-qr-code', label: 'PIX na maquininha', valor: U.brl(A.pixBruto), sub: A.pixQtd + ' transações · taxa zero' })}
        ${kpiCard({ icon: 'bi-receipt-cutoff', label: 'Ticket médio real', valor: U.brl(A.ticketGeral), sub: `cartão ${U.brl(A.ticketCartao)} · pix ${U.brl(A.ticketPix)}` })}
        ${kpiCard({ icon: 'bi-calendar-week', label: 'A receber em 7 dias', valor: U.brl(A.receber7) })}
        ${kpiCard({ icon: 'bi-calendar-month', label: 'A receber em 30 dias', valor: U.brl(A.receber30), sub: 'agenda total ' + U.brl(A.agendaTotal) })}
      </div>`;

    const alertaCessao = cessaoPct != null && cessaoPct > 50 ? `
      <div class="alerta warn"><i class="bi bi-exclamation-triangle"></i><div>
        <strong>${U.pct(cessaoPct)} da agenda está cedida (${U.brl(A.cessao)})</strong>
        <p>Só ${U.brl(A.agendaLivre)} estão livres para negociação. Cessão normalmente indica recebíveis comprometidos com antecipação ou garantia bancária — e o <em>custo</em> desse adiantamento não aparece nos relatórios da Getnet (campo Antecipação zerado). Ele é descontado no banco: quando você trouxer o extrato bancário, vamos cruzar o valor que cai na conta com o líquido da agenda e medir exatamente quanto essa antecipação custa por mês.</p>
      </div></div>` : '';

    // taxas por bandeira/modalidade
    const bandeiras = Object.entries(A.porBandeira).sort((a, b) => b[1].bruto - a[1].bruto);
    const rowsBand = bandeiras.map(([b, v]) => {
      const pct = (v.taxa / v.bruto) * 100;
      const cred = v.porMod['Crédito'], deb = v.porMod['Débito'];
      return `<tr><td><strong>${b}</strong></td>
        <td class="mono">${U.brl(v.bruto)}</td>
        <td class="mono">${U.brl(v.taxa)}</td>
        <td class="mono"><span class="badge ${pct > 2.2 ? 'bad' : pct > 1.5 ? 'warn' : 'ok'}">${U.pct(pct, 2)}</span></td>
        <td class="mono">${cred ? U.pct(cred.taxa / cred.bruto * 100, 2) : '—'}</td>
        <td class="mono">${deb ? U.pct(deb.taxa / deb.bruto * 100, 2) : '—'}</td></tr>`;
    }).join('');

    // cruzamento com a planilha
    const rowsCruz = A.cruzamento.map(c => `
      <tr><td><strong>${U.ymLabel(c.mes)}</strong>${c.parcial ? ' <span class="chip">relatório parcial</span>' : ''}</td>
        <td class="mono">${U.brl(c.planilha)}</td>
        <td class="mono">${U.brl(c.getnet)}</td>
        <td class="mono ${c.diferenca < 0 ? 'neg' : ''}">${U.brl(c.diferenca)}${!c.parcial && c.diferenca < 0 ? ' <span class="badge bad">lançamento faltando?</span>' : ''}</td></tr>`).join('');

    main.innerHTML = `
      ${card('Getnet · Maquininha', uploader)}
      ${kpis}
      ${alertaCessao}
      <div class="grid-2">
        ${card('Vendas na maquininha por mês', '<div class="chart-box"><canvas id="ch-gn-mes"></canvas></div>')}
        ${card('Venda média por dia da semana', '<div class="chart-box"><canvas id="ch-gn-dow"></canvas></div>')}
      </div>
      ${card('Taxas por bandeira', `<div class="table-wrap"><table>
        <thead><tr><th>Bandeira</th><th>Bruto</th><th>Taxas</th><th>Taxa média</th><th>Crédito</th><th>Débito</th></tr></thead>
        <tbody>${rowsBand}</tbody></table></div>
        <p class="note">Crédito custa ${U.pct(A.porMod['Crédito'] ? A.porMod['Crédito'].taxa / A.porMod['Crédito'].bruto * 100 : null, 2)} e débito ${U.pct(A.porMod['Débito'] ? A.porMod['Débito'].taxa / A.porMod['Débito'].bruto * 100 : null, 2)}. PIX na maquininha é isento — cada 1% de vendas migrando de crédito para PIX economiza ~${U.brl(A.cartaoBruto * 0.01 * (A.taxaMediaPct / 100))} no período.</p>`)}
      ${card('Agenda de recebimentos — calendário', montarCalendarioGetnet(A))}
      ${card('Próximos recebimentos, dia a dia', montarTabelaRecebimentos(A))}
      ${A.yoy && A.yoy.length ? card('Crescimento ano a ano (mesmo mês do ano anterior)', `
        <div class="table-wrap"><table>
          <thead><tr><th>Mês</th><th class="right">Este ano</th><th class="right">Ano passado</th><th class="right">Crescimento</th></tr></thead>
          <tbody>${A.yoy.map(y => `<tr>
            <td><strong>${U.ymLabel(y.mes)}</strong> <span class="dim">vs ${U.ymLabel(y.mesAnterior)}</span></td>
            <td class="mono right">${U.brl(y.atual)}</td>
            <td class="mono right">${U.brl(y.anterior)}</td>
            <td class="mono right"><span class="badge ${y.crescimento >= 0 ? 'ok' : 'bad'}">${y.crescimento >= 0 ? '+' : ''}${U.pct(y.crescimento)}</span></td>
          </tr>`).join('')}</tbody></table></div>
        <p class="note">A comparação certa para negócio sazonal: junho contra junho, não junho contra maio. Só cartão + PIX (a maquininha vê as duas épocas do mesmo jeito, então o crescimento é comparável).</p>`) : ''}
      ${A.cruzamento.length ? card('Cruzamento: planilha × maquininha', `<div class="table-wrap"><table>
        <thead><tr><th>Mês</th><th>Vendas na planilha (balcão)</th><th>Getnet (cartão + PIX)</th><th>Diferença (≈ dinheiro)</th></tr></thead>
        <tbody>${rowsCruz}</tbody></table></div>
        <p class="note">A diferença aproxima o que entrou em <strong>dinheiro vivo</strong> (ou aponta lançamento faltando, se ficar negativa). Quando o extrato do banco entrar no sistema, esse cruzamento fecha o ciclo: venda registrada → maquininha → conta bancária.</p>`) : ''}`;

    ligarUploadGetnet();
    if ($('#btn-getnet-pub')) $('#btn-getnet-pub').addEventListener('click', () => DB.getnet.exportarJson(GETNET));
    if ($('#btn-getnet-clear')) $('#btn-getnet-clear').addEventListener('click', () => {
      if (confirm('Apagar os dados da Getnet salvos neste navegador?')) { DB.getnet.limpar(); GETNET = null; GAN = null; render(); }
    });

    // gráficos
    const p = DB.charts.palette();
    const mesesG = Object.keys(A.porMes).sort();
    DB.charts.barras('ch-gn-mes', mesesG.map(U.ymLabel), [
      { label: 'Cartão', data: mesesG.map(k => A.porMes[k].bruto), color: p.pistache },
      { label: 'PIX', data: mesesG.map(k => A.porMes[k].pix), color: p.blue },
      { label: 'Taxas', data: mesesG.map(k => -A.porMes[k].taxa), color: p.amarena },
    ]);
    const nomesDias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const mediaDow = A.porDiaSemana.map(d => d.dias.size ? d.bruto / d.dias.size : 0);
    DB.charts.barras('ch-gn-dow', nomesDias, [{ label: 'Venda média/dia', data: mediaDow, color: p.gold }]);

    // navegação do calendário
    $$('.cal-nav').forEach(b => b.addEventListener('click', () => { calMesGetnet = b.dataset.mes; render(); }));
  }

  /* --- calendário de recebimentos --- */

  let calMesGetnet = null; // "2026-07"

  function mesesDoCalendario(A) {
    const set = new Set(Object.keys(A.recebPorDia).map(k => k.slice(0, 7)));
    return [...set].sort();
  }

  function montarCalendarioGetnet(A) {
    const meses = mesesDoCalendario(A);
    if (!meses.length) return '<p class="note">Sem recebimentos futuros na agenda carregada.</p>';
    if (!calMesGetnet || !meses.includes(calMesGetnet)) calMesGetnet = meses[0];
    const [y, mo] = calMesGetnet.split('-').map(Number);
    const hoje = new Date();
    const primeiroDia = new Date(y, mo - 1, 1);
    const diasNoMes = new Date(y, mo, 0).getDate();
    const inicioGrade = primeiroDia.getDay(); // 0=Dom

    const idx = meses.indexOf(calMesGetnet);
    const nav = `
      <div class="cal-head">
        <button class="cal-nav top-btn" data-mes="${meses[idx - 1] || calMesGetnet}" ${idx === 0 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i></button>
        <strong>${U.ymLabelFull(calMesGetnet)}</strong>
        <button class="cal-nav top-btn" data-mes="${meses[idx + 1] || calMesGetnet}" ${idx === meses.length - 1 ? 'disabled' : ''}><i class="bi bi-chevron-right"></i></button>
        <span class="dim" style="margin-left:auto">total do mês: <strong>${U.brl(U.sum(Object.entries(A.recebPorDia).filter(([k]) => k.startsWith(calMesGetnet)), ([, d]) => d.total))}</strong></span>
      </div>`;

    const cab = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<div class="cal-dow">${d}</div>`).join('');
    let celulas = '';
    for (let i = 0; i < inicioGrade; i++) celulas += '<div class="cal-cell vazia"></div>';
    // intensidade de cor proporcional ao maior dia do mês
    const doMes = Object.entries(A.recebPorDia).filter(([k]) => k.startsWith(calMesGetnet));
    const maxDia = Math.max(1, ...doMes.map(([, d]) => d.total));
    for (let dia = 1; dia <= diasNoMes; dia++) {
      const k = calMesGetnet + '-' + String(dia).padStart(2, '0');
      const d = A.recebPorDia[k];
      const ehHoje = hoje.getFullYear() === y && hoje.getMonth() === mo - 1 && hoje.getDate() === dia;
      if (d) {
        const alpha = 0.12 + 0.5 * (d.total / maxDia);
        const detalhe = Object.entries(d.bandeiras).map(([b, v]) => `${b}: ${U.brl(v)}`).join(' · ');
        celulas += `<div class="cal-cell com-valor ${ehHoje ? 'hoje' : ''}" style="--al:${alpha.toFixed(2)}" title="${U.esc(detalhe)}">
          <span class="cal-dia">${dia}</span><span class="cal-valor">${U.brlShort(d.total)}</span></div>`;
      } else {
        celulas += `<div class="cal-cell ${ehHoje ? 'hoje' : ''}"><span class="cal-dia">${dia}</span></div>`;
      }
    }
    return nav + `<div class="cal-grid">${cab}${celulas}</div>
      <p class="note dim">Toque/passe o mouse num dia para ver a divisão por bandeira. Dias em branco não têm repasse previsto (a Getnet consolida crédito em D+30 útil; fins de semana caem no próximo dia útil).</p>`;
  }

  function montarTabelaRecebimentos(A) {
    const dias = Object.values(A.recebPorDia).sort((a, b) => a.data - b.data);
    if (!dias.length) return '<p class="note">Sem recebimentos futuros.</p>';
    const nomesDias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    let acumulado = 0;
    const rows = dias.map(d => {
      acumulado += d.total;
      const chips = Object.entries(d.bandeiras).sort((a, b) => b[1] - a[1])
        .map(([b, v]) => `<span class="chip">${b} ${U.brlShort(v)}</span>`).join(' ');
      return `<tr>
        <td class="mono"><strong>${U.fmtDate(d.data)}</strong> <span class="dim">${nomesDias[d.data.getDay()]}</span></td>
        <td>${chips}</td>
        <td class="mono right pos"><strong>${U.brl(d.total)}</strong></td>
        <td class="mono right dim">${U.brl(acumulado)}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th>Dia</th><th>Bandeiras</th><th class="right">Valor do dia</th><th class="right">Acumulado</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function ligarUploadGetnet() {
    const btn = $('#btn-getnet-up');
    if (!btn) return;
    let inp = $('#getnet-file-input');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.pdf,.csv'; inp.multiple = true; inp.hidden = true; inp.id = 'getnet-file-input';
      document.body.appendChild(inp);
      inp.addEventListener('change', e => { if (e.target.files.length) processarPdfsGetnet([...e.target.files]); inp.value = ''; });
    }
    btn.addEventListener('click', () => inp.click());
  }

  /* ---------- BANCO (extrato OFX) ---------- */

  async function processarOfx(files) {
    const status = $('#banco-status');
    if (status) status.textContent = 'Lendo extrato…';
    try {
      let novos = [];
      for (const f of files) {
        const buf = await f.arrayBuffer();
        novos.push(...DB.banco.parseOfx(buf));
      }
      if (!novos.length) {
        alert('Não encontrei lançamentos nesse arquivo. Exporte o extrato em formato OFX pelo app do Santander Empresas.');
        if (status) status.textContent = '';
        return;
      }
      BANCO = DB.banco.mesclar(BANCO, novos);
      DB.banco.salvar(BANCO);
      BAN = DB.banco.analisar(BANCO, GETNET, M);
      render();
    } catch (err) {
      console.error(err);
      alert('Erro ao ler o extrato: ' + err.message);
      if (status) status.textContent = '';
    }
  }

  function viewBanco(main) {
    const uploader = `
      <div class="cuba-toggle" style="margin-bottom:4px">
        <button class="side-btn" id="btn-banco-up" style="max-width:300px"><i class="bi bi-bank"></i> Carregar extrato do banco (OFX)</button>
        ${BANCO ? `<button class="side-btn" id="btn-banco-pub" style="max-width:320px"><i class="bi bi-cloud-arrow-up"></i> Baixar arquivo para publicar no GitHub</button>` : ''}
        <span id="banco-status" class="dim"></span>
        ${BANCO ? `<button class="side-btn" id="btn-banco-clear" style="max-width:150px;margin-left:auto"><i class="bi bi-trash3"></i> Limpar</button>` : ''}
      </div>
      <p class="note dim">Exporte o extrato da conta em <strong>OFX</strong> pelo app do Santander Empresas e arraste aqui — pode juntar vários meses, o sistema não duplica (usa o identificador único de cada lançamento). ${BANCO?.atualizadoEm ? 'Última atualização: ' + BANCO.atualizadoEm.toLocaleString('pt-BR') + '.' : ''}</p>
      ${BANCO ? `<p class="note"><strong>Para os sócios verem:</strong> clique em <em>Baixar arquivo para publicar</em> e suba o <code>banco_dados.json</code> no repositório, junto da planilha e do getnet_dados.json.</p>` : ''}`;

    if (!BAN) {
      main.innerHTML = card('Banco · Conta Santander', uploader + '<p class="note" style="margin-top:10px">Nenhum extrato carregado ainda. Assim que você trouxer o OFX, aparecem aqui as tarifas, o custo real da antecipação da Getnet e a conferência dos boletos.</p>');
      ligarUploadBanco();
      return;
    }

    const A = BAN;
    const dias = Math.round((A.fim - A.ini) / 86400000) + 1;
    const saldoLiquido = A.entradas - A.saidas;
    const multiMes = A.meses.length >= 2;

    const kpis = `<div class="kpi-grid kpi-grid-4">
      ${kpiCard({ icon: 'bi-arrow-down-left', label: 'Entradas no período', valor: U.brl(A.entradas), sub: U.fmtDate(A.ini) + ' a ' + U.fmtDate(A.fim) })}
      ${kpiCard({ icon: 'bi-arrow-up-right', label: 'Saídas no período', valor: U.brl(A.saidas), invert: true })}
      ${kpiCard({ icon: 'bi-wallet2', label: 'Resultado no banco', valor: U.brl(saldoLiquido), cls: saldoLiquido < 0 ? 'kpi-warn' : '' })}
      ${kpiCard({ icon: 'bi-percent', label: 'Tarifas bancárias', valor: U.brl(A.tarifas.total), sub: 'no período · ' + dias + ' dias', invert: true })}
    </div>`;

    // custo da antecipação — resumo (detalhe completo na aba Antecipação)
    let antecCard = '';
    if (A.custoAntecipacao) {
      const c = A.custoAntecipacao;
      antecCard = `<div class="alerta ${c.desagioPct > 2 ? 'warn' : 'ok'}"><i class="bi bi-cash-coin"></i><div>
        <strong>Antecipação de crédito custa ~${U.pct(c.desagioPct)} (≈ ${U.brl(c.custoMensalEst)}/mês)</strong>
        <p>Você recebeu ${U.brl(c.recebidoComAntecipacao)} à vista pela antecipação; sem antecipar, receberia ${U.brl(c.liquidoSemAntecipacao)} em ~30 dias — diferença de ${U.brl(c.custoNoPeriodo)} no período. A comparação visual e o custo mês a mês estão na aba <strong>Antecipação</strong>.</p>
      </div></div>`;
    }

    // composição por categoria
    const cats = Object.values(A.porCat).sort((a, b) => b.total - a.total);
    const rowsCat = cats.map(c => `<tr>
      <td><strong>${U.esc(c.rotulo)}</strong></td>
      <td class="mono right">${c.n}</td>
      <td class="mono right ${['pix_recebido', 'getnet_debito', 'getnet_antecipacao', 'ifood_repasse', 'rendimento', 'outros_creditos'].includes(c.id) ? 'pos' : 'neg'}">${U.brl(c.total)}</td>
    </tr>`).join('');

    // tarifas detalhadas
    const rowsTarifa = Object.values(A.tarifas.porTipo).sort((a, b) => b.total - a.total).map(t =>
      `<tr><td>${U.esc(t.memo)}</td><td class="mono right">${t.n}x</td><td class="mono right neg">${U.brl(t.total)}</td><td class="mono right dim">${U.brl(t.total / dias * 30)}/mês</td></tr>`).join('');

    // conciliação de boletos
    let concCard = '';
    if (A.conciliacaoBoletos) {
      const cb = A.conciliacaoBoletos;
      const rowsConc = cb.itens.slice(0, 30).map(r => `<tr>
        <td class="mono">${U.fmtDate(r.boleto.venc)}</td>
        <td>${U.esc(r.boleto.desc || '—')}</td>
        <td class="mono right">${U.brl(r.boleto.valor)}</td>
        <td>${r.banco ? '<span class="badge ok"><i class="bi bi-check2"></i> pago ' + U.fmtDate(r.banco.data) + '</span>' : r.naBorda ? '<span class="badge">fora da janela</span>' : '<span class="badge bad">não encontrado</span>'}</td>
      </tr>`).join('');
      concCard = card('Conferência de boletos — planilha × banco', `
        <div class="kpi-grid kpi-grid-4" style="margin-bottom:12px">
          ${kpiCard({ icon: 'bi-check-circle', label: 'Confirmados no banco', valor: String(cb.confirmados) })}
          ${kpiCard({ icon: 'bi-dash-circle', label: 'Fora da janela', valor: String(cb.borda), sub: 'venceram na borda do extrato' })}
          ${kpiCard({ icon: 'bi-exclamation-circle', label: 'Não encontrados', valor: String(cb.pendentes.length), cls: cb.pendentes.length ? 'kpi-warn' : '' })}
        </div>
        <div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Boleto (planilha)</th><th class="right">Valor</th><th>Status no banco</th></tr></thead><tbody>${rowsConc}</tbody></table></div>
        <p class="note">Casa cada boleto da planilha (vencido no período do extrato) com o débito correspondente na conta, por valor e data (±5 dias). "Não encontrado" pode ser boleto pago em dinheiro, valor divergente, ou lançamento faltando.</p>`);
    }

    main.innerHTML = `
      ${card('Banco · Conta Santander', uploader)}
      ${kpis}
      ${multiMes ? card('Evolução mês a mês na conta', '<div class="chart-box tall"><canvas id="ch-bn-mes"></canvas></div><p class="note">Entradas, saídas e resultado líquido de cada mês pelo extrato — a saúde real do caixa ao longo do tempo.</p>') : ''}
      ${antecCard}
      <div class="grid-2">
        ${card('Para onde foi / de onde veio', '<div class="chart-box tall"><canvas id="ch-bn-cat"></canvas></div>')}
        ${card('Recebimentos da maquininha na conta', `<div class="table-wrap"><table><tbody>
          <tr><td>Antecipação de crédito (Getnet)</td><td class="mono right pos">${U.brl(A.antecipacaoTotal)}</td></tr>
          <tr><td>Débito Getnet (D+1)</td><td class="mono right pos">${U.brl(A.getnetDebitoTotal)}</td></tr>
          <tr><td>Repasse iFood</td><td class="mono right pos">${U.brl(A.ifoodRepasse)}</td></tr>
          <tr><td>PIX recebidos</td><td class="mono right pos">${U.brl(A.porCat.pix_recebido?.total || 0)}</td></tr>
          <tr><td>Rendimento da aplicação</td><td class="mono right pos">${U.brl(A.rendimento)}</td></tr>
        </tbody></table></div><p class="note">É assim que o dinheiro da maquininha entra na conta: a maior parte via antecipação de crédito.</p>`)}
      </div>
      ${A.tarifas.total > 0 ? card('Tarifas bancárias detalhadas', `<div class="table-wrap"><table><thead><tr><th>Tarifa</th><th class="right">Qtd</th><th class="right">Total</th><th class="right">Projeção</th></tr></thead><tbody>${rowsTarifa}</tbody></table></div><p class="note">No período, as tarifas somaram ${U.brl(A.tarifas.total)} — ${A.tarifas.total < 200 ? 'valor baixo, conta bem negociada.' : 'vale revisar o pacote de serviços com o gerente.'}</p>`) : ''}
      ${concCard}
      ${card('Composição por categoria', `<div class="table-wrap"><table><thead><tr><th>Categoria</th><th class="right">Qtd</th><th class="right">Total</th></tr></thead><tbody>${rowsCat}</tbody></table></div>`)}`;

    ligarUploadBanco();
    if ($('#btn-banco-pub')) $('#btn-banco-pub').addEventListener('click', () => DB.banco.exportarJson(BANCO));
    if ($('#btn-banco-clear')) $('#btn-banco-clear').addEventListener('click', () => {
      if (confirm('Apagar o extrato bancário salvo neste navegador?')) { DB.banco.limpar(); BANCO = null; BAN = null; render(); }
    });

    const p = DB.charts.palette();
    const catsCh = cats.slice(0, 8);
    DB.charts.barrasHoriz('ch-bn-cat', catsCh.map(c => c.rotulo), catsCh.map(c => c.total), p.pistache);
    if (multiMes) {
      DB.charts.barras('ch-bn-mes', A.meses.map(U.ymLabel), [
        { label: 'Entradas', data: A.meses.map(m => A.porMes[m].entradas), color: p.pistache },
        { label: 'Saídas', data: A.meses.map(m => A.porMes[m].saidas), color: p.amarena },
        { label: 'Resultado', data: A.meses.map(m => A.porMes[m].entradas - A.porMes[m].saidas), color: p.gold },
      ]);
    }
  }

  function ligarUploadBanco() {
    const btn = $('#btn-banco-up');
    if (!btn) return;
    let inp = $('#banco-file-input');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.ofx'; inp.multiple = true; inp.hidden = true; inp.id = 'banco-file-input';
      document.body.appendChild(inp);
      inp.addEventListener('change', e => { if (e.target.files.length) processarOfx([...e.target.files]); inp.value = ''; });
    }
    btn.addEventListener('click', () => inp.click());
  }

  /* ---------- PRODUÇÃO DE CUBAS ---------- */

  let saborConsulta = null;  // chave do sabor selecionado na consulta
  let filtroSabores = '';    // texto da busca

  function viewProducao(main) {
    if (!PROD) {
      main.innerHTML = card('Produção de cubas', `<p class="note">Nenhuma aba de produção reconhecida (colunas <strong>Data | Sabor | Produtor | Quantidade</strong>). Adicione a aba <code>Producao_Cubas</code> na planilha principal — registros novos podem ser acrescentados nela mesma ou em abas novas no mesmo formato.</p>`);
      return;
    }
    const P = PROD;
    const mesAtual = P.meses[P.meses.length - 1];
    const mAtual = P.porMes[mesAtual];
    const mesAnt = P.meses[P.meses.length - 2];
    const fixos = P.sabores.filter(s => s.fixo);
    const rotativos = P.sabores.filter(s => !s.fixo);

    const kpis = `<div class="kpi-grid kpi-grid-4">
      ${kpiCard({ icon: 'bi-snow2', label: 'Cubas em ' + U.ymLabel(mesAtual), valor: String(Math.round(mAtual.total)), deltaPct: mesAnt ? U.delta(mAtual.total, P.porMes[mesAnt].total) : null, sub: mAtual.sabores.size + ' sabores no mês' })}
      ${kpiCard({ icon: 'bi-pin-angle', label: 'Sabores fixos', valor: fixos.length + ' de 8', sub: Math.round(U.sum(fixos, s => s.total)) + ' cubas (' + U.pct(U.sum(fixos, s => s.total) / P.totalGeral * 100) + ' da produção)' })}
      ${kpiCard({ icon: 'bi-arrow-repeat', label: 'Sabores rotativos já feitos', valor: String(rotativos.length), sub: Math.round(U.sum(rotativos, s => s.total)) + ' cubas no histórico' })}
      ${kpiCard({ icon: 'bi-collection', label: 'Produção total registrada', valor: String(Math.round(P.totalGeral)) + ' cubas', sub: P.meses.length + ' meses (março sem controle)' })}
    </div>`;

    // ---- detalhe do sabor consultado ----
    let detalhe = '';
    const sel = saborConsulta ? P.porSabor[saborConsulta] : null;
    if (sel) {
      const mediaAtivo = sel.total / sel.mesesAtivos.length;
      detalhe = card(`<i class="bi bi-search"></i> ${U.esc(sel.nome)} ${sel.fixo ? '<span class="chip">fixo</span>' : '<span class="chip">rotativo</span>'}`, `
        <div class="kpi-grid kpi-grid-4" style="margin-bottom:14px">
          ${kpiCard({ icon: 'bi-snow2', label: 'Total produzido', valor: Math.round(sel.total) + ' cubas' })}
          ${kpiCard({ icon: 'bi-calendar-range', label: 'Meses em que foi feito', valor: String(sel.mesesAtivos.length), sub: 'média de ' + mediaAtivo.toFixed(1) + ' cubas/mês ativo' })}
          ${kpiCard({ icon: 'bi-star', label: 'Melhor época', valor: U.ymLabel(sel.melhorMes), sub: Math.round(sel.porMes[sel.melhorMes]) + ' cubas' })}
          ${kpiCard({ icon: 'bi-clock-history', label: 'Última produção', valor: U.ymLabel(sel.ultimo), cls: sel.ultimo < mesAtual ? 'kpi-warn' : '' })}
        </div>
        <div class="chart-box"><canvas id="ch-pr-sabor"></canvas></div>
        <p class="note" style="margin-top:10px">${sel.ultimo < mesAtual
          ? 'Este sabor não é feito desde <strong>' + U.ymLabelFull(sel.ultimo) + '</strong>. Se a melhor época dele está chegando, é candidato a voltar para a rotação.'
          : 'Sabor em produção no mês atual.'}</p>`);
    }

    // ---- tabela de consulta (todos os sabores, com busca) ----
    const f = U.norm(filtroSabores);
    const lista = P.sabores.filter(s => !f || U.norm(s.nome).includes(f));
    const rows = lista.map(s => `
      <tr class="linha-sabor ${s.chave === saborConsulta ? 'sel' : ''}" data-sabor="${U.esc(s.chave)}">
        <td><strong>${U.esc(s.nome)}</strong> ${s.fixo ? '<span class="chip">fixo</span>' : ''}</td>
        <td class="mono right">${Math.round(s.total)}</td>
        <td class="mono">${s.mesesAtivos.map(m => `<span class="chip">${U.ymLabel(m)}·${Math.round(s.porMes[m])}</span>`).join(' ')}</td>
        <td class="mono">${U.ymLabel(s.melhorMes)}</td>
        <td class="mono ${s.ultimo < mesAtual ? 'dim' : 'pos'}">${U.ymLabel(s.ultimo)}</td>
      </tr>`).join('');

    const consulta = card('Consulta de sabores — histórico completo', `
      <input id="busca-sabor" class="input busca" type="search" placeholder="Buscar sabor… (ex.: tiramissu, coco, manga)" value="${U.esc(filtroSabores)}">
      <div class="table-wrap tabela-sabores"><table>
        <thead><tr><th>Sabor</th><th class="right">Cubas</th><th>Produção por mês</th><th>Melhor mês</th><th>Última vez</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">Nenhum sabor encontrado.</td></tr>'}</tbody>
      </table></div>
      <p class="note dim">${lista.length} sabor(es) · toque numa linha para abrir o histórico detalhado acima.</p>`);

    // ---- sazonalidade dos 8 fixos ----
    const maxCel = Math.max(...fixos.flatMap(s => P.meses.map(m => s.porMes[m] || 0)), 1);
    const headMeses = P.meses.map(m => `<th class="right">${U.ymLabel(m)}</th>`).join('');
    const rowsHeat = fixos.map(s => {
      const cels = P.meses.map(m => {
        const v = s.porMes[m] || 0;
        const al = v ? (0.12 + 0.55 * v / maxCel).toFixed(2) : 0;
        return `<td class="right mono" style="${v ? `background:rgba(31,138,128,${al});border-radius:6px;` : ''}">${v ? Math.round(v) : '·'}</td>`;
      }).join('');
      return `<tr><td><strong>${U.esc(s.nome)}</strong></td>${cels}<td class="right mono"><strong>${Math.round(s.total)}</strong></td></tr>`;
    }).join('');

    main.innerHTML = `
      ${kpis}
      ${detalhe}
      ${consulta}
      ${card('Sazonalidade dos 8 fixos — cubas por mês', `<div class="table-wrap"><table><thead><tr><th>Sabor</th>${headMeses}<th class="right">Total</th></tr></thead><tbody>${rowsHeat}</tbody></table></div>`)}
      ${card('Cubas produzidas por mês (todos os sabores)', '<div class="chart-box"><canvas id="ch-pr-mes"></canvas></div>')}`;

    // interações
    $('#busca-sabor').addEventListener('input', e => {
      filtroSabores = e.target.value;
      const q = U.norm(filtroSabores);
      $$('.linha-sabor').forEach(tr => {
        tr.style.display = !q || U.norm(tr.querySelector('td').textContent).includes(q) ? '' : 'none';
      });
    });
    $$('.linha-sabor').forEach(tr => tr.addEventListener('click', () => {
      saborConsulta = tr.dataset.sabor;
      render();
    }));

    const p = DB.charts.palette();
    if (sel) {
      DB.charts.barras('ch-pr-sabor', P.meses.map(U.ymLabel),
        [{ label: 'Cubas de ' + sel.nome, data: P.meses.map(m => sel.porMes[m] || 0), color: p.amarena }],
        { unidades: true, sufixo: 'cubas' });
    }
    DB.charts.barras('ch-pr-mes', P.meses.map(U.ymLabel),
      [{ label: 'Cubas', data: P.meses.map(m => P.porMes[m].total), color: p.gold }],
      { unidades: true, sufixo: 'cubas' });
  }

  /* ---------- NUTRICIONAL ---------- */

  let nutSabor = null, nutPorcao = 100;
  const PORCOES = [
    { nome: 'Por 100 g', g: 100 },
    { nome: 'Copo pequeno (150 g)', g: 150 },
    { nome: 'Copo médio (210 g)', g: 210 },
    { nome: 'Copo grandíssimo (300 g)', g: 300 },
    { nome: 'Cascão 1 bola (150 g)', g: 150 },
    { nome: 'Cascão 2 bolas (250 g)', g: 250 },
  ];

  function viewProducaoPossivel(main) {
    if (!RAN) {
      main.innerHTML = card('Produção possível', '<p class="note">Adicione a aba <strong>Sabores_Receitas</strong> na planilha (colunas Sabor, Tipo, Ingrediente, Unidade, Quantidade) para o sistema cruzar as receitas com o estoque e mostrar o que dá para produzir agora.</p>');
      return;
    }
    const A = RAN;
    const filtroTipo = prodFiltroTipo || 'todos';
    const tipos = [...new Set(A.todos.map(r => r.tipo).filter(Boolean))];

    const aplicaFiltro = lista => filtroTipo === 'todos' ? lista : lista.filter(r => r.tipo === filtroTipo);
    const produziveis = aplicaFiltro(A.produziveis);
    const nuncaFeitos = aplicaFiltro(A.nuncaFeitos);
    const bloqueados = aplicaFiltro(A.bloqueados);

    const chip = (r) => {
      if (r.nuncaFeito) return '<span class="chip novo"><i class="bi bi-stars"></i> nunca feito</span>';
      return '';
    };
    const infoIngredientes = r => {
      const partes = [];
      if (r.verificar.length) partes.push(`<span class="neg">${r.verificar.length} fora do estoque</span>`);
      if (r.frescos.length) partes.push(`<span class="dim">${r.frescos.length} fruta(s) fresca(s)</span>`);
      if (r.semQtd.length) partes.push(`<span class="dim">${r.semQtd.length} sem qtd</span>`);
      return partes.length ? partes.join(' · ') : '<span class="dim">tudo em estoque</span>';
    };

    // KPIs
    const kpis = `<div class="kpi-grid kpi-grid-4">
      ${kpiCard({ icon: 'bi-check2-circle', label: 'Dá para produzir agora', valor: String(A.totalProduziveis), sub: 'de ' + A.totalSabores + ' sabores' })}
      ${kpiCard({ icon: 'bi-stars', label: 'Nunca feitos disponíveis', valor: String(A.nuncaFeitos.length), sub: 'potenciais lançamentos' })}
      ${kpiCard({ icon: 'bi-x-circle', label: 'Bloqueados', valor: String(A.bloqueados.length), sub: 'falta ingrediente' })}
      ${kpiCard({ icon: 'bi-egg-fried', label: 'Receitas cadastradas', valor: String(A.totalSabores), sub: 'na aba Sabores_Receitas' })}
    </div>`;

    // filtro de tipo
    const filtroBtns = `<div class="cuba-toggle" style="margin-bottom:12px">
      <button class="chip-btn ${filtroTipo === 'todos' ? 'on' : ''}" data-tipo="todos">Todos</button>
      ${tipos.map(t => `<button class="chip-btn ${filtroTipo === t ? 'on' : ''}" data-tipo="${U.esc(t)}">${U.esc(t)}</button>`).join('')}
    </div>`;

    // lista de produzíveis (prioridade por venda)
    const linhaProduzivel = r => `<tr>
      <td><strong>${U.esc(r.nome)}</strong> ${chip(r)}</td>
      <td class="dim">${U.esc(r.tipo)}</td>
      <td>${r.volume > 0 ? `<div class="pop-bar"><div class="pop-fill" style="width:${(r.popularidade * 100).toFixed(0)}%"></div></div>` : '<span class="dim">—</span>'}</td>
      <td class="mono right">${r.volume > 0 ? r.volume.toFixed(0) + ' cubas' : '<span class="dim">novo</span>'}</td>
      <td>${infoIngredientes(r)}</td>
    </tr>`;

    const tabelaProduziveis = produziveis.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Sabor</th><th>Tipo</th><th>Popularidade</th><th class="right">Já produzido</th><th>Observação</th></tr></thead>
      <tbody>${produziveis.map(linhaProduzivel).join('')}</tbody></table></div>` : '<p class="note">Nenhum sabor produzível neste filtro.</p>';

    // nunca feitos (destaque)
    const cardNunca = nuncaFeitos.length ? card('<i class="bi bi-stars"></i> Nunca feitos — potenciais lançamentos', `
      <p class="note" style="margin-top:0">Sabores com receita cadastrada e ingredientes disponíveis, que a loja ainda não produziu. Boas apostas para testar como novidade:</p>
      <div class="novo-grid">
        ${nuncaFeitos.slice(0, 18).map(r => `<div class="novo-card">
          <div class="novo-nome">${U.esc(r.nome)}</div>
          <div class="novo-tipo">${U.esc(r.tipo)}</div>
          ${r.frescos.length ? `<div class="dim" style="font-size:11px">precisa: ${r.frescos.map(f => U.esc(f.nome)).join(', ')}</div>` : ''}
        </div>`).join('')}
      </div>`) : '';

    // bloqueados
    const cardBloq = bloqueados.length ? card('Bloqueados — falta ingrediente', `
      <div class="table-wrap"><table>
        <thead><tr><th>Sabor</th><th>Tipo</th><th>Zerado no estoque</th><th>Fora do estoque (conferir)</th></tr></thead>
        <tbody>${bloqueados.slice(0, 50).map(r => `<tr>
          <td><strong>${U.esc(r.nome)}</strong></td>
          <td class="dim">${U.esc(r.tipo)}</td>
          <td class="neg">${r.faltando.length ? r.faltando.map(f => U.esc(f.item || f.nome)).join(', ') : '<span class="dim">—</span>'}</td>
          <td class="warn-text">${r.verificar.length ? r.verificar.map(f => U.esc(f.nome)).join(', ') : '<span class="dim">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div>
      <p class="note"><strong>Zerado no estoque</strong> = o item existe no seu controle mas está em 0, é só repor. <strong>Fora do estoque</strong> = não encontrei esse ingrediente no seu estoque de produção — pode ser que você compre à parte, ou que o nome esteja diferente na planilha. Confira esses antes de produzir; por segurança o sistema não libera o sabor enquanto houver ingrediente fora do controle.</p>`) : '';

    main.innerHTML = `
      ${card('Produção possível — o que dá para fazer com o estoque de hoje', `
        <p class="note" style="margin-top:0">O sistema leu as ${A.totalSabores} receitas, conferiu o estoque atual e concluiu o que você consegue produzir agora. A lista de produzíveis vem ordenada por <strong>popularidade</strong> (o quanto cada sabor já foi produzido), então você começa pelos que mais vendem.</p>
        ${kpis}`)}
      ${card('Sabores que dá para produzir agora', filtroBtns + tabelaProduziveis)}
      ${cardNunca}
      ${cardBloq}
      ${card('Como isto é calculado', `<p class="note">Para cada receita, o sistema casa os ingredientes com o seu estoque, tolerando nomes um pouco diferentes (tipo "Base 6 MEC 3" ↔ "Base 6", ou "Ovomaltine" ↔ "Ovomaline"). Um sabor só é <strong>produzível</strong> quando todos os ingredientes de produção estão disponíveis. Se um ingrediente está <strong>zerado</strong> ou <strong>não aparece no seu estoque</strong>, o sabor fica bloqueado — melhor avisar que liberar errado. Só não travam a produção: <strong>frutas frescas</strong> (morango, abacaxi, limão…), que você compra na feira, e os <strong>básicos de compra semanal</strong> (leite, açúcar, água). <strong>Em breve:</strong> quando você preencher os preços no estoque e nas receitas, esta aba vai rankear os sabores por <strong>custo e margem</strong>, mostrando os mais lucrativos para priorizar no fim de semana.</p>`)}`;

    // liga os filtros de tipo
    main.querySelectorAll('.chip-btn[data-tipo]').forEach(b => b.addEventListener('click', () => {
      prodFiltroTipo = b.dataset.tipo; render();
    }));
  }
  let prodFiltroTipo = 'todos';

  function viewNutricional(main) {
    const NUT = RAW.nutricional;
    if (!NUT) {
      main.innerHTML = card('Informações nutricionais', '<p class="note">Aba <code>Nutricional</code> não encontrada na planilha. Ela guarda a tabela por 100 g de cada sabor — para adicionar sabores novos, acrescente linhas seguindo o mesmo cabeçalho.</p>');
      return;
    }
    if (!nutSabor || !NUT.some(s => s.sabor === nutSabor)) nutSabor = NUT[0].sabor;
    const s = NUT.find(x => x.sabor === nutSabor);
    const fator = nutPorcao / 100;
    const fmt = (v, dig = 1) => v ? (v * fator).toLocaleString('pt-BR', { maximumFractionDigits: dig }) : '0';
    const vd = v => v ? Math.round(v * fator) + '%' : '0%';

    const selSabores = NUT.map(x => `<option ${x.sabor === nutSabor ? 'selected' : ''}>${U.esc(x.sabor)}</option>`).join('');
    const selPorcoes = PORCOES.map((p, i) => `<option value="${p.g}" ${p.g === nutPorcao && (i === 0 ? nutPorcao === 100 : true) ? 'selected' : ''}>${p.nome}</option>`).join('');

    const selos = [
      !s.leite ? '<span class="badge ok"><i class="bi bi-check2"></i> não contém leite</span>' : '<span class="badge">contém leite</span>',
      !s.temAcucar ? '<span class="badge ok"><i class="bi bi-check2"></i> sem açúcar adicionado</span>' : '<span class="badge">contém açúcar</span>',
    ].join(' ');

    const linhas = [
      ['Valor energético', fmt(s.kcal, 0) + ' kcal', vd(s.vdKcal)],
      ['Carboidratos', fmt(s.carb) + ' g', vd(s.vdCarb)],
      ['— Açúcares totais', fmt(s.acucar) + ' g', '—'],
      ['— Açúcares adicionados', fmt(s.acucarAdic) + ' g', '—'],
      ['Gorduras totais', fmt(s.gord) + ' g', vd(s.vdGord)],
      ['— Gorduras saturadas', fmt(s.sat) + ' g', vd(s.vdSat)],
      ['Proteínas', fmt(s.prot) + ' g', vd(s.vdProt)],
      ['Fibra alimentar', fmt(s.fibra) + ' g', vd(s.vdFibra)],
      ['Sódio', fmt(s.sodio, 0) + ' mg', vd(s.vdSodio)],
    ].map(([n, v, d]) => `<tr><td>${n}</td><td class="mono right"><strong>${v}</strong></td><td class="mono right dim">${d}</td></tr>`).join('');

    const rotulo = card('Calculadora por porção', `
      <div class="cuba-toggle" style="margin-bottom:14px">
        <select id="nut-sabor" class="input" style="max-width:280px">${selSabores}</select>
        <select id="nut-porcao" class="input" style="max-width:250px">${selPorcoes}</select>
        <span style="margin-left:auto">${selos}</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Porção de ${nutPorcao} g — ${U.esc(s.sabor)}</th><th class="right">Quantidade</th><th class="right">%VD*</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
      <p class="note dim">*%VD com base em dieta de 2.000 kcal / 8.400 kJ, escalonado pela porção. Valores derivados da tabela oficial por 100 g.</p>`);

    // tabela geral por 100 g
    const rowsAll = NUT.map(x => `<tr>
      <td><strong>${U.esc(x.sabor)}</strong> ${!x.leite ? '<span class="badge ok">s/ leite</span>' : ''}${!x.temAcucar ? ' <span class="badge ok">s/ açúcar adic.</span>' : ''}</td>
      <td class="mono right">${x.kcal}</td><td class="mono right">${x.carb}</td><td class="mono right">${x.acucar}</td>
      <td class="mono right">${x.gord}</td><td class="mono right">${x.sat}</td><td class="mono right">${x.prot}</td>
      <td class="mono right">${x.fibra || '—'}</td><td class="mono right">${x.sodio}</td></tr>`).join('');

    main.innerHTML = rotulo + card('Tabela completa — por 100 g', `
      <div class="table-wrap"><table>
        <thead><tr><th>Sabor</th><th class="right">Kcal</th><th class="right">Carb (g)</th><th class="right">Açúc. (g)</th><th class="right">Gord. (g)</th><th class="right">Sat. (g)</th><th class="right">Prot. (g)</th><th class="right">Fibra (g)</th><th class="right">Sódio (mg)</th></tr></thead>
        <tbody>${rowsAll}</tbody></table></div>
      <p class="note">Morango e Limão Siciliano são sorbets — não contêm leite. Coco e Gianduia não têm açúcar adicionado. Para incluir um sabor novo, acrescente a linha na aba <code>Nutricional</code> da planilha.</p>`);

    $('#nut-sabor').addEventListener('change', e => { nutSabor = e.target.value; render(); });
    $('#nut-porcao').addEventListener('change', e => { nutPorcao = +e.target.value; render(); });
  }

  /* ---------- CLIMA × VENDAS ---------- */

  let CLIMA = null; // { analise, previsaoDemanda } após carregar

  function viewClima(main) {
    if (!CLIMA) {
      main.innerHTML = card('Clima × Vendas — São Lourenço/MG', `
        <p class="note">Cruza a venda diária da planilha com a temperatura e chuva históricas da cidade (fonte: Open-Meteo, gratuita) e projeta a demanda dos próximos 7 dias para planejar produção e escala.</p>
        <button class="side-btn" id="btn-clima" style="max-width:300px;margin-top:10px"><i class="bi bi-thermometer-sun"></i> Carregar análise de clima</button>
        <p class="note dim" id="clima-status" style="margin-top:8px"></p>`);
      $('#btn-clima').addEventListener('click', carregarClima);
      return;
    }
    const A = CLIMA.analise, PD = CLIMA.previsaoDemanda;

    const corr = A.r == null ? '—'
      : A.r >= 0.5 ? 'forte' : A.r >= 0.3 ? 'moderada' : A.r >= 0.15 ? 'fraca' : 'quase nula';
    const impChuva = (A.mediaChuva && A.mediaSeco)
      ? U.pct((1 - A.mediaChuva / A.mediaSeco) * 100)
      : null;

    const kpis = `<div class="kpi-grid kpi-grid-4">
      ${kpiCard({ icon: 'bi-thermometer-half', label: 'Correlação temperatura × venda', valor: A.r != null ? A.r.toFixed(2) : '—', sub: 'relação ' + corr + ' (' + A.pontos.length + ' dias analisados)' })}
      ${kpiCard({ icon: 'bi-sun', label: 'Venda em dia muito quente', valor: U.brl(A.porFaixa[3].media), sub: A.porFaixa[3].dias.length + ' dias > 27°' })}
      ${kpiCard({ icon: 'bi-cloud-snow', label: 'Venda em dia frio', valor: U.brl(A.porFaixa[0].media), sub: A.porFaixa[0].dias.length + ' dias < 18°' })}
      ${kpiCard({ icon: 'bi-cloud-rain', label: 'Efeito da chuva forte', valor: impChuva != null ? '−' + impChuva : '—', sub: impChuva != null ? `${U.brl(A.mediaSeco)} seco → ${U.brl(A.mediaChuva)} com chuva` : 'poucos dias chuvosos na base', invert: true })}
    </div>`;

    const rowsPrev = PD.map(p => {
      const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const ctxBadge = p.ctx.contexto === 'normal'
        ? '<span class="dim">—</span>'
        : `<span class="badge ${p.ctx.contexto === 'feriadao' ? 'ok' : 'good'}">${U.esc(p.ctx.nome || DB.calendario.ROTULOS[p.ctx.contexto])}</span>`;
      return `<tr>
        <td><strong>${nomes[p.data.getDay()]}</strong> <span class="dim">${U.fmtDate(p.data)}</span></td>
        <td class="mono">${Math.round(p.tmax)}°C <span class="chip">${p.faixa.label.split(' (')[0]}</span></td>
        <td>${p.chove ? '<span class="badge warn"><i class="bi bi-cloud-rain"></i> chuva' + (p.probChuva != null ? ' ' + p.probChuva + '%' : '') + '</span>' : '<span class="badge ok">firme</span>'}</td>
        <td>${ctxBadge}</td>
        <td class="mono right"><strong>${U.brl(p.estimativa)}</strong></td>
        <td class="mono right dim">${(p.estimativa / A.mediaGeral * 100).toFixed(0)}% da média</td>
      </tr>`;
    }).join('');

    main.innerHTML = `
      ${kpis}
      ${card('Previsão de demanda — próximos 7 dias', `
        <div class="table-wrap"><table>
          <thead><tr><th>Dia</th><th>Máxima</th><th>Chuva</th><th>Calendário</th><th class="right">Venda estimada</th><th class="right">vs média</th></tr></thead>
          <tbody>${rowsPrev}</tbody></table></div>
        <p class="note">Estimativa = sua média histórica ajustada por dia da semana × temperatura × calendário turístico (feriadões, datas comemorativas, férias escolares)${A.fatorChuva !== 1 ? ' (e pela chuva, quando provável)' : ''}. Use para dimensionar produção de cubas e escala de freelancers. Semana somada: <strong>${U.brl(U.sum(PD, p => p.estimativa))}</strong>.</p>`)}
      ${card('Efeito do calendário medido nas SUAS vendas', `
        <div class="table-wrap"><table>
          <thead><tr><th>Contexto</th><th class="right">Dias na base</th><th class="right">Efeito sobre o dia equivalente</th></tr></thead>
          <tbody>${A.contextos.map(c => `<tr>
            <td><strong>${c.rotulo}</strong></td>
            <td class="mono right">${c.dias}</td>
            <td class="mono right"><span class="badge ${c.fator >= 1.1 ? 'ok' : c.fator <= 0.9 ? 'bad' : ''}">${c.fator >= 1 ? '+' : '−'}${U.pct(Math.abs(c.fator - 1) * 100)}</span>${c.dias < 8 ? ' <span class="dim">amostra pequena — amortecido</span>' : ''}</td>
          </tr>`).join('')}</tbody></table></div>
        <p class="note">Efeito já descontando dia da semana e temperatura. Verão (15/dez–jan) e férias de julho são contextos separados — o movimento de dezembro não infla a previsão de julho. Contextos com poucos dias são amortecidos para o neutro até acumular histórico.</p>`)}
      <div class="grid-2">
        ${card('Venda média por faixa de temperatura', '<div class="chart-box"><canvas id="ch-cl-faixa"></canvas></div>')}
        ${card('Cada dia: temperatura × venda', '<div class="chart-box"><canvas id="ch-cl-scatter"></canvas></div>')}
      </div>
      ${card('Como ler', `<p class="note">Correlação de ${A.r != null ? A.r.toFixed(2) : '—'} (${corr}) entre a máxima do dia e a venda. ${impChuva != null ? 'Chuva forte derruba a venda em ~' + impChuva + ' (' + A.nChuvosos + ' dias chuvosos vs ' + A.nSecos + ' secos na base). ' : ''}O histórico climático fica em cache no navegador. ${A.fonteExtra ? 'A base inclui ' + A.fonteExtra + ' dias anteriores à planilha completados pela maquininha (calibrados ×' + A.fatorCal.toFixed(2) + ' para compensar o dinheiro em espécie) — inclusive o julho do ano passado, que ancora a previsão das férias de inverno.' : ''}</p>`)}`;

    const p = DB.charts.palette();
    DB.charts.barras('ch-cl-faixa', A.porFaixa.map(f => f.label), [{ label: 'Venda média/dia', data: A.porFaixa.map(f => f.media || 0), color: p.gold }]);
    // dispersão temperatura × venda
    DB.charts.make('ch-cl-scatter', {
      type: 'scatter',
      data: { datasets: [{ label: 'Dia', data: A.pontos.map(pt => ({ x: pt.tmax, y: pt.venda })), backgroundColor: DB.charts.hexA(p.pistache, .55), pointRadius: 3.5 }] },
      options: (() => {
        const o = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.x.toFixed(0)}°C · ${U.brl(c.parsed.y)}` } } },
          scales: { x: { title: { display: true, text: 'Máxima do dia (°C)' }, grid: { color: p.grid } }, y: { grid: { color: p.grid }, ticks: { callback: v => U.brlShort(v) } } } };
        return o;
      })(),
    });
  }

  async function carregarClima() {
    const st = $('#clima-status'); // presente na view Clima e no planejador de Funcionários
    const setSt = t => { if (st) st.textContent = t; };
    try {
      setSt('Buscando histórico de clima de São Lourenço…');
      const datas = M.txs.filter(t => t.tipo === 'Entrada' && (t.grupo === 'receitaBalcao' || t.grupo === 'receitaIfood')).map(t => t.date);
      if (GETNET) { GETNET.cartoes.forEach(c => datas.push(c.data)); (GETNET.pix || []).forEach(p => datas.push(p.data)); }
      const min = new Date(Math.min(...datas)), max = new Date(Math.max(...datas));
      const hoje = new Date(); const limite = new Date(hoje); limite.setDate(limite.getDate() - 2);
      const diasClima = await DB.clima.historico(min, max > limite ? limite : max);
      setSt('Analisando e buscando previsão…');
      const analise = DB.clima.analisar(M, diasClima, GETNET);
      if (!analise) { setSt('Poucos dias com venda + clima para analisar.'); return; }
      const prev = await DB.clima.previsao7d();
      CLIMA = { analise, previsaoDemanda: DB.clima.preverDemanda(analise, prev) };
      render();
    } catch (err) {
      console.error(err);
      setSt('Não foi possível carregar o clima (' + err.message + '). Verifique a internet e tente de novo.');
    }
  }

  /* ---------- DRE ---------- */

  /** Grupos de saída de um mês (financiamento sempre separado do operacional) */
  function gruposDRE(mes) {
    const t = {};
    mes.txs.filter(x => x.tipo === 'Saída' && x.grupo).forEach(x => t[x.grupo] = (t[x.grupo] || 0) + x.valor);
    const totalSemTransf = U.sum(mes.txs.filter(x => x.tipo === 'Saída' && x.grupo !== 'transferencia'), x => x.valor);
    const outras = Math.max(0, totalSemTransf - (t.cmv || 0) - (t.folha || 0) - (t.fixos || 0) - (t.marketing || 0) - (t.impostos || 0) - (t.custoIfood || 0) - (t.financiamento || 0));
    return { ...t, outras };
  }

  /** DRE completa de um mês (reutilizada pela view e pelo relatório PDF) */
  function dreDoMes(k) {
    const m = M.byMonth[k];
    if (!m) return null;
    const at = gruposDRE(m);
    const receitaBruta = m.receita;
    const impostos = at.impostos || 0;
    const receitaLiquida = receitaBruta - impostos;
    const cmv = at.cmv || 0;
    const lucroBruto = receitaLiquida - cmv;
    const despOp = (at.folha || 0) + (at.fixos || 0) + (at.marketing || 0) + (at.custoIfood || 0) + at.outras;
    const resultadoOp = lucroBruto - despOp;
    const financ = at.financiamento || 0;
    const resultadoFinal = resultadoOp - financ;
    return { m, at, receitaBruta, impostos, receitaLiquida, cmv, lucroBruto, despOp, resultadoOp, financ, resultadoFinal,
      margemBruta: receitaLiquida ? lucroBruto / receitaLiquida * 100 : null,
      margemOp: receitaBruta ? resultadoOp / receitaBruta * 100 : null };
  }

  function viewDRE(main) {
    const k = mesSelecionado() || M.mesAtualKey;
    const D = dreDoMes(k);
    const prev = mesAnteriorDe(k);
    if (!D) { main.innerHTML = card('DRE', '<p class="note">Sem dados no período.</p>'); return; }
    const { m, at: atual, receitaBruta, impostos, receitaLiquida, cmv, lucroBruto, resultadoOp, financ, resultadoFinal } = D;
    const g = gruposDRE;
    const ant = prev ? g(prev) : null;

    const pctR = v => receitaBruta ? U.pct(v / receitaBruta * 100) : '—';
    const linha = (nome, v, opts = {}) => {
      const prevV = opts.prevFn && ant && prev ? opts.prevFn(ant, prev) : null;
      const d = prevV != null && prevV !== 0 ? U.delta(v, prevV) : null;
      return `<tr class="${opts.cls || ''}">
        <td>${opts.sub ? '&nbsp;&nbsp;(−) ' : ''}${nome}</td>
        <td class="mono right ${opts.destaque ? (v >= 0 ? 'pos' : 'neg') : ''}"><strong>${U.brl(v)}</strong></td>
        <td class="mono right dim">${pctR(Math.abs(v))}</td>
        <td class="mono right dim">${d != null ? (d >= 0 ? '+' : '') + U.pct(d) : '—'}</td>
      </tr>`;
    };

    const rows = [
      linha('Receita Bruta (balcão + iFood)', receitaBruta, { prevFn: (a, p) => p.receita }),
      linha('Impostos', -impostos, { sub: 1, prevFn: a => -(a.impostos || 0) }),
      linha('= Receita Líquida', receitaLiquida, { cls: 'dre-sub' }),
      linha('CMV (matéria-prima, embalagens)', -cmv, { sub: 1, prevFn: a => -(a.cmv || 0) }),
      linha('= Lucro Bruto', lucroBruto, { cls: 'dre-sub', destaque: 1 }),
      linha('Folha (salários + freelancers)', -(atual.folha || 0), { sub: 1, prevFn: a => -(a.folha || 0) }),
      linha('Fixos e administrativo', -(atual.fixos || 0), { sub: 1, prevFn: a => -(a.fixos || 0) }),
      linha('Marketing', -(atual.marketing || 0), { sub: 1, prevFn: a => -(a.marketing || 0) }),
      linha('Canal iFood (motoboy/taxas)', -(atual.custoIfood || 0), { sub: 1, prevFn: a => -(a.custoIfood || 0) }),
      linha('Outras despesas operacionais', -atual.outras, { sub: 1, prevFn: a => -a.outras }),
      linha('= Resultado Operacional', resultadoOp, { cls: 'dre-total', destaque: 1 }),
      financ ? linha('Financiamentos (Tortelli/Celso)', -financ, { sub: 1 }) : '',
      financ ? linha('= Resultado do mês (caixa)', resultadoFinal, { cls: 'dre-total', destaque: 1 }) : '',
    ].join('');

    const margemBruta = D.margemBruta, margemOp = D.margemOp;

    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-cash-coin', label: 'Receita Bruta', valor: U.brl(receitaBruta), sub: U.ymLabelFull(k) })}
        ${kpiCard({ icon: 'bi-graph-up', label: 'Lucro Bruto', valor: U.brl(lucroBruto), sub: margemBruta != null ? 'margem bruta ' + U.pct(margemBruta) : '' })}
        ${kpiCard({ icon: 'bi-clipboard-data', label: 'Resultado Operacional', valor: U.brl(resultadoOp), sub: margemOp != null ? 'margem ' + U.pct(margemOp) : '', cls: resultadoOp < 0 ? 'kpi-bad' : '' })}
        ${kpiCard({ icon: 'bi-safe', label: 'Resultado do mês (caixa)', valor: U.brl(resultadoFinal), sub: financ ? 'após ' + U.brl(financ) + ' de financiamento' : 'sem financiamentos no mês', cls: resultadoFinal < 0 ? 'kpi-warn' : '' })}
      </div>
      ${card('DRE — ' + U.ymLabelFull(k), `
        <div class="table-wrap"><table>
          <thead><tr><th>Linha</th><th class="right">Valor</th><th class="right">% Receita</th><th class="right">vs mês ant.</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        <p class="note">Regime de caixa (lançamentos da planilha). Na DRE, financiamentos (Tortelli/Celso) ficam sempre separados do operacional — o Resultado Operacional mostra a saúde do negócio, e o Resultado do mês mostra o caixa após as parcelas. Use o filtro de mês no topo para qualquer período.</p>`)}
      ${card('Evolução do resultado', '<div class="chart-box tall"><canvas id="ch-dre"></canvas></div>')}`;

    const p = DB.charts.palette();
    DB.charts.barras('ch-dre', M.meses.map(U.ymLabel), [
      { label: 'Lucro Bruto', data: M.meses.map(mk => { const mm = M.byMonth[mk], gg = g(mm); return (mm.receita - (gg.impostos || 0)) - (gg.cmv || 0); }), color: p.pistache },
      { label: 'Resultado Operacional', data: M.meses.map(mk => { const mm = M.byMonth[mk], gg = g(mm);
        const lb = (mm.receita - (gg.impostos || 0)) - (gg.cmv || 0);
        return lb - ((gg.folha || 0) + (gg.fixos || 0) + (gg.marketing || 0) + (gg.custoIfood || 0) + gg.outras); }), color: p.gold },
    ]);
  }

  /* ---------- RESUMO EXECUTIVO DO MÊS (PDF) ---------- */

  function gerarRelatorio() {
    if (!M) return;
    const k = mesSelecionado() || M.mesAtualKey;
    const D = dreDoMes(k);
    if (!D) { alert('Sem dados para o mês selecionado.'); return; }
    const m = D.m;
    const prev = mesAnteriorDe(k);
    const ehAtual = k === M.mesAtualKey;
    const hoje = new Date();

    const pct = v => v != null && isFinite(v) ? U.pct(v) : '—';
    const pctR = v => D.receitaBruta ? U.pct(Math.abs(v) / D.receitaBruta * 100) : '—';

    // KPIs do mês
    const kpi = (label, valor, sub) => `<div class="rp-kpi"><span class="rp-kpi-l">${label}</span><span class="rp-kpi-v">${valor}</span>${sub ? `<span class="rp-kpi-s">${sub}</span>` : ''}</div>`;
    const kpis = [
      kpi('Receita Bruta', U.brl(D.receitaBruta), prev ? (U.delta(D.receitaBruta, prev.receita) >= 0 ? '▲ ' : '▼ ') + pct(Math.abs(U.delta(D.receitaBruta, prev.receita))) + ' vs ' + U.ymLabel(prev.mes) : ''),
      kpi('Resultado Operacional', U.brl(D.resultadoOp), 'margem ' + pct(D.margemOp)),
      kpi('Resultado do mês (caixa)', U.brl(D.resultadoFinal), D.financ ? 'após ' + U.brl(D.financ) + ' de financiamento' : ''),
      kpi('CMV', pct(m.cmvPct), U.brl(D.cmv)),
      kpi('Venda média/dia', U.brl(m.vendaMediaDia), m.diasVenda.size + ' dias de venda'),
      kpi('Saldo acumulado', U.brl(M.kpi.saldoAtual), 'capital de giro: ' + (M.kpi.capitalGiroMeses != null ? M.kpi.capitalGiroMeses.toFixed(1) + ' meses' : '—')),
    ].join('');

    // Metas
    let metasHtml = '';
    if (RAW.metas && ehAtual) {
      const MT = RAW.metas;
      const itens = [];
      if (MT.faturamento) itens.push(`Faturamento: <strong>${U.brl(m.receita)}</strong> de ${U.brl(MT.faturamento)} (${U.pct(m.receita / MT.faturamento * 100, 0)})`);
      if (MT.cmvPct && m.cmvPct != null) itens.push(`CMV: <strong>${pct(m.cmvPct)}</strong> (meta ≤ ${U.pct(MT.cmvPct)}) ${m.cmvPct <= MT.cmvPct ? '✔' : '✘'}`);
      if (MT.folhaPct && m.folhaPct != null) itens.push(`Folha: <strong>${pct(m.folhaPct)}</strong> (meta ≤ ${U.pct(MT.folhaPct)}) ${m.folhaPct <= MT.folhaPct ? '✔' : '✘'}`);
      if (MT.resultado != null) itens.push(`Resultado: <strong>${U.brl(D.resultadoOp)}</strong> (meta ${U.brl(MT.resultado)}) ${D.resultadoOp >= MT.resultado ? '✔' : '✘'}`);
      if (itens.length) metasHtml = `<div class="rp-sec"><h3>Metas do mês</h3><ul class="rp-lista">${itens.map(i => `<li>${i}</li>`).join('')}</ul></div>`;
    }

    // DRE
    const l = (nome, v, cls = '') => `<tr class="${cls}"><td>${nome}</td><td class="rp-num">${U.brl(v)}</td><td class="rp-num rp-dim">${pctR(v)}</td></tr>`;
    const dreHtml = `<table class="rp-tabela">
      <thead><tr><th>DRE — ${U.ymLabelFull(k)}</th><th class="rp-num">Valor</th><th class="rp-num">% Rec.</th></tr></thead><tbody>
      ${l('Receita Bruta (balcão + iFood)', D.receitaBruta)}
      ${l('(−) Impostos', -D.impostos)}
      ${l('= Receita Líquida', D.receitaLiquida, 'rp-sub')}
      ${l('(−) CMV', -D.cmv)}
      ${l('= Lucro Bruto  ·  margem ' + pct(D.margemBruta), D.lucroBruto, 'rp-sub')}
      ${l('(−) Folha', -(D.at.folha || 0))}
      ${l('(−) Fixos e administrativo', -(D.at.fixos || 0))}
      ${l('(−) Marketing', -(D.at.marketing || 0))}
      ${l('(−) Canal iFood', -(D.at.custoIfood || 0))}
      ${l('(−) Outras despesas', -D.at.outras)}
      ${l('= RESULTADO OPERACIONAL', D.resultadoOp, 'rp-total')}
      ${D.financ ? l('(−) Financiamentos (Tortelli/Celso)', -D.financ) : ''}
      ${D.financ ? l('= Resultado do mês (caixa)', D.resultadoFinal, 'rp-total') : ''}
      </tbody></table>`;

    // Raio-X vs referências
    const gt = {};
    m.txs.filter(t => t.tipo === 'Saída' && t.grupo).forEach(t => gt[t.grupo] = (gt[t.grupo] || 0) + t.valor);
    const raioRows = BENCH.map(b => {
      const val = U.sum(b.grupos, gg => gt[gg] || 0);
      const p2 = D.receitaBruta ? val / D.receitaBruta * 100 : null;
      const status = p2 == null ? '—' : p2 > b.max ? '⚠ acima' : (p2 < b.min && b.min > 0 ? 'abaixo' : '✔ dentro');
      return `<tr><td>${b.nome}</td><td class="rp-num">${U.brl(val)}</td><td class="rp-num">${pct(p2)}</td><td class="rp-num rp-dim">${b.min}–${b.max}%</td><td>${status}</td></tr>`;
    }).join('');
    const raioHtml = `<table class="rp-tabela">
      <thead><tr><th>Grupo de custo</th><th class="rp-num">Gasto</th><th class="rp-num">% Rec.</th><th class="rp-num">Referência</th><th>Status</th></tr></thead>
      <tbody>${raioRows}</tbody></table>
      <p class="rp-nota">Referências de gelateria artesanal / food service.</p>`;

    // Análise em texto + alertas (mês corrente usa a consultoria completa)
    let analiseHtml = '';
    if (ehAtual) {
      const paras = DB.analytics.resumoExecutivo(M, INV);
      const ins = DB.analytics.insights(M, INV).slice(0, 6);
      analiseHtml = `<div class="rp-sec"><h3>Análise</h3>${(Array.isArray(paras) ? paras : [paras]).map(p2 => `<p>${p2}</p>`).join('')}</div>
        <div class="rp-sec"><h3>Pontos de atenção</h3><ul class="rp-lista">${ins.map(i => `<li>${i.texto}</li>`).join('')}</ul></div>`;
    } else {
      const dRec = prev ? U.delta(D.receitaBruta, prev.receita) : null;
      analiseHtml = `<div class="rp-sec"><h3>Análise</h3><p>Em ${U.ymLabelFull(k)}, a Dubelato faturou ${U.brl(D.receitaBruta)} (${U.brl(m.vendasBalcao)} no balcão e ${U.brl(m.vendasIfood)} no iFood)${dRec != null ? ', ' + (dRec >= 0 ? 'alta' : 'queda') + ' de ' + pct(Math.abs(dRec)) + ' sobre o mês anterior' : ''}. O CMV consumiu ${pct(m.cmvPct)} da receita e a folha ${pct(m.folhaPct)}. O resultado operacional foi ${U.brl(D.resultadoOp)} (margem ${pct(D.margemOp)})${D.financ ? ', e após ' + U.brl(D.financ) + ' de financiamentos o mês fechou em ' + U.brl(D.resultadoFinal) + ' no caixa' : ''}.</p></div>`;
    }

    // Realidade do caixa (banco) — só se houver extrato cobrindo o mês do relatório
    let bancoHtml = '';
    if (BAN && BAN.txs.length) {
      const doMes = BAN.txs.filter(t => t.mes === k);
      if (doMes.length >= 5) {
        const ent = U.sum(doMes.filter(t => t.valor > 0), t => t.valor);
        const sai = U.sum(doMes.filter(t => t.valor < 0), t => Math.abs(t.valor));
        const tarifasMes = U.sum(doMes.filter(t => DB.banco.categoria(t.memo, t.valor) === 'tarifa'), t => Math.abs(t.valor));
        const c = BAN.custoAntecipacao;
        const linhas = [
          `<tr><td>Entrou na conta</td><td class="rp-num">${U.brl(ent)}</td></tr>`,
          `<tr><td>Saiu da conta</td><td class="rp-num">${U.brl(-sai)}</td></tr>`,
          `<tr class="rp-sub"><td>= Movimento líquido do banco</td><td class="rp-num">${U.brl(ent - sai)}</td></tr>`,
          `<tr><td>Tarifas bancárias no mês</td><td class="rp-num">${U.brl(-tarifasMes)}</td></tr>`,
        ].join('');
        const antecTexto = c
          ? `<p>Recebemos as vendas de crédito por antecipação (à vista), em vez de esperar ~30 dias. Isso tem um custo estimado de <strong>${U.brl(c.custoMensalEst)}/mês</strong> (deságio de ${pct(c.desagioPct)} sobre o crédito) — o preço de ter o dinheiro na hora. Vale a pena enquanto for mais barato que um capital de giro; com o fim do financiamento Tortelli em novembro, dá para reavaliar.</p>`
          : '';
        bancoHtml = `<div class="rp-sec"><h3>Realidade do caixa (extrato bancário)</h3>
          <table class="rp-tabela"><tbody>${linhas}</tbody></table>
          ${antecTexto}
          <p class="rp-nota">Valores efetivamente movimentados na conta Santander no mês — o que de fato caiu e saiu, além do resultado contábil da planilha.</p></div>`;
      }
    }

    const overlay = U.el(`<div id="report-overlay">
      <div class="rp-acoes no-print">
        <button class="side-btn" id="rp-print"><i class="bi bi-file-earmark-pdf"></i> Salvar em PDF</button>
        <button class="side-btn" id="rp-close"><i class="bi bi-x-lg"></i> Fechar</button>
        <span class="dim">No celular: Compartilhar → Salvar como PDF. No PC: destino "Salvar como PDF".</span>
      </div>
      <div class="rp-pagina">
        <header class="rp-head">
          <img src="logo.png" alt="Gelateria Dubelato" class="logo-img logo-rp">
          <div><h1>Resumo Executivo</h1><p>${U.ymLabelFull(k)} — gerado em ${hoje.toLocaleDateString('pt-BR')} às ${hoje.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p></div>
        </header>
        <div class="rp-kpis">${kpis}</div>
        ${metasHtml}
        ${analiseHtml}
        <div class="rp-sec">${dreHtml}</div>
        ${bancoHtml}
        <div class="rp-sec"><h3>Custos vs referência do setor</h3>${raioHtml}</div>
        <footer class="rp-foot">Dubelato BI — il gelato rende felici · documento gerado automaticamente a partir da planilha de controle</footer>
      </div>
    </div>`);
    document.body.appendChild(overlay);
    document.body.classList.add('report-open');
    overlay.querySelector('#rp-close').addEventListener('click', fecharRelatorio);
    overlay.querySelector('#rp-print').addEventListener('click', () => window.print());
  }

  function fecharRelatorio() {
    const o = document.getElementById('report-overlay');
    if (o) o.remove();
    document.body.classList.remove('report-open');
  }

  function viewAntecipacao(main) {
    if (!BAN || !BAN.custoAntecipacao) {
      const falta = !BANCO ? 'o extrato bancário (aba Banco)' : !GETNET ? 'os dados da Getnet (aba Getnet)' : 'dados suficientes';
      main.innerHTML = card('Custo da antecipação', `<p class="note">Esta análise cruza o que a Getnet apurou de crédito com o que caiu na conta pela antecipação. Falta carregar ${falta} para calcular. Assim que as duas fontes cobrirem o mesmo período, o custo mês a mês aparece aqui.</p>`);
      return;
    }
    const A = BAN, c = A.custoAntecipacao;

    // card comparativo (período de sobreposição)
    const max = Math.max(c.brutoCredito, c.liquidoSemAntecipacao, c.recebidoComAntecipacao) || 1;
    const w = v => (v / max * 100).toFixed(1);
    const barra = (rotulo, valor, sub, cor) => `
      <div class="antec-row"><div class="antec-lbl">${rotulo}<span class="dim">${sub}</span></div>
        <div class="antec-track"><div class="antec-fill" style="width:${w(valor)}%;background:${cor}"></div>
          <span class="antec-val">${U.brl(valor)}</span></div></div>`;

    // histórico mensal
    const completos = A.antecMesesCompletos || [];
    const custoMedioMes = completos.length ? U.avg(completos.map(m => m.custo)) : c.custoMensalEst;
    let histHtml;
    if (completos.length) {
      const rows = completos.map(m => `<tr>
        <td><strong>${U.ymLabelFull(m.mes)}</strong></td>
        <td class="mono right">${U.brl(m.liquidoSemAntecipacao)}</td>
        <td class="mono right">${U.brl(m.recebidoComAntecipacao)}</td>
        <td class="mono right neg"><strong>${U.brl(m.custo)}</strong></td>
        <td class="mono right">${U.pct(m.desagioPct)}</td>
      </tr>`).join('');
      histHtml = `<div class="table-wrap"><table>
        <thead><tr><th>Mês</th><th class="right">Sem antecipar</th><th class="right">Recebido à vista</th><th class="right">Custo</th><th class="right">Deságio</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <div class="chart-box" style="margin-top:14px"><canvas id="ch-antec-mes"></canvas></div>`;
    } else {
      // ainda não há mês fechado nas duas fontes — mostra os parciais com aviso
      const rows = A.antecipacaoMensal.map(m => `<tr class="${m.completo ? '' : 'dim-row'}">
        <td><strong>${U.ymLabel(m.mes)}</strong> ${m.completo ? '' : '<span class="chip">cobertura parcial</span>'}</td>
        <td class="mono right">${U.brl(m.liquidoSemAntecipacao)}</td>
        <td class="mono right">${m.recebidoComAntecipacao > 0 ? U.brl(m.recebidoComAntecipacao) : '<span class="dim">sem extrato</span>'}</td>
        <td class="mono right ${m.completo ? 'neg' : 'dim'}">${m.recebidoComAntecipacao > 0 ? U.brl(m.custo) : '—'}</td>
      </tr>`).join('');
      histHtml = `<div class="alerta warn"><i class="bi bi-info-circle"></i><div>
        <strong>Ainda não há um mês fechado com as duas fontes</strong>
        <p>Para o custo mensal ser exato, preciso da Getnet <em>e</em> do extrato bancário cobrindo o mesmo mês inteiro. Hoje o extrato começa em ${U.fmtDate(A.ini)}, então junho e julho estão parciais. Assim que você trouxer um OFX de um mês fechado (ex.: agosto inteiro) junto do relatório Getnet do mesmo mês, a tabela abaixo passa a mostrar o valor exato por mês.</p></div></div>
        <div class="table-wrap"><table>
        <thead><tr><th>Mês</th><th class="right">Crédito vendido (Getnet)</th><th class="right">Antecipado (OFX)</th><th class="right">Custo</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="note">Enquanto não há mês fechado, a melhor estimativa vem da sobreposição atual: <strong>~${U.brl(c.custoMensalEst)}/mês</strong> (${U.pct(c.desagioPct)} de deságio).</p>`;
    }

    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-cash-coin', label: 'Custo médio por mês', valor: U.brl(custoMedioMes), sub: completos.length ? completos.length + ' meses fechados' : 'estimativa', invert: true, cls: 'kpi-warn' })}
        ${kpiCard({ icon: 'bi-percent', label: 'Deságio do crédito', valor: U.pct(c.desagioPct), sub: 'faixa ' + U.pct(c.faixaMin) + '–' + U.pct(c.faixaMax) })}
        ${kpiCard({ icon: 'bi-graph-down-arrow', label: 'Custo projetado no ano', valor: U.brl(custoMedioMes * 12), invert: true })}
        ${kpiCard({ icon: 'bi-credit-card-2-front', label: 'Crédito antecipado/mês', valor: U.brl(c.liqCredMes) })}
      </div>
      ${card('Sem antecipar × antecipando — período de ' + U.fmtDate(c.bloco.de) + ' a ' + U.fmtDate(c.bloco.ate), `
        <div class="antec-comp">
          ${barra('Vendas de crédito (bruto)', c.brutoCredito, 'valor cheio no crédito', 'var(--tx-3)')}
          ${barra('Sem antecipar — receberia em ~30 dias', c.liquidoSemAntecipacao, 'já sem a taxa da maquininha', 'var(--teal)')}
          ${barra('Antecipando — recebeu à vista', c.recebidoComAntecipacao, 'entrou pela conta', 'var(--gold)')}
        </div>
        <div class="antec-resumo">
          <div><span class="dim">Diferença no período</span><strong class="neg">− ${U.brl(c.custoNoPeriodo)}</strong></div>
          <div><span class="dim">Deságio</span><strong>${U.pct(c.desagioPct)}</strong></div>
        </div>`)}
      ${card('Quanto a antecipação custa por mês', histHtml)}
      ${card('O que fazer com isso', `<p class="note">A antecipação faz sentido enquanto o custo (${U.pct(c.desagioPct)} ao mês sobre o crédito) for menor que o de um capital de giro equivalente ou que a falta de caixa custaria em juros/atrasos. Com a parcela do Tortelli terminando em novembro, o caixa alivia ~R$ 13 mil/mês — momento ideal para testar segurar parte da agenda em vez de antecipar 100% e economizar esse deságio. Cada 25% da agenda que você deixar de antecipar economiza ~${U.brl(custoMedioMes * 0.25)}/mês.</p>`)}`;

    if (completos.length) {
      const p = DB.charts.palette();
      DB.charts.barras('ch-antec-mes', completos.map(m => U.ymLabel(m.mes)), [
        { label: 'Custo da antecipação', data: completos.map(m => m.custo), color: p.amarena },
      ], { unidades: false });
    }
  }

  function viewConsultoria(main) {
    // garante que o fluxo foi calculado (a consultoria depende dele)
    if (!FLUXO_RESUMO && BAN && BAN.saldoDiario && BAN.saldoDiario.length >= 5) {
      // renderiza o fluxo invisível uma vez para popular FLUXO_RESUMO
      const tmp = document.createElement('div');
      try { viewFluxoReal(tmp); } catch (e) { /* ignora */ }
    }
    const plano = DB.consultoria.gerar(M, GAN, BAN, FLUXO_RESUMO);
    const iconePor = { ok: 'bi-check-circle', info: 'bi-info-circle', warn: 'bi-exclamation-triangle', bad: 'bi-exclamation-octagon' };

    // ---- 1. Onde melhorar ----
    const prioBadge = { alta: '<span class="badge bad">prioridade alta</span>', media: '<span class="badge warn">média</span>', info: '<span class="badge">informativo</span>' };
    const melhoriasHtml = plano.melhorias.length ? plano.melhorias.map(m => `
      <div class="consel">
        <div class="consel-head">
          <strong>${U.esc(m.titulo)}</strong>
          ${m.impacto ? `<span class="consel-impacto">${U.brl(m.impacto)}/mês em jogo</span>` : ''}
        </div>
        <div class="consel-head" style="margin:2px 0 8px">${prioBadge[m.prioridade] || ''}</div>
        <p>${m.texto}</p>
      </div>`).join('') : '<div class="alerta ok"><i class="bi bi-check-circle"></i><div><p>Nenhum grupo de custo está fora da referência. Estrutura saudável.</p></div></div>';

    // ---- 2. Segurança de caixa ----
    const segHtml = plano.seguranca.pontos.map(p =>
      `<div class="alerta ${p.tipo}"><i class="bi ${iconePor[p.tipo] || 'bi-dot'}"></i><div><p>${p.texto}</p></div></div>`).join('');

    // ---- 3. Retirada ----
    const r = plano.retirada;
    const retiradaCard = `
      <div class="retirada-box ${r.podeRetirar ? 'pode' : 'espere'}">
        <div class="retirada-icone"><i class="bi ${r.podeRetirar ? 'bi-cash-coin' : 'bi-pause-circle'}"></i></div>
        <div>
          <div class="retirada-titulo">${r.podeRetirar ? `Pode retirar até ${U.brl(r.valorSugerido)} agora` : 'Melhor não retirar neste momento'}</div>
          <p>${r.texto}</p>
          ${r.detalhe.map(d => `<p class="dim">${d.texto}</p>`).join('')}
        </div>
      </div>
      ${r.mesesBons.length ? `<p class="note">Historicamente, os meses de melhor resultado (bons candidatos para distribuir lucro) foram: ${r.mesesBons.map(m => `<strong>${U.ymLabel(m.mes)}</strong> (${U.brl(m.resultado)})`).join(', ')}. Meses de alta temporada (verão) tendem a permitir retiradas maiores; no inverno, segure mais.</p>` : ''}`;

    main.innerHTML = `
      ${card('<i class="bi bi-clipboard2-pulse"></i> Onde você pode melhorar', melhoriasHtml)}
      ${card('<i class="bi bi-shield-check"></i> Segurança do caixa — como não ficar no vermelho', segHtml || '<p class="note">Carregue o extrato bancário para a análise de segurança de caixa.</p>')}
      ${card('<i class="bi bi-wallet2"></i> Dá para tirar dinheiro pro bolso?', retiradaCard)}
      <p class="note dim">Análise gerada a partir dos seus dados reais (planilha, Getnet e extrato). Recomendações são orientações, não garantias — o dono decide com o contexto que só ele tem.</p>`;
  }

  function viewConsultoriaAntiga(main) {
    const paras = DB.analytics.resumoExecutivo(M, INV);
    const ins = DB.analytics.insights(M, INV);
    const iconePor = { ok: 'bi-check-circle', info: 'bi-info-circle', warn: 'bi-exclamation-triangle', bad: 'bi-exclamation-octagon' };

    main.innerHTML = `
      ${card('<i class="bi bi-stars"></i> Resumo executivo',
        `<div class="resumo">${(Array.isArray(paras) ? paras : [paras]).map(p => `<p>${p}</p>`).join('')}</div>
         <p class="note dim">Gerado automaticamente a partir da planilha — os dados não saem do seu navegador.</p>`)}
      ${card('Insights', `<div class="alerta-list">${ins.map(i =>
        `<div class="alerta ${i.tipo}"><i class="bi ${iconePor[i.tipo] || 'bi-dot'}"></i><div><p>${i.texto}</p></div></div>`).join('')}</div>`)}`;
  }

  function viewAlertas(main) {
    const cardErros = (M.suspeitos && M.suspeitos.length) ? card('<i class="bi bi-exclamation-triangle"></i> Possíveis erros de digitação na planilha', `
        <p class="note">Encontrei ${M.suspeitos.length} lançamento(s) que parecem ter data ou valor digitado errado. Os que estão com data fora do período de operação foram excluídos dos cálculos; os demais continuam contando, mas vale conferir. Corrija na planilha e republique.</p>
        <div class="table-wrap"><table><thead><tr><th>Data digitada</th><th>Descrição</th><th class="right">Valor</th><th>O que parece errado</th></tr></thead><tbody>
        ${M.suspeitos.map(t => `<tr>
          <td class="mono warn-text">${U.fmtDate(t.date)}</td>
          <td>${U.esc(t.desc || '—')}</td>
          <td class="mono right">${t.tipo === 'Entrada' ? '+' : '−'} ${U.brl(t.valor)}</td>
          <td class="dim" style="font-size:12.5px">${U.esc(t._motivo || 'data fora do período')}</td>
        </tr>`).join('')}
        </tbody></table></div>
        <p class="note">Dica: os erros de <strong>ano</strong> (ex.: 2012 no lugar de 2026) são os mais comuns — o dígito escapa na digitação. Procure a linha pela descrição e o valor na sua planilha, corrija a data e republique.</p>`) : '';
    main.innerHTML = cardErros + card('Central de alertas', `<div class="alerta-list">${ALERTAS.map(alertaHtml).join('')}</div>`);
  }

  function alertaHtml(a) {
    return `<div class="alerta ${a.level}"><i class="bi ${a.icon}"></i><div><strong>${a.title}</strong><p>${a.text}</p></div></div>`;
  }

  function viewConfig(main) {
    const abas = M.abas.map(a => `<tr><td>${U.esc(a.name)}</td><td><span class="chip">${U.esc(a.tipo)}</span></td></tr>`).join('');
    main.innerHTML = `
      ${card('Fonte de dados', `
        <p class="note">Planilha carregada: <strong>${U.esc($('#file-name').textContent || '—')}</strong> · ${M.txs.length} lançamentos em ${M.meses.length} meses.</p>
        <p class="note">Para atualização automática no GitHub Pages, salve a planilha como <code>Controle_Financeiro_Dubelato.xlsx</code> no repositório. Você também pode carregar manualmente pelo botão <strong>Planilha</strong> no menu.</p>`)}
      ${card('Abas reconhecidas', `<div class="table-wrap"><table><thead><tr><th>Aba</th><th>Interpretação</th></tr></thead><tbody>${abas}</tbody></table></div>`)}
      ${card('Tortelli / Celso', `<p class="note">Com a chave <strong>“Tortelli como investimento”</strong> (menu lateral) ligada, os pagamentos das categorias Tortelli e Celso saem do resultado operacional e passam a ser tratados como aporte/financiamento — o caixa continua refletindo tudo.</p>`)}
      ${M.avisos.length ? card('Avisos de leitura', M.avisos.map(a => `<p class="note warn-text">${U.esc(a)}</p>`).join('')) : ''}`;
  }
})();
