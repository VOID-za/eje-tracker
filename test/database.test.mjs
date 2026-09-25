import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeDatabase, freshDatabase } from './helpers.mjs';
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

test('correcting a rule keeps the wording it replaced', options, async () => {
  const { sql, close } = await freshDatabase();
  try {
    await saveRule({
      id: 'RULE-25', ordinal: 25, text: 'The complete system must ALWAYS remain tablet friendly.',
      wording_authority: 'RENDERING',
    }, {}, sql);
    const result = await saveRule({
      id: 'RULE-25',
      text: 'The complete system should always but always stay Tablet friendly!!',
      wording_authority: 'AUTHORITATIVE',
      verified_by: 'Project owner (EJE)',
      verified_at: '2026-09-25',
      variant_wording: 'The complete system must ALWAYS remain tablet friendly.',
      variant_source: 'Phase 2 §7 (a restatement)',
    }, {}, sql);
    assert.ok(result.changed.includes('text'));
    assert.ok(result.changed.includes('wording_authority'));

    const [rule] = await sql`SELECT * FROM rules WHERE id = 'RULE-25'`;
    assert.equal(rule.text, 'The complete system should always but always stay Tablet friendly!!');
    assert.equal(rule.wording_authority, 'AUTHORITATIVE');
    assert.equal(rule.variant_wording, 'The complete system must ALWAYS remain tablet friendly.');

    const history = await historyFor('rule', 'RULE-25', sql);
    assert.match(history.at(-1).detail, /Previous wording, kept: The complete system must ALWAYS/);
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
    const first = await importRules({ log: () => {}, sql });
    assert.equal(first.created, 44);
    const second = await importRules({ log: () => {}, sql });
    assert.equal(second.created, 0);
    assert.equal(second.updated, 0);
    const history = await sql`SELECT count(*)::int AS n FROM history WHERE entity_type = 'rule'`;
    assert.equal(history[0].n, 44, 'a repeat import wrote history nobody asked for');
  } finally {
    await close();
  }
});
