import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const maxAge = 7 * 24 * 60 * 60;
const attempts = new Map();
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function validPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  const expected = Buffer.from(hex, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function tokenFrom(req) {
  return (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('saldo_session='))?.slice('saldo_session='.length) || '';
}
function sessionUser(req) {
  const token = tokenFrom(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(hashToken(token), Date.now());
}
function cookie(token, age) {
  return `saldo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
function validCredentials(username, password) {
  return typeof username === 'string' && /^[a-zA-Z0-9_.-]{1,40}$/.test(username) && typeof password === 'string' && password.length >= 8 && password.length <= 256;
}

export function installAuth(app) {
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      try {
        const url = new URL(origin);
        const sameHost = url.host === req.get('host');
        const localDev = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '5173' && ['localhost', '127.0.0.1'].includes(req.hostname);
        if (!sameHost && !localDev) return res.status(403).json({ error: 'Origen no permitido.' });
      } catch { return res.status(403).json({ error: 'Origen no permitido.' }); }
    } else if (req.get('sec-fetch-site') && req.get('sec-fetch-site') !== 'same-origin') return res.status(403).json({ error: 'Origen no permitido.' });
    return next();
  });
  app.get('/api/auth/session', (req, res) => res.json({ user: sessionUser(req) }));
  app.post('/api/auth/login', (req, res) => {
    const key = req.ip;
    const now = Date.now();
    for (const [ip, attempt] of attempts) if (attempt.until < now) attempts.delete(ip);
    const attempt = attempts.get(key);
    if (attempt?.count >= 5 && attempt.until > now) return res.status(429).json({ error: 'Demasiados intentos. Volvé a intentar en 15 minutos.' });
    const { username, password } = req.body || {};
    const user = typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) : null;
    if (!validCredentials(username, password) || !user || !validPassword(password, user.password_hash)) {
      attempts.set(key, { count: (attempt?.count || 0) + 1, until: attempt?.until > now ? attempt.until : now + 15 * 60 * 1000 });
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    attempts.delete(key);
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), user.id, now + maxAge * 1000);
    res.setHeader('Set-Cookie', cookie(token, maxAge));
    return res.json({ user: { id: user.id, username: user.username } });
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = tokenFrom(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    res.setHeader('Set-Cookie', cookie('', 0));
    return res.status(204).end();
  });
  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next();
    const user = sessionUser(req);
    if (!user) return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
    req.user = user;
    return next();
  });
  app.get('/api/users', (_req, res) => res.json(db.prepare('SELECT id, username, created_at FROM users ORDER BY username').all()));
  app.post('/api/users', (req, res) => {
    const { username, password } = req.body || {};
    if (!validCredentials(username, password)) return res.status(400).json({ error: 'Usá un usuario de hasta 40 letras, números o ._- y una contraseña de al menos 8 caracteres.' });
    try { const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash(password)); return res.status(201).json({ id: Number(result.lastInsertRowid), username }); }
    catch (error) { if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'El usuario ya existe.' }); throw error; }
  });
  app.put('/api/users/:id', (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const { username, password } = req.body || {};
    if (!validCredentials(username, password || 'placeholder')) return res.status(400).json({ error: 'Usuario o contraseña inválidos.' });
    try {
      db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(username, password ? passwordHash(password) : target.password_hash, target.id);
      if (password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      return res.json({ id: target.id, username });
    } catch (error) { if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'El usuario ya existe.' }); throw error; }
  });
  app.delete('/api/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'No podés eliminar tu propio usuario.' });
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (!result.changes) return res.status(404).json({ error: 'Usuario no encontrado.' });
    return res.status(204).end();
  });
}
