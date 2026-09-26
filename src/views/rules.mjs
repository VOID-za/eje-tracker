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

const SOURCE_TYPE = {
  OWNER_MESSAGE: "the project owner's own message",
  SCOPE_DOCUMENT: 'the authoritative business scope document',
  OWNER_RESTATEMENT: "the owner restating rules that already existed",
  NONE: 'no source found',
  UNKNOWN: 'source type not recorded',
};

const VARIANT_KIND = {
  HISTORICAL: 'Superseded wording, kept',
  ALTERNATE: 'Another version recorded at the same time',
  TASK_SCOPED: 'Written for one task, not as a standing rule',
  DESCRIPTION: 'A description of what was believed to be recorded',
};

export const rulesPage = ({ rules, historyByRule, variantsByRule = {}, searches = [], related }) => {
  // FIVE CATEGORIES, KEPT APART. Merging them would make the numbering look
  // complete at the cost of the truth about where each rule came from, and the
  // project owner's instruction is explicit that historical truth wins.
  const numbered = rules.filter((rule) => /^RULE-\d+$/.test(rule.id));
  const scopeRules = rules.filter((rule) => rule.id.startsWith('SCOPE-'));
  const founding = rules.filter((rule) => rule.id.startsWith('PRIN-') || rule.id.startsWith('STAND-'));
  const directives = rules.filter((rule) => rule.id.startsWith('DIR-'));
  const historical = rules.filter(
    (rule) => ![...numbered, ...scopeRules, ...founding, ...directives].includes(rule),
  );
  const missing = numbered.filter((rule) => rule.wording_authority === 'MISSING');
  const rendering = numbered.filter((rule) => rule.wording_authority === 'RENDERING');

  const card = (rule) => {
    const [authorityText, authorityTag] = AUTHORITY[rule.wording_authority] ?? AUTHORITY.RENDERING;
    const history = historyByRule[rule.id] ?? [];
    const variants = variantsByRule[rule.id] ?? [];
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
        ${variants.length > 0
          ? html`<details style="margin-top:0.4rem">
              <summary class="muted" style="font-size:0.82rem; cursor:pointer">
                ${variants.length} other version${variants.length === 1 ? '' : 's'} of this rule ${variants.length === 1 ? 'is' : 'are'} on record
              </summary>
              ${variants.map(
                (variant) => html`<blockquote
                  style="margin:0.5rem 0 0; padding-left:0.8rem; border-left:2px solid var(--line)">
                  ${paragraphs(variant.text)}
                  <div class="muted" style="font-size:0.78rem">
                    ${VARIANT_KIND[variant.kind] ?? variant.kind} · ${variant.source}
                  </div>
                </blockquote>`,
              )}
            </details>`
          : ''}
        <div class="muted" style="font-size:0.78rem; margin-top:0.45rem">
          <div>Source: ${rule.source || '—'}${rule.source_ref ? html` · ${rule.source_ref}` : ''}</div>
          <div>
            Source type: ${SOURCE_TYPE[rule.source_type] ?? rule.source_type}
            ${rule.source_date ? html` · dated ${when(rule.source_date)}` : ''}
          </div>
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

    <div class="panel">
      <h3 style="margin-top:0">What is on this page</h3>
      <table>
        <thead><tr><th>Category</th><th>Count</th><th>What it is</th></tr></thead>
        <tbody>
          <tr><td>Numbered project rules</td><td>${numbered.length}</td>
              <td>RULE-01…RULE-27, the project's own numbering</td></tr>
          <tr><td>Scope / development principles</td><td>${scopeRules.length}</td>
              <td>from the authoritative scope document, unnumbered</td></tr>
          <tr><td>Founding architectural principles</td><td>${founding.length}</td>
              <td>from the project's founding instruction, unnumbered</td></tr>
          <tr><td>Standing directives</td><td>${directives.length}</td>
              <td>mandatory sections of the owner's instructions, verbatim</td></tr>
          <tr><td>Superseded and historical</td><td>${historical.length}</td>
              <td>kept for the record; never current</td></tr>
        </tbody>
      </table>
      <p class="muted" style="margin-bottom:0">
        These categories are never merged. Making the numbering look complete by moving an unnumbered rule
        into a missing number would cost the truth about where it came from.
      </p>
    </div>

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

    ${scopeRules.length > 0
      ? html`<h2>Scope and development principles, from the scope of record (${scopeRules.length})</h2>
          <div class="panel">
            <p class="muted" style="margin-top:0">
              Recovered verbatim from <span class="mono">EJE_Master_Scope_and_Audit_Baseline_v2.docx</span>,
              the authoritative business scope document — nine product principles (§2) and eight
              development-control rules (§28). They are in force and they carry no number: the document's own
              items 11–24 are topic headings, not rules. They are <strong>not</strong> renumbered into the
              11–24 gap, by the project owner's decision of 26 September 2026
              (<a href="/items/TRK-BD-01">TRK-BD-01</a>).
            </p>
            ${scopeRules.map(card)}
          </div>`
      : ''}

    ${founding.length > 0
      ? html`<h2>Founding architectural principles (${founding.length})</h2>
          <div class="panel">
            <p class="muted" style="margin-top:0">
              The fourteen <em>ARCHITECTURAL PRINCIPLES</em> of the project's founding instruction, numbered
              1–14 in their own source, and the owner's <em>MOST IMPORTANT RULE</em>. In force, in the owner's
              own words, and deliberately not mapped onto the missing rule numbers.
            </p>
            ${founding.map(card)}
          </div>`
      : ''}

    ${searches.length > 0
      ? html`<h2>The recovery record (${searches.length} searches)</h2>
          <div class="panel">
            <p class="muted" style="margin-top:0">
              Every attempt to find a rule's authoritative wording, with what was searched, how, and what came
              back. It is here so that a rule marked as missing is an auditable conclusion rather than an
              assumption — and so nobody runs the same search a fourth time.
            </p>
            <table>
              <thead><tr><th>Rules</th><th>Source searched</th><th>Method</th><th>Result</th><th>When</th></tr></thead>
              <tbody>
                ${searches.map(
                  (search) => html`<tr>
                    <td class="mono">${search.scope}</td>
                    <td>${search.source}</td>
                    <td class="muted">${search.method}</td>
                    <td>
                      ${search.found ? html`<span class="tag DONE">recovered</span> ` : html`<span class="tag OPEN">nothing</span> `}
                      ${search.result}
                    </td>
                    <td>${when(search.searched_at)}</td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>`
      : ''}

    ${historical.length > 0
      ? html`<h2>Superseded and historical (${historical.length})</h2>
          <div class="panel">
            <p class="muted" style="margin-top:0">
              Kept, never deleted. A superseded rule is part of how the project came to be bound as it is.
              Task-scoped and descriptive wordings are not here — they stay attached to the rule they are a
              version of, so they can never be mistaken for rules of their own.
            </p>
            ${historical.map(card)}
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
