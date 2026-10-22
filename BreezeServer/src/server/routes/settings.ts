// BreezeServer 설정 및 상태 라우트

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { getDatabase } from '../../database';
import { auditLog } from '../middleware';
import { SchoolSettings } from '../../shared/types';

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

// 학교 설정 조회
router.get('/school', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const settings = db.prepare('SELECT * FROM school_settings WHERE id = ?').get('default') as SchoolSettings | undefined;

    if (!settings) {
      res.status(404).json({ success: false, error: 'Settings not found' });
      return;
    }

    // allowed_file_types 파싱
    let allowedFileTypes: string[] = [];
    try {
      allowedFileTypes = JSON.parse(settings.allowed_file_types);
    } catch {
      allowedFileTypes = [];
    }

    res.json({
      success: true,
      data: {
        ...settings,
        auto_update_enabled: settings.auto_update_enabled === 1,
        maintenance_mode: settings.maintenance_mode === 1,
        allowed_file_types: allowedFileTypes,
      },
    });
  } catch (error) {
    console.error('Get school settings error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 학교 설정 수정
router.patch('/school', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const {
      schoolName,
      schoolCode,
      address,
      phone,
      principalName,
      autoUpdateEnabled,
      updateCheckInterval,
      maintenanceMode,
      maxFileSize,
      allowedFileTypes,
    } = req.body;

    const db = getDatabase();

    const updates: string[] = [];
    const params: any[] = [];

    if (schoolName !== undefined) { updates.push('school_name = ?'); params.push(schoolName); }
    if (schoolCode !== undefined) { updates.push('school_code = ?'); params.push(schoolCode); }
    if (address !== undefined) { updates.push('address = ?'); params.push(address); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (principalName !== undefined) { updates.push('principal_name = ?'); params.push(principalName); }
    if (autoUpdateEnabled !== undefined) { updates.push('auto_update_enabled = ?'); params.push(autoUpdateEnabled ? 1 : 0); }
    if (updateCheckInterval !== undefined) { updates.push('update_check_interval = ?'); params.push(updateCheckInterval); }
    if (maintenanceMode !== undefined) { updates.push('maintenance_mode = ?'); params.push(maintenanceMode ? 1 : 0); }
    if (maxFileSize !== undefined) { updates.push('max_file_size = ?'); params.push(maxFileSize); }
    if (allowedFileTypes !== undefined) { updates.push('allowed_file_types = ?'); params.push(JSON.stringify(allowedFileTypes)); }

    if (updates.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());

    db.prepare(`UPDATE school_settings SET ${updates.join(', ')} WHERE id = ?`).run(...params, 'default');

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'settings_update',
      'school_settings',
      'default',
      '학교 설정',
      `학교 설정 변경: ${JSON.stringify(req.body)}`,
      req,
      'medium',
      { changes: req.body }
    );

    const updated = db.prepare('SELECT * FROM school_settings WHERE id = ?').get('default') as SchoolSettings;
    let allowedFileTypesParsed: string[] = [];
    try {
      allowedFileTypesParsed = JSON.parse(updated.allowed_file_types);
    } catch {
      allowedFileTypesParsed = [];
    }

    res.json({
      success: true,
      data: {
        ...updated,
        auto_update_enabled: updated.auto_update_enabled === 1,
        maintenance_mode: updated.maintenance_mode === 1,
        allowed_file_types: allowedFileTypesParsed,
      },
    });
  } catch (error) {
    console.error('Update school settings error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 서버 상태 조회
router.get('/status', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();

    const [
      totalTeachers,
      activeTeachers,
      totalDepartments,
      onlineClients,
      latestVersion,
      currentVersion,
    ] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM teachers').get() as Promise<{ count: number }>,
      db.prepare('SELECT COUNT(*) as count FROM teachers WHERE status = ?').get('active') as Promise<{ count: number }>,
      db.prepare('SELECT COUNT(*) as count FROM departments').get() as Promise<{ count: number }>,
      db.prepare('SELECT COUNT(*) as count FROM client_sessions WHERE status = ?').get('online') as Promise<{ count: number }>,
      db.prepare('SELECT version FROM client_versions WHERE is_active = 1 AND platform = ? ORDER BY build_number DESC LIMIT 1').get('win32') as Promise<{ version: string } | undefined>,
      db.prepare('SELECT version FROM client_versions WHERE is_active = 1 AND platform = ? ORDER BY build_number DESC LIMIT 1').get('win32') as Promise<{ version: string } | undefined>,
    ]);

    // 디스크 사용량
    const { execSync } = await import('child_process');
    let diskUsage = { used: 0, total: 0, percentage: 0 };
    try {
      const output = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf-8' });
      const lines = output.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const free = parseInt(parts[0]) || 0;
          const total = parseInt(parts[1]) || 0;
          if (total > 0) {
            diskUsage.total += total;
            diskUsage.used += (total - free);
          }
        }
      }
      diskUsage.percentage = diskUsage.total > 0 ? Math.round((diskUsage.used / diskUsage.total) * 100) : 0;
    } catch {
      // 무시
    }

    // 메모리 사용량
    const memUsage = process.memoryUsage();
    const totalMem = require('os').totalmem();

    res.json({
      success: true,
      data: {
        status: 'running',
        uptime: process.uptime(),
        connectedClients: onlineClients.count,
        totalTeachers: totalTeachers.count,
        activeTeachers: activeTeachers.count,
        totalDepartments: totalDepartments.count,
        diskUsage,
        memoryUsage: {
          used: memUsage.heapUsed,
          total: totalMem,
          percentage: Math.round((memUsage.heapUsed / totalMem) * 100),
        },
        currentVersion: currentVersion?.version || '1.0.0',
        latestVersion: latestVersion?.version || '1.0.0',
      },
    });
  } catch (error) {
    console.error('Get server status error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 서버 재시작
router.post('/restart', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const db = getDatabase();

    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'system_restart',
      'system',
      'server',
      '브리즈서버',
      '서버 재시작 요청',
      req,
      'high'
    );

    res.json({ success: true, message: '서버를 재시작합니다.' });

    // 약간의 지연 후 재시작 (응답이 전달될 시간 확보)
    setTimeout(() => {
      process.exit(0); // electron-updater나 PM 등이 재시작 처리
    }, 1000);
  } catch (error) {
    console.error('Restart server error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 서버 종료
router.post('/shutdown', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const db = getDatabase();

    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'system_shutdown',
      'system',
      'server',
      '브리즈서버',
      '서버 종료 요청',
      req,
      'critical'
    );

    res.json({ success: true, message: '서버를 종료합니다.' });

    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (error) {
    console.error('Shutdown server error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 데이터베이스 백업
router.post('/backup', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const db = getDatabase();

    const backupDir = path.join(process.cwd(), 'resources', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = path.join(backupDir, `breeze-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);

    // 백업 실행 (better-sqlite3의 backup API 사용)
    const sourceDb = getDatabase();
    const backupDb = new (await import('better-sqlite3')).default(backupPath);
    sourceDb.backup(backupDb);
    backupDb.close();

    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'backup_create',
      'system',
      backupPath,
      '데이터베이스 백업',
      `데이터베이스 백업 생성: ${path.basename(backupPath)}`,
      req,
      'medium'
    );

    res.json({ success: true, message: '백업이 완료되었습니다.', path: backupPath });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

import * as fs from 'fs';
import * as path from 'path';

export default router;