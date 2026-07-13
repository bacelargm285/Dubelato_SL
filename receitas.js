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

  /** Normaliza para casar nomes de ingrediente entre receita e estoque */
  function n(s) { return U.norm(s).replace(/\d+%?|de|em|po|pó|fresco|integral|kg|g\b/g, ' ').replace(/\s+/g, ' ').trim(); }

  /** Casa um ingrediente da receita com um item do estoque (exato → contido → palavra-chave) */
  function casarIngrediente(ing, estoqueIndex) {
    const ni = n(ing);
    if (!ni) return null;
    if (estoqueIndex.exato[ni]) return estoqueIndex.exato[ni];
    for (const it of estoqueIndex.lista) {
      if (ni.length > 3 && (it.norm.includes(ni) || ni.includes(it.norm))) return it;
    }
    // palavra significativa em comum
    const palavras = ni.split(' ').filter(p => p.length > 3);
    for (const it of estoqueIndex.lista) {
      for (const p of palavras) if (it.norm.includes(p)) return it;
    }
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
        const item = casarIngrediente(ing.nome, idx);
        let status;
        if (fresco) status = 'fresco';                              // comprado na hora, não bloqueia
        else if (!item) status = 'nao_controlado';                 // não achei no estoque
        else if (item.qt == null) status = 'sem_qtd';              // no estoque mas sem quantidade
        else if (item.qt <= 0) status = 'faltando';                // zerado
        else status = 'ok';
        return { nome: ing.nome, qtd: ing.qtd, fresco, item: item ? item.item : null, estoque: item ? item.qt : null, status };
      });

      const faltando = ingredientes.filter(i => i.status === 'faltando');
      const naoControlado = ingredientes.filter(i => i.status === 'nao_controlado');
      const frescos = ingredientes.filter(i => i.status === 'fresco');
      // pode produzir se nenhum ingrediente controlado está zerado
      const podeProduzir = faltando.length === 0;
      // confiança: alta se todos os controlados têm quantidade; média se há itens sem controle
      const vol = volumePorSabor[U.norm(s.nome)] || 0;
      const nuncaFeito = vol === 0;

      return {
        nome: s.nome, tipo: s.tipo,
        ingredientes, podeProduzir,
        faltando, naoControlado, frescos,
        volume: vol, nuncaFeito,
        popularidade: vol / maxVol,
      };
    });

    // ordena: pode produzir primeiro, dentro disso por popularidade
    const produziveis = resultado.filter(r => r.podeProduzir).sort((a, b) => b.volume - a.volume);
    const bloqueados = resultado.filter(r => !r.podeProduzir).sort((a, b) => a.faltando.length - b.faltando.length);
    const nuncaFeitos = produziveis.filter(r => r.nuncaFeito);

    return {
      todos: resultado, produziveis, bloqueados, nuncaFeitos,
      totalSabores: resultado.length,
      totalProduziveis: produziveis.length,
    };
  }

  return { build, analisar, FRESCOS };
})();
