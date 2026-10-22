'use strict';
/* 보안 인쇄 대기열 — 개인정보 보호 가상 프린트 (Killer ①)
 *
 *  왜: 교무실 공용 프린터는 시험지·성적표·가정환경 조사서가 그대로 쌓여 나간다.
 *      브리즈에서는 문서가 바로 인쇄되지 않고 이 대기열(서버 DB)에 보관되고,
 *      교사가 인쇄실/공용 PC의 브리즈 앱에서 [출력]을 눌러야 종이로 나온다.
 *
 *  계약 (모두 로그인 필요, 응답은 {ok:...}):
 *   POST   /api/print/jobs           { title, content } → 대기열에 넣기
 *   GET    /api/print/jobs           → { pending: [...], recent: [...] }
 *   POST   /api/print/jobs/:id/release → { job } 내용을 내려주고 RELEASED 처리 (출력 승인)
 *   DELETE /api/print/jobs/:id       → 대기 취소 (본인 또는 ADMIN)
 *
 *  · content 는 일반 텍스트(최대 200KB)만 다룬다 — 바이너리 문서는 클라우드/메일 사용.
 *  · 개인정보 보호가 목적이므로 보관은 30일 뒤 자동 삭제(아래 정리 로직)된다. */
const express = require('express');
const { row, all, run } = require('../db');

const CONTENT_MAX = 200 * 1024;
const LIST_MAX = 100;

function safeJob(r) {
  return {
    id: Number(r.id),
    ownerId: String(r.owner_id || ''),
    ownerName: String(r.owner_name || ''),
    title: String(r.title || ''),
    status: String(r.status || 'PENDING'),
    createdAt: String(r.created_at || ''),
    releasedBy: String(r.released_by || ''),
    releasedAt: r.released_at ? String(r.released_at) : null,
    bytes: Buffer.byteLength(String(r.content || ''), 'utf8'),
  };
}

function clientIp(req) {
  try {
    return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '') || 'unknown';
  } catch (e) { return 'unknown'; }
}

module.exports = function createPrintRouter({ needAuth, needStaff }) {
  const router = express.Router();
  router.use(needAuth);
  if (needStaff) router.use(needStaff);

  function audit(req, action, job, detail) {
    try {
      run(
        `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        String((req.user && req.user.id) != null ? req.user.id : 'system'),
        String((req.user && req.user.real_name) || ''),
        String(action), 'print', String(job && job.id != null ? job.id : ''),
        JSON.stringify(detail || {}), clientIp(req)
      );
    } catch (e) { /* 감사 실패는 본 동작을 막지 않는다 */ }
  }

  /* 대기열에 넣기 — 인쇄 요청 즉시 종이가 나가지 않는다 */
  router.post('/jobs', (req, res) => {
    try {
      const body = req.body || {};
      const title = String(body.title || '').trim().slice(0, 80) || '(제목 없음)';
      const content = String(body.content || '');
      if (!content.trim()) return res.status(400).json({ ok: false, error: '인쇄할 내용이 비어 있어요.' });
      if (Buffer.byteLength(content, 'utf8') > CONTENT_MAX) {
        return res.status(413).json({ ok: false, error: '한 번에 보낼 수 있는 양(200KB)을 넘었어요. 문서를 나눠 보내 주세요.' });
      }
      const r = run(
        `INSERT INTO print_jobs (owner_id, owner_name, title, content) VALUES (?, ?, ?, ?)`,
        String(req.user.id), String(req.user.real_name || ''), title, content
      );
      const job = row('SELECT * FROM print_jobs WHERE id = ?', Number(r.lastInsertRowid));
      audit(req, 'print_submit', job, { title, bytes: Buffer.byteLength(content, 'utf8') });
      res.json({ ok: true, job: safeJob(job) });
    } catch (e) {
      console.error('[print] submit error:', e);
      res.status(500).json({ ok: false, error: '인쇄 대기열에 넣지 못했어요.' });
    }
  });

  /* 대기 목록 + 최근 처리 내역 (공용 PC에서 열어 승인한다) */
  router.get('/jobs', (req, res) => {
    try {
      const pending = all(
        `SELECT * FROM print_jobs WHERE status = 'PENDING' ORDER BY id ASC LIMIT ${LIST_MAX}`
      ).map(safeJob);
      const recent = all(
        `SELECT * FROM print_jobs WHERE status <> 'PENDING' ORDER BY id DESC LIMIT 20`
      ).map(safeJob);
      res.json({ ok: true, pending, recent, maxBytes: CONTENT_MAX });
    } catch (e) {
      res.status(500).json({ ok: false, error: '대기열을 불러오지 못했어요.' });
    }
  });

  /* [출력] — 내용을 내려주고 RELEASED 로 바꾼다. 실제 인쇄는 이 PC(인쇄실) 브라우저가 담당. */
  router.post('/jobs/:id/release', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ ok: false, error: '잘못된 요청이에요.' });
      const job = row('SELECT * FROM print_jobs WHERE id = ?', id);
      if (!job) return res.status(404).json({ ok: false, error: '없는 인쇄물이에요.' });
      if (job.status !== 'PENDING') return res.status(409).json({ ok: false, error: '이미 처리된 인쇄물이에요.' });
      run(
        `UPDATE print_jobs SET status = 'RELEASED', released_by = ?, released_at = datetime('now','localtime') WHERE id = ?`,
        String(req.user.real_name || ''), id
      );
      audit(req, 'print_release', job, { title: job.title });
      const upd = row('SELECT * FROM print_jobs WHERE id = ?', id);
      res.json({ ok: true, job: { ...safeJob(upd), content: String(job.content || '') } });
    } catch (e) {
      res.status(500).json({ ok: false, error: '출력 처리에 실패했어요.' });
    }
  });

  /* 대기 취소 — 본인 것 또는 관리자 (이미 나간 것은 취소 불가) */
  router.delete('/jobs/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const job = row('SELECT * FROM print_jobs WHERE id = ?', id);
      if (!job) return res.status(404).json({ ok: false, error: '없는 인쇄물이에요.' });
      if (job.status !== 'PENDING') return res.status(409).json({ ok: false, error: '이미 처리된 인쇄물이에요.' });
      const isOwner = String(job.owner_id) === String(req.user.id);
      if (!isOwner && req.user.role !== 'ADMIN') {
        return res.status(403).json({ ok: false, error: '내가 보낸 인쇄물만 취소할 수 있어요.' });
      }
      run(`UPDATE print_jobs SET status = 'CANCELLED', released_by = ?, released_at = datetime('now','localtime') WHERE id = ?`,
        String(req.user.real_name || ''), id);
      audit(req, 'print_cancel', job, { title: job.title });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: '취소하지 못했어요.' });
    }
  });

  return router;
};

/* 대기열에 하루 넘게 남은 내용의 원문을 지운다 (목록·메타는 남겨 추적 가능).
 *  → 시험지 같은 민감 문서가 서버에 장기 보관되지 않도록. */
function purgeOldPrintContent() {
  try {
    const r = run(
      `UPDATE print_jobs SET content = ''
       WHERE content <> '' AND created_at < datetime('now','localtime','-1 day')`
    );
    return Number(r.changes || 0);
  } catch (e) {
    return 0;
  }
}

module.exports.purgeOldPrintContent = purgeOldPrintContent;
