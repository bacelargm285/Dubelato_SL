/* ============================================================
   Dubelato BI — responsive.css
   Mobile-first: sidebar vira gaveta, grids empilham.
   ============================================================ */

/* Tablet e abaixo */
@media (max-width: 1024px) {
  .grid-2 { grid-template-columns: 1fr; }
  #main-content { padding: 18px 16px 60px; }
}

/* Celular */
@media (max-width: 820px) {
  #sidebar {
    transform: translateX(-105%);
    transition: transform .28s cubic-bezier(.4,0,.2,1);
    width: min(300px, 84vw);
    box-shadow: var(--shadow);
  }
  #sidebar.open { transform: none; }
  #sidebar.open ~ #backdrop { opacity: 1; pointer-events: auto; }

  #main { margin-left: 0; }
  #btn-menu { display: grid; }
  #topbar { padding: 12px 14px; }
  .top-title { font-size: 15px; }
  #filtro-mes { min-width: 0; flex: 1; }

  .kpi-grid, .kpi-grid-4 { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .kpi { padding: 13px 14px; }
  .kpi-valor { font-size: 18px; }
  .chart-box { height: 250px; }
  .chart-box.tall { height: 300px; }
  table { font-size: 12.5px; }
}

/* Celulares estreitos */
@media (max-width: 420px) {
  .kpi-grid, .kpi-grid-4 { grid-template-columns: 1fr 1fr; }
  .kpi-label { font-size: 11.5px; }
  .card-body, .card-head { padding-left: 14px; padding-right: 14px; }
}

/* Telas grandes / TV 4K */
@media (min-width: 1900px) {
  body { font-size: 16px; }
  #main-content { max-width: 1720px; }
  .chart-box { height: 380px; }
  .chart-box.tall { height: 460px; }
}
