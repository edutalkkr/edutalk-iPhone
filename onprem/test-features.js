'use strict';
/* 차세대 기능 자가 테스트 — node onprem/test-features.js
 *  · 상담 일지: 마스킹·로컬 요약·작성자/관리자 권한·학생 차단
 *  · 전자결재: 관리자 승인·자기 승인 차단·전자서명 해시·반려/취소
 *  · 협업 보드: 서버 검증·낙관적 잠금·권한·Socket.io 실시간 동기화
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const HERE = __dirname;
const PORT = 39518;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DATA = path.join(HERE, '.test-features-data');
const results = [];

function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' :: ' + extra : ''));
}

async function jreq(method, p, body, headers) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch (e) { data = {}; }
  return { status: r.status, data };
}
const jget = (p, h) => jreq('GET', p, undefined, h);
const jpost = (p, b, h) => jreq('POST', p, b || {}, h);
const jput = (p, b, h) => jreq('PUT', p, b || {}, h);
const jdel = (p, h) => jreq('DELETE', p, undefined, h);

async function waitFor(fn, ms = 8000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    try { if (fn()) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function main() {
  try { fs.rmSync(TEST_DATA, { recursive: true, force: true }); } catch (e) { /* first run */ }
  const child = spawn(process.execPath, [path.join(HERE, 'server.js')], {
    env: {
      ...process.env,
      EDUTALK_PORT: String(PORT),
      EDUTALK_DATA_DIR: TEST_DATA,
      EDUTALK_LICENSE_PATH: path.join(TEST_DATA, 'license.key'),
      EDUTALK_LOG_DIR: path.join(TEST_DATA, 'logs'),
      EDUTALK_ADMIN_TOKEN: 'test-admin-token',
      GEMINI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  const kill = () => { try { child.kill(); } catch (e) { /* already stopped */ } };
  process.on('exit', kill);

  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const j = await jget('/api/setup-state');
      if (j.data && j.data.ok && j.data.done === false) { ready = true; break; }
    } catch (e) { /* booting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  ok('server boots', ready);
  if (!ready) { console.log(out.slice(-3000)); kill(); process.exit(1); }

  const H = { 'x-admin-token': 'test-admin-token' };
  ok('setup license', (await jpost('/api/admin/setup/license', { trial: true })).data.ok);
  ok('setup admin', (await jpost('/api/admin/setup/admin', { username: 'root', real_name: '관리자', password: 'root1234' })).data.ok);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { username: 't001', real_name: '김교사', password: 'pw1234', department: '교무부', role: 'TEACHER' },
    { username: 't002', real_name: '이교사', password: 'pw1234', department: '교무부', role: 'TEACHER' },
    { username: 's001', real_name: '학생', password: 'sp1234', department: '교무부', role: 'STUDENT' },
  ]), '명단');
  const xlPath = path.join(TEST_DATA, 'import.xlsx');
  XLSX.writeFile(wb, xlPath);
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(xlPath)]), 'import.xlsx');
  const imp = await (await fetch(BASE + '/api/admin/users/import', { method: 'POST', headers: H, body: fd })).json();
  ok('users import', imp.ok && imp.created === 3, `created ${imp.created}`);

  const pubInfo = (await jget('/api/public-info')).data || {};
  const login = async (username, password, schoolCode) => (await jpost('/api/login', { username, password, schoolCode })).data;
  const admin = await login('root', 'root1234');
  const t1 = await login('t001', 'pw1234');
  const t2 = await login('t002', 'pw1234');
  const st = await login('s001', 'sp1234', pubInfo.schoolCode || '');
  ok('logins', admin.ok && t1.ok && t2.ok && st.ok);
  const A = { Authorization: 'Bearer ' + admin.token };
  const T1 = { Authorization: 'Bearer ' + t1.token };
  const T2 = { Authorization: 'Bearer ' + t2.token };
  const S = { Authorization: 'Bearer ' + st.token };

  /* ---------- 1. AI 상담 일지 ---------- */
  const consultText = '김하늘 학생이 친구와 다투어 속상하다고 했어요. 연락처는 010-1234-5678이고 주민번호는 900101-1234567입니다. 다음 주에 학부모님께 연락하기로 했어요.';
  const sum = await jpost('/api/consultations/summarize', { text: consultText }, T1);
  const summary = (sum.data && sum.data.summary) || {};
  ok('consult summarize', sum.data.ok && Array.isArray(summary.concerns) && Array.isArray(summary.observations) && Array.isArray(summary.actions));
  ok('consult masks sensitive data', sum.data.privacy && sum.data.privacy.masked >= 2, JSON.stringify(sum.data.privacy || {}));
  ok('consult local fallback', sum.data.source === 'local');
  ok('consult summary has content', (summary.concerns || []).length + (summary.observations || []).length + (summary.actions || []).length > 0);

  const savedConsult = await jpost('/api/consultations', {
    studentName: '김하늘', contactType: 'student', topic: '교우 관계',
    rawText: consultText, summary, source: sum.data.source, maskedCount: sum.data.privacy.masked,
  }, T1);
  ok('consult save', savedConsult.data.ok && savedConsult.data.log && savedConsult.data.log.id > 0);
  const consultId = savedConsult.data.log.id;
  ok('consult author is t001', savedConsult.data.log.authorName === '김교사' && savedConsult.data.log.maskedCount >= 2);
  ok('consult list mine', (await jget('/api/consultations', T1)).data.logs.some((x) => x.id === consultId));
  ok('consult other teacher denied', (await jget('/api/consultations/' + consultId, T2)).status === 403);
  ok('consult admin can read', (await jget('/api/consultations/' + consultId, A)).data.ok);
  const adminLogs = await jget('/api/consultations?scope=all', A);
  ok('consult admin all scope', adminLogs.data.ok && adminLogs.data.scope === 'all' && adminLogs.data.logs.some((x) => x.id === consultId));
  ok('consult student denied', (await jget('/api/consultations', S)).status === 403);
  const upd = await jput('/api/consultations/' + consultId, {
    studentName: '김하늘', contactType: 'parent', topic: '교우 관계·학부모', rawText: consultText, summary, source: 'local',
  }, T1);
  ok('consult update', upd.data.ok && upd.data.log.topic.includes('학부모') && upd.data.log.contactType === 'parent');
  ok('consult delete', (await jdel('/api/consultations/' + consultId, T1)).data.ok);
  ok('consult deleted from list', !(await jget('/api/consultations', T1)).data.logs.some((x) => x.id === consultId));

  /* ---------- 2. 간이 전자결재 ---------- */
  const ap = await jpost('/api/approvals', {
    title: '2학년 체험학습 버스 임차', category: 'event', amount: 350000, content: '체험학습 이동을 위한 버스 1대를 임차하고자 합니다.',
  }, T1);
  ok('approval create', ap.data.ok && ap.data.approval.status === 'PENDING');
  const apId = ap.data.approval.id;
  const adminList = await jget('/api/approvals?scope=all', A);
  ok('admin sees approval', adminList.data.ok && adminList.data.approvals.some((x) => x.id === apId));
  ok('other teacher cannot decide', (await jpost(`/api/approvals/${apId}/decide`, { action: 'approve', signature: '이교사' }, T2)).status === 403);
  ok('teacher cannot decide as non-admin', (await jpost(`/api/approvals/${apId}/decide`, { action: 'approve', signature: '김교사' }, T1)).status === 403);
  const dec = await jpost(`/api/approvals/${apId}/decide`, { action: 'approve', signature: '관리자' }, A);
  ok('admin approve', dec.data.ok && dec.data.approval.status === 'APPROVED');
  ok('approval signature hash', /^[0-9a-f]{64}$/.test(dec.data.approval.signatureHash || ''), dec.data.approval.signatureHash);
  ok('approval approver recorded', dec.data.approval.approverName === '관리자' && dec.data.approval.signature === '관리자');
  ok('cannot decide twice', (await jpost(`/api/approvals/${apId}/decide`, { action: 'approve', signature: '관리자' }, A)).status === 409);

  const ap2 = await jpost('/api/approvals', { title: '교구 구입', category: 'supplies', amount: 12000, content: '수업용 자와 컴퍼스를 구입합니다.' }, T1);
  const rej = await jpost(`/api/approvals/${ap2.data.approval.id}/decide`, { action: 'reject', signature: '관리자', note: '예산 초과로 반려합니다.' }, A);
  ok('approval reject with note', rej.data.ok && rej.data.approval.status === 'REJECTED' && rej.data.approval.decisionNote.includes('예산 초과'));

  const ap3 = await jpost('/api/approvals', { title: '취소할 결재', category: 'general', amount: 0, content: '취소 테스트' }, T1);
  const can = await jpost(`/api/approvals/${ap3.data.approval.id}/cancel`, {}, T1);
  ok('requester cancel', can.data.ok && can.data.approval.status === 'CANCELLED');

  const self = await jpost('/api/approvals', { title: '관리자 본인 결재', category: 'general', amount: 0, content: '자기 승인 차단 테스트' }, A);
  ok('admin self approval blocked', (await jpost(`/api/approvals/${self.data.approval.id}/decide`, { action: 'approve', signature: '관리자' }, A)).status === 403);
  ok('student approval denied', (await jget('/api/approvals', S)).status === 403);

  /* ---------- 3. 협업 보드 REST ---------- */
  const board = await jpost('/api/whiteboards', { title: '2학년 3반 자리 배치', kind: 'seating' }, T1);
  ok('board create', board.data.ok && board.data.board.data.items.length === 12);
  const boardId = board.data.board.id;
  const badData = {
    background: 'hack',
    items: [{ id: '<script>alert(1)</script>', type: 'hack', x: 99999, y: -5, w: 1, h: 9999, label: '<img src=x onerror=alert(1)>', sublabel: 'x'.repeat(200), color: 'red' }],
  };
  const updB = await jput('/api/whiteboards/' + boardId, { data: badData, expectedVersion: 1 }, T1);
  const safe = updB.data.board && updB.data.board.data;
  ok('board update sanitizes', updB.data.ok && safe.background === 'grid' && safe.items.length === 1);
  ok('board clamps item', safe.items[0].type === 'seat' && safe.items[0].x === 4000 && safe.items[0].y === 0 && safe.items[0].w === 40 && safe.items[0].h === 420 && safe.items[0].color === '#0082c8');
  ok('board strips id chars', !/[<>]/.test(safe.items[0].id));
  ok('board version increments', updB.data.board.version === 2);

  const conflict = await jput('/api/whiteboards/' + boardId, { data: { background: 'plain', items: [] }, expectedVersion: 1 }, T2);
  ok('board optimistic lock', conflict.status === 409 && conflict.data.conflict === true && conflict.data.board.version === 2);
  const upd2 = await jput('/api/whiteboards/' + boardId, { data: { background: 'plain', items: [] }, expectedVersion: 2 }, T2);
  ok('board update by other teacher', upd2.data.ok && upd2.data.board.version === 3 && upd2.data.board.updatedByName === '이교사');
  ok('board delete by non-owner denied', (await jdel('/api/whiteboards/' + boardId, T2)).status === 403);
  ok('board delete by admin', (await jdel('/api/whiteboards/' + boardId, A)).data.ok);
  ok('student board denied', (await jget('/api/whiteboards', S)).status === 403);

  /* ---------- 4. 협업 보드 Socket.io ---------- */
  const { io } = require('socket.io-client');
  const s1 = io(BASE, { auth: { token: t1.token } });
  const s2 = io(BASE, { auth: { token: t2.token } });
  await Promise.all([
    new Promise((res, rej) => { s1.on('connect', res); s1.on('connect_error', rej); setTimeout(() => rej(new Error('s1 timeout')), 8000); }),
    new Promise((res, rej) => { s2.on('connect', res); s2.on('connect_error', rej); setTimeout(() => rej(new Error('s2 timeout')), 8000); }),
  ]);
  ok('whiteboard sockets connect', s1.connected && s2.connected);
  const live = await jpost('/api/whiteboards', { title: '실시간 보드', kind: 'free' }, T1);
  const liveId = live.data.board.id;
  const ack = (sock, ev, payload) => new Promise((res) => sock.emit(ev, payload, res));
  let updated = null;
  let presence = null;
  s2.on('whiteboard:updated', (ev) => { updated = ev; });
  s2.on('whiteboard:presence', (ev) => { presence = ev; });
  const j1 = await ack(s1, 'whiteboard:join', { boardId: liveId });
  const j2 = await ack(s2, 'whiteboard:join', { boardId: liveId });
  ok('whiteboard join', j1.ok && j2.ok);
  const liveData = { background: 'grid', items: [{ id: 'it-1', type: 'seat', x: 10, y: 10, w: 112, h: 82, label: '테스트', sublabel: '학생', color: '#0082c8' }] };
  const su = await ack(s1, 'whiteboard:update', { boardId: liveId, data: liveData, expectedVersion: 1 });
  ok('whiteboard socket update', su.ok && su.board.version === 2);
  ok('whiteboard broadcast received', await waitFor(() => updated && updated.version === 2 && updated.data.items[0].label === '테스트'));
  ok('whiteboard presence broadcast', await waitFor(() => presence && presence.boardId === liveId && presence.count >= 1), JSON.stringify(presence || {}));
  await new Promise((r) => setTimeout(r, 60));
  const conflictAck = await ack(s2, 'whiteboard:update', { boardId: liveId, data: { background: 'plain', items: [] }, expectedVersion: 1 });
  ok('whiteboard socket conflict', conflictAck.ok === true && conflictAck.conflict === true && conflictAck.board.version === 2);
  const leave = await ack(s2, 'whiteboard:leave', { boardId: liveId });
  ok('whiteboard leave', leave.ok);
  s1.close();
  s2.close();
  await jdel('/api/whiteboards/' + liveId, T1);

  // 소켓 보드 이동도 서버 PC의 텍스트 활동 로그에 남는다.
  let activityText = '';
  try {
    const logDir = path.join(TEST_DATA, 'logs');
    const logFile = fs.readdirSync(logDir).find((f) => f.startsWith('activity-') && f.endsWith('.log'));
    if (logFile) activityText = fs.readFileSync(path.join(logDir, logFile), 'utf8');
  } catch (e) { /* 로그 없음 */ }
  ok('whiteboard socket activity log', activityText.includes('whiteboard_update') && activityText.includes(liveId));

  /* ---------- 5. 전자결재 실시간 알림 ---------- */
  const sAdmin = io(BASE, { auth: { token: admin.token } });
  const sT1 = io(BASE, { auth: { token: t1.token } });
  await Promise.all([
    new Promise((res, rej) => { sAdmin.on('connect', res); sAdmin.on('connect_error', rej); setTimeout(() => rej(new Error('admin socket timeout')), 8000); }),
    new Promise((res, rej) => { sT1.on('connect', res); sT1.on('connect_error', rej); setTimeout(() => rej(new Error('t1 socket timeout')), 8000); }),
  ]);
  let newApproval = null;
  let decidedApproval = null;
  let changedApproval = null;
  sAdmin.on('approval:new', (ev) => { newApproval = ev; });
  sAdmin.on('approval:changed', (ev) => { changedApproval = ev; });
  sT1.on('approval:decided', (ev) => { decidedApproval = ev; });
  const liveApproval = await jpost('/api/approvals', { title: '실시간 결재', category: 'general', amount: 0, content: '실시간 알림 테스트' }, T1);
  ok('approval:new reaches admin', await waitFor(() => newApproval && newApproval.id === liveApproval.data.approval.id));
  const liveDecide = await jpost(`/api/approvals/${liveApproval.data.approval.id}/decide`, { action: 'approve', signature: '관리자' }, A);
  ok('approval:decided reaches requester', liveDecide.data.ok && await waitFor(() => decidedApproval && decidedApproval.id === liveApproval.data.approval.id && decidedApproval.status === 'APPROVED'));
  ok('approval:changed reaches admin', await waitFor(() => changedApproval && changedApproval.id === liveApproval.data.approval.id));
  sAdmin.close();
  sT1.close();

  const fails = results.filter((r) => !r.pass).length;
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
  kill();
  setTimeout(() => process.exit(fails === 0 ? 0 : 1), 500);
}

main().catch((e) => { console.error('FEATURE TEST ERROR', e); process.exit(1); });
