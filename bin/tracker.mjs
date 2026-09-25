#!/usr/bin/env node
/**
 * Starts the tracker.
 *
 * It binds to 127.0.0.1 by default and is reached through an SSH tunnel. It is
 * not publicly exposed, and it does not expose itself: the bind address has to
 * be changed deliberately, in the environment file, by a person.
 */
import { config } from '../src/config.mjs';
import { createTracker } from '../src/http/server.mjs';
import { routes, handlers } from '../src/http/routes.mjs';
import { db, closeDb } from '../src/db/client.mjs';
import { purgeExpiredSessions } from '../src/auth/sessions.mjs';

const server = createTracker({ routes, ...handlers });

// Fail loudly at start-up rather than on the first request: a tracker that
// cannot reach its database should not look healthy.
const [{ n }] = await db()`SELECT count(*)::int AS n FROM schema_migrations`;
if (n === 0) {
  console.error('tracker  no migrations have been applied. Run: npm run migrate');
  process.exit(1);
}
await purgeExpiredSessions();

server.listen(config.port, config.host, () => {
  console.log(`tracker  listening on http://${config.host}:${config.port}`);
  console.log('tracker  not publicly exposed; reach it over an SSH tunnel (see docs/deployment.md)');
});

const shutdown = async (signal) => {
  console.log(`tracker  ${signal} received, stopping`);
  server.close();
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
