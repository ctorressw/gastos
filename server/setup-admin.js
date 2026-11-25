import { db } from './db.js';
import { passwordHash } from './auth.js';
import { createInterface } from 'node:readline';

// Read credentials from stdin; do not put them in source or command-line arguments.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let input = '';
for await (const line of lines) { input = line; break; }
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
try {
  const { username, password } = JSON.parse(input);
  if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(username || '') || typeof password !== 'string' || password.length < 8 || password.length > 256) throw new Error('Credenciales inválidas.');
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count) throw new Error('Ya existe un usuario; administralo desde la aplicación.');
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash(password));
  console.log('Usuario inicial creado.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
