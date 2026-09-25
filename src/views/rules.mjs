/**
 * The Rules page.
 *
 * ITS JOB IS TO MAKE THE RULES HARD TO IGNORE, so the rules that are missing
 * are shown as loudly as the rules that are present. A rule recorded as
 * SOURCE_MISSING has an empty text on purpose: nobody — human or model —
 * invented wording to fill the hole, and the hole is counted on the dashboard
 * until the project owner supplies it.
 */
import { html, paragraphs } from '../http/html.mjs';
import { tag, when } from './layout.mjs';

export const rulesPage = ({ rules, historyByRule, related }) => {
  const missing = rules.filter((rule) => rule.status === 'SOURCE_MISSING');
  const numbered = rules.filter((rule) => rule.id.startsWith('RULE-'));
  const directives = rules.filter((rule) => rule.id.startsWith('DIR-'));

  const card = (rule) => html`
    <div class="rule ${rule.status === 'SOURCE_MISSING' ? 'missing' : ''}" id="${rule.id}">
      <div class="n">
        <span class="mono">${rule.id}</span> · ${tag(rule.status)}
        ${rule.category ? html` · ${rule.category}` : ''}
        ${rule.source_ref ? html` · <span class="muted">${rule.source_ref}</span>` : ''}
      </div>
      ${rule.text
        ? paragraphs(rule.text)
        : html`<p class="muted"><em>No authoritative text recorded. ${rule.note}</em></p>`}
      <div class="muted" style="font-size:0.78rem; margin-top:0.35rem">
        Created ${when(rule.created_at)} · Updated ${when(rule.updated_at)}
        ${(related[rule.id] ?? []).length > 0
          ? html` · Related:
              ${(related[rule.id] ?? []).map((id) => html`<a class="mono" href="/items/${id}">${id}</a> `)}`
          : ''}
        ${(historyByRule[rule.id] ?? []).length > 0
          ? html` · ${(historyByRule[rule.id] ?? []).length} recorded change(s)`
          : ''}
      </div>
    </div>`;

  return html`
    <h1>EJE development rules</h1>
    <p class="lead">
      ${rules.length} recorded. Every rule is stored exactly as the authoritative source states it —
      nothing here is paraphrased, shortened or tidied. The source of each rule is named against it.
    </p>

    ${missing.length > 0
      ? html`<div class="notice bad">
          <strong>Rules ${missing[0].id.replace('RULE-', '')}–${missing[missing.length - 1].id.replace('RULE-', '')} are recorded without their text.</strong>
          The project owner's instruction states that these already exist in the established EJE project rules
          and must be recovered from the authoritative source rather than guessed, rewritten or invented.
          They were not found in the EJE repository or in any source available to the tracker, so they are
          recorded here as an explicit gap — ${missing.length} of them — and counted on the dashboard until
          the authoritative wording is supplied.
        </div>`
      : ''}

    <h2>Numbered project rules (${numbered.length})</h2>
    <div class="panel">${numbered.map(card)}</div>

    <h2>Standing directives (${directives.length})</h2>
    <div class="panel">
      <p class="muted" style="margin-top:0">
        Mandatory sections of the same instruction that are not part of the numbered series. They are recorded
        under their own identifiers rather than being renumbered into the 11–24 gap, because renumbering them
        would be an invention of exactly the kind the rules forbid.
      </p>
      ${directives.map(card)}
    </div>
  `;
};
