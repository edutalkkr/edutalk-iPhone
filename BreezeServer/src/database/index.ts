// BreezeServer 데이터베이스 스키마 및 초기화

import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import * as crypto from 'crypto';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'breeze-server.db');
  db = new Database(dbPath);

  // WAL 모드 활성화 (동시성 향상)
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  initializeSchema(db);
  return db;
}

function initializeSchema(db: Database.Database): void {
  // 트랜잭션으로 스키마 생성
  const createTables = db.transaction(() => {
    // 학교 설정
    db.exec(`
      CREATE TABLE IF NOT EXISTS school_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        school_name TEXT NOT NULL DEFAULT '',
        school_code TEXT NOT NULL DEFAULT '',
        address TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        principal_name TEXT DEFAULT '',
        auto_update_enabled INTEGER DEFAULT 1,
        update_check_interval INTEGER DEFAULT 60,
        maintenance_mode INTEGER DEFAULT 0,
        max_file_size INTEGER DEFAULT 100,
        allowed_file_types TEXT DEFAULT '["pdf","doc","docx","xls","xlsx","ppt","pptx","hwp","hwpx","zip","jpg","png"]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 부서 테이블
    db.exec(`
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 교사 테이블
    db.exec(`
      CREATE TABLE IF NOT EXISTS teachers (
        id TEXT PRIMARY KEY,
        employee_number TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        department_id TEXT,
        position TEXT NOT NULL DEFAULT '교사',
        grade TEXT,
        class_no TEXT,
        role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('superadmin', 'admin', 'teacher')),
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
      );
    `);

    // 감사 로그 테이블 (Append-Only, 절대 삭제/수정 불가)
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        admin_name TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_name TEXT NOT NULL,
        detail TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
        metadata TEXT,
        hash TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 감사 로그 인덱스 (조회 성능)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_target_type ON audit_logs(target_type);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_hash_chain ON audit_logs(hash, previous_hash);
    `);

    // 클라이언트 버전 테이블
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_versions (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL UNIQUE,
        build_number INTEGER NOT NULL,
        release_notes TEXT NOT NULL DEFAULT '',
        download_url TEXT NOT NULL,
        mandatory INTEGER DEFAULT 0,
        min_supported_version TEXT NOT NULL,
        released_at TEXT NOT NULL DEFAULT (datetime('now')),
        file_size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'win32' CHECK (platform IN ('win32', 'darwin', 'linux')),
        is_active INTEGER DEFAULT 1
      );
    `);

    // 연결된 클라이언트 세션
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_sessions (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        version TEXT NOT NULL,
        platform TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT,
        socket_id TEXT,
        status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'away', 'offline')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
      );
    `);

    // 업데이트 배포 히스토리
    db.exec(`
      CREATE TABLE IF NOT EXISTS update_deployments (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL,
        deployed_by TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'all' CHECK (target_type IN ('all', 'online', 'offline', 'specific')),
        target_ids TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'rolled_back')),
        total_targets INTEGER DEFAULT 0,
        successful_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (version_id) REFERENCES client_versions(id) ON DELETE CASCADE,
        FOREIGN KEY (deployed_by) REFERENCES teachers(id) ON DELETE RESTRICT
      );
    `);

    // 메시지 테이블 (Append-Only 구조)
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        recipient_ids TEXT NOT NULL, -- JSON 배열
        type TEXT NOT NULL CHECK (type IN ('memo', 'chat', 'notice', 'urgent')),
        title TEXT,
        body TEXT NOT NULL,
        importance TEXT NOT NULL DEFAULT 'normal' CHECK (importance IN ('normal', 'urgent', 'ref')),
        attachments TEXT, -- JSON 배열
        read_receipts TEXT DEFAULT '[]', -- JSON 배열: {teacherId, readAt}
        is_deleted INTEGER DEFAULT 0, -- 소프트 삭제만 허용
        deleted_by TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (sender_id) REFERENCES teachers(id) ON DELETE RESTRICT,
        FOREIGN KEY (deleted_by) REFERENCES teachers(id) ON DELETE SET NULL
      );
    `);

    // 파일 전송 테이블
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_transfers (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        recipient_ids TEXT NOT NULL, -- JSON 배열
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'transferring', 'completed', 'failed', 'cancelled')),
        progress INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (sender_id) REFERENCES teachers(id) ON DELETE RESTRICT
      );
    `);

    // 기본 데이터 삽입
    insertDefaultData(db);
  });

  createTables();
}

function insertDefaultData(db: Database.Database): void {
  // 기본 학교 설정 확인
  const settings = db.prepare('SELECT * FROM school_settings WHERE id = ?').get('default');
  if (!settings) {
    db.prepare(`
      INSERT INTO school_settings (id, school_name, school_code, created_at, updated_at)
      VALUES ('default', '', '', datetime('now'), datetime('now'))
    `).run();
  }

  // 기본 부서 확인
  const deptCount = db.prepare('SELECT COUNT(*) as count FROM departments').get() as { count: number };
  if (deptCount.count === 0) {
    const defaultDepartments = [
      { id: 'dept-1', name: '교무실', code: 'academic', sortOrder: 1 },
      { id: 'dept-2', name: '행정실', code: 'admin', sortOrder: 2 },
      { id: 'dept-3', name: '1학년부', code: 'grade1', sortOrder: 3 },
      { id: 'dept-4', name: '2학년부', code: 'grade2', sortOrder: 4 },
      { id: 'dept-5', name: '3학년부', code: 'grade3', sortOrder: 5 },
      { id: 'dept-6', name: '특수부', code: 'special', sortOrder: 6 },
      { id: 'dept-7', name: '보건실', code: 'health', sortOrder: 7 },
      { id: 'dept-8', name: '급식실', code: 'cafeteria', sortOrder: 8 },
    ];

    const insertDept = db.prepare(`
      INSERT INTO departments (id, name, code, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    for (const dept of defaultDepartments) {
      insertDept.run(dept.id, dept.name, dept.code, dept.sortOrder);
    }
  }

  // 기본 슈퍼 관리자 계정 확인 (비밀번호: breeze123!)
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM teachers WHERE role = ?').get('superadmin') as { count: number };
  if (adminCount.count === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync('breeze123!', salt, 100000, 64, 'sha512').toString('hex');

    db.prepare(`
      INSERT INTO teachers (id, employee_number, name, department_id, position, role, password_hash, salt, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('teacher-superadmin', '000000', '시스템관리자', 'dept-1', '관리자', 'superadmin', hash, salt, 'active');
  }
}

// 감사 로그 해시 체인 생성
export function createAuditHash(log: Omit<AuditLog, 'hash' | 'previousHash'>, previousHash: string): { hash: string; previousHash: string } {
  const data = `${log.id}${log.adminId}${log.action}${log.targetType}${log.targetId}${log.detail}${log.ipAddress}${log.createdAt}${previousHash}`;
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return { hash, previousHash };
}

// 감사 로그 무결성 검증
export function verifyAuditChain(db: Database.Database): { valid: boolean; brokenAt?: string } {
  const logs = db.prepare(`
    SELECT id, hash, previous_hash FROM audit_logs ORDER BY created_at ASC
  `).all() as { id: string; hash: string; previous_hash: string }[];

  let previousHash = '0'.repeat(64); // 제네시스 해시

  for (const log of logs) {
    if (log.previous_hash !== previousHash) {
      return { valid: false, brokenAt: log.id };
    }
    previousHash = log.hash;
  }

  return { valid: true };
}

// 데이터베이스 백업
export function backupDatabase(backupPath: string): void {
  const db = getDatabase();
  db.backup(backupPath);
}

// 데이터베이스 종료
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}