/**
 * The vocabulary of the tracker: what an item can be, and what state it can be in.
 *
 * TWO AXES, NOT ONE.
 *
 *   status   — how far the WORK has got.
 *   delivery — how far the CODE has got.
 *
 * They are kept apart because the whole reason this system exists is that
 * "Claude pushed it" is not "production has it", and "it compiles" is not
 * "it was tested and approved".
 */

/** Item kinds. Adding one is a data change, not a schema change. */
export const KINDS = [
  'Requirement',
  'Change Request',
  'Bug',
  'Improvement',
  'Decision',
  'Acceptance Criterion',
  'Technical Debt',
  'Audit Finding',
  'Cleanup',
  'Infrastructure',
  'Database',
  'Deployment',
  'Testing',
  'Documentation',
  'Security',
  'Mandate',
  'Process',
  'Module',
  'Verification',
];

/**
 * The workflow lifecycle.
 *
 * DONE IS NOT A SYNONYM FOR IMPLEMENTED. An item reaches DONE when the work is
 * finished, tested and accepted; IMPLEMENTED means the code exists and nothing
 * more. DECISION_REQUIRED and SUPERSEDED are here because a project ledger
 * without them has to lie about business decisions and replaced requirements.
 */
export const STATUSES = [
  'OPEN',
  'PLANNED',
  'IN_PROGRESS',
  'BLOCKED',
  'DECISION_REQUIRED',
  'IMPLEMENTED',
  'TESTING',
  'APPROVED',
  'DONE',
  'DEFERRED',
  'CANCELLED',
  'SUPERSEDED',
];

/** Where the code is. Derived from git and the live build stamp, not typed in. */
export const DELIVERIES = ['NOT_STARTED', 'LOCAL', 'COMMITTED', 'PUSHED', 'DEPLOYED'];

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];

/** Statuses that mean "no longer being worked on", for progress arithmetic. */
export const CLOSED_STATUSES = new Set(['DONE', 'CANCELLED', 'SUPERSEDED', 'DEFERRED']);

/** Statuses that mean "somebody is waiting on somebody". */
export const STUCK_STATUSES = new Set(['BLOCKED', 'DECISION_REQUIRED']);

/**
 * What a status change is allowed to be.
 *
 * Deliberately permissive in one direction and honest in the other: a project
 * item can move backwards (a DONE requirement that turns out to be wrong
 * reopens), but it cannot skip from OPEN to DONE without passing through the
 * work — which is the rule that stops a ledger from being decorated.
 */
const FORWARD = {
  OPEN: ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DECISION_REQUIRED', 'DEFERRED', 'CANCELLED'],
  PLANNED: ['IN_PROGRESS', 'BLOCKED', 'DECISION_REQUIRED', 'DEFERRED', 'CANCELLED', 'OPEN'],
  IN_PROGRESS: ['IMPLEMENTED', 'BLOCKED', 'DECISION_REQUIRED', 'OPEN', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'PLANNED', 'OPEN', 'DECISION_REQUIRED', 'CANCELLED', 'DEFERRED'],
  DECISION_REQUIRED: ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'OPEN', 'CANCELLED', 'DEFERRED'],
  IMPLEMENTED: ['TESTING', 'IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  TESTING: ['APPROVED', 'IMPLEMENTED', 'IN_PROGRESS', 'BLOCKED'],
  APPROVED: ['DONE', 'TESTING', 'IN_PROGRESS'],
  DONE: ['OPEN', 'IN_PROGRESS', 'SUPERSEDED'],
  DEFERRED: ['OPEN', 'PLANNED', 'CANCELLED'],
  CANCELLED: ['OPEN'],
  SUPERSEDED: ['OPEN'],
};

/**
 * The one kind-specific edge: a DECISION that has been answered is finished.
 *
 * For every other kind, DECISION_REQUIRED → DONE is exactly the jump this
 * tracker exists to refuse — work cannot become done while it is still waiting
 * on somebody. But a decision record IS the deliverable: once the project owner
 * has answered the question and the answer is recorded, there is no
 * implementation left for the decision itself to pass through. Whatever the
 * answer obliges anybody to BUILD is a separate item with its own lifecycle.
 */
const DECIDED = { Decision: { DECISION_REQUIRED: ['DONE'] } };

export const canTransition = (from, to, kind = null) => {
  if (from === to) return true;
  if (!STATUSES.includes(to)) return false;
  if ((FORWARD[from] ?? []).includes(to)) return true;
  return (DECIDED[kind]?.[from] ?? []).includes(to);
};

export const transitionRefusal = (from, to, kind = null) => {
  if (canTransition(from, to, kind)) return null;
  if (!STATUSES.includes(to)) return `${to} is not a status this tracker knows.`;
  if (from === 'DECISION_REQUIRED' && to === 'DONE') {
    return (
      `${from} → ${to} is only allowed for an item of kind Decision, where the recorded answer is the ` +
      `whole deliverable. This item is a ${kind ?? 'item'}: answering the question it waits on does not ` +
      `build it.`
    );
  }
  return (
    `${from} → ${to} is not a move this tracker allows. ` +
    `A ledger that lets work jump straight to DONE is a ledger nobody can trust.`
  );
};

/**
 * How the authoritative scope's own status words map onto the lifecycle.
 *
 * EVERY MAPPING IS EVIDENCE-BASED AND NONE OF THEM FLATTERS. A scope row that
 * says DONE is the project owner's own record that the requirement is finished;
 * anything the scope does not say is not invented here — it lands on OPEN with
 * the original wording kept in `source_status` so the gap is visible.
 */
export const statusFromScope = (scopeStatus) => {
  const text = (scopeStatus ?? '').replace(/[*~`]/g, '').trim().toUpperCase();
  if (text.startsWith('DONE')) return 'DONE';
  /*
   * An audit FINDING is resolved, not done: nobody "completes" a defect. The
   * scope's audit table says RESOLVED, and a word the scope actually uses must
   * not fall through to OPEN — that would leave a closed acceptance blocker
   * showing as an open one, which is the worst direction for this mapping to be
   * wrong in.
   */
  if (text.startsWith('RESOLVED')) return 'DONE';
  /*
   * Tested is not approved, and the lifecycle already has a word for it.
   *
   * "Tests pass -> TESTING" is what `docs/workflow.md` says DONE requires
   * before APPROVED, so a scope row that reports its tests as passing and its
   * approval as outstanding belongs there. Mapping it to DONE would claim the
   * owner's approval, which is the one thing the tracker cannot check and must
   * never assume; leaving it to fall through to OPEN would throw away the
   * implementation and the tests.
   */
  if (text.startsWith('TESTED')) return 'TESTING';
  if (text.startsWith('SUPERSEDED')) return 'SUPERSEDED';
  if (text.startsWith('DEFINED')) return 'PLANNED';
  if (text.startsWith('NOT IMPLEMENTED')) return 'OPEN';
  if (text.startsWith('PARTIAL')) return 'IN_PROGRESS';
  if (text.startsWith('UNVERIFIED')) return 'IN_PROGRESS';
  if (text.startsWith('BLOCKED')) return 'BLOCKED';
  if (text.startsWith('FAIL')) return 'IN_PROGRESS';
  if (text.startsWith('OPEN')) return 'OPEN';
  return 'OPEN';
};

/** A human label, for the UI. */
export const label = (value) =>
  String(value ?? '')
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
