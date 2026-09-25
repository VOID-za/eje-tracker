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

export const canTransition = (from, to) => {
  if (from === to) return true;
  if (!STATUSES.includes(to)) return false;
  return (FORWARD[from] ?? []).includes(to);
};

export const transitionRefusal = (from, to) => {
  if (canTransition(from, to)) return null;
  if (!STATUSES.includes(to)) return `${to} is not a status this tracker knows.`;
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
