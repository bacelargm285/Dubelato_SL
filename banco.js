/* ============================================================
   Dubelato BI — banco.js
   Extrato bancário (OFX Santander PJ): leitura, categorização
   automática dos lançamentos, custo da antecipação Getnet,
   tarifas bancárias e conciliação com boletos da planilha.
   Mesmo fluxo da Getnet: upload → localStorage → publicar
   banco_dados.json no GitHub para os sócios.
   ============================================================ */
window.DB = window.DB || {};

DB.banco = (function () {
  const U = DB.utils;
  const LS_KEY = 'db_banco_v1';
  const ARQUIVO_PUBLICO = 'banco_dados.json';

  /* ---------- parser OFX (SGML 1.x e 2.x) ---------- */

  function decodificar(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { return new TextDecoder('iso-8859-1').decode(buf); }
  }

  function parseOfx(arrayBuffer) {
    const txt = decodificar(arrayBuffer);
    const txs = [];
    const blocos = txt.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/g) || [];
    const tag = (b, t) => { const m = b.match(new RegExp('<' + t + '>([^\\r\\n<]+)')); return m ? m[1].trim() : null; };
    for (const b of blocos) {
      const dt = tag(b, 'DTPOSTED');
      const amt = tag(b, 'TRNAMT');
      if (!dt || amt == null) continue;
      const data = new Date(+dt.slice(0, 4), +dt.slice(4, 6) - 1, +dt.slice(6, 8));
      const valor = U.toNum(amt);
      if (valor == null || isNaN(+data)) continue;
      txs.push({
        data, mes: U.ymKey(data),
        valor,                                    // negativo = saída
        fitid: tag(b, 'FITID') || (dt + '|' + amt + '|' + (tag(b, 'MEMO') || '')),
        memo: (tag(b, 'MEMO') || tag(b, 'NAME') || '').replace(/\s+/g, ' ').trim(),
        tipo: valor >= 0 ? 'credito' : 'debito',
      });
    }
    return txs;
  }

  /* ---------- categorização por regras ---------- */

  const REGRAS = [
    { id: 'getnet_antecipacao', rotulo: 'Antecipação Getnet (cessão)', test: (m, v) => /ANTECIPACAO\s+GETNET/i.test(m) },
    { id: 'getnet_debito', rotulo: 'Getnet — débito (D+1)', test: (m, v) => /GETNET/i.test(m) && v > 0 },
    { id: 'ifood_repasse', rotulo: 'Repasse iFood', test: (m, v) => /IFOOD/i.test(m) && v > 0 },
    { id: 'tarifa', rotulo: 'Tarifas bancárias', test: m => /^TARIFA|\bTARIFA\b|TAR\s+MANUT|CESTA|PACOTE\s+SERV/i.test(m) },
    { id: 'rendimento', rotulo: 'Rendimento de aplicação', test: m => /RENDIMENTO/i.test(m) },
    { id: 'aplicacao', rotulo: 'Aplicação/Resgate ContaMax', test: m => /APLICACAO|RESGATE|CONTAMAX/i.test(m) },
    { id: 'boleto_pago', rotulo: 'Boletos pagos', test: (m, v) => /PAGAMENTO DE BOLETO/i.test(m) && v < 0 },
    { id: 'fornecedor', rotulo: 'Pagamento a fornecedores', test: (m, v) => /PAGAMENTO A FORNECEDORES/i.test(m) && v < 0 },
    { id: 'pix_recebido', rotulo: 'PIX recebidos', test: (m, v) => /PIX RECEBIDO/i.test(m) },
    { id: 'pix_enviado', rotulo: 'PIX enviados', test: (m, v) => /PIX ENVIADO/i.test(m) },
    { id: 'imposto', rotulo: 'Impostos/tributos', test: m => /DARF|SIMPLES|GPS|FGTS|TRIBUTO|IMPOSTO/i.test(m) },
  ];

  function categoria(memo, valor) {
    for (const r of REGRAS) if (r.test(memo, valor)) return r.id;
    return valor >= 0 ? 'outros_creditos' : 'outros_debitos';
  }
  const ROTULOS = Object.fromEntries(REGRAS.map(r => [r.id, r.rotulo]));
  ROTULOS.outros_creditos = 'Outros créditos';
  ROTULOS.outros_debitos = 'Outros débitos';

  /* ---------- persistência / publicação (mesmo padrão da Getnet) ---------- */

  const rev = x => Object.assign({}, x, { data: new Date(x.data) });

  function carregar() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      return d ? { txs: d.txs.map(rev), atualizadoEm: d.atualizadoEm ? new Date(d.atualizadoEm) : null } : null;
    } catch { return null; }
  }
  function salvar(dados) { try { localStorage.setItem(LS_KEY, JSON.stringify(dados)); } catch { /* cheio */ } }
  function limpar() { localStorage.removeItem(LS_KEY); }

  function mesclar(atual, novosTxs) {
    const mapa = new Map((atual?.txs || []).map(t => [t.fitid, t]));
    for (const t of novosTxs) mapa.set(t.fitid, t);           // FITID é único por lançamento
    return { txs: [...mapa.values()].sort((a, b) => a.data - b.data), atualizadoEm: new Date() };
  }

  function exportarJson(dados) {
    const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ARQUIVO_PUBLICO;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function carregarPublicado() {
    try {
      const res = await fetch(ARQUIVO_PUBLICO, { cache: 'no-store' });
      if (!res.ok) return null;
      const d = await res.json();
      return { txs: d.txs.map(rev), atualizadoEm: d.atualizadoEm ? new Date(d.atualizadoEm) : null };
    } catch { return null; }
  }

  /* ---------- análise ---------- */

  function analisar(dados, getnet, M) {
    if (!dados || !dados.txs.length) return null;
    const txs = dados.txs.map(t => Object.assign({ cat: categoria(t.memo, t.valor) }, t));
    const ini = txs[0].data, fim = txs[txs.length - 1].data;
    const A = { txs, ini, fim };

    const soma = pred => U.sum(txs.filter(pred), t => Math.abs(t.valor));
    A.entradas = soma(t => t.valor > 0);
    A.saidas = soma(t => t.valor < 0);
    A.porCat = {};
    for (const t of txs) {
      const c = A.porCat[t.cat] || (A.porCat[t.cat] = { id: t.cat, rotulo: ROTULOS[t.cat], total: 0, n: 0, itens: [] });
      c.total += Math.abs(t.valor); c.n++; c.itens.push(t);
    }

    // tarifas bancárias detalhadas (por descrição)
    A.tarifas = { total: 0, porTipo: {} };
    for (const t of txs.filter(t => t.cat === 'tarifa')) {
      A.tarifas.total += Math.abs(t.valor);
      const k = t.memo.replace(/\d+/g, '').trim();
      const p = A.tarifas.porTipo[k] || (A.tarifas.porTipo[k] = { memo: t.memo, total: 0, n: 0 });
      p.total += Math.abs(t.valor); p.n++;
    }
    A.rendimento = soma(t => t.cat === 'rendimento' && t.valor > 0);

    // recebimentos da maquininha no banco
    A.antecipacoes = txs.filter(t => t.cat === 'getnet_antecipacao' && t.valor > 0);
    A.antecipacaoTotal = U.sum(A.antecipacoes, t => t.valor);
    A.getnetDebitoTotal = soma(t => t.cat === 'getnet_debito' && t.valor > 0);
    A.ifoodRepasse = soma(t => t.cat === 'ifood_repasse' && t.valor > 0);

    // CUSTO DA ANTECIPAÇÃO: na cessão, o líquido de crédito da Getnet é
    // antecipado e cai na conta com deságio. Estimamos comparando, no maior
    // intervalo em que as DUAS fontes se sobrepõem, o total líquido de crédito
    // vendido com o total efetivamente antecipado. Como as bordas cortam vendas
    // sem depósito (e vice-versa), apresentamos uma FAIXA honesta: o melhor
    // casamento (bloco interior) dá o piso; o agregado bruto dá o teto.
    A.custoAntecipacao = null;
    if (getnet && getnet.cartoes && getnet.cartoes.length && A.antecipacaoTotal > 0) {
      const cred = getnet.cartoes.filter(c => c.modalidade === 'Crédito');
      const liqCredTotal = U.sum(cred, c => c.liquido);
      const iniV = new Date(Math.min(...cred.map(c => +c.data)));
      const fimV = new Date(Math.max(...cred.map(c => +c.data)));
      // sobreposição das duas fontes
      const de = new Date(Math.max(+ini, +iniV)), ate = new Date(Math.min(+fim, +fimV));
      const dentro = (d, a, b) => d >= a && d <= b;
      const liqCredSobrep = U.sum(cred.filter(c => dentro(c.data, de, ate)), c => c.liquido);
      const antSobrep = U.sum(A.antecipacoes.filter(t => dentro(t.data, de, ate)), t => t.valor);
      if (liqCredSobrep > 1000 && antSobrep > 1000) {
        // razão agregada na sobreposição (teto do deságio) e no bloco interior (piso)
        const desagioAgregado = Math.max(0, (1 - antSobrep / liqCredSobrep) * 100);
        // bloco interior: recorta 4 dias de cada borda
        const bi = new Date(+de + 4 * 86400000), bf = new Date(+ate - 4 * 86400000);
        let vB = 0, aB = 0;
        if (bf - bi >= 10 * 86400000) {
          vB = U.sum(cred.filter(c => dentro(c.data, bi, bf)), c => c.liquido);
          aB = U.sum(A.antecipacoes.filter(t => dentro(t.data, bi, bf)), t => t.valor);
        }
        const desagioInterior = (vB > 1000 && aB > 1000) ? Math.max(0, (1 - aB / vB) * 100) : desagioAgregado;
        const pisoP = Math.min(desagioAgregado, desagioInterior);
        const tetoP = Math.max(desagioAgregado, desagioInterior);
        const centro = (pisoP + tetoP) / 2;
        const diasSobrep = Math.round((ate - de) / 86400000) + 1;
        const liqCredMes = liqCredSobrep / diasSobrep * 30;
        A.custoAntecipacao = {
          desagioPct: centro, faixaMin: pisoP, faixaMax: tetoP,
          custoMensalEst: liqCredMes * centro / 100,
          custoMensalMin: liqCredMes * pisoP / 100,
          custoMensalMax: liqCredMes * tetoP / 100,
          liqCredMes, diasSobrep,
          bloco: { de, ate },
          // comparação lado a lado no período de sobreposição:
          brutoCredito: U.sum(cred.filter(c => dentro(c.data, de, ate)), c => c.bruto),
          liquidoSemAntecipacao: liqCredSobrep,   // o que a Getnet pagaria em D+30 (já sem a taxa da maquininha)
          recebidoComAntecipacao: antSobrep,      // o que caiu na conta agora, via antecipação (OFX)
          custoNoPeriodo: liqCredSobrep - antSobrep,
        };
      }
    }

    // conciliação de boletos: planilha (vencidos na janela) × débitos de boleto no banco
    // boletos vencendo até 5 dias após o INÍCIO do extrato podem ter sido pagos
    // antes da janela — marcados como "borda", não como pendência real.
    A.conciliacaoBoletos = null;
    if (M && M.boletos && M.boletos.length) {
      const pagosBanco = txs.filter(t => (t.cat === 'boleto_pago' || t.cat === 'fornecedor') && t.valor < 0);
      const usados = new Set();
      const naJanela = M.boletos.filter(b => b.venc && b.venc >= ini && b.venc <= fim);
      const borda = new Date(+ini + 5 * 86400000);
      const resultado = naJanela.map(b => {
        let match = null;
        for (let i = 0; i < pagosBanco.length; i++) {
          const t = pagosBanco[i];
          if (usados.has(i)) continue;
          if (Math.abs(Math.abs(t.valor) - b.valor) < 0.02 && Math.abs(t.data - b.venc) <= 5 * 86400000) { usados.add(i); match = t; break; }
        }
        return { boleto: b, banco: match, naBorda: !match && b.venc <= borda };
      });
      A.conciliacaoBoletos = {
        itens: resultado,
        confirmados: resultado.filter(r => r.banco).length,
        pendentes: resultado.filter(r => !r.banco && !r.naBorda),
        borda: resultado.filter(r => r.naBorda).length,
      };
    }

    return A;
  }

  return { parseOfx, categoria, ROTULOS, carregar, salvar, limpar, mesclar, exportarJson, carregarPublicado, analisar, ARQUIVO_PUBLICO };
})();
