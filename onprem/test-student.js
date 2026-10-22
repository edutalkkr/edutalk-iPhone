'use strict';
/* 학생 웹 ↔ 교사 앱 연동 + 학교 코드 + 계정/라이선스 경계 자가 테스트
 * 실행: cd onprem && node test-student.js
 */
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const PORT = 39518;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' :: ' + extra : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const TEST_DATA = path.join(HERE, '.test-data-student');
  try { require('fs').rmSync(TEST_DATA, { recursive: true, force: true }); } catch (e) {}
  const child = spawn(process.execPath, [path.join(HERE, 'server.js')], {
    env: { ...process.env, EDUTALK_PORT: String(PORT), EDUTALK_DATA_DIR: TEST_DATA, EDUTALK_LICENSE_PATH: path.join(TEST_DATA, 'license.key'), EDUTALK_ADMIN_TOKEN: 'test-admin-token' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  const kill = () => { try { child.kill(); } catch (e) {} };
  process.on('exit', kill);

  const jreq = async (method, p, body, headers) => {
    const init = { method, headers: { ...(headers || {}) } };
    if (body !== undefined && !(body instanceof FormData)) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body || {});
    } else if (body instanceof FormData) {
      init.body = body;
    }
    const r = await fetch(BASE + p, init);
    let j = null;
    try { j = await r.json(); } catch (e) {}
    return { status: r.status, j: j || {} };
  };
  const jget = (p, h) => jreq('GET', p, undefined, h);
  const jpost = (p, b, h) => jreq('POST', p, b, h);
  const jput = (p, b, h) => jreq('PUT', p, b, h);
  const jpatch = (p, b, h) => jreq('PATCH', p, b, h);
  const auth = (token) => ({ Authorization: 'Bearer ' + token });

  // 부팅
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await jget('/api/setup-state'); if (r.j.ok && r.j.done === false) { ready = true; break; } } catch (e) {}
    await sleep(500);
  }
  ok('server boots', ready);
  if (!ready) { console.log(out.slice(-2000)); kill(); process.exit(1); }

  // 최소 설정 + 관리자
  const licTrial = await jpost('/api/admin/setup/license', { trial: true });
  ok('trial setup', licTrial.j.ok);
  const sadm = await jpost('/api/admin/setup/admin', { username: 'root', real_name: '관리자', password: 'root1234' });
  ok('admin setup', sadm.j.ok);
  const H = { 'x-admin-token': 'test-admin-token' };

  // 라이선스 maxUsers=4 (관리자 포함) 로 교체 — HMAC은 테스트에서 직접 서명
  const sec = await jget('/api/admin/secret', H);
  const stat = await jget('/api/admin/status', H);
  ok('admin secret/hwid', sec.j.ok && stat.j.ok && sec.j.secret && stat.j.hwid);
  const payload = {
    school: '테스트초등학교', schoolId: 'TEST-SCHOOL',
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    isPaidDualNetworkActive: false, maxUsers: 5, hwid: stat.j.hwid,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', sec.j.secret).update(body).digest('base64url');
  const lic = await jpost('/api/admin/license', { key: body + '.' + sig }, H);
  ok('maxUsers license installed', lic.j.ok && lic.j.license.mode === 'licensed' && lic.j.license.maxUsers === 5, JSON.stringify(lic.j.license));

  // 학교 코드 설정
  const schoolPut = await jput('/api/admin/school', { code: 'BRZ-TEST1', name: '테스트초등학교' }, H);
  ok('school code save', schoolPut.j.ok && schoolPut.j.school.code === 'BRZ-TEST1');
  const pub = await jget('/api/public-info');
  ok('public info exposes school code', pub.j.ok && pub.j.schoolCode === 'BRZ-TEST1' && pub.j.schoolName === '테스트초등학교');

  // 엑셀 일괄 등록 (교사 1 + 학생 3) — 관리자 포함 5명 상한
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { username: 't001', real_name: '김교사', password: 'pw1234', department: '교무부', role: 'TEACHER' },
    { username: 's001', real_name: '학생하나', password: 'sp1234', department: '3학년부', role: 'STUDENT' },
    { username: 's002', real_name: '학생둘', password: 'sp1234', department: '3학년부', role: 'STUDENT' },
    { username: 's003', real_name: '학생셋', department: '3학년부', role: 'STUDENT' },
  ]), '명단');
  const xlPath = path.join(TEST_DATA, 'import.xlsx');
  XLSX.writeFile(wb, xlPath);
  const fd = new FormData();
  fd.append('file', new Blob([require('fs').readFileSync(xlPath)]), 'import.xlsx');
  const imp = await jpost('/api/admin/users/import', fd, H);
  ok('import teacher+students', imp.j.ok && imp.j.created === 4 && imp.j.temporaryPasswords && imp.j.temporaryPasswords.length === 1, JSON.stringify({ created: imp.j.created, errors: imp.j.errors, temp: imp.j.temporaryPasswords }));

  // 5번째 계정은 라이선스 상한 초과
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet([
    { username: 't999', real_name: '초과교사', password: 'pw1234', role: 'TEACHER' },
  ]), '명단');
  const xl2 = path.join(TEST_DATA, 'over.xlsx');
  XLSX.writeFile(wb2, xl2);
  const fd2 = new FormData();
  fd2.append('file', new Blob([require('fs').readFileSync(xl2)]), 'over.xlsx');
  const over = await jpost('/api/admin/users/import', fd2, H);
  ok('maxUsers enforced', over.j.ok && over.j.created === 0 && (over.j.errors || []).some((e) => String(e).includes('라이선스 인원')), JSON.stringify(over.j.errors));

  // 계정 API에 비밀번호 해시가 없어야 함
  const users = await jget('/api/admin/users', H);
  ok('admin users has no password_hash', users.j.ok && !JSON.stringify(users.j).includes('password_hash'));
  const roleList = (users.j.users || []).map((u) => u.role);
  ok('students visible to admin', roleList.includes('STUDENT'));

  // 학교 코드 검증
  const noCode = await jpost('/api/login', { username: 's001', password: 'sp1234' });
  ok('student login requires school code', !noCode.j.ok && noCode.status === 403 && noCode.j.schoolMismatch === true);
  const wrongCode = await jpost('/api/login', { username: 's001', password: 'sp1234', schoolCode: 'NOPE' });
  ok('student login rejects wrong school code', !wrongCode.j.ok && wrongCode.status === 403);
  const teacherLogin = await jpost('/api/login', { username: 't001', password: 'pw1234', schoolCode: 'BRZ-TEST1' });
  ok('teacher login', teacherLogin.j.ok && teacherLogin.j.user.role === 'TEACHER');
  const teacherNoCode = await jpost('/api/login', { username: 't001', password: 'pw1234' });
  ok('teacher legacy login without code still allowed', teacherNoCode.j.ok);
  const teacherToken = teacherLogin.j.token;
  const TU = auth(teacherToken);

  const sLogin = await jpost('/api/login', { username: 's001', password: 'sp1234', schoolCode: 'BRZ-TEST1' });
  ok('student login', sLogin.j.ok && sLogin.j.user.role === 'STUDENT');
  const SU = auth(sLogin.j.token);
  const adminUsers = await jget('/api/admin/users', H);
  const adminUser = (adminUsers.j.users || []).find((u) => u.role === 'ADMIN');
  const sendAdmin = await jpost('/api/notes/send', { title: '관리자 문의', content: '학생은 관리자에게 보낼 수 없어야 해요.', recipientIds: [adminUser && adminUser.id] }, SU);
  ok('student cannot message admin account', sendAdmin.status === 403 && !sendAdmin.j.ok && !!adminUser);
  const s2Login = await jpost('/api/login', { username: 's002', password: 'sp1234', schoolCode: 'BRZ-TEST1' });
  ok('second student login', s2Login.j.ok);
  const s2id = s2Login.j.user.id;
  const tempPw = imp.j.temporaryPasswords && imp.j.temporaryPasswords[0];
  const tempLogin = await jpost('/api/login', { username: 's003', password: tempPw ? tempPw.password : 'wrong', schoolCode: 'BRZ-TEST1' });
  ok('temporary password login', tempPw && tempLogin.j.ok && tempLogin.j.user.role === 'STUDENT');

  // 학생 권한 경계
  for (const [name, p] of [
    ['users', '/api/users'],
    ['departments', '/api/departments/tree'],
    ['rooms', '/api/rooms'],
    ['print', '/api/print/jobs'],
    ['neis', '/api/neis/meal?date=20260101'],
  ]) {
    const r = await jget(p, SU);
    ok('student blocked from ' + name, r.status === 403, 'HTTP ' + r.status);
  }
  const studentTeachers = await jget('/api/student/teachers', SU);
  ok('student teacher directory', studentTeachers.j.ok && studentTeachers.j.teachers.length === 1 && studentTeachers.j.teachers.every((t) => ['TEACHER', 'STAFF'].includes(t.role)) && studentTeachers.j.teachers[0].real_name === '김교사');
  const teacherStudentDir = await jget('/api/student/teachers', TU);
  ok('teacher cannot use student directory', teacherStudentDir.status === 403);

  // 교사 조직도에서 학생 제외
  const tree = await jget('/api/departments/tree', TU);
  const treeNames = [];
  const walk = (nodes) => (nodes || []).forEach((n) => { (n.members || []).forEach((m) => treeNames.push(m.real_name)); walk(n.children); });
  walk(tree.j.tree);
  ok('students excluded from teacher org tree', tree.j.ok && !treeNames.includes('학생하나') && treeNames.includes('김교사'));

  // 학생 → 교사 실시간 쪽지
  const { io } = require('socket.io-client');
  const ts = io(BASE, { auth: { token: teacherToken } });
  const ss = io(BASE, { auth: { token: sLogin.j.token } });
  await Promise.all([
    new Promise((res, rej) => { ts.on('connect', res); ts.on('connect_error', rej); setTimeout(() => rej(new Error('teacher socket timeout')), 8000); }),
    new Promise((res, rej) => { ss.on('connect', res); ss.on('connect_error', rej); setTimeout(() => rej(new Error('student socket timeout')), 8000); }),
  ]);
  const got = {};
  ts.on('memo-arrived', (d) => { got.teacherMemo = d; });
  ss.on('memo-arrived', (d) => { got.studentMemo = d; });
  ts.on('peer-read', (d) => { got.peerRead = d; });

  const send = await jpost('/api/notes/send', { title: '수업 질문', content: '선생님, 3단원 문제를 모르겠어요.', recipientIds: [teacherLogin.j.user.id] }, SU);
  ok('student sends note', send.j.ok && send.j.recipientCount === 1);
  await sleep(500);
  ok('teacher gets realtime memo', got.teacherMemo && got.teacherMemo.id === String(send.j.noteId) && got.teacherMemo.from_role === 'STUDENT', JSON.stringify(got.teacherMemo));

  const tinbox = await jget('/api/notes/inbox?limit=20', TU);
  const tin = (tinbox.j.notes || []).find((n) => n.id === send.j.noteId);
  ok('teacher inbox shows student sender', tin && tin.sender_role === 'STUDENT' && tin.sender_name === '학생하나', JSON.stringify(tin && { name: tin.sender_name, role: tin.sender_role }));

  // 학생 → 학생 금지 / 전체 발송 금지
  const toStudent = await jpost('/api/notes/send', { title: 'x', content: 'x', recipientIds: [s2id] }, SU);
  ok('student cannot message another student', !toStudent.j.ok && toStudent.status === 403);
  const toAll = await jpost('/api/notes/send', { title: 'x', content: 'x', audience: 'ALL' }, SU);
  ok('student cannot broadcast to all', !toAll.j.ok && toAll.status === 403);

  // 교사 → 학생 답장 (기존 쪽지 API 재사용)
  const reply = await jpost('/api/notes/send', { title: 'Re: 수업 질문', content: '3단원 5번 문제는 이렇게 풀어 보세요.', recipientIds: [sLogin.j.user.id] }, TU);
  ok('teacher replies to student', reply.j.ok);
  await sleep(500);
  ok('student gets realtime reply', got.studentMemo && got.studentMemo.id === String(reply.j.noteId) && got.studentMemo.from_role === 'TEACHER', JSON.stringify(got.studentMemo));
  const sinbox = await jget('/api/notes/inbox?limit=20', SU);
  ok('student inbox shows teacher reply', (sinbox.j.notes || []).some((n) => n.id === reply.j.noteId && n.sender_role === 'TEACHER'));

  // 학생 읽음 → 교사에게 peer-read
  const rd = await jpatch(`/api/notes/${reply.j.noteId}/read`, {}, SU);
  ok('student marks reply read', rd.j.ok);
  await sleep(450);
  ok('teacher receives peer-read', got.peerRead && String(got.peerRead.ref_id) === String(reply.j.noteId));

  // 계정 보안: 본인 비밀번호 변경 + 관리자 재설정 + 세션 폐기
  const selfPw = await jpost('/api/me/password', { currentPassword: 'sp1234', newPassword: 'newpw1234' }, SU);
  ok('student changes own password', selfPw.j.ok);
  const oldLogin = await jpost('/api/login', { username: 's001', password: 'sp1234', schoolCode: 'BRZ-TEST1' });
  ok('old password rejected after change', !oldLogin.j.ok);
  const newLogin = await jpost('/api/login', { username: 's001', password: 'newpw1234', schoolCode: 'BRZ-TEST1' });
  ok('new password works', newLogin.j.ok);
  const resetPw = await jpost('/api/admin/users/' + s2Login.j.user.id + '/password', { password: 'resetpw1234' }, H);
  ok('admin resets another user password', resetPw.j.ok);
  const s2old = await jpost('/api/login', { username: 's002', password: 'sp1234', schoolCode: 'BRZ-TEST1' });
  ok('old password rejected after admin reset', !s2old.j.ok);
  const s2new = await jpost('/api/login', { username: 's002', password: 'resetpw1234', schoolCode: 'BRZ-TEST1' });
  ok('admin reset password works', s2new.j.ok);

  // 학생 웹 정적 페이지
  const page = await fetch(BASE + '/student/');
  const pageText = await page.text();
  ok('student web page served', page.ok && pageText.includes('브리즈 학생'));
  const js = await fetch(BASE + '/student/student.js');
  ok('student web js served', js.ok && String(js.headers.get('content-type') || '').includes('javascript'));
  const root = await fetch(BASE + '/', { redirect: 'manual' });
  ok('root redirects to student web', [301, 302, 303, 307, 308].includes(root.status) && String(root.headers.get('location') || '').includes('/student'));

  ts.close(); ss.close();
  const fails = results.filter((r) => !r.pass).length;
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
  kill();
  setTimeout(() => process.exit(fails === 0 ? 0 : 1), 500);
}

main().catch((e) => { console.error('STUDENT TEST ERROR', e); process.exit(1); });
