// BreezeServer 부서 관리 라우트

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { getDatabase } from '../../database';
import { auditLog } from '../middleware';
import { Department } from '../../shared/types';

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
  next();
}

// 부서 목록 조회
router.get('/', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const departments = db.prepare(`
      SELECT d.*,
        COUNT(t.id) as teacher_count
      FROM departments d
      LEFT JOIN teachers t ON d.id = t.department_id AND t.status = 'active'
      GROUP BY d.id
      ORDER BY d.sort_order
    `).all() as (Department & { teacher_count: number })[];

    res.json({ success: true, data: departments });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 부서 생성
router.post('/', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const { name, code, sortOrder } = req.body;

    if (!name || !code) {
      res.status(400).json({ success: false, error: 'Missing required fields', message: '부서명과 코드는 필수입니다.' });
      return;
    }

    const db = getDatabase();

    // 코드 중복 확인
    const existing = db.prepare('SELECT id FROM departments WHERE code = ?').get(code);
    if (existing) {
      res.status(409).json({ success: false, error: 'Duplicate code', message: '이미 존재하는 부서 코드입니다.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO departments (id, name, code, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, code, sortOrder || 0, now, now);

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'department_create',
      'department',
      id,
      name,
      `부서 생성: ${name} (${code})`,
      req,
      'low'
    );

    const newDept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as Department;
    res.status(201).json({ success: true, data: newDept });
  } catch (error) {
    console.error('Create department error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 부서 수정
router.patch('/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const { id } = req.params;
    const { name, code, sortOrder } = req.body;

    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as Department | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }

    // 코드 중복 확인 (자신 제외)
    if (code && code !== existing.code) {
      const duplicate = db.prepare('SELECT id FROM departments WHERE code = ? AND id != ?').get(code, id);
      if (duplicate) {
        res.status(409).json({ success: false, error: 'Duplicate code', message: '이미 존재하는 부서 코드입니다.' });
        return;
      }
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (code !== undefined) { updates.push('code = ?'); params.push(code); }
    if (sortOrder !== undefined) { updates.push('sort_order = ?'); params.push(sortOrder); }

    if (updates.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    db.prepare(`UPDATE departments SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'department_update',
      'department',
      id,
      existing.name,
      `부서 정보 수정: ${JSON.stringify(req.body)}`,
      req,
      'low',
      { before: existing, after: req.body }
    );

    const updated = db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as Department;
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Update department error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 부서 삭제
router.delete('/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const { id } = req.params;

    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as Department | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }

    // 소속 교사 확인
    const teacherCount = db.prepare('SELECT COUNT(*) as count FROM teachers WHERE department_id = ?').get(id) as { count: number };
    if (teacherCount.count > 0) {
      res.status(400).json({
        success: false,
        error: 'Department has teachers',
        message: '소속 교사가 있어 삭제할 수 없습니다. 먼저 교사를 다른 부서로 이동시켜 주세요.',
      });
      return;
    }

    db.prepare('DELETE FROM departments WHERE id = ?').run(id);

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'department_delete',
      'department',
      id,
      existing.name,
      `부서 삭제: ${existing.name} (${existing.code})`,
      req,
      'medium'
    );

    res.json({ success: true, message: '부서가 삭제되었습니다.' });
  } catch (error) {
    console.error('Delete department error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;