import 'dotenv/config';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';
const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);
const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
function askHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('Run this command in an interactive terminal.');
  stdout.write(prompt);
  stdin.setRawMode(true); stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = error => { stdin.off('data', onData); stdin.setRawMode(false); stdout.write('\n'); error ? reject(error) : resolve(value); };
    const onData = buffer => {
      for (const code of buffer) {
        if (code === 3) return finish(new Error('Cancelled.'));
        if (code === 13 || code === 10) return finish();
        if (code === 8 || code === 127) { value = value.slice(0, -1); continue; }
        if (code >= 32 && code <= 126) value += String.fromCharCode(code);
      }
    };
    stdin.on('data', onData);
  });
}
try {
  const email = (await rl.question('Admin email: ')).trim().toLowerCase();
  rl.close();
  const password = await askHidden('Admin password (at least 14 characters; input hidden): ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 14) throw new Error('Use a valid email and a password of at least 14 characters.');
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`INSERT INTO admins(email,password_salt,password_hash) VALUES($1,$2,$3)
    ON CONFLICT(email) DO UPDATE SET password_salt=EXCLUDED.password_salt,password_hash=EXCLUDED.password_hash`, [email, salt.toString('hex'), hash.toString('hex')]);
  await pool.end();
  console.log('Admin password stored as a scrypt hash.');
} finally { rl.close(); }


