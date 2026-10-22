'use strict';
/* 보안 인쇄 대기열 검증 (Killer ①) — 실행: npm run test:print
 * 임시 DB에서만 동작하며 실제 data/ 폴더는 건드리지 않는다. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'breeze-print-test');
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

run('INSERT INTO users (username, real_name, role, password_hash) VALUES (?, ?, ?, ?)', 't1', '김하나', 'TEACHER', auth.hashPassword('pw1234'));
run('INSERT INTO users (username, real_name, role, password_hash) VALUES (?, ?, ?, ?)', 't2', '이두리', 'TEACHER', auth.hashPassword('pw1234'));
run('INSERT INTO users (username, real_name, role, password_hash) VALUES (?, ?, ?, ?)', 'boss', '관리자', 'ADMIN', auth.hashPassword('pw1234'));

function needAuth(req, res, next) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const u = auth.userByToken(token);
  if (!u) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });
  req.user = u; req.token = token; next();
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/print', require('./routes/print')({ needAuth }));

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
    const boss = auth.login('boss', 'pw1234').token;

    console.log('\n[1] 제출 검증');
    let r = await client('', 'POST', '/api/print/jobs', { title: 'x', content: 'y' });
    check('토큰 없음 → 401', r.status === 401, r.json);
    r = await client(t1, 'POST', '/api/print/jobs', { title: '성적표', content: '   ' });
    check('빈 내용 → 400', r.status === 400, r.json);
    r = await client(t1, 'POST', '/api/print/jobs', { title: ' ', content: '내용' });
    check('제목 비면 (제목 없음)으로 저장', r.status === 200 && r.json.job.title === '(제목 없음)', r.json.job);
    r = await client(t1, 'POST', '/api/print/jobs', { title: '초대형', content: 'x'.repeat(201 * 1024) });
    check('200KB 초과 → 413', r.status === 413, r.status);

    console.log('\n[2] 대기열 — 문서는 바로 나가지 않고 PENDING 으로 보관');
    r = await client(t1, 'POST', '/api/print/jobs', { title: '2학기 지필평가 시험지', content: '1. 다음 중...\n2. ...' });
    const jobId = r.json.job && r.json.job.id;
    check('제출 성공 + PENDING + 소유자 표시', r.status === 200 && r.json.job.status === 'PENDING' && r.json.job.ownerName === '김하나', r.json.job);
    r = await client(t2, 'GET', '/api/print/jobs');
    check('다른 교사(공용 PC)도 대기열을 본다', r.status === 200 && r.json.pending.some((j) => j.id === jobId), r.json.pending && r.json.pending.length);
    check('목록에는 본문이 포함되지 않는다(가벼운 목록)', !('content' in (r.json.pending.find((j) => j.id === jobId) || {})), r.json.pending.find((j) => j.id === jobId));

    console.log('\n[3] 출력 승인 — 이때만 내용이 내려가고 RELEASED 로 바뀐다');
    r = await client(t2, 'POST', `/api/print/jobs/${jobId}/release`);
    check('승인 성공 + 본문 반환', r.status === 200 && String(r.json.job.content).includes('다음 중'), r.status);
    check('승인자·시각 기록', r.json.job.releasedBy === '이두리' && !!r.json.job.releasedAt, r.json.job);
    r = await client(t1, 'POST', `/api/print/jobs/${jobId}/release`);
    check('이미 나간 문서 재출력 → 409', r.status === 409, r.json);
    r = await client(t2, 'GET', '/api/print/jobs');
    check('대기열에서는 빠지고 최근 내역에 남는다', !r.json.pending.some((j) => j.id === jobId) && r.json.recent.some((j) => j.id === jobId), r.json.recent && r.json.recent.length);

    console.log('\n[4] 대기 취소 — 본인/관리자만');
    r = await client(t1, 'POST', '/api/print/jobs', { title: '가정환경 조사서', content: '학부모님...' });
    const job2 = r.json.job.id;
    r = await client(t2, 'DELETE', `/api/print/jobs/${job2}`);
    check('남의 인쇄물 취소 → 403', r.status === 403, r.json);
    r = await client(t1, 'DELETE', `/api/print/jobs/${job2}`);
    check('본인 취소 → 200 + CANCELLED', r.status === 200 && String(row('SELECT status FROM print_jobs WHERE id = ?', job2).status) === 'CANCELLED', r.json);
    r = await client(boss, 'POST', '/api/print/jobs', { title: 'admin것', content: 'a' });
    const job3 = r.json.job.id;
    r = await client(boss, 'DELETE', `/api/print/jobs/${job3}`);
    check('관리자 본인 것 취소 정상', r.status === 200, r.json);
    r = await client(t1, 'DELETE', '/api/print/jobs/99999');
    check('없는 것 취소 → 404', r.status === 404, r.json);

    console.log('\n[5] 개인정보 최소 보관 — 하루 지난 원문 자동 삭제');
    run(`UPDATE print_jobs SET created_at = datetime('now','localtime','-2 day') WHERE id = ?`, jobId);
    const purged = require('./routes/print').purgeOldPrintContent();
    check('오래된 원문 1건 삭제', purged >= 1, { purged });
    check('원문은 지워지고 메타(제목)는 남는다', String(row('SELECT content FROM print_jobs WHERE id = ?', jobId).content) === '' && String(row('SELECT title FROM print_jobs WHERE id = ?', jobId).title).includes('지필평가'));

    console.log('\n[6] 감사 로그 (print_*)');
    const a1 = Number(row("SELECT COUNT(*) c FROM audit_logs WHERE action='print_submit'").c);
    const a2 = Number(row("SELECT COUNT(*) c FROM audit_logs WHERE action='print_release'").c);
    const a3 = Number(row("SELECT COUNT(*) c FROM audit_logs WHERE action='print_cancel'").c);
    check('제출 4건 기록', a1 === 4, { a1 });
    check('승인 1건 기록', a2 === 1, { a2 });
    check('취소 2건 기록', a3 === 2, { a3 });
  } catch (e) {
    fail++;
    console.error('  ✗ 예외:', e);
  } finally {
    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    server.close(() => process.exit(fail ? 1 : 0));
  }
});
