#!/usr/bin/env node
/**
 * Imports the EJE repository's commits and whatever deployment evidence exists.
 *
 *   node bin/import-git.mjs
 *   node bin/import-git.mjs --deployed 2166ac6 --evidence "live /api/health, 25 Sep 2026"
 *
 * The live health endpoint is asked first. The --deployed flag exists for the
 * case where this machine cannot reach the application but a human has read the
 * build stamp themselves; what they read is stored WITH the release, so the
 * claim always carries its source.
 */
import { importGit } from '../src/import/git.mjs';
import { closeDb } from '../src/db/client.mjs';

const flag = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

try {
  await importGit({
    deployedCommit: flag('deployed'),
    deployedEvidence: flag('evidence') ?? '',
    observedAt: flag('observed') === null ? null : new Date(flag('observed')),
  });
} finally {
  await closeDb();
}
