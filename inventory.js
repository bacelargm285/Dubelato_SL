/* ============================================================
   Dubelato BI — inventory.js
   Estoque: agrupamento por categoria, itens zerados/baixos,
   itens sem quantidade numérica ("1 pacote" etc.).
   Obs.: a planilha registra quantidades, não valores — o valor
   financeiro do estoque fica disponível quando houver coluna de preço.
   ============================================================ */
window.DB = window.DB || {};

DB.inventory = (function () {
  const U = DB.utils;
  const LIMITE_BAIXO = 2; // qt <= 2 considera baixo

  function build(itens) {
    const porCategoria = {};
    let zerados = [], baixos = [], semNumero = [];
    for (const it of itens) {
      const c = porCategoria[it.categoria] || (porCategoria[it.categoria] = { categoria: it.categoria, itens: [], total: 0, zerados: 0, baixos: 0 });
      c.itens.push(it);
      if (it.qt != null) {
        c.total += it.qt;
        if (it.qt === 0) { c.zerados++; zerados.push(it); }
        else if (it.qt <= LIMITE_BAIXO) { c.baixos++; baixos.push(it); }
      } else if (it.qtTexto) semNumero.push(it);
    }
    return {
      itens, porCategoria,
      categorias: Object.values(porCategoria),
      zerados, baixos, semNumero,
      totalItens: itens.length,
      LIMITE_BAIXO,
    };
  }

  return { build, LIMITE_BAIXO };
})();
