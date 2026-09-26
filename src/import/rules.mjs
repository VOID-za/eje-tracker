/**
 * Loading the project's rules into the tracker.
 *
 * `data/rules.json` holds the rules VERBATIM, with the source of each one named
 * against it. Rules 11–24 are in that file with an empty text and the status
 * SOURCE_MISSING: the project owner's instruction says they already exist in
 * the established EJE rules and must be recovered from the authoritative source
 * rather than guessed, rewritten or invented — so they are not.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../db/client.mjs';
import { recordHistory } from '../repo/items.mjs';
import { recordRuleSearch, saveRule } from '../repo/project.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const rulesPath = join(here, '..', '..', 'data', 'rules.json');
export const searchesPath = join(here, '..', '..', 'data', 'rule-searches.json');

export const importRules = async ({
  path = rulesPath, actor = 'import:rules', log = console.log, sql = db(),
} = {}) => {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  let created = 0;
  let updated = 0;
  for (const rule of file.rules) {
    const result = await saveRule({ ...rule, source: rule.source ?? file.source }, { actor }, sql);
    if (result.created) created += 1;
    else if (result.changed.length > 0) updated += 1;
  }
  // The record of the searches themselves, so that a missing rule is an
  // auditable conclusion and not an assumption.
  const searchFile = JSON.parse(readFileSync(searchesPath, 'utf8'));
  for (const search of searchFile.searches) await recordRuleSearch(search, sql);

  const missing = file.rules.filter((rule) => rule.status === 'SOURCE_MISSING');
  const summary =
    `Imported ${file.rules.length} rules (${created} new, ${updated} updated), ` +
    `${searchFile.searches.length} recorded recovery searches. ` +
    `${missing.length} recorded without text because their authoritative wording could not be recovered.`;
  await recordHistory(
    { entityType: 'import', entityId: 'rules', actor, kind: 'import', summary, detail: path },
    sql,
  );
  log(`import   ${summary}`);
  return {
    rules: file.rules.length, created, updated, missing: missing.length,
    searches: searchFile.searches.length,
  };
};
