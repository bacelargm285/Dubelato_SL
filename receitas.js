/* ============================================================
   Dubelato BI — receitas.js
   Planejador de produção: lê as receitas (aba Sabores_Receitas),
   cruza com o estoque disponível e conclui quais gelatos dá para
   produzir agora. Prioriza por histórico de vendas/produção e
   destaca sabores nunca feitos (potenciais lançamentos).
   Preparado para, no futuro, rankear por custo quando os preços
   de estoque/receita estiverem preenchidos.
   ============================================================ */
window.DB = window.DB || {};

DB.receitas = (function () {
  const U = DB.utils;

  // Ingredientes tipicamente comprados frescos (feira/hortifruti), fora do
  // estoque de produção controlado — não bloqueiam a produção por padrão.
  const FRESCOS = /abacaxi|amora|ameixa|banana|cenoura|framboesa|goiaba|gengibre|hortela|laranja|lim(a|ã)o|mam(a|ã)o|manga|marolo|morango|maracuj|abacate|coco fresco|figo|melancia|melao|uva|caju fruta|pessego|kiwi|caqui|jabuticaba|frutas vermelhas/i;

  // Insumos básicos de compra semanal garantida (leite, água, açúcar comum) —
  // a loja sempre tem, não são controlados item a item no estoque de produção.
  // NÃO inclui ingredientes especiais (ovomaltine, maltovo, pastas, etc).
  const BASICOS = /leite integral|leite fresco|^leite$|^agua$|^água$|sacarose|acucar refinado|açúcar refinado|acucar cristal|açúcar cristal|^sal$/i;

  /** Constrói o índice de receitas a partir das linhas da aba Sabores_Receitas */
  function build(linhasReceitas) {
    if (!linhasReceitas || !linhasReceitas.length) return null;
    const sabores = {};
    for (const r of linhasReceitas) {
      const nome = (r.sabor || '').trim();
      if (!nome || !r.ingrediente) continue;
      const s = sabores[nome] || (sabores[nome] = { nome, tipo: r.tipo || '', ingredientes: [] });
      s.ingredientes.push({ nome: r.ingrediente.trim(), qtd: r.qtd || 0, unidade: r.unidade || 'g' });
    }
    return { sabores: Object.values(sabores), porNome: sabores };
  }

  /** Normaliza para casar nomes — mantém as palavras que DISTINGUEM os
   *  ingredientes (fresco, pó, em) porque "Leite Fresco" ≠ "Leite em pó". */
  function n(s) {
    return U.norm(s)
      .replace(/[0-9]+\s*%?/g, ' ')            // remove números e %
      .replace(/\b(kg|g|ml|l|gramas?|un)\b/g, ' ') // unidades
      .replace(/\s+/g, ' ').trim();
  }

  // palavras muito genéricas que sozinhas não bastam para casar
  const GENERICAS = new Set(['de', 'em', 'com', 'e', 'do', 'da', 'leite', 'creme', 'base', 'pasta', 'po', 'pó', 'acucar', 'chocolate', 'choc']);

  // similaridade simples entre duas strings (Dice bigrams) para pegar erros de digitação
  function similar(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bg = s => { const m = {}; for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m[g] = (m[g] || 0) + 1; } return m; };
    const A = bg(a), B = bg(b);
    let inter = 0, total = 0;
    for (const g in A) { total += A[g]; if (B[g]) inter += Math.min(A[g], B[g]); }
    for (const g in B) total += B[g];
    return total ? (2 * inter) / total : 0;
  }

  /** Casa um ingrediente da receita com um item do estoque.
   *  Exige casamento FORTE: nome igual, um contém o outro por inteiro, todas as
   *  palavras significativas presentes, ou alta similaridade (erro de digitação).
   *  Retorna null quando não há match confiável — melhor não casar do que casar errado. */
  function casarIngrediente(ing, estoqueIndex) {
    const ni = n(ing);
    if (!ni) return null;
    // 1. exato
    if (estoqueIndex.exato[ni]) return estoqueIndex.exato[ni];
    // 2. um contém o outro por inteiro (frase completa), com tamanho mínimo
    for (const it of estoqueIndex.lista) {
      if (ni.length >= 4 && it.norm.length >= 4 && (it.norm === ni || (' ' + it.norm + ' ').includes(' ' + ni + ' ') || (' ' + ni + ' ').includes(' ' + it.norm + ' '))) return it;
    }
    // 3. todas as palavras significativas da receita estão no item (ou vice-versa)
    const palR = ni.split(' ').filter(p => p.length > 2 && !GENERICAS.has(p));
    if (palR.length) {
      for (const it of estoqueIndex.lista) {
        const palI = it.norm.split(' ').filter(p => p.length > 2 && !GENERICAS.has(p));
        if (!palI.length) continue;
        const todasR = palR.every(p => it.norm.includes(p));
        const todasI = palI.every(p => ni.includes(p));
        if (todasR || todasI) return it;
      }
    }
    // 4. similaridade alta (erro de digitação, ex.: Ovomaltine ↔ Ovomaline)
    let melhor = null, melhorSim = 0;
    for (const it of estoqueIndex.lista) {
      const s = similar(ni, it.norm);
      if (s > melhorSim) { melhorSim = s; melhor = it; }
    }
    if (melhorSim >= 0.68) return melhor;
    return null;
  }

  /** Índice do estoque a partir das linhas já parseadas (inventory) */
  function indexarEstoque(estoque) {
    const lista = (estoque || []).map(e => ({ item: e.item, qt: e.qt != null ? e.qt : null, norm: n(e.item) }));
    const exato = {};
    for (const it of lista) if (it.norm) exato[it.norm] = it;
    return { lista, exato };
  }

  /**
   * Analisa o que dá para produzir.
   * @param recs   índice de receitas (build)
   * @param estoque linhas de estoque (inventory)
   * @param prod   análise de produção (para priorizar por venda) — opcional
   */
  function analisar(recs, estoque, prod) {
    if (!recs) return null;
    const idx = indexarEstoque(estoque);

    // volume de produção histórico por sabor (proxy de venda/popularidade)
    const volumePorSabor = {};
    if (prod && prod.sabores) for (const p of prod.sabores) volumePorSabor[U.norm(p.nome)] = p.total;
    const maxVol = Math.max(1, ...Object.values(volumePorSabor));

    const resultado = recs.sabores.map(s => {
      const ingredientes = s.ingredientes.map(ing => {
        const fresco = FRESCOS.test(ing.nome);
        const basico = BASICOS.test(U.norm(ing.nome));
        const item = casarIngrediente(ing.nome, idx);
        let status;
        if (item && item.qt != null && item.qt > 0) status = 'ok';       // achei e tem no estoque
        else if (item && item.qt != null && item.qt <= 0) status = 'faltando'; // achei e está zerado
        else if (item && item.qt == null) status = 'sem_qtd';            // achei mas sem quantidade informada
        else if (basico) status = 'basico';                              // leite/açúcar/água: compra semanal, sempre tem
        else if (fresco) status = 'fresco';                              // fruta de feira: compra na hora
        else status = 'verificar';                                       // não achei no estoque — precisa conferir
        return { nome: ing.nome, qtd: ing.qtd, fresco, basico, item: item ? item.item : null, estoque: item ? item.qt : null, status };
      });

      const faltando = ingredientes.filter(i => i.status === 'faltando');
      const verificar = ingredientes.filter(i => i.status === 'verificar');
      const semQtd = ingredientes.filter(i => i.status === 'sem_qtd');
      const frescos = ingredientes.filter(i => i.status === 'fresco');
      const basicos = ingredientes.filter(i => i.status === 'basico');
      // pode produzir SÓ se nada está zerado E nada está sem controle (verificar).
      // Ingrediente que não achei no estoque agora BLOQUEIA — melhor avisar que
      // liberar errado (ex.: Ovomaltine/Maltovo que não estão no estoque).
      const podeProduzir = faltando.length === 0 && verificar.length === 0;
      const vol = volumePorSabor[U.norm(s.nome)] || 0;
      const nuncaFeito = vol === 0;

      return {
        nome: s.nome, tipo: s.tipo,
        ingredientes, podeProduzir,
        faltando, verificar, semQtd, frescos,
        naoControlado: verificar, // alias para compatibilidade
        volume: vol, nuncaFeito,
        popularidade: vol / maxVol,
      };
    });

    // ordena: pode produzir primeiro, dentro disso por popularidade
    const produziveis = resultado.filter(r => r.podeProduzir).sort((a, b) => b.volume - a.volume);
    const bloqueados = resultado.filter(r => !r.podeProduzir).sort((a, b) => (a.faltando.length + a.verificar.length) - (b.faltando.length + b.verificar.length));
    const nuncaFeitos = produziveis.filter(r => r.nuncaFeito);

    return {
      todos: resultado, produziveis, bloqueados, nuncaFeitos,
      totalSabores: resultado.length,
      totalProduziveis: produziveis.length,
    };
  }

  return { build, analisar, FRESCOS };
})();
