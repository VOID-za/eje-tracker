import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeDatabase, freshDatabase, testUrl } from './helpers.mjs';
import { getItem, historyFor, listItems, saveItem, setStatus } from '../src/repo/items.mjs';
import { saveRule, listRules } from '../src/repo/project.mjs';
import { importScope } from '../src/import/scope.mjs';

const options = describeDatabase === null ? {} : { skip: describeDatabase };

test('migrations run once and are safe to run again', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    const applied = await sql`SELECT version FROM schema_migrations`;
    assert.ok(applied.length >= 1);
    const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const names = tables.map((row) => row.tablename);
    for (const table of ['items', 'history', 'rules', 'decisions', 'users', 'sessions', 'audit_log']) {
      assert.ok(names.includes(table), `${table} is missing`);
    }
  } finally {
    await close();
  }
});

test('a saved item writes one history row per field that actually changed', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    await saveItem({ id: 'T-1', kind: 'Requirement', title: 'A thing' }, {}, sql);
    assert.equal((await historyFor('item', 'T-1', sql)).length, 1);

    const unchanged = await saveItem({ id: 'T-1', kind: 'Requirement', title: 'A thing' }, {}, sql);
    assert.deepEqual(unchanged.changed, [], 'a repeat save changes nothing');
    assert.equal((await historyFor('item', 'T-1', sql)).length, 1, 'and records nothing');

    await saveItem({ id: 'T-1', title: 'A renamed thing', notes: 'why' }, {}, sql);
    const history = await historyFor('item', 'T-1', sql);
    assert.equal(history.length, 3);
    assert.match(history[1].summary, /title: A thing → A renamed thing/);
  } finally {
    await close();
  }
});

test('a status change goes through the lifecycle or not at all', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    await saveItem({ id: 'T-2', kind: 'Requirement', title: 'Work' }, {}, sql);
    await assert.rejects(
      () => setStatus('T-2', 'DONE', { actor: 'tester' }, sql),
      /jump straight to DONE/,
    );
    await setStatus('T-2', 'IN_PROGRESS', { actor: 'tester' }, sql);
    await setStatus('T-2', 'IMPLEMENTED', { actor: 'tester' }, sql);
    await setStatus('T-2', 'TESTING', { actor: 'tester' }, sql);
    await setStatus('T-2', 'APPROVED', { actor: 'tester' }, sql);
    const done = await setStatus('T-2', 'DONE', { actor: 'tester', note: 'accepted' }, sql);
    assert.equal(done.status, 'DONE');
    assert.ok(done.completed_at instanceof Date);
    const history = await historyFor('item', 'T-2', sql);
    assert.equal(history.filter((row) => row.kind === 'status').length, 5);
  } finally {
    await close();
  }
});

test('an unknown status never reaches the database', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    await saveItem({ id: 'T-3', kind: 'Requirement', title: 'Work' }, {}, sql);
    await assert.rejects(() => setStatus('T-3', 'FINISHED', {}, sql), /not a status/);
    await assert.rejects(
      () => sql`INSERT INTO items (id, kind, title, status) VALUES ('T-4', 'Requirement', 'x', 'FINISHED')`,
      /items_status_known/,
    );
  } finally {
    await close();
  }
});

test('a rule is stored verbatim and a change to its text is recorded', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    await saveRule({ id: 'RULE-01', ordinal: 1, text: 'Never deploy unless asked.' }, {}, sql);
    await saveRule({ id: 'RULE-11', ordinal: 11, text: '', status: 'SOURCE_MISSING' }, {}, sql);
    const rules = await listRules(sql);
    assert.equal(rules[0].text, 'Never deploy unless asked.');
    assert.equal(rules[1].status, 'SOURCE_MISSING');
    assert.equal(rules[1].text, '');

    await saveRule({ id: 'RULE-01', text: 'Never deploy unless asked, ever.' }, {}, sql);
    const history = await historyFor('rule', 'RULE-01', sql);
    assert.equal(history.length, 2);
    assert.match(history[1].detail, /Previous wording, kept: Never deploy unless asked\./);
  } finally {
    await close();
  }
});

test('importing the same document twice changes nothing the second time', options, async () => {
  const { sql, close } = await freshDatabase();
  const directory = mkdtempSync(join(tmpdir(), 'tracker-scope-'));
  const path = join(directory, 'SCOPE.md');
  writeFileSync(path, `# Scope

## Requirement register

### Sample

| ID | Requirement | Status | Commit |
|---|---|---|---|
| THING-1 | The first thing | **DONE** | \`abc1234\` |
| THING-2 | The second thing | **NOT IMPLEMENTED** | — |
`);
  try {
    const first = await importScope({ path, log: () => {}, sql });
    assert.equal(first.created, 2);
    const second = await importScope({ path, log: () => {}, sql });
    assert.equal(second.created, 0);
    assert.equal(second.updated, 0);
    assert.equal((await historyFor('item', 'THING-1', sql)).length, 1);
  } finally {
    await close();
  }
});

test('an item that leaves the document is kept, not deleted', options, async () => {
  const { sql, close } = await freshDatabase();
  const directory = mkdtempSync(join(tmpdir(), 'tracker-scope-'));
  const path = join(directory, 'SCOPE.md');
  const header = `# Scope\n\n## Requirement register\n\n### Sample\n\n| ID | Requirement | Status |\n|---|---|---|\n`;
  writeFileSync(path, `${header}| THING-1 | The first thing | **DONE** |\n| THING-2 | The second thing | **DONE** |\n`);
  try {
    await importScope({ path, log: () => {}, sql });
    writeFileSync(path, `${header}| THING-1 | The first thing | **DONE** |\n`);
    const second = await importScope({ path, log: () => {}, sql });
    assert.equal(second.departed, 1);

    const survivor = await getItem('THING-2', sql);
    assert.ok(survivor, 'the record of what the project once required was deleted');
    assert.equal(survivor.source_missing, true);
    const history = await historyFor('item', 'THING-2', sql);
    assert.match(history.at(-1).summary, /No longer present in docs\/SCOPE\.md/);
  } finally {
    await close();
  }
});

test('filters and search are applied by the database, not by the caller', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    await saveItem({ id: 'A-1', kind: 'Bug', title: 'Tablet PDF preview', status: 'OPEN', group_path: 'UI' }, {}, sql);
    await saveItem({ id: 'A-2', kind: 'Requirement', title: 'Offline cache', status: 'OPEN', group_path: 'PLATFORM', acceptance_blocker: true }, {}, sql);
    await saveItem({ id: 'A-3', kind: 'Requirement', title: 'Something else', status: 'DONE', group_path: 'PLATFORM' }, {}, sql);

    assert.equal((await listItems({ kind: 'Bug' }, sql)).length, 1);
    assert.equal((await listItems({ status: 'OPEN' }, sql)).length, 2);
    assert.equal((await listItems({ group: 'PLATFORM' }, sql)).length, 2);
    assert.equal((await listItems({ blocker: true }, sql)).length, 1);
    assert.equal((await listItems({ q: 'tablet' }, sql)).length, 1, 'search is case-insensitive');
    assert.equal((await listItems({ q: "'; DROP TABLE items; --" }, sql)).length, 0);
    assert.equal((await listItems({ sort: 'nonsense; DROP TABLE items' }, sql)).length, 3, 'sort is a whitelist');
  } finally {
    await close();
  }
});

test('migration 0001 is additive, idempotent, and keeps every rule', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    await saveRule({ id: 'RULE-01', ordinal: 1, text: 'Never deploy unless asked.' }, {}, sql);
    // Re-running every migration must not disturb a row that already exists.
    const { migrate } = await import('../src/db/migrate.mjs');
    await migrate({ sql, log: () => {} });
    const [rule] = await sql`SELECT * FROM rules WHERE id = 'RULE-01'`;
    assert.equal(rule.text, 'Never deploy unless asked.');
    assert.equal(rule.wording_authority, 'RENDERING', 'the default says the wording is unconfirmed');
    assert.equal(rule.verified_at, null, 'nothing is verified until somebody verifies it');

    await assert.rejects(
      () => sql`UPDATE rules SET wording_authority = 'DEFINITELY' WHERE id = 'RULE-01'`,
      /rules_wording_authority_known/,
    );
  } finally {
    await close();
  }
});

test('correcting a rule keeps the wording it replaced, as a variant and in history', options, async () => {
  const { sql, close } = await freshDatabase();
  const { variantsFor } = await import('../src/repo/project.mjs');
  try {
    await saveRule({
      id: 'RULE-25', ordinal: 25, text: 'The complete system must ALWAYS remain tablet friendly.',
      wording_authority: 'RENDERING', source: 'Phase 2 §7 (a restatement)',
    }, {}, sql);
    const result = await saveRule({
      id: 'RULE-25',
      text: 'The complete system should always but always stay Tablet friendly!!',
      wording_authority: 'AUTHORITATIVE',
      verified_by: 'Project owner (EJE)',
      verified_at: '2026-09-25',
    }, {}, sql);
    assert.ok(result.changed.includes('text'));
    assert.ok(result.changed.includes('wording_authority'));

    const [rule] = await sql`SELECT * FROM rules WHERE id = 'RULE-25'`;
    assert.equal(rule.text, 'The complete system should always but always stay Tablet friendly!!');
    assert.equal(rule.wording_authority, 'AUTHORITATIVE');

    // The replaced wording is filed automatically — a caller cannot lose it by
    // forgetting to pass it.
    const variants = await variantsFor('RULE-25', sql);
    assert.equal(variants.length, 1);
    assert.equal(variants[0].text, 'The complete system must ALWAYS remain tablet friendly.');
    assert.equal(variants[0].kind, 'HISTORICAL');

    const history = await historyFor('rule', 'RULE-25', sql);
    assert.match(history.at(-1).detail, /Previous wording, kept: The complete system must ALWAYS/);
  } finally {
    await close();
  }
});

test('a rule can hold several wordings at once, and never the same one twice', options, async () => {
  const { sql, close } = await freshDatabase();
  const { variantsFor } = await import('../src/repo/project.mjs');
  try {
    await saveRule({
      id: 'RULE-02', ordinal: 2, text: 'Version A.',
      variants: [
        { text: 'Version B.', source: 'the BD-06 preamble', kind: 'HISTORICAL' },
        { text: 'Version C.', source: 'Phase 3B §4', kind: 'ALTERNATE' },
      ],
    }, {}, sql);
    // Importing the same rule again must not multiply its variants.
    await saveRule({
      id: 'RULE-02', text: 'Version A.',
      variants: [
        { text: 'Version B.', source: 'the BD-06 preamble', kind: 'HISTORICAL' },
        { text: 'Version C.', source: 'Phase 3B §4', kind: 'ALTERNATE' },
      ],
    }, {}, sql);

    const variants = await variantsFor('RULE-02', sql);
    assert.equal(variants.length, 2);
    assert.deepEqual(variants.map((variant) => variant.kind), ['HISTORICAL', 'ALTERNATE']);
    assert.equal(variants.filter((variant) => variant.text === 'Version A.').length, 0,
      'the current wording is not also filed as a variant');
  } finally {
    await close();
  }
});

test('migration 0002 carries variants across before dropping the columns it replaces', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    // 0002 has already run in freshDatabase; prove the old columns are gone and
    // nothing reads them any more.
    const columns = await sql`SELECT column_name FROM information_schema.columns
                               WHERE table_name = 'rules'`;
    const names = columns.map((row) => row.column_name);
    assert.ok(!names.includes('variant_wording'), 'the replaced column is still there');
    assert.ok(!names.includes('variant_source'), 'the replaced column is still there');
    assert.ok(names.includes('wording_authority'));

    await assert.rejects(
      () => sql`INSERT INTO rule_variants (rule_id, text) VALUES ('nope', 'x')`,
      /rule_variants_rule_id_fkey/,
      'a variant may not belong to a rule that does not exist',
    );
  } finally {
    await close();
  }
});

test('a rule is never stored as a task', options, async () => {
  const { sql, close } = await freshDatabase();
  const { importRules } = await import('../src/import/rules.mjs');
  const { importTrackerItems } = await import('../src/import/tracker-items.mjs');
  try {
    await importRules({ log: () => {}, sql });
    await importTrackerItems({ log: () => {}, sql });

    const asItems = await sql`SELECT id FROM items WHERE id LIKE 'RULE-%' OR id LIKE 'DIR-%'`;
    assert.equal(asItems.length, 0, `a rule leaked into the task ledger: ${asItems.map((r) => r.id)}`);

    const done = await sql`SELECT id FROM rules WHERE status IN ('DONE','APPROVED','IMPLEMENTED')`;
    assert.equal(done.length, 0, 'a rule was marked as finished work');

    const numbered = await sql`SELECT id FROM rules WHERE id ~ '^RULE-[0-9]+$' ORDER BY ordinal`;
    assert.equal(numbered.length, 27, 'rules 1-27 must all be present');
  } finally {
    await close();
  }
});

test('re-importing the rules changes nothing and records nothing', options, async () => {
  const { sql, close } = await freshDatabase();
  const { importRules } = await import('../src/import/rules.mjs');
  try {
    // Counted from the file rather than hard-coded, so adding a rule cannot
    // quietly make this test meaningless.
    const { rulesPath } = await import('../src/import/rules.mjs');
    const { readFileSync } = await import('node:fs');
    const expected = JSON.parse(readFileSync(rulesPath, 'utf8')).rules.length;

    const first = await importRules({ log: () => {}, sql });
    assert.equal(first.created, expected);
    const second = await importRules({ log: () => {}, sql });
    assert.equal(second.created, 0);
    assert.equal(second.updated, 0);
    const history = await sql`SELECT count(*)::int AS n FROM history WHERE entity_type = 'rule'`;
    assert.equal(history[0].n, expected, 'a repeat import wrote history nobody asked for');

    // Nor may it multiply the variants.
    const variants = await sql`SELECT count(*)::int AS n FROM rule_variants`;
    await importRules({ log: () => {}, sql });
    const again = await sql`SELECT count(*)::int AS n FROM rule_variants`;
    assert.equal(again[0].n, variants[0].n, 'a repeat import duplicated recorded wordings');
  } finally {
    await close();
  }
});

test('migration 0003 records provenance and constrains it', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    const columns = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'rules'`;
    const names = columns.map((row) => row.column_name);
    for (const column of ['source_type', 'source_date', 'wording_authority']) {
      assert.ok(names.includes(column), `${column} is missing`);
    }
    await saveRule({ id: 'RULE-01', ordinal: 1, text: 'x', source_type: 'SCOPE_DOCUMENT' }, {}, sql);
    await assert.rejects(
      () => sql`UPDATE rules SET source_type = 'HEARSAY' WHERE id = 'RULE-01'`,
      /rules_source_type_known/,
    );
    await assert.rejects(
      () => sql`INSERT INTO rule_variants (rule_id, text, kind) VALUES ('RULE-01', 'y', 'GUESSED')`,
      /rule_variants_kind_known/,
    );
    // The kinds the evidence actually needs are all accepted.
    for (const kind of ['HISTORICAL', 'ALTERNATE', 'TASK_SCOPED', 'DESCRIPTION']) {
      await sql`INSERT INTO rule_variants (rule_id, text, kind) VALUES ('RULE-01', ${kind}, ${kind})`;
    }
  } finally {
    await close();
  }
});

test('the search record is append-only and never files a search twice', options, async () => {
  const { sql, close } = await freshDatabase();
  const { importRules } = await import('../src/import/rules.mjs');
  const { listRuleSearches } = await import('../src/repo/project.mjs');
  try {
    await importRules({ log: () => {}, sql });
    const first = await listRuleSearches(sql);
    assert.ok(first.length >= 14, 'every recorded search must be imported');
    assert.ok(first.some((search) => search.found === false), 'a search that found nothing is still recorded');
    assert.ok(first.some((search) => search.found === true), 'a search that found something is marked so');

    await importRules({ log: () => {}, sql });
    const second = await listRuleSearches(sql);
    assert.equal(second.length, first.length, 'a repeat import filed the same searches again');
    assert.deepEqual(second.map((s) => s.id), first.map((s) => s.id), 'the record was rewritten, not kept');

    // Every rule that has no wording must have a search behind it.
    const missing = await sql`SELECT id FROM rules WHERE wording_authority = 'MISSING'`;
    assert.ok(missing.length > 0);
    const scopes = second.map((search) => search.scope);
    assert.ok(scopes.includes('RULE-11..24'), 'the missing rules have no recorded search behind them');
  } finally {
    await close();
  }
});

test('an answered decision can be closed, and the answer is kept with it', options, async () => {
  const { sql, close } = await freshDatabase();
  const { saveDecision, getDecision } = await import('../src/repo/project.mjs');
  try {
    await saveItem({ id: 'BD-99', kind: 'Decision', title: 'Should the thing exist?',
      status: 'DECISION_REQUIRED' }, {}, sql);
    await saveDecision({ id: 'BD-99', question: 'Should the thing exist?', options: '(a) yes (b) no' }, sql);

    const closed = await setStatus('BD-99', 'DONE', { actor: 'owner', note: 'answered' }, sql);
    assert.equal(closed.status, 'DONE');

    await saveDecision({
      id: 'BD-99', question: 'Should the thing exist?', options: '(a) yes (b) no',
      decision: 'No, it should not.', decided_by: 'Project owner (EJE)', decided_at: '2026-09-26',
    }, sql);
    const record = await getDecision('BD-99', sql);
    assert.equal(record.decision, 'No, it should not.');
    assert.equal(record.options, '(a) yes (b) no', 'the options are kept after the answer');
    assert.ok(record.decided_at instanceof Date);

    // A later import that carries no answer must not blank the one on record.
    await saveDecision({ id: 'BD-99', question: 'Should the thing exist?', options: '(a) yes (b) no' }, sql);
    const after = await getDecision('BD-99', sql);
    assert.equal(after.decision, 'No, it should not.');
    assert.ok(after.decided_at instanceof Date, 'the decision date was blanked by a later import');
  } finally {
    await close();
  }
});

test('ordinary work waiting on a decision still cannot be closed', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    await saveItem({ id: 'REQ-1', kind: 'Requirement', title: 'Needs a decision first',
      status: 'DECISION_REQUIRED' }, {}, sql);
    await assert.rejects(
      () => setStatus('REQ-1', 'DONE', { actor: 'tester' }, sql),
      /only allowed for an item of kind Decision/,
    );
  } finally {
    await close();
  }
});

test('both rule decisions are recorded as answered, with their questions kept', options, async () => {
  const { sql, close } = await freshDatabase();
  const { importTrackerItems } = await import('../src/import/tracker-items.mjs');
  const { getDecision } = await import('../src/repo/project.mjs');
  try {
    await importTrackerItems({ log: () => {}, sql });
    for (const id of ['TRK-BD-01', 'TRK-BD-02']) {
      const record = await getDecision(id, sql);
      assert.equal(record.status, 'DONE', `${id} must be closed`);
      assert.ok(record.decision.length > 0, `${id} must record the answer`);
      assert.equal(record.decided_by, 'Project owner (EJE)');
      assert.ok(record.question.length > 0, `${id} must keep the question it asked`);
      assert.ok(record.options.length > 0, `${id} must keep the options it offered`);
    }
    const one = await getDecision('TRK-BD-01', sql);
    assert.match(one.decision, /retained as SOURCE_MISSING rather than being reconstructed or invented/);
    const two = await getDecision('TRK-BD-02', sql);
    assert.match(two.decision, /Historical variants remain preserved/);
  } finally {
    await close();
  }
});

test('the briefing reports the live state, and writes nothing', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    // A state worth briefing on: work in every interesting condition.
    await saveItem({ id: 'R-1', kind: 'Requirement', title: 'Finished and live',
      status: 'DONE', delivery: 'DEPLOYED' }, {}, sql);
    await saveItem({ id: 'R-2', kind: 'Requirement', title: 'Finished, not on the server',
      status: 'DONE', delivery: 'PUSHED' }, {}, sql);
    await saveItem({ id: 'R-3', kind: 'Requirement', title: 'Still a blocker',
      status: 'OPEN', acceptance_blocker: true }, {}, sql);
    await saveItem({ id: 'BD-99', kind: 'Decision', title: 'Unanswered question',
      status: 'DECISION_REQUIRED' }, {}, sql);
    await saveRule({ id: 'RULE-11', ordinal: 11, text: '', status: 'SOURCE_MISSING',
      wording_authority: 'MISSING', source_type: 'NONE' }, {}, sql);

    const before = await sql`SELECT count(*)::int AS n FROM history`;

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const { stdout } = await run('node', ['bin/brief.mjs'], {
      env: { ...process.env, TRACKER_DATABASE_URL: testUrl },
      cwd: new URL('..', import.meta.url).pathname,
    });

    // The brief is wrapped prose, so each claim is asserted on its own.
    assert.match(stdout, /IMPLEMENTED is not TESTED/);
    assert.match(stdout, /TESTED is\s+not APPROVED/);
    assert.match(stdout, /APPROVED is DONE/);
    assert.match(stdout, /PUSHED is not DEPLOYED/);
    assert.match(stdout, /\*\*BD-99\*\* — Unanswered question/, 'an open decision must be briefed');
    assert.match(stdout, /\*\*R-3\*\* \(OPEN\) — Still a blocker/, 'an acceptance blocker must be briefed');
    assert.match(stdout, /finished in the ledger but their code is NOT on the server/);
    assert.match(stdout, /RULE-11/, 'the missing rules must be named');
    assert.match(stdout, /NOT to be\s+reconstructed, invented or renumbered/);

    const after = await sql`SELECT count(*)::int AS n FROM history`;
    assert.equal(after[0].n, before[0].n, 'the briefing wrote to the ledger');

    const { stdout: asJson } = await run('node', ['bin/brief.mjs', '--json'], {
      env: { ...process.env, TRACKER_DATABASE_URL: testUrl },
      cwd: new URL('..', import.meta.url).pathname,
    });
    const payload = JSON.parse(asJson);
    assert.equal(payload.openDecisions.length, 1);
    assert.equal(payload.acceptanceBlockers.length, 1);
    assert.equal(payload.doneNotDeployed, 1);
    assert.deepEqual(payload.rules.sourceMissing, ['RULE-11']);
  } finally {
    await close();
  }
});
