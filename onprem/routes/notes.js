'use strict';
/* 브리즈 쪽지(이메일형) API — /api/notes (5단계-1 뼈대)
 * 설계서: docs/NOTES_BACKEND_DESIGN.md
 * - 7초 Undo Send는 클라이언트(NoteComposer)가 담당하고, 서버는 확정된 발송만 받는다.
 * - client_note_id 멱등 키로 중복 발송을 막는다.
 * - 라우터 팩토리: server.js에서 { needAuth, getIo } 주입
 *     app.use('/api/notes', require('./routes/notes')({ needAuth, getIo: () => io }));
 */
const express = require('express');
const { db, row, all, run } = require('../db');

const TITLE_MAX = 200;
const CONTENT_MAX = 20000;
const PAGE_MAX = 100;

/* ---------- 작은 헬퍼 ---------- */
function clientIp(req) {
  try {
    return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '') || 'unknown';
  } catch (e) { return 'unknown'; }
}

function nowLocal() {
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

/* 감사 로그 기록 (Append-Only). 실패해도 본 동작은 막지 않는다. */
function writeAudit(req, actor, action, targetType, targetId, detail) {
  try {
    run(
      `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      String(actor && actor.id != null ? actor.id : 'system'),
      String((actor && actor.real_name) || ''),
      String(action),
      String(targetType || ''),
      String(targetId == null ? '' : targetId),
      JSON.stringify(detail || {}),
      clientIp(req)
    );
  } catch (e) { /* 감사 실패 무시 */ }
}

/* ---------- 수신자 확장 (설계서 §2.3) ---------- */
function allUserIds() {
  return all(`SELECT id FROM users WHERE role NOT IN ('ADMIN','STUDENT')`).map((r) => Number(r.id));
}

/* 부서 + 하위 부서까지 재귀 확장해 소속 사용자 id 추출 */
function userIdsOfDept(deptId) {
  return all(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM departments WHERE id = ?
       UNION ALL
       SELECT d.id FROM departments d JOIN sub s ON d.parent_id = s.id
     )
     SELECT u.id FROM users u WHERE u.role != 'STUDENT' AND u.department_id IN (SELECT id FROM sub)`,
    Number(deptId)
  ).map((r) => Number(r.id));
}

function deptIdsByKey(key, isGrade) {
  const k = String(key || '').trim();
  if (!k) return [];
  if (/^\d+$/.test(k)) return [Number(k)];
  const safe = k.replace(/[%_]/g, '');
  const rows = isGrade
    ? all('SELECT id FROM departments WHERE name LIKE ?', safe + '%')
    : all('SELECT id FROM departments WHERE name = ?', safe);
  return rows.map((r) => Number(r.id));
}

/* audience(ALL/DEPT/GRADE) 확장. USER는 개별 id로 처리하므로 null */
function expandAudience(audience, targetKey) {
  const a = String(audience || '').toUpperCase();
  if (a === 'ALL') return { ids: allUserIds(), audience: 'ALL', targetKey: '' };
  if (a === 'DEPT' || a === 'GRADE') {
    const ids = new Set();
    for (const d of deptIdsByKey(targetKey, a === 'GRADE')) {
      for (const u of userIdsOfDept(d)) ids.add(u);
    }
    return { ids: [...ids], audience: a, targetKey: String(targetKey || '').trim() };
  }
  return null;
}

/* 요청 본문 → { map: Map<uid, type>, audience, targetKey }
 * - 정식 형식: { audience, targetKey, recipientIds[], ccIds[], bccIds[] }
 * - 레거시 모의 형식 호환: recipientIds 항목이 'all' | '1학년' | 숫자 등 혼합 */
function normalizeSendBody(body, senderId) {
  const toIds = new Set();
  const ccIds = new Set();
  const bccIds = new Set();
  const toArr = (v) => (Array.isArray(v) ? v : []);
  const rawTo = toArr(body.recipientIds).concat(toArr(body.recipient_ids));
  const rawCc = toArr(body.ccIds).concat(toArr(body.cc_ids));
  const rawBcc = toArr(body.bccIds).concat(toArr(body.bcc_ids));

  let audience = String(body.audience || '').toUpperCase();
  let targetKey = String(body.targetKey || body.target_key || '').trim();

  for (const v of rawTo) {
    const s = String(v == null ? '' : v).trim();
    if (!s) continue;
    if (/^\d+$/.test(s)) { toIds.add(Number(s)); continue; }
    if (s.toLowerCase() === 'all' || s === '전교' || s === '전교 교사 전체') { audience = audience || 'ALL'; continue; }
    if (!audience) {
      if (/학년/.test(s)) { audience = 'GRADE'; targetKey = targetKey || s; }
      else { audience = 'DEPT'; targetKey = targetKey || s; }
    }
  }
  for (const v of rawCc) { const s = String(v == null ? '' : v).trim(); if (/^\d+$/.test(s)) ccIds.add(Number(s)); }
  for (const v of rawBcc) { const s = String(v == null ? '' : v).trim(); if (/^\d+$/.test(s)) bccIds.add(Number(s)); }

  const expanded = audience ? expandAudience(audience, targetKey) : null;
  const map = new Map();
  if (expanded) {
    for (const id of expanded.ids) if (!map.has(id)) map.set(id, expanded.audience);
  }
  for (const id of toIds) if (!map.has(id)) map.set(id, 'USER');
  for (const id of ccIds) if (!map.has(id)) map.set(id, 'CC');
  for (const id of bccIds) if (!map.has(id)) map.set(id, 'BCC');

  map.delete(Number(senderId));  /* 발신자 본인 제외 */

  /* 존재하지 않는 사용자 id는 버린다 (FK 위반 대신 무시 후 0명이면 400) */
  const valid = new Set(all('SELECT id FROM users').map((r) => Number(r.id)));
  for (const id of [...map.keys()]) if (!valid.has(id)) map.delete(id);
  return {
    map,
    audience: expanded ? expanded.audience : 'USER',
    targetKey: expanded ? expanded.targetKey : '',
  };
}

/* ---------- 라우터 팩토리 ---------- */
module.exports = function createNotesRouter({ needAuth, getIo }) {
  const router = express.Router();
  router.use(needAuth);

  /* POST /api/notes/send — 7초 유예 후 확정 발송 */
  router.post('/send', (req, res) => {
    try {
      const sender = req.user;
      const body = req.body || {};
      const title = String(body.title || '').trim().slice(0, TITLE_MAX);
      const content = String(body.content || '').replace(/\r\n/g, '\n').slice(0, CONTENT_MAX);
      const clientNoteId = String(body.clientNoteId || body.client_note_id || '').trim().slice(0, 64) || null;

      if (!title) return res.status(400).json({ ok: false, error: '쪽지 제목을 입력해 주세요.' });
      if (!content) return res.status(400).json({ ok: false, error: '쪽지 내용을 입력해 주세요.' });

      /* 학생은 선생님 한 명(최대 3명)에게만 보낼 수 있다.
       * 전교/부서/학년 전체 발송과 참조·숨은참조는 금지해 학생 간 대량 쪽지를 막는다. */
      const senderRole = String(sender.role || '').toUpperCase();
      if (senderRole === 'STUDENT') {
        if (String(body.audience || '').trim()) {
          return res.status(403).json({ ok: false, error: '학생은 선생님을 직접 선택해 쪽지를 보내 주세요.' });
        }
        const arr = (v) => (Array.isArray(v) ? v : []);
        if (arr(body.ccIds).concat(arr(body.cc_ids), arr(body.bccIds), arr(body.bcc_ids)).length) {
          return res.status(403).json({ ok: false, error: '학생은 참조·숨은참조를 쓸 수 없어요.' });
        }
        const raw = arr(body.recipientIds).concat(arr(body.recipient_ids)).map((v) => String(v == null ? '' : v).trim()).filter(Boolean);
        const ids = [...new Set(raw.filter((v) => /^\d+$/.test(v)).map(Number))];
        if (!ids.length || ids.length !== raw.length) {
          return res.status(403).json({ ok: false, error: '선생님을 한 명 이상 골라 주세요.' });
        }
        if (ids.length > 3) return res.status(403).json({ ok: false, error: '한 번에 최대 3명의 선생님께 보낼 수 있어요.' });
        const ph = ids.map(() => '?').join(',');
        const staff = all(`SELECT id, role FROM users WHERE id IN (${ph})`, ...ids);
        if (staff.length !== ids.length || staff.some((u) => !['TEACHER', 'STAFF'].includes(String(u.role || '').toUpperCase()))) {
          return res.status(403).json({ ok: false, error: '학생은 선생님에게만 쪽지를 보낼 수 있어요.' });
        }
      }

      /* 멱등: 같은 client_note_id가 이미 있으면 기존 결과 반환 */
      if (clientNoteId) {
        const ex = row('SELECT id, recipient_count FROM notes WHERE client_note_id = ?', clientNoteId);
        if (ex) return res.json({ ok: true, noteId: Number(ex.id), recipientCount: Number(ex.recipient_count), duplicate: true });
      }

      const { map, audience, targetKey } = normalizeSendBody(body, sender.id);
      if (map.size === 0) return res.status(400).json({ ok: false, error: '수신자를 한 명도 찾지 못했어요.' });

      let noteId = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = run(
          `INSERT INTO notes (client_note_id, sender_id, title, content, audience, target_key, recipient_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          clientNoteId, sender.id, title, content, audience, targetKey, map.size
        );
        noteId = Number(r.lastInsertRowid);
        const ins = db.prepare('INSERT OR IGNORE INTO note_recipients (note_id, recipient_id, recipient_type) VALUES (?, ?, ?)');
        for (const [uid, type] of map) ins.run(noteId, uid, type);
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (e2) {}
        /* UNIQUE(client_note_id) 경합 등 → 기존 것 반환 시도 */
        if (clientNoteId) {
          const ex = row('SELECT id, recipient_count FROM notes WHERE client_note_id = ?', clientNoteId);
          if (ex) return res.json({ ok: true, noteId: Number(ex.id), recipientCount: Number(ex.recipient_count), duplicate: true });
        }
        throw e;
      }

      writeAudit(req, sender, 'note_send', 'memo', noteId, { title, audience, targetKey, recipientCount: map.size });

      /* 수신자 전원에게 소켓 알림 (클라이언트 SocketEvents: memo-arrived) */
      const io = typeof getIo === 'function' ? getIo() : null;
      if (io) {
        const payload = { id: String(noteId), title, body: content, from: String(sender.id), from_name: sender.real_name || '', from_role: String(sender.role || '').toUpperCase() };
        for (const uid of map.keys()) io.to('user:' + uid).emit('memo-arrived', payload);
      }

      res.json({ ok: true, noteId, recipientCount: map.size, duplicate: false });
    } catch (e) {
      console.error('[notes] send error:', e);
      res.status(500).json({ ok: false, error: '쪽지를 보내지 못했어요.' });
    }
  });

  /* GET /api/notes/inbox — 받은 쪽지함 */
  router.get('/inbox', (req, res) => {
    try {
      const me = req.user;
      const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), PAGE_MAX);
      const page = Math.max(Number(req.query.page || 1), 1);
      const offset = (page - 1) * limit;
      const unreadOnly = req.query.unreadOnly === '1' || req.query.unreadOnly === 'true';
      const where = `nr.recipient_id = ? AND n.status = 'SENT'` + (unreadOnly ? ' AND nr.is_read = 0' : '');

      const notes = all(
        `SELECT n.id, n.title, n.content, n.audience, n.created_at,
                n.sender_id, u.real_name AS sender_name, u.role AS sender_role, d.name AS sender_department,
                nr.recipient_type, nr.is_read, nr.read_at
         FROM note_recipients nr
         JOIN notes n ON n.id = nr.note_id
         JOIN users u ON u.id = n.sender_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE ${where}
         ORDER BY n.id DESC LIMIT ? OFFSET ?`,
        me.id, limit, offset
      );
      const total = Number(((row(
        `SELECT COUNT(*) c FROM note_recipients nr JOIN notes n ON n.id = nr.note_id WHERE ${where}`,
        me.id
      ) || {}).c) || 0);
      const unread = Number(((row(
        `SELECT COUNT(*) c FROM note_recipients nr JOIN notes n ON n.id = nr.note_id
         WHERE nr.recipient_id = ? AND n.status = 'SENT' AND nr.is_read = 0`,
        me.id
      ) || {}).c) || 0);

      res.json({ ok: true, notes, total, unread, page, limit });
    } catch (e) {
      console.error('[notes] inbox error:', e);
      res.status(500).json({ ok: false, error: '받은 쪽지를 불러오지 못했어요.' });
    }
  });

  /* GET /api/notes/sent — 보낸 쪽지함 (수신자별 열람 상태 포함) */
  router.get('/sent', (req, res) => {
    try {
      const me = req.user;
      const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), PAGE_MAX);
      const page = Math.max(Number(req.query.page || 1), 1);
      const offset = (page - 1) * limit;

      const notes = all(
        `SELECT n.id, n.title, n.content, n.audience, n.target_key, n.status,
                n.recipient_count, n.created_at,
                (SELECT COUNT(*) FROM note_recipients r WHERE r.note_id = n.id AND r.is_read = 1) AS read_count
         FROM notes n WHERE n.sender_id = ?
         ORDER BY n.id DESC LIMIT ? OFFSET ?`,
        me.id, limit, offset
      );
      const total = Number(((row('SELECT COUNT(*) c FROM notes WHERE sender_id = ?', me.id) || {}).c) || 0);

      if (notes.length) {
        const ids = notes.map((n) => Number(n.id));
        const ph = ids.map(() => '?').join(',');
        const rows = db.prepare(
          `SELECT nr.note_id, nr.recipient_id AS id, u.real_name AS name, d.name AS department,
                  nr.recipient_type AS type, nr.is_read, nr.read_at
           FROM note_recipients nr
           JOIN users u ON u.id = nr.recipient_id
           LEFT JOIN departments d ON d.id = u.department_id
           WHERE nr.note_id IN (${ph})
           ORDER BY nr.note_id DESC, u.real_name ASC`
        ).all(...ids);
        const byNote = new Map();
        for (const r of rows) {
          const k = Number(r.note_id);
          if (!byNote.has(k)) byNote.set(k, []);
          byNote.get(k).push({
            id: Number(r.id), name: r.name, department: r.department || '',
            type: r.type, is_read: Number(r.is_read) || 0, read_at: r.read_at || null,
          });
        }
        for (const n of notes) n.recipients = byNote.get(Number(n.id)) || [];
      }

      res.json({ ok: true, notes, total, page, limit });
    } catch (e) {
      console.error('[notes] sent error:', e);
      res.status(500).json({ ok: false, error: '보낸 쪽지를 불러오지 못했어요.' });
    }
  });

  /* PATCH /api/notes/:id/read — 읽음 처리 (멱등) */
  router.patch('/:id/read', (req, res) => {
    try {
      const me = req.user;
      const noteId = Number(req.params.id);
      if (!Number.isInteger(noteId) || noteId <= 0) {
        return res.status(400).json({ ok: false, error: '쪽지 번호가 올바르지 않아요.' });
      }

      const nr = row('SELECT note_id, is_read, read_at FROM note_recipients WHERE note_id = ? AND recipient_id = ?', noteId, me.id);
      if (!nr) return res.status(404).json({ ok: false, error: '쪽지를 찾을 수 없어요.' });

      let readAt = nr.read_at;
      if (!Number(nr.is_read) || !readAt) {
        readAt = nowLocal();
        run('UPDATE note_recipients SET is_read = 1, read_at = ? WHERE note_id = ? AND recipient_id = ?', readAt, noteId, me.id);

        const io = typeof getIo === 'function' ? getIo() : null;
        if (io) {
          const n = row('SELECT sender_id FROM notes WHERE id = ?', noteId);
          if (n) io.to('user:' + n.sender_id).emit('peer-read', { ref_id: String(noteId), from: String(me.id) });
        }
      }

      res.json({ ok: true, noteId, readAt });
    } catch (e) {
      console.error('[notes] read error:', e);
      res.status(500).json({ ok: false, error: '읽음 처리에 실패했어요.' });
    }
  });

  return router;
};
