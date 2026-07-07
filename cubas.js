/* ============================================================
   Dubelato BI — cubas.js
   Custo de produção: calcula o valor de cada cuba de gelato a
   partir da receita (base + mescla) e da tabela de preços da
   matéria-prima. A receita em si nunca é exibida — apenas os
   custos agregados.

   Regra da cuba: a receita-base equivale à cuba de 4000 ml.
   Para 8000 ml a base dobra, mas a MESCLA (cobertura) mantém
   a mesma quantidade nas duas cubas.
   Água sem preço cadastrado é considerada custo zero.
   ============================================================ */
window.DB = window.DB || {};

DB.cubas = (function () {
  const U = DB.utils;
  const BASE_ML = 4000; // a receita-base corresponde a esta cuba

  function precoDe(precos, item) {
    const n = U.norm(item);
    if (precos[n]) return precos[n];
    if (n === 'agua') return { nome: item, precoKg: 0, assumido: true }; // água: custo zero
    // tolerância a pequenas variações de grafia (ex.: "Leite em Pó Desnatado")
    for (const k of Object.keys(precos)) {
      if (k === n || k.replace(/\s/g, '') === n.replace(/\s/g, '')) return precos[k];
    }
    return null;
  }

  /**
   * Calcula o custo de um sabor para uma cuba de `ml` mililitros.
   * Retorna { sabor, ml, custoBase, custoMescla, custoTotal, pesoTotalG,
   *           custoPorKg, nIngredientes, faltantes:[nomes], completo }
   */
  function custoSabor(rec, precos, ml) {
    const fator = ml / BASE_ML;
    let custoBase = 0, custoMescla = 0, pesoG = 0;
    const faltantes = [];

    for (const ing of rec.base) {
      const p = precoDe(precos, ing.item);
      const qtd = ing.qtd * fator;
      pesoG += qtd;
      if (!p || p.precoKg == null) { if (!faltantes.includes(ing.item)) faltantes.push(ing.item); continue; }
      custoBase += (qtd / 1000) * p.precoKg;
    }
    for (const ing of rec.mescla) {           // mescla: quantidade fixa
      const p = precoDe(precos, ing.item);
      pesoG += ing.qtd;
      if (!p || p.precoKg == null) { if (!faltantes.includes(ing.item)) faltantes.push(ing.item); continue; }
      custoMescla += (ing.qtd / 1000) * p.precoKg;
    }

    const custoTotal = custoBase + custoMescla;
    return {
      sabor: rec.sabor, ml,
      custoBase, custoMescla, custoTotal,
      pesoTotalG: pesoG,
      custoPorKg: pesoG ? custoTotal / (pesoG / 1000) : null,
      nIngredientes: rec.base.length + rec.mescla.length,
      faltantes,
      completo: faltantes.length === 0,
    };
  }

  /**
   * Modelo completo: custos por sabor nas duas cubas + custo/margem
   * de cada produto vendido, por sabor.
   */
  function build(cubasRaw) {
    if (!cubasRaw) return null;
    const { receitas, precos, produtos } = cubasRaw;
    const porSabor = receitas.map(rec => ({
      sabor: rec.sabor,
      c4000: custoSabor(rec, precos, 4000),
      c8000: custoSabor(rec, precos, 8000),
    }));

    // produtos vendidos: custo do gelato contido = gramas × custo/kg do sabor
    // (usa custo/kg da cuba 8000, mais representativo da produção; a diferença
    // entre cubas vem só da diluição da mescla)
    function produtosDoSabor(s, ml) {
      const c = ml === 8000 ? s.c8000 : s.c4000;
      if (!c.completo || !c.custoPorKg) return null;
      return produtos.map(p => {
        const custo = (p.gramas / 1000) * c.custoPorKg;
        return {
          nome: p.nome, gramas: p.gramas, preco: p.preco,
          custo, margem: p.preco - custo,
          margemPct: p.preco ? ((p.preco - custo) / p.preco) * 100 : null,
          cmvPct: p.preco ? (custo / p.preco) * 100 : null,
        };
      });
    }

    const completos = porSabor.filter(s => s.c4000.completo);
    const incompletos = porSabor.filter(s => !s.c4000.completo);

    return { porSabor, completos, incompletos, produtos, precos, produtosDoSabor, BASE_ML };
  }

  return { build, BASE_ML };
})();
