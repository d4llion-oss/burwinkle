// Storage layer. Uses Postgres when DATABASE_URL is set (DigitalOcean Managed
// Postgres / App Platform), otherwise a SQLite file under DATA_DIR (Droplet).
// Both speak the same small interface: run / get / all with `?` placeholders.

import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS stories (
     id         TEXT PRIMARY KEY,
     company    TEXT NOT NULL,
     company_key TEXT NOT NULL,
     who        TEXT NOT NULL,
     title      TEXT NOT NULL,
     body       TEXT NOT NULL DEFAULT '',
     author     TEXT NOT NULL,
     example    INTEGER NOT NULL DEFAULT 0,
     created_at BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS stories_created ON stories (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS stories_company ON stories (company_key)`,
  `CREATE TABLE IF NOT EXISTS votes (
     user_id    TEXT NOT NULL,
     story_id   TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     PRIMARY KEY (user_id, story_id)
   )`,
  `CREATE INDEX IF NOT EXISTS votes_story ON votes (story_id)`,
  `CREATE TABLE IF NOT EXISTS reports (
     id         TEXT PRIMARY KEY,
     story_id   TEXT NOT NULL,
     user_id    TEXT NOT NULL,
     reason     TEXT NOT NULL DEFAULT '',
     created_at BIGINT NOT NULL
   )`,
];

async function openSqlite() {
  const { default: Database } = await import('better-sqlite3');
  const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'burwinkle.sqlite');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const s of SCHEMA) db.exec(s);
  return {
    kind: 'sqlite',
    file,
    async run(sql, params = []) { db.prepare(sql).run(params); },
    async get(sql, params = []) { return db.prepare(sql).get(params) || null; },
    async all(sql, params = []) { return db.prepare(sql).all(params); },
    async close() { db.close(); },
  };
}

async function openPostgres(url) {
  const { default: pg } = await import('pg');
  // Managed databases (DigitalOcean included) use TLS with a provider CA.
  // Prefer verifying against that CA when it is supplied (DATABASE_CA_CERT,
  // bindable in App Platform as ${db-name.CA_CERT}); otherwise accept the
  // provider certificate without chain verification. The sslmode parameter is
  // stripped from the URL so the explicit ssl config below always wins.
  const wantsSsl = /sslmode=(require|verify-ca|verify-full|prefer)/.test(url) || process.env.PGSSL === '1';
  const cleanUrl = url.replace(/([?&])sslmode=[^&]*&?/, (m, p) => (m.endsWith('&') ? p : '')).replace(/[?&]$/, '');
  const ca = process.env.DATABASE_CA_CERT;
  const ssl = wantsSsl ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }) : undefined;
  const pool = new pg.Pool({ connectionString: cleanUrl, ssl, max: 10 });
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  for (const s of SCHEMA) await pool.query(s);
  return {
    kind: 'postgres',
    async run(sql, params = []) { await pool.query(toPg(sql), params); },
    async get(sql, params = []) { const r = await pool.query(toPg(sql), params); return r.rows[0] || null; },
    async all(sql, params = []) { const r = await pool.query(toPg(sql), params); return r.rows; },
    async close() { await pool.end(); },
  };
}

export async function openDatabase() {
  const url = process.env.DATABASE_URL;
  return url ? openPostgres(url) : openSqlite();
}
