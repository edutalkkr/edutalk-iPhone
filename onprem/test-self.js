'use strict';
/* 온프레미스 서버 자가 테스트: node onprem/test-self.js (서버를 직접 띄워 API·소켓을 두드린다) */
const { spawn } = require('child_process');
const path = require('path');

const HERE = __dirname;
const PORT = 39517;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' :: ' + extra : ''));
}

async function main() {
  const TEST_DATA = path.join(HERE, '.test-data');
  try { require('fs').rmSync(TEST_DATA, { recursive: true, force: true }); } catch (e) {}
  const child = spawn(process.execPath, [path.join(HERE, 'server.js')], {
    env: { ...process.env, EDUTALK_PORT: String(PORT), EDUTALK_DATA_DIR: TEST_DATA, EDUTALK_ADMIN_TOKEN: 'test-admin-token' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  const kill = () => { try { child.kill(); } catch (e) {} };
  process.on('exit', kill);

  const jpost = async (p, body, headers) => {
    const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body || {}) });
    return r.json();
  };
  const jget = async (p, headers) => (await fetch(BASE + p, { headers: headers || {} })).json();

  // 부팅 대기 (최대 20초) — 설정 전에도 열리는 setup-state로 확인
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { const j = await jget('/api/setup-state'); if (j.ok && j.done === false) { ready = true; break; } } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  ok('server boots', ready);
  if (!ready) { console.log(out.slice(-2000)); kill(); process.exit(1); }
  // 초기 설정 잠금: 설정 전에는 503, 본체에서 관리자+이용권 등록해야 열림
  const preDenied = await jget('/api/users');
  const slic = await jpost('/api/admin/setup/license', { trial: true });
  ok('setup license', slic.ok);
  const sadm = await jpost('/api/admin/setup/admin', { username: 'root', real_name: '관리자', password: 'root1234' });
  ok('setup admin', sadm.ok);
  const sadm2 = await jpost('/api/admin/setup/admin', { username: 'x2', real_name: 'x', password: 'xxxx' });
  ok('setup admin once', !sadm2.ok);
  const slic2 = await jpost('/api/admin/setup/license', { trial: true });
  ok('setup locked after done', !slic2.ok);
  const sst = await jget('/api/setup-state');
  ok('setup done', sst.done === true);
  ok('setup gate was 503', preDenied.setupRequired === true);
  ok('license trial mode', out.includes('무료 체험') || out.includes('trial'));

  const H = { 'x-admin-token': 'test-admin-token' };
  const st = await jget('/api/admin/status', H);
  ok('admin status', st.ok && st.license, JSON.stringify((st.license || {}).mode));

  // 엑셀 대신 직접 부서+사용자 준비: 부서 API
  const dep = await jpost('/api/admin/departments', { name: '교무부' }, H);
  ok('department create', dep.ok && dep.id, String(dep.id));

  // 사용자는 import API로 (xlsx 파일 생성)
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { username: 't001', real_name: '김교사', password: 'pw1234', department: '교무부', role: 'TEACHER', is_paid_dual_network: 1 },
    { username: 't002', real_name: '이교사', department: '교무부>1학년부', role: 'TEACHER' },
  ]), '명단');
  const xlPath = path.join(HERE, '.test-data', 'import.xlsx');
  XLSX.writeFile(wb, xlPath);
  const fd = new FormData();
  fd.append('file', new Blob([require('fs').readFileSync(xlPath)]), 'import.xlsx');
  const imp = await (await fetch(BASE + '/api/admin/users/import', { method: 'POST', headers: H, body: fd })).json();
  ok('excel import', imp.ok && imp.created === 2, JSON.stringify({ created: imp.created, updated: imp.updated, dep: imp.departmentsCreated }));

  const login = await jpost('/api/login', { username: 't001', password: 'pw1234' });
  ok('login', login.ok && login.token, (login.user || {}).real_name);
  const bad = await jpost('/api/login', { username: 't001', password: 'wrong' });
  ok('login rejects wrong pw', !bad.ok);
  const AU = { Authorization: 'Bearer ' + login.token };

  const tree = await jget('/api/departments/tree', AU);
  ok('org tree', tree.ok && tree.tree.length === 1 && tree.tree[0].children.length === 1, '1학년부 중첩 확인');

  const room = await jpost('/api/rooms', { name: '내부방', member_ids: [] }, AU);
  ok('room create', room.ok && room.room.network_type === 'INTERNAL', room.room.id);

  // 소켓: 상태 변경 브로드캐스트 + 메시지 + 읽음 + 회수
  const { io } = require('socket.io-client');
  const s1 = io(BASE, { auth: { token: login.token } });
  await new Promise((res, rej) => { s1.on('connect', res); s1.on('connect_error', rej); setTimeout(() => rej(new Error('timeout')), 8000); });
  ok('socket connects', s1.connected);
  const got = {};
  s1.on('user:status_updated', (d) => { got.status = d; });
  s1.on('message:new', (d) => { got.msg = d; });
  s1.on('message:read_updated', (d) => { got.read = d; });
  s1.on('message:recalled', (d) => { got.recalled = d; });
  const emitAck = (ev, data) => new Promise((res) => s1.emit(ev, data, res));
  const jr = await emitAck('room:join', room.room.id);
  ok('room join', jr && jr.ok);
  const stt = await emitAck('user:change_status', { status: 'IN_CLASS', statusMessage: '3교시 수업' });
  await new Promise((r) => setTimeout(r, 400));
  ok('status broadcast', stt.ok && got.status && got.status.status === 'IN_CLASS');
  const snd = await emitAck('message:send', { roomId: room.room.id, content: '안녕하세요' });
  await new Promise((r) => setTimeout(r, 400));
  ok('message send+broadcast', snd.ok && got.msg && got.msg.content === '안녕하세요');
  const rd = await emitAck('message:read', { messageId: snd.message.id });
  await new Promise((r) => setTimeout(r, 400));
  ok('message read broadcast', rd.ok && got.read && got.read.readCount === 1);
  const rc = await emitAck('message:recall', { messageId: snd.message.id });
  await new Promise((r) => setTimeout(r, 400));
  ok('message recall broadcast', rc.ok && got.recalled && got.recalled.content === '회수된 메시지입니다');
  const reads = await jget(`/api/messages/${snd.message.id}/reads`, AU);
  ok('reads roster', reads.ok && reads.read.length === 1, `읽음 ${reads.read.length} · 안읽음 ${reads.unread.length}`);
  s1.close();

  // 방 1개 조회 + 초대 + 나가기 + 삭제 + 공개 정보
  const rg = await jget(`/api/rooms/${room.room.id}`, AU);
  ok('room get', rg.ok && rg.room.id === room.room.id);
  const login2 = await jpost('/api/login', { username: 't002', password: 't002' });
  ok('second login', login2.ok);
  const AU2 = { Authorization: 'Bearer ' + login2.token };
  const addm = await (await fetch(BASE + `/api/rooms/${room.room.id}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...AU }, body: JSON.stringify({ user_ids: [login2.user.id] }) })).json();
  ok('room member add', addm.ok);
  const lv = await (await fetch(BASE + `/api/rooms/${room.room.id}/members/me`, { method: 'DELETE', headers: AU2 })).json();
  ok('room leave', lv.ok);
  const del = await (await fetch(BASE + `/api/rooms/${room.room.id}`, { method: 'DELETE', headers: AU })).json();
  ok('room delete', del.ok);
  const pub = await jget('/api/public-info');
  ok('public info', pub.ok && pub.dual === false);
  const jdel = async (p, headers) => (await fetch(BASE + p, { method: 'DELETE', headers: headers || {} })).json();

  // 내부 투표/할일/출석/검색 + 비밀 자동생성 + hwid
  const room2 = await jpost('/api/rooms', { name: '기능방' }, AU);
  ok('room2 create', room2.ok);
  const s2 = io(BASE, { auth: { token: login.token } });
  await new Promise((res, rej) => { s2.on('connect', res); s2.on('connect_error', rej); setTimeout(() => rej(new Error('timeout')), 8000); });
  const emit2 = (ev, data) => new Promise((res) => s2.emit(ev, data, res));
  await emit2('room:join', room2.room.id);
  const txt = await emit2('message:send', { roomId: room2.room.id, content: '오늘 급식 뭐예요' });
  ok('text send room2', txt.ok);
  const sh = await jget(`/api/rooms/${room2.room.id}/search?q=${encodeURIComponent('급식')}`, AU);
  ok('message search', sh.ok && sh.messages.length === 1);
  const ackP = await emit2('message:send', { roomId: room2.room.id, content: '', poll: { q: '점심?', opts: ['김밥', '라면'] } });
  ok('poll send', ackP.ok);
  const badPoll = await emit2('message:send', { roomId: room2.room.id, content: '', poll: { q: 'x', opts: ['하나'] } });
  ok('poll rejects 1 opt', !badPoll.ok);
  const vote = await emit2('poll:vote', { messageId: ackP.message.id, choices: [0] });
  ok('poll vote', vote.ok);
  const msgs2 = await jget(`/api/rooms/${room2.room.id}/messages?limit=20`, AU);
  const pm = (msgs2.messages || []).find((m) => m.id === ackP.message.id);
  ok('poll counts', pm && pm.poll_counts[0] === 1 && pm.poll_mine[0] === 0);
  const cls = await emit2('poll:close', { messageId: ackP.message.id });
  ok('poll close', cls.ok);
  const voteClosed = await emit2('poll:vote', { messageId: ackP.message.id, choices: [1] });
  ok('poll rejects closed', !voteClosed.ok);
  s2.close();
  const td = await jpost(`/api/rooms/${room2.room.id}/todos`, { text: '우유 사기' }, AU);
  ok('todo add', td.ok);
  const tg = await jpost(`/api/todos/${td.id}/toggle`, {}, AU);
  ok('todo toggle', tg.ok && tg.done === true);
  const tdel = await jdel(`/api/todos/${td.id}`, AU);
  ok('todo delete', tdel.ok);
  const ast = await jpost(`/api/rooms/${room2.room.id}/attendance/start`, {}, AU);
  ok('attendance start', ast.ok);
  const amk = await jpost(`/api/rooms/${room2.room.id}/attendance/mark`, {}, AU);
  ok('attendance mark', amk.ok);
  const atoday = await jget(`/api/rooms/${room2.room.id}/attendance/today`, AU);
  ok('attendance roster', atoday.ok && atoday.session.present.length === 1);
  const acl = await jpost(`/api/rooms/${room2.room.id}/attendance/close`, {}, AU);
  ok('attendance close', acl.ok);
  const secStat = await jget('/api/admin/secret', H);
  ok('secret auto-created', secStat.ok && /^[0-9a-f]{64}$/.test(secStat.secret || ''));
  ok('hwid format', /^[0-9A-F]{16}$/.test(st.hwid || ''));

  // 업로드 + 만료 퍼지 함수 직접 검증
  const upFd = new FormData();
  upFd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hi.txt');
  const up = await (await fetch(BASE + '/api/upload', { method: 'POST', headers: AU, body: upFd })).json();
  ok('file upload', up.ok && up.fileId, String(up.fileId));
  const dl = await fetch(BASE + `/api/files/${up.fileId}`, { headers: AU });
  ok('file download', dl.ok);

  const fails = results.filter((r) => !r.pass).length;
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
  kill();
  setTimeout(() => process.exit(fails === 0 ? 0 : 1), 500);
}

main().catch((e) => { console.error('SELFTEST ERROR', e); process.exit(1); });
