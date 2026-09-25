/**
 * The page chrome: one stylesheet, one navigation bar, no build step.
 *
 * NO CLIENT FRAMEWORK AND NO BUNDLER. The tracker is read-mostly, its pages are
 * tables, and a control system that cannot itself be built is not much of a
 * control system. Everything below is served exactly as it is written.
 */
import { html, raw } from '../http/html.mjs';

const STYLE = `
:root {
  --bg: #0f1115; --panel: #171a21; --panel-2: #1e2230; --line: #2a3040;
  --ink: #e7eaf0; --muted: #9aa4b8; --accent: #4c8dff; --accent-ink: #cfe0ff;
  --ok: #3fb950; --warn: #d29922; --bad: #f85149; --info: #58a6ff;
  --radius: 10px;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header.top {
  display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap;
  padding: 0.85rem 1.25rem; background: var(--panel); border-bottom: 1px solid var(--line);
  position: sticky; top: 0; z-index: 10;
}
header.top .brand { font-weight: 700; letter-spacing: 0.02em; color: var(--ink); }
header.top .brand span { color: var(--muted); font-weight: 400; }
header.top nav { display: flex; gap: 1rem; flex-wrap: wrap; }
header.top nav a { color: var(--muted); padding: 0.15rem 0; border-bottom: 2px solid transparent; }
header.top nav a.on { color: var(--ink); border-bottom-color: var(--accent); }
header.top .who { margin-left: auto; flex-wrap: wrap; color: var(--muted); font-size: 0.85rem; display: flex; gap: 0.75rem; align-items: center; }
main { padding: 1.5rem 1.25rem 4rem; max-width: 1400px; margin: 0 auto; }
h1 { font-size: 1.4rem; margin: 0 0 0.35rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 0.75rem; color: var(--accent-ink); }
h3 { font-size: 0.95rem; margin: 1.5rem 0 0.5rem; }
p.lead { color: var(--muted); margin: 0 0 1.5rem; max-width: 70ch; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem; }
.card {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 0.9rem 1rem;
}
.card .n { font-size: 1.8rem; font-weight: 700; line-height: 1.1; }
.card .k { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; }
.card .sub { color: var(--muted); font-size: 0.8rem; margin-top: 0.3rem; }
.card.bad { border-color: #5c2b2b; } .card.warn { border-color: #5c4a1f; }
.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 1rem 1.1rem; margin-bottom: 1rem;
  /* A wide table scrolls INSIDE its panel. The page itself never scrolls
     sideways on a tablet, which is the difference between a usable screen and
     one that loses its navigation the moment somebody drags a row. */
  overflow-x: auto;
}
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; min-width: 34rem; }
th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
tbody tr:hover { background: var(--panel-2); }
td.id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
.tag {
  display: inline-block; padding: 0.1rem 0.45rem; border-radius: 999px;
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.03em; white-space: nowrap;
  border: 1px solid var(--line); color: var(--muted);
}
.tag.DONE, .tag.APPROVED, .tag.DEPLOYED, .tag.PASS, .tag.ACTIVE { color: var(--ok); border-color: #1f4d29; background: #10230f; }
.tag.IN_PROGRESS, .tag.TESTING, .tag.IMPLEMENTED, .tag.PUSHED, .tag.COMMITTED { color: var(--info); border-color: #1f3a5c; background: #0d1a2b; }
.tag.BLOCKED, .tag.DECISION_REQUIRED, .tag.FAIL, .tag.SOURCE_MISSING { color: var(--bad); border-color: #5c2b2b; background: #2b1010; }
.tag.OPEN, .tag.PLANNED, .tag.NOT_STARTED, .tag.LOCAL { color: var(--warn); border-color: #5c4a1f; background: #241d08; }
.tag.CANCELLED, .tag.SUPERSEDED, .tag.DEFERRED, .tag.RETIRED { color: var(--muted); }
.tag.CRITICAL { color: var(--bad); border-color: #5c2b2b; }
.tag.HIGH { color: var(--warn); border-color: #5c4a1f; }
form.filters { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-bottom: 1rem; }
input[type=text], input[type=email], input[type=password], select, textarea {
  background: var(--panel-2); color: var(--ink); border: 1px solid var(--line);
  border-radius: 8px; padding: 0.55rem 0.7rem; font: inherit; font-size: 0.9rem;
  /* Touch targets. 44px is what a gloved hand on a rugged tablet needs. */
  min-height: 44px;
}
input[type=text] { min-width: 12rem; flex: 1 1 14rem; max-width: 100%; }
/* A select is as wide as its longest option unless it is told otherwise, and
   this one's options are section headings. Left alone it drags the whole page
   sideways on a tablet. */
select { max-width: 14rem; }
form.filters select { flex: 0 1 12rem; }
button {
  background: var(--accent); color: #05204d; border: 0; border-radius: 8px;
  padding: 0.55rem 1rem; font: inherit; font-weight: 600; cursor: pointer;
  min-height: 44px;
}
button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
.bar { height: 8px; border-radius: 999px; background: var(--panel-2); overflow: hidden; display: flex; }
.bar i { display: block; height: 100%; }
.bar i.done { background: var(--ok); } .bar i.prog { background: var(--info); }
.bar i.stuck { background: var(--bad); } .bar i.open { background: #3b4254; }
dl.kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.35rem 1rem; margin: 0; }
dl.kv dd { overflow-wrap: anywhere; }
dl.kv dt { color: var(--muted); font-size: 0.82rem; }
dl.kv dd { margin: 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; }
.muted { color: var(--muted); }
.rule { border-left: 3px solid var(--line); padding: 0.4rem 0 0.4rem 0.9rem; margin-bottom: 1.1rem; }
.rule.missing { border-left-color: var(--bad); }
.rule .n { color: var(--muted); font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; }
.rule p { margin: 0.2rem 0 0; white-space: pre-wrap; }
.notice { border: 1px solid #5c4a1f; background: #241d08; border-radius: var(--radius); padding: 0.8rem 1rem; margin-bottom: 1rem; }
.notice.bad { border-color: #5c2b2b; background: #2b1010; }
.login { max-width: 22rem; margin: 12vh auto; }
.login .panel { display: grid; gap: 0.75rem; }
.login label { display: grid; gap: 0.25rem; font-size: 0.85rem; color: var(--muted); }
.timeline { list-style: none; padding: 0; margin: 0; }
.timeline li { border-left: 2px solid var(--line); padding: 0 0 0.9rem 0.9rem; position: relative; }
.timeline li::before { content: ''; position: absolute; left: -5px; top: 0.45rem; width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
.timeline .when { color: var(--muted); font-size: 0.78rem; }
footer.foot { color: var(--muted); font-size: 0.8rem; padding: 2rem 1.25rem; text-align: center; }
@media (max-width: 720px) {
  main { padding: 1rem 1rem 3rem; }
  table { font-size: 0.82rem; }
  .cards { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
  dl.kv { grid-template-columns: 1fr; }
  dl.kv dt { margin-top: 0.4rem; }
}
`;

const NAV = [
  ['/', 'Dashboard'],
  ['/items', 'Items'],
  ['/rules', 'Rules'],
  ['/decisions', 'Decisions'],
  ['/releases', 'Releases'],
  ['/verification', 'Verification'],
  ['/history', 'Activity'],
];

export const layout = ({ title, user, path = '/', body, csrf = '' }) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · EJE Project Tracker</title>
<style>${raw(STYLE)}</style>
</head>
<body>
<header class="top">
  <div class="brand">EJE <span>Project Tracker</span></div>
  <nav>
    ${NAV.map(
      ([href, text]) =>
        html`<a href="${href}" class="${path === href || (href !== '/' && path.startsWith(href)) ? 'on' : ''}">${text}</a>`,
    )}
  </nav>
  <div class="who">
    ${user ? html`<span>${user.email}</span>` : ''}
    ${user
      ? html`<form method="post" action="/logout" style="margin:0">
          <input type="hidden" name="csrf" value="${csrf}">
          <button class="ghost" type="submit">Sign out</button>
        </form>`
      : ''}
  </div>
</header>
<main>${body}</main>
<footer class="foot">
  EJE Project Tracker — the project's record of itself. It holds no job-card data and never writes to the EJE application.
</footer>
</body>
</html>`;

/** The signed-out shell: no navigation, nothing to see. */
export const bareLayout = ({ title, body }) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · EJE Project Tracker</title>
<style>${raw(STYLE)}</style>
</head>
<body>${body}</body>
</html>`;

export const tag = (value) => html`<span class="tag ${String(value ?? '')}">${value}</span>`;

export const when = (value) => {
  if (value === null || value === undefined || value === '') return html`<span class="muted">—</span>`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return html`<span class="muted">—</span>`;
  return html`<span title="${date.toISOString()}">${date.toISOString().slice(0, 16).replace('T', ' ')}</span>`;
};
