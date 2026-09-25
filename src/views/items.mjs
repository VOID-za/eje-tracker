/**
 * The item list and the item detail page.
 *
 * The list is the working view: filter, search, sort, and every row links to
 * the full record. The detail page is the audit view — where an item came
 * from, what it depends on, which commits claim to implement it, which files it
 * added and removed, what was verified, and every change ever made to it.
 */
import { html, paragraphs } from '../http/html.mjs';
import { tag, when } from './layout.mjs';
import { KINDS, STATUSES, DELIVERIES, PRIORITIES } from '../domain/model.mjs';

const option = (value, selected, text = value) =>
  html`<option value="${value}" ${selected === value ? 'selected' : ''}>${text}</option>`;

export const itemsPage = ({ items, filter, groups }) => html`
  <h1>Items</h1>
  <p class="lead">
    ${items.length} ${items.length === 1 ? 'item' : 'items'} shown.
    Every identifier is the one the authoritative scope already uses, so a requirement is called the
    same thing here as it is in the document and in the commit messages.
  </p>

  <form class="filters" method="get" action="/items">
    <input type="text" name="q" value="${filter.q ?? ''}" placeholder="Search id, title, description, notes">
    <select name="kind">${option('', filter.kind ?? '', 'Any kind')}${KINDS.map((k) => option(k, filter.kind ?? ''))}</select>
    <select name="status">${option('', filter.status ?? '', 'Any status')}${STATUSES.map((s) => option(s, filter.status ?? ''))}</select>
    <select name="delivery">${option('', filter.delivery ?? '', 'Any delivery')}${DELIVERIES.map((d) => option(d, filter.delivery ?? ''))}</select>
    <select name="priority">${option('', filter.priority ?? '', 'Any priority')}${PRIORITIES.map((p) => option(p, filter.priority ?? ''))}</select>
    <select name="group">${option('', filter.group ?? '', 'Any area')}${groups.map((g) => option(g, filter.group ?? ''))}</select>
    <select name="sort">
      ${option('id', filter.sort ?? 'id', 'Sort by ID')}
      ${option('status', filter.sort ?? 'id', 'Sort by status')}
      ${option('kind', filter.sort ?? 'id', 'Sort by kind')}
      ${option('priority', filter.sort ?? 'id', 'Sort by priority')}
      ${option('updated', filter.sort ?? 'id', 'Sort by last change')}
      ${option('group', filter.sort ?? 'id', 'Sort by area')}
    </select>
    <button type="submit">Filter</button>
    <a class="muted" href="/items">Clear</a>
    <a class="muted" href="/api/items?${filter.queryString ?? ''}">JSON</a>
  </form>

  <div class="panel">
    <table>
      <thead>
        <tr><th>ID</th><th>Kind</th><th>Item</th><th>Status</th><th>Delivery</th><th>Area</th><th>Changed</th></tr>
      </thead>
      <tbody>
        ${items.map(
          (item) => html`<tr>
            <td class="id"><a href="/items/${item.id}">${item.id}</a></td>
            <td class="muted">${item.kind}</td>
            <td>
              ${item.title}
              ${item.acceptance_blocker ? html` <span class="tag CRITICAL">blocker</span>` : ''}
              ${item.source_missing ? html` <span class="tag SOURCE_MISSING">source missing</span>` : ''}
            </td>
            <td>${tag(item.status)}</td>
            <td>${tag(item.delivery)}</td>
            <td class="muted">${item.group_path}</td>
            <td>${when(item.updated_at)}</td>
          </tr>`,
        )}
        ${items.length === 0
          ? html`<tr><td colspan="7" class="muted">Nothing matches that filter.</td></tr>`
          : ''}
      </tbody>
    </table>
  </div>
`;

export const itemPage = ({ item, relations, commits, files, verifications, history, decision, children, csrf, canEdit }) => html`
  <h1><span class="mono">${item.id}</span> — ${item.title}</h1>
  <p class="lead">${item.kind} · ${item.group_path || 'ungrouped'}</p>

  <div class="panel">
    <dl class="kv">
      <dt>Status</dt><dd>${tag(item.status)} ${item.source_status ? html`<span class="muted">(scope says: ${item.source_status})</span>` : ''}</dd>
      <dt>Delivery</dt><dd>${tag(item.delivery)}</dd>
      <dt>Priority</dt><dd>${tag(item.priority)}</dd>
      ${item.severity ? html`<dt>Severity</dt><dd>${item.severity}</dd>` : ''}
      <dt>Acceptance blocker</dt><dd>${item.acceptance_blocker ? 'Yes' : 'No'}</dd>
      <dt>Source</dt>
      <dd>
        ${item.source || '—'}
        ${item.source_ref ? html` <span class="mono muted">${item.source_ref}${item.source_line ? `:${item.source_line}` : ''}</span>` : ''}
      </dd>
      <dt>Created</dt><dd>${when(item.created_at)}</dd>
      <dt>Last change</dt><dd>${when(item.updated_at)}</dd>
      ${item.completed_at ? html`<dt>Completed</dt><dd>${when(item.completed_at)}</dd>` : ''}
      ${item.deployed_at ? html`<dt>Deployed</dt><dd>${when(item.deployed_at)}</dd>` : ''}
      ${item.parent_id ? html`<dt>Parent</dt><dd><a class="mono" href="/items/${item.parent_id}">${item.parent_id}</a></dd>` : ''}
    </dl>
  </div>

  ${item.source_missing
    ? html`<div class="notice bad">
        <strong>The authoritative text for this item could not be recovered.</strong>
        It is recorded here so the gap is visible and countable. The tracker will not invent the wording;
        it has to be supplied from the project's own authoritative source.
      </div>`
    : ''}

  ${item.description
    ? html`<h2>Description</h2><div class="panel">${paragraphs(item.description)}</div>`
    : ''}

  ${decision
    ? html`
        <h2>Decision</h2>
        <div class="panel">
          <dl class="kv">
            <dt>Question</dt><dd>${decision.question}</dd>
            ${decision.options ? html`<dt>Options</dt><dd>${paragraphs(decision.options)}</dd>` : ''}
            ${decision.blocks ? html`<dt>Blocks</dt><dd>${decision.blocks}</dd>` : ''}
            <dt>Decision</dt>
            <dd>${decision.decision ? paragraphs(decision.decision) : html`<span class="tag DECISION_REQUIRED">not decided</span>`}</dd>
            ${decision.decided_by ? html`<dt>Decided by</dt><dd>${decision.decided_by} ${when(decision.decided_at)}</dd>` : ''}
            ${decision.implementation_status ? html`<dt>Implementation</dt><dd>${decision.implementation_status}</dd>` : ''}
          </dl>
        </div>`
    : ''}

  ${item.evidence ? html`<h2>Evidence</h2><div class="panel">${paragraphs(item.evidence)}</div>` : ''}
  ${item.notes ? html`<h2>Notes</h2><div class="panel">${paragraphs(item.notes)}</div>` : ''}

  ${children.length > 0
    ? html`
        <h2>Contains (${children.length})</h2>
        <div class="panel">
          <table>
            <thead><tr><th>ID</th><th>Item</th><th>Status</th></tr></thead>
            <tbody>
              ${children.map(
                (child) => html`<tr>
                  <td class="id"><a href="/items/${child.id}">${child.id}</a></td>
                  <td>${child.title}</td>
                  <td>${tag(child.status)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
    : ''}

  ${relations.length > 0
    ? html`
        <h2>Related</h2>
        <div class="panel">
          <table>
            <thead><tr><th>Relationship</th><th>Item</th></tr></thead>
            <tbody>
              ${relations.map(
                (rel) => html`<tr>
                  <td class="muted">${rel.direction === 'out' ? rel.kind : `${rel.kind} (incoming)`}</td>
                  <td class="id"><a href="/items/${rel.other}">${rel.other}</a></td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
    : ''}

  ${commits.length > 0
    ? html`
        <h2>Commits</h2>
        <div class="panel">
          <table>
            <thead><tr><th>Commit</th><th>Subject</th><th>When</th><th>Where it is</th></tr></thead>
            <tbody>
              ${commits.map(
                (commit) => html`<tr>
                  <td class="mono">${String(commit.hash).slice(0, 10)}</td>
                  <td>${commit.subject}</td>
                  <td>${when(commit.committed_at)}</td>
                  <td>${tag(commit.release_status ?? 'COMMITTED')}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
    : ''}

  ${files.length > 0
    ? html`
        <h2>Files</h2>
        <div class="panel">
          <p class="muted" style="margin-top:0">
            What this change added and what it removed. A change that adds an implementation without removing
            the one it replaces is visible here rather than only in a reviewer's memory.
          </p>
          <table>
            <thead><tr><th>Action</th><th>Path</th><th>Proved unreferenced</th><th>Note</th></tr></thead>
            <tbody>
              ${files.map(
                (file) => html`<tr>
                  <td>${tag(file.action)}</td>
                  <td class="mono">${file.path}</td>
                  <td>${file.action === 'REMOVED' ? (file.verified_unreferenced ? 'Yes' : 'No') : html`<span class="muted">—</span>`}</td>
                  <td class="muted">${file.note}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
    : ''}

  ${verifications.length > 0
    ? html`
        <h2>Verification</h2>
        <div class="panel">
          <table>
            <thead><tr><th>Result</th><th>Command</th><th>Passed</th><th>Commit</th><th>When</th></tr></thead>
            <tbody>
              ${verifications.map(
                (run) => html`<tr>
                  <td>${tag(run.result)}</td>
                  <td class="mono">${run.command}</td>
                  <td>${run.total === null ? html`<span class="muted">—</span>` : `${run.passed}/${run.total}`}</td>
                  <td class="mono">${run.commit_hash ? String(run.commit_hash).slice(0, 10) : ''}</td>
                  <td>${when(run.ran_at)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
    : ''}

  ${canEdit
    ? html`
        <h2>Record a change</h2>
        <div class="panel">
          <form method="post" action="/items/${item.id}/status" class="filters" style="margin:0">
            <input type="hidden" name="csrf" value="${csrf}">
            <select name="status">${STATUSES.map((s) => option(s, item.status))}</select>
            <input type="text" name="note" placeholder="Why (recorded in history)">
            <button type="submit">Save</button>
          </form>
        </div>`
    : ''}

  <h2>History</h2>
  <div class="panel">
    <ul class="timeline">
      ${history.map(
        (entry) => html`<li>
          <div class="when">${when(entry.at)} · ${entry.actor} · ${entry.kind}</div>
          <div>${entry.summary}</div>
          ${entry.detail ? html`<div class="muted">${entry.detail}</div>` : ''}
          ${entry.evidence ? html`<div class="muted mono">${entry.evidence}</div>` : ''}
        </li>`,
      )}
      ${history.length === 0 ? html`<li class="muted">No recorded changes.</li>` : ''}
    </ul>
  </div>
`;
