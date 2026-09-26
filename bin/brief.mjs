#!/usr/bin/env node
/**
 * The pre-task briefing: what is true right now, in one page.
 *
 * WHY THIS EXISTS. The tracker is the shared memory of three parties who cannot
 * talk to each other — the project owner, ChatGPT and Claude. A web page serves
 * the first; a JSON API serves a machine that can reach the host. Neither serves
 * an assistant in a browser tab somewhere else. This prints the live state as
 * text that can be pasted into any conversation, and it is what Claude reads
 * before touching the EJE application.
 *
 *   npm run brief            markdown, for pasting into ChatGPT or a prompt
 *   npm run brief -- --json  the same state as JSON
 *
 * READ-ONLY. It writes nothing, anywhere.
 */
import { db, closeDb } from '../src/db/client.mjs';
import { countsByDelivery, countsByStatus, listItems } from '../src/repo/items.mjs';
import { latestDeployedRelease, listCommits, listRules, listVerifications } from '../src/repo/project.mjs';
import { summarise } from '../src/domain/progress.mjs';

const wantsJson = process.argv.includes('--json');
const sql = db();

const [statusCounts, deliveryCounts, rules, deployed, commits, verifications] = await Promise.all([
  countsByStatus(sql), countsByDelivery(sql), listRules(sql),
  latestDeployedRelease(sql), listCommits(10, sql), listVerifications(5, sql),
]);

const [decisions, blockers, working, stuck, undeployed] = await Promise.all([
  listItems({ kind: 'Decision', status: 'DECISION_REQUIRED' }, sql),
  listItems({ blocker: true }, sql).then((rows) =>
    rows.filter((row) => !['DONE', 'CANCELLED', 'SUPERSEDED'].includes(row.status))),
  listItems({ status: 'IN_PROGRESS', sort: 'updated' }, sql),
  listItems({ stuck: true, sort: 'updated' }, sql).then((rows) => rows.filter((row) => row.status === 'BLOCKED')),
  sql`SELECT id, title, status, delivery FROM items
       WHERE status = 'DONE' AND delivery IN ('LOCAL','COMMITTED','PUSHED') ORDER BY id`,
]);

const summary = summarise(statusCounts, deliveryCounts);
const ruleCount = (prefix) => rules.filter((rule) => rule.id.startsWith(prefix)).length;
const missing = rules.filter((rule) => rule.wording_authority === 'MISSING').map((rule) => rule.id);

if (wantsJson) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    summary,
    rules: {
      total: rules.length,
      numbered: rules.filter((rule) => /^RULE-\d+$/.test(rule.id)).length,
      scopeDocument: ruleCount('SCOPE-'),
      founding: ruleCount('PRIN-') + ruleCount('STAND-'),
      directives: ruleCount('DIR-'),
      sourceMissing: missing,
    },
    liveBuild: deployed === null ? null : { commit: deployed.commit_hash, observedAt: deployed.observed_at },
    openDecisions: decisions.map((d) => ({ id: d.id, title: d.title })),
    acceptanceBlockers: blockers.map((b) => ({ id: b.id, title: b.title, status: b.status })),
    inProgress: working.map((w) => ({ id: w.id, title: w.title })),
    blocked: stuck.map((s) => ({ id: s.id, title: s.title })),
    doneNotDeployed: undeployed.length,
  }, null, 2));
  await closeDb();
  process.exit(0);
}

const list = (rows, format) =>
  rows.length === 0 ? '- none\n' : rows.map((row) => `- ${format(row)}\n`).join('');

console.log(`# EJE project state — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC

Generated from the EJE Project Tracker. This is the authoritative current state.
Read it before starting work; do not rely on an older conversation.

## The lifecycle, which is not negotiable

Work status and code delivery are separate. IMPLEMENTED is not TESTED, TESTED is
not APPROVED, APPROVED is DONE. PUSHED is not DEPLOYED — deployment is only ever
recorded from the live application's own build stamp and git ancestry.

## Where the project is

- ${summary.done} of ${summary.all} tracked items are DONE (${summary.donePercent}%).
- ${summary.built} are built but not accepted; ${summary.working} in progress; ${summary.stuck} waiting on somebody.
- ${undeployed.length} items are finished in the ledger but their code is NOT on the server.
- Live EJE build: ${deployed === null ? 'no deployment evidence recorded' : `${deployed.commit_hash.slice(0, 10)} (observed ${new Date(deployed.observed_at).toISOString().slice(0, 10)})`}.

## Rules in force — ${rules.length} records

- ${rules.filter((rule) => /^RULE-\d+$/.test(rule.id)).length} numbered project rules (RULE-01…RULE-27)
- ${ruleCount('SCOPE-')} principles from the authoritative scope document
- ${ruleCount('PRIN-') + ruleCount('STAND-')} founding architectural principles
- ${ruleCount('DIR-')} standing directives

${missing.length} rules have no recoverable wording and are recorded as SOURCE_MISSING
(${missing.join(', ')}). By the owner's decision of 26 September 2026 they are NOT to be
reconstructed, invented or renumbered. Read /rules for the full text — the rules
that bind hardest on any change are: never deploy unless asked; remove the old
implementation when you replace it; keep database, code, seeds and tests
consistent; the system must stay tablet friendly; security from the start; and
mark work DONE in the tracker the moment it is finished, tested and approved.

## Open business decisions — ${decisions.length}

Nothing may be implemented that silently assumes an answer to any of these.

${list(decisions, (d) => `**${d.id}** — ${d.title}`)}
## Acceptance blockers still open — ${blockers.length}

${list(blockers, (b) => `**${b.id}** (${b.status}) — ${b.title}`)}
## In progress — ${working.length}

${list(working, (w) => `**${w.id}** — ${w.title}`)}
## Blocked — ${stuck.length}

${list(stuck, (s) => `**${s.id}** — ${s.title}`)}
## Finished but not on the server — ${undeployed.length}

${undeployed.length === 0 ? '- none\n' : `The first few: ${undeployed.slice(0, 12).map((row) => row.id).join(', ')}${undeployed.length > 12 ? `, and ${undeployed.length - 12} more` : ''}\n`}
## Recent commits

${list(commits, (c) => `\`${c.hash.slice(0, 10)}\` ${c.subject}${c.release_status ? ` — ${c.release_status}` : ''}`)}
## Most recent verification

${list(verifications, (v) => `${v.result} — \`${v.command}\`${v.total === null ? '' : ` ${v.passed}/${v.total}`}`)}
---

Before implementing anything: identify the requirement/task IDs it affects, check
they are not already DONE, check no open decision governs them, and check which
rules apply. After implementing: record what changed, what was removed, the tests
run, the verification done, the commit, and the delivery state — and do not mark
anything DONE without testing and the owner's approval.`);

await closeDb();
