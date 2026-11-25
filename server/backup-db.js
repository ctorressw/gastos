import { backup, DatabaseSync } from 'node:sqlite';
import { constants, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(process.env.DB_PATH || 'data/gastos.db');
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || !existsSync(source) || source === destination) {
  console.error('Indicá un destino nuevo y verificá que la base de origen exista.');
  process.exit(1);
}
let created = false;
let db;
try {
  const fd = openSync(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  closeSync(fd);
  created = true;
  db = new DatabaseSync(source, { readOnly: true });
  await backup(db, destination);
  db.close();
  console.log('Copia de SQLite creada. Protegela: contiene datos financieros y usuarios.');
} catch (error) {
  if (db) db.close();
  if (created) unlinkSync(destination);
  console.error(`No se pudo crear la copia: ${error.message}`);
  process.exitCode = 1;
}
