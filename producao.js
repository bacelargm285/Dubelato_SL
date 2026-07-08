/* ============================================================
   Dubelato BI — producao.js
   Produção de cubas: normaliza as grafias dos sabores
   ("iogurt com amarena" = "Iogurte com Amarena "), ranqueia os
   mais produzidos, mostra sazonalidade mês a mês, divisão por
   produtor e cruza com o custo das receitas quando existir.
   ============================================================ */
window.DB = window.DB || {};

DB.producao = (function () {
  const U = DB.utils;

  /** Chave canônica do sabor: minúsculo, sem acento, com correções de grafia comuns */
  function chave(sabor) {
    let n = U.norm(sabor);
    n = n
      .replace(/\(.*?\)/g, ' ')                 // remove anotações "(antes do Alisson chegar)"
      .replace(/[.,;:!]+/g, ' ')                // pontuação solta ("pistache .")
      .replace(/\biogurt\b/g, 'iogurte')
      .replace(/fior d[ei] lat+e/g, 'fior di latte')
      .replace(/\bchocolate belga\b|\bbelga\b/g, 'chocolate belga')
      .replace(/\bnutelina\b/g, 'nutellina')
      .replace(/\bkit\s*kat\b/g, 'kitkat')
      .replace(/\bcheese\s*cake\b.*|\bcheesecake\b.*/g, 'cheese cake')
      .replace(/\s+/g, ' ')
      .trim();
    if (n === 'kinder') n = 'kinder bueno';     // só o "kinder" seco; Kinder Ovo continua distinto
    return n;
  }

  /** Nome de exibição: Primeira Letra Maiúscula de cada palavra relevante */
  function titulo(chaveN) {
    return chaveN.split(' ').map(w => ['com', 'de', 'di', 'e', 'do', 'da'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /** Os 8 sabores fixos da vitrine (chaves canônicas) */
  const FIXOS = ['pistache', 'kinder bueno', 'chocolate belga', 'doce de leite', 'iogurte com amarena', 'fior di latte', 'cheese cake', 'nutellina'];

  function build(registros, cubasModel) {
    if (!registros || !registros.length) return null;
    const porSabor = {};   // chave -> { nome, total, porMes: {ym: qtd}, grafias:Set }
    const porMes = {};     // ym -> { total, dias:Set, sabores:Set }
    const porProdutor = {}; // nome -> total

    for (const r of registros) {
      const k = chave(r.sabor);
      if (!k) continue;
      const s = porSabor[k] || (porSabor[k] = { chave: k, nome: titulo(k), total: 0, porMes: {}, grafias: new Set(), fixo: FIXOS.includes(k) });
      s.total += r.qtd;
      s.porMes[r.mes] = (s.porMes[r.mes] || 0) + r.qtd;
      s.grafias.add(r.sabor.trim());
      const m = porMes[r.mes] || (porMes[r.mes] = { total: 0, dias: new Set(), sabores: new Set() });
      m.total += r.qtd;
      m.dias.add(+r.data);
      m.sabores.add(k);
      const prod = (r.produtor || 'Não informado').trim() || 'Não informado';
      porProdutor[prod] = (porProdutor[prod] || 0) + r.qtd;
    }

    // detalhes por sabor: meses ativos, primeiro/último, melhor mês
    for (const s of Object.values(porSabor)) {
      s.mesesAtivos = Object.keys(s.porMes).sort();
      s.primeiro = s.mesesAtivos[0];
      s.ultimo = s.mesesAtivos[s.mesesAtivos.length - 1];
      s.melhorMes = s.mesesAtivos.reduce((a, b) => (s.porMes[b] > (s.porMes[a] || 0) ? b : a), s.mesesAtivos[0]);
    }

    const sabores = Object.values(porSabor).sort((a, b) => b.total - a.total);
    const meses = Object.keys(porMes).sort();
    const totalGeral = U.sum(sabores, s => s.total);

    // Pareto: quantos sabores fazem 80% da produção
    let acum = 0, pareto80 = 0;
    for (const s of sabores) { acum += s.total; pareto80++; if (acum >= totalGeral * 0.8) break; }

    // cruzamento com custo de receita (Custo das Cubas) — igualdade exata da
    // chave canônica ("Mousse de Pistache" NÃO herda o custo do "Pistache")
    let custoMatch = null;
    if (cubasModel) {
      custoMatch = sabores.map(s => {
        const rec = cubasModel.porSabor.find(r => chave(r.sabor) === s.chave);
        return rec && rec.c8000.completo ? { sabor: s, rec } : null;
      }).filter(Boolean);
    }

    return { registros, sabores, porSabor, meses, porMes, porProdutor, totalGeral, pareto80, custoMatch };
  }

  return { build, chave, titulo };
})();
