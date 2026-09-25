/**
 * Decisions, releases, verification evidence and the activity log.
 *
 * These are the pages that answer "why is this not finished?" without anybody
 * having to remember. An undecided question stays visible, a pushed commit that
 * is not on the server stays visible, and a claim of deployment that has no
 * evidence behind it cannot be displayed at all.
 */
import { html, paragraphs } from '../http/html.mjs';
import { tag, when } from './layout.mjs';

export const decisionsPage = ({ decisions }) => {
  const open = decisions.filter((d) => d.decision === '');
  const closed = decisions.filter((d) => d.decision !== '');

  const card = (d) => html`
    <div class="panel" id="${d.id}">
      <h3 style="margin-top:0">
        <a class="mono" href="/items/${d.id}">${d.id}</a> — ${d.title}
        ${tag(d.decision === '' ? 'DECISION_REQUIRED' : 'DONE')}
      </h3>
      <dl class="kv">
        <dt>Question</dt><dd>${d.question}</dd>
        ${d.options ? html`<dt>Options</dt><dd>${paragraphs(d.options)}</dd>` : ''}
        ${d.blocks ? html`<dt>Blocks</dt><dd>${d.blocks}</dd>` : ''}
        <dt>Decision</dt>
        <dd>${d.decision ? paragraphs(d.decision) : html`<span class="muted">Not decided. Nothing has been assumed in its place.</span>`}</dd>
        ${d.decided_by ? html`<dt>Decided by</dt><dd>${d.decided_by} ${when(d.decided_at)}</dd>` : ''}
        ${d.implementation_status ? html`<dt>Implementation</dt><dd>${d.implementation_status}</dd>` : ''}
        ${d.source_ref ? html`<dt>Source</dt><dd class="mono muted">${d.source_ref}</dd>` : ''}
      </dl>
    </div>`;

  return html`
    <h1>Decisions</h1>
    <p class="lead">
      ${open.length} outstanding, ${closed.length} settled. An outstanding decision is a question nobody has
      answered — the original question and options are kept after it is answered, because how something was
      decided is part of the decision.
    </p>
    <h2>Outstanding (${open.length})</h2>
    ${open.length === 0 ? html`<div class="panel muted">None.</div>` : open.map(card)}
    <h2>Settled (${closed.length})</h2>
    ${closed.length === 0 ? html`<div class="panel muted">None yet.</div>` : closed.map(card)}
  `;
};

export const releasesPage = ({ releases, commits, deployed }) => html`
  <h1>Commits and releases</h1>
  <p class="lead">
    Where the code actually is. <strong>Pushed is not deployed.</strong> A release is only recorded as
    DEPLOYED when evidence outside this database says so — the live application's own
    <span class="mono">/api/health</span> build stamp, and git ancestry against it.
  </p>

  <div class="panel">
    <dl class="kv">
      <dt>Live build</dt>
      <dd>
        ${deployed
          ? html`<span class="mono">${deployed.commit_hash}</span> — ${deployed.subject}`
          : html`<span class="muted">No deployment evidence recorded.</span>`}
      </dd>
      <dt>Observed</dt><dd>${deployed ? when(deployed.observed_at) : html`<span class="muted">—</span>`}</dd>
      <dt>Evidence</dt><dd class="mono muted">${deployed ? deployed.evidence : '—'}</dd>
      <dt>Server</dt><dd class="mono">${deployed ? deployed.server : '—'}</dd>
    </dl>
  </div>

  <h2>Releases (${releases.length})</h2>
  <div class="panel">
    <table>
      <thead><tr><th>Release</th><th>Commit</th><th>Subject</th><th>State</th><th>Deployed</th><th>Observed</th></tr></thead>
      <tbody>
        ${releases.map(
          (release) => html`<tr>
            <td class="mono">${release.id}</td>
            <td class="mono">${String(release.commit_hash).slice(0, 10)}</td>
            <td>${release.subject}</td>
            <td>${tag(release.status)}</td>
            <td>${when(release.deployed_at)}</td>
            <td>${when(release.observed_at)}</td>
          </tr>`,
        )}
        ${releases.length === 0 ? html`<tr><td colspan="6" class="muted">Nothing imported yet.</td></tr>` : ''}
      </tbody>
    </table>
  </div>

  <h2>Recent commits (${commits.length})</h2>
  <div class="panel">
    <table>
      <thead><tr><th>Commit</th><th>Subject</th><th>Author</th><th>When</th><th>Where it is</th></tr></thead>
      <tbody>
        ${commits.map(
          (commit) => html`<tr>
            <td class="mono">${String(commit.hash).slice(0, 10)}</td>
            <td>${commit.subject}</td>
            <td class="muted">${commit.author}</td>
            <td>${when(commit.committed_at)}</td>
            <td>${tag(commit.release_status ?? 'PUSHED')}</td>
          </tr>`,
        )}
        ${commits.length === 0 ? html`<tr><td colspan="5" class="muted">Nothing imported yet.</td></tr>` : ''}
      </tbody>
    </table>
  </div>
`;

export const verificationPage = ({ runs }) => html`
  <h1>Verification evidence</h1>
  <p class="lead">
    What was actually run, and what it said. A task is not done because the code compiles; this is where the
    proof lives, and an item with no evidence here is visibly unproven.
  </p>
  <div class="panel">
    <table>
      <thead><tr><th>Result</th><th>Command</th><th>Passed</th><th>Item</th><th>Commit</th><th>When</th></tr></thead>
      <tbody>
        ${runs.map(
          (run) => html`<tr>
            <td>${tag(run.result)}</td>
            <td class="mono">${run.command}</td>
            <td>${run.total === null ? html`<span class="muted">—</span>` : `${run.passed}/${run.total}`}</td>
            <td class="id">${run.item_id ? html`<a href="/items/${run.item_id}">${run.item_id}</a>` : ''}</td>
            <td class="mono">${run.commit_hash ? String(run.commit_hash).slice(0, 10) : ''}</td>
            <td>${when(run.ran_at)}</td>
          </tr>`,
        )}
        ${runs.length === 0 ? html`<tr><td colspan="6" class="muted">No verification records yet.</td></tr>` : ''}
      </tbody>
    </table>
  </div>
`;

export const historyPage = ({ entries }) => html`
  <h1>Activity</h1>
  <p class="lead">
    Every change the tracker has recorded, oldest last. Nothing in this log is ever edited or deleted — it is
    append-only, which is what makes it worth reading.
  </p>
  <div class="panel">
    <table>
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
      <tbody>
        ${entries.map(
          (entry) => html`<tr>
            <td>${when(entry.at)}</td>
            <td class="muted">${entry.actor}</td>
            <td class="id">
              ${entry.entity_type === 'item'
                ? html`<a href="/items/${entry.entity_id}">${entry.entity_id}</a>`
                : html`${entry.entity_type}:${entry.entity_id}`}
            </td>
            <td>${entry.summary}${entry.detail ? html` <span class="muted">— ${entry.detail}</span>` : ''}</td>
          </tr>`,
        )}
        ${entries.length === 0 ? html`<tr><td colspan="4" class="muted">Nothing recorded yet.</td></tr>` : ''}
      </tbody>
    </table>
  </div>
`;

export const loginPage = ({ error = '', csrf = '' }) => html`
  <div class="login">
    <h1 style="text-align:center">EJE Project Tracker</h1>
    ${error ? html`<div class="notice bad">${error}</div>` : ''}
    <form method="post" action="/login" class="panel">
      <input type="hidden" name="csrf" value="${csrf}">
      <label>Email
        <input type="email" name="email" autocomplete="username" required autofocus>
      </label>
      <label>Password
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Sign in</button>
    </form>
    <p class="muted" style="text-align:center; font-size:0.82rem">
      Accounts are created on the server with <span class="mono">npm run user:add</span>.
    </p>
  </div>
`;

export const errorPage = ({ code, message }) => html`
  <h1>${code}</h1>
  <div class="panel"><p>${message}</p><p><a href="/">Back to the dashboard</a></p></div>
`;
