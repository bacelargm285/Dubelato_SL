/* ============================================================
   Dubelato BI — excel.js
   Leitura da planilha (SheetJS). Nunca assume posições fixas:
   detecta abas por conteúdo e colunas por nome de cabeçalho.
   Fallback inteligente para abas sem cabeçalho (ex.: MAIO_26).
   ============================================================ */
window.DB = window.DB || {};

DB.excel = (function () {
  const U = DB.utils;

  // sinônimos de cabeçalho → campo canônico
  const HEADER_MAP = [
    ['data', 'date'],
    ['descricao', 'desc'],
    ['tipo', 'tipo'],
    ['categoria', 'categoria'],
    ['conta', 'conta'],
    ['forma de pagamento', 'forma'], ['forma pagamento', 'forma'], ['forma', 'forma'],
    ['valor', 'valor'],
    ['obs', 'obs'], ['observacao', 'obs'],
    ['mes', 'mes'],
    ['saldo acumulado', 'saldo'], ['saldo', 'saldo'],
  ];

  function mapHeaderCell(cell) {
    const n = U.norm(cell);
    if (!n) return null;
    for (const [key, field] of HEADER_MAP) if (n === key || n.startsWith(key)) return field;
    return null;
  }

  /** Lê a matriz bruta de uma aba */
  function grid(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  }

  /* ---------- 1. ABAS DE LANÇAMENTOS ---------- */

  function findTxHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cols = {};
      (rows[i] || []).forEach((c, j) => {
        const f = mapHeaderCell(c);
        if (f && cols[f] == null) cols[f] = j;
      });
      if (cols.date != null && cols.tipo != null && cols.valor != null) return { rowIdx: i, cols };
    }
    return null;
  }

  /** Fallback: detecta layout canônico por padrão de dados (data na col A, Entrada/Saída na col C) */
  function detectTxByPattern(rows) {
    let hits = 0;
    for (const r of rows.slice(0, 30)) {
      if (!r) continue;
      const d = U.toDate(r[0]);
      const t = U.norm(r[2]);
      if (d && (t === 'entrada' || t === 'saida')) hits++;
    }
    if (hits >= 3) {
      return { rowIdx: -1, cols: { date: 0, desc: 1, tipo: 2, categoria: 3, conta: 4, forma: 5, valor: 6, obs: 8, mes: 9, saldo: 10 } };
    }
    return null;
  }

  function parseTransactions(ws, sheetName) {
    const rows = grid(ws);
    const h = findTxHeader(rows) || detectTxByPattern(rows);
    if (!h) return null;
    const c = h.cols;
    const txs = [];
    for (let i = h.rowIdx + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const date = U.toDate(r[c.date]);
      const valor = U.toNum(r[c.valor]);
      const tipoN = U.norm(r[c.tipo]);
      if (!date || valor == null) continue;
      if (tipoN !== 'entrada' && tipoN !== 'saida') continue;
      const mesCell = c.mes != null ? r[c.mes] : null;
      let mes = null;
      if (typeof mesCell === 'string' && /^\d{4}-\d{1,2}/.test(mesCell.trim())) {
        const [y, m] = mesCell.trim().split('-');
        mes = y + '-' + String(+m).padStart(2, '0');
      } else {
        const md = U.toDate(mesCell);
        mes = md ? U.ymKey(md) : U.ymKey(date);
      }
      txs.push({
        date, mes,
        desc: String(r[c.desc] ?? '').trim(),
        tipo: tipoN === 'entrada' ? 'Entrada' : 'Saída',
        categoria: String(r[c.categoria] ?? 'Sem categoria').trim() || 'Sem categoria',
        conta: String(r[c.conta] ?? '').trim(),
        forma: String(r[c.forma] ?? '').trim(),
        valor: Math.abs(valor),
        obs: String((c.obs != null ? r[c.obs] : '') ?? '').trim(),
        saldoPlanilha: c.saldo != null ? U.toNum(r[c.saldo]) : null,
        aba: sheetName,
      });
    }
    return txs.length >= 3 ? txs : null;
  }

  /* ---------- 2. ESTOQUE (blocos lado a lado) ---------- */

  function parseEstoque(ws) {
    const rows = grid(ws);
    if (!rows.length) return null;
    // acha a linha de cabeçalho com ocorrências repetidas de "categoria"
    let headerIdx = -1, blocks = [];
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const b = [];
      (rows[i] || []).forEach((cell, j) => { if (U.norm(cell) === 'categoria') b.push(j); });
      if (b.length >= 1) { headerIdx = i; blocks = b; break; }
    }
    if (headerIdx < 0) return null;
    const header = rows[headerIdx];
    const items = [];
    for (const start of blocks) {
      // dentro do bloco: item = próxima coluna com "item", qt = "qt", obs opcional
      let itemCol = null, qtCol = null, obsCol = null;
      for (let j = start + 1; j < start + 6 && j < header.length; j++) {
        const n = U.norm(header[j]);
        if (n === 'item' && itemCol == null) itemCol = j;
        else if ((n === 'qt' || n === 'qtd' || n.startsWith('quant')) && qtCol == null) qtCol = j;
        else if (n === 'obs' && obsCol == null) obsCol = j;
        else if (n === 'categoria') break;
      }
      if (itemCol == null || qtCol == null) continue;
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i]; if (!r) continue;
        const item = String(r[itemCol] ?? '').trim();
        if (!item) continue;
        const rawQt = r[qtCol];
        const qt = U.toNum(rawQt);
        items.push({
          categoria: String(r[start] ?? '').trim() || 'Sem categoria',
          item,
          qt,                                   // número ou null
          qtTexto: qt == null && rawQt != null ? String(rawQt).trim() : null, // "1 pacote"
          obs: obsCol != null ? String(r[obsCol] ?? '').trim() : '',
        });
      }
    }
    return items.length ? items : null;
  }

  /* ---------- 3. BOLETOS FUTUROS (blocos mensais lado a lado) ---------- */

  function parseBoletos(ws, refYear) {
    const rows = grid(ws);
    if (rows.length < 3) return null;
    // linha 0: nomes de meses; linha 1: Data/Descrição/Valor por bloco
    let monthRowIdx = -1;
    const monthCols = [];
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      const found = [];
      (rows[i] || []).forEach((cell, j) => {
        const mi = U.monthIndexFromName(cell);
        if (typeof cell === 'string' && mi != null) found.push({ col: j, monthIdx: mi, nome: cell.trim() });
      });
      if (found.length >= 2) { monthRowIdx = i; monthCols.push(...found); break; }
    }
    if (monthRowIdx < 0) return null;
    const subHeader = rows[monthRowIdx + 1] || [];
    const boletos = [];
    for (const mc of monthCols) {
      // localiza Data / Descrição / Valor perto da coluna do mês
      let dCol = null, descCol = null, vCol = null;
      for (let j = Math.max(0, mc.col - 1); j < mc.col + 5 && j < subHeader.length + 2; j++) {
        const n = U.norm(subHeader[j]);
        if (n === 'data' && dCol == null) dCol = j;
        else if (n.startsWith('descri') && descCol == null) descCol = j;
        else if (n === 'valor' && vCol == null) vCol = j;
      }
      if (dCol == null || vCol == null) continue;
      for (let i = monthRowIdx + 2; i < rows.length; i++) {
        const r = rows[i]; if (!r) continue;
        const valor = U.toNum(r[vCol]);
        if (valor == null || valor === 0) continue;
        let day = U.toNum(r[dCol]);
        const asDate = U.toDate(r[dCol]);
        let due = null;
        if (asDate && (day == null || day > 31)) due = asDate;
        else if (day != null && day >= 1 && day <= 31) due = new Date(refYear, mc.monthIdx, Math.round(day));
        boletos.push({
          mesNome: mc.nome,
          mesIdx: mc.monthIdx,
          venc: due,
          desc: String(r[descCol != null ? descCol : dCol + 1] ?? '').trim(),
          valor: Math.abs(valor),
        });
      }
    }
    return boletos.length ? boletos : null;
  }

  /* ---------- 4. CARTÃO DE CRÉDITO ---------- */

  function parseCartao(ws) {
    const rows = grid(ws);
    let hIdx = -1, cols = {};
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const c = {};
      (rows[i] || []).forEach((cell, j) => {
        const n = U.norm(cell);
        if (n === 'data' && c.date == null) c.date = j;
        else if (n === 'valor' && c.valor == null) c.valor = j;
        else if (n.startsWith('descri') && c.desc == null) c.desc = j;
      });
      if (c.date != null && c.valor != null) { hIdx = i; cols = c; break; }
    }
    if (hIdx < 0) return null;
    const items = [];
    for (let i = hIdx + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const date = U.toDate(r[cols.date]);
      const valor = U.toNum(r[cols.valor]);
      if (!date || valor == null) continue;
      items.push({ date, mes: U.ymKey(date), valor: Math.abs(valor), desc: String(r[cols.desc] ?? '').trim() });
    }
    return items.length ? items : null;
  }

  /* ---------- 5. CUBAS (receitas + preços de matéria-prima + produtos) ---------- */

  /** Converte peso de embalagem em kg: "1kg ", "25kg", "2,5kg", "9.8kg", "3,25KG", "5 kg", "30kg" */
  function pesoKg(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const m = U.norm(v).replace(',', '.').match(/([\d.]+)\s*kg/);
    return m ? parseFloat(m[1]) : null;
  }

  function parseCubas(ws) {
    const rows = grid(ws);
    if (!rows.length) return null;

    // detecta cabeçalho de receitas: linha com "sabor" + "item" + ("qtd" ou "proporcao")
    let recCols = null;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const c = {};
      (rows[i] || []).forEach((cell, j) => {
        const n = U.norm(cell);
        if (n === 'sabor') c.sabor = j;
        else if (n === 'item' && c.item == null) c.item = j;
        else if (n === 'qtd') c.qtd = j;
        else if (n.startsWith('proporcao')) c.prop = j;
      });
      if (c.sabor != null && c.item != null && (c.qtd != null || c.prop != null)) { recCols = c; break; }
    }
    if (!recCols) return null;

    // receitas: blocos separados por linhas de cabeçalho repetidas
    const receitas = {}; // sabor -> { base:[{item,qtd}], mescla:[{item,qtd}] }
    for (const r of rows) {
      if (!r) continue;
      const sabor = String(r[recCols.sabor] ?? '').trim();
      const item = String(r[recCols.item] ?? '').trim();
      if (!sabor || !item || U.norm(sabor) === 'sabor') continue;
      const qtd = U.toNum(r[recCols.qtd]);
      if (qtd == null) continue;
      const prop = r[recCols.prop];
      const ehMescla = U.norm(prop) === 'mescla';
      const rec = receitas[sabor] || (receitas[sabor] = { sabor, base: [], mescla: [] });
      (ehMescla ? rec.mescla : rec.base).push({ item, qtd });
    }
    if (!Object.keys(receitas).length) return null;

    // preços de matéria-prima: âncora = célula "peso prod"
    const precos = {}; // norm(item) -> { nome, precoPacote, pesoKg, precoKg }
    let pr = null;
    outer:
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      for (let j = 0; j < (rows[i] || []).length; j++) {
        if (U.norm(rows[i][j]) === 'peso prod') { pr = { row: i, nome: j - 2, preco: j - 1, peso: j, kg: j + 1 }; break outer; }
      }
    }
    if (pr) {
      for (let i = pr.row + 1; i < rows.length; i++) {
        const r = rows[i]; if (!r) continue;
        const nome = String(r[pr.nome] ?? '').trim();
        if (!nome) continue;
        const precoPacote = U.toNum(r[pr.preco]);
        const kgPacote = pesoKg(r[pr.peso]);
        let precoKg = U.toNum(r[pr.kg]);
        if (precoKg == null && precoPacote != null && kgPacote) precoKg = precoPacote / kgPacote;
        precos[U.norm(nome)] = { nome, precoPacote, pesoKg: kgPacote, precoKg };
      }
    }

    // produtos vendidos: âncora = cabeçalho "gramas" com "valor" ao lado
    const produtos = [];
    let pd = null;
    outer2:
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      for (let j = 1; j < (rows[i] || []).length; j++) {
        if (U.norm(rows[i][j]) === 'gramas' && U.norm(rows[i][j + 1]) === 'valor') { pd = { row: i, nome: j - 1, gramas: j, preco: j + 1 }; break outer2; }
      }
    }
    if (pd) {
      for (let i = pd.row + 1; i < rows.length; i++) {
        const r = rows[i]; if (!r) continue;
        const nome = String(r[pd.nome] ?? '').trim();
        const gramas = U.toNum(r[pd.gramas]);
        const preco = U.toNum(r[pd.preco]);
        if (nome && gramas && preco != null) produtos.push({ nome, gramas, preco });
      }
    }

    return { receitas: Object.values(receitas), precos, produtos };
  }

  /* ---------- 6. PRODUÇÃO DE CUBAS (Data | Sabor | Produtor | Quantidade) ---------- */

  function parseProducao(ws, sheetName) {
    const rows = grid(ws);
    let h = null;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const c = {};
      (rows[i] || []).forEach((cell, j) => {
        const n = U.norm(cell);
        if (n === 'data') c.data = j;
        else if (n === 'sabor') c.sabor = j;
        else if (n === 'produtor' || n === 'responsavel') c.produtor = j;
        else if (n.startsWith('quantidade') || n === 'qtd') c.qtd = j;
      });
      if (c.data != null && c.sabor != null && c.qtd != null) { h = { rowIdx: i, c }; break; }
    }
    if (!h) return null;
    const { c } = h;
    const itens = [];
    for (let i = h.rowIdx + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const data = U.toDate(r[c.data]);
      const sabor = String(r[c.sabor] ?? '').trim();
      const qtd = U.toNum(r[c.qtd]);
      if (!data || !sabor || qtd == null || qtd <= 0) continue;
      if (data.getFullYear() < 2020) continue; // linhas fantasma (1899…)
      itens.push({ data, mes: U.ymKey(data), sabor, produtor: String(r[c.produtor] ?? '').trim(), qtd, aba: sheetName });
    }
    return itens.length >= 3 ? itens : null;
  }

  /* ---------- 7. NUTRICIONAL (tabela por 100 g) ---------- */

  function parseNutricional(ws) {
    const rows = grid(ws);
    let h = null;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      const c = {};
      (rows[i] || []).forEach((cell, j) => {
        const n = U.norm(cell);
        if (n === 'sabor') c.sabor = j;
        else if (n === 'kcal') c.kcal = j;
        else if (n.startsWith('vd kcal')) c.vdKcal = j;
        else if (n.startsWith('carboidratos')) c.carb = j;
        else if (n.startsWith('vd carb')) c.vdCarb = j;
        else if (n.startsWith('acucares totais')) c.acucar = j;
        else if (n.startsWith('acucares adicionados')) c.acucarAdic = j;
        else if (n.startsWith('gorduras totais')) c.gord = j;
        else if (n.startsWith('vd gord')) c.vdGord = j;
        else if (n.startsWith('gorduras saturadas')) c.sat = j;
        else if (n.startsWith('vd sat')) c.vdSat = j;
        else if (n.startsWith('proteina')) c.prot = j;
        else if (n.startsWith('vd prot')) c.vdProt = j;
        else if (n.startsWith('fibra')) c.fibra = j;
        else if (n.startsWith('vd fibra')) c.vdFibra = j;
        else if (n.startsWith('sodio')) c.sodio = j;
        else if (n.startsWith('vd sodio')) c.vdSodio = j;
        else if (n.startsWith('contem leite')) c.leite = j;
        else if (n.startsWith('contem acucar')) c.temAcucar = j;
      });
      if (c.sabor != null && c.kcal != null) { h = { rowIdx: i, c }; break; }
    }
    if (!h) return null;
    const { c } = h;
    const g = (r, j) => j != null ? (U.toNum(r[j]) ?? 0) : 0;
    const itens = [];
    for (let i = h.rowIdx + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const sabor = String(r[c.sabor] ?? '').trim();
      if (!sabor || U.toNum(r[c.kcal]) == null) continue;
      itens.push({
        sabor,
        kcal: g(r, c.kcal), vdKcal: g(r, c.vdKcal),
        carb: g(r, c.carb), vdCarb: g(r, c.vdCarb),
        acucar: g(r, c.acucar), acucarAdic: g(r, c.acucarAdic),
        gord: g(r, c.gord), vdGord: g(r, c.vdGord),
        sat: g(r, c.sat), vdSat: g(r, c.vdSat),
        prot: g(r, c.prot), vdProt: g(r, c.vdProt),
        fibra: g(r, c.fibra), vdFibra: g(r, c.vdFibra),
        sodio: g(r, c.sodio), vdSodio: g(r, c.vdSodio),
        leite: U.norm(r[c.leite]) === 'sim',
        temAcucar: U.norm(r[c.temAcucar]) === 'sim',
      });
    }
    return itens.length ? itens : null;
  }

  /* ---------- 8. METAS ---------- */

  function parseMetas(ws) {
    const rows = grid(ws);
    let h = -1, cInd = null, cVal = null;
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      (rows[i] || []).forEach((cell, j) => {
        const n = U.norm(cell);
        if (n === 'indicador') cInd = j;
        else if (n === 'meta' || n === 'valor') cVal = j;
      });
      if (cInd != null && cVal != null) { h = i; break; }
    }
    if (h < 0) return null;
    const metas = {};
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const nome = U.norm(r[cInd]);
      const v = U.toNum(r[cVal]);
      if (!nome || v == null) continue;
      if (nome.startsWith('faturamento')) metas.faturamento = v;
      else if (nome.startsWith('cmv')) metas.cmvPct = v;
      else if (nome.startsWith('folha')) metas.folhaPct = v;
      else if (nome.startsWith('marketing')) metas.marketingPct = v;
      else if (nome.startsWith('resultado')) metas.resultado = v;
    }
    return Object.keys(metas).length ? metas : null;
  }

  /* ---------- ORQUESTRAÇÃO ---------- */

  /**
   * Lê o workbook inteiro e classifica cada aba pelo CONTEÚDO,
   * não pelo nome. Retorna o modelo de dados bruto.
   */
  function parseWorkbook(wb) {
    const model = { txs: [], estoque: [], boletos: [], cartao: [], cubas: null, producao: [], nutricional: null, metas: null, abas: [], avisos: [] };
    const nomes = wb.SheetNames;

    // 1ª passada: lançamentos (para descobrir o ano de referência dos boletos)
    for (const name of nomes) {
      const ws = wb.Sheets[name];
      const n = U.norm(name);
      if (n.includes('detalhado') || n.includes('resumo')) { model.abas.push({ name, tipo: 'resumo (ignorada — recalculado)' }); continue; }
      if (n.includes('cuba') || n.includes('receita') || n.includes('sabor')) {
        const cb = parseCubas(ws);
        if (cb) { model.cubas = cb; model.abas.push({ name, tipo: `cubas (${cb.receitas.length} sabores, ${Object.keys(cb.precos).length} preços, ${cb.produtos.length} produtos)` }); continue; }
      }
      if (n.includes('estoque')) {
        const est = parseEstoque(ws);
        if (est) { model.estoque.push(...est); model.abas.push({ name, tipo: `estoque (${est.length} itens)` }); continue; }
      }
      if (n.includes('cart')) {
        const ct = parseCartao(ws);
        if (ct) { model.cartao.push(...ct); model.abas.push({ name, tipo: `cartão (${ct.length} lançamentos)` }); continue; }
      }
      if (n.includes('meta')) {
        const mt = parseMetas(ws);
        if (mt) { model.metas = mt; model.abas.push({ name, tipo: 'metas (' + Object.keys(mt).length + ' indicadores)' }); continue; }
      }
      if (n.includes('nutri')) {
        const nut = parseNutricional(ws);
        if (nut) { model.nutricional = nut; model.abas.push({ name, tipo: `nutricional (${nut.length} sabores)` }); continue; }
      }
      if (n.includes('boleto')) continue; // 2ª passada
      // produção de cubas (Data|Sabor|Quantidade) — testa antes dos lançamentos
      const prod = parseProducao(ws, name);
      if (prod) { model.producao.push(...prod); model.abas.push({ name, tipo: `produção de cubas (${prod.length} registros)` }); continue; }
      const txs = parseTransactions(ws, name);
      if (txs) { model.txs.push(...txs); model.abas.push({ name, tipo: `lançamentos (${txs.length})` }); }
      else model.abas.push({ name, tipo: 'não reconhecida' });
    }

    // deduplicação: a aba "Lançamentos" pode repetir o mês corrente já copiado
    const seen = new Set();
    model.txs = model.txs.filter(t => {
      const k = [t.mes, +t.date, t.desc, t.tipo, t.valor, t.categoria].join('|');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    model.txs.sort((a, b) => a.date - b.date);

    // saneamento de datas: meses com ≥15 lançamentos definem o intervalo real da
    // operação; datas fora dele (erros de digitação como 1125, 2028…) são
    // separadas em "suspeitos" e listadas em Configurações para correção.
    const porMesQt = {};
    model.txs.forEach(t => porMesQt[t.mes] = (porMesQt[t.mes] || 0) + 1);
    const core = Object.keys(porMesQt).filter(k => porMesQt[k] >= 15).sort();
    model.suspeitos = [];
    if (core.length) {
      const min = core[0], max = core[core.length - 1];
      model.txs = model.txs.filter(t => {
        const ok = t.mes >= min && t.mes <= max;
        if (!ok) model.suspeitos.push(t);
        return ok;
      });
      if (model.suspeitos.length) {
        model.avisos.push(`${model.suspeitos.length} lançamento(s) com data fora do período ${min} a ${max} foram separados (provável erro de digitação do ano). Veja a lista em Configurações e corrija na planilha.`);
      }
    }

    // ano de referência p/ boletos = ano do lançamento mais recente
    const refYear = model.txs.length ? model.txs[model.txs.length - 1].date.getFullYear() : new Date().getFullYear();

    for (const name of nomes) {
      if (!U.norm(name).includes('boleto')) continue;
      const b = parseBoletos(wb.Sheets[name], refYear);
      if (b) { model.boletos.push(...b); model.abas.push({ name, tipo: `boletos futuros (${b.length})` }); }
    }

    if (!model.txs.length) model.avisos.push('Nenhuma aba de lançamentos reconhecida (colunas Data / Tipo / Valor).');
    return model;
  }

  /** Lê um ArrayBuffer e devolve o modelo */
  function fromArrayBuffer(buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    return parseWorkbook(wb);
  }

  /** Lê um arquivo avulso só de cubas (ex.: Valor_da_Cuba.xlsx) */
  function cubasFromArrayBuffer(buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    for (const name of wb.SheetNames) {
      const cb = parseCubas(wb.Sheets[name]);
      if (cb) return cb;
    }
    return null;
  }

  return { fromArrayBuffer, parseWorkbook, parseCubas, cubasFromArrayBuffer };
})();
