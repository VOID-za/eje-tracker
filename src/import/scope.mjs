/**
 * Importing docs/SCOPE.md into the ledger.
 *
 * IDEMPOTENT, NON-DESTRUCTIVE, AND HONEST ABOUT WHAT IT DOES NOT KNOW.
 *
 *   Idempotent    — identity is the scope's own ID, so the same document
 *                   imported twice updates the same rows and writes no history
 *                   the second time.
 *   Non-destructive — an item that disappears from the document is NOT deleted.
 *                   It is marked as no longer present in the source and kept,
 *                   because the project's record of what it once required is
 *                   part of the record.
 *   Honest        — the scope's own status word is stored verbatim in
 *                   `source_status` next to the lifecycle status derived from
 *                   it, so a reader can always see what the document said.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/client.mjs';
import { config } from '../config.mjs';
import { recordHistory, relate, saveItem } from '../repo/items.mjs';
import { saveDecision, saveVerification } from '../repo/project.mjs';
import { statusFromScope } from '../domain/model.mjs';
import { hashesIn, idsIn, parseScope, plain, unstrike } from './markdown.mjs';

/** What an identifier's prefix says the item is. */
const KIND_BY_PREFIX = {
  PROC: 'Process',
  MANDATE: 'Mandate',
  MOD: 'Module',
  AUD: 'Audit Finding',
  VER: 'Verification',
  BD: 'Decision',
  CR: 'Change Request',
  SEC: 'Security',
  ARCH: 'Infrastructure',
  DEMO: 'Documentation',
  QA: 'Testing',
};

const kindFor = (id, heading) => {
  const prefix = id.split('-')[0];
  if (prefix in KIND_BY_PREFIX) return KIND_BY_PREFIX[prefix];
  if (id.startsWith('ACC-')) return 'Acceptance Criterion';
  if (/acceptance criteri/i.test(heading)) return 'Acceptance Criterion';
  return 'Requirement';
};

/** The area an item belongs to, taken from the document's own structure. */
const groupFor = (section) => {
  const top = section.h2 || 'Scope';
  const sub = section.h3.replace(/\s*—.*$/, '').trim();
  return sub.length > 0 ? `${top}/${sub}` : top;
};

/** The column a table uses for the item's text, whatever it is called. */
const TITLE_COLUMNS = [
  'Requirement', 'Rule', 'Mandate', 'Finding', 'Question', 'Verified behaviour',
  'Acceptance criterion', 'Criterion', 'Behaviour',
];
const EVIDENCE_COLUMNS = ['Evidence', 'Where', 'Where it is enforced', 'Detail', 'Satisfies', 'Blocks', 'Added'];

const columnIndex = (headers, names) =>
  headers.findIndex((header) => names.some((name) => header.toLowerCase() === name.toLowerCase()));

/** A one-line title, and the rest as the description. */
const splitTitle = (text) => {
  const clean = unstrike(text).trim();
  const firstSentence = /^(.{0,140}?[.;:])\s/.exec(clean);
  const title = plain(firstSentence === null ? clean : firstSentence[1]).slice(0, 200);
  return { title: title.length > 0 ? title : plain(clean).slice(0, 200), description: clean };
};

const SEVERITIES = ['ACCEPTANCE BLOCKER', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const severityOf = (...texts) => {
  const joined = plain(texts.join(' ')).toUpperCase();
  return SEVERITIES.find((severity) => joined.includes(severity)) ?? null;
};

const priorityFor = (severity, kind) => {
  if (severity === 'ACCEPTANCE BLOCKER' || severity === 'CRITICAL') return 'CRITICAL';
  if (severity === 'HIGH') return 'HIGH';
  if (kind === 'Mandate') return 'CRITICAL';
  if (severity === 'LOW') return 'LOW';
  return 'NORMAL';
};

/**
 * Reads every table row of the document into an item description.
 *
 * Nothing is written here — this half is pure, so it can be tested without a
 * database and so the counts can be checked before anything is saved.
 */
export const readScope = (markdown) => {
  const sections = parseScope(markdown);
  const items = [];
  const decisions = [];
  const seen = new Set();

  for (const section of sections) {
    // The change register's own headings are items in their own right: CR-12 is
    // a thing the project did, not merely a label on other rows.
    const crHeading = /^(CR-\d+)\s*—\s*(.*)$/.exec(section.h3);
    if (crHeading !== null && !seen.has(crHeading[1])) {
      const [, id, title] = crHeading;
      const prose = section.prose.join('\n').trim();
      const dateline = /^\*(.*?)\*$/m.exec(prose)?.[1] ?? '';
      seen.add(id);
      items.push({
        id,
        kind: 'Change Request',
        title: plain(title),
        description: prose,
        status: null, // rolled up from its requirements once they are all read
        source_status: plain(dateline),
        group_path: `${section.h2}/${id}`,
        source: 'docs/SCOPE.md',
        source_ref: section.h3,
        source_line: section.line,
        commits: hashesIn(dateline),
        references: idsIn(prose).filter((other) => other !== id),
        priority: 'NORMAL',
      });
    }

    for (const table of section.tables) {
      const idColumn = columnIndex(table.headers, ['ID']);
      if (idColumn === -1) continue;
      const titleColumn = columnIndex(table.headers, TITLE_COLUMNS);
      if (titleColumn === -1) continue;
      const statusColumn = columnIndex(table.headers, ['Status']);
      const commitColumn = columnIndex(table.headers, ['Commit']);
      const evidenceColumn = columnIndex(table.headers, EVIDENCE_COLUMNS);
      const severityColumn = columnIndex(table.headers, ['Severity']);

      for (const row of table.rows) {
        const id = plain(row.cells[idColumn] ?? '');
        if (id.length === 0 || !/^[A-Z]/.test(id)) continue;
        if (seen.has(id)) continue;
        seen.add(id);

        const rawTitle = row.cells[titleColumn] ?? '';
        const { title, description } = splitTitle(rawTitle);
        const statusCell = statusColumn === -1 ? '' : row.cells[statusColumn] ?? '';
        const evidence = evidenceColumn === -1 ? '' : row.cells[evidenceColumn] ?? '';
        const severity = severityColumn === -1
          ? severityOf(statusCell)
          : severityOf(row.cells[severityColumn] ?? '', statusCell);
        const kind = kindFor(id, `${section.h3} ${section.h4}`);
        const answered = /~~/.test(rawTitle) || /\b(ANSWERED|RESOLVED)\b/.test(plain(rawTitle));

        const sourceStatus = plain(statusCell);

        // SOME TABLES CARRY NO STATUS COLUMN AT ALL, and guessing one from
        // nothing would be exactly the invention the project rules forbid. Two
        // of them are records of something that has already happened — the
        // verification record and the maintenance rules this document adopted —
        // so those are recorded as DONE with the mapping written onto the item.
        // Everything else without a status stays OPEN, which is the honest
        // reading of an acceptance criterion nobody has met yet.
        const statusless = statusColumn === -1;
        const recordOfSomethingDone = statusless && ['Verification', 'Process'].includes(kind);
        const status = kind === 'Decision'
          ? (answered ? 'DONE' : 'DECISION_REQUIRED')
          : recordOfSomethingDone
            ? 'DONE'
            : statusFromScope(sourceStatus.length > 0 ? sourceStatus : section.h3);
        const mappingNote = statusless
          ? `The source table has no Status column; recorded as ${status} because the row is ` +
            `${recordOfSomethingDone ? 'a record of something already carried out' : 'a statement of what is still required'}.`
          : '';

        items.push({
          id,
          kind,
          title,
          description,
          status,
          source_status: sourceStatus,
          group_path: groupFor(section),
          phase: section.h4,
          severity,
          acceptance_blocker: severity === 'ACCEPTANCE BLOCKER',
          priority: priorityFor(severity, kind),
          source: 'docs/SCOPE.md',
          source_ref: `${section.h2} / ${section.h3}${section.h4 ? ` / ${section.h4}` : ''}`,
          source_line: row.line,
          evidence: plain(evidence),
          notes: mappingNote,
          commits: [...hashesIn(statusCell), ...hashesIn(row.cells[commitColumn] ?? ''), ...hashesIn(evidence)],
          references: [...idsIn(evidence), ...idsIn(rawTitle)].filter((other) => other !== id),
        });

        if (kind === 'Decision') {
          decisions.push({
            id,
            question: plain(unstrike(rawTitle)).slice(0, 4000),
            blocks: plain(evidence),
            decision: answered ? unstrike(rawTitle) : '',
            decided_by: answered ? 'EJE (recorded in docs/SCOPE.md)' : '',
            implementation_status: sourceStatus,
          });
        }
      }
    }
  }

  // A change request is as finished as the requirements that carry it out.
  // This is a roll-up, and it is recorded as one: the CR's own `source_status`
  // keeps whatever the document's dateline said.
  const filed = new Map();
  const claim = (crId, item) => {
    if (!filed.has(crId)) filed.set(crId, []);
    const rows = filed.get(crId);
    if (!rows.includes(item)) rows.push(item);
  };
  for (const item of items) {
    // A decision is not a requirement a change request carries out, so it never
    // counts towards one being finished.
    if (item.kind === 'Change Request' || item.kind === 'Decision') continue;
    const heading = /(CR-\d+)/.exec(item.source_ref ?? '');
    if (heading !== null) claim(heading[1], item);
    for (const reference of item.references ?? []) {
      if (reference.startsWith('CR-')) claim(reference, item);
    }
  }

  // Only where nothing at all was filed under a change request does it fall
  // back to the requirements ITS OWN prose names — which is how a batch written
  // up under a neighbouring heading (CR-13 names PARTS-17…22 in a section
  // headed by CR-12) is still credited with what it carried.
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    if (item.kind !== 'Change Request' || (filed.get(item.id) ?? []).length > 0) continue;
    for (const reference of item.references ?? []) {
      const child = byId.get(reference);
      if (child === undefined || child.kind === 'Change Request') continue;
      claim(item.id, child);
    }
  }

  for (const item of items) {
    if (item.kind === 'Change Request') item.children = (filed.get(item.id) ?? []).map((child) => child.id);
    if (item.status !== null) continue;
    const children = filed.get(item.id) ?? [];
    const outstanding = children.filter((child) => !['DONE', 'SUPERSEDED'].includes(child.status));
    if (children.length === 0) {
      item.status = item.commits.length > 0 ? 'IMPLEMENTED' : 'OPEN';
      item.notes = 'Status derived: no requirement rows in the scope reference this change request.';
    } else if (outstanding.length === 0) {
      item.status = 'DONE';
      item.notes = `Status rolled up from ${children.length} requirement rows, all of which the scope marks DONE or SUPERSEDED.`;
    } else if (outstanding.length === children.length) {
      item.status = 'PLANNED';
      item.notes = `Status rolled up from ${children.length} requirement rows, none of which the scope marks DONE: ${outstanding.map((child) => child.id).join(', ')}.`;
    } else {
      item.status = 'IN_PROGRESS';
      item.notes = `Status rolled up from ${children.length} requirement rows; ${outstanding.length} are not yet DONE in the scope: ${outstanding.map((child) => child.id).join(', ')}.`;
    }
  }

  return { items, decisions, sections: sections.length };
};

/**
 * The verification gates the scope records, as verification runs.
 *
 * The document states what was run and what it said — "`npm test` **1566
 * passed** (95 files)". Those are somebody's recorded results, so they are
 * imported as evidence attached to the row that states them, with the commit
 * they were run at. Nothing is inferred: a gate the document does not describe
 * as having a result is not given one.
 */
export const readVerificationRuns = (items) => {
  const runs = [];
  for (const item of items) {
    if (item.kind !== 'Verification') continue;
    const at = hashesIn(item.description)[0] ?? null;
    for (const segment of item.description.split('·')) {
      // The segment that names the commit also names the first gate — take the
      // last backticked token that is not a commit hash, so `npm test` wins
      // over the `ca1cda7` the sentence opens with.
      const command = [...segment.matchAll(/`([^`]+)`/g)]
        .map((match) => match[1])
        .filter((value) => !/^[0-9a-f]{7,40}$/.test(value))
        .pop() ?? null;
      if (command === null) continue;
      const passed = /\*\*(\d+) passed\*\*/.exec(segment);
      const ratio = /\*\*(\d+)\/(\d+)\*\*/.exec(segment);
      const exitZero = /exit 0/.test(segment);
      if (passed === null && ratio === null && !exitZero) continue;
      runs.push({
        item_id: item.id,
        command,
        result: 'PASS',
        passed: passed !== null ? Number(passed[1]) : ratio !== null ? Number(ratio[1]) : null,
        total: ratio !== null ? Number(ratio[2]) : passed !== null ? Number(passed[1]) : null,
        commit_hash: at,
        detail: plain(segment).trim(),
      });
    }
  }
  return runs;
};

/* ------------------------------------------------------------- importing -- */

export const scopePath = () => join(config.ejeRepoPath, 'docs', 'SCOPE.md');

export const importScope = async ({
  path = scopePath(), actor = 'import:scope', log = console.log, sql = db(),
} = {}) => {
  const markdown = readFileSync(path, 'utf8');
  const { items, decisions } = readScope(markdown);

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const { commits, references, children, ...fields } = item;
    const result = await saveItem(
      { ...fields, source_missing: false },
      { actor, evidence: `${path}:${item.source_line}` },
      sql,
    );
    if (result.created) created += 1;
    else if (result.changed.length > 0) updated += 1;
  }

  // Relations are written after every item exists, so a forward reference to an
  // ID further down the document still links.
  const known = new Set(items.map((item) => item.id));
  let links = 0;
  for (const item of items) {
    for (const reference of item.references) {
      if (!known.has(reference) || reference === item.id) continue;
      await relate(item.id, reference, 'references', sql);
      links += 1;
    }
    for (const child of item.children ?? []) {
      if (!known.has(child)) continue;
      await relate(child, item.id, 'implements', sql);
      links += 1;
    }
    for (const hash of new Set(item.commits)) {
      await sql`INSERT INTO relations (from_type, from_id, to_type, to_id, kind)
                VALUES ('item', ${item.id}, 'commit', ${hash}, 'implemented_by')
                ON CONFLICT DO NOTHING`;
    }
  }

  for (const decision of decisions) await saveDecision(decision, sql);

  // Recorded gates, imported once. A second import of the same document must
  // not manufacture a second run of the same test.
  const runs = readVerificationRuns(items);
  let newRuns = 0;
  for (const run of runs) {
    const [existing] = await sql`SELECT id FROM verification_runs
                                  WHERE item_id = ${run.item_id} AND command = ${run.command}
                                    AND commit_hash IS NOT DISTINCT FROM ${run.commit_hash}`;
    if (existing !== undefined) continue;
    await saveVerification(run, sql);
    newRuns += 1;
  }

  // NOTHING IS DELETED. An item that has left the document keeps its row and
  // gains a marker, so the project's own history of what it once required
  // survives a change to the source.
  const departed = await sql`
    UPDATE items SET source_missing = true, updated_at = now()
     WHERE source = 'docs/SCOPE.md' AND NOT source_missing AND id <> ALL(${[...known]})
     RETURNING id`;
  for (const row of departed) {
    await recordHistory(
      { entityType: 'item', entityId: row.id, actor, kind: 'source',
        summary: 'No longer present in docs/SCOPE.md',
        detail: 'Kept, not deleted: the record of what the project once required is part of the record.' },
      sql,
    );
  }

  const summary =
    `Imported docs/SCOPE.md: ${items.length} items (${created} new, ${updated} updated), ` +
    `${decisions.length} decisions, ${runs.length} recorded gates (${newRuns} new), ` +
    `${links} cross-references, ${departed.length} no longer in the source.`;
  await recordHistory(
    { entityType: 'import', entityId: 'docs/SCOPE.md', actor, kind: 'import',
      summary, detail: path, evidence: `${items.length} rows read` },
    sql,
  );
  log(`import   ${summary}`);
  return {
    items: items.length, created, updated, decisions: decisions.length,
    verificationRuns: runs.length, newVerificationRuns: newRuns,
    links, departed: departed.length,
  };
};
