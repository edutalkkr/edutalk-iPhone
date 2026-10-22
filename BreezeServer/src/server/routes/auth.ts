// BreezeServer 인증 관련 라우트

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { getDatabase } from '../../database';
import { auditLog } from '../middleware';
import { Teacher, AuthResult, LoginCredentials } from '../../shared/types';

const router = Router();

// 비밀번호 해시 생성
function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

// 비밀번호 검증
function verifyPassword(password: string, hash: string, salt: string): boolean {
  return hashPassword(password, salt) === hash;
}

// 로그인
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { schoolCode, employeeNumber, password }: LoginCredentials = req.body;

    if (!schoolCode || !employeeNumber || !password) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        message: '학교 코드, 교원번호, 비밀번호를 모두 입력해 주세요.',
      } as AuthResult);
      return;
    }

    const db = getDatabase();

    // 학교 코드 확인
    const settings = db.prepare('SELECT school_code FROM school_settings WHERE id = ?').get('default') as { school_code: string } | undefined;
    if (!settings || settings.school_code !== schoolCode) {
      await auditLog(
        'unknown',
        '알 수 없음',
        'failed_login',
        'teacher',
        employeeNumber,
        employeeNumber,
        `잘못된 학교 코드로 로그인 시도: ${schoolCode}`,
        req,
        'medium'
      );

      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: '학교 코드 또는 교원번호가 올바르지 않습니다.',
      } as AuthResult);
      return;
    }

    // 교사 조회
    const teacher = db.prepare(`
      SELECT t.*, d.name as department_name
      FROM teachers t
      LEFT JOIN departments d ON t.department_id = d.id
      WHERE t.employee_number = ?
    `).get(employeeNumber) as (Teacher & { department_name: string }) | undefined;

    if (!teacher) {
      await auditLog(
        'unknown',
        '알 수 없음',
        'failed_login',
        'teacher',
        employeeNumber,
        employeeNumber,
        `존재하지 않는 교원번호로 로그인 시도: ${employeeNumber}`,
        req,
        'medium'
      );

      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: '교원번호 또는 비밀번호가 올바르지 않습니다.',
      } as AuthResult);
      return;
    }

    // 계정 상태 확인
    if (teacher.status !== 'active') {
      await auditLog(
        teacher.id,
        teacher.name,
        'failed_login',
        'teacher',
        teacher.id,
        teacher.name,
        `비활성화된 계정으로 로그인 시도: ${teacher.status}`,
        req,
        'high'
      );

      res.status(403).json({
        success: false,
        error: 'Account disabled',
        message: '비활성화된 계정입니다. 관리자에게 문의하세요.',
      } as AuthResult);
      return;
    }

    // 비밀번호 검증
    if (!verifyPassword(password, teacher.password_hash, teacher.salt)) {
      await auditLog(
        teacher.id,
        teacher.name,
        'failed_login',
        'teacher',
        teacher.id,
        teacher.name,
        '비밀번호 불일치로 로그인 실패',
        req,
        'medium'
      );

      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: '교원번호 또는 비밀번호가 올바르지 않습니다.',
      } as AuthResult);
      return;
    }

    // 최신 버전 확인
    const latestVersion = db.prepare(`
      SELECT version FROM client_versions
      WHERE is_active = 1 AND platform = 'win32'
      ORDER BY build_number DESC LIMIT 1
    `).get() as { version: string } | undefined;

    // 토큰 생성 (간단한 JWT 대체)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // 세션 저장
    db.prepare(`
      INSERT INTO client_sessions (id, teacher_id, version, platform, ip_address, user_agent, status, last_seen, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      token,
      teacher.id,
      req.body.clientVersion || 'unknown',
      req.body.platform || 'win32',
      req.ip || 'unknown',
      req.headers['user-agent'] || 'unknown',
      'online',
      new Date().toISOString(),
      new Date().toISOString()
    );

    // 마지막 로그인 시간 업데이트
    db.prepare('UPDATE teachers SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), teacher.id);

    // 감사 로그
    await auditLog(
      teacher.id,
      teacher.name,
      'login',
      'teacher',
      teacher.id,
      teacher.name,
      '로그인 성공',
      req,
      'low',
      { version: req.body.clientVersion }
    );

    // 비밀번호 해시 제거 후 응답
    const { password_hash, salt, ...teacherSafe } = teacher;

    res.json({
      success: true,
      teacher: teacherSafe,
      token,
      requiresUpdate: latestVersion && req.body.clientVersion && req.body.clientVersion !== latestVersion.version,
      latestVersion: latestVersion?.version,
    } as AuthResult);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: '로그인 처리 중 오류가 발생했습니다.',
    } as AuthResult);
  }
});

// 로그아웃
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const db = getDatabase();

      const session = db.prepare('SELECT teacher_id FROM client_sessions WHERE id = ?').get(token) as { teacher_id: string } | undefined;

      if (session) {
        const teacher = db.prepare('SELECT name FROM teachers WHERE id = ?').get(session.teacher_id) as { name: string } | undefined;

        if (teacher) {
          await auditLog(
            session.teacher_id,
            teacher.name,
            'logout',
            'teacher',
            session.teacher_id,
            teacher.name,
            '로그아웃',
            req
          );
        }

        db.prepare('UPDATE client_sessions SET status = ?, last_seen = ? WHERE id = ?').run('offline', new Date().toISOString(), token);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 토큰 검증
router.get('/verify', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const db = getDatabase();

    const session = db.prepare(`
      SELECT cs.*, t.name, t.role, t.status, t.employee_number
      FROM client_sessions cs
      JOIN teachers t ON cs.teacher_id = t.id
      WHERE cs.id = ? AND cs.status = 'online'
    `).get(token) as { teacher_id: string; name: string; role: string; status: string; employee_number: string } | undefined;

    if (!session || session.status !== 'active') {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
      return;
    }

    // 세션 갱신
    db.prepare('UPDATE client_sessions SET last_seen = ? WHERE id = ?').run(new Date().toISOString(), token);

    res.json({
      success: true,
      teacher: {
        id: session.teacher_id,
        name: session.name,
        role: session.role,
        employeeNumber: session.employee_number,
      },
    });
  } catch (error) {
    console.error('Token verify error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 버전 체크 (클라이언트 첫 로그인 시 호출)
router.get('/version-check', async (req: Request, res: Response): Promise<void> => {
  try {
    const { currentVersion, platform = 'win32' } = req.query;
    const db = getDatabase();

    const latest = db.prepare(`
      SELECT * FROM client_versions
      WHERE is_active = 1 AND platform = ?
      ORDER BY build_number DESC LIMIT 1
    `).get(platform) as any;

    if (!latest) {
      res.json({
        success: true,
        hasUpdate: false,
        currentVersion,
        latestVersion: null,
      });
      return;
    }

    const hasUpdate = currentVersion && currentVersion !== latest.version;
    const isMandatory = latest.mandatory === 1;

    // 최소 지원 버전 체크
    const isSupported = !currentVersion || compareVersions(currentVersion as string, latest.min_supported_version) >= 0;

    res.json({
      success: true,
      hasUpdate,
      isMandatory,
      isSupported,
      currentVersion,
      latestVersion: latest.version,
      releaseNotes: latest.release_notes,
      downloadUrl: latest.download_url,
      fileSize: latest.file_size,
      sha256: latest.sha256,
      releasedAt: latest.released_at,
    });
  } catch (error) {
    console.error('Version check error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 버전 비교 헬퍼
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const maxLen = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) return p1 - p2;
  }
  return 0;
}

export default router;