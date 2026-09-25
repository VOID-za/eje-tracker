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
    assert.match(history[1].detail, /Previous text kept in history: Never deploy unless asked\./);
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
