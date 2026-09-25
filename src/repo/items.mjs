/**
 * Reading and writing the ledger.
 *
 * EVERY WRITE THAT CHANGES A FIELD WRITES A HISTORY ROW. That is not a
 * convention to remember — `saveItem` does it, so a caller cannot update an
 * item quietly even by forgetting.
 */
import { db } from '../db/client.mjs';
import { canTransition, transitionRefusal } from '../domain/model.mjs';

/** The fields an update may change, and which are worth a history entry. */
const TRACKED = [
  'kind', 'title', 'description', 'status', 'delivery', 'priority', 'category',
  'group_path', 'phase', 'severity', 'acceptance_blocker', 'source', 'source_ref',
  'source_line', 'source_status', 'evidence', 'notes', 'parent_id',
  'approved_by', 'approved_at', 'production_verified_at', 'completed_at',
  'deployed_at', 'source_missing', 'due_date',
];

export const getItem = async (id, sql = db()) => {
  const [row] = await sql`SELECT * FROM items WHERE id = ${id}`;
  return row ?? null;
};

export const listItems = async (filter = {}, sql = db()) => {
  const where = [];
  const push = (fragment) => where.push(fragment);
  if (filter.status) push(sql`status = ${filter.status}`);
  if (filter.kind) push(sql`kind = ${filter.kind}`);
  if (filter.delivery) push(sql`delivery = ${filter.delivery}`);
  if (filter.priority) push(sql`priority = ${filter.priority}`);
  if (filter.group) push(sql`group_path LIKE ${filter.group + '%'}`);
  if (filter.phase) push(sql`phase = ${filter.phase}`);
  if (filter.parent) push(sql`parent_id = ${filter.parent}`);
  if (filter.blocker === true) push(sql`acceptance_blocker`);
  if (filter.stuck === true) push(sql`status IN ('BLOCKED','DECISION_REQUIRED')`);
  if (filter.undeployed === true) push(sql`delivery <> 'DEPLOYED'`);
  if (filter.overdue === true) {
    push(sql`due_date IS NOT NULL AND due_date < current_date AND status NOT IN ('DONE','CANCELLED','SUPERSEDED')`);
  }
  if (filter.q) {
    const like = `%${filter.q.toLowerCase()}%`;
    push(sql`(lower(id) LIKE ${like} OR lower(title) LIKE ${like} OR lower(description) LIKE ${like} OR lower(notes) LIKE ${like})`);
  }
  const clause = where.length === 0
    ? sql``
    : where.reduce((acc, part, index) => (index === 0 ? sql`WHERE ${part}` : sql`${acc} AND ${part}`), sql``);

  // Sorting is a whitelist, never interpolation: `sort` arrives from a query string.
  const order = {
    id: sql`id`,
    status: sql`status, id`,
    kind: sql`kind, id`,
    priority: sql`CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, id`,
    updated: sql`updated_at DESC`,
    group: sql`group_path, id`,
  }[filter.sort ?? 'id'] ?? sql`id`;

  return sql`SELECT * FROM items ${clause} ORDER BY ${order} LIMIT ${filter.limit ?? 2000}`;
};

export const countsByStatus = async (sql = db()) =>
  sql`SELECT status, count(*)::int AS n FROM items GROUP BY status`;

export const countsByKind = async (sql = db()) =>
  sql`SELECT kind, count(*)::int AS n FROM items GROUP BY kind ORDER BY kind`;

export const countsByDelivery = async (sql = db()) =>
  sql`SELECT delivery, count(*)::int AS n FROM items GROUP BY delivery`;

export const recordHistory = async (entry, sql = db()) => {
  await sql`INSERT INTO history ${sql({
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    actor: entry.actor ?? 'system',
    kind: entry.kind,
    summary: entry.summary,
    detail: entry.detail ?? '',
    evidence: entry.evidence ?? '',
  })}`;
};

export const historyFor = async (entityType, entityId, sql = db()) =>
  sql`SELECT * FROM history WHERE entity_type = ${entityType} AND entity_id = ${entityId}
      ORDER BY at, id`;

/**
 * Creates an item, or updates the one that already has this id.
 *
 * THE IDEMPOTENCY THE IMPORT DEPENDS ON. Identity is the caller's id — the
 * scope's own 'CR-12' — so running the importer twice cannot produce a second
 * CR-12. A field that has not changed writes nothing at all, so a repeat import
 * also leaves no history behind it.
 */
export const saveItem = async (item, { actor = 'system', evidence = '' } = {}, sql = db()) => {
  const existing = await getItem(item.id, sql);
  if (existing === null) {
    const row = {
      id: item.id,
      kind: item.kind,
      title: item.title,
      description: item.description ?? '',
      status: item.status ?? 'OPEN',
      delivery: item.delivery ?? 'NOT_STARTED',
      priority: item.priority ?? 'NORMAL',
      category: item.category ?? '',
      group_path: item.group_path ?? '',
      phase: item.phase ?? '',
      severity: item.severity ?? null,
      acceptance_blocker: item.acceptance_blocker ?? false,
      source: item.source ?? '',
      source_ref: item.source_ref ?? '',
      source_line: item.source_line ?? null,
      source_status: item.source_status ?? '',
      evidence: item.evidence ?? '',
      notes: item.notes ?? '',
      parent_id: item.parent_id ?? null,
    };
    await sql`INSERT INTO items ${sql(row)}`;
    await recordHistory(
      { entityType: 'item', entityId: item.id, actor, kind: 'created',
        summary: `Created as ${row.status}`, detail: row.title, evidence },
      sql,
    );
    return { created: true, changed: [] };
  }

  const changed = [];
  const patch = {};
  for (const field of TRACKED) {
    if (!(field in item)) continue;
    const next = item[field] ?? null;
    const before = existing[field] ?? null;
    const same = before instanceof Date && next instanceof Date
      ? before.getTime() === next.getTime()
      : String(before) === String(next);
    if (same) continue;
    patch[field] = next;
    changed.push({ field, from: before, to: next });
  }
  if (changed.length === 0) return { created: false, changed: [] };

  patch.updated_at = new Date();
  await sql`UPDATE items SET ${sql(patch)} WHERE id = ${item.id}`;
  for (const change of changed) {
    await recordHistory(
      { entityType: 'item', entityId: item.id, actor,
        kind: change.field === 'status' ? 'status' : 'field',
        summary: `${change.field}: ${change.from ?? '—'} → ${change.to ?? '—'}`,
        detail: '', evidence },
      sql,
    );
  }
  return { created: false, changed };
};

/** A status change made by a person or the API, with the lifecycle enforced. */
export const setStatus = async (id, status, { actor, note = '', evidence = '' } = {}, sql = db()) => {
  const item = await getItem(id, sql);
  if (item === null) throw new Error(`${id} is not in the tracker.`);
  const refusal = transitionRefusal(item.status, status);
  if (refusal !== null) throw new Error(refusal);
  if (!canTransition(item.status, status)) throw new Error(refusal ?? 'refused');

  const patch = { status, updated_at: new Date() };
  if (status === 'DONE') patch.completed_at = new Date();
  await sql`UPDATE items SET ${sql(patch)} WHERE id = ${id}`;
  await recordHistory(
    { entityType: 'item', entityId: id, actor: actor ?? 'system', kind: 'status',
      summary: `${item.status} → ${status}`, detail: note, evidence },
    sql,
  );
  return getItem(id, sql);
};

export const relate = async (from, to, kind, sql = db()) => {
  await sql`INSERT INTO relations (from_type, from_id, to_type, to_id, kind)
            VALUES ('item', ${from}, 'item', ${to}, ${kind})
            ON CONFLICT DO NOTHING`;
};

export const relationsFor = async (id, sql = db()) =>
  sql`SELECT kind, to_id AS other, 'out' AS direction FROM relations
        WHERE from_type='item' AND from_id=${id}
      UNION ALL
      SELECT kind, from_id AS other, 'in' AS direction FROM relations
        WHERE to_type='item' AND to_id=${id}
      ORDER BY kind, other`;

export const recordFile = async (itemId, path, action, { note = '', verified = false } = {}, sql = db()) => {
  await sql`INSERT INTO item_files (item_id, path, action, note, verified_unreferenced)
            VALUES (${itemId}, ${path}, ${action}, ${note}, ${verified})
            ON CONFLICT (item_id, path, action) DO UPDATE
              SET note = EXCLUDED.note, verified_unreferenced = EXCLUDED.verified_unreferenced`;
};

export const filesFor = async (itemId, sql = db()) =>
  sql`SELECT * FROM item_files WHERE item_id = ${itemId} ORDER BY action, path`;
