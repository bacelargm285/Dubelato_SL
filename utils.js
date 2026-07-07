/* ============================================================
   Dubelato BI — utils.js
   Helpers de formatação, datas e strings (sem dependências)
   ============================================================ */
window.DB = window.DB || {};

DB.utils = (function () {
  const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  /** Normaliza texto: minúsculo, sem acentos, sem espaços extras */
  function norm(s) {
    return String(s ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Converte serial Excel ou string em Date (ou null) */
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return v;
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      // serial Excel (base 1900). 25569 = dias até 1970-01-01
      const ms = Math.round((v - 25569) * 86400 * 1000);
      const d = new Date(ms);
      // corrige fuso: serial é "data local"
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    if (typeof v === 'string') {
      const s = v.trim();
      let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (m) {
        let y = +m[3]; if (y < 100) y += 2000;
        return new Date(y, +m[2] - 1, +m[1]);
      }
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    }
    return null;
  }

  /** Converte célula em número (aceita "1.234,56") */
  function toNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).replace(/[R$\s]/g, '');
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /** "2026-03" a partir de Date */
  function ymKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /** "Mar/26" a partir de "2026-03" */
  function ymLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return MESES_ABREV[m - 1] + '/' + String(y).slice(2);
  }

  function ymLabelFull(ym) {
    const [y, m] = ym.split('-').map(Number);
    return MESES_PT[m - 1] + ' de ' + y;
  }

  /** R$ formatado */
  function brl(v, opts) {
    if (v == null || !isFinite(v)) return '—';
    const o = Object.assign({ style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }, opts);
    return v.toLocaleString('pt-BR', o);
  }

  /** R$ compacto (12,4 mil) */
  function brlShort(v) {
    if (v == null || !isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi';
    if (abs >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return brl(v);
  }

  function pct(v, digits = 1) {
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('pt-BR', { maximumFractionDigits: digits }) + '%';
  }

  function fmtDate(d) {
    if (!d) return '—';
    return d.toLocaleDateString('pt-BR');
  }

  /** Variação % entre atual e anterior */
  function delta(cur, prev) {
    if (prev == null || prev === 0 || cur == null) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  }

  function sum(arr, fn) { return arr.reduce((a, x) => a + (fn ? fn(x) : x || 0), 0); }
  function avg(arr, fn) { return arr.length ? sum(arr, fn) / arr.length : 0; }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Nome do mês PT → índice 0-11 (aceita "Março", "marco", "MAIO") */
  function monthIndexFromName(name) {
    const n = norm(name);
    const idx = MESES_PT.findIndex(m => norm(m) === n || norm(m).startsWith(n.slice(0, 3)));
    return idx >= 0 ? idx : null;
  }

  return { norm, toDate, toNum, ymKey, ymLabel, ymLabelFull, brl, brlShort, pct, fmtDate, delta, sum, avg, el, esc, monthIndexFromName, MESES_PT, MESES_ABREV };
})();
