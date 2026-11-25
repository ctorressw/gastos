import express from 'express';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, inTransaction, toPublicTransaction } from './db.js';
import { parseVisaStatement } from './statementParser.js';
import { argentinaToday, DOLAR_HOY_URL, fetchDolarHoySale } from './exchangeRate.js';
import { installAuth } from './auth.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(file.mimetype === 'application/pdf' ? null : new Error('El archivo debe ser un PDF.'), file.mimetype === 'application/pdf');
  },
});
const port = Number(process.env.PORT || 3001);

app.use(express.json({ limit: '1mb' }));
installAuth(app);

const adminTables = ['transactions', 'imports', 'projected_installments', 'exchange_rates', 'categories', 'account_settings', 'savings_plans'];
function ensureSettings() {
  db.prepare('INSERT OR IGNORE INTO account_settings (id, opening_balance_cents, overdraft_limit_cents) VALUES (1, 0, 250000000)').run();
  db.prepare("INSERT OR IGNORE INTO categories (name, color, is_system) VALUES ('Otros', '#82909a', 1)").run();
}
// El administrador modifica datos financieros y sólo se expone a la propia computadora.
app.use('/api/database', (req, res, next) => {
  const address = req.socket.remoteAddress || '';
  const host = req.hostname;
  const origin = req.get('origin');
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) || !['localhost', '127.0.0.1', '::1'].includes(host) || (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin))) return res.status(403).json({ error: 'El administrador sólo está disponible desde esta computadora.' });
  next();
});

app.get('/api/database', (_req, res) => res.json(adminTables));
app.get('/api/database/:table', (req, res) => {
  const table = req.params.table;
  if (!adminTables.includes(table)) return res.status(404).json({ error: 'Tabla no encontrada.' });
  return res.json({ columns: db.prepare(`PRAGMA table_info("${table}")`).all(), rows: db.prepare(`SELECT * FROM "${table}" ORDER BY id DESC LIMIT 500`).all() });
});
app.put('/api/database/:table/:id', (req, res) => {
  const table = req.params.table;
  if (!adminTables.includes(table) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Registro no válido.' });
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name).filter((name) => name !== 'id');
  const changes = req.body.values;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some((key) => !columns.includes(key))) return res.status(400).json({ error: 'Campos no válidos.' });
  try {
    const keys = Object.keys(changes);
    const result = db.prepare(`UPDATE "${table}" SET ${keys.map((key) => `"${key}" = ?`).join(', ')} WHERE id = ?`).run(...keys.map((key) => changes[key]), Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Registro no encontrado.' });
    return res.json({ ok: true });
  } catch (error) { return res.status(400).json({ error: `No se pudo guardar: ${error.message}` }); }
});
app.delete('/api/database/:table/:id', (req, res) => {
  const table = req.params.table;
  if (!adminTables.includes(table) || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Registro no válido.' });
  try { inTransaction(() => { db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(Number(req.params.id)); ensureSettings(); }); return res.json({ ok: true }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});
app.delete('/api/database/:table', (req, res) => {
  const table = req.params.table;
  if (table !== 'all' && !adminTables.includes(table)) return res.status(400).json({ error: 'Tabla no válida.' });
  try {
    inTransaction(() => {
      const tables = table === 'all' ? ['projected_installments', 'transactions', 'imports', 'exchange_rates', 'categories', 'savings_plans', 'account_settings'] : [table];
      tables.forEach((name) => db.exec(`DELETE FROM "${name}"`));
      ensureSettings();
    });
    return res.json({ ok: true });
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

app.get('/api/savings', (_req, res) => res.json(db.prepare('SELECT * FROM savings_plans ORDER BY id DESC').all()));
app.post('/api/savings', (req, res) => {
  const { name, target, saved, monthly } = req.body;
  if (!String(name || '').trim() || ![target, saved, monthly].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e12) || Number(target) <= 0) return res.status(400).json({ error: 'Ingresá nombre y montos válidos.' });
  const result = db.prepare('INSERT INTO savings_plans (name, target_cents, saved_cents, monthly_cents) VALUES (?, ?, ?, ?)').run(String(name).trim(), Math.round(target * 100), Math.round(saved * 100), Math.round(monthly * 100));
  return res.status(201).json({ id: Number(result.lastInsertRowid) });
});
app.put('/api/savings/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM savings_plans WHERE id = ?').get(Number(req.params.id));
  if (!current) return res.status(404).json({ error: 'Plan no encontrado.' });
  const name = String(req.body.name ?? current.name).trim();
  const target = Number(req.body.target ?? current.target_cents / 100);
  const saved = Number(req.body.saved ?? current.saved_cents / 100);
  const monthly = Number(req.body.monthly ?? current.monthly_cents / 100);
  if (!name || ![target, saved, monthly].every((value) => Number.isFinite(value) && value >= 0 && value <= 1e12) || target <= 0) return res.status(400).json({ error: 'Ingresá nombre y montos válidos.' });
  db.prepare('UPDATE savings_plans SET name = ?, target_cents = ?, saved_cents = ?, monthly_cents = ? WHERE id = ?').run(name, Math.round(target * 100), Math.round(saved * 100), Math.round(monthly * 100), current.id);
  return res.json({ ok: true });
});
app.delete('/api/savings/:id', (req, res) => { db.prepare('DELETE FROM savings_plans WHERE id = ?').run(Number(req.params.id)); res.status(204).end(); });

function validMonth(value) {
  return /^\d{4}-\d{2}$/.test(value || '') ? value : new Date().toISOString().slice(0, 7);
}

function monthRange(month) {
  return { start: `${month}-01`, end: `${month}-31` };
}

function monthsFrom(start, count) {
  const [year, month] = start.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function addMonthsToDate(value, count) {
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function accountState(untilDate) {
  const settings = db.prepare('SELECT * FROM account_settings WHERE id = 1').get();
  const movements = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents ELSE -amount_cents END), 0) AS net_cents
    FROM transactions WHERE currency = 'ARS' AND transaction_date <= ?
  `).get(untilDate);
  const balanceCents = settings.opening_balance_cents + movements.net_cents;
  const usedCents = Math.max(0, -balanceCents);
  const remainingCents = Math.max(0, settings.overdraft_limit_cents - usedCents);
  return {
    accountBalanceArs: balanceCents / 100,
    openingBalanceArs: settings.opening_balance_cents / 100,
    overdraftLimitArs: settings.overdraft_limit_cents / 100,
    overdraftUsedArs: usedCents / 100,
    overdraftRemainingArs: remainingCents / 100,
    spendingCapacityArs: Math.max(0, balanceCents + settings.overdraft_limit_cents) / 100,
    isOverdraft: balanceCents < 0,
    isOverLimit: usedCents > settings.overdraft_limit_cents,
  };
}

function forecastFor(startMonth, count = 6) {
  return monthsFrom(startMonth, count).map((month) => {
    const { start, end } = monthRange(month);
    const movements = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' AND currency = 'ARS' THEN amount_cents END), 0) AS income_ars,
        COALESCE(SUM(CASE WHEN type = 'expense' AND currency = 'ARS' THEN amount_cents END), 0) AS expense_ars,
        COALESCE(SUM(CASE WHEN type = 'expense' AND currency = 'USD' THEN amount_cents END), 0) AS expense_usd,
        COALESCE(SUM(CASE WHEN type = 'expense' AND currency = 'ARS' AND installment_total > 1 THEN amount_cents END), 0) AS manual_installment_ars,
        COALESCE(SUM(CASE WHEN type = 'expense' AND currency = 'USD' AND installment_total > 1 THEN amount_cents END), 0) AS manual_installment_usd,
        COUNT(CASE WHEN type = 'expense' AND installment_total > 1 THEN 1 END) AS manual_installment_count
      FROM transactions WHERE transaction_date BETWEEN ? AND ?
    `).get(start, end);
    const installments = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN currency = 'ARS' THEN amount_cents END), 0) AS installment_ars,
        COALESCE(SUM(CASE WHEN currency = 'USD' THEN amount_cents END), 0) AS installment_usd,
        COUNT(*) AS installment_count
      FROM projected_installments WHERE due_month = ?
    `).get(start);
    return {
      month,
      incomeArs: movements.income_ars / 100,
      expenseArs: movements.expense_ars / 100,
      expenseUsd: movements.expense_usd / 100,
      installmentArs: (installments.installment_ars + movements.manual_installment_ars) / 100,
      installmentUsd: (installments.installment_usd + movements.manual_installment_usd) / 100,
      installmentCount: installments.installment_count + movements.manual_installment_count,
      committedArs: (movements.expense_ars + installments.installment_ars) / 100,
    };
  });
}

function publicRate(row, warning = null) {
  if (!row) return { rate: null, date: null, source: null, sourceUrl: DOLAR_HOY_URL, stale: true, warning };
  return {
    rate: row.rate_cents / 100,
    date: row.rate_date,
    source: row.source,
    sourceUrl: row.source_url || DOLAR_HOY_URL,
    fetchedAt: row.fetched_at,
    stale: row.rate_date !== argentinaToday(),
    warning,
  };
}

function latestRate() {
  return db.prepare('SELECT * FROM exchange_rates ORDER BY rate_date DESC, id DESC LIMIT 1').get();
}

function rateForDate(date) {
  return db.prepare('SELECT * FROM exchange_rates WHERE rate_date <= ? ORDER BY rate_date DESC, id DESC LIMIT 1').get(date);
}

function saveRate(rate, date, source, sourceUrl = null) {
  const cents = Math.round(rate * 100);
  db.prepare(`
    INSERT INTO exchange_rates (rate_date, rate_cents, source, source_url, fetched_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(rate_date) DO UPDATE SET
      rate_cents = excluded.rate_cents,
      source = excluded.source,
      source_url = excluded.source_url,
      fetched_at = CURRENT_TIMESTAMP
  `).run(date, cents, source, sourceUrl);
  return db.prepare('SELECT * FROM exchange_rates WHERE rate_date = ?').get(date);
}

function statementSummary(transactions) {
  return transactions.reduce((summary, transaction) => {
    const sign = transaction.type === 'income' ? -1 : 1;
    if (transaction.currency === 'USD') summary.usdCents += sign * transaction.amountCents;
    else summary.arsCents += sign * transaction.amountCents;
    summary.transactionCount += 1;
    return summary;
  }, { transactionCount: 0, arsCents: 0, usdCents: 0 });
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/categories', (_req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY CASE WHEN name = ? THEN 1 ELSE 0 END, name COLLATE NOCASE').all('Otros');
  res.json(rows.map((row) => ({ id: row.id, name: row.name, color: row.color, isSystem: Boolean(row.is_system) })));
});

app.post('/api/categories', (req, res) => {
  const name = String(req.body.name || '').trim();
  const color = String(req.body.color || '#82909a');
  if (!name || name.length > 40 || !/^#[0-9a-f]{6}$/i.test(color)) return res.status(400).json({ error: 'Ingresá un nombre y un color válidos.' });
  try {
    const result = db.prepare('INSERT INTO categories (name, color, is_system) VALUES (?, ?, 0)').run(name, color);
    return res.status(201).json({ id: Number(result.lastInsertRowid), name, color, isSystem: false });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre.' });
    throw error;
  }
});

app.put('/api/categories/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
  if (!current) return res.status(404).json({ error: 'Categoría no encontrada.' });
  const name = String(req.body.name || '').trim();
  const color = String(req.body.color || current.color);
  if (!name || name.length > 40 || !/^#[0-9a-f]{6}$/i.test(color)) return res.status(400).json({ error: 'Ingresá un nombre y un color válidos.' });
  if (current.is_system && name.toLowerCase() !== current.name.toLowerCase()) return res.status(400).json({ error: 'Las categorías base conservan su nombre; podés cambiarles el color.' });
  try {
    inTransaction(() => {
      db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(name, color, current.id);
      if (name !== current.name) {
        db.prepare('UPDATE transactions SET category = ? WHERE category = ?').run(name, current.name);
        db.prepare('UPDATE projected_installments SET category = ? WHERE category = ?').run(name, current.name);
      }
    });
    return res.json({ id: current.id, name, color, isSystem: Boolean(current.is_system) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre.' });
    throw error;
  }
});

app.delete('/api/categories/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
  if (!current) return res.status(404).json({ error: 'Categoría no encontrada.' });
  if (current.is_system) return res.status(400).json({ error: 'Las categorías base no se eliminan.' });
  inTransaction(() => {
    db.prepare('UPDATE transactions SET category = ? WHERE category = ?').run('Otros', current.name);
    db.prepare('UPDATE projected_installments SET category = ? WHERE category = ?').run('Otros', current.name);
    db.prepare('DELETE FROM categories WHERE id = ?').run(current.id);
  });
  return res.status(204).end();
});

app.get('/api/settings', (_req, res) => {
  const row = db.prepare('SELECT * FROM account_settings WHERE id = 1').get();
  res.json({ openingBalance: row.opening_balance_cents / 100, overdraftLimit: row.overdraft_limit_cents / 100 });
});

app.put('/api/settings', (req, res) => {
  const openingBalance = Number(req.body.openingBalance);
  const overdraftLimit = Number(req.body.overdraftLimit);
  if (!Number.isFinite(openingBalance) || !Number.isFinite(overdraftLimit) || overdraftLimit < 0 || Math.abs(openingBalance) > 1e12 || overdraftLimit > 1e12) {
    return res.status(400).json({ error: 'Ingresá saldos y límites válidos.' });
  }
  db.prepare('UPDATE account_settings SET opening_balance_cents = ?, overdraft_limit_cents = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1')
    .run(Math.round(openingBalance * 100), Math.round(overdraftLimit * 100));
  return res.json({ openingBalance, overdraftLimit });
});

app.get('/api/exchange-rate', async (req, res, next) => {
  try {
    let row = req.query.date ? rateForDate(req.query.date) : latestRate();
    let warning = null;
    if (req.query.auto === 'true' && (!row || row.rate_date !== argentinaToday())) {
      try {
        const value = await fetchDolarHoySale();
        row = saveRate(value, argentinaToday(), 'dolarhoy', DOLAR_HOY_URL);
      } catch (error) {
        warning = row
          ? `No se pudo actualizar automáticamente. Se usa la cotización del ${row.rate_date}.`
          : 'No se pudo obtener la cotización automática. Cargala manualmente.';
      }
    }
    return res.json(publicRate(row, warning));
  } catch (error) {
    return next(error);
  }
});

app.post('/api/exchange-rate/refresh', async (_req, res, next) => {
  try {
    const value = await fetchDolarHoySale();
    const row = saveRate(value, argentinaToday(), 'dolarhoy', DOLAR_HOY_URL);
    return res.json(publicRate(row));
  } catch (error) {
    return next(error);
  }
});

app.post('/api/exchange-rate', (req, res) => {
  const rate = Number(req.body.rate);
  const date = req.body.date || argentinaToday();
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000000 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Ingresá una cotización y una fecha válidas.' });
  }
  const row = saveRate(rate, date, 'manual');
  return res.status(201).json(publicRate(row));
});

app.get('/api/reports/categories', (req, res) => {
  const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const from = req.query.from;
  const to = req.query.to;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) {
    return res.status(400).json({ error: 'El rango de fechas no es válido.' });
  }
  const selectedRate = Number(req.query.rate);
  const storedRate = rateForDate(to) || latestRate();
  const rate = Number.isFinite(selectedRate) && selectedRate > 0 ? selectedRate : storedRate?.rate_cents / 100 || 0;
  const rows = db.prepare(`
    SELECT * FROM transactions
    WHERE transaction_date BETWEEN ? AND ?
      AND (type = 'expense' OR (type = 'income' AND source = 'visa'))
    ORDER BY transaction_date DESC, id DESC
  `).all(from, to);
  const categoryMap = new Map();
  const details = rows.map((row) => {
    const sign = row.type === 'income' ? -1 : 1;
    const amount = sign * row.amount_cents / 100;
    const convertedArs = roundMoney(row.currency === 'USD' ? amount * rate : amount);
    const current = categoryMap.get(row.category) || { category: row.category, arsAmount: 0, usdAmount: 0, consolidatedArs: 0, count: 0 };
    if (row.currency === 'USD') current.usdAmount += amount;
    else current.arsAmount += amount;
    current.consolidatedArs += convertedArs;
    current.count += 1;
    categoryMap.set(row.category, current);
    return { ...toPublicTransaction(row), convertedArs };
  });
  const categories = [...categoryMap.values()].map((item) => ({
    ...item,
    arsAmount: roundMoney(item.arsAmount),
    usdAmount: roundMoney(item.usdAmount),
    consolidatedArs: roundMoney(item.consolidatedArs),
  })).sort((a, b) => b.consolidatedArs - a.consolidatedArs);
  const rawTotals = categories.reduce((sum, item) => ({
    arsAmount: sum.arsAmount + item.arsAmount,
    usdAmount: sum.usdAmount + item.usdAmount,
    consolidatedArs: sum.consolidatedArs + item.consolidatedArs,
    count: sum.count + item.count,
  }), { arsAmount: 0, usdAmount: 0, consolidatedArs: 0, count: 0 });
  const totals = {
    ...rawTotals,
    arsAmount: roundMoney(rawTotals.arsAmount),
    usdAmount: roundMoney(rawTotals.usdAmount),
    consolidatedArs: roundMoney(rawTotals.consolidatedArs),
  };
  return res.json({ from, to, rate, rateSource: storedRate?.source || null, totals, categories, details });
});

app.get('/api/dashboard', (req, res) => {
  const month = validMonth(req.query.month);
  const { start, end } = monthRange(month);
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' AND currency = 'ARS' THEN amount_cents END), 0) AS income_ars,
      COALESCE(SUM(CASE WHEN type = 'expense' AND currency = 'ARS' THEN amount_cents END), 0) AS expense_ars,
      COALESCE(SUM(CASE WHEN type = 'income' AND currency = 'USD' THEN amount_cents END), 0) AS income_usd,
      COALESCE(SUM(CASE WHEN type = 'expense' AND currency = 'USD' THEN amount_cents END), 0) AS expense_usd
    FROM transactions WHERE transaction_date BETWEEN ? AND ?
  `).get(start, end);
  const categoryRows = db.prepare(`
    SELECT category, SUM(amount_cents) AS amount_cents
    FROM transactions
    WHERE type = 'expense' AND currency = 'ARS' AND transaction_date BETWEEN ? AND ?
    GROUP BY category ORDER BY amount_cents DESC
  `).all(start, end);
  const recent = db.prepare(`
    SELECT * FROM transactions WHERE transaction_date BETWEEN ? AND ?
    ORDER BY transaction_date DESC, id DESC LIMIT 8
  `).all(start, end).map(toPublicTransaction);

  res.json({
    month,
    incomeArs: totals.income_ars / 100,
    expenseArs: totals.expense_ars / 100,
    availableArs: (totals.income_ars - totals.expense_ars) / 100,
    incomeUsd: totals.income_usd / 100,
    expenseUsd: totals.expense_usd / 100,
    categories: categoryRows.map((row) => ({ category: row.category, amount: row.amount_cents / 100 })),
    recent,
    forecast: forecastFor(month, 6),
    account: accountState(end),
  });
});

app.get('/api/projection', (req, res) => {
  const month = validMonth(req.query.month);
  const nextMonth = monthsFrom(month, 2)[1];
  const { end } = monthRange(month);
  const recurring = db.prepare("SELECT * FROM transactions WHERE is_recurring = 1 AND transaction_date <= ? ORDER BY transaction_date").all(end);
  const next = forecastFor(nextMonth, 1)[0];
  const rate = (latestRate()?.rate_cents || 0) / 100;
  const usdRows = db.prepare("SELECT type, amount_cents FROM transactions WHERE currency = 'USD' AND transaction_date BETWEEN ? AND ?").all(...Object.values(monthRange(nextMonth)));
  const projectedUsd = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS amount FROM projected_installments WHERE currency = 'USD' AND due_month = ?").get(`${nextMonth}-01`).amount / 100;
  let income = next.incomeArs + usdRows.filter((r) => r.type === 'income').reduce((n, r) => n + r.amount_cents / 100 * rate, 0);
  let expense = next.committedArs + (next.expenseUsd + projectedUsd) * rate;
  let recurringIncome = 0, recurringExpense = 0;
  for (const row of recurring) {
    const value = row.amount_cents / 100 * (row.currency === 'USD' ? rate : 1);
    if (row.type === 'income') recurringIncome += value; else recurringExpense += value;
  }
  const savings = db.prepare('SELECT COALESCE(SUM(MIN(monthly_cents, MAX(target_cents - saved_cents, 0))), 0) AS amount FROM savings_plans').get().amount / 100;
  const startBalance = accountState(end).accountBalanceArs;
  const endBalance = startBalance + income + recurringIncome - expense - recurringExpense - savings;
  const usdPresent = next.expenseUsd || projectedUsd || usdRows.length || recurring.some((row) => row.currency === 'USD');
  res.json({ month: nextMonth, startBalance, income, expense, recurringIncome, recurringExpense, savings, endBalance, rate, missingRate: Boolean(usdPresent && !rate), recurring: recurring.map(toPublicTransaction), overdraftLimit: accountState(end).overdraftLimitArs });
});

app.get('/api/transactions', (req, res) => {
  const month = req.query.month ? validMonth(req.query.month) : null;
  const type = ['income', 'expense'].includes(req.query.type) ? req.query.type : null;
  const clauses = [];
  const params = [];
  if (month) {
    const { start, end } = monthRange(month);
    clauses.push('transaction_date BETWEEN ? AND ?');
    params.push(start, end);
  }
  if (type) {
    clauses.push('type = ?');
    params.push(type);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM transactions ${where} ORDER BY transaction_date DESC, id DESC`).all(...params);
  res.json(rows.map(toPublicTransaction));
});

app.post('/api/transactions', (req, res) => {
  const { type, description, category = 'Otros', amount, currency = 'ARS', transactionDate } = req.body;
  const installments = Number(req.body.installments || 1);
  if (!['income', 'expense'].includes(type) || !description?.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate || '')) {
    return res.status(400).json({ error: 'Completá tipo, descripción, monto y fecha con valores válidos.' });
  }
  if (!['ARS', 'USD'].includes(currency)) return res.status(400).json({ error: 'Moneda no válida.' });
  if (!Number.isInteger(installments) || installments < 1 || installments > 120) return res.status(400).json({ error: 'La cantidad de cuotas debe estar entre 1 y 120.' });
  if (req.body.recurring && installments > 1) return res.status(400).json({ error: 'Un movimiento en cuotas no puede ser recurrente.' });
  const categoryExists = db.prepare('SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE').get(category);
  if (!categoryExists) return res.status(400).json({ error: 'La categoría elegida no existe.' });
  const group = installments > 1 ? randomUUID() : null;
  const rows = inTransaction(() => {
    const insert = db.prepare(`
      INSERT INTO transactions (
        type, description, category, amount_cents, currency, transaction_date,
        installment_current, installment_total, external_key, is_recurring
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return Array.from({ length: installments }, (_, index) => {
      const result = insert.run(
        type, description.trim(), category, Math.round(Number(amount) * 100), currency,
        addMonthsToDate(transactionDate, index), installments > 1 ? index + 1 : null,
        installments > 1 ? installments : null, group ? `manual:${group}:${index + 1}` : null, req.body.recurring ? 1 : 0,
      );
      return toPublicTransaction(db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid));
    });
  });
  return res.status(201).json({ transactions: rows, account: accountState(argentinaToday()) });
});

app.put('/api/transactions/:id/recurring', (req, res) => {
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  if (row.installment_total > 1) return res.status(400).json({ error: 'Las cuotas no pueden marcarse como recurrentes.' });
  if (typeof req.body.recurring !== 'boolean') return res.status(400).json({ error: 'Valor inválido.' });
  db.prepare('UPDATE transactions SET is_recurring = ? WHERE id = ?').run(req.body.recurring ? 1 : 0, row.id);
  return res.json({ ok: true });
});

app.put('/api/transactions/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id));
  if (!current) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  const { type, description, category, amount, currency, transactionDate } = req.body;
  const numericAmount = Number(amount);
  const date = typeof transactionDate === 'string' ? transactionDate : '';
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!['income', 'expense'].includes(type) || typeof description !== 'string' || !description.trim() || !Number.isFinite(numericAmount) || numericAmount < 0.01 || numericAmount > 1e12 || !['ARS', 'USD'].includes(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return res.status(400).json({ error: 'Completá el movimiento con valores y fecha válidos.' });
  }
  const selectedCategory = db.prepare('SELECT name FROM categories WHERE name = ? COLLATE NOCASE').get(category);
  if (!selectedCategory) return res.status(400).json({ error: 'La categoría elegida no existe.' });
  if (req.body.recurring !== undefined && typeof req.body.recurring !== 'boolean') return res.status(400).json({ error: 'Valor de recurrencia inválido.' });
  if (req.body.recurring && current.installment_total > 1) return res.status(400).json({ error: 'Las cuotas no pueden marcarse como recurrentes.' });
  const recurring = req.body.recurring === undefined ? current.is_recurring : Number(req.body.recurring);
  inTransaction(() => {
    db.prepare('UPDATE transactions SET type = ?, description = ?, category = ?, amount_cents = ?, currency = ?, transaction_date = ?, is_recurring = ? WHERE id = ?')
      .run(type, description.trim(), selectedCategory.name, Math.round(numericAmount * 100), currency, date, recurring, current.id);
    if (current.import_id) {
      db.prepare(`UPDATE imports SET
        total_ars_cents = (SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN -amount_cents ELSE amount_cents END), 0) FROM transactions WHERE import_id = ? AND currency = 'ARS'),
        total_usd_cents = (SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN -amount_cents ELSE amount_cents END), 0) FROM transactions WHERE import_id = ? AND currency = 'USD')
        WHERE id = ?`).run(current.import_id, current.import_id, current.import_id);
    }
  });
  return res.json(toPublicTransaction(db.prepare('SELECT * FROM transactions WHERE id = ?').get(current.id)));
});

app.delete('/api/transactions/:id', (req, res) => {
  const movement = db.prepare('SELECT * FROM transactions WHERE id = ? AND source = ?').get(Number(req.params.id), 'manual');
  if (!movement) return res.status(404).json({ error: 'Movimiento manual no encontrado.' });
  if (movement.installment_total > 1 && movement.external_key?.startsWith('manual:')) {
    const groupPrefix = movement.external_key.replace(/:\d+$/, '');
    const result = db.prepare('DELETE FROM transactions WHERE source = ? AND external_key LIKE ?').run('manual', `${groupPrefix}:%`);
    return res.json({ deletedCount: result.changes, deletedSeries: true });
  }
  db.prepare('DELETE FROM transactions WHERE id = ?').run(movement.id);
  return res.json({ deletedCount: 1, deletedSeries: false });
});

app.get('/api/imports', (_req, res) => {
  const imports = db.prepare('SELECT * FROM imports ORDER BY created_at DESC').all().map((row) => ({
    ...row,
    totalArs: row.total_ars_cents / 100,
    totalUsd: row.total_usd_cents / 100,
  }));
  res.json(imports);
});

app.post('/api/imports/statement/preview', upload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Seleccioná un resumen en PDF.' });
    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex');
    const existing = db.prepare('SELECT id FROM imports WHERE file_hash = ?').get(fileHash);
    if (existing) return res.status(409).json({ error: 'Este resumen ya fue importado. Podés eliminarlo antes de volver a elegir sus tarjetas.' });
    const parsed = await parseVisaStatement(req.file.buffer);
    return res.json({
      filename: req.file.originalname,
      dueDate: parsed.dueDate,
      statementDate: parsed.statementDate,
      totalArs: parsed.totalArsCents / 100,
      totalUsd: parsed.totalUsdCents / 100,
      cards: parsed.cards.map((card) => ({
        last4: card.last4,
        holder: card.holder,
        transactionCount: card.transactionCount,
        totalArs: card.arsCents / 100,
        totalUsd: card.usdCents / 100,
      })),
      common: {
        transactionCount: parsed.common.transactionCount,
        totalArs: parsed.common.arsCents / 100,
        totalUsd: parsed.common.usdCents / 100,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/imports/statement', upload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Seleccioná un resumen en PDF.' });
    const fileHash = createHash('sha256').update(req.file.buffer).digest('hex');
    const existing = db.prepare('SELECT id FROM imports WHERE file_hash = ?').get(fileHash);
    if (existing) return res.status(409).json({ error: 'Este resumen ya fue importado.' });

    const parsed = await parseVisaStatement(req.file.buffer);
    let selectedCards = parsed.cards.map((card) => card.last4);
    if (req.body.cards != null) {
      try {
        const requested = JSON.parse(req.body.cards);
        if (!Array.isArray(requested)) throw new Error('invalid');
        const available = new Set(parsed.cards.map((card) => card.last4));
        selectedCards = requested.map(String).filter((last4) => available.has(last4));
      } catch {
        return res.status(400).json({ error: 'La selección de tarjetas no es válida.' });
      }
    }
    const selectedSet = new Set(selectedCards);
    const selectedTransactions = parsed.transactions.filter((transaction) => !transaction.cardLast4 || selectedSet.has(transaction.cardLast4));
    const selectedInstallments = parsed.projectedInstallments.filter((item) => !item.cardLast4 || selectedSet.has(item.cardLast4));
    if (!selectedTransactions.length) return res.status(400).json({ error: 'La selección no contiene consumos ni gastos comunes.' });
    const selectedSummary = statementSummary(selectedTransactions);
    const imported = inTransaction(() => {
      const importResult = db.prepare(`
        INSERT INTO imports (filename, file_hash, statement_date, due_date, total_ars_cents, total_usd_cents, transaction_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.file.originalname, fileHash, parsed.statementDate, parsed.dueDate, selectedSummary.arsCents, selectedSummary.usdCents, selectedTransactions.length);
      const importId = Number(importResult.lastInsertRowid);
      const insertTransaction = db.prepare(`
        INSERT INTO transactions (
          type, description, category, amount_cents, currency, transaction_date, purchase_date,
          source, import_id, card_last4, installment_current, installment_total, external_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'visa', ?, ?, ?, ?, ?)
      `);
      selectedTransactions.forEach((transaction, index) => {
        const externalKey = `${fileHash}:tx:${index}`;
        insertTransaction.run(
          transaction.type, transaction.description, transaction.category, transaction.amountCents, transaction.currency,
          parsed.dueDate, transaction.purchaseDate, importId, transaction.cardLast4,
          transaction.installmentCurrent, transaction.installmentTotal, externalKey,
        );
      });
      const insertInstallment = db.prepare(`
        INSERT INTO projected_installments (
          import_id, description, category, amount_cents, currency, due_month,
          installment_number, installment_total, card_last4, external_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      selectedInstallments.forEach((item, index) => {
        insertInstallment.run(
          importId, item.description, item.category, item.amountCents, item.currency, item.dueMonth,
          item.installmentNumber, item.installmentTotal, item.cardLast4, `${fileHash}:quota:${index}`,
        );
      });
      return { importId };
    });

    return res.status(201).json({
      ...imported,
      filename: req.file.originalname,
      dueDate: parsed.dueDate,
      statementDate: parsed.statementDate,
      totalArs: selectedSummary.arsCents / 100,
      totalUsd: selectedSummary.usdCents / 100,
      transactionCount: selectedTransactions.length,
      projectedCount: selectedInstallments.length,
      selectedCards,
      commonCount: parsed.common.transactionCount,
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/imports/:id', (req, res) => {
  const result = db.prepare('DELETE FROM imports WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Importación no encontrada.' });
  return res.status(204).end();
});

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(rootDir, 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(distDir, 'index.html')));
}

app.use((error, _req, res, _next) => {
  console.error(error);
  const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
    ? 'El PDF supera el límite de 15 MB.'
    : error.message || 'No se pudo completar la operación.';
  res.status(400).json({ error: message });
});

app.listen(port, () => {
  console.log(`API lista en http://localhost:${port}`);
});
