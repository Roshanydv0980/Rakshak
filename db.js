const Database = require('better-sqlite3');
const db = new Database(process.env.DB_FILE || 'data.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS contacts(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS locations(
  id INTEGER PRIMARY KEY, token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
  lat REAL NOT NULL, lng REAL NOT NULL, acc REAL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_loc_token ON locations(token, ts);
`);
module.exports = db;
