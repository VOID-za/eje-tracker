/**
 * Password hashing.
 *
 * scrypt from node:crypto, with a per-password salt, stored as a single
 * self-describing string so the parameters travel with the hash and can be
 * raised later without invalidating anybody's login.
 *
 * THERE IS NO PASSWORD ANYWHERE ELSE. Not in a migration, not in a seed file,
 * not in a document, not in a log line. The administrator account is created by
 * `npm run user:add`, which reads the password from a prompt or from an
 * environment variable the operator sets for that one command.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

/** Cost parameters. N=2^15 is ~100ms on the VPS class this runs on. */
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };

export const hashPassword = async (password) => {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('The tracker requires a password of at least 12 characters.');
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 128 * PARAMS.N * PARAMS.r * 2,
  });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
};

/**
 * Checks a password against a stored hash.
 *
 * Returns false for anything malformed rather than throwing: a corrupt hash
 * must fail the login, not crash the request and tell the caller which it was.
 */
export const verifyPassword = async (password, stored) => {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
};
