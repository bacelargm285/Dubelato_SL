/* ============================================================
   Dubelato BI — clima.js
   Clima × Vendas: busca temperatura e chuva históricas de
   São Lourenço-MG (Open-Meteo, gratuito, sem chave, direto do
   navegador), cruza com a venda diária da planilha e projeta a
   demanda dos próximos 7 dias combinando dia da semana + clima.
   Histórico é imutável → fica em cache no navegador.
   ============================================================ */
window.DB = window.DB || {};

DB.clima = (function () {
  const U = DB.utils;
  const LAT = -22.1168, LON = -45.0545; // São Lourenço - MG
  const TZ = 'America/Sao_Paulo';
  const CACHE_KEY = 'db_clima_cache_v1';

  const FAIXAS = [
    { id: 'frio', label: 'Frio (< 18°)', max: 18 },
    { id: 'ameno', label: 'Ameno (18–23°)', max: 23 },
    { id: 'quente', label: 'Quente (23–27°)', max: 27 },
    { id: 'muitoquente', label: 'Muito quente (> 27°)', max: Infinity },
  ];
  function faixaDe(t) { return FAIXAS.find(f => t < f.max); }

  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  /* ---------- API Open-Meteo ---------- */

  async function historico(minDate, maxDate) {
    const ini = ymd(minDate), fim = ymd(maxDate);
    // cache: o passado não muda
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.ini === ini && c.fim === fim) return c.dias;
    } catch { /* ignora cache corrompido */ }
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}` +
      `&start_date=${ini}&end_date=${fim}&daily=temperature_2m_max,temperature_2m_mean,precipitation_sum&timezone=${TZ}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Serviço de clima indisponível (' + res.status + ')');
    const j = await res.json();
    const dias = {};
    (j.daily?.time || []).forEach((t, i) => {
      dias[t] = {
        tmax: j.daily.temperature_2m_max[i],
        tmed: j.daily.temperature_2m_mean[i],
        chuva: j.daily.precipitation_sum[i],
      };
    });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ini, fim, dias })); } catch { /* sem espaço */ }
    return dias;
  }

  async function previsao7d() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&daily=temperature_2m_max,precipitation_sum,precipitation_probability_max&forecast_days=7&timezone=${TZ}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Serviço de previsão indisponível (' + res.status + ')');
    const j = await res.json();
    return (j.daily?.time || []).map((t, i) => ({
      data: new Date(t + 'T12:00:00'),
      tmax: j.daily.temperature_2m_max[i],
      chuva: j.daily.precipitation_sum[i],
      probChuva: j.daily.precipitation_probability_max?.[i] ?? null,
    }));
  }

  /* ---------- vendas diárias da planilha ---------- */

  function vendasPorDia(M) {
    const porDia = {};
    for (const t of M.txs) {
      if (t.tipo !== 'Entrada') continue;
      if (t.grupo !== 'receitaBalcao' && t.grupo !== 'receitaIfood') continue;
      const k = ymd(t.date);
      porDia[k] = (porDia[k] || 0) + t.valor;
    }
    return porDia;
  }

  /* ---------- análise ---------- */

  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 8) return null;
    const mx = U.avg(xs), my = U.avg(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
    return dx && dy ? num / Math.sqrt(dx * dy) : null;
  }

  /**
   * Cruza clima histórico + calendário turístico com vendas diárias.
   * Fatores de calendário são medidos por RESÍDUO: quanto o dia vendeu
   * além do esperado para aquele dia da semana + temperatura — assim
   * feriadão que cai em domingo quente não conta o efeito em dobro.
   */
  function analisar(M, diasClima) {
    const vendas = vendasPorDia(M);
    const anos = Object.keys(vendas).map(k => +k.slice(0, 4));
    const mapaCal = DB.calendario.construirMapa(Math.min(...anos), Math.max(...anos) + 1);

    const pontos = [];
    for (const [k, v] of Object.entries(vendas)) {
      const c = diasClima[k];
      if (!c || c.tmax == null || v <= 0) continue;
      const d = new Date(k + 'T12:00:00');
      const ctx = DB.calendario.classificar(d, mapaCal);
      pontos.push({ k, data: d, dow: d.getDay(), venda: v, tmax: c.tmax, chuva: c.chuva ?? 0, ctx });
    }
    if (pontos.length < 14) return null;

    const mediaGeral = U.avg(pontos.map(p => p.venda));

    // faixas de temperatura
    const porFaixa = FAIXAS.map(f => ({ ...f, dias: [], media: null }));
    for (const p of pontos) porFaixa.find(f => f.id === faixaDe(p.tmax).id).dias.push(p);
    for (const f of porFaixa) f.media = f.dias.length ? U.avg(f.dias.map(p => p.venda)) : null;

    // chuva forte × dia seco
    const chuvosos = pontos.filter(p => p.chuva >= 5);
    const secos = pontos.filter(p => p.chuva < 1);
    const mediaChuva = chuvosos.length >= 5 ? U.avg(chuvosos.map(p => p.venda)) : null;
    const mediaSeco = secos.length >= 5 ? U.avg(secos.map(p => p.venda)) : null;

    // correlação temperatura × venda
    const r = pearson(pontos.map(p => p.tmax), pontos.map(p => p.venda));

    // fatores base: dia da semana e faixa de temperatura
    const fatorDow = Array.from({ length: 7 }, (_, d) => {
      const ds = pontos.filter(p => p.dow === d);
      return ds.length >= 3 ? U.avg(ds.map(p => p.venda)) / mediaGeral : 1;
    });
    const fatorFaixa = {};
    for (const f of porFaixa) fatorFaixa[f.id] = f.media ? f.media / mediaGeral : 1;
    const fatorChuva = (mediaChuva && mediaSeco) ? mediaChuva / mediaSeco : 1;

    // fatores de CALENDÁRIO por resíduo (venda ÷ esperado dow×clima)
    const residuos = {};
    for (const p of pontos) {
      const esperado = mediaGeral * fatorDow[p.dow] * (fatorFaixa[faixaDe(p.tmax).id] || 1);
      if (esperado <= 0) continue;
      (residuos[p.ctx.contexto] = residuos[p.ctx.contexto] || []).push(p.venda / esperado);
    }
    const fatorContexto = {}, contextos = [];
    for (const ctxId of DB.calendario.ORDEM) {
      const rs = residuos[ctxId] || [];
      const fator = rs.length >= 4 ? U.avg(rs) : (ctxId === 'normal' ? 1 : null);
      fatorContexto[ctxId] = fator ?? 1; // sem amostra suficiente → neutro
      contextos.push({ id: ctxId, rotulo: DB.calendario.ROTULOS[ctxId], dias: rs.length, fator: fator, medido: rs.length >= 4 });
    }
    // normaliza para o "normal" = 1
    const base = fatorContexto.normal || 1;
    for (const k2 of Object.keys(fatorContexto)) fatorContexto[k2] /= base;
    contextos.forEach(c => { if (c.fator != null) c.fator /= base; });

    return { pontos, mediaGeral, porFaixa, mediaChuva, mediaSeco, nChuvosos: chuvosos.length, nSecos: secos.length, r, fatorDow, fatorFaixa, fatorChuva, fatorContexto, contextos, mapaCal };
  }

  /** Previsão de demanda: média × dia da semana × temperatura × chuva × calendário */
  function preverDemanda(analise, prev) {
    return prev.map(p => {
      const fx = faixaDe(p.tmax);
      const ctx = DB.calendario.classificar(p.data, analise.mapaCal);
      let est = analise.mediaGeral
        * analise.fatorDow[p.data.getDay()]
        * (analise.fatorFaixa[fx.id] || 1)
        * (analise.fatorContexto[ctx.contexto] || 1);
      const chove = (p.probChuva != null && p.probChuva >= 60) || p.chuva >= 5;
      if (chove) est *= analise.fatorChuva;
      return { ...p, faixa: fx, ctx, chove, estimativa: est };
    });
  }

  return { historico, previsao7d, analisar, preverDemanda, FAIXAS, faixaDe };
})();
