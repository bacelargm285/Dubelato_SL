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
