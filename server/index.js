import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.SESSION_SECRET || (PROD ? '' : 'dev-secret-change-me');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX = { company: 60, who: 40, title: 120, body: 500 };

if (!SECRET) { console.error('SESSION_SECRET is required in production.'); process.exit(1); }
if (!ADMIN_TOKEN) console.warn('ADMIN_TOKEN not set: moderation is disabled until you set one.');

const db = await openDatabase();
console.log(`Storage: ${db.kind}${db.file ? ' (' + db.file + ')' : ''}`);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// ---------- security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// ---------- anonymous identity (signed cookie) ----------
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (PROD) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
app.use((req, res, next) => {
  const c = parseCookies(req);
  let uid = null;
  if (c.bw_uid) {
    const [id, sig] = c.bw_uid.split('.');
    if (id && sig && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(id)))) uid = id;
  }
  if (!uid) {
    uid = 'u_' + crypto.randomBytes(16).toString('base64url');
    setCookie(res, 'bw_uid', `${uid}.${sign(uid)}`, 60 * 60 * 24 * 365 * 2);
  }
  req.uid = uid;
  req.isAdmin = !!ADMIN_TOKEN && c.bw_admin === sign('admin:' + ADMIN_TOKEN);
  next();
});

// ---------- rate limiting (per identity, in memory) ----------
const buckets = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > b.reset) { b.count = 0; b.reset = now + windowMs; }
  b.count++; buckets.set(key, b);
  return b.count <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60_000).unref();

// ---------- helpers ----------
const coKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const newId = () => 's_' + crypto.randomBytes(9).toString('base64url');
const CONTACT = /@|https?:\/\/|www\.|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/i;
const rowToStory = (r, uid) => ({
  id: r.id, company: r.company, who: r.who, title: r.title, body: r.body,
  createdAt: Number(r.created_at), example: !!Number(r.example),
  mine: r.author === uid, votes: Number(r.votes || 0), voted: !!Number(r.voted || 0),
});

async function listStories(uid) {
  const rows = await db.all(
    `SELECT s.*, (SELECT COUNT(*) FROM votes v WHERE v.story_id = s.id) AS votes,
            (SELECT COUNT(*) FROM votes v WHERE v.story_id = s.id AND v.user_id = ?) AS voted
       FROM stories s ORDER BY s.created_at DESC LIMIT 1000`, [uid]);
  return rows.map((r) => rowToStory(r, uid));
}

// ---------- API ----------
app.get('/api/health', async (req, res) => {
  try { await db.get('SELECT 1 AS ok'); res.json({ ok: true, storage: db.kind }); }
  catch (e) { res.status(500).json({ ok: false }); }
});

app.get('/api/me', async (req, res) => {
  const given = await db.get('SELECT COUNT(*) AS n FROM votes WHERE user_id = ?', [req.uid]);
  res.json({ id: req.uid, isAdmin: req.isAdmin, votesGiven: Number(given?.n || 0), moderation: !!ADMIN_TOKEN });
});

app.get('/api/stories', async (req, res) => {
  res.json({ stories: await listStories(req.uid), now: Date.now() });
});

app.post('/api/stories', async (req, res) => {
  if (!limit('post:' + req.uid, 10, 60 * 60_000)) return res.status(429).json({ error: 'Slow down. You can post 10 stories an hour.' });
  const company = clean(req.body?.company, MAX.company).replace(/\s+/g, ' ');
  const who = clean(req.body?.who, MAX.who);
  const title = clean(req.body?.title, MAX.title);
  const body = clean(req.body?.body, MAX.body);
  const problems = [];
  if (company.length < 2) problems.push('Name the company.');
  if (who.length < 2) problems.push('Say who did it (a first name or role).');
  if (title.length < 8) problems.push('The one-liner needs a few more words.');
  if (CONTACT.test(`${who} ${title} ${body}`)) problems.push('No emails, links, or phone numbers.');
  if (problems.length) return res.status(400).json({ error: problems.join(' ') });
  const id = newId();
  await db.run('INSERT INTO stories (id, company, company_key, who, title, body, author, example, created_at) VALUES (?,?,?,?,?,?,?,0,?)',
    [id, company, coKey(company), who, title, body, req.uid, Date.now()]);
  const row = await db.get('SELECT s.*, 0 AS votes, 0 AS voted FROM stories s WHERE id = ?', [id]);
  res.status(201).json({ story: rowToStory(row, req.uid) });
});

app.delete('/api/stories/:id', async (req, res) => {
  const row = await db.get('SELECT id, author FROM stories WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Story not found.' });
  if (row.author !== req.uid && !req.isAdmin) return res.status(403).json({ error: 'You can only delete your own stories.' });
  await db.run('DELETE FROM votes WHERE story_id = ?', [row.id]);
  await db.run('DELETE FROM reports WHERE story_id = ?', [row.id]);
  await db.run('DELETE FROM stories WHERE id = ?', [row.id]);
  res.json({ ok: true });
});

app.post('/api/stories/:id/vote', async (req, res) => {
  if (!limit('vote:' + req.uid, 60, 60_000)) return res.status(429).json({ error: 'Too many votes at once.' });
  const story = await db.get('SELECT id FROM stories WHERE id = ?', [req.params.id]);
  if (!story) return res.status(404).json({ error: 'Story not found.' });
  const existing = await db.get('SELECT 1 AS x FROM votes WHERE user_id = ? AND story_id = ?', [req.uid, story.id]);
  if (existing) await db.run('DELETE FROM votes WHERE user_id = ? AND story_id = ?', [req.uid, story.id]);
  else await db.run('INSERT INTO votes (user_id, story_id, created_at) VALUES (?,?,?)', [req.uid, story.id, Date.now()]);
  const n = await db.get('SELECT COUNT(*) AS n FROM votes WHERE story_id = ?', [story.id]);
  res.json({ voted: !existing, votes: Number(n.n) });
});

app.post('/api/stories/:id/report', async (req, res) => {
  if (!limit('report:' + req.uid, 20, 60 * 60_000)) return res.status(429).json({ error: 'Too many reports.' });
  const story = await db.get('SELECT id FROM stories WHERE id = ?', [req.params.id]);
  if (!story) return res.status(404).json({ error: 'Story not found.' });
  await db.run('INSERT INTO reports (id, story_id, user_id, reason, created_at) VALUES (?,?,?,?,?)',
    ['r_' + crypto.randomBytes(9).toString('base64url'), story.id, req.uid, clean(req.body?.reason, 200), Date.now()]);
  res.json({ ok: true });
});

// ---------- admin ----------
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'Moderation is not configured on this server.' });
  if (!limit('admin:' + req.ip, 5, 15 * 60_000)) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes.' });
  const t = String(req.body?.token || '');
  const ok = t.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN));
  if (!ok) return res.status(401).json({ error: 'Wrong admin token.' });
  setCookie(res, 'bw_admin', sign('admin:' + ADMIN_TOKEN), 60 * 60 * 12);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { setCookie(res, 'bw_admin', '', 0); res.json({ ok: true }); });
app.get('/api/admin/reports', async (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: 'Admins only.' });
  const rows = await db.all(
    `SELECT r.story_id, COUNT(*) AS reports, MAX(r.created_at) AS last_at, s.title, s.company
       FROM reports r JOIN stories s ON s.id = r.story_id GROUP BY r.story_id, s.title, s.company ORDER BY reports DESC LIMIT 200`);
  res.json({ reports: rows.map((r) => ({ storyId: r.story_id, reports: Number(r.reports), lastAt: Number(r.last_at), title: r.title, company: r.company })) });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- static front-end ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: PROD ? '1h' : 0, etag: true }));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'terms.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'Something went wrong.' });
});

const server = app.listen(PORT, () => console.log(`Burwinkle listening on :${PORT} (${PROD ? 'production' : 'development'})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => db.close().then(() => process.exit(0))); });
