/* ============================================================
   Dubelato BI — style.css
   Identidade: "amarena & pistache" — cacau profundo no escuro,
   creme de leite no claro. Glassmorphism discreto, tipografia
   Fraunces (display) + Inter (texto).
   ============================================================ */

:root {
  --amarena: #e0475f;
  --pistache: #8fbc7f;
  --gold: #d9a84e;
  --blue: #6b9bd1;
  --purple: #a583c9;

  --radius: 18px;
  --radius-sm: 12px;
  --shadow: 0 10px 30px rgba(0,0,0,.28);
  --sidebar-w: 248px;
  --transition: .22s cubic-bezier(.4,0,.2,1);
}

/* -------- tema escuro (padrão): cacau -------- */
:root[data-theme="dark"] {
  --bg-0: #14100d;
  --bg-1: #1b1613;
  --surface: rgba(255,255,255,.045);
  --surface-2: rgba(255,255,255,.08);
  --glass: rgba(27,22,19,.72);
  --line: rgba(255,255,255,.09);
  --grid: rgba(255,255,255,.06);
  --tx-1: #f4ede6;
  --tx-2: #b8aca1;
  --tx-3: #7d726a;
  --tooltip-bg: rgba(26,21,18,.95);
  --pos: #9ed48b;
  --neg: #f2718a;
  --warn: #e6b566;
  --glow: radial-gradient(1200px 500px at 85% -10%, rgba(224,71,95,.12), transparent 60%),
          radial-gradient(900px 420px at -10% 20%, rgba(143,188,127,.10), transparent 55%);
}

/* -------- tema claro: creme -------- */
:root[data-theme="light"] {
  --bg-0: #f7f2ea;
  --bg-1: #fffdf9;
  --surface: rgba(255,255,255,.75);
  --surface-2: rgba(20,16,13,.05);
  --glass: rgba(255,253,249,.8);
  --line: rgba(20,16,13,.1);
  --grid: rgba(20,16,13,.07);
  --tx-1: #241d18;
  --tx-2: #5c534b;
  --tx-3: #96897e;
  --tooltip-bg: rgba(255,255,255,.97);
  --pos: #4d8a3f;
  --neg: #c22b48;
  --warn: #a3701c;
  --shadow: 0 10px 28px rgba(60,40,20,.1);
  --glow: radial-gradient(1100px 480px at 88% -12%, rgba(224,71,95,.08), transparent 60%),
          radial-gradient(900px 420px at -8% 18%, rgba(143,188,127,.12), transparent 55%);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }

body {
  margin: 0;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--tx-1);
  background: var(--bg-0);
  background-image: var(--glow);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 { font-family: 'Fraunces', Georgia, serif; font-weight: 600; letter-spacing: -.01em; }

a { color: var(--pistache); }
code { background: var(--surface-2); border-radius: 6px; padding: 1px 6px; font-size: .85em; }

.hidden { display: none !important; }
.mono { font-variant-numeric: tabular-nums; }
.right { text-align: right; }
.dim { color: var(--tx-3); font-weight: 400; font-size: .86em; }
.pos { color: var(--pos); }
.neg { color: var(--neg); }
.warn-text { color: var(--warn); }

.input {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--tx-1);
  padding: 10px 14px;
  font: inherit;
  outline: none;
  transition: border-color var(--transition);
}
.input:focus { border-color: var(--amarena); }

/* -------- splash / upload -------- */
#splash {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.splash-card {
  width: min(560px, 100%);
  text-align: center;
  background: var(--glass);
  backdrop-filter: blur(18px);
  border: 1px solid var(--line);
  border-radius: 26px;
  padding: 46px 34px;
  box-shadow: var(--shadow);
  animation: rise .5s ease both;
}
.logo-scoop {
  width: 64px; height: 64px;
  margin: 0 auto 16px;
  border-radius: 50% 50% 46% 46%;
  background: conic-gradient(from 210deg, var(--amarena), #f0788d 40%, var(--pistache) 75%, var(--amarena));
  box-shadow: inset 0 -10px 18px rgba(0,0,0,.25), 0 8px 24px rgba(224,71,95,.35);
  position: relative;
}
.logo-scoop::after {
  content: '';
  position: absolute; left: 50%; bottom: -14px; transform: translateX(-50%);
  border-left: 15px solid transparent; border-right: 15px solid transparent;
  border-top: 18px solid var(--gold);
  filter: brightness(.9);
}
.splash-card h1 { font-size: 30px; margin: 18px 0 6px; }
.splash-card .sub { color: var(--tx-2); margin: 0 0 26px; }

#drop-zone {
  border: 1.6px dashed var(--line);
  border-radius: var(--radius);
  padding: 34px 20px;
  cursor: pointer;
  color: var(--tx-2);
  transition: var(--transition);
}
#drop-zone:hover, #drop-zone.drag { border-color: var(--amarena); background: var(--surface); color: var(--tx-1); }
#drop-zone i { font-size: 30px; display: block; margin-bottom: 8px; color: var(--amarena); }
.splash-hint { font-size: 12.5px; color: var(--tx-3); margin-top: 18px; }

@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
