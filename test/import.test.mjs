import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseScope, idsIn, hashesIn, plain } from '../src/import/markdown.mjs';
import { readScope, readVerificationRuns } from '../src/import/scope.mjs';
import { rulesPath } from '../src/import/rules.mjs';
import * as statusModule from '../src/domain/model.mjs';

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

/* ---------------------------------------------------------------- rules -- */

const rulesFile = () => JSON.parse(readFileSync(rulesPath, 'utf8'));

test('rules 1 to 27 all exist, exactly once each', () => {
  const numbered = rulesFile().rules.filter((rule) => /^RULE-\d+$/.test(rule.id));
  const numbers = numbered.map((rule) => Number(rule.id.slice(5)));
  assert.deepEqual(numbers.sort((a, b) => a - b), Array.from({ length: 27 }, (_, i) => i + 1));
  assert.equal(new Set(numbers).size, 27, 'a rule number appears twice');
});

test("rules 25, 26 and 27 carry the owner's own words, character for character", () => {
  const rules = Object.fromEntries(rulesFile().rules.map((rule) => [rule.id, rule]));
  assert.equal(
    rules['RULE-25'].text,
    'The complete system should always but always stay Tablet friendly!!',
  );
  assert.equal(
    rules['RULE-26'].text,
    'We must always but always follow and amend this tracker as we go. When i feature is finished and ' +
      'tested and approved, then that task must be marked done on the tracker instantly. Otherwise ' +
      'confusion and double work will become a problem.',
  );
  assert.equal(
    rules['RULE-27'].text,
    'Security is very very important from the start. we want the best of the best security models. It ' +
      'must always accommodate the newest and best security models. System must be hardened. Have the ' +
      'best of the best practices. For development phase, never touch the demo users and the way we ' +
      'change users to view the different roles and permissions. once development is done, we will ' +
      'remove that and have actual login pages with prime security etc!!!!!',
  );
  for (const id of ['RULE-25', 'RULE-26', 'RULE-27']) {
    assert.equal(rules[id].wording_authority, 'AUTHORITATIVE');
    assert.equal(rules[id].status, 'ACTIVE');
    assert.ok(rules[id].verified_by.length > 0, `${id} records who verified it`);
    assert.ok(rules[id].variant_wording.length > 0, `${id} keeps the wording it replaced`);
  }
});

test('the restatement rules 25-27 replaced is kept, not discarded', () => {
  const rules = Object.fromEntries(rulesFile().rules.map((rule) => [rule.id, rule]));
  assert.match(rules['RULE-25'].variant_wording, /must ALWAYS remain tablet friendly/);
  assert.notEqual(rules['RULE-25'].variant_wording, rules['RULE-25'].text);
});

test('rules 11-24 have no text, no invented wording and no false authority', () => {
  const rules = rulesFile().rules;
  for (let number = 11; number <= 24; number += 1) {
    const rule = rules.find((entry) => entry.id === `RULE-${String(number).padStart(2, '0')}`);
    assert.equal(rule.text, '', `RULE-${number} has text that nobody authorised`);
    assert.equal(rule.status, 'SOURCE_MISSING');
    assert.equal(rule.wording_authority, 'MISSING');
    assert.equal(rule.variant_wording, '', `RULE-${number} has a variant nobody authorised either`);
    assert.match(rule.note, /Searched at Phase 3A/);
  }
});

test('rules 1-10 bind, but do not claim a wording they cannot prove', () => {
  const rules = rulesFile().rules;
  for (let number = 1; number <= 10; number += 1) {
    const rule = rules.find((entry) => entry.id === `RULE-${String(number).padStart(2, '0')}`);
    assert.equal(rule.status, 'ACTIVE', `RULE-${number} must stay in force`);
    assert.equal(rule.wording_authority, 'RENDERING');
    assert.ok(rule.text.length > 0);
    assert.ok(rule.variant_wording.length > 0, `RULE-${number} keeps the other recorded version`);
    assert.ok(rule.variant_source.includes('BD-06'), `RULE-${number} names where the variant came from`);
  }
});

test('the development-authentication rule is superseded by rule 27, and kept', () => {
  const rule = rulesFile().rules.find((entry) => entry.id === 'RULE-DEV-AUTH');
  assert.equal(rule.status, 'SUPERSEDED');
  assert.match(rule.note, /SUPERSEDED BY RULE-27/);
  assert.ok(rule.text.length > 0, 'a superseded rule keeps its text');
});

test('a rule uses the rule vocabulary, and can never be marked done', () => {
  // SUPERSEDED is a legitimate state for a rule AND for a task; everything else
  // in the task lifecycle is not. A rule is never DONE, APPROVED or IMPLEMENTED
  // — it is a standing constraint, not work somebody finishes.
  const RULE_STATUSES = ['ACTIVE', 'SOURCE_MISSING', 'SUPERSEDED', 'RETIRED'];
  const forbidden = statusModule.STATUSES.filter((status) => !RULE_STATUSES.includes(status));
  for (const rule of rulesFile().rules) {
    assert.ok(RULE_STATUSES.includes(rule.status), `${rule.id} has status ${rule.status}`);
    assert.ok(!forbidden.includes(rule.status), `${rule.id} uses a task status (${rule.status})`);
  }
  assert.ok(forbidden.includes('DONE'), 'DONE must remain a task status a rule cannot hold');
});
