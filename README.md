# Dubelato · Centro de Inteligência Financeira

Dashboard executivo 100% HTML/CSS/JavaScript. A única fonte de dados é a planilha Excel.
Versão "flat": todos os arquivos ficam na raiz do repositório (sem pastas).

## Publicação no GitHub Pages

1. Envie TODOS os arquivos desta pasta para a raiz do repositório.
2. Settings → Pages → Deploy from a branch → main → / (root) → Save.
3. Acesse https://SEU_USUARIO.github.io/NOME_DO_REPOSITORIO/

## Atualizar os dados

Substitua o arquivo `Controle_Financeiro_Dubelato.xlsx` no repositório
(Add file → Upload files → arrastar a planilha nova com esse mesmo nome).
O dashboard carrega esse arquivo sozinho ao abrir. Também dá para arrastar
a planilha direto na tela inicial do site — tudo roda no navegador.

## Arquivos

- index.html — página principal
- style.css, dashboard.css, responsive.css — estilos
- utils.js, excel.js, finance.js, inventory.js, analytics.js, alerts.js, charts.js, app.js — módulos
- Controle_Financeiro_Dubelato.xlsx — dados

## Cartões (Getnet)

No menu **Getnet**, arraste os arquivos do portal Getnet — de preferência
os **CSVs** (extrato_consolidado_cartao, extrato_consolidado_pix e
AgendaFinanceiraSimplificada; os demais são ignorados). Os PDFs
equivalentes também funcionam. Obs.: o indicador de cessão da agenda
só existe no PDF.

Os dados ficam salvos no navegador do aparelho e relatórios de meses
seguintes são somados sem duplicar. Análises: taxas por bandeira e
modalidade, ticket médio real, recebíveis por semana, venda por dia da
semana e cruzamento mensal planilha × maquininha (diferença ≈ dinheiro;
negativa = possível lançamento faltando).

### Compartilhar dados Getnet com os sócios

Após carregar os CSVs/PDFs, clique em **Baixar arquivo para publicar no
GitHub** e suba o `getnet_dados.json` gerado na raiz do repositório
(substituindo o anterior). O site carrega esse arquivo automaticamente
para qualquer pessoa que abrir o link.

## Produção de cubas

A aba **Producao_Cubas** da planilha registra a produção diária:
`Data | Sabor | Produtor | Quantidade`. Acrescente linhas nela mesma
(ou crie abas novas no mesmo formato — são detectadas sozinhas).
O menu **Cubas Vendidas** mostra ranking de sabores, sazonalidade mês a mês,
divisão por produtor e custo estimado (sabores com receita cadastrada).
Grafias diferentes do mesmo sabor são unificadas automaticamente.

## Banco (extrato OFX)

No menu **Banco**, exporte o extrato da conta Santander Empresas em formato
**OFX** e arraste no site. Pode juntar vários meses — não duplica (usa o FITID
de cada lançamento). Análises: categorização automática (PIX, boletos, tarifas,
antecipação Getnet, iFood, impostos), **custo real da antecipação de crédito**
(cruzando com a Getnet), tarifas bancárias detalhadas e **conferência de
boletos** (planilha × débitos na conta).

Para os sócios verem: botão **Baixar arquivo para publicar** gera o
`banco_dados.json`, que você sobe no repositório junto da planilha e do
`getnet_dados.json`. São os 3 arquivos de dados atualizados pelo mesmo caminho.
