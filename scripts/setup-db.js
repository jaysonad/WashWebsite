import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
const { Pool } = pg;
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const schema = await readFile(path.join(rootDir, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Database tables are ready.');
} finally { await pool.end(); }
