/**
 * Test plumbing.
 *
 * The tests that need PostgreSQL use their OWN database, named by
 * TRACKER_TEST_DATABASE_URL, and they create and drop what they touch. They
 * never point at the tracker's real database and they could not reach the EJE
 * application's database if they wanted to: nothing here knows its name.
 *
 * They share that one database, so `npm test` runs with --test-concurrency=1.
 * Two files rebuilding the same schema at the same time fail for a reason that
 * has nothing to do with the code under test, which is the worst kind of
 * failure to debug.
 */
import postgres from 'postgres';
import { migrate } from '../src/db/migrate.mjs';

export const testUrl = process.env.TRACKER_TEST_DATABASE_URL ?? null;

export const describeDatabase = testUrl === null
  ? `skipped: set TRACKER_TEST_DATABASE_URL to run the database tests`
  : null;

/** A migrated, empty database, and a function that closes it. */
export const freshDatabase = async () => {
  const sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await migrate({ sql, log: () => {} });
  return { sql, close: () => sql.end({ timeout: 5 }) };
};
