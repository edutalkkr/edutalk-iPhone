'use strict';
/* EduTalk on-premise DB (node:sqlite, built-in — no native build, exe-friendly) */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// exe(pkg)로 묶이면 __dirname이 가상 경로라 쓰기가 안 된다. 그때는 exe 옆 폴더를 쓴다.
// Electron GUI에서는 EDUTALK_HOME(사용자 데이터 폴더)을 쓴다.
function APP_ROOT(){
  try{
    if(process.env.EDUTALK_HOME) return process.env.EDUTALK_HOME;
    if(typeof process !== 'undefined' && process.pkg && process.execPath){
      return path.dirname(process.execPath);
    }
  }catch(e){}
  return __dirname;
}

const DATA_DIR = process.env.EDUTALK_DATA_DIR || path.join(APP_ROOT(), 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

const DB_PATH = process.env.EDUTALK_DB_PATH || path.join(DATA_DIR, 'edutalk.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER NULL REFERENCES departments(id) ON DELETE SET NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  department_id INTEGER NULL REFERENCES departments(id) ON DELETE SET NULL,
  username TEXT NOT NULL UNIQUE,
  real_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OFFLINE',
  status_message TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'TEACHER',
  is_paid_dual_network INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  network_type TEXT NOT NULL DEFAULT 'INTERNAL',
  member_ids TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  is_notice INTEGER NOT NULL DEFAULT 0,
  is_recalled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS message_reads (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NULL REFERENCES messages(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL DEFAULT '',
  stored_filename TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS polls (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  q TEXT NOT NULL DEFAULT '',
  opts TEXT NOT NULL DEFAULT '[]',
  closed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS poll_votes (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choices TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  done_by_name TEXT NOT NULL DEFAULT '',
  created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_todos_room ON todos(room_id, id);
CREATE TABLE IF NOT EXISTS attendance (
  roomId TEXT NOT NULL,
  date TEXT NOT NULL,
  open INTEGER NOT NULL DEFAULT 1,
  byUid INTEGER NULL,
  byName TEXT NOT NULL DEFAULT '',
  present TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (roomId, date)
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);
CREATE INDEX IF NOT EXISTS idx_reads_user ON message_reads(user_id);
/* 변조 방지용 시스템 KV: trial 시작일·setup 완료일을 파일+DB 이중 보관 (파일 삭제 리셋 방지) */
CREATE TABLE IF NOT EXISTS system_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL DEFAULT ''
);
`);

const VALID_STATUS = new Set(['ONLINE', 'IN_CLASS', 'TRIP', 'AWAY', 'OFFLINE']);
const VALID_ROLES = new Set(['ADMIN', 'TEACHER', 'STAFF']);

function row(q, ...p) { try { return db.prepare(q).get(...p) || null; } catch (e) { return null; } }
function all(q, ...p) { try { return db.prepare(q).all(...p); } catch (e) { return []; } }
function run(q, ...p) { return db.prepare(q).run(...p); }

/* 시스템 KV (없으면 '' 반환) */
function getKV(k) {
  try {
    const r = db.prepare('SELECT v FROM system_kv WHERE k = ?').get(String(k));
    return r ? String(r.v) : '';
  } catch (e) { return ''; }
}
function setKV(k, v) {
  try { db.prepare('INSERT OR REPLACE INTO system_kv (k, v) VALUES (?, ?)').run(String(k), String(v)); } catch (e) {}
}

function counts() {
  return {
    users: (row('SELECT COUNT(*) c FROM users') || {}).c || 0,
    departments: (row('SELECT COUNT(*) c FROM departments') || {}).c || 0,
    rooms: (row('SELECT COUNT(*) c FROM rooms') || {}).c || 0,
    messages: (row('SELECT COUNT(*) c FROM messages') || {}).c || 0,
    files: (row('SELECT COUNT(*) c FROM files') || {}).c || 0,
  };
}

/* 만료 파일 정리: expires_at < now → 실제 파일 삭제 + DB 삭제. 삭제된 개수를 반환 */
function purgeExpiredFiles(uploadsDir) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const rows = all('SELECT id, stored_filename FROM files WHERE expires_at < ?', now);
  let n = 0;
  for (const r of rows) {
    try { if (r.stored_filename) fs.unlinkSync(path.join(uploadsDir, path.basename(r.stored_filename))); } catch (e) {}
    try { run('DELETE FROM files WHERE id = ?', r.id); n++; } catch (e) {}
  }
  return n;
}

module.exports = {
  db, row, all, run, counts, purgeExpiredFiles,
  VALID_STATUS, VALID_ROLES, DATA_DIR, DB_PATH, APP_ROOT,
  getKV, setKV,
};
