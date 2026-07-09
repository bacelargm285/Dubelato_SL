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

  /**
   * Vendas diárias: planilha como fonte principal; dias ANTERIORES ao início
   * da planilha são completados pela Getnet (cartão+PIX), calibrados pela
   * razão planilha÷Getnet medida nos meses em que as duas fontes coexistem
   * (compensa o dinheiro em espécie que a maquininha não vê).
   */
  function vendasPorDia(M, getnet) {
    const porDia = {};
    for (const t of M.txs) {
      if (t.tipo !== 'Entrada') continue;
      if (t.grupo !== 'receitaBalcao' && t.grupo !== 'receitaIfood') continue;
      const k = ymd(t.date);
      porDia[k] = (porDia[k] || 0) + t.valor;
    }
    if (!getnet || !getnet.cartoes || !getnet.cartoes.length) return { porDia, fonteExtra: 0, fatorCal: null };

    // séries getnet por dia e por mês
    const gDia = {}, gMes = {}, pMes = {};
    const add = (mapa, k, v) => mapa[k] = (mapa[k] || 0) + v;
    for (const c of getnet.cartoes) { add(gDia, ymd(c.data), c.bruto); add(gMes, U.ymKey(c.data), c.bruto); }
    for (const p of getnet.pix || []) { add(gDia, ymd(p.data), p.bruto); add(gMes, U.ymKey(p.data), p.bruto); }
    for (const [k, v] of Object.entries(porDia)) add(pMes, k.slice(0, 7), v);

    // fator de calibração: mediana de planilha÷getnet nos meses completos em comum
    const razoes = [];
    for (const m of Object.keys(pMes)) {
      if (gMes[m] && gMes[m] > 5000 && pMes[m] > 5000) razoes.push(pMes[m] / gMes[m]);
    }
    razoes.sort((a, b) => a - b);
    let fatorCal = razoes.length >= 3 ? razoes[Math.floor(razoes.length / 2)] : 1.1;
    fatorCal = Math.min(1.5, Math.max(1, fatorCal));

    // completa apenas dias anteriores ao início da planilha
    const minPlanilha = Object.keys(porDia).sort()[0];
    let fonteExtra = 0;
    for (const [k, v] of Object.entries(gDia)) {
      if (k < minPlanilha && !porDia[k] && v > 0) { porDia[k] = v * fatorCal; fonteExtra++; }
    }
    return { porDia, fonteExtra, fatorCal };
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
  function analisar(M, diasClima, getnet) {
    const { porDia: vendas, fonteExtra, fatorCal } = vendasPorDia(M, getnet);
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

    // ---- LINHA DE BASE LIMPA: dia da semana e temperatura medidos só nos
    // dias comuns, para alta temporada/feriadão não contaminarem a régua ----
    const comuns = pontos.filter(p => p.ctx.contexto === 'normal');
    const basePontos = comuns.length >= 30 ? comuns : pontos;
    const mediaBase = U.avg(basePontos.map(p => p.venda));

    // faixas de temperatura (exibição: todos os dias; modelo: dias comuns)
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

    // fatores base (dias comuns)
    const fatorDow = Array.from({ length: 7 }, (_, d) => {
      const ds = basePontos.filter(p => p.dow === d);
      return ds.length >= 3 ? U.avg(ds.map(p => p.venda)) / mediaBase : 1;
    });
    const fatorFaixa = {};
    for (const f of FAIXAS) {
      const ds = basePontos.filter(p => faixaDe(p.tmax).id === f.id);
      fatorFaixa[f.id] = ds.length >= 5 ? U.avg(ds.map(p => p.venda)) / mediaBase : 1;
    }
    const fatorChuva = (mediaChuva && mediaSeco) ? Math.min(1, mediaChuva / mediaSeco) : 1;

    // fatores de CALENDÁRIO por resíduo (venda ÷ esperado dow×clima), com
    // amortecimento: poucas amostras puxam o fator para o neutro (1.0) —
    // fator = (n·média + K·1) / (n + K). Evita otimismo por amostra pequena.
    const K_SHRINK = 5;
    const residuos = {};
    for (const p of pontos) {
      const esperado = mediaBase * fatorDow[p.dow] * (fatorFaixa[faixaDe(p.tmax).id] || 1);
      if (esperado <= 0) continue;
      (residuos[p.ctx.contexto] = residuos[p.ctx.contexto] || []).push(p.venda / esperado);
    }
    const fatorContexto = { normal: 1 }, contextos = [];
    for (const ctxId of DB.calendario.ORDEM) {
      const rs = residuos[ctxId] || [];
      const bruto = rs.length ? U.avg(rs) : 1;
      const fator = ctxId === 'normal' ? 1 : (rs.length * bruto + K_SHRINK * 1) / (rs.length + K_SHRINK);
      fatorContexto[ctxId] = fator;
      contextos.push({ id: ctxId, rotulo: DB.calendario.ROTULOS[ctxId], dias: rs.length, fator, bruto, medido: rs.length >= 4 });
    }

    return { pontos, fonteExtra, fatorCal, mediaGeral, mediaBase, porFaixa, mediaChuva, mediaSeco, nChuvosos: chuvosos.length, nSecos: secos.length, r, fatorDow, fatorFaixa, fatorChuva, fatorContexto, contextos, mapaCal };
  }

  /** Previsão de demanda: média × dia da semana × temperatura × chuva × calendário */
  function preverDemanda(analise, prev) {
    return prev.map(p => {
      const fx = faixaDe(p.tmax);
      const ctx = DB.calendario.classificar(p.data, analise.mapaCal);
      let est = analise.mediaBase
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
