'use strict';
/* 관리자 도구(CoolManager ③④⑤) + 나이스 연동 검증 — 실행: npm run test:cool
 * 임시 DB에서만 동작한다. 네트워크(나이스) 호출은 하지 않는다 — 미설정 503 경로만 검증. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'breeze-cool-test');
process.env.EDUTALK_DATA_DIR = TMP;
process.env.EDUTALK_DB_PATH = path.join(TMP, 'test.db');
process.env.NEIS_API_KEY = '';
delete process.env.NEIS_OFFICE_CODE;
delete process.env.NEIS_SCHOOL_CODE;
fs.rmSync(TMP, { recursive: true, force: true });

const { row, run } = require('./db');
const auth = require('./auth');
const express = require('express');
const XLSX = require('xlsx');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}

run('INSERT INTO users (username, real_name, role, password_hash) VALUES (?, ?, ?, ?)', 't1', '김하나', 'TEACHER', auth.hashPassword('pw1234'));
run("INSERT INTO departments (name) VALUES ('교무부')");
run("UPDATE users SET department_id = 1 WHERE username = 't1'");
// 접속 기록·쪽지·파일·공지 데이터 (리포트 검증용)
run("INSERT INTO sessions (token, user_id) VALUES ('tok-1', 1)");
run("INSERT INTO rooms (id, name) VALUES ('r1', '1학년부')");
run("INSERT INTO messages (room_id, sender_id, content, is_notice) VALUES ('r1', 1, '전체 공지입니다', 1)");
run("INSERT INTO message_reads (message_id, user_id) VALUES (1, 1)");
run("INSERT INTO files (message_id, original_name, stored_filename, file_size, expires_at) VALUES (1, '성적표.xlsx', 'abc.xlsx', 2048, datetime('now','localtime','+30 day'))");
run(`INSERT INTO notes (sender_id, title, audience, target_key, recipient_count) VALUES (1, '전교 공지', 'ALL', '', 1)`);
run(`INSERT INTO note_recipients (note_id, recipient_id, is_read, read_at) VALUES (1, 1, 1, datetime('now','localtime'))`);
run(`INSERT INTO audit_logs (actor_id, actor_name, action, target_type) VALUES ('system', '관리자', 'admin_backup', 'settings')`);
// 5년 지난 대화 1건 (데이터 정리 검증용)
run("INSERT INTO messages (room_id, sender_id, content, created_at) VALUES ('r1', 1, '아주 오래된 대화', datetime('now','localtime','-5 years'))");

const app = express();
app.use(express.json({ limit: '2mb' }));
const needAdmin = (req, res, next) => {
  if (String(req.headers['x-admin-token'] || '') !== 'secret') return res.status(403).json({ ok: false, error: '관리자 토큰이 필요해요.' });
  next();
};
app.use('/api/admin', require('./routes/admin-tools')({ needAdmin, purgeFiles: () => 2 }));
app.use('/api/neis', require('./routes/neis')({ needAuth: (req, res, next) => next() }));

let base = '';
const server = app.listen(0, '127.0.0.1', async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  const j = (method, p, body, token) =>
    fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token === false ? {} : { 'x-admin-token': 'secret' }) },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

  try {
    console.log('\n[1] 인증');
    let r = await j('GET', '/api/admin/health', null, false);
    check('토큰 없음 → 403', r.status === 403, r.json);

    console.log('\n[2] 정책(Policy) — 검증 후 즉시 반영');
    r = await j('GET', '/api/admin/policies');
    check('기본값 (100MB·7분·학생 미디어 30일)', r.json.policies.uploadMaxMB === '100' && r.json.policies.studentMediaDays === '30', r.json.policies);
    r = await j('PUT', '/api/admin/policies', { uploadMaxMB: 500, recallMinutes: 10, studentMediaDays: 90, forceUpdate: true, neisOfficeCode: 'B10', neisSchoolCode: '7010569' });
    check('정책 저장 성공', r.status === 200 && r.json.policies.uploadMaxMB === '500' && r.json.policies.forceUpdate === '1', r.json.policies);
    r = await j('PUT', '/api/admin/policies', { uploadMaxMB: 99999 });
    check('범위 밖 값 거부 → 400', r.status === 400, r.json);
    r = await j('PUT', '/api/admin/policies', { neisSchoolCode: '해킹코드!' });
    check('코드에 이상 문자 거부 → 400', r.status === 400, r.json);
    const { getPolicyBool, getPolicyNumber } = require('./policies');
    check('서버 코드에서 정책 읽기 (업로드 500, 강제 OTA on)', getPolicyNumber('uploadMaxMB') === 500 && getPolicyBool('forceUpdate') === true);

    console.log('\n[3] 데이터 정리 — 만료된 학생 미디어만');
    r = await j('POST', '/api/admin/maintenance/purge', {});
    check('정리 성공 + 학생 미디어 수 보고', r.status === 200 && r.json.deleted.files === 2 && typeof r.json.vacuumed === 'boolean', r.json);
    check('텍스트(쪽지·대화)는 삭제하지 않음', Number(row('SELECT COUNT(*) c FROM messages').c) === 2 && Number(row('SELECT COUNT(*) c FROM notes').c) === 1);

    console.log('\n[4] 감사 리포트 (.xlsx)');
    const res = await fetch(base + '/api/admin/audit/export', { headers: { 'x-admin-token': 'secret' } });
    check('엑셀 응답 (content-type)', res.status === 200 && /spreadsheetml/.test(res.headers.get('content-type') || ''), res.headers.get('content-type'));
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buf);
    const names = wb.SheetNames;
    check('시트 7종 (요약·접속·쪽지·파일·권한·공지×2)', names.includes('요약') && names.includes('접속기록') && names.includes('쪽지송수신') && names.includes('파일송수신') && names.includes('권한변경') && names.includes('공지열람(쪽지)') && names.includes('공지열람(채팅)'), names);
    const loginRows = XLSX.utils.sheet_to_json(wb.Sheets['접속기록']);
    check('접속기록에 사번·이름·부서', loginRows.length === 1 && loginRows[0]['사번'] === 't1' && loginRows[0]['부서'] === '교무부', loginRows);
    const fileRows = XLSX.utils.sheet_to_json(wb.Sheets['파일송수신']);
    check('파일송수신에 파일명', fileRows.length === 1 && fileRows[0]['파일명'] === '성적표.xlsx', fileRows);
    const noticeRows = XLSX.utils.sheet_to_json(wb.Sheets['공지열람(쪽지)']);
    check('공지열람(쪽지)에 읽음 상태', noticeRows.length === 1 && noticeRows[0]['상태'] === '읽음', noticeRows);

    console.log('\n[5] 백업 — VACUUM INTO 일관 스냅샷');
    r = await j('POST', '/api/admin/backup/run');
    check('즉시 백업 성공 + 파일명', r.status === 200 && /^edutalk-.*\.db$/.test(r.json.backup.file), r.json);
    const bpath = path.join(TMP, 'backups', r.json.backup.file);
    check('백업 파일이 실제로 만들어짐 (>0 byte)', fs.existsSync(bpath) && fs.statSync(bpath).size > 0);
    r = await j('GET', '/api/admin/backups');
    check('백업 목록에 포함', r.json.backups.some((b) => b.file === r.json.backups[0].file) && r.json.backups.length === 1, r.json.backups);

    console.log('\n[6] 서버 상태(health)');
    r = await j('GET', '/api/admin/health');
    check('상태: 가동시간·메모리·DB 크기·백업', r.status === 200 && typeof r.json.uptimeSec === 'number' && r.json.rssMB > 0 && r.json.dbBytes > 0 && Array.isArray(r.json.backups), r.json);

    console.log('\n[7] 나이스 연동 — 미설정 안내 (네트워크 호출 없음)');
    r = await j('GET', '/api/neis/status');
    check('미설정 상태 보고 (키 없음)', r.json.ok === true && r.json.ready === false && r.json.missing.includes('API 키(NEIS_API_KEY)'), r.json);
    r = await j('GET', '/api/neis/meal?date=20261019');
    check('급식 미설정 → 503 + 안내', r.status === 503 && /설정/.test(r.json.error), r.json);
    r = await j('GET', '/api/neis/schedule?from=2026-10-01&to=2026-10-31');
    check('날짜 형식 오류 → 400', r.status === 400, r.json);
    r = await j('GET', '/api/neis/meal?date=2026-10-19');
    check('날짜 형식 오류(급식) → 400', r.status === 400, r.json);
  } catch (e) {
    fail++;
    console.error('  ✗ 예외:', e);
  } finally {
    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    server.close(() => process.exit(fail ? 1 : 0));
  }
});
