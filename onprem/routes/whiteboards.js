'use strict';
/* 실시간 협업 보드 — /api/whiteboards
 *
 *  · 좌석 배치·모둠 편성·시험 감독 배치를 학교 서버에 저장하고 교사들과 함께 편집한다.
 *  · 실시간 이동은 Socket.io(whiteboard:join / whiteboard:update)가 담당하고,
 *    이 REST 라우트는 목록·최초 로드·수동 저장·삭제를 담당한다.
 *  · 저장은 version 낙관적 잠금 — 다른 교사가 먼저 저장하면 409와 최신 보드를 돌려준다.
 *  · 학생 계정은 접근할 수 없다.
 */
const express = require('express');
const whiteboard = require('../whiteboard');
const { row } = require('../db');
const { writeAudit } = require('../audit');

function isAdmin(user) {
  return String((user && user.role) || '').toUpperCase() === 'ADMIN';
}

function emitBoard(io, id, event, payload) {
  try {
    if (io) io.to('whiteboard:' + String(id || '')).emit(event, payload);
  } catch (e) { /* 실시간 알림 실패는 저장을 막지 않는다 */ }
}

module.exports = function createWhiteboardsRouter({ needAuth, needStaff, writeLimiter, getIo }) {
  const router = express.Router();
  const limitWrite = typeof writeLimiter === 'function' ? writeLimiter : (req, res, next) => next();
  router.use(needAuth);
  if (needStaff) router.use(needStaff);

  router.get('/', (req, res) => {
    try {
      const boards = whiteboard.listBoards(Number(req.query.limit) || 60);
      res.json({ ok: true, boards });
    } catch (e) {
      console.error('[whiteboards] list error:', e);
      res.status(500).json({ ok: false, error: '보드 목록을 불러오지 못했어요.' });
    }
  });

  router.post('/', limitWrite, (req, res) => {
    try {
      const body = req.body || {};
      const board = whiteboard.createBoard({ title: body.title, kind: body.kind, user: req.user });
      writeAudit(req, req.user, 'whiteboard_create', 'whiteboard', board.id, { kind: board.kind });
      res.json({ ok: true, board });
    } catch (e) {
      console.error('[whiteboards] create error:', e);
      res.status(500).json({ ok: false, error: '보드를 만들지 못했어요.' });
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const board = whiteboard.getBoard(req.params.id);
      if (!board) return res.status(404).json({ ok: false, error: '보드를 찾지 못했어요.' });
      res.json({ ok: true, board });
    } catch (e) {
      res.status(500).json({ ok: false, error: '보드를 불러오지 못했어요.' });
    }
  });

  router.put('/:id', limitWrite, (req, res) => {
    try {
      const body = req.body || {};
      const result = whiteboard.updateBoard({
        id: req.params.id,
        data: body.data,
        expectedVersion: body.expectedVersion,
        title: body.title,
        user: req.user,
      });
      if (!result.ok && result.conflict) {
        return res.status(409).json({
          ok: false, conflict: true, board: result.board,
          error: '다른 선생님이 먼저 저장했어요. 최신 보드를 불러왔어요.',
        });
      }
      writeAudit(req, req.user, 'whiteboard_update', 'whiteboard', result.board.id, {
        version: result.board.version,
        items: result.board.data.items.length,
      });
      emitBoard(getIo && getIo(), result.board.id, 'whiteboard:updated', {
        boardId: result.board.id,
        data: result.board.data,
        version: result.board.version,
        updatedByName: result.board.updatedByName,
        updatedAt: result.board.updatedAt,
        source: 'rest',
      });
      res.json({ ok: true, board: result.board });
    } catch (e) {
      if (e && e.code === 'NOT_FOUND') return res.status(404).json({ ok: false, error: e.message });
      if (e && e.code === 'TOO_LARGE') return res.status(413).json({ ok: false, error: e.message });
      console.error('[whiteboards] update error:', e);
      res.status(500).json({ ok: false, error: '보드를 저장하지 못했어요.' });
    }
  });

  router.delete('/:id', limitWrite, (req, res) => {
    try {
      const board = whiteboard.getBoard(req.params.id);
      if (!board) return res.status(404).json({ ok: false, error: '보드를 찾지 못했어요.' });
      const ownerRow = row('SELECT created_by FROM whiteboards WHERE id = ?', board.id);
      const ownerId = ownerRow ? Number(ownerRow.created_by) : 0;
      if (ownerId !== Number(req.user.id) && !isAdmin(req.user)) {
        return res.status(403).json({ ok: false, error: '내가 만든 보드만 삭제할 수 있어요.' });
      }
      whiteboard.deleteBoard(board.id);
      writeAudit(req, req.user, 'whiteboard_delete', 'whiteboard', board.id, {});
      emitBoard(getIo && getIo(), board.id, 'whiteboard:deleted', { boardId: board.id });
      res.json({ ok: true });
    } catch (e) {
      console.error('[whiteboards] delete error:', e);
      res.status(500).json({ ok: false, error: '보드를 삭제하지 못했어요.' });
    }
  });

  return router;
};
