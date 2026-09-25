/**
 * The migration runner: numbered .sql files, applied once, in order.
 *
 * Deliberately 40 lines rather than a migration framework. Every schema change
 * is a file somebody can read, `schema_migrations` records what ran, and a
 * second run is a no-op — which is all a project of this size needs and all
 * that can be reasoned about at 2am.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

const pendingMigrations = async (sql) => {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = new Set((await sql`SELECT version FROM schema_migrations`).map((r) => r.version));
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !applied.has(name));
};

export const migrate = async ({ sql = db(), log = console.log } = {}) => {
  const pending = await pendingMigrations(sql);
  if (pending.length === 0) {
    log('migrations   up to date');
    return [];
  }
  for (const name of pending) {
    const statements = readFileSync(join(migrationsDir, name), 'utf8');
    // One transaction per migration: a half-applied schema is worse than none.
    await sql.begin(async (tx) => {
      await tx.unsafe(statements);
      await tx`INSERT INTO schema_migrations (version) VALUES (${name})`;
    });
    log(`migrations   applied ${name}`);
  }
  return pending;
};
