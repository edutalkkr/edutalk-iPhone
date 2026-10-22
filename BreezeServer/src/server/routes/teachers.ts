// BreezeServer 교사 관리 라우트

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { getDatabase } from '../../database';
import { auditLog } from '../middleware';
import { Teacher } from '../../shared/types';

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

// 교사 목록 조회
router.get('/', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const { departmentId, status, role, search, page = '1', limit = '50' } = req.query;

    let query = `
      SELECT t.*, d.name as department_name
      FROM teachers t
      LEFT JOIN departments d ON t.department_id = d.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (departmentId) {
      query += ' AND t.department_id = ?';
      params.push(departmentId);
    }
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    if (role) {
      query += ' AND t.role = ?';
      params.push(role);
    }
    if (search) {
      query += ' AND (t.name LIKE ? OR t.employee_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY d.sort_order, t.name';

    const offset = (Number(page) - 1) * Number(limit);
    query += ' LIMIT ? OFFSET ?';
    params.push(Number(limit), offset);

    const teachers = db.prepare(query).all(...params) as (Teacher & { department_name: string })[];

    // 총 개수
    let countQuery = 'SELECT COUNT(*) as count FROM teachers t WHERE 1=1';
    const countParams: any[] = [];
    if (departmentId) { countQuery += ' AND t.department_id = ?'; countParams.push(departmentId); }
    if (status) { countQuery += ' AND t.status = ?'; countParams.push(status); }
    if (role) { countQuery += ' AND t.role = ?'; countParams.push(role); }
    if (search) { countQuery += ' AND (t.name LIKE ? OR t.employee_number LIKE ?)'; countParams.push(`%${search}%`, `%${search}%`); }

    const total = db.prepare(countQuery).get(...countParams) as { count: number };

    // 비밀번호 해시 제거
    const safeTeachers = teachers.map(({ password_hash, salt, ...t }) => t);

    res.json({
      success: true,
      data: safeTeachers,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: total.count,
        totalPages: Math.ceil(total.count / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 교사 상세 조회
router.get('/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const teacher = db.prepare(`
      SELECT t.*, d.name as department_name
      FROM teachers t
      LEFT JOIN departments d ON t.department_id = d.id
      WHERE t.id = ?
    `).get(req.params.id) as (Teacher & { department_name: string }) | undefined;

    if (!teacher) {
      res.status(404).json({ success: false, error: 'Teacher not found' });
      return;
    }

    const { password_hash, salt, ...teacherSafe } = teacher;
    res.json({ success: true, data: teacherSafe });
  } catch (error) {
    console.error('Get teacher error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 교사 생성
router.post('/', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole;
    const { employeeNumber, name, departmentId, position, grade, classNo, role, password } = req.body;

    // 필수 필드 검증
    if (!employeeNumber || !name || !password) {
      res.status(400).json({ success: false, error: 'Missing required fields', message: '교원번호, 이름, 비밀번호는 필수입니다.' });
      return;
    }

    // 슈퍼어드민만 관리자 역할 생성 가능
    if (role && role !== 'teacher' && adminRole !== 'superadmin') {
      res.status(403).json({ success: false, error: 'Only superadmin can create admin accounts' });
      return;
    }

    const db = getDatabase();

    // 교원번호 중복 확인
    const existing = db.prepare('SELECT id FROM teachers WHERE employee_number = ?').get(employeeNumber);
    if (existing) {
      res.status(409).json({ success: false, error: 'Duplicate employee number', message: '이미 존재하는 교원번호입니다.' });
      return;
    }

    // 비밀번호 해시
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO teachers (id, employee_number, name, department_id, position, grade, class_no, role, password_hash, salt, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, employeeNumber, name, departmentId || null, position || '교사', grade || null, classNo || null, role || 'teacher', passwordHash, salt, 'active', now, now);

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'teacher_create',
      'teacher',
      id,
      name,
      `교사 계정 생성: ${employeeNumber} ${name} (${role || 'teacher'})`,
      req,
      'medium',
      { employeeNumber, departmentId, position, role }
    );

    const newTeacher = db.prepare(`
      SELECT t.*, d.name as department_name
      FROM teachers t
      LEFT JOIN departments d ON t.department_id = d.id
      WHERE t.id = ?
    `).get(id) as (Teacher & { department_name: string });

    const { password_hash, salt: _, ...teacherSafe } = newTeacher;
    res.status(201).json({ success: true, data: teacherSafe });
  } catch (error) {
    console.error('Create teacher error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 교사 수정
router.patch('/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole;
    const { id } = req.params;
    const { name, departmentId, position, grade, classNo, role, status } = req.body;

    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id) as Teacher | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Teacher not found' });
      return;
    }

    // 자기 자신 강등 방지
    if (id === adminId && role && role !== existing.role) {
      res.status(400).json({ success: false, error: 'Cannot change own role' });
      return;
    }

    // 슈퍼어드민만 관리자 역할 변경 가능
    if (role && role !== 'teacher' && role !== existing.role && adminRole !== 'superadmin') {
      res.status(403).json({ success: false, error: 'Only superadmin can change admin roles' });
      return;
    }

    // 마지막 슈퍼어드민 보호
    if (existing.role === 'superadmin' && role !== 'superadmin') {
      const superadminCount = db.prepare('SELECT COUNT(*) as count FROM teachers WHERE role = ?').get('superadmin') as { count: number };
      if (superadminCount.count <= 1) {
        res.status(400).json({ success: false, error: 'At least one superadmin required' });
        return;
      }
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (departmentId !== undefined) { updates.push('department_id = ?'); params.push(departmentId || null); }
    if (position !== undefined) { updates.push('position = ?'); params.push(position); }
    if (grade !== undefined) { updates.push('grade = ?'); params.push(grade || null); }
    if (classNo !== undefined) { updates.push('class_no = ?'); params.push(classNo || null); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }

    if (updates.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    db.prepare(`UPDATE teachers SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      role && role !== existing.role ? 'role_change' : 'teacher_update',
      'teacher',
      id,
      existing.name,
      `교사 정보 수정: ${JSON.stringify(req.body)}`,
      req,
      role ? 'high' : 'medium',
      { before: existing, after: req.body }
    );

    const updated = db.prepare(`
      SELECT t.*, d.name as department_name
      FROM teachers t
      LEFT JOIN departments d ON t.department_id = d.id
      WHERE t.id = ?
    `).get(id) as (Teacher & { department_name: string });

    const { password_hash, salt, ...teacherSafe } = updated;
    res.json({ success: true, data: teacherSafe });
  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 교사 삭제 (소프트 삭제 - 비활성화)
router.delete('/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole;
    const { id } = req.params;
    const { permanent } = req.query; // 영구 삭제는 superadmin만 가능

    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id) as Teacher | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Teacher not found' });
      return;
    }

    // 자기 자신 삭제 방지
    if (id === adminId) {
      res.status(400).json({ success: false, error: 'Cannot delete own account' });
      return;
    }

    // 슈퍼어드민 삭제 방지 (다른 슈퍼어드민만 가능)
    if (existing.role === 'superadmin' && adminRole !== 'superadmin') {
      res.status(403).json({ success: false, error: 'Only superadmin can delete superadmin' });
      return;
    }

    // 영구 삭제 요청 시 superadmin만 가능
    if (permanent === 'true' && adminRole !== 'superadmin') {
      res.status(403).json({ success: false, error: 'Only superadmin can permanently delete' });
      return;
    }

    if (permanent === 'true') {
      // 관련 데이터 확인
      const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE sender_id = ?').get(id) as { count: number };
      const sessionCount = db.prepare('SELECT COUNT(*) as count FROM client_sessions WHERE teacher_id = ?').get(id) as { count: number };

      if (messageCount.count > 0 || sessionCount.count > 0) {
        res.status(400).json({
          success: false,
          error: 'Cannot permanently delete teacher with related data',
          message: '메시지나 세션 기록이 있어 영구 삭제할 수 없습니다. 비활성화만 가능합니다.',
        });
        return;
      }

      db.prepare('DELETE FROM teachers WHERE id = ?').run(id);
    } else {
      // 소프트 삭제 (비활성화)
      db.prepare('UPDATE teachers SET status = ?, updated_at = ? WHERE id = ?').run('inactive', new Date().toISOString(), id);
    }

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      permanent === 'true' ? 'teacher_delete' : 'teacher_suspend',
      'teacher',
      id,
      existing.name,
      permanent === 'true' ? `교사 계정 영구 삭제: ${existing.employee_number} ${existing.name}` : `교사 계정 비활성화: ${existing.employee_number} ${existing.name}`,
      req,
      'critical',
      { permanent: permanent === 'true', employeeNumber: existing.employeeNumber }
    );

    res.json({ success: true, message: permanent === 'true' ? '영구 삭제되었습니다.' : '비활성화되었습니다.' });
  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 비밀번호 재설정 (관리자)
router.post('/:id/reset-password', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req as any).adminId;
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ success: false, error: 'Password too short', message: '비밀번호는 8자 이상이어야 합니다.' });
      return;
    }

    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id) as Teacher | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: 'Teacher not found' });
      return;
    }

    // 슈퍼어드민 비밀번호 변경 제한
    if (existing.role === 'superadmin' && (req as any).adminRole !== 'superadmin') {
      res.status(403).json({ success: false, error: 'Only superadmin can reset superadmin password' });
      return;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.pbkdf2Sync(newPassword, salt, 100000, 64, 'sha512').toString('hex');

    db.prepare('UPDATE teachers SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?').run(passwordHash, salt, new Date().toISOString(), id);

    // 기존 세션 무효화
    db.prepare('UPDATE client_sessions SET status = ? WHERE teacher_id = ?').run('offline', id);

    // 감사 로그
    const admin = db.prepare('SELECT name FROM teachers WHERE id = ?').get(adminId) as { name: string } | undefined;
    await auditLog(
      adminId,
      admin?.name || '관리자',
      'teacher_update',
      'teacher',
      id,
      existing.name,
      `비밀번호 강제 재설정`,
      req,
      'high'
    );

    res.json({ success: true, message: '비밀번호가 재설정되었습니다. 사용자에게 새 비밀번호를 전달해 주세요.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 부서별 교사 수 통계
router.get('/stats/by-department', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getDatabase();

    const stats = db.prepare(`
      SELECT d.id, d.name, d.code,
        COUNT(t.id) as total,
        SUM(CASE WHEN t.status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN t.role = 'admin' THEN 1 ELSE 0 END) as admins,
        SUM(CASE WHEN t.role = 'superadmin' THEN 1 ELSE 0 END) as superadmins
      FROM departments d
      LEFT JOIN teachers t ON d.id = t.department_id
      GROUP BY d.id, d.name, d.code
      ORDER BY d.sort_order
    `).all() as any[];

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Teacher stats error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;