/* ============================================================
   Dubelato BI — charts.js
   Wrappers do Chart.js com o tema Dubelato (dark/light),
   gradientes e destruição segura ao re-renderizar.
   ============================================================ */
window.DB = window.DB || {};

DB.charts = (function () {
  const U = DB.utils;
  const registry = {}; // id → Chart

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function palette() {
    return {
      text: cssVar('--tx-2'),
      grid: cssVar('--grid'),
      amarena: cssVar('--amarena'),
      pistache: cssVar('--pistache'),
      creme: cssVar('--gold'),
      azul: cssVar('--blue'),
      roxo: cssVar('--purple'),
      series: [cssVar('--pistache'), cssVar('--amarena'), cssVar('--gold'), cssVar('--blue'), cssVar('--purple'), '#e8927c', '#6fc2c7', '#c9a0dc', '#9fb668', '#d4787f'],
    };
  }

  function baseOptions() {
    const p = palette();
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.color = p.text;
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { labels: { usePointStyle: true, pointStyleWidth: 10, boxHeight: 7, padding: 16 } },
        tooltip: {
          backgroundColor: cssVar('--tooltip-bg'),
          titleColor: cssVar('--tx-1'),
          bodyColor: cssVar('--tx-2'),
          borderColor: cssVar('--line'),
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          displayColors: true,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label || ''}: ${U.brl(ctx.parsed.y ?? ctx.parsed)}`,
          },
        },
      },
      scales: {
        x: { grid: { color: 'transparent' }, ticks: { maxRotation: 0 } },
        y: { grid: { color: p.grid }, border: { display: false }, ticks: { callback: v => U.brlShort(v) } },
      },
    };
  }

  function destroy(id) {
    if (registry[id]) { registry[id].destroy(); delete registry[id]; }
  }

  function make(canvasId, config) {
    const el = document.getElementById(canvasId);
    if (!el) return null;
    destroy(canvasId);
    registry[canvasId] = new Chart(el.getContext('2d'), config);
    return registry[canvasId];
  }

  function gradient(ctx, hex, alphaTop = 0.35) {
    const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.clientHeight || 300);
    g.addColorStop(0, hexA(hex, alphaTop));
    g.addColorStop(1, hexA(hex, 0));
    return g;
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /* ---- gráficos prontos ---- */

  function linhaEntradasSaidas(id, labels, entradas, saidas) {
    const p = palette();
    const elc = document.getElementById(id); if (!elc) return;
    const ctx = elc.getContext('2d');
    make(id, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Entradas', data: entradas, borderColor: p.pistache, backgroundColor: gradient(ctx, p.pistache), fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: p.pistache },
          { label: 'Saídas', data: saidas, borderColor: p.amarena, backgroundColor: gradient(ctx, p.amarena, 0.22), fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: p.amarena },
        ],
      },
      options: baseOptions(),
    });
  }

  function barras(id, labels, datasets) {
    const p = palette();
    const ds = datasets.map((d, i) => Object.assign({
      backgroundColor: hexA(d.color || p.series[i % p.series.length], 0.85),
      borderRadius: 8, borderSkipped: false, maxBarThickness: 42,
    }, d));
    const opt = baseOptions();
    make(id, { type: 'bar', data: { labels, datasets: ds }, options: opt });
  }

  function rosca(id, labels, valores, colors) {
    const p = palette();
    const opt = baseOptions();
    delete opt.scales;
    opt.cutout = '68%';
    opt.plugins.legend.position = 'right';
    opt.plugins.tooltip.callbacks.label = ctx => ` ${ctx.label}: ${U.brl(ctx.parsed)}`;
    make(id, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: valores, backgroundColor: colors || p.series, borderWidth: 0, hoverOffset: 8 }] },
      options: opt,
    });
  }

  function linhaProjecao(id, labelsReal, real, labelsProj, projArr) {
    const p = palette();
    const elc = document.getElementById(id); if (!elc) return;
    const ctx = elc.getContext('2d');
    const labels = labelsReal.concat(labelsProj);
    const dataReal = real.concat(Array(labelsProj.length).fill(null));
    const dataProj = Array(labelsReal.length - 1).fill(null).concat([real[real.length - 1]], projArr);
    const opt = baseOptions();
    opt.plugins.tooltip.callbacks.label = ctx => ` ${ctx.dataset.label}: ${U.brl(ctx.parsed.y)}`;
    make(id, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Saldo realizado', data: dataReal, borderColor: p.pistache, backgroundColor: gradient(ctx, p.pistache), fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 2 },
          { label: 'Projeção', data: dataProj, borderColor: p.gold || p.creme, borderDash: [6, 5], tension: 0.3, borderWidth: 2.2, pointRadius: 0, fill: false },
        ],
      },
      options: opt,
    });
  }

  function barrasHoriz(id, labels, valores, color) {
    const p = palette();
    const opt = baseOptions();
    opt.indexAxis = 'y';
    opt.scales = {
      x: { grid: { color: p.grid }, border: { display: false }, ticks: { callback: v => U.brlShort(v) } },
      y: { grid: { color: 'transparent' } },
    };
    opt.plugins.legend.display = false;
    opt.plugins.tooltip.callbacks.label = ctx => ` ${U.brl(ctx.parsed.x)}`;
    make(id, {
      type: 'bar',
      data: { labels, datasets: [{ data: valores, backgroundColor: hexA(color || p.amarena, 0.85), borderRadius: 8, maxBarThickness: 22 }] },
      options: opt,
    });
  }

  return { make, destroy, linhaEntradasSaidas, barras, rosca, linhaProjecao, barrasHoriz, palette, hexA };
})();
