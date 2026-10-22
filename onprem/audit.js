'use strict';
/* 감사 로그 공통 기록 — 실패해도 본 동작을 막지 않는다.
 *  · 상담 원문·결재 본문·보드 JSON 같은 민감한 내용은 detail에 넣지 않는다.
 *  · 누가·무엇을·언제 했는지와 대상 ID, 결과만 남긴다. */
const { run } = require('./db');

function clientIp(req) {
  try {
    const raw = String((req && req.socket && req.socket.remoteAddress) || (req && req.ip) || '')
      .toLowerCase().replace(/^::ffff:/, '');
    return raw || 'unknown';
  } catch (e) { return 'unknown'; }
}

function writeAudit(req, actor, action, targetType, targetId, detail) {
  try {
    run(
      `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      String(actor && actor.id != null ? actor.id : 'system'),
      String((actor && (actor.real_name || actor.username)) || ''),
      String(action || ''),
      String(targetType || ''),
      String(targetId == null ? '' : targetId),
      JSON.stringify(detail || {}),
      clientIp(req)
    );
  } catch (e) { /* 감사 실패는 본 동작을 막지 않는다 */ }
}

module.exports = { clientIp, writeAudit };
