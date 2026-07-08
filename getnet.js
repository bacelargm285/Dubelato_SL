/* ============================================================
   Dubelato BI — getnet.js
   Cartões (Getnet): lê os PDFs oficiais da maquininha —
   "Extrato de Vendas Consolidado" e "Agenda Financeira" —
   direto no navegador (pdf.js), reconstrói as tabelas mesmo
   com páginas rotacionadas e calcula taxas, ticket médio real,
   recebíveis e o cruzamento com a planilha.
   Os dados ficam salvos no navegador (localStorage).
   ============================================================ */
window.DB = window.DB || {};

DB.getnet = (function () {
  const U = DB.utils;
  const LS_KEY = 'db_getnet_v1';

  /* ---------- extração de texto (pdf.js) ---------- */

  /** Reconstrói as linhas de uma página, tratando rotação de 90/270° */
  async function linhasDaPagina(page) {
    const tc = await page.getTextContent();
    const rot = ((page.rotate % 360) + 360) % 360;
    const rows = new Map(); // rowKey -> [{col, s}]
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      const rowC = (rot === 90 || rot === 270) ? x : -y;
      const colC = (rot === 90 || rot === 270) ? y : x;
      // tolerância: agrupa linhas com ±2pt
      let key = null;
      for (const k of rows.keys()) if (Math.abs(k - rowC) <= 2) { key = k; break; }
      if (key == null) { key = rowC; rows.set(key, []); }
      rows.get(key).push({ col: colC, s: it.str });
    }
    return [...rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, items]) => items.sort((a, b) => a.col - b.col).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim());
  }

  async function extrairLinhas(arrayBuffer) {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const paginas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      paginas.push(await linhasDaPagina(await pdf.getPage(p)));
    }
    return paginas; // array de páginas, cada uma array de linhas
  }

  /* ---------- parsers ---------- */

  const num = s => U.toNum(String(s).replace(/^-?R\$\s?/, '').replace(/^-/, ''));
  const dt = s => { const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };

  const RE_CARTAO = /(\d{2}\/\d{2}\/\d{4}).*?(Amex|Elo|Mastercard|Visa|Hipercard)\s+(Cr[eé]dito|D[eé]bito)\s+(\d+)\s+R\$\s?([\d.,]+)\s+-?\s?R\$\s?([\d.,]+)\s+R\$\s?([\d.,]+)/i;
  const RE_PIX = /(\d{2}\/\d{2}\/\d{4}).*?Centralizador\s+(\d+)\s+R\$\s?([\d.,]+)\s+R\$\s?([\d.,]+)/i;
  const RE_AGENDA = /(\d{2}\/\d{2}\/\d{4}).*?(Amex|Elo|Mastercard|Visa|Hipercard)\s+(Cr[eé]dito|Cr[eé]dito Parcelado|D[eé]bito|Voucher)\s+(\d{2}\/\d{2}\/\d{4})\s+R\$\s?([\d.,]+)/i;

  /** Identifica e parseia um PDF Getnet (vendas ou agenda). */
  function parsearLinhas(paginas) {
    const out = { cartoes: [], pix: [], agenda: [], resumo: {} };
    let secao = null;
    for (const linhas of paginas) {
      for (const l of linhas) {
        if (/Extrato de Vendas Por Cart/i.test(l)) { secao = 'cartoes'; continue; }
        if (/Extrato de Vendas Pix/i.test(l)) { secao = 'pix'; continue; }
        if (/Agenda Financeira/i.test(l)) { secao = 'agenda'; continue; }
        if (/Extrato de Vendas (Recarga|Van|Voucher)/i.test(l)) { secao = null; continue; }
        if (/Extrato Consolidado/i.test(l)) { secao = 'consolidado'; continue; }

        if (secao === 'agenda') {
          const m = l.match(RE_AGENDA);
          if (m) out.agenda.push({ registro: dt(m[1]), bandeira: m[2], modalidade: /d[eé]bito/i.test(m[3]) ? 'Débito' : 'Crédito', venc: dt(m[4]), valor: num(m[5]) });
          const tot = l.match(/Valor total da agenda|Total da agenda/i) ? null : null;
          let mm;
          if ((mm = l.match(/Agenda livre:\s*R\$\s?([\d.,]+)/i))) out.resumo.agendaLivre = num(mm[1]);
          if ((mm = l.match(/Cess[aã]o:\s*R\$\s?([\d.,]+)/i))) out.resumo.cessao = num(mm[1]);
          if ((mm = l.match(/Antecipa[cç][aã]o:\s*R\$\s?([\d.,]+)/i))) out.resumo.antecipacao = num(mm[1]);
          if ((mm = l.match(/R\$\s?([\d.,]+)\s+Valor total da agenda/i)) || (mm = l.match(/Valor total da agenda\s+R\$\s?([\d.,]+)/i))) out.resumo.totalAgenda = num(mm[1]);
        } else if (secao === 'cartoes') {
          const m = l.match(RE_CARTAO);
          if (m) out.cartoes.push({
            data: dt(m[1]), bandeira: m[2],
            modalidade: /d[eé]bito/i.test(m[3]) ? 'Débito' : 'Crédito',
            qtd: +m[4], bruto: num(m[5]), taxa: num(m[6]), liquido: num(m[7]),
          });
        } else if (secao === 'pix') {
          const m = l.match(RE_PIX);
          if (m) out.pix.push({ data: dt(m[1]), qtd: +m[2], bruto: num(m[3]), liquido: num(m[4]) });
        }
      }
    }
    return out;
  }

  /* ---------- parser CSV (exportação do portal Getnet) ---------- */

  /** Decodifica o arquivo tentando UTF-8; se inválido, cai para ISO-8859-1 (padrão Getnet) */
  function decodificar(arrayBuffer) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer); }
    catch { return new TextDecoder('iso-8859-1').decode(arrayBuffer); }
  }

  /**
   * Lê um CSV Getnet (separador ';'), identificando o tipo pelo cabeçalho
   * e as colunas pelo nome — nunca por posição fixa.
   */
  function parsearCsv(arrayBuffer) {
    const out = { cartoes: [], pix: [], agenda: [], resumo: {} };
    const texto = decodificar(arrayBuffer);
    const linhas = texto.split(/\r?\n/).filter(l => l.trim());
    if (!linhas.length) return out;

    const header = linhas[0].split(';').map(h => U.norm(h));
    const col = nome => header.findIndex(h => h.includes(nome));

    const ehAgenda = col('data de vencimento') >= 0;
    const temBandeira = col('bandeira') >= 0;
    const ehVenda = col('data da venda') >= 0;

    if (ehAgenda) {
      const cReg = col('registro'), cBand = col('bandeira'), cMod = col('modalidade'),
            cVenc = col('data de vencimento'), cVal = col('valor');
      for (const l of linhas.slice(1)) {
        const c = l.split(';');
        const venc = dt(c[cVenc] || ''), valor = U.toNum(c[cVal]);
        if (!venc || valor == null) continue;
        out.agenda.push({
          registro: dt(c[cReg] || ''), bandeira: (c[cBand] || '').trim(),
          modalidade: /d[eé]bito/i.test(c[cMod] || '') ? 'Débito' : 'Crédito',
          venc, valor: Math.abs(valor),
        });
      }
    } else if (ehVenda && temBandeira) {
      // extrato de cartões
      const cData = col('data da venda'), cBand = col('bandeira'), cMod = col('modalidade'),
            cQtd = col('quantidade'), cBruto = col('valor bruto'), cTaxa = col('taxa'), cLiq = col('liquido');
      for (const l of linhas.slice(1)) {
        const c = l.split(';');
        const data = dt(c[cData] || ''), bruto = U.toNum(c[cBruto]);
        if (!data || bruto == null) continue;
        out.cartoes.push({
          data, bandeira: (c[cBand] || '').trim(),
          modalidade: /d[eé]bito/i.test(c[cMod] || '') ? 'Débito' : 'Crédito',
          qtd: U.toNum(c[cQtd]) || 0,
          bruto: Math.abs(bruto),
          taxa: Math.abs(U.toNum(c[cTaxa]) || 0),
          liquido: Math.abs(U.toNum(c[cLiq]) ?? bruto),
        });
      }
    } else if (ehVenda) {
      // extrato PIX (sem coluna bandeira)
      const cData = col('data da venda'), cQtd = col('quantidade'), cBruto = col('valor bruto'), cLiq = col('liquido');
      for (const l of linhas.slice(1)) {
        const c = l.split(';');
        const data = dt(c[cData] || ''), bruto = U.toNum(c[cBruto]);
        if (!data || bruto == null) continue;
        out.pix.push({ data, qtd: U.toNum(c[cQtd]) || 0, bruto: Math.abs(bruto), liquido: Math.abs(U.toNum(c[cLiq]) ?? bruto) });
      }
    }
    // CSVs "totais/recarga/van/voucher" não trazem linhas úteis — ignorados (recalculamos tudo)
    return out;
  }

  /* ---------- publicação (arquivo compartilhado no GitHub) ---------- */

  const ARQUIVO_PUBLICO = 'getnet_dados.json';

  /** Gera e baixa o arquivo consolidado para publicar no repositório */
  function exportarJson(dados) {
    const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ARQUIVO_PUBLICO;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /** Busca o arquivo publicado no GitHub Pages (se existir) */
  async function carregarPublicado() {
    try {
      const res = await fetch(ARQUIVO_PUBLICO, { cache: 'no-store' });
      if (!res.ok) return null;
      const d = await res.json();
      const rev = x => Object.assign({}, x, { data: x.data ? new Date(x.data) : null, venc: x.venc ? new Date(x.venc) : null, registro: x.registro ? new Date(x.registro) : null });
      return {
        cartoes: (d.cartoes || []).map(rev),
        pix: (d.pix || []).map(rev),
        agenda: (d.agenda || []).map(rev),
        resumo: d.resumo || {},
        atualizadoEm: d.atualizadoEm ? new Date(d.atualizadoEm) : null,
      };
    } catch { return null; }
  }

  /* ---------- persistência ---------- */

  function carregar() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const rev = x => Object.assign({}, x, { data: x.data ? new Date(x.data) : null, venc: x.venc ? new Date(x.venc) : null, registro: x.registro ? new Date(x.registro) : null });
      return {
        cartoes: (d.cartoes || []).map(rev),
        pix: (d.pix || []).map(rev),
        agenda: (d.agenda || []).map(rev),
        resumo: d.resumo || {},
        atualizadoEm: d.atualizadoEm ? new Date(d.atualizadoEm) : null,
      };
    } catch { return null; }
  }

  function salvar(dados) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(dados)); return true; }
    catch { return false; }
  }

  function limpar() { localStorage.removeItem(LS_KEY); }

  /** Mescla novos dados com os salvos (dedupe); agenda é substituída (é um retrato do futuro). */
  function mesclar(atual, novo) {
    const base = atual || { cartoes: [], pix: [], agenda: [], resumo: {} };
    const key = c => [+c.data, c.bandeira, c.modalidade].join('|');
    const mapa = new Map(base.cartoes.map(c => [key(c), c]));
    for (const c of novo.cartoes) mapa.set(key(c), c);          // relatório novo prevalece
    const mapaPix = new Map(base.pix.map(p => [+p.data, p]));
    for (const p of novo.pix) mapaPix.set(+p.data, p);
    return {
      cartoes: [...mapa.values()].sort((a, b) => a.data - b.data),
      pix: [...mapaPix.values()].sort((a, b) => a.data - b.data),
      agenda: novo.agenda.length ? novo.agenda : base.agenda,
      resumo: Object.assign({}, base.resumo, novo.resumo),
      atualizadoEm: new Date(),
    };
  }

  /* ---------- análise ---------- */

  function analisar(d, modelFinance) {
    if (!d || (!d.cartoes.length && !d.agenda.length)) return null;
    const A = {};
    const hoje = new Date();

    // totais de vendas
    A.cartaoBruto = U.sum(d.cartoes, c => c.bruto);
    A.cartaoTaxa = U.sum(d.cartoes, c => c.taxa);
    A.cartaoLiquido = U.sum(d.cartoes, c => c.liquido);
    A.cartaoQtd = U.sum(d.cartoes, c => c.qtd);
    A.pixBruto = U.sum(d.pix, p => p.bruto);
    A.pixQtd = U.sum(d.pix, p => p.qtd);
    A.taxaMediaPct = A.cartaoBruto ? (A.cartaoTaxa / A.cartaoBruto) * 100 : null;
    A.ticketCartao = A.cartaoQtd ? A.cartaoBruto / A.cartaoQtd : null;
    A.ticketPix = A.pixQtd ? A.pixBruto / A.pixQtd : null;
    A.ticketGeral = (A.cartaoQtd + A.pixQtd) ? (A.cartaoBruto + A.pixBruto) / (A.cartaoQtd + A.pixQtd) : null;

    // por modalidade e bandeira
    A.porMod = {};
    A.porBandeira = {};
    for (const c of d.cartoes) {
      const m = A.porMod[c.modalidade] || (A.porMod[c.modalidade] = { bruto: 0, taxa: 0, qtd: 0 });
      m.bruto += c.bruto; m.taxa += c.taxa; m.qtd += c.qtd;
      const b = A.porBandeira[c.bandeira] || (A.porBandeira[c.bandeira] = { bruto: 0, taxa: 0, qtd: 0, porMod: {} });
      b.bruto += c.bruto; b.taxa += c.taxa; b.qtd += c.qtd;
      const bm = b.porMod[c.modalidade] || (b.porMod[c.modalidade] = { bruto: 0, taxa: 0 });
      bm.bruto += c.bruto; bm.taxa += c.taxa;
    }

    // por mês (taxas = custo mensal da maquininha) e por dia da semana
    A.porMes = {};
    A.porDiaSemana = Array.from({ length: 7 }, () => ({ bruto: 0, dias: new Set() }));
    for (const c of d.cartoes) {
      const k = U.ymKey(c.data);
      const m = A.porMes[k] || (A.porMes[k] = { bruto: 0, taxa: 0, pix: 0, qtd: 0 });
      m.bruto += c.bruto; m.taxa += c.taxa; m.qtd += c.qtd;
      const ds = A.porDiaSemana[c.data.getDay()];
      ds.bruto += c.bruto; ds.dias.add(+c.data);
    }
    for (const p of d.pix) {
      const k = U.ymKey(p.data);
      const m = A.porMes[k] || (A.porMes[k] = { bruto: 0, taxa: 0, pix: 0, qtd: 0 });
      m.pix += p.bruto; m.qtd += p.qtd;
      const ds = A.porDiaSemana[p.data.getDay()];
      ds.bruto += p.bruto; ds.dias.add(+p.data);
    }

    // agenda de recebíveis
    A.agendaTotal = d.resumo.totalAgenda ?? U.sum(d.agenda, a => a.valor);
    A.agendaLivre = d.resumo.agendaLivre ?? null;
    A.cessao = d.resumo.cessao ?? null;
    const fut = d.agenda.filter(a => a.venc && a.venc >= new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
    A.recebiveis = fut.slice().sort((a, b) => a.venc - b.venc);
    const seteDias = new Date(hoje); seteDias.setDate(hoje.getDate() + 7);
    const trintaDias = new Date(hoje); trintaDias.setDate(hoje.getDate() + 30);
    A.receber7 = U.sum(fut.filter(a => a.venc <= seteDias), a => a.valor);
    A.receber30 = U.sum(fut.filter(a => a.venc <= trintaDias), a => a.valor);
    A.recebPorSemana = {};
    for (const a of fut) {
      const monday = new Date(a.venc); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const k = U.ymKey(monday) + '-' + String(monday.getDate()).padStart(2, '0');
      A.recebPorSemana[k] = (A.recebPorSemana[k] || { label: monday.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), total: 0 });
      A.recebPorSemana[k].total += a.valor;
    }

    // cruzamento com a planilha: Vendas (balcão) da planilha vs Getnet (cartão+pix)
    A.cruzamento = [];
    const datasG = d.cartoes.map(c => +c.data).concat(d.pix.map(p => +p.data));
    const minG = datasG.length ? new Date(Math.min(...datasG)) : null;
    const maxG = datasG.length ? new Date(Math.max(...datasG)) : null;
    if (modelFinance) {
      for (const k of Object.keys(A.porMes).sort()) {
        const g = A.porMes[k];
        const m = modelFinance.byMonth[k];
        if (!m) continue;
        const getnet = g.bruto + g.pix;
        // parcial: o relatório não cobre o mês inteiro (começa depois do dia 1 ou termina antes do fim)
        const [y, mo] = k.split('-').map(Number);
        const iniMes = new Date(y, mo - 1, 1), fimMes = new Date(y, mo, 0);
        const parcial = (minG > iniMes && U.ymKey(minG) === k) || (maxG < fimMes && U.ymKey(maxG) === k);
        A.cruzamento.push({ mes: k, planilha: m.vendasBalcao, getnet, diferenca: m.vendasBalcao - getnet, parcial });
      }
    }
    return A;
  }

  return { extrairLinhas, parsearLinhas, parsearCsv, carregar, salvar, limpar, mesclar, analisar, exportarJson, carregarPublicado, ARQUIVO_PUBLICO };
})();
