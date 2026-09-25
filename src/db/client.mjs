/**
 * The tracker's own PostgreSQL connection.
 *
 * ITS OWN DATABASE, ITS OWN ROLE, AND NOTHING ELSE'S. The tracker never opens a
 * connection to the EJE application's database: it has no business there, and a
 * tool that cannot reach production data cannot corrupt it.
 */
import postgres from 'postgres';
import { config } from '../config.mjs';

let connection = null;

export const db = () => {
  if (connection === null) {
    connection = postgres(config.databaseUrl(), {
      max: 5,
      // Errors carry the failing SQL in this driver; keep it out of logs.
      onnotice: () => {},
      transform: { undefined: null },
    });
  }
  return connection;
};

export const closeDb = async () => {
  if (connection === null) return;
  await connection.end({ timeout: 5 });
  connection = null;
};
