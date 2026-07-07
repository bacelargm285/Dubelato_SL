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
  }

  function initTheme() {
    const saved = localStorage.getItem('db_theme') || 'dark';
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
        dashboard: viewDashboard, fluxo: viewFluxo, entradas: () => viewLancamentos('Entrada'),
        saidas: () => viewLancamentos('Saída'), boletos: viewBoletos, estoque: viewEstoque,
        ifood: viewIfood, funcionarios: viewFuncionarios, marketing: viewMarketing,
        comparativos: viewComparativos, consultoria: viewConsultoria, alertas: viewAlertas, config: viewConfig,
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

    main.innerHTML = `
      <div class="kpi-grid">${kpis}</div>
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
    const k = M.kpi, proj = M.proj;
    const status = proj.primeiroNegativo != null
      ? `<div class="alerta bad"><i class="bi bi-exclamation-octagon"></i><div><strong>Déficit projetado</strong><p>No ritmo atual, o caixa fica negativo em ~${proj.primeiroNegativo} dias.</p></div></div>`
      : `<div class="alerta ok"><i class="bi bi-check-circle"></i><div><strong>Caixa saudável</strong><p>Sem déficit projetado nos próximos 90 dias.</p></div></div>`;

    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-arrow-down-circle', label: 'Entrada média / dia (30d)', valor: U.brl(proj.entDia) })}
        ${kpiCard({ icon: 'bi-arrow-up-circle', label: 'Saída média / dia (30d)', valor: U.brl(proj.saiDia) })}
        ${kpiCard({ icon: 'bi-water', label: 'Fluxo líquido / dia', valor: U.brl(proj.netDia), cls: proj.netDia < 0 ? 'kpi-bad' : '' })}
        ${kpiCard({ icon: 'bi-safe', label: 'Saldo atual', valor: U.brl(k.saldoAtual) })}
      </div>
      ${card('Fluxo realizado × projetado (90 dias)', '<div class="chart-box tall"><canvas id="ch-proj"></canvas></div>' , { right: status ? '' : '' })}
      ${status}
      ${card('Como a projeção é calculada', `<p class="note">A projeção usa a média diária de entradas e saídas dos últimos 30 dias de lançamentos e avança o saldo dia a dia por 90 dias. Os boletos futuros aparecem na aba <strong>Boletos</strong> e já tendem a estar refletidos na média de saídas quando pagos regularmente. Meses incompletos são comparados por ritmo diário, não pelo total.</p>`)}`;

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

    main.innerHTML = `
      <div class="kpi-grid kpi-grid-4">
        ${kpiCard({ icon: 'bi-people', label: 'Folha total do mês', valor: U.brl(m?.folha), sub: m ? U.ymLabel(m.mes) : '' })}
        ${kpiCard({ icon: 'bi-person-badge', label: 'Salários', valor: U.brl(folhaSal) })}
        ${kpiCard({ icon: 'bi-person-plus', label: 'Freelancers', valor: U.brl(folhaFree) })}
        ${kpiCard({ icon: 'bi-percent', label: 'Peso sobre faturamento', valor: m?.folhaPct != null ? U.pct(m.folhaPct) : '—', invert: true, cls: m && m.folhaPct > 30 ? 'kpi-warn' : '' })}
      </div>
      ${card('Folha × faturamento por mês', '<div class="chart-box tall"><canvas id="ch-folha"></canvas></div>')}
      ${card('Leitura', `<p class="note">Como referência de mercado para food service, a folha saudável fica entre 20% e 30% do faturamento. Valores acima de 30% por meses seguidos apertam a margem — avalie escala de freelancers em dias de menor movimento.</p>`)}`;

    const p = DB.charts.palette();
    DB.charts.barras('ch-folha', meses.map(U.ymLabel), [
      { label: 'Faturamento', data: meses.map(k => M.byMonth[k].receita), color: p.pistache },
      { label: 'Folha', data: meses.map(k => M.byMonth[k].folha), color: p.purple },
    ]);
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

  function viewConsultoria(main) {
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
    main.innerHTML = card('Central de alertas', `<div class="alerta-list">${ALERTAS.map(alertaHtml).join('')}</div>`);
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
      ${M.avisos.length ? card('Avisos de leitura', M.avisos.map(a => `<p class="note warn-text">${U.esc(a)}</p>`).join('')) : ''}
      ${M.suspeitos.length ? card('Lançamentos com data suspeita (fora do período da operação)', `
        <p class="note">Estes lançamentos têm ano provavelmente digitado errado e <strong>foram excluídos dos cálculos</strong>. Corrija a data na aba de origem e recarregue a planilha.</p>
        <div class="table-wrap"><table><thead><tr><th>Data digitada</th><th>Descrição</th><th>Aba</th><th class="right">Valor</th></tr></thead><tbody>
        ${M.suspeitos.map(t => `<tr><td class="mono warn-text">${U.fmtDate(t.date)}</td><td>${U.esc(t.desc)}</td><td><span class="chip">${U.esc(t.aba)}</span></td><td class="mono right">${t.tipo === 'Entrada' ? '+' : '−'} ${U.brl(t.valor)}</td></tr>`).join('')}
        </tbody></table></div>`) : ''}`;
  }
})();
