import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, statusFromScope, transitionRefusal, STATUSES } from '../src/domain/model.mjs';
import { summarise } from '../src/domain/progress.mjs';

test('the lifecycle refuses the jump that makes a ledger worthless', () => {
  assert.equal(canTransition('OPEN', 'DONE'), false);
  assert.match(transitionRefusal('OPEN', 'DONE'), /jump straight to DONE/);
  assert.equal(canTransition('IN_PROGRESS', 'IMPLEMENTED'), true);
  assert.equal(canTransition('IMPLEMENTED', 'DONE'), false, 'implemented is not done');
  assert.equal(canTransition('TESTING', 'APPROVED'), true);
  assert.equal(canTransition('APPROVED', 'DONE'), true);
});

test('work can go backwards, because reality does', () => {
  assert.equal(canTransition('DONE', 'OPEN'), true);
  assert.equal(canTransition('BLOCKED', 'IN_PROGRESS'), true);
});

test('an unknown status is refused by name', () => {
  assert.equal(canTransition('OPEN', 'FINISHED'), false);
  assert.match(transitionRefusal('OPEN', 'FINISHED'), /not a status this tracker knows/);
});

test('every status can be reached from somewhere', () => {
  for (const status of STATUSES) {
    if (status === 'OPEN') continue;
    assert.ok(
      STATUSES.some((from) => from !== status && canTransition(from, status)),
      `${status} is unreachable`,
    );
  }
});

test("the scope's own words map onto the lifecycle without flattery", () => {
  assert.equal(statusFromScope('**DONE**'), 'DONE');
  assert.equal(statusFromScope('**NOT IMPLEMENTED**'), 'OPEN');
  assert.equal(statusFromScope('**DEFINED**'), 'PLANNED');
  assert.equal(statusFromScope('**SUPERSEDED by SUBMIT-1**'), 'SUPERSEDED');
  assert.equal(statusFromScope('**PARTIAL**'), 'IN_PROGRESS');
  assert.equal(statusFromScope('**FAIL**'), 'IN_PROGRESS');
  assert.equal(statusFromScope(''), 'OPEN', 'nothing said means nothing claimed');
});

test('percent complete counts DONE and nothing else', () => {
  const summary = summarise(
    [{ status: 'DONE', n: 5 }, { status: 'IMPLEMENTED', n: 3 }, { status: 'BLOCKED', n: 2 }],
    [{ delivery: 'DEPLOYED', n: 4 }, { delivery: 'PUSHED', n: 4 }],
  );
  assert.equal(summary.all, 10);
  assert.equal(summary.done, 5);
  assert.equal(summary.donePercent, 50);
  assert.equal(summary.built, 3, 'implemented is counted apart from done');
  assert.equal(summary.stuck, 2);
  assert.equal(summary.pushedNotDeployed, 4, 'pushed is never counted as deployed');
});
