#!/usr/bin/env node
/**
 * Imports docs/SCOPE.md and the project rules.
 *
 * Read-only against the EJE checkout, repeatable, and safe to run as often as
 * you like: the second run of the same document changes nothing and records
 * nothing.
 */
import { importScope, scopePath } from '../src/import/scope.mjs';
import { importRules } from '../src/import/rules.mjs';
import { importTrackerItems } from '../src/import/tracker-items.mjs';
import { closeDb } from '../src/db/client.mjs';

const path = process.argv[2] ?? scopePath();

try {
  const rules = await importRules();
  const scope = await importScope({ path });
  const tracker = await importTrackerItems();
  console.log(
    `import   done: ${scope.items} scope items, ${tracker.items} tracker items, ` +
    `${scope.decisions} decisions, ${rules.rules} rules ` +
    `(${rules.missing} awaiting their authoritative wording)`,
  );
} finally {
  await closeDb();
}
