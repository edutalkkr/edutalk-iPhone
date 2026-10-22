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

/* ===== 쪽지(이메일형) — 5단계-1. 설계서: docs/NOTES_BACKEND_DESIGN.md ===== */
CREATE TABLE IF NOT EXISTS notes (
  id              INTEGER PRIMARY KEY,
  client_note_id  TEXT UNIQUE,                 /* 멱등 키: 같은 쪽지 재전송 방지 (NULL 허용) */
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT '',
  content         TEXT NOT NULL DEFAULT '',
  audience        TEXT NOT NULL DEFAULT 'USER'
                  CHECK (audience IN ('ALL','DEPT','GRADE','USER')),   /* 전교/부서/학년/개별 */
  target_key      TEXT NOT NULL DEFAULT '',    /* DEPT=부서명|ID, GRADE=학년(예: '1학년') */
  status          TEXT NOT NULL DEFAULT 'SENT'
                  CHECK (status IN ('SENT','CANCELLED')),              /* CANCELLED는 예약 필드 */
  cancelled_at    TEXT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notes_sender ON notes(sender_id, id DESC);

CREATE TABLE IF NOT EXISTS note_recipients (
  note_id        INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  recipient_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL DEFAULT 'USER'
                 CHECK (recipient_type IN ('ALL','DEPT','GRADE','USER','CC','BCC')),
                 /* ALL/DEPT/GRADE/USER = 받는사람, CC = 참조, BCC = 숨은참조 */
  is_read        INTEGER NOT NULL DEFAULT 0,
  read_at        TEXT NULL,
  PRIMARY KEY (note_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_note_recipients_inbox
  ON note_recipients(recipient_id, is_read, note_id DESC);

/* 감사 로그 (Append-Only): 관리자·시스템 동작 기록. 설계서 §2.4 */
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id      INTEGER PRIMARY KEY,
  actor_id    TEXT NOT NULL DEFAULT '',        /* 'users.id' 문자열, 시스템은 'system' */
  actor_name  TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,                   /* note_send | note_cancel | login | ... */
  target_type TEXT NOT NULL DEFAULT '',        /* memo | user | room | settings | ... */
  target_id   TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '{}',      /* JSON 부가 정보 */
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor   ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action  ON audit_logs(action);

/* Append-Only 강제: 수정/삭제 시도는 DB 트리거가 차단한다 */
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

/* AI 3줄 요약 캐시 — Gemini 호출은 서버에서 공지당 딱 1회, 교사 앱은 DB에서 즉시(수 ms) 읽는다.
 *  · cache_key: 민감정보 마스킹을 끝낸 본문의 SHA-256 앞 32자리 (같은 공지 = 같은 키)
 *  · lines: 3줄 요약 JSON 배열 · source: gemini | local
 *  · masked_count: 저장 전에 *** 처리한 개인정보 패턴 수 (응답·감사에 사용) */
CREATE TABLE IF NOT EXISTS ai_summaries (
  id           INTEGER PRIMARY KEY,
  cache_key    TEXT NOT NULL UNIQUE,
  lines        TEXT NOT NULL DEFAULT '[]',
  source       TEXT NOT NULL DEFAULT 'local',
  model        TEXT NOT NULL DEFAULT '',
  masked_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ai_summaries_key ON ai_summaries(cache_key);

/* 시스템 정책 KV(2) — 서버 설정·정책 값을 한 곳에서 읽는다.
 *  (예: retentionYears=3 · recallMinutes=7 · uploadMaxMB=500 · forceUpdate=0)
 *  system_kv 테이블은 위(변조 방지용 시스템 KV)에서 이미 만들어진다. */

/* 학사일정·급식 캐시 — 나이스 Open API 호출 결과를 잠시 보관해 재호출을 줄인다.
 *  key = 'meal:YYYYMMDD' | 'schedule:YYYY-MM-DD:YYYY-MM-DD' · value = JSON 문자열 */
CREATE TABLE IF NOT EXISTS school_cache (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

/* 보안 인쇄 대기열 — 개인정보 보호 가상 프린트 (Killer ①)
 *  · 문서는 인쇄 요청 즉시 종이로 나가지 않고 여기(서버)에 보관된다.
 *  · 교사가 인쇄실/공용 PC의 브리즈 앱에서 [출력 승인]을 눌러야 실제 인쇄가 된다.
 *  · content: 인쇄할 본문(일반 텍스트, 최대 200KB) — 시험지·성적표 유출을 원천 차단. */
CREATE TABLE IF NOT EXISTS print_jobs (
  id          INTEGER PRIMARY KEY,
  owner_id    TEXT NOT NULL DEFAULT '',
  owner_name  TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING','RELEASED','CANCELLED')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  released_by TEXT NOT NULL DEFAULT '',
  released_at TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, id DESC);

/* ===== 2026-10 차세대 기능 =====
 *  · consultation_logs: 교사 상담 일지 (작성자·관리자만 열람)
 *  · approvals: 교내 간이 전자결재 (관리자 승인 + 전자서명 해시)
 *  · whiteboards: 실시간 협업 보드 (좌석·모둠·감독 배치 JSON)
 * 원문 상담 내용은 AI로 보내기 전에 서버에서 민감정보를 마스킹한다. */
CREATE TABLE IF NOT EXISTS consultation_logs (
  id            INTEGER PRIMARY KEY,
  author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_name   TEXT NOT NULL DEFAULT '',
  student_name  TEXT NOT NULL DEFAULT '',
  contact_type  TEXT NOT NULL DEFAULT 'student'
                CHECK (contact_type IN ('student','parent','guardian','other')),
  topic         TEXT NOT NULL DEFAULT '',
  raw_text      TEXT NOT NULL DEFAULT '',
  summary_json  TEXT NOT NULL DEFAULT '{}',
  source        TEXT NOT NULL DEFAULT 'local',
  masked_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_consult_author ON consultation_logs(author_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_consult_created ON consultation_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS approvals (
  id              INTEGER PRIMARY KEY,
  requester_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_name  TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT 'general'
                  CHECK (category IN ('supplies','meeting','after_school','event','general')),
  amount          INTEGER NOT NULL DEFAULT 0,
  content         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  approver_id     INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  approver_name   TEXT NOT NULL DEFAULT '',
  signature       TEXT NOT NULL DEFAULT '',
  signature_hash  TEXT NOT NULL DEFAULT '',
  decision_note   TEXT NOT NULL DEFAULT '',
  decided_at      TEXT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_approvals_requester ON approvals(requester_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, id DESC);

CREATE TABLE IF NOT EXISTS whiteboards (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL DEFAULT 'seating'
                  CHECK (kind IN ('seating','groups','supervision','free')),
  data            TEXT NOT NULL DEFAULT '{}',
  version         INTEGER NOT NULL DEFAULT 1,
  created_by      INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  updated_by_name TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_whiteboards_updated ON whiteboards(updated_at DESC);
`);

/* 기존 DB 마이그레이션 — CREATE TABLE IF NOT EXISTS는 새 컬럼을 추가하지 않는다. */
try { db.exec("ALTER TABLE approvals ADD COLUMN decision_note TEXT NOT NULL DEFAULT ''"); } catch (e) { /* 이미 있음 */ }

const VALID_STATUS = new Set(['ONLINE', 'IN_CLASS', 'TRIP', 'AWAY', 'OFFLINE']);
const VALID_ROLES = new Set(['ADMIN', 'TEACHER', 'STAFF', 'STUDENT']);

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
