/**
 * The dashboard: what is actually true about the project, at a glance.
 *
 * Ordered by what a project owner needs to know first — what is blocked or
 * undecided, then what is finished, then what is built but not deployed, then
 * what is merely claimed. Nothing here is a typed-in number; every figure is
 * counted from the ledger.
 */
import { html } from '../http/html.mjs';
import { tag, when } from './layout.mjs';

const bar = (summary) => {
  const pct = (value) => (summary.all === 0 ? 0 : (value / summary.all) * 100);
  return html`<div class="bar" title="${summary.done} done · ${summary.built} built · ${summary.working} in progress · ${summary.stuck} stuck">
    <i class="done" style="width:${pct(summary.done)}%"></i>
    <i class="prog" style="width:${pct(summary.built + summary.working)}%"></i>
    <i class="stuck" style="width:${pct(summary.stuck)}%"></i>
    <i class="open" style="width:${pct(summary.all - summary.done - summary.built - summary.working - summary.stuck)}%"></i>
  </div>`;
};

export const dashboardPage = ({
  summary,
  byKind,
  byGroup,
  stuck,
  blockers,
  undeployed,
  deployedRelease,
  headCommit,
  recentHistory,
  missingRules,
  lastImport,
}) => html`
  <h1>Project status</h1>
  <p class="lead">
    Counted from ${summary.all} tracked items. <strong>Done</strong> means finished, tested and accepted —
    not "the code exists". Items whose code exists but has not been accepted are counted under
    <strong>built</strong>, and code that has been pushed but is not on the server is counted under
    <strong>not deployed</strong>.
  </p>

  <div class="cards">
    <div class="card">
      <div class="k">Done</div>
      <div class="n">${summary.donePercent}%</div>
      <div class="sub">${summary.done} of ${summary.all} items</div>
    </div>
    <div class="card">
      <div class="k">Built, not accepted</div>
      <div class="n">${summary.built}</div>
      <div class="sub">implemented · testing · approved</div>
    </div>
    <div class="card">
      <div class="k">In progress</div>
      <div class="n">${summary.working}</div>
      <div class="sub">actively being worked</div>
    </div>
    <div class="card ${summary.stuck > 0 ? 'bad' : ''}">
      <div class="k">Waiting on someone</div>
      <div class="n">${summary.stuck}</div>
      <div class="sub">blocked · decision required</div>
    </div>
    <div class="card ${summary.pushedNotDeployed > 0 ? 'warn' : ''}">
      <div class="k">Not deployed</div>
      <div class="n">${summary.pushedNotDeployed}</div>
      <div class="sub">committed or pushed, not on the server</div>
    </div>
  </div>

  <div class="panel" style="margin-top:1rem">${bar(summary)}</div>

  <div class="cards">
    <div class="card">
      <div class="k">Running in production</div>
      <div class="n mono" style="font-size:1.1rem">${deployedRelease ? String(deployedRelease.commit_hash).slice(0, 10) : 'unknown'}</div>
      <div class="sub">
        ${deployedRelease
          ? html`${deployedRelease.subject}<br>observed ${when(deployedRelease.observed_at)}`
          : html`No deployment evidence has been recorded. Run <span class="mono">npm run import:git</span>.`}
      </div>
    </div>
    <div class="card">
      <div class="k">Latest commit</div>
      <div class="n mono" style="font-size:1.1rem">${headCommit ? String(headCommit.hash).slice(0, 10) : '—'}</div>
      <div class="sub">${headCommit ? headCommit.subject : 'No commits imported.'}</div>
    </div>
    <div class="card">
      <div class="k">Last import</div>
      <div class="n" style="font-size:1.1rem">${lastImport ? '' : '—'}${lastImport ? when(lastImport.at) : ''}</div>
      <div class="sub">${lastImport ? lastImport.summary : 'Nothing imported yet.'}</div>
    </div>
  </div>

  ${missingRules > 0
    ? html`<div class="notice bad" style="margin-top:1rem">
        <strong>${missingRules} project ${missingRules === 1 ? 'rule is' : 'rules are'} recorded without their text.</strong>
        The authoritative wording could not be recovered from the project sources, and the tracker will not
        invent it. See <a href="/rules">Rules</a>.
      </div>`
    : ''}

  ${stuck.length > 0
    ? html`
        <h2>Waiting on a decision or unblocking (${stuck.length})</h2>
        <div class="panel">
          <table>
            <thead><tr><th>ID</th><th>Item</th><th>Status</th><th>Group</th><th>Since</th></tr></thead>
            <tbody>
              ${stuck.map(
                (item) => html`<tr>
                  <td class="id"><a href="/items/${item.id}">${item.id}</a></td>
                  <td>${item.title}</td>
                  <td>${tag(item.status)}</td>
                  <td class="muted">${item.group_path}</td>
                  <td>${when(item.updated_at)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
    : ''}

  ${blockers.length > 0
    ? html`
        <h2>Acceptance blockers still open (${blockers.length})</h2>
        <div class="panel">
          <table>
            <thead><tr><th>ID</th><th>Item</th><th>Status</th><th>Delivery</th></tr></thead>
            <tbody>
              ${blockers.map(
                (item) => html`<tr>
                  <td class="id"><a href="/items/${item.id}">${item.id}</a></td>
                  <td>${item.title}</td>
                  <td>${tag(item.status)}</td>
                  <td>${tag(item.delivery)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
    : ''}

  ${undeployed.length > 0
    ? html`
        <h2>Finished work that is not on the server (${undeployed.length})</h2>
        <div class="panel">
          <p class="muted" style="margin-top:0">
            These items are recorded as complete in the ledger and their code is committed or pushed, but the
            live application's own build stamp says the server is not running it.
          </p>
          <table>
            <thead><tr><th>ID</th><th>Item</th><th>Status</th><th>Delivery</th></tr></thead>
            <tbody>
              ${undeployed.map(
                (item) => html`<tr>
                  <td class="id"><a href="/items/${item.id}">${item.id}</a></td>
                  <td>${item.title}</td>
                  <td>${tag(item.status)}</td>
                  <td>${tag(item.delivery)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
    : ''}

  <h2>By area</h2>
  <div class="panel">
    <table>
      <thead><tr><th>Area</th><th>Items</th><th>Done</th><th>Open</th><th>Progress</th></tr></thead>
      <tbody>
        ${byGroup.map(
          (row) => html`<tr>
            <td><a href="/items?group=${encodeURIComponent(row.group_path)}">${row.group_path || '(ungrouped)'}</a></td>
            <td>${row.n}</td>
            <td>${row.done}</td>
            <td>${row.n - row.done}</td>
            <td style="min-width:8rem">${bar({ all: row.n, done: row.done, built: row.built, working: row.working, stuck: row.stuck })}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </div>

  <h2>By kind</h2>
  <div class="panel">
    <table>
      <thead><tr><th>Kind</th><th>Items</th></tr></thead>
      <tbody>
        ${byKind.map(
          (row) => html`<tr>
            <td><a href="/items?kind=${encodeURIComponent(row.kind)}">${row.kind}</a></td>
            <td>${row.n}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </div>

  <h2>Recent activity</h2>
  <div class="panel">
    <ul class="timeline">
      ${recentHistory.map(
        (entry) => html`<li>
          <div class="when">${when(entry.at)} · ${entry.actor}</div>
          <div>
            <a href="/items/${entry.entity_id}" class="mono">${entry.entity_id}</a>
            ${entry.summary}
          </div>
        </li>`,
      )}
    </ul>
  </div>
`;
