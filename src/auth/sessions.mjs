/**
 * Sessions and CSRF.
 *
 * A session token is 32 random bytes. The DATABASE ONLY EVER HOLDS ITS SHA-256,
 * so a copy of the database is not a set of usable logins. The cookie is
 * HttpOnly, SameSite=Lax and — unless the operator has explicitly said the
 * tracker is being reached over a plain-HTTP SSH tunnel — Secure.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '../db/client.mjs';
import { config } from '../config.mjs';
import { verifyPassword } from './passwords.mjs';

export const COOKIE = 'eje_tracker_session';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const createSession = async (userId, { userAgent = '' } = {}, sql = db()) => {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
            VALUES (${sha256(token)}, ${userId}, ${expires}, ${userAgent.slice(0, 300)})`;
  return { token, expires };
};

/** Resolves a cookie value to a user, or null. Expired sessions are cleaned up. */
export const userForToken = async (token, sql = db()) => {
  if (typeof token !== 'string' || token.length < 20) return null;
  const hash = sha256(token);
  const [row] = await sql`
    SELECT u.id, u.email, u.display_name, u.role, u.active, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ${hash}`;
  if (row === undefined) return null;
  if (new Date(row.expires_at).getTime() < Date.now() || row.active !== true) {
    await sql`DELETE FROM sessions WHERE token_hash = ${hash}`;
    return null;
  }
  await sql`UPDATE sessions SET last_used_at = now() WHERE token_hash = ${hash}`;
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
};

export const destroySession = async (token, sql = db()) => {
  if (typeof token !== 'string' || token.length === 0) return;
  await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
};

export const purgeExpiredSessions = async (sql = db()) =>
  sql`DELETE FROM sessions WHERE expires_at < now()`;

/**
 * Checks an email and password.
 *
 * A wrong email and a wrong password are the same answer, and a wrong email
 * still costs a hash comparison, so the response time does not say which of the
 * two was wrong.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  Buffer.alloc(64).toString('base64');

export const authenticate = async (email, password, sql = db()) => {
  const clean = String(email ?? '').trim().toLowerCase();
  const [user] = await sql`SELECT * FROM users WHERE lower(email) = ${clean} AND active`;
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (user === undefined || !ok) return null;
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`;
  return { id: user.id, email: user.email, displayName: user.display_name, role: user.role };
};

/* ------------------------------------------------------------------ CSRF -- */

/**
 * The CSRF token is derived from the session token, so it needs no storage and
 * cannot be replayed against a different session.
 */
export const csrfTokenFor = (sessionToken) =>
  sessionToken ? sha256(`csrf:${sessionToken}`) : '';

export const csrfValid = (sessionToken, submitted) => {
  const expected = Buffer.from(csrfTokenFor(sessionToken));
  const given = Buffer.from(String(submitted ?? ''));
  return expected.length === given.length && expected.length > 0 && timingSafeEqual(expected, given);
};

/* --------------------------------------------------------------- cookies -- */

export const sessionCookie = (token, expires) => {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ];
  if (!config.insecureCookies) parts.push('Secure');
  return parts.join('; ');
};

export const clearedCookie = () => {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (!config.insecureCookies) parts.push('Secure');
  return parts.join('; ');
};

export const readCookie = (header, name = COOKIE) => {
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
};
