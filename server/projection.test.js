import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

test('proyección, recurrencias, ahorro y administración usan datos aislados', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gastos-test-'));
  const port = 21000 + Math.floor(Math.random() * 20000);
  const setup = spawnSync(process.execPath, ['server/setup-admin.js'], { env: { ...process.env, DB_PATH: join(dir, 'test.db') }, input: JSON.stringify({ username: 'tester', password: 'test-password' }) });
  assert.equal(setup.status, 0);
  const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DB_PATH: join(dir, 'test.db'), PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  async function request(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const payload = response.status === 204 ? null : await response.json();
    assert.ok(response.ok, JSON.stringify(payload));
    return payload;
  }
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) { try { await request('/api/health'); ready = true; break; } catch { await delay(100); } }
    assert.ok(ready, 'El servidor de prueba no inició');
    assert.equal((await fetch(base + '/api/transactions')).status, 401);
    const wrongLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'tester', password: 'incorrecta' }) });
    assert.equal(wrongLogin.status, 401);
    await request('/api/auth/login', 'POST', { username: 'tester', password: 'test-password' });
    const crossOrigin = await fetch(base + '/api/users', { method: 'POST', headers: { cookie, origin: 'https://otro-ejemplo.test', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'intruso', password: 'incorrecta' }) });
    assert.equal(crossOrigin.status, 403);
    await request('/api/settings', 'PUT', { openingBalance: 1000, overdraftLimit: 500 });
    const movement = await request('/api/transactions', 'POST', { type: 'expense', description: 'Alquiler', category: 'Otros', amount: 100, currency: 'ARS', transactionDate: '2026-11-10', recurring: true });
    await request('/api/transactions', 'POST', { type: 'income', description: 'Ingreso', category: 'Otros', amount: 300, currency: 'ARS', transactionDate: '2026-12-10' });
    await request('/api/transactions', 'POST', { type: 'expense', description: 'Cuota', category: 'Otros', amount: 50, currency: 'ARS', transactionDate: '2026-11-10', installments: 2 });
    const plan = await request('/api/savings', 'POST', { name: 'Viaje', target: 500, saved: 0, monthly: 75 });
    let projection = await request('/api/projection?month=2026-11');
    assert.equal(projection.startBalance, 850);
    assert.equal(projection.recurringExpense, 100);
    assert.equal(projection.income, 300);
    assert.equal(projection.expense, 50);
    assert.equal(projection.savings, 75);
    assert.equal(projection.endBalance, 925);
    await request(`/api/transactions/${movement.transactions[0].id}/recurring`, 'PUT', { recurring: false });
    await request(`/api/savings/${plan.id}`, 'PUT', { saved: 480 });
    projection = await request('/api/projection?month=2026-11');
    assert.equal(projection.recurringExpense, 0);
    assert.equal(projection.savings, 20);
    assert.equal(projection.endBalance, 1080);
    await request(`/api/transactions/${movement.transactions[0].id}`, 'PUT', { type: 'expense', description: 'Alquiler corregido', category: 'Otros', amount: 120, currency: 'ARS', transactionDate: '2026-11-11' });
    assert.equal((await request('/api/transactions?month=2026-11')).find((row) => row.id === movement.transactions[0].id).amount, 120);
    const fixtureDb = new DatabaseSync(join(dir, 'test.db'));
    fixtureDb.exec("INSERT INTO imports (filename, file_hash, due_date, total_ars_cents, transaction_count) VALUES ('prueba.pdf', 'fixture', '2026-11-12', 10000, 1)");
    const importedId = Number(fixtureDb.prepare("INSERT INTO transactions (type, description, category, amount_cents, currency, transaction_date, source, import_id, installment_current, installment_total) VALUES ('expense', 'Compra', 'Otros', 10000, 'ARS', '2026-11-12', 'visa', (SELECT id FROM imports WHERE file_hash = 'fixture'), 1, 2)").run().lastInsertRowid);
    const importedRecurringId = Number(fixtureDb.prepare("INSERT INTO transactions (type, description, category, amount_cents, currency, transaction_date, source, import_id) VALUES ('expense', 'Suscripción', 'Otros', 2000, 'ARS', '2026-11-12', 'visa', (SELECT id FROM imports WHERE file_hash = 'fixture'))").run().lastInsertRowid);
    fixtureDb.exec("INSERT INTO projected_installments (import_id, description, category, amount_cents, currency, due_month, installment_number, installment_total, external_key) VALUES ((SELECT id FROM imports WHERE file_hash = 'fixture'), 'Compra', 'Otros', 10000, 'ARS', '2026-12-01', 2, 2, 'fixture-quota')");
    fixtureDb.close();
    await request(`/api/transactions/${importedId}`, 'PUT', { type: 'expense', description: 'Compra corregida', category: 'Servicios', amount: 125, currency: 'ARS', transactionDate: '2026-11-13' });
    const imported = (await request('/api/transactions?month=2026-11')).find((row) => row.id === importedId);
    assert.equal(imported.category, 'Servicios');
    assert.equal(imported.amount, 125);
    assert.equal((await request('/api/imports'))[0].totalArs, 145);
    assert.equal((await request('/api/database/projected_installments')).rows[0].amount_cents, 10000);
    const editRecurring = { type: 'expense', description: 'Suscripción', category: 'Otros', amount: 20, currency: 'ARS', transactionDate: '2026-11-12', recurring: true };
    await request(`/api/transactions/${importedRecurringId}`, 'PUT', editRecurring);
    assert.equal((await request('/api/projection?month=2026-11')).recurringExpense, 20);
    await request(`/api/transactions/${importedRecurringId}`, 'PUT', { ...editRecurring, recurring: false });
    assert.equal((await request('/api/projection?month=2026-11')).recurringExpense, 0);
    const invalidRecurring = await fetch(base + `/api/transactions/${importedId}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ...editRecurring, recurring: true }) });
    assert.equal(invalidRecurring.status, 400);
    const invalid = await fetch(base + `/api/transactions/${importedId}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ type: 'expense', description: 'Compra', category: 'Otros', amount: 10, currency: 'ARS', transactionDate: '2026-02-30' }) });
    assert.equal(invalid.status, 400);
    const backupPath = join(dir, 'backup.db');
    const backup = spawnSync(process.execPath, ['server/backup-db.js', backupPath], { env: { ...process.env, DB_PATH: join(dir, 'test.db') } });
    assert.equal(backup.status, 0, backup.stderr.toString());
    const copy = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(copy.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, 6);
      assert.equal(copy.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    } finally { copy.close(); }
    const overwrite = spawnSync(process.execPath, ['server/backup-db.js', backupPath], { env: { ...process.env, DB_PATH: join(dir, 'test.db') } });
    assert.notEqual(overwrite.status, 0);
    const records = await request('/api/database/savings_plans');
    assert.equal(records.rows.length, 1);
    await request(`/api/database/savings_plans/${plan.id}`, 'PUT', { values: { name: 'Casa' } });
    assert.equal((await request('/api/savings'))[0].name, 'Casa');
    await request('/api/database/all', 'DELETE');
    assert.equal((await request('/api/transactions')).length, 0);
    assert.equal((await request('/api/savings')).length, 0);
    assert.equal((await request('/api/settings')).overdraftLimit, 2500000);
    const newUser = await request('/api/users', 'POST', { username: 'otro', password: 'otro-password' });
    assert.equal((await request('/api/users')).length, 2);
    await request(`/api/users/${newUser.id}`, 'DELETE');
    await request('/api/auth/logout', 'POST');
    assert.equal((await fetch(base + '/api/transactions', { headers: { cookie } })).status, 401);
  } finally {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
