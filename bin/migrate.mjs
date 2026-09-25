#!/usr/bin/env node
import { migrate } from '../src/db/migrate.mjs';
import { closeDb } from '../src/db/client.mjs';

try {
  await migrate();
} finally {
  await closeDb();
}
