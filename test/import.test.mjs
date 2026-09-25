import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseScope, idsIn, hashesIn, plain } from '../src/import/markdown.mjs';
import { readScope, readVerificationRuns } from '../src/import/scope.mjs';
import { rulesPath } from '../src/import/rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'scope-sample.md'), 'utf8');

test('a table is read with its header, whatever the header is called', () => {
  const sections = parseScope(fixture);
  const tables = sections.flatMap((section) => section.tables);
  assert.ok(tables.length >= 2);
  assert.deepEqual(tables[0].headers, ['ID', 'Requirement', 'Status', 'Commit', 'Evidence']);
});

test('a table that carries on after a blank line is still the same table', () => {
  const { items } = readScope(fixture);
  const continued = items.find((item) => item.id === 'THING-3');
  assert.ok(continued, 'a continuation row was dropped');
  assert.equal(continued.status, 'DONE');
});

test('the scope keeps its own status word next to the derived one', () => {
  const { items } = readScope(fixture);
  const item = items.find((entry) => entry.id === 'THING-2');
  assert.equal(item.status, 'OPEN');
  assert.equal(item.source_status, 'NOT IMPLEMENTED');
});

test('an acceptance blocker is marked as one', () => {
  const { items } = readScope(fixture);
  const finding = items.find((entry) => entry.id === 'AUD-1');
  assert.equal(finding.acceptance_blocker, true);
  assert.equal(finding.priority, 'CRITICAL');
  assert.equal(finding.kind, 'Audit Finding');
});

test('an unanswered question is a decision that is still required', () => {
  const { items, decisions } = readScope(fixture);
  const open = items.find((entry) => entry.id === 'BD-99');
  assert.equal(open.status, 'DECISION_REQUIRED');
  const answered = items.find((entry) => entry.id === 'BD-98');
  assert.equal(answered.status, 'DONE');
  const record = decisions.find((entry) => entry.id === 'BD-99');
  assert.equal(record.decision, '', 'nothing is decided on the project\'s behalf');
});

test('a change request is as finished as the rows that carry it out', () => {
  const { items } = readScope(fixture);
  const cr = items.find((entry) => entry.id === 'CR-99');
  assert.equal(cr.kind, 'Change Request');
  assert.equal(cr.status, 'IN_PROGRESS');
  assert.match(cr.notes, /THING-2/);
});

test('identifiers and commit hashes are found where they are written', () => {
  assert.deepEqual(idsIn('see CR-12 and PARTS-17, also CR-12').sort(), ['CR-12', 'PARTS-17']);
  assert.deepEqual(hashesIn('done in `9c0e303` and `dda07f6`'), ['9c0e303', 'dda07f6']);
  assert.equal(plain('**bold** and `code`'), 'bold and code');
});

test('a recorded gate becomes evidence, and an undescribed one does not', () => {
  const runs = readVerificationRuns([
    { id: 'VER-10', kind: 'Verification', description: '**Gates at `abc1234`:** `npm test` **1566 passed** (95 files) · `check-routes` **28/28** · lint clean' },
  ]);
  assert.equal(runs.length, 2, 'only the gates that state a result are imported');
  assert.equal(runs[0].command, 'npm test');
  assert.equal(runs[0].passed, 1566);
  assert.equal(runs[0].commit_hash, 'abc1234');
});

test('rules 11-24 are recorded as an explicit gap, never invented', () => {
  const file = JSON.parse(readFileSync(rulesPath, 'utf8'));
  for (let number = 11; number <= 24; number += 1) {
    const rule = file.rules.find((entry) => entry.id === `RULE-${String(number).padStart(2, '0')}`);
    assert.ok(rule, `RULE-${number} is missing from the rules file`);
    assert.equal(rule.status, 'SOURCE_MISSING');
    assert.equal(rule.text, '', `RULE-${number} has text that nobody authorised`);
  }
});

test('the rules that were recovered are stored verbatim', () => {
  const file = JSON.parse(readFileSync(rulesPath, 'utf8'));
  const first = file.rules.find((entry) => entry.id === 'RULE-01');
  assert.equal(
    first.text,
    'Never deploy to the VPS unless deployment has explicitly been requested/approved.',
  );
  assert.equal(first.status, 'ACTIVE');
  assert.ok(first.source.length > 0, 'a rule without a source is a rumour');
});
