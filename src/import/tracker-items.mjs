/**
 * The tracker's own work, in the tracker.
 *
 * Rule 26: the tracker must always be followed and amended as development
 * progresses — which applies to the tracker's own development too. These items
 * carry what Phase 2 actually delivered, what it did not, and the one question
 * it could not answer without the project owner.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../db/client.mjs';
import { recordHistory, saveItem } from '../repo/items.mjs';
import { saveDecision } from '../repo/project.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const trackerItemsPath = join(here, '..', '..', 'data', 'tracker-items.json');

export const importTrackerItems = async ({
  path = trackerItemsPath, actor = 'import:tracker', log = console.log, sql = db(),
} = {}) => {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  let created = 0;
  let updated = 0;
  for (const item of [...file.items, ...file.decisions]) {
    const {
      question, options, blocks, decision, decided_by, decided_at, implementation_status, ...fields
    } = item;
    const result = await saveItem(fields, { actor, evidence: path }, sql);
    if (result.created) created += 1;
    else if (result.changed.length > 0) updated += 1;
    if (question !== undefined) {
      // The answer, who gave it and when — kept beside the question and the
      // options it was chosen from, never instead of them.
      await saveDecision({
        id: item.id, question, options: options ?? '', blocks: blocks ?? '',
        decision: decision ?? '', decided_by: decided_by ?? '', decided_at: decided_at ?? null,
        implementation_status: implementation_status ?? '',
      }, sql);
    }
  }
  const summary =
    `Imported ${file.items.length + file.decisions.length} tracker items ` +
    `(${created} new, ${updated} updated).`;
  await recordHistory(
    { entityType: 'import', entityId: 'tracker-items', actor, kind: 'import', summary, detail: path },
    sql,
  );
  log(`import   ${summary}`);
  return { items: file.items.length + file.decisions.length, created, updated };
};
