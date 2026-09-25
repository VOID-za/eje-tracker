/**
 * The Rules page.
 *
 * RULES ARE NOT TASKS. They have no DONE state, they are never "completed",
 * and nothing in the tracker can close one: a rule is a permanent constraint
 * until a documented decision supersedes it. They live in their own table for
 * exactly that reason.
 *
 * ITS JOB IS TO MAKE THE RULES HARD TO IGNORE, so what the tracker does not
 * know is shown as loudly as what it does. Every rule carries how good its
 * wording is known to be — the owner's own words, somebody's restatement, or
 * nothing at all — because a rule that has been quietly reworded is a different
 * rule, and a gap that has been quietly filled is a fabrication.
 */
import { html, paragraphs } from '../http/html.mjs';
import { tag, when } from './layout.mjs';

const AUTHORITY = {
  AUTHORITATIVE: ["the project owner's own words, on record", 'DONE'],
  RENDERING: ['a restatement — exact wording awaiting confirmation', 'OPEN'],
  MISSING: ['no wording recovered from any source, and none invented', 'SOURCE_MISSING'],
};

export const rulesPage = ({ rules, historyByRule, related }) => {
  const numbered = rules.filter((rule) => /^RULE-\d+$/.test(rule.id));
  const directives = rules.filter((rule) => rule.id.startsWith('DIR-'));
  const other = rules.filter((rule) => !numbered.includes(rule) && !directives.includes(rule));
  const missing = numbered.filter((rule) => rule.wording_authority === 'MISSING');
  const rendering = numbered.filter((rule) => rule.wording_authority === 'RENDERING');

  const card = (rule) => {
    const [authorityText, authorityTag] = AUTHORITY[rule.wording_authority] ?? AUTHORITY.RENDERING;
    const history = historyByRule[rule.id] ?? [];
    return html`
      <div class="rule ${rule.wording_authority === 'MISSING' ? 'missing' : ''}" id="${rule.id}">
        <div class="n">
          <span class="mono">${rule.id}</span>
          · <span class="tag ${authorityTag}">${rule.wording_authority}</span>
          ${rule.status !== 'ACTIVE' ? html` · ${tag(rule.status)}` : ''}
          ${rule.category ? html` · ${rule.category}` : ''}
        </div>
        ${rule.text
          ? paragraphs(rule.text)
          : html`<p class="muted"><em>No authoritative text recorded.</em></p>`}
        ${rule.note ? html`<p class="muted" style="font-size:0.85rem">${rule.note}</p>` : ''}
        ${rule.variant_wording
          ? html`<details style="margin-top:0.4rem">
              <summary class="muted" style="font-size:0.82rem; cursor:pointer">
                Another version of this rule is on record
              </summary>
              <blockquote style="margin:0.5rem 0 0; padding-left:0.8rem; border-left:2px solid var(--line)">
                ${paragraphs(rule.variant_wording)}
                <div class="muted" style="font-size:0.78rem">${rule.variant_source}</div>
              </blockquote>
            </details>`
          : ''}
        <div class="muted" style="font-size:0.78rem; margin-top:0.45rem">
          <div>Source: ${rule.source || '—'}${rule.source_ref ? html` · ${rule.source_ref}` : ''}</div>
          <div>
            Wording: ${authorityText} ·
            Last verified:
            ${rule.verified_at
              ? html`${when(rule.verified_at)}${rule.verified_by ? html` by ${rule.verified_by}` : ''}`
              : html`<strong>never</strong>`}
          </div>
          <div>
            Created ${when(rule.created_at)} · Updated ${when(rule.updated_at)} ·
            ${history.length} recorded change${history.length === 1 ? '' : 's'}
            ${(related[rule.id] ?? []).length > 0
              ? html` · Related:
                  ${(related[rule.id] ?? []).map((id) => html`<a class="mono" href="/items/${id}">${id}</a> `)}`
              : ''}
          </div>
        </div>
        ${history.length > 1
          ? html`<details style="margin-top:0.35rem">
              <summary class="muted" style="font-size:0.78rem; cursor:pointer">History</summary>
              <ul class="timeline" style="margin-top:0.5rem">
                ${history.map(
                  (entry) => html`<li>
                    <div class="when">${when(entry.at)} · ${entry.actor}</div>
                    <div>${entry.summary}</div>
                    ${entry.detail ? html`<div class="muted">${entry.detail}</div>` : ''}
                  </li>`,
                )}
              </ul>
            </details>`
          : ''}
      </div>`;
  };

  return html`
    <h1>EJE development rules</h1>
    <p class="lead">
      ${numbered.length} numbered project rules, ${directives.length} standing directives.
      A rule is a permanent constraint on this project — it is not a task, it has no DONE state, and
      nothing in this tracker can close one. It changes only when a documented decision supersedes it,
      and every such change is kept in its history with the wording it replaced.
    </p>

    ${missing.length > 0
      ? html`<div class="notice bad">
          <strong>${missing.length} rules are recorded without their text: ${missing[0].id.replace('RULE-', 'rule ')}–${missing[missing.length - 1].id.replace('RULE-', '')}.</strong>
          Every source available to the tracker was searched at Phase 3A — this repository and its history,
          the EJE repository working tree and every blob in all of its commits, all EJE commit messages,
          <span class="mono">docs/SCOPE.md</span> and every other EJE document ever committed, and the
          complete project conversation including every pasted instruction. None of them contains any
          wording for these rules. They are recorded as an explicit gap rather than invented, and the
          project owner has to supply the wording — <a href="/items/TRK-BD-01">TRK-BD-01</a>.
        </div>`
      : ''}

    ${rendering.length > 0
      ? html`<div class="notice">
          <strong>${rendering.length} rules are in force, but the wording on file is a restatement.</strong>
          It came from a summary that introduced the rules as "the established rules include", and the
          authoritative wording of rules 25–27 — supplied later — differed materially from that same
          summary's version of them. These rules bind; their exact wording awaits the owner's confirmation
          — <a href="/items/TRK-BD-02">TRK-BD-02</a>. Where a second version is on record it is kept
          beside each rule rather than chosen between.
        </div>`
      : ''}

    <h2>The numbered project rules (${numbered.length})</h2>
    <div class="panel">${numbered.map(card)}</div>

    ${other.length > 0
      ? html`<h2>Superseded and retired (${other.length})</h2>
          <div class="panel">
            <p class="muted" style="margin-top:0">
              Kept, never deleted. A superseded rule is part of how the project came to be bound as it is.
            </p>
            ${other.map(card)}
          </div>`
      : ''}

    <h2>Standing directives (${directives.length})</h2>
    <div class="panel">
      <p class="muted" style="margin-top:0">
        Mandatory sections of the project owner's own instructions, verbatim, that are not part of the
        numbered series. They are recorded under their own identifiers rather than being renumbered into
        the 11–24 gap, because renumbering them would be an invention of exactly the kind the rules forbid.
      </p>
      ${directives.map(card)}
    </div>
  `;
};
