'use strict';
/* 교내 간이 전자결재 — /api/approvals
 *
 *  · 교사가 품의(제목·분류·금액·내용)를 올리면 관리자에게 실시간 알림이 간다.
 *  · 관리자는 [승인] 또는 [반려]를 누르고, 승인 시 계정 이름으로 전자서명한다.
 *    (전자서명 해시 = 결재 ID + 승인자 + 서명 + 승인시각, DB에 함께 보관)
 *  · 내가 올린 결재는 내가 승인할 수 없다. 학생 계정은 접근할 수 없다.
 *  · 본문은 감사 로그에 남기지 않고, 생성·승인·반려·취소 사실만 남긴다.
 */
const express = require('express');
const crypto = require('crypto');
const { row, all, run } = require('../db');
const { writeAudit } = require('../audit');

const CATEGORIES = new Set(['supplies', 'meeting', 'after_school', 'event', 'general']);
const STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
const TITLE_MAX = 120;
const CONTENT_MAX = 10000;
const AMOUNT_MAX = 1000000000;

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanMultiline(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function localTs() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function isAdmin(user) {
  return String((user && user.role) || '').toUpperCase() === 'ADMIN';
}

function rowToApproval(r, viewer) {
  const requesterId = Number(r.requester_id);
  const viewerId = Number(viewer && viewer.id);
  const status = String(r.status || 'PENDING');
  return {
    id: Number(r.id),
    requesterId,
    requesterName: String(r.requester_name || ''),
    title: String(r.title || ''),
    category: String(r.category || 'general'),
    amount: Number(r.amount) || 0,
    content: String(r.content || ''),
    status,
    approverId: r.approver_id == null ? null : Number(r.approver_id),
    approverName: String(r.approver_name || ''),
    signature: String(r.signature || ''),
    signatureHash: String(r.signature_hash || ''),
    decisionNote: String(r.decision_note || ''),
    decidedAt: r.decided_at ? String(r.decided_at) : '',
    createdAt: String(r.created_at || ''),
    updatedAt: String(r.updated_at || ''),
    isMine: requesterId === viewerId,
    canDecide: isAdmin(viewer) && status === 'PENDING' && requesterId !== viewerId,
  };
}

function emitAdmins(io, event, payload) {
  try {
    if (!io) return;
    all("SELECT id FROM users WHERE role = 'ADMIN'").forEach((u) => {
      io.to('user:' + u.id).emit(event, payload);
    });
  } catch (e) { /* 알림 실패는 결재를 막지 않는다 */ }
}

function emitUser(io, userId, event, payload) {
  try {
    if (!io || userId == null) return;
    io.to('user:' + Number(userId)).emit(event, payload);
  } catch (e) { /* 알림 실패는 결재를 막지 않는다 */ }
}

module.exports = function createApprovalsRouter({ needAuth, needStaff, writeLimiter, getIo }) {
  const router = express.Router();
  const limitWrite = typeof writeLimiter === 'function' ? writeLimiter : (req, res, next) => next();
  router.use(needAuth);
  if (needStaff) router.use(needStaff);

  /* GET /api/approvals?scope=mine|all&status=PENDING */
  router.get('/', (req, res) => {
    try {
      const wantsAll = String(req.query.scope || '') === 'all' && isAdmin(req.user);
      const status = String(req.query.status || '').toUpperCase();
      const where = [];
      const params = [];
      if (!wantsAll) { where.push('requester_id = ?'); params.push(req.user.id); }
      if (STATUSES.has(status)) { where.push('status = ?'); params.push(status); }
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
      const sql =
        `SELECT * FROM approvals ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, id DESC LIMIT ?`;
      const rows = all(sql, ...params, limit);
      res.json({ ok: true, approvals: rows.map((r) => rowToApproval(r, req.user)), scope: wantsAll ? 'all' : 'mine' });
    } catch (e) {
      console.error('[approvals] list error:', e);
      res.status(500).json({ ok: false, error: '결재 목록을 불러오지 못했어요.' });
    }
  });

  /* POST /api/approvals — 새 품의 올리기 */
  router.post('/', limitWrite, (req, res) => {
    try {
      const body = req.body || {};
      const title = cleanText(body.title, TITLE_MAX);
      const content = cleanMultiline(body.content, CONTENT_MAX);
      const category = CATEGORIES.has(String(body.category)) ? String(body.category) : 'general';
      const amountRaw = String(body.amount == null ? '0' : body.amount).replace(/[^\d.-]/g, '');
      const amount = Math.max(0, Math.min(AMOUNT_MAX, Math.round(Number(amountRaw) || 0)));
      if (!title) return res.status(400).json({ ok: false, error: '결재 제목을 적어 주세요.' });
      if (!content) return res.status(400).json({ ok: false, error: '결재 내용을 적어 주세요.' });

      const r = run(
        `INSERT INTO approvals (requester_id, requester_name, title, category, amount, content, status)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
        req.user.id,
        String(req.user.real_name || req.user.username || ''),
        title,
        category,
        amount,
        content
      );
      const id = Number(r.lastInsertRowid);
      const saved = rowToApproval(row('SELECT * FROM approvals WHERE id = ?', id), req.user);
      writeAudit(req, req.user, 'approval_create', 'approval', id, { category, amount });
      emitAdmins(getIo && getIo(), 'approval:new', {
        id, title, requesterName: saved.requesterName, amount, createdAt: saved.createdAt,
      });
      res.json({ ok: true, approval: saved });
    } catch (e) {
      console.error('[approvals] create error:', e);
      res.status(500).json({ ok: false, error: '결재를 올리지 못했어요.' });
    }
  });

  /* GET /api/approvals/:id — 신청자 또는 관리자 */
  router.get('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: '결재 번호가 올바르지 않아요.' });
      const hit = row('SELECT * FROM approvals WHERE id = ?', id);
      if (!hit) return res.status(404).json({ ok: false, error: '결재를 찾지 못했어요.' });
      if (Number(hit.requester_id) !== Number(req.user.id) && !isAdmin(req.user)) {
        return res.status(403).json({ ok: false, error: '이 결재를 볼 권한이 없어요.' });
      }
      res.json({ ok: true, approval: rowToApproval(hit, req.user) });
    } catch (e) {
      res.status(500).json({ ok: false, error: '결재를 불러오지 못했어요.' });
    }
  });

  /* POST /api/approvals/:id/decide — 관리자 승인/반려 + 전자서명 */
  router.post('/:id/decide', limitWrite, (req, res) => {
    try {
      if (!isAdmin(req.user)) return res.status(403).json({ ok: false, error: '관리자만 결재를 승인할 수 있어요.' });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: '결재 번호가 올바르지 않아요.' });
      const body = req.body || {};
      const action = String(body.action || '').toLowerCase();
      if (action !== 'approve' && action !== 'reject') {
        return res.status(400).json({ ok: false, error: '승인 또는 반려를 선택해 주세요.' });
      }
      const hit = row('SELECT * FROM approvals WHERE id = ?', id);
      if (!hit) return res.status(404).json({ ok: false, error: '결재를 찾지 못했어요.' });
      if (Number(hit.requester_id) === Number(req.user.id)) {
        return res.status(403).json({ ok: false, error: '내가 올린 결재는 내가 승인할 수 없어요.' });
      }
      if (String(hit.status) !== 'PENDING') {
        return res.status(409).json({ ok: false, error: '이미 처리된 결재예요.' });
      }
      const signature = cleanText(body.signature, 40) || String(req.user.real_name || req.user.username || '');
      if (signature.length < 2) return res.status(400).json({ ok: false, error: '전자서명 이름을 확인해 주세요.' });
      const note = cleanText(body.note, 300);
      const decidedAt = localTs();
      const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
      const signatureHash = crypto
        .createHash('sha256')
        .update(`${id}|${req.user.id}|${signature}|${status}|${decidedAt}`)
        .digest('hex');
      const r = run(
        `UPDATE approvals
         SET status = ?, approver_id = ?, approver_name = ?, signature = ?, signature_hash = ?,
             decision_note = ?, decided_at = ?, updated_at = datetime('now','localtime')
         WHERE id = ? AND status = 'PENDING'`,
        status,
        req.user.id,
        String(req.user.real_name || req.user.username || ''),
        signature,
        signatureHash,
        note,
        decidedAt,
        id
      );
      if (!Number(r.changes)) {
        return res.status(409).json({ ok: false, error: '다른 관리자가 먼저 처리했어요. 목록을 새로 고쳐 주세요.' });
      }
      const saved = rowToApproval(row('SELECT * FROM approvals WHERE id = ?', id), req.user);
      writeAudit(req, req.user, action === 'approve' ? 'approval_approve' : 'approval_reject', 'approval', id, {
        requesterId: Number(hit.requester_id), signatureHash,
      });
      emitUser(getIo && getIo(), hit.requester_id, 'approval:decided', {
        id, status, approverName: saved.approverName, decidedAt,
      });
      emitAdmins(getIo && getIo(), 'approval:changed', { id, status, approverName: saved.approverName, decidedAt });
      res.json({ ok: true, approval: saved });
    } catch (e) {
      console.error('[approvals] decide error:', e);
      res.status(500).json({ ok: false, error: '결재를 처리하지 못했어요.' });
    }
  });

  /* POST /api/approvals/:id/cancel — 신청자가 대기 중인 결재를 취소 */
  router.post('/:id/cancel', limitWrite, (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: '결재 번호가 올바르지 않아요.' });
      const hit = row('SELECT * FROM approvals WHERE id = ?', id);
      if (!hit) return res.status(404).json({ ok: false, error: '결재를 찾지 못했어요.' });
      if (Number(hit.requester_id) !== Number(req.user.id)) {
        return res.status(403).json({ ok: false, error: '내가 올린 결재만 취소할 수 있어요.' });
      }
      if (String(hit.status) !== 'PENDING') {
        return res.status(409).json({ ok: false, error: '이미 처리된 결재는 취소할 수 없어요.' });
      }
      const r = run(
        `UPDATE approvals
         SET status = 'CANCELLED', decision_note = '신청자가 취소했어요.',
             updated_at = datetime('now','localtime')
         WHERE id = ? AND status = 'PENDING'`,
        id
      );
      if (!Number(r.changes)) return res.status(409).json({ ok: false, error: '이미 처리된 결재예요.' });
      const saved = rowToApproval(row('SELECT * FROM approvals WHERE id = ?', id), req.user);
      writeAudit(req, req.user, 'approval_cancel', 'approval', id, {});
      emitAdmins(getIo && getIo(), 'approval:changed', { id, status: 'CANCELLED', approverName: '', decidedAt: '' });
      res.json({ ok: true, approval: saved });
    } catch (e) {
      res.status(500).json({ ok: false, error: '결재를 취소하지 못했어요.' });
    }
  });

  return router;
};
