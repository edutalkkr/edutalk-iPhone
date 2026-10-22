// BreezeServer OTA 업데이트 관리 라우트

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getDatabase } from '../../database';
import { auditLog } from '../middleware';
import { ClientVersion, UpdateManifest } from '../../shared/types';

const router = Router();

// 미들웨어: 관리자 권한 확인
function requireAdmin(req: Request, res: Response, next: Function): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'No token provided' });
    return;
  }

  const token = authHeader.substring(7);
  const db = getDatabase();

  const session = db.prepare(`
    SELECT cs.teacher_id, t.role
    FROM client_sessions cs
    JOIN teachers t ON cs.teacher_id = t.id
    WHERE cs.id = ? AND cs.status = 'online'
  `).get(token) as { teacher_id: string; role: string } | undefined;

  if (!session || !['superadmin', 'admin'].includes(session.role)) {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }

  (req as any).adminId = session.teacher_id;
  (req as any).adminRole = session.role;
  next();
}

// 업데이트 매니페스트 조회 (클라이언트용 - 인증 불필요)
router.get('/manifest', async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const { platform = 'win32' } = req.query;

    const versions = db.prepare(`
      SELECT * FROM client_versions
      WHERE is_active = 1 AND platform = ?
      ORDER BY build_number DESC
    `).all(platform) as any[];

    if (versions.length === 0) {
      res.json({
        success: true,
        latestVersion: null,
        minSupportedVersion: null,
        versions: [],
      } as UpdateManifest);
      return;
    }

    const latest = versions[0];
    const manifest: UpdateManifest = {
      latestVersion: latest.version,
      minSupportedVersion: latest.min_supported_version,
      versions: versions.map(v => ({
        id: v.id,
        version: v.version,
        buildNumber: v.build_number,
        releaseNotes: v.release_notes,
        downloadUrl: v.download_url,
        mandatory: v.mandatory === 1,
        minSupportedVersion: v.min_supported_version,
        releasedAt: v.released_at,
        fileSize: v.file_size,
        sha256: v.sha256,
        platform: v.platform,
      })),
    };

    res.json({ success: true, ...manifest });
  } catch (error) {
    console.error('Get manifest error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 버전 목록 조회 (관리자용)
router.get('/', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const { platform } = req.query;

    let query = 'SELECT * FROM client_versions WHERE 1=1';
    const params: any[] = [];

    if (platform) {
      query += ' AND platform = ?';
      params.push(platform);
    }

    query += ' ORDER BY build_number DESC';

    const versions = db.prepare(query).all(...params) as any[];

    res.json({
      success: true,
      data: versions.map(v => ({
        ...v,
        mandatory: v.mandatory === 1,
        isActive: v.is_active === 1,
      })),
    });
  } catch (error) {
    console.error('Get versions error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 새 버전 업로드 (파일 업로드)
router.post('/upload', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole;
    const { version, buildNumber, releaseNotes, mandatory, minSupportedVersion, platform = 'win32' } = req.body;
    const file = (req as any).file;

    if (!file) {
      res.status(400).json({ success: false, error: 'No file uploaded', message: '업데이트 파일을 업로드해 주세요.' });
      return;
    }

    if (!version || !buildNumber) {
      res.status(400).json({ success: false, error: 'Missing required fields', message: '버전과 빌드 번호는 필수입니다.' });
      return;
    }

    const db = getDatabase();

    // 버전 중복 확인
    const existing = db.prepare('SELECT id FROM client_versions WHERE version = ? AND platform = ?').get(version, platform);
    if (existing) {
      // 업로드된 파일 삭제
      fs.unlinkSync(file.path);
      res.status(409).json({ success: false, error: 'Duplicate version', message: '이미 존재하는 버전입니다.' });
      return;
    }

    // SHA256 계산
    const fileBuffer = fs.readFileSync(file.path);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const fileSize = fileBuffer.length;

    // 파일 이동 (업데이트 저장소로)
    const updatesDir = path.join(process.cwd(), 'resources', 'updates', platform);
    if (!fs.existsSync(updatesDir)) {
      fs.mkdirSync(updatesDir, { recursive: true });
    }

    const fileName = `breeze-${version}-${platform}.exe`;
    const destPath = path.join(updatesDir, fileName);
    fs.copyFileSync(file.path, destPath);
    fs.unlinkSync(file.path); // 임시 파일 삭제

    const downloadUrl = `/updates/${platform}/${fileName}`;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO client_versions (id, version, build_number, release_notes, download_url, mandatory, min_supported_version, released_at, file_size, sha256, platform, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      version,
      Number(buildNumber),
      releaseNotes || '',
      downloadUrl,
      mandatory ? 1 : 0,
      minSupportedVersion || '1.0.0',
      now,
      fileSize,
      sha256,
      platform,
      1,
      now
    );

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'update_upload',
      'update',
      id,
      version,
      `업데이트 파일 업로드: v${version} (빌드 ${buildNumber})`,
      req,
      'medium',
      { version, buildNumber, fileSize, sha256, platform }
    );

    res.status(201).json({
      success: true,
      data: {
        id,
        version,
        buildNumber: Number(buildNumber),
        releaseNotes,
        downloadUrl,
        mandatory: !!mandatory,
        minSupportedVersion: minSupportedVersion || '1.0.0',
        releasedAt: now,
        fileSize,
        sha256,
        platform,
      },
    });
  } catch (error) {
    console.error('Upload update error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 버전 활성화/비활성화
router.patch('/:id/toggle', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const { id } = req.params;
    const { isActive } = req.body;

    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM client_versions WHERE id = ?').get(id) as any | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Version not found' });
      return;
    }

    // 마지막 활성 버전 비활성화 방지
    if (!isActive) {
      const activeCount = db.prepare('SELECT COUNT(*) as count FROM client_versions WHERE is_active = 1 AND platform = ?').get(existing.platform) as { count: number };
      if (activeCount.count <= 1) {
        res.status(400).json({ success: false, error: 'At least one active version required' });
        return;
      }
    }

    db.prepare('UPDATE client_versions SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      isActive ? 'update_deploy' : 'update_rollback',
      'update',
      id,
      existing.version,
      `버전 ${isActive ? '활성화' : '비활성화'}: v${existing.version}`,
      req,
      'medium'
    );

    res.json({ success: true, message: isActive ? '활성화되었습니다.' : '비활성화되었습니다.' });
  } catch (error) {
    console.error('Toggle version error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 버전 삭제
router.delete('/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole;
    const { id } = req.params;

    // 슈퍼어드민만 삭제 가능
    if (adminRole !== 'superadmin') {
      res.status(403).json({ success: false, error: 'Only superadmin can delete versions' });
      return;
    }

    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM client_versions WHERE id = ?').get(id) as any | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Version not found' });
      return;
    }

    // 활성 버전 삭제 방지
    if (existing.is_active === 1) {
      res.status(400).json({ success: false, error: 'Cannot delete active version', message: '활성화된 버전은 삭제할 수 없습니다. 먼저 비활성화해 주세요.' });
      return;
    }

    // 파일 삭제
    const filePath = path.join(process.cwd(), existing.download_url);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.prepare('DELETE FROM client_versions WHERE id = ?').run(id);

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'update_rollback',
      'update',
      id,
      existing.version,
      `업데이트 버전 삭제: v${existing.version}`,
      req,
      'high'
    );

    res.json({ success: true, message: '버전이 삭제되었습니다.' });
  } catch (error) {
    console.error('Delete version error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 업데이트 배포 (온라인 사용자에게 푸시)
router.post('/deploy', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const { versionId, targetType = 'online', targetIds } = req.body;

    const db = getDatabase();

    const version = db.prepare('SELECT * FROM client_versions WHERE id = ? AND is_active = 1').get(versionId) as any | undefined;
    if (!version) {
      res.status(404).json({ success: false, error: 'Active version not found' });
      return;
    }

    // 대상 클라이언트 조회
    let targetSessions: any[] = [];

    if (targetType === 'online') {
      targetSessions = db.prepare(`
        SELECT cs.*, t.name as teacher_name, t.employee_number
        FROM client_sessions cs
        JOIN teachers t ON cs.teacher_id = t.id
        WHERE cs.status = 'online'
      `).all();
    } else if (targetType === 'all') {
      targetSessions = db.prepare(`
        SELECT cs.*, t.name as teacher_name, t.employee_number
        FROM client_sessions cs
        JOIN teachers t ON cs.teacher_id = t.id
      `).all();
    } else if (targetType === 'specific' && targetIds?.length) {
      const placeholders = targetIds.map(() => '?').join(',');
      targetSessions = db.prepare(`
        SELECT cs.*, t.name as teacher_name, t.employee_number
        FROM client_sessions cs
        JOIN teachers t ON cs.teacher_id = t.id
        WHERE cs.teacher_id IN (${placeholders})
      `).all(...targetIds);
    }

    // 배포 기록 생성
    const deploymentId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO update_deployments (id, version_id, deployed_by, target_type, target_ids, status, total_targets, started_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deploymentId,
      versionId,
      adminId,
      targetType,
      targetIds ? JSON.stringify(targetIds) : null,
      'in_progress',
      targetSessions.length,
      now,
      now
    );

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'update_deploy',
      'update',
      deploymentId,
      version.version,
      `업데이트 배포 시작: v${version.version} (${targetSessions.length}명 대상)`,
      req,
      'high',
      { versionId, targetType, targetCount: targetSessions.length }
    );

    // Socket.io로 실시간 푸시 (main process에서 처리)
    // 여기서는 배포 시작만 기록하고, 실제 푸시는 main process에서 수행

    res.json({
      success: true,
      data: {
        deploymentId,
        version: version.version,
        targetCount: targetSessions.length,
        message: `${targetSessions.length}명의 온라인 사용자에게 업데이트 알림을 전송합니다.`,
      },
    });
  } catch (error) {
    console.error('Deploy update error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 배포 히스토리 조회
router.get('/deployments/history', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const { page = '1', limit = '20' } = req.query;

    const deployments = db.prepare(`
      SELECT ud.*, cv.version, cv.build_number, t.name as deployed_by_name
      FROM update_deployments ud
      JOIN client_versions cv ON ud.version_id = cv.id
      JOIN teachers t ON ud.deployed_by = t.id
      ORDER BY ud.created_at DESC
      LIMIT ? OFFSET ?
    `).all(Number(limit), (Number(page) - 1) * Number(limit)) as any[];

    const total = db.prepare('SELECT COUNT(*) as count FROM update_deployments').get() as { count: number };

    res.json({
      success: true,
      data: deployments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: total.count,
        totalPages: Math.ceil(total.count / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get deployments error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;