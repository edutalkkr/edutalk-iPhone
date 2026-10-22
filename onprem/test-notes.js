'use strict';
/* 쪽지(Notes) API 자체 검증 — 5단계-1
 * 실행: npm run test:notes
 * 임시 DB에서만 동작하며 실제 data/ 폴더는 건드리지 않는다. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'breeze-notes-test');
process.env.EDUTALK_DATA_DIR = TMP;
process.env.EDUTALK_DB_PATH = path.join(TMP, 'test.db');
fs.rmSync(TMP, { recursive: true, force: true });

const { row, run } = require('./db');
const auth = require('./auth');
const express = require('express');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}

/* 시드: 부서 트리(교무부 > 1·2학년부) + 교사 3명 + 관리자 1명 */
run("INSERT INTO departments (id, name, parent_id) VALUES (1, '교무부', NULL)");
run("INSERT INTO departments (id, name, parent_id) VALUES (2, '1학년부', 1)");
run("INSERT INTO departments (id, name, parent_id) VALUES (3, '2학년부', 1)");
for (const [u, n, d, r] of [
  ['t1', '김하나', 2, 'TEACHER'],
  ['t2', '박두나', 3, 'TEACHER'],
  ['t3', '이세나', 1, 'TEACHER'],
  ['admin', '시스템관리자', 1, 'ADMIN'],
]) {
  run('INSERT INTO users (username, real_name, department_id, role, password_hash) VALUES (?, ?, ?, ?, ?)',
    u, n, d, r, auth.hashPassword('pw1234'));
}

/* 목 서버 (server.js의 needAuth와 동일 로직) */
const emitted = [];
const fakeIo = { to: (room) => ({ emit: (ev, payload) => emitted.push({ room, ev, payload }) }) };
function needAuth(req, res, next) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const u = auth.userByToken(token);
  if (!u) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });
  req.user = u; req.token = token; next();
}
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/notes', require('./routes/notes')({ needAuth, getIo: () => fakeIo }));

let base = '';
const server = app.listen(0, '127.0.0.1', async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  const client = (token, method, p, body) =>
    fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

  try {
    const t1 = auth.login('t1', 'pw1234').token;
    const t2 = auth.login('t2', 'pw1234').token;
    const t3 = auth.login('t3', 'pw1234').token;
    const uid = (name) => Number(row('SELECT id FROM users WHERE username = ?', name).id);
    const u1 = uid('t1'), u2 = uid('t2'), u3 = uid('t3');

    console.log('\n[1] 개별 발송 + 멱등성');
    let r = await client(t1, 'POST', '/api/notes/send', {
      clientNoteId: 'c-note-1', title: '체험학습 안내', content: '1) 일시\n2) 준비물',
      audience: 'USER', recipientIds: [u2, u3], ccIds: [u1], bccIds: [u2],
    });
    check('개별 발송 200 + 수신자 2명 (본인 제외·중복 제거)', r.status === 200 && r.json.recipientCount === 2, r.json);
    const note1 = r.json.noteId;
    r = await client(t1, 'POST', '/api/notes/send', { clientNoteId: 'c-note-1', title: '다시', content: '다시' });
    check('멱등: 같은 clientNoteId → duplicate, 같은 noteId', r.json.duplicate === true && r.json.noteId === note1, r.json);
    check('소켓 memo-arrived 2건 발신', emitted.filter((e) => e.ev === 'memo-arrived').length === 2, emitted.length);

    console.log('\n[2] 전교 발송 (ADMIN 제외)');
    r = await client(t1, 'POST', '/api/notes/send', { audience: 'ALL', title: '전교 공지', content: '내용' });
    check('전교 발송: 관리자 제외 3명 - 발신자 = 2명', r.status === 200 && r.json.recipientCount === 2, r.json);

    console.log('\n[3] 학년 발송 (부서 트리 재귀 확장)');
    r = await client(t1, 'POST', '/api/notes/send', { audience: 'GRADE', targetKey: '1학년', title: '1학년 공지', content: '내용' });
    check('1학년 발송: 대상 소속(김하나)뿐 - 발신자 = 0명 → 400', r.status === 400, r.json);
    r = await client(t3, 'POST', '/api/notes/send', { audience: 'GRADE', targetKey: '1학년', title: '1학년 공지', content: '내용' });
    check('이세나가 1학년 발송 → 김하나 1명', r.status === 200 && r.json.recipientCount === 1, r.json);

    console.log('\n[4] 받은 쪽지함 + 안읽음');
    r = await client(t2, 'GET', '/api/notes/inbox');
    check('박두나 받은 쪽지 ≥ 2, unread ≥ 2', r.json.ok && r.json.total >= 2 && r.json.unread >= 2, { total: r.json.total, unread: r.json.unread });
    const inbox1 = r.json.notes.find((n) => n.id === note1);
    check('쪽지1 줄바꿈 보존 + 발신자 이름', inbox1 && inbox1.content.includes('\n') && inbox1.sender_name === '김하나', inbox1);
    r = await client(t2, 'GET', '/api/notes/inbox?unreadOnly=1');
    check('unreadOnly 필터', r.json.notes.every((n) => n.is_read === 0), r.json.notes);

    console.log('\n[5] 읽음 처리 (멱등 + 소켓)');
    r = await client(t2, 'PATCH', `/api/notes/${note1}/read`);
    const readAt = r.json.readAt;
    check('읽음 200 + readAt 기록', r.status === 200 && !!readAt, r.json);
    check('발신자에게 peer-read 발신', emitted.some((e) => e.ev === 'peer-read' && e.room === 'user:' + u1 && e.payload.ref_id === String(note1)), emitted);
    r = await client(t2, 'PATCH', `/api/notes/${note1}/read`);
    check('멱등: 같은 readAt 반환', r.json.readAt === readAt, { a: readAt, b: r.json.readAt });
    r = await client(t1, 'PATCH', `/api/notes/${note1}/read`);
    check('수신자 아닌 사람은 404', r.status === 404, r.json);

    console.log('\n[6] 보낸 쪽지함 (수신자별 열람 상태)');
    r = await client(t1, 'GET', '/api/notes/sent');
    const sent1 = r.json.notes.find((n) => n.id === note1);
    check('수신자 2명 + read_count 1', sent1 && sent1.recipients.length === 2 && sent1.read_count === 1, sent1 && { rc: sent1.read_count });
    const rec2 = sent1.recipients.find((x) => x.id === u2);
    check('박두나 행: TO/BCC 중복 → TO 우선', rec2 && rec2.type === 'USER' && rec2.is_read === 1, rec2);

    console.log('\n[7] 입력 검증');
    r = await client(t1, 'POST', '/api/notes/send', { title: '', content: 'x' });
    check('제목 없음 → 400', r.status === 400, r.json);
    r = await client(t1, 'POST', '/api/notes/send', { audience: 'USER', recipientIds: [99999], title: 't', content: 'c' });
    check('없는 수신자 → 400', r.status === 400, r.json);
    r = await client('', 'GET', '/api/notes/inbox');
    check('토큰 없음 → 401', r.status === 401, r.json);

    console.log('\n[8] 감사 로그 (Append-Only)');
    const cnt = Number(row("SELECT COUNT(*) c FROM audit_logs WHERE action='note_send'").c);
    check('note_send 감사 3건 기록', cnt === 3, { cnt });
    let blocked = false;
    try { run("UPDATE audit_logs SET action='hacked' WHERE log_id=1"); } catch (e) { blocked = true; }
    check('UPDATE 시도가 트리거로 차단됨', blocked);
  } catch (e) {
    fail++;
    console.error('  ✗ 예외:', e);
  } finally {
    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    server.close(() => process.exit(fail ? 1 : 0));
  }
});
