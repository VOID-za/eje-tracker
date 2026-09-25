#!/usr/bin/env node
/**
 * Creates or updates a tracker account.
 *
 *   node bin/user-add.mjs owner@example.com "Project owner"
 *
 * THE PASSWORD IS NEVER AN ARGUMENT AND NEVER A DEFAULT. It is read from the
 * terminal with the echo turned off, or from TRACKER_INITIAL_PASSWORD for an
 * unattended setup. It is never written to the repository, to a migration, to a
 * seed, to a document or to a log line — only its scrypt hash reaches the
 * database, and nothing prints the password back.
 */
import { createInterface } from 'node:readline';
import { db, closeDb } from '../src/db/client.mjs';
import { hashPassword } from '../src/auth/passwords.mjs';

const [email, displayName = ''] = process.argv.slice(2);
if (!email || !email.includes('@')) {
  console.error('usage: node bin/user-add.mjs <email> ["Display name"]');
  process.exit(2);
}

const askSecret = (prompt) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl.output;
    let visible = true;
    output.write(prompt);
    // Suppress the echo: the password must not appear on the screen, in a
    // scrollback buffer or in a screen-sharing session.
    rl.input.on('data', () => {
      if (!visible) return;
      visible = false;
      output.write = ((write) => (chunk, ...rest) =>
        (typeof chunk === 'string' && chunk.includes('\n') ? write.call(output, chunk, ...rest) : true))(output.write);
    });
    rl.question('', (answer) => {
      output.write('\n');
      rl.close();
      resolve(answer);
    });
  });

try {
  const supplied = process.env.TRACKER_INITIAL_PASSWORD ?? null;
  const password = supplied ?? (await askSecret(`Password for ${email} (not echoed): `));
  const confirmation = supplied ?? (await askSecret('Repeat it: '));
  if (password !== confirmation) {
    console.error('Those did not match. Nothing was changed.');
    process.exit(1);
  }
  const hash = await hashPassword(password);
  const sql = db();
  const [row] = await sql`
    INSERT INTO users (email, display_name, password_hash, role)
    VALUES (${email.trim().toLowerCase()}, ${displayName}, ${hash}, 'admin')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                      display_name = EXCLUDED.display_name,
                                      active = true
    RETURNING id, email`;
  await sql`INSERT INTO audit_log (actor, action, target, detail)
            VALUES ('cli', 'user.upsert', ${row.email}, 'password set from the terminal')`;
  console.log(`user     ${row.email} is ready (id ${row.id}). The password was not printed and is not stored.`);
} finally {
  await closeDb();
}
