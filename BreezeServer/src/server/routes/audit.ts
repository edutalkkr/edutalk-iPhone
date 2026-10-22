// BreezeServer 감사 로그 라우트

import { Router, Request, Response } from 'express';
import { getDatabase } from '../../database';
import { verifyAuditChain } from '../../database';
import { AuditLog, AuditAction, AuditTargetType } from '../../shared/types';

const router = Router();

// 미들웨어: 관리자 권한 확인 (슈퍼어드민만 감사 로그 조회 가능)
function requireSuperAdmin(req: Request, res: Response, next: Function): void {
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

  if (!session || session.role !== 'superadmin') {
    res.status(403).json({ success: false, error: 'Superadmin access required' });
    return;
  }

  (req as any).adminId = session.teacher_id;
  next();
}

// 감사 로그 조회 (페이징, 필터링)
router.get('/', requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const {
      adminId,
      action,
      targetType,
      riskLevel,
      startDate,
      endDate,
      search,
      page = '1',
      limit = '100',
    } = req.query;

    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: any[] = [];

    if (adminId) {
      query += ' AND admin_id = ?';
      params.push(adminId);
    }
    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }
    if (targetType) {
      query += ' AND target_type = ?';
      params.push(targetType);
    }
    if (riskLevel) {
      query += ' AND risk_level = ?';
      params.push(riskLevel);
    }
    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }
    if (search) {
      query += ' AND (admin_name LIKE ? OR target_name LIKE ? OR detail LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC';

    const offset = (Number(page) - 1) * Number(limit);
    query += ' LIMIT ? OFFSET ?';
    params.push(Number(limit), offset);

    const logs = db.prepare(query).all(...params) as AuditLog[];

    // 총 개수
    let countQuery = 'SELECT COUNT(*) as count FROM audit_logs WHERE 1=1';
    const countParams: any[] = [];
    if (adminId) { countQuery += ' AND admin_id = ?'; countParams.push(adminId); }
    if (action) { countQuery += ' AND action = ?'; countParams.push(action); }
    if (targetType) { countQuery += ' AND target_type = ?'; countParams.push(targetType); }
    if (riskLevel) { countQuery += ' AND risk_level = ?'; countParams.push(riskLevel); }
    if (startDate) { countQuery += ' AND created_at >= ?'; countParams.push(startDate); }
    if (endDate) { countQuery += ' AND created_at <= ?'; countParams.push(endDate); }
    if (search) { countQuery += ' AND (admin_name LIKE ? OR target_name LIKE ? OR detail LIKE ?)'; countParams.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    const total = db.prepare(countQuery).get(...countParams) as { count: number };

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: total.count,
        totalPages: Math.ceil(total.count / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 감사 로그 무결성 검증
router.get('/verify', requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const result = verifyAuditChain(db);

    // 상세 정보도 함께 반환
    const logCount = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as { count: number };
    const firstLog = db.prepare('SELECT id, created_at FROM audit_logs ORDER BY created_at ASC LIMIT 1').get() as { id: string; created_at: string } | undefined;
    const lastLog = db.prepare('SELECT id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 1').get() as { id: string; created_at: string } | undefined;

    res.json({
      success: true,
      valid: result.valid,
      brokenAt: result.brokenAt,
      stats: {
        totalLogs: logCount.count,
        firstLog,
        lastLog,
      },
    });
  } catch (error) {
    console.error('Verify audit chain error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 감사 로그 내보내기 (CSV)
router.get('/export', requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const { startDate, endDate } = req.query;

    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: any[] = [];

    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY created_at ASC';

    const logs = db.prepare(query).all(...params) as AuditLog[];

    // CSV 헤더
    const headers = [
      'ID', '관리자ID', '관리자명', '액션', '대상타입', '대상ID', '대상명',
      '상세내용', 'IP주소', 'User-Agent', '위험도', '메타데이터', '해시', '이전해시', '생성일시'
    ];

    // CSV 행 생성
    const rows = logs.map(log => [
      log.id,
      log.adminId,
      log.adminName,
      log.action,
      log.targetType,
      log.targetId,
      log.targetName,
      log.detail.replace(/"/g, '""'),
      log.ipAddress,
      log.userAgent,
      log.riskLevel,
      log.metadata ? JSON.stringify(log.metadata).replace(/"/g, '""') : '',
      log.hash,
      log.previousHash,
      log.createdAt,
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');

    // 감사 로그 내보내기 기록
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get((req as any).adminId) as { name: string } | undefined;
    await auditLog(
      (req as any).adminId,
      admin?.name || '관리자',
      'audit_log_export',
      'audit_log',
      'all',
      '전체 감사 로그',
      `감사 로그 CSV 내보내기 (${logs.length}건)`,
      req,
      'medium',
      { count: logs.length, startDate, endDate }
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send('\uFEFF' + csv); // BOM 추가로 엑셀에서 한글 깨짐 방지
  } catch (error) {
    console.error('Export audit logs error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 액션 목록 조회 (필터용)
router.get('/actions/list', requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();

    const actions = db.prepare(`
      SELECT DISTINCT action, COUNT(*) as count
      FROM audit_logs
      GROUP BY action
      ORDER BY count DESC
    `).all() as { action: string; count: number }[];

    const targetTypes = db.prepare(`
      SELECT DISTINCT target_type, COUNT(*) as count
      FROM audit_logs
      GROUP BY target_type
      ORDER BY count DESC
    `).all() as { target_type: string; count: number }[];

    const riskLevels = db.prepare(`
      SELECT DISTINCT risk_level, COUNT(*) as count
      FROM audit_logs
      GROUP BY risk_level
      ORDER BY
        CASE risk_level
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END
    `).all() as { risk_level: string; count: number }[];

    const admins = db.prepare(`
      SELECT DISTINCT admin_id, admin_name, COUNT(*) as count
      FROM audit_logs
      GROUP BY admin_id, admin_name
      ORDER BY count DESC
    `).all() as { admin_id: string; admin_name: string; count: number }[];

    res.json({
      success: true,
      data: { actions, targetTypes, riskLevels, admins },
    });
  } catch (error) {
    console.error('Get audit actions error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;