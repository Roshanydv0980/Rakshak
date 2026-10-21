require('dotenv').config();
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('Warning: JWT_SECRET not set. Using an insecure default.');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e); res.status(500).json({ error: 'Server error' });
});
const sign = (u) => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
function auth(req, res, next) {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = jwt.verify(t, SECRET);
    next();
  } catch { res.status(401).json({ error: 'Please log in again' }); }
}
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const cleanPhone = (p) => String(p || '').replace(/[^\d+]/g, '');

// Simple in-memory rate limiter (swap for Redis in production)
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.path, now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many attempts. Try again soon.' });
    arr.push(now); hits.set(k, arr); next();
  };
}

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try { twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN); }
  catch { console.warn('twilio package not installed; SMS disabled'); }
}
async function notify(contacts, body) {
  for (const c of contacts) {
    if (twilioClient && process.env.TWILIO_FROM) {
      try { await twilioClient.messages.create({ to: c.phone, from: process.env.TWILIO_FROM, body }); }
      catch (e) { console.error('SMS failed for', c.name, e.message); }
    } else {
      console.log(`[SMS preview] to ${c.name} (${c.phone}): ${body}`);
    }
  }
}
function newSession(userId, kind) {
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,kind,created_at) VALUES(?,?,?,?)').run(token, userId, kind, Date.now());
  return token;
}
const ownSession = (token, userId) =>
  db.prepare('SELECT * FROM sessions WHERE token=? AND user_id=?').get(token, userId);

/* ---------- auth ---------- */
app.post('/api/register', limit(10, 60000), wrap((req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 8)
    return res.status(400).json({ error: 'Name, email and a password of 8+ characters are required' });
  const em = String(email).toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(em))
    return res.status(409).json({ error: 'That email is already registered' });
  const r = db.prepare('INSERT INTO users(name,email,password_hash,created_at) VALUES(?,?,?,?)')
    .run(String(name).trim().slice(0, 60), em, bcrypt.hashSync(password, 10), Date.now());
  res.json({ token: sign({ id: r.lastInsertRowid }), name });
}));
app.post('/api/login', limit(10, 60000), wrap((req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
    return res.status(401).json({ error: 'Email or password is incorrect' });
  res.json({ token: sign(u), name: u.name });
}));

/* ---------- contacts ---------- */
app.get('/api/contacts', auth, (req, res) =>
  res.json(db.prepare('SELECT id,name,phone FROM contacts WHERE user_id=?').all(req.user.id)));
app.post('/api/contacts', auth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40), phone = cleanPhone(req.body.phone);
  if (!name || phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Enter a name and full phone number' });
  if (db.prepare('SELECT COUNT(*) n FROM contacts WHERE user_id=?').get(req.user.id).n >= 5)
    return res.status(400).json({ error: 'You can add up to five contacts' });
  const r = db.prepare('INSERT INTO contacts(user_id,name,phone) VALUES(?,?,?)').run(req.user.id, name, phone);
  res.json({ id: r.lastInsertRowid, name, phone });
});
app.delete('/api/contacts/:id', auth, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ---------- SOS and live tracking ---------- */
function startShare(user, kind, lat, lng) {
  const me = db.prepare('SELECT name FROM users WHERE id=?').get(user.id);
  const contacts = db.prepare('SELECT name,phone FROM contacts WHERE user_id=?').all(user.id);
  const token = newSession(user.id, kind);
  if (lat !== null && lng !== null)
    db.prepare('INSERT INTO locations(token,lat,lng,ts) VALUES(?,?,?,?)').run(token, lat, lng, Date.now());
  const url = `${BASE_URL}/track/${token}`;
  const text = kind === 'sos'
    ? `EMERGENCY: ${me.name} needs help. Follow their live location: ${url}`
    : `${me.name} is sharing their live location with you: ${url}`;
  notify(contacts, text);
  return { token, url, notified: contacts.length };
}
app.post('/api/sos', auth, limit(5, 60000), (req, res) =>
  res.json(startShare(req.user, 'sos', num(req.body.lat), num(req.body.lng))));
app.post('/api/trips/start', auth, limit(10, 60000), (req, res) =>
  res.json(startShare(req.user, 'trip', num(req.body.lat), num(req.body.lng))));

app.post('/api/trips/:token/location', auth, (req, res) => {
  const s = ownSession(req.params.token, req.user.id);
  if (!s || !s.active) return res.status(404).json({ error: 'Session not active' });
  const lat = num(req.body.lat), lng = num(req.body.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return res.status(400).json({ error: 'Invalid coordinates' });
  const p = { lat, lng, acc: num(req.body.acc), ts: Date.now() };
  db.prepare('INSERT INTO locations(token,lat,lng,acc,ts) VALUES(?,?,?,?,?)').run(s.token, p.lat, p.lng, p.acc, p.ts);
  io.to(s.token).emit('location', p);
  res.json({ ok: true });
});
app.post('/api/trips/:token/end', auth, (req, res) => {
  const s = ownSession(req.params.token, req.user.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE sessions SET active=0 WHERE token=?').run(s.token);
  io.to(s.token).emit('ended');
  res.json({ ok: true });
});

// Public: anyone with the secret link can watch (the token is the credential)
app.get('/api/track/:token', (req, res) => {
  const s = db.prepare(`SELECT s.*, u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=?`).get(req.params.token);
  if (!s) return res.status(404).json({ error: 'Link not found' });
  const points = db.prepare('SELECT lat,lng,acc,ts FROM locations WHERE token=? ORDER BY ts DESC LIMIT 500').all(s.token).reverse();
  res.json({ name: s.name, kind: s.kind, active: !!s.active, points });
});
app.get('/track/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));

io.on('connection', (socket) => {
  socket.on('join', (token) => {
    if (typeof token === 'string' && /^[a-f0-9]{32}$/.test(token)) socket.join(token);
  });
});

server.listen(PORT, () => console.log(`Rakshak running at ${BASE_URL}`));
