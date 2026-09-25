/**
 * Rules, decisions, commits, releases and verification evidence.
 *
 * These are the parts of the ledger that are not tasks: what the project is
 * bound by, what it has not decided, what was committed, what is actually
 * running, and what was proved.
 */
import { db } from '../db/client.mjs';
import { recordHistory } from './items.mjs';

/* ----------------------------------------------------------------- rules -- */

export const listRules = async (sql = db()) =>
  sql`SELECT * FROM rules ORDER BY ordinal NULLS LAST, id`;

const getRule = async (id, sql = db()) => {
  const [row] = await sql`SELECT * FROM rules WHERE id = ${id}`;
  return row ?? null;
};

/**
 * Upserts a rule, VERBATIM.
 *
 * A rule whose text has been "tidied" is a different rule, so the text is
 * stored exactly as the authoritative source states it and a change to it is
 * recorded in history rather than applied silently.
 */
export const saveRule = async (rule, { actor = 'system' } = {}, sql = db()) => {
  const existing = await getRule(rule.id, sql);
  if (existing === null) {
    await sql`INSERT INTO rules ${sql({
      id: rule.id,
      ordinal: rule.ordinal ?? null,
      text: rule.text ?? '',
      category: rule.category ?? '',
      status: rule.status ?? 'ACTIVE',
      note: rule.note ?? '',
      source: rule.source ?? '',
      source_ref: rule.source_ref ?? '',
    })}`;
    await recordHistory(
      { entityType: 'rule', entityId: rule.id, actor, kind: 'created',
        summary: `Recorded as ${rule.status ?? 'ACTIVE'}`, detail: rule.source_ref ?? '' },
      sql,
    );
    return { created: true, changed: [] };
  }
  const changed = [];
  const patch = {};
  for (const field of ['text', 'category', 'status', 'note', 'source', 'source_ref', 'ordinal']) {
    if (!(field in rule)) continue;
    if (String(existing[field] ?? '') === String(rule[field] ?? '')) continue;
    patch[field] = rule[field] ?? null;
    changed.push(field);
  }
  if (changed.length === 0) return { created: false, changed };
  patch.updated_at = new Date();
  await sql`UPDATE rules SET ${sql(patch)} WHERE id = ${rule.id}`;
  await recordHistory(
    { entityType: 'rule', entityId: rule.id, actor, kind: 'field',
      summary: `Changed: ${changed.join(', ')}`,
      detail: changed.includes('text') ? `Previous text kept in history: ${existing.text}` : '' },
    sql,
  );
  return { created: false, changed };
};

/* ------------------------------------------------------------- decisions -- */

export const listDecisions = async (sql = db()) =>
  sql`SELECT d.*, i.title, i.status, i.group_path, i.source_ref
        FROM decisions d JOIN items i ON i.id = d.id
       ORDER BY d.id`;

export const getDecision = async (id, sql = db()) => {
  const [row] = await sql`SELECT d.*, i.title, i.status FROM decisions d
                            JOIN items i ON i.id = d.id WHERE d.id = ${id}`;
  return row ?? null;
};

export const saveDecision = async (decision, sql = db()) => {
  const fields = {
    id: decision.id,
    question: decision.question,
    options: decision.options ?? '',
    blocks: decision.blocks ?? '',
    decision: decision.decision ?? '',
    decided_by: decision.decided_by ?? '',
    decided_at: decision.decided_at ?? null,
    implementation_status: decision.implementation_status ?? '',
    affected_files: decision.affected_files ?? '',
  };
  await sql`INSERT INTO decisions ${sql(fields)}
            ON CONFLICT (id) DO UPDATE SET
              question = EXCLUDED.question,
              options = EXCLUDED.options,
              blocks = EXCLUDED.blocks,
              decision = CASE WHEN EXCLUDED.decision = '' THEN decisions.decision ELSE EXCLUDED.decision END,
              decided_by = CASE WHEN EXCLUDED.decided_by = '' THEN decisions.decided_by ELSE EXCLUDED.decided_by END,
              implementation_status = EXCLUDED.implementation_status`;
};

/* --------------------------------------------------------------- commits -- */

export const saveCommit = async (commit, sql = db()) => {
  await sql`INSERT INTO commits ${sql({
    hash: commit.hash,
    repo: commit.repo ?? 'VOID-za/EJE-Managment',
    branch: commit.branch ?? '',
    author: commit.author ?? '',
    committed_at: commit.committed_at ?? null,
    subject: commit.subject ?? '',
    body: commit.body ?? '',
  })} ON CONFLICT (hash) DO UPDATE SET
        branch = EXCLUDED.branch, author = EXCLUDED.author,
        committed_at = EXCLUDED.committed_at, subject = EXCLUDED.subject,
        body = EXCLUDED.body`;
};

export const listCommits = async (limit = 50, sql = db()) =>
  sql`SELECT c.*, r.status AS release_status, r.deployed_at
        FROM commits c LEFT JOIN releases r ON r.commit_hash = c.hash
       ORDER BY c.committed_at DESC NULLS LAST LIMIT ${limit}`;

export const commitsFor = async (itemId, sql = db()) =>
  sql`SELECT c.*, r.status AS release_status FROM relations rel
        JOIN commits c ON c.hash = rel.to_id
        LEFT JOIN releases r ON r.commit_hash = c.hash
       WHERE rel.from_type='item' AND rel.from_id=${itemId} AND rel.to_type='commit'
       ORDER BY c.committed_at NULLS LAST`;


/* -------------------------------------------------------------- releases -- */

/**
 * A release is a commit plus where it actually is.
 *
 * DEPLOYED IS NEVER A CLAIM SOMEBODY TYPED. It is only ever written by the
 * importer that reads the live application's own `/api/health` build stamp and
 * computes git ancestry against it, and the evidence it used is stored with it.
 */
export const saveRelease = async (release, sql = db()) => {
  await sql`INSERT INTO releases ${sql({
    id: release.id,
    commit_hash: release.commit_hash,
    repo: release.repo ?? 'VOID-za/EJE-Managment',
    server: release.server ?? '',
    status: release.status ?? 'PUSHED',
    deployed_at: release.deployed_at ?? null,
    build_result: release.build_result ?? '',
    health_result: release.health_result ?? '',
    verification_result: release.verification_result ?? '',
    evidence: release.evidence ?? '',
    observed_at: release.observed_at ?? null,
    notes: release.notes ?? '',
  })} ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, deployed_at = EXCLUDED.deployed_at,
        health_result = EXCLUDED.health_result, evidence = EXCLUDED.evidence,
        observed_at = EXCLUDED.observed_at, server = EXCLUDED.server`;
};

export const listReleases = async (sql = db()) =>
  sql`SELECT r.*, c.subject, c.committed_at FROM releases r
        JOIN commits c ON c.hash = r.commit_hash
       ORDER BY c.committed_at DESC NULLS LAST`;

export const latestDeployedRelease = async (sql = db()) => {
  const [row] = await sql`SELECT r.*, c.subject FROM releases r JOIN commits c ON c.hash = r.commit_hash
                           WHERE r.status = 'DEPLOYED' ORDER BY r.observed_at DESC NULLS LAST LIMIT 1`;
  return row ?? null;
};

/* ---------------------------------------------------------- verification -- */

export const saveVerification = async (run, sql = db()) => {
  const [row] = await sql`INSERT INTO verification_runs ${sql({
    item_id: run.item_id ?? null,
    release_id: run.release_id ?? null,
    command: run.command,
    result: run.result,
    passed: run.passed ?? null,
    total: run.total ?? null,
    commit_hash: run.commit_hash ?? null,
    ran_at: run.ran_at ?? new Date(),
    detail: run.detail ?? '',
  })} RETURNING *`;
  return row;
};

export const listVerifications = async (limit = 50, sql = db()) =>
  sql`SELECT * FROM verification_runs ORDER BY ran_at DESC, id DESC LIMIT ${limit}`;

export const verificationsFor = async (itemId, sql = db()) =>
  sql`SELECT * FROM verification_runs WHERE item_id = ${itemId} ORDER BY ran_at DESC`;
