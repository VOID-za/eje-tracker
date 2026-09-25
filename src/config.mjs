/**
 * Everything the tracker reads from its environment, in one place.
 *
 * NOTHING HERE HAS A PRODUCTION DEFAULT. A missing DATABASE_URL is a refusal,
 * not a fallback to something that happens to work — the EJE application learnt
 * that lesson the hard way and wrote it down in its own env template.
 */
import { readFileSync, existsSync } from 'node:fs';

/** Reads a .env file if one is present. Real deployments use systemd's EnvironmentFile. */
const loadDotEnv = (path = '.env') => {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match === null) continue;
    const [, key, raw] = match;
    if (process.env[key] === undefined) {
      process.env[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
};

loadDotEnv();

const required = (name) => {
  const value = (process.env[name] ?? '').trim();
  if (value.length === 0) {
    throw new Error(
      `${name} is not set. The tracker refuses to start rather than guess at it — see docs/installation.md.`,
    );
  }
  return value;
};

export const config = {
  databaseUrl: () => required('TRACKER_DATABASE_URL'),
  port: Number(process.env.TRACKER_PORT ?? 3100),
  host: process.env.TRACKER_HOST ?? '127.0.0.1',
  /** The EJE checkout the importer READS. Never written to. */
  ejeRepoPath: process.env.EJE_REPO_PATH ?? '/srv/eje/app',
  /** Where deployment evidence comes from: the live application's own build stamp. */
  ejeHealthUrl: process.env.EJE_HEALTH_URL ?? 'https://eje.syncza.co.za/api/health',
  /** Cookies are Secure unless this says the tracker is behind plain HTTP (an SSH tunnel). */
  insecureCookies: (process.env.TRACKER_INSECURE_COOKIES ?? '') === 'yes',
  sessionDays: Number(process.env.TRACKER_SESSION_DAYS ?? 30),
};
