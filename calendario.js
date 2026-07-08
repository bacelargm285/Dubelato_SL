/* ============================================================
   Dubelato BI — calendario.js
   Calendário turístico: feriados nacionais (fixos e móveis via
   Páscoa), feriadões (janela emendada com o fim de semana),
   datas comemorativas de movimento e férias escolares.
   Classifica qualquer dia — passado (para medir o efeito real
   nas vendas) ou futuro (para prever demanda).
   ============================================================ */
window.DB = window.DB || {};

DB.calendario = (function () {
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  /** Páscoa (algoritmo de Meeus/Butcher) */
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100,
      d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451),
      mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(ano, mes - 1, dia);
  }

  /** Feriados do ano (nacionais + São Lourenço) */
  function feriados(ano) {
    const P = pascoa(ano);
    const lista = [
      { d: new Date(ano, 0, 1), nome: 'Confraternização' },
      { d: addDias(P, -48), nome: 'Carnaval (seg)' },
      { d: addDias(P, -47), nome: 'Carnaval' },
      { d: addDias(P, -2), nome: 'Sexta-feira Santa' },
      { d: P, nome: 'Páscoa' },
      { d: new Date(ano, 3, 21), nome: 'Tiradentes' },
      { d: new Date(ano, 4, 1), nome: 'Dia do Trabalho' },
      { d: addDias(P, 60), nome: 'Corpus Christi' },
      { d: new Date(ano, 7, 10), nome: 'São Lourenço (padroeiro)' },
      { d: new Date(ano, 8, 7), nome: 'Independência' },
      { d: new Date(ano, 9, 12), nome: 'N. Sra. Aparecida / Crianças' },
      { d: new Date(ano, 10, 2), nome: 'Finados' },
      { d: new Date(ano, 10, 15), nome: 'Proclamação da República' },
      { d: new Date(ano, 10, 20), nome: 'Consciência Negra' },
      { d: new Date(ano, 11, 25), nome: 'Natal' },
    ];
    return lista;
  }

  /** Datas comemorativas de movimento (não são feriado, mas enchem gelateria) */
  function comemorativas(ano) {
    // 2º domingo de maio (Mães) e de agosto (Pais)
    const segundoDomingo = mes => { const d = new Date(ano, mes, 1); const off = (7 - d.getDay()) % 7; return new Date(ano, mes, 1 + off + 7); };
    return [
      { d: segundoDomingo(4), nome: 'Dia das Mães' },
      { d: new Date(ano, 5, 12), nome: 'Dia dos Namorados' },
      { d: segundoDomingo(7), nome: 'Dia dos Pais' },
      { d: new Date(ano, 9, 12), nome: 'Dia das Crianças' },
    ];
  }

  /** Férias escolares (aproximação Brasil): janeiro, julho e 15/dez em diante */
  function ehFeriasEscolares(d) {
    const m = d.getMonth();
    return m === 0 || m === 6 || (m === 11 && d.getDate() >= 15);
  }

  /** Janela de feriadão: emenda o feriado com o fim de semana vizinho */
  function janelaFeriadao(fer) {
    const dow = fer.d.getDay(); // 0=Dom
    const dias = [fer.d];
    if (dow === 2) { dias.push(addDias(fer.d, -1), addDias(fer.d, -2), addDias(fer.d, -3)); }        // ter → sáb-dom-seg
    else if (dow === 4) { dias.push(addDias(fer.d, 1), addDias(fer.d, 2), addDias(fer.d, 3)); }      // qui → sex-sáb-dom
    else if (dow === 1) { dias.push(addDias(fer.d, -1), addDias(fer.d, -2)); }                       // seg → sáb-dom
    else if (dow === 5) { dias.push(addDias(fer.d, 1), addDias(fer.d, 2)); }                         // sex → sáb-dom
    else if (dow === 6) { dias.push(addDias(fer.d, 1)); }                                            // sáb → dom
    else if (dow === 0) { dias.push(addDias(fer.d, -1)); }                                           // dom → sáb
    return dias;
  }

  /** Mapa ymd → contexto para um intervalo de anos */
  function construirMapa(anoIni, anoFim) {
    const mapa = {};
    for (let ano = anoIni; ano <= anoFim; ano++) {
      for (const f of feriados(ano)) {
        for (const d of janelaFeriadao(f)) {
          const k = ymd(d);
          mapa[k] = { contexto: 'feriadao', nome: f.nome };
        }
        // véspera (se não estiver na janela)
        const v = ymd(addDias(f.d, -1));
        if (!mapa[v]) mapa[v] = { contexto: 'vespera', nome: 'véspera de ' + f.nome };
      }
      for (const c of comemorativas(ano)) {
        const k = ymd(c.d);
        if (!mapa[k] || mapa[k].contexto === 'vespera') mapa[k] = { contexto: 'comemorativa', nome: c.nome };
        else mapa[k].nome += ' + ' + c.nome; // ex.: 12/10 é feriado E Dia das Crianças
      }
    }
    return mapa;
  }

  const ORDEM = ['feriadao', 'comemorativa', 'vespera', 'ferias', 'normal'];
  const ROTULOS = {
    feriadao: 'Feriadão', comemorativa: 'Data comemorativa', vespera: 'Véspera de feriado',
    ferias: 'Férias escolares', normal: 'Dia comum',
  };

  /** Classifica uma data: contexto + nome (usa o mapa; férias escolares como fallback) */
  function classificar(d, mapa) {
    const k = ymd(d);
    if (mapa[k]) return mapa[k];
    if (ehFeriasEscolares(d)) return { contexto: 'ferias', nome: 'férias escolares' };
    return { contexto: 'normal', nome: '' };
  }

  return { construirMapa, classificar, feriados, comemorativas, ehFeriasEscolares, pascoa, ORDEM, ROTULOS };
})();
