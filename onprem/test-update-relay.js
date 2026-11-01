'use strict';
/* 교내 업데이트 중계 자체 검증 — 인터넷이 되는 PC가 받은 설치본을 학교 서버에 올리고
 * 모든 교사 PC에 방송되는지 확인한다.
 * 실행: npm run test:relay */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const HERE = __dirname;
const PORT = 39518;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = path.join(HERE, '.test-update-relay-data');
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' :: ' + extra : ''));
}

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const child = spawn(process.execPath, [path.join(HERE, 'server.js')], {
    env: {
      ...process.env,
      EDUTALK_PORT: String(PORT),
      EDUTALK_DATA_DIR: path.join(TMP, 'data'),
      EDUTALK_LICENSE_PATH: path.join(TMP, 'license.key'),
      EDUTALK_LOG_DIR: path.join(TMP, 'logs'),
      BREEZE_UPDATES_DIR: path.join(TMP, 'updates'),
      EDUTALK_ADMIN_TOKEN: 'test-admin-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  const kill = () => { try { child.kill(); } catch (e) {} };
  process.on('exit', kill);

  const jget = async (p, headers) => {
    const r = await fetch(BASE + p, { headers: headers || {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const jpost = async (p, body, headers) => {
    const r = await fetch(BASE + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: JSON.stringify(body || {}),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const relay = async (man, bytes, token) => {
    const header = Buffer.from(JSON.stringify(man), 'utf8').toString('base64');
    const r = await fetch(BASE + '/api/updates/relay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-breeze-manifest': header,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: bytes,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { const j = await jget('/api/setup-state'); if (j.body.ok && j.body.done === false) { ready = true; break; } } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  ok('server boots', ready);
  if (!ready) { console.log(out.slice(-2000)); kill(); process.exit(1); }

  await jpost('/api/admin/setup/admin', { username: 'admin', real_name: '관리자', password: 'test1234' });
  await jpost('/api/admin/setup/license', { trial: true });
  const login = await jpost('/api/login', { username: 'admin', password: 'test1234' });
  ok('login', login.body.ok && !!login.body.token, login.status);
  const token = login.body.token;

  const exeName = 'Breeze-setup-9.9.9.exe';
  const bytes = crypto.randomBytes(64 * 1024);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const man = {
    version: '9.9.9', file: exeName, size: bytes.length, sha256,
    notes: '테스트 업데이트', mandatory: false, security: true, pub_date: '2026-11-01',
  };

  const noAuth = await relay(man, bytes, null);
  ok('no auth rejected', noAuth.status === 401, noAuth.status);

  const bad = await relay({ ...man, sha256: '0'.repeat(64) }, bytes, token);
  ok('bad sha rejected', bad.status === 400, bad.body.error);

  const { io } = require('socket.io-client');
  const sock = io(BASE, { auth: { token }, transports: ['websocket'] });
  const broadcast = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    sock.on('update:available', (p) => { clearTimeout(timer); resolve(p); });
  });
  await new Promise((r) => { sock.on('connect', r); setTimeout(r, 3000); });

  const good = await relay(man, bytes, token);
  ok('relay accepted', good.status === 200 && good.body.ok === true, good.body.error);
  ok('relay returns manifest', good.body.update && good.body.update.version === '9.9.9' && good.body.update.security === true);

  const latest = await jget('/api/updates/latest');
  ok('latest served', latest.status === 200 && latest.body.version === '9.9.9');
  ok('latest keeps security/manifest fields', latest.body.security === true && latest.body.size === bytes.length && latest.body.sha256 === sha256);

  const dl = await fetch(BASE + latest.body.url);
  const got = Buffer.from(await dl.arrayBuffer());
  ok('download matches uploaded bytes', dl.status === 200 && got.equals(bytes), got.length);

  const event = await broadcast;
  ok('socket update:available broadcast', !!event && event.version === '9.9.9', event && event.file);
  sock.close();

  const traversal = await relay({ ...man, file: '..\\..\\evil.exe' }, bytes, token);
  ok('path traversal rejected', traversal.status === 400, traversal.body.error);

  const latest2 = await jget('/api/updates/latest');
  ok('latest unchanged after bad relays', latest2.body.version === '9.9.9', latest2.body.version);

  kill();
  await new Promise((r) => setTimeout(r, 400));
  fs.rmSync(TMP, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  console.log('\n결과: ' + (results.length - failed.length) + ' 통과 / ' + failed.length + ' 실패');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
