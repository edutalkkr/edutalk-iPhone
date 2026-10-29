'use strict';
/* 관리자 도구 (CoolManager 스펙 ③④⑤) — 데이터 유지보수 · 감사 리포트 · 서버 상태
 *  기존 /api/admin/*(status·users·import…) 옆에 붙는다. 모두 x-admin-token 필요.
 *
 *   GET  /api/admin/health              서버 상태(메모리·동시접속·DB 크기·백업 목록)
 *   GET  /api/admin/policies            정책 읽기
 *   PUT  /api/admin/policies            정책 저장(검증 포함, 즉시 반영)
 *   POST /api/admin/maintenance/purge   만료된 학생 미디어만 즉시 정리 (텍스트·교사 미디어는 보존)
 *   GET  /api/admin/audit/export        감사 리포트 .xlsx (접속·쪽지·파일·권한·공지)
 *   POST /api/admin/backup/run          지금 바로 백업
 *   GET  /api/admin/backups             백업 목록
 */
const express = require('express');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, DB_PATH, all, run, counts, purgeExpiredFiles } = require('../db');
const { getPolicies, setPolicies } = require('../policies');
const { backupNow, listBackups, backupDir, KEEP } = require('../backup');

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const validYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function sheet(rows, emptyNote) {
  const data = rows && rows.length ? rows : [{ 안내: emptyNote || '해당 기간에 기록이 없어요.' }];
  return XLSX.utils.json_to_sheet(data, { skipHeader: false });
}

module.exports = function createAdminToolsRouter({ needAdmin, adminLimiter, purgeFiles, getIo }) {
  const router = express.Router();
  const lim = adminLimiter || ((req, res, next) => next());
  router.use(lim, needAdmin);

  /* ── ⑤ 서버 상태 ─────────────────────────────────────────────── */
  router.get('/health', (req, res) => {
    try {
      const mem = process.memoryUsage();
      let sockets = 0;
      try {
        const io = getIo && getIo();
        if (io && io.sockets && io.sockets.sockets) sockets = io.sockets.sockets.size;
      } catch (e) { /* 소켓 수는 참고값 */ }
      let dbBytes = 0;
      try { if (fs.existsSync(DB_PATH)) dbBytes = fs.statSync(DB_PATH).size; } catch (e) { /* 참고값 */ }
      const backups = listBackups();
      res.json({
        ok: true,
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
        rssMB: Math.round(mem.rss / 1048576),
        heapUsedMB: Math.round(mem.heapUsed / 1048576),
        sockets,
        dbBytes,
        counts: counts(),
        policies: getPolicies(),
        backups: backups.slice(0, 5),
        backupDir: backupDir(),
        backupKeep: KEEP,
        now: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: '서버 상태를 읽지 못했어요.' });
    }
  });

  /* ── ② 정책 ─────────────────────────────────────────────────── */
  router.get('/policies', (req, res) => {
    res.json({ ok: true, policies: getPolicies() });
  });
  router.put('/policies', (req, res) => {
    const r = setPolicies(req.body || {});
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json({ ok: true, policies: r.policies });
  });

  /* ── ③ 데이터 정리 (학생 미디어만) ────────────────────────────
   * 텍스트(쪽지·대화)와 교사·교직원 미디어는 영구 보관이므로 이 경로에서 지우지 않는다.
   * 만료된 학생 미디어의 실제 파일·DB 행만 정리하고, 남은 공간을 VACUUM으로 돌려준다. */
  router.post('/maintenance/purge', (req, res) => {
    try {
      const files = purgeFiles ? purgeFiles() : 0;
      try { run(`UPDATE print_jobs SET content = '' WHERE content <> '' AND created_at < datetime('now','localtime','-1 day')`); } catch (e) { /* 인쇄 원문 정리 */ }
      let vacuumed = false;
      try { db.exec('VACUUM'); vacuumed = true; } catch (e) { /* 사용 중이면 다음에 */ }
      run(
        `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
         VALUES ('system', '관리자', 'maintenance_purge', 'settings', '', ?, ?)`,
        JSON.stringify({ files, vacuumed }),
        String((req.socket && req.socket.remoteAddress) || 'admin').replace(/^::ffff:/, '')
      );
      res.json({ ok: true, deleted: { files }, vacuumed });
    } catch (e) {
      res.status(500).json({ ok: false, error: '데이터 정리에 실패했어요.' });
    }
  });

  /* ── ④ 감사 리포트 (.xlsx) ──────────────────────────────────── */
  router.get('/audit/export', (req, res) => {
    try {
      const today = new Date();
      const from = validYmd(req.query.from) ? String(req.query.from) : ymd(new Date(today.getTime() - 90 * 86400000));
      const to = validYmd(req.query.to) ? String(req.query.to) : ymd(today);
      const lo = `${from} 00:00:00`;
      const hi = `${to} 23:59:59`;

      const wb = XLSX.utils.book_new();

      /* 안내 */
      const info = [
        { 항목: '생성 시각', 값: new Date().toISOString().slice(0, 19).replace('T', ' ') },
        { 항목: '조회 기간', 값: `${from} ~ ${to}` },
        { 항목: '사용자', 값: counts().users },
        { 항목: '보관 정책(회수/용량/보존)', 값: JSON.stringify(getPolicies()) },
        { 항목: '안내', 값: '교육청 정보보안 감사 제출용 자료 — 서버가 자동 생성했어요.' },
      ];
      XLSX.utils.book_append_sheet(wb, sheet(info), '요약');

      /* 접속 기록 (세션) */
      const logins = all(
        `SELECT s.created_at AS '로그인 시각', u.username AS '사번', u.real_name AS '이름', d.name AS '부서'
         FROM sessions s LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE s.created_at >= ? AND s.created_at <= ? ORDER BY s.created_at DESC LIMIT 5000`,
        lo, hi
      );
      XLSX.utils.book_append_sheet(wb, sheet(logins, '기간 내 접속 기록이 없어요.'), '접속기록');

      /* 쪽지 송수신 */
      const notes = all(
        `SELECT n.created_at AS '보낸 시각', u.real_name AS '보낸이', n.title AS '제목',
                n.audience AS '대상', n.target_key AS '대상 지정', n.recipient_count AS '수신 인원',
                (SELECT COUNT(*) FROM note_recipients r WHERE r.note_id = n.id AND r.is_read = 1) AS '읽은 인원',
                n.status AS '상태'
         FROM notes n LEFT JOIN users u ON u.id = n.sender_id
         WHERE n.created_at >= ? AND n.created_at <= ? ORDER BY n.created_at DESC LIMIT 5000`,
        lo, hi
      );
      XLSX.utils.book_append_sheet(wb, sheet(notes, '기간 내 쪽지가 없어요.'), '쪽지송수신');

      /* 파일 송수신 */
      const files = all(
        `SELECT f.created_at AS '시각', f.original_name AS '파일명',
                ROUND(f.file_size / 1048576.0, 2) AS '크기(MB)', u.real_name AS '보낸이',
                r.name AS '채팅방', f.expires_at AS '보관 만료'
         FROM files f
         LEFT JOIN messages m ON m.id = f.message_id
         LEFT JOIN users u ON u.id = m.sender_id
         LEFT JOIN rooms r ON r.id = m.room_id
         WHERE f.created_at >= ? AND f.created_at <= ? ORDER BY f.created_at DESC LIMIT 5000`,
        lo, hi
      );
      XLSX.utils.book_append_sheet(wb, sheet(files, '기간 내 파일 송수신이 없어요.'), '파일송수신');

      /* 관리자 권한·시스템 변경 (감사 로그 중 관리 계열) */
      const adminLogs = all(
        `SELECT created_at AS '시각', actor_name AS '처리자', action AS '동작',
                target_type AS '대상 종류', target_id AS '대상', detail AS '상세', ip AS 'IP'
         FROM audit_logs
         WHERE created_at >= ? AND created_at <= ?
           AND (action LIKE 'admin%' OR action IN ('user_import','role_change','license_save','maintenance_purge','print_release'))
         ORDER BY created_at DESC LIMIT 2000`,
        lo, hi
      );
      XLSX.utils.book_append_sheet(wb, sheet(adminLogs, '기간 내 관리자 변경 이력이 없어요.'), '권한변경');

      /* 공지 열람 — (1) 전교 공지 쪽지의 수신자별 읽음 */
      const noticeReads = all(
        `SELECT n.created_at AS '보낸 시각', n.title AS '공지 제목', u2.real_name AS '교사',
                CASE r.is_read WHEN 1 THEN '읽음' ELSE '안 읽음' END AS '상태', r.read_at AS '읽은 시각'
         FROM notes n JOIN note_recipients r ON r.note_id = n.id
         LEFT JOIN users u2 ON u2.id = r.recipient_id
         WHERE n.audience = 'ALL' AND n.created_at >= ? AND n.created_at <= ?
         ORDER BY n.created_at DESC LIMIT 5000`,
        lo, hi
      );
      XLSX.utils.book_append_sheet(wb, sheet(noticeReads, '기간 내 전교 공지가 없어요.'), '공지열람(쪽지)');

      /* 공지 열람 — (2) 채팅방 공지(필독)의 수신자별 읽음 */
      const chatNotices = all(
        `SELECT m.created_at AS '등록 시각', r.name AS '채팅방', u.real_name AS '작성자',
                m.content AS '내용', u2.real_name AS '읽은 교사', mr.read_at AS '읽은 시각'
         FROM messages m
         JOIN message_reads mr ON mr.message_id = m.id
         LEFT JOIN rooms r ON r.id = m.room_id
         LEFT JOIN users u ON u.id = m.sender_id
         LEFT JOIN users u2 ON u2.id = mr.user_id
         WHERE m.is_notice = 1 AND m.created_at >= ? AND m.created_at <= ?
         ORDER BY m.created_at DESC LIMIT 5000`,
        lo, hi
      );
      XLSX.utils.book_append_sheet(wb, sheet(chatNotices, '기간 내 채팅방 공지가 없어요.'), '공지열람(채팅)');

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="breeze-audit-${from}-${to}.xlsx"`);
      res.send(buf);
    } catch (e) {
      console.error('[admin-tools] audit export error:', e);
      res.status(500).json({ ok: false, error: '감사 리포트를 만들지 못했어요.' });
    }
  });

  /* ── ⑤ 백업 ─────────────────────────────────────────────────── */
  router.post('/backup/run', (req, res) => {
    try {
      const b = backupNow();
      run(
        `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
         VALUES ('system', '관리자', 'admin_backup', 'settings', '', ?, ?)`,
        JSON.stringify({ file: b.file, bytes: b.bytes }),
        String((req.socket && req.socket.remoteAddress) || 'admin').replace(/^::ffff:/, '')
      );
      res.json({ ok: true, backup: b });
    } catch (e) {
      console.error('[admin-tools] backup error:', e);
      res.status(500).json({ ok: false, error: '백업에 실패했어요.' });
    }
  });
  router.get('/backups', (req, res) => {
    res.json({ ok: true, backups: listBackups(), dir: backupDir(), keep: KEEP });
  });

  return router;
};
