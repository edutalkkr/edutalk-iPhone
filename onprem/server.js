'use strict';
/* EduTalk on-premise school LAN server: Express + Socket.io + SQLite */
/* .env(AI API 키 등)를 db 로드 전에 읽는다 — EDUTALK_DATA_DIR 같은 값도 .env로 지정 가능 */
require('./load-env').loadEnv();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { formidable } = require('formidable');
const XLSX = require('xlsx');
const cron = require('node-cron');
const { Server } = require('socket.io');

const { db, row, all, run, counts, purgeExpiredFiles, VALID_STATUS, VALID_ROLES, DATA_DIR, APP_ROOT, getKV, setKV } = require('./db');
const { getPolicyNumber, getPolicyBool } = require('./policies');
const auth = require('./auth');
const license = require('./license');
const whiteboard = require('./whiteboard');

/* ---------- 서비스/백그라운드 모드 감지 + 파일 로그 ---------- */
// Windows 서비스(node-windows)나 Electron GUI 자식 프로세스로 뜨면 콘솔이 없다.
// 콘솔 유무와 상관없이 logs/에 남겨서 원인을 추적할 수 있게 한다.
const IS_SERVICE = process.argv.includes('--service')
  || process.env.EDUTALK_RUN_AS_SERVICE === '1'
  || (!process.stdout || !process.stdout.isTTY);
const LOG_DIR = process.env.EDUTALK_LOG_DIR || path.join(APP_ROOT(), 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}
function logFilePath() {
  const d = new Date();
  const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.log`;
  return path.join(LOG_DIR, name);
}
function writeLog(level, ...args) {
  try {
    const clean = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
    const line = `[${localTsSafe(new Date())}] [${level}] ` + args.map((a) => {
      if (typeof a === 'string') return clean(a);
      try { return clean(JSON.stringify(a)); } catch (e) { return clean(String(a)); }
    }).join(' ') + '\n';
    fs.appendFileSync(logFilePath(), line);
  } catch (e) {}
}
function localTsSafe(d) {
  try {
    const t = d instanceof Date ? d : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
  } catch (e) { return new Date().toISOString(); }
}

/* ---------- 활동 로그 (사람이 읽는 텍스트) ----------
   서버 컴퓨터의 logs/activity-YYYY-MM-DD.log 에 한 줄씩 남긴다.
   비밀번호·토큰·본문은 절대 쓰지 않고, 누가·언제·어떤 API/행동을 했는지만 남긴다. */
function activityFilePath() {
  const d = new Date();
  const name = `activity-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.log`;
  return path.join(LOG_DIR, name);
}
function activityText(v) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return String(s || '').replace(/[\t\r\n]+/g, ' ').slice(0, 1200);
  } catch (e) { return ''; }
}
function writeActivity(req, action, detail) {
  try {
    const ip = String((req && req.socket && req.socket.remoteAddress) || (req && req.ip) || 'unknown').replace(/^::ffff:/, '');
    const u = (req && req.user) || {};
    const who = u.id ? `${u.id}:${u.username || u.real_name || ''}` : '-';
    const role = u.role || '-';
    const method = (req && req.method) || '-';
    const p = (req && (req._activityPath || req.originalUrl || req.path)) || '-';
    const line = [
      localTsSafe(new Date()),
      ip,
      who,
      role,
      method,
      p,
      action || '-',
      activityText(detail || ''),
    ].join('\t') + '\n';
    fs.appendFileSync(activityFilePath(), line);
  } catch (e) { /* 로그 실패가 서비스를 멈추지 않는다 */ }
}
// console.* 을 파일에도 미러링 (서비스에서 console이 없어도 죽지 않게)
try {
  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.log = (...a) => { try { origLog(...a); } catch (e) {} writeLog('INFO', ...a); };
  console.error = (...a) => { try { origErr(...a); } catch (e) {} writeLog('ERROR', ...a); };
  console.warn = (...a) => { try { origWarn(...a); } catch (e) {} writeLog('WARN', ...a); };
} catch (e) {}

const PORT = Number(process.env.EDUTALK_PORT || 3000);
const UPLOAD_DIR = process.env.EDUTALK_UPLOAD_DIR || path.join(APP_ROOT(), 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

/* ---------- 작은 유틸 ---------- */
function pad(n) { return String(n).padStart(2, '0'); }
function localTs(d) {
  const t = d instanceof Date ? d : new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
}
function uuid() { return crypto.randomUUID(); }
/* 학생 미디어만 만료일을 준다. 교사·교직원 미디어는 ''(영구 보관). */
function expiryForRole(role) {
  if (String(role || '').toUpperCase() !== 'STUDENT') return '';
  const days = Math.max(30, Math.round(getPolicyNumber('studentMediaDays') || 30));
  return localTs(new Date(Date.now() + days * 86400000));
}
function memberIdsOf(roomRow) {
  try { const a = JSON.parse(roomRow.member_ids || '[]'); return Array.isArray(a) ? a.map(Number) : []; } catch (e) { return []; }
}
function isMember(roomRow, uid) { return memberIdsOf(roomRow).includes(Number(uid)); }

/* 사설망(학내망) 대역인지 — 클라이언트 경고 모달 판단용으로도 내려준다 */
const PRIVATE_RANGES = ['10.', '172.16.', '192.168.', '127.', '::1', 'fc00:', 'fe80:'];
function isPrivateIp(ip) {
  const v = String(ip || '').toLowerCase().replace(/^::ffff:/, '');
  if (v === 'localhost') return true;
  return PRIVATE_RANGES.some((p) => v.startsWith(p.toLowerCase()));
}
function localIPv4s() {
  const out = [];
  try {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const ni of ifs[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) out.push({ iface: name, address: ni.address });
      }
    }
  } catch (e) {}
  return out;
}

/* 관리자 토큰: 환경변수 우선, 없으면 최초 1회 생성해 data 폴더에 보관 */
function adminToken() {
  if (process.env.EDUTALK_ADMIN_TOKEN) return process.env.EDUTALK_ADMIN_TOKEN;
  const p = path.join(DATA_DIR, '.admin_token');
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (raw) return raw;
  } catch (e) {}
  const t = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(p, t); } catch (e) {}
  return t;
}
const ADMIN_TOKEN = adminToken();

/* ---------- 초기 설정 잠금 ---------- */
// 관리자 계정 생성 + 이용권 등록(체험 포함)이 끝나기 전에는 채팅 API 전체 차단.
// 초기 설정은 학교 PC 본체에서만 (원격 차단) — needSetupLocal이 막는다.
function setupMarkerPath(){ return path.join(DATA_DIR, '.setup_done'); }
function isSetupDone(){
  try{ if(fs.existsSync(setupMarkerPath())) return true; }catch(e){}
  try{ const { getKV } = require('./db'); if(getKV('setup_done') === '1') return true; }catch(e){}
  return false;
}
function markSetupDone(){
  try{ fs.writeFileSync(setupMarkerPath(), localTs(new Date())); }catch(e){}
  try{ require('./db').setKV('setup_done', '1'); }catch(e){}
}
function isLoopback(req){
  try{
    const ip=String(req.ip || (req.socket && req.socket.remoteAddress) || '').toLowerCase().replace(/^::ffff:/, '');
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
  }catch(e){ return false; }
}
function maybeFinishSetup(){
  try{
    const hasAdmin=!!row("SELECT id FROM users WHERE role='ADMIN' LIMIT 1");
    const m=license.verify().mode;
    if(hasAdmin&&(m==='licensed'||m==='trial')) markSetupDone();
  }catch(e){}
}

/* ---------- Express ---------- */
const app = express();
app.set('trust proxy', false); // X-Forwarded-For를 절대 신뢰하지 않음 (loopback 판정 우회 방지)
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
/* 모든 API 요청을 서버 컴퓨터의 텍스트 활동 로그에 남긴다 (응답이 끝난 뒤 사용자 정보까지 포함). */
app.use((req, res, next) => {
  // 라우터에 마운트되면 req.path가 '/send'처럼 잘리므로, 원래 주소를 지금 붙잡아 둔다.
  const originalPath = String(req.originalUrl || req.url || '').split('?')[0];
  if (!originalPath.startsWith('/api/')) return next();
  // /api/activity 는 라우트에서 행동 이름·상세까지 직접 남기므로 중복 기록하지 않는다.
  if (originalPath === '/api/activity') return next();
  req._activityPath = originalPath;
  const started = Date.now();
  res.on('finish', () => {
    writeActivity(req, 'http', { status: res.statusCode, ms: Date.now() - started });
  });
  next();
});
/* 보안 헤더 (helmet 없이 최소 세트 — 학내망 LAN 전제) */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
/* 초경량 인메모리 레이트리밋 (의존성 없이 — exe 크기 유지) */
const __rlBuckets = new Map();
function rateLimit({ windowMs, max, message }) {
  return (req, res, next) => {
    try {
      const ip = clientIp(req);
      const now = Date.now();
      const key = `${message}:${ip}`;
      let b = __rlBuckets.get(key);
      if (!b || now - b.start > windowMs) b = { start: now, n: 0 };
      b.n++;
      __rlBuckets.set(key, b);
      if (__rlBuckets.size > 5000) {
        for (const [k, v] of __rlBuckets) { if (now - v.start > windowMs) __rlBuckets.delete(k); }
      }
      if (b.n > max) return res.status(429).json({ ok: false, error: message || '너무 자주 시도했어요. 잠시 뒤 다시 해 주세요.' });
      next();
    } catch (e) { next(); }
  };
}
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: '로그인을 너무 자주 시도했어요. 1분 뒤 다시 해 주세요.' });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, message: '요청이 너무 많아요. 잠시 뒤 다시 해 주세요.' });
const setupLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: '너무 자주 시도했어요. 잠시 뒤 다시 해 주세요.' });
const activityLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, message: '요청이 너무 많아요. 잠시 뒤 다시 해 주세요.' });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: 'AI 요청이 너무 많아요. 1분 뒤 다시 시도해 주세요.' });
const collabLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, message: '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.' });
function clientIp(req) {
  try {
    const raw = String((req.socket && req.socket.remoteAddress) || req.ip || '').toLowerCase().replace(/^::ffff:/, '');
    return raw || 'unknown';
  } catch (e) { return 'unknown'; }
}
app.use((req, res, next) => {
  // 학내망 LAN(휴대폰 앱 포함)에서 바로 붙을 수 있게 CORS 허용 — 외부 공개용이 아님
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// 설정이 끝나기 전에는 관리 페이지·초기 설정 외 API를 모두 막는다 (소켓은 핸드셰이크에서 막음)
app.use((req, res, next) => {
  try{
    if(isSetupDone()) return next();
    if(req.path === '/admin' || req.path === '/api/setup-state') return next();
    if(req.path.indexOf('/api/updates') === 0) return next(); // OTA는 설정 전에도 열어 둔다
    if(req.path.indexOf('/api/admin/setup/') === 0) return next();
    if(req.path.indexOf('/socket.io/') === 0) return next();
    if(req.path.indexOf('/api/') === 0){
      return res.status(503).json({ ok:false, setupRequired:true, error:'관리자 초기 설정이 필요해요. 학교 PC에서 관리 페이지를 열어 주세요.' });
    }
  }catch(e){}
  next();
});
app.use(licenseGate);

function needAuth(req, res, next) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : String(req.query.token || req.body.token || '');
  const u = auth.userByToken(token);
  if (!u) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });
  req.user = u;
  req.token = token;
  next();
}
/* 학생 계정은 교사용 기능(조직도·채팅방·인쇄·나이스·AI 등)에 접근할 수 없다. */
function needStaff(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });
    if (String(req.user.role || '').toUpperCase() === 'STUDENT') {
      return res.status(403).json({ ok: false, error: '선생님 계정에서만 사용할 수 있는 기능이에요.' });
    }
    next();
  } catch (e) { return res.status(403).json({ ok: false, error: '권한을 확인하지 못했어요.' }); }
}

/* 라이선스 인원 상한 (0 = 무제한). 학생/교직원 모두 포함해 센다. */
function licenseUserLimit() {
  try { return Number(license.verify().maxUsers || 0); } catch (e) { return 0; }
}
function userCount() {
  try { return Number((row('SELECT COUNT(*) c FROM users') || {}).c) || 0; } catch (e) { return 0; }
}
function userQuota() {
  const max = licenseUserLimit();
  const used = userCount();
  return { max, used, left: max > 0 ? Math.max(0, max - used) : null };
}

function needAdmin(req, res, next) {
  // 타이밍 공격 방지: 고정 시간 비교
  try {
    const got = String(req.headers['x-admin-token'] || '');
    const want = String(ADMIN_TOKEN || '');
    const a = Buffer.from(got, 'utf8');
    const b = Buffer.from(want, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ ok: false, error: '관리자 토큰이 필요해요.' });
    }
  } catch (e) {
    return res.status(403).json({ ok: false, error: '관리자 토큰이 필요해요.' });
  }
  next();
}
/* 관리자·계정 보안 동작 감사 기록 (실패해도 원래 동작은 막지 않는다). */
function writeServerAudit(req, actorId, actorName, action, targetType, targetId, detail) {
  try {
    run(
      `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      String(actorId == null ? 'system' : actorId),
      String(actorName || ''),
      String(action),
      String(targetType || ''),
      String(targetId == null ? '' : targetId),
      JSON.stringify(detail || {}),
      String((req && req.ip) || '')
    );
  } catch (e) { /* 감사 기록 실패는 본 동작을 막지 않는다. */ }
}

/* 이용권 강제: 설정 완료 후에도 매 요청마다 라이선스 확인.
 * licensed/trial이 아니면 인증 API·채팅 API 전체 차단 (관리자 갱신 경로만 허용).
 * → 이용권 없으면 서버가 켜져 있어도 절대 동작 안 함. */
function licenseGate(req, res, next) {
  try {
    if (!isSetupDone()) return next(); // 설정 전은 기존 setup 게이트가 처리
    if (req.path === '/admin' || req.path === '/student' || req.path.indexOf('/student/') === 0 || req.path === '/api/setup-state' || req.path === '/api/public-info') return next();
    if (req.path.indexOf('/api/updates') === 0) return next(); // 이용권과 무관하게 갱신 가능
    if (req.path.indexOf('/api/admin/') === 0) return next(); // 갱신용 (토큰 필요)
    if (req.path.indexOf('/socket.io/') === 0) return next(); // 소켓은 핸드셰이크에서 차단
    if (req.path.indexOf('/api/') === 0) {
      const m = license.verify().mode;
      if (m !== 'licensed' && m !== 'trial') {
        return res.status(403).json({ ok: false, licenseRequired: true, error: '이용권이 만료됐어요. 관리 페이지에서 이용권을 갱신해 주세요.' });
      }
    }
  } catch (e) {}
  next();
}

/* ---------- 공개/인증 API ---------- */
/* /api/auth/login은 문서·신규 클라이언트용 별칭 (설계서 §3.1) */
app.post(['/api/login', '/api/auth/login'], loginLimiter, (req, res) => {
  try {
    const body = req.body || {};
    const suppliedSchool = String(body.schoolCode || body.school_code || '').trim();
    const school = license.schoolIdentity();
    // 학교 코드가 설정된 서버라면, 코드를 보낸 경우 반드시 일치해야 한다.
    if (suppliedSchool && school.code && suppliedSchool.toUpperCase() !== school.code.toUpperCase()) {
      return setTimeout(() => res.status(403).json({
        ok: false, schoolMismatch: true,
        error: `학교 코드가 서버와 맞지 않아요. 이 서버의 학교 코드는 '${school.code}'예요.`,
      }), 300);
    }
    const r = auth.login(body.username, body.password);
    if (!r) {
      // 무차별 대입 완화: 실패 응답을 일부러 늦춤
      return setTimeout(() => res.status(401).json({ ok: false, error: '사번(학번)이나 비밀번호를 확인해 주세요.' }), 600);
    }
    // 학생은 학교 코드를 반드시 확인한다 (다른 학교 서버에 붙는 실수 방지)
    if (String(r.user.role || '').toUpperCase() === 'STUDENT' && school.code
        && suppliedSchool.toUpperCase() !== school.code.toUpperCase()) {
      auth.logout(r.token);
      return res.status(403).json({ ok: false, schoolMismatch: true, error: '학생은 학교 코드를 입력해야 해요.' });
    }
    try { run("UPDATE users SET status='ONLINE', status_message='' WHERE id=?", r.user.id); } catch (e) {}
    res.json({ ok: true, token: r.token, user: r.user, school: { code: school.code, name: school.name } });
  } catch (e) { res.status(500).json({ ok: false, error: '로그인 처리 중 문제가 생겼어요.' }); }
});

app.post('/api/logout', needAuth, (req, res) => {
  try { run("UPDATE users SET status='OFFLINE' WHERE id=?", req.user.id); } catch (e) {}
  auth.logout(req.token);
  res.json({ ok: true });
});

app.get('/api/me', needAuth, (req, res) => res.json({ ok: true, user: req.user }));

/* 화면에서 일어난 행동(인수인계·퀵 메모·클라우드 등)을 서버 컴퓨터 텍스트 로그에 남긴다. */
app.post('/api/activity', activityLimiter, needAuth, (req, res) => {
  try {
    const action = String((req.body || {}).action || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80);
    if (!action) return res.status(400).json({ ok: false, error: '기록할 행동 이름이 필요해요.' });
    let detail = (req.body || {}).detail;
    if (detail != null && typeof detail !== 'object') detail = String(detail);
    writeActivity(req, action, detail || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: '활동을 기록하지 못했어요.' });
  }
});

/* 내 비밀번호 변경 — 현재 비밀번호를 확인하고, 다른 기기의 세션은 폐기한다. */
app.post('/api/me/password', loginLimiter, needAuth, (req, res) => {
  try {
    const cur = String((req.body || {}).currentPassword || (req.body || {}).current_password || '');
    const next = String((req.body || {}).newPassword || (req.body || {}).new_password || '');
    if (!cur || !next) return res.status(400).json({ ok: false, error: '현재 비밀번호와 새 비밀번호를 입력해 주세요.' });
    if (next.length < 8 || next.length > 128) return res.status(400).json({ ok: false, error: '새 비밀번호는 8~128자로 정해 주세요.' });
    if (cur === next) return res.status(400).json({ ok: false, error: '이전과 다른 비밀번호를 써 주세요.' });
    const u = row('SELECT id, password_hash FROM users WHERE id = ?', req.user.id);
    if (!u || !auth.verifyPassword(cur, u.password_hash)) {
      // 인증 토큰 자체는 유효하므로 401을 쓰지 않는다 (클라이언트가 세션 만료로 오해하지 않게).
      return res.status(400).json({ ok: false, error: '현재 비밀번호가 맞지 않아요.' });
    }
    run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(next), req.user.id);
    // 현재 기기만 유지하고 나머지 세션은 로그아웃시킨다.
    run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', req.user.id, req.token);
    writeServerAudit(req, req.user.id, req.user.real_name || req.user.username, 'user_password_change', 'user', req.user.id, { username: req.user.username || '' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: '비밀번호를 바꾸지 못했어요.' }); }
});

app.get('/api/network-info', (req, res) => {
  res.json({ ok: true, serverIps: localIPv4s(), port: PORT, privateRanges: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] });
});

/* 유료 듀얼 가능 여부 공개 정보 (민감 정보 없음 — 앱의 듀얼 모드 선택용) */
app.get('/api/public-info', (req, res) => {
  try {
    const lic = license.verify();
    const school = license.schoolIdentity();
    res.json({
      ok: true,
      dual: lic.licensed && lic.isPaidDualNetworkActive === true,
      school: school.name || lic.school || '',
      schoolCode: school.code,
      schoolName: school.name || lic.school || '',
      schoolConfigured: !school.generated,
      studentMediaDays: Math.max(1, Math.round(getPolicyNumber('studentMediaDays') || 30)),
      version: '1.0.0',
      now: localTs(new Date()),
    });
  } catch (e) { res.status(500).json({ ok: false, error: '정보를 불러오지 못했어요.' }); }
});

/* 조직도 트리 */
app.get('/api/departments/tree', needAuth, needStaff, (req, res) => {
  try {
    const deps = all('SELECT * FROM departments ORDER BY order_index, id');
    const users = all("SELECT id, username, real_name, department_id, status, status_message, role FROM users WHERE role != 'STUDENT' ORDER BY real_name");
    const byParent = new Map();
    deps.forEach((d) => {
      const k = d.parent_id == null ? 0 : d.parent_id;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push({ ...d, children: [], members: [] });
    });
    const map = new Map();
    deps.forEach((d) => map.set(d.id, (byParent.get(d.parent_id == null ? 0 : d.parent_id) || []).find((x) => x.id === d.id)));
    users.forEach((u) => {
      const node = map.get(u.department_id);
      if (node) node.members.push(u);
    });
    const build = (pid) => (byParent.get(pid) || []).map((n) => ({ ...n, children: build(n.id) }));
    res.json({ ok: true, tree: build(0), unassigned: users.filter((u) => !map.get(u.department_id)) });
  } catch (e) { res.status(500).json({ ok: false, error: '조직도를 불러오지 못했어요.' }); }
});

app.get('/api/users', needAuth, needStaff, (req, res) => {
  try {
    res.json({ ok: true, users: all("SELECT id, username, real_name, department_id, status, status_message, role FROM users WHERE role != 'STUDENT' ORDER BY real_name") });
  } catch (e) { res.status(500).json({ ok: false, error: '사용자를 불러오지 못했어요.' }); }
});

/* 학생용 선생님 목록 — 학생 웹에서만 사용. 학생 계정 정보는 노출하지 않는다. */
app.get('/api/student/teachers', needAuth, (req, res) => {
  try {
    if (String(req.user.role || '').toUpperCase() !== 'STUDENT') {
      return res.status(403).json({ ok: false, error: '학생 계정에서만 사용할 수 있어요.' });
    }
    const teachers = all(
      `SELECT u.id, u.real_name, u.status, u.status_message, u.role,
              d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.role IN ('TEACHER', 'STAFF')
       ORDER BY CASE u.role WHEN 'TEACHER' THEN 0 ELSE 1 END,
                COALESCE(d.name, ''), u.real_name`
    );
    res.json({ ok: true, teachers });
  } catch (e) { res.status(500).json({ ok: false, error: '선생님 목록을 불러오지 못했어요.' }); }
});

/* 채팅방 */
app.get('/api/rooms', needAuth, needStaff, (req, res) => {
  try {
    const rooms = all('SELECT * FROM rooms ORDER BY created_at DESC').filter((r) => isMember(r, req.user.id));
    res.json({ ok: true, rooms: rooms.map((r) => ({ ...r, member_ids: memberIdsOf(r) })) });
  } catch (e) { res.status(500).json({ ok: false, error: '채팅방을 불러오지 못했어요.' }); }
});

app.post('/api/rooms', needAuth, needStaff, (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ ok: false, error: '방 이름을 적어 주세요.' });
    const staffIds = new Set(all("SELECT id FROM users WHERE role != 'STUDENT'").map((u) => Number(u.id)));
    let members = Array.isArray(req.body.member_ids) ? req.body.member_ids.map(Number).filter((id) => staffIds.has(id)) : [];
    if (!members.includes(req.user.id)) members.push(req.user.id);
    const id = uuid();
    run('INSERT INTO rooms (id, name, network_type, member_ids, created_by) VALUES (?, ?, ?, ?, ?)',
      id, name, 'INTERNAL', JSON.stringify([...new Set(members)]), req.user.id);
    res.json({ ok: true, room: { id, name, network_type: 'INTERNAL' } });
  } catch (e) { res.status(500).json({ ok: false, error: '채팅방을 만들지 못했어요.' }); }
});

/* 방 1개 (참여자만) */
app.get('/api/rooms/:id', needAuth, (req, res) => {
  try {
    const room = row('SELECT * FROM rooms WHERE id = ?', req.params.id);
    if (!room || !memberIdsOf(room).includes(Number(req.user.id))) return res.status(403).json({ ok: false, error: '들어갈 수 있는 방이 아니에요.' });
    res.json({ ok: true, room: { ...room, member_ids: memberIdsOf(room) } });
  } catch (e) { res.status(500).json({ ok: false, error: '채팅방을 불러오지 못했어요.' }); }
});

function needRoomMember(req, res, next) {
  try {
    if (String((req.user || {}).role || '').toUpperCase() === 'STUDENT') {
      return res.status(403).json({ ok: false, error: '선생님 계정에서만 사용할 수 있는 기능이에요.' });
    }
    const room = row('SELECT * FROM rooms WHERE id = ?', req.params.id);
    if (!room || !memberIdsOf(room).includes(Number(req.user.id))) {
      return res.status(403).json({ ok: false, error: '들어갈 수 있는 방이 아니에요.' });
    }
    req.room = room;
    next();
  } catch (e) { res.status(500).json({ ok: false, error: '채팅방을 불러오지 못했어요.' }); }
}

/* 방 파일함 */
app.get('/api/rooms/:id/files', needAuth, needRoomMember, (req, res) => {
  try {
    const rows = all(`SELECT f.id, f.original_name, f.stored_filename, f.file_size, f.expires_at, f.created_at, m.sender_id
      FROM files f LEFT JOIN messages m ON m.id = f.message_id
      WHERE m.room_id = ? ORDER BY f.id DESC LIMIT 100`, req.room.id);
    res.json({ ok: true, files: rows });
  } catch (e) { res.status(500).json({ ok: false, error: '파일을 불러오지 못했어요.' }); }
});

/* 방 내 메시지 검색 */
app.get('/api/rooms/:id/search', needAuth, needRoomMember, (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 40);
    if (!q) return res.json({ ok: true, messages: [] });
    const rows = all(`SELECT m.*, u.real_name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.room_id = ? AND m.is_recalled = 0 AND m.content LIKE ? ORDER BY m.id DESC LIMIT 50`, req.room.id, `%${q}%`);
    res.json({ ok: true, messages: rows });
  } catch (e) { res.status(500).json({ ok: false, error: '검색하지 못했어요.' }); }
});

/* 할 일 */
app.get('/api/rooms/:id/todos', needAuth, needRoomMember, (req, res) => {
  try {
    res.json({ ok: true, todos: all('SELECT * FROM todos WHERE room_id = ? ORDER BY id ASC LIMIT 200', req.room.id) });
  } catch (e) { res.status(500).json({ ok: false, error: '할 일을 불러오지 못했어요.' }); }
});
app.post('/api/rooms/:id/todos', needAuth, needRoomMember, (req, res) => {
  try {
    const text = String((req.body || {}).text || '').trim().slice(0, 200);
    if (!text) return res.status(400).json({ ok: false, error: '할 일을 적어 주세요.' });
    const r = run('INSERT INTO todos (room_id, text, created_by) VALUES (?, ?, ?)', req.room.id, text, req.user.id);
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) { res.status(500).json({ ok: false, error: '할 일을 추가하지 못했어요.' }); }
});
app.post('/api/todos/:tid/toggle', needAuth, (req, res) => {
  try {
    const t = row('SELECT * FROM todos WHERE id = ?', Number(req.params.tid));
    if (!t) return res.status(404).json({ ok: false, error: '할 일을 찾지 못했어요.' });
    const room = row('SELECT * FROM rooms WHERE id = ?', t.room_id);
    if (!room || !memberIdsOf(room).includes(Number(req.user.id))) return res.status(403).json({ ok: false, error: '볼 수 있는 방이 아니에요.' });
    if (t.done) run('UPDATE todos SET done = 0, done_by = NULL, done_by_name = ? WHERE id = ?', '', t.id);
    else run('UPDATE todos SET done = 1, done_by = ?, done_by_name = ? WHERE id = ?', req.user.id, req.user.real_name || '사용자', t.id);
    res.json({ ok: true, done: !t.done });
  } catch (e) { res.status(500).json({ ok: false, error: '바꾸지 못했어요.' }); }
});
app.delete('/api/todos/:tid', needAuth, (req, res) => {
  try {
    const t = row('SELECT * FROM todos WHERE id = ?', Number(req.params.tid));
    if (!t) return res.status(404).json({ ok: false, error: '할 일을 찾지 못했어요.' });
    const room = row('SELECT * FROM rooms WHERE id = ?', t.room_id);
    if (!room || !memberIdsOf(room).includes(Number(req.user.id))) return res.status(403).json({ ok: false, error: '볼 수 있는 방이 아니에요.' });
    if (Number(t.created_by) !== Number(req.user.id) && Number(room.created_by) !== Number(req.user.id) && req.user.role !== 'ADMIN') {
      return res.status(403).json({ ok: false, error: '지울 수 없어요.' });
    }
    run('DELETE FROM todos WHERE id = ?', t.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: '지우지 못했어요.' }); }
});

/* 출석 (하루 1세션) */
function todayId(d) {
  const t = d || new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
app.get('/api/rooms/:id/attendance/today', needAuth, needRoomMember, (req, res) => {
  try {
    const s = row('SELECT * FROM attendance WHERE roomId = ? AND date = ?', req.room.id, todayId());
    if (!s) return res.json({ ok: true, session: null });
    let present = []; try { present = JSON.parse(s.present || '[]'); } catch (e) {}
    res.json({ ok: true, session: { ...s, present } });
  } catch (e) { res.status(500).json({ ok: false, error: '출석을 불러오지 못했어요.' }); }
});
app.post('/api/rooms/:id/attendance/start', needAuth, needRoomMember, (req, res) => {
  try {
    const ex = row('SELECT * FROM attendance WHERE roomId = ? AND date = ?', req.room.id, todayId());
    if (ex) return res.json({ ok: true, session: ex, existed: true });
    run('INSERT INTO attendance (roomId, date, open, byUid, byName, present) VALUES (?, ?, 1, ?, ?, ?)',
      req.room.id, todayId(), req.user.id, req.user.real_name || '사용자', '[]');
    res.json({ ok: true, existed: false });
  } catch (e) { res.status(500).json({ ok: false, error: '출석을 시작하지 못했어요.' }); }
});
app.post('/api/rooms/:id/attendance/mark', needAuth, needRoomMember, (req, res) => {
  try {
    const s = row('SELECT * FROM attendance WHERE roomId = ? AND date = ?', req.room.id, todayId());
    if (!s || !s.open) return res.status(400).json({ ok: false, error: '출석이 마감됐어요.' });
    let present = []; try { present = JSON.parse(s.present || '[]'); } catch (e) {}
    if (!present.map(Number).includes(Number(req.user.id))) {
      present.push(req.user.id);
      run('UPDATE attendance SET present = ? WHERE roomId = ? AND date = ?', JSON.stringify(present), req.room.id, todayId());
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: '출석하지 못했어요.' }); }
});
app.post('/api/rooms/:id/attendance/close', needAuth, needRoomMember, (req, res) => {
  try {
    const s = row('SELECT * FROM attendance WHERE roomId = ? AND date = ?', req.room.id, todayId());
    if (!s) return res.status(404).json({ ok: false, error: '출석이 없어요.' });
    if (Number(s.byUid) !== Number(req.user.id) && req.user.role !== 'ADMIN' && Number(req.room.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ ok: false, error: '시작한 사람만 마감할 수 있어요.' });
    }
    run('UPDATE attendance SET open = 0 WHERE roomId = ? AND date = ?', req.room.id, todayId());
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: '마감하지 못했어요.' }); }
});

/* 참여자 추가 (만든 사람·내부 관리자만) */
app.post('/api/rooms/:id/members', needAuth, (req, res) => {
  try {
    const room = row('SELECT * FROM rooms WHERE id = ?', req.params.id);
    if (!room) return res.status(404).json({ ok: false, error: '채팅방을 찾지 못했어요.' });
    if (Number(room.created_by) !== Number(req.user.id) && req.user.role !== 'ADMIN') {
      return res.status(403).json({ ok: false, error: '방을 만든 사람만 초대할 수 있어요.' });
    }
    const ids = [...new Set([...memberIdsOf(room), ...(Array.isArray(req.body.user_ids) ? req.body.user_ids.map(Number).filter(Boolean) : [])])].slice(0, 500);
    run('UPDATE rooms SET member_ids = ? WHERE id = ?', JSON.stringify(ids), room.id);
    res.json({ ok: true, count: ids.length });
  } catch (e) { res.status(500).json({ ok: false, error: '초대하지 못했어요.' }); }
});

/* 방 나가기 (본인만 — 멤버 목록에서 자신을 빼고, 방이 비면 방도 지운다) */
app.delete('/api/rooms/:id/members/me', needAuth, (req, res) => {
  try {
    const room = row('SELECT * FROM rooms WHERE id = ?', req.params.id);
    if (!room) return res.status(404).json({ ok: false, error: '채팅방을 찾지 못했어요.' });
    const ids = memberIdsOf(room).filter((x) => x !== Number(req.user.id));
    if (!ids.length) {
      run('DELETE FROM rooms WHERE id = ?', room.id);
    } else {
      run('UPDATE rooms SET member_ids = ? WHERE id = ?', JSON.stringify(ids), room.id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: '나가지 못했어요.' }); }
});

/* 방 삭제 (만든 사람·내부 관리자만) */
app.delete('/api/rooms/:id', needAuth, (req, res) => {
  try {
    const room = row('SELECT * FROM rooms WHERE id = ?', req.params.id);
    if (!room) return res.status(404).json({ ok: false, error: '채팅방을 찾지 못했어요.' });
    if (Number(room.created_by) !== Number(req.user.id) && req.user.role !== 'ADMIN') {
      return res.status(403).json({ ok: false, error: '방을 만든 사람만 지울 수 있어요.' });
    }
    run('DELETE FROM rooms WHERE id = ?', room.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: '지우지 못했어요.' }); }
});

app.get('/api/rooms/:id/messages', needAuth, (req, res) => {
  try {
    const room = row('SELECT * FROM rooms WHERE id = ?', req.params.id);
    if (!room || !isMember(room, req.user.id)) return res.status(403).json({ ok: false, error: '들어갈 수 있는 방이 아니에요.' });
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const before = Number(req.query.before || 0);
    const base = 'SELECT m.*, f.id AS file_id, f.original_name AS file_name, f.file_size AS file_size FROM messages m LEFT JOIN files f ON f.message_id = m.id';
    const rows = before
      ? all(base + ' WHERE m.room_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?', room.id, before, limit)
      : all(base + ' WHERE m.room_id = ? ORDER BY m.id DESC LIMIT ?', room.id, limit);
    // 투표 정의 + 집계 (있으면 메시지에 붙여서 내려준다)
    try {
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        const polls = {};
        all(`SELECT * FROM polls WHERE message_id IN (${ph})`, ...ids).forEach((p) => {
          let opts = []; try { opts = JSON.parse(p.opts || '[]'); } catch (e) {}
          polls[p.message_id] = { q: p.q || '', opts, closed: !!p.closed };
        });
        const counts = {}, mine = {};
        all(`SELECT message_id, user_id, choices FROM poll_votes WHERE message_id IN (${ph})`, ...ids).forEach((v) => {
          let ch = []; try { ch = JSON.parse(v.choices || '[]'); } catch (e) {}
          const n = (polls[v.message_id] && polls[v.message_id].opts.length) || 0;
          if (!counts[v.message_id]) counts[v.message_id] = new Array(n).fill(0);
          ch.filter((x) => Number.isInteger(x) && x >= 0 && x < n).forEach((i) => counts[v.message_id][i]++);
          if (Number(v.user_id) === Number(req.user.id)) mine[v.message_id] = ch;
        });
        rows.forEach((r) => {
          if (polls[r.id]) {
            r.poll_q = polls[r.id].q; r.poll_opts = polls[r.id].opts; r.poll_closed = polls[r.id].closed ? 1 : 0;
            r.poll_counts = counts[r.id] || []; r.poll_mine = mine[r.id] || [];
          }
        });
      }
    } catch (e) {}
    res.json({ ok: true, messages: rows.reverse() });
  } catch (e) { res.status(500).json({ ok: false, error: '메시지를 불러오지 못했어요.' }); }
});

/* 읽음/안읽음 명단 */
app.get('/api/messages/:id/reads', needAuth, (req, res) => {
  try {
    const m = row('SELECT * FROM messages WHERE id = ?', Number(req.params.id));
    if (!m) return res.status(404).json({ ok: false, error: '메시지를 찾지 못했어요.' });
    const room = row('SELECT * FROM rooms WHERE id = ?', m.room_id);
    if (!room || !isMember(room, req.user.id)) return res.status(403).json({ ok: false, error: '볼 수 있는 방이 아니에요.' });
    const reads = all(`SELECT r.user_id, r.read_at, u.real_name FROM message_reads r LEFT JOIN users u ON u.id = r.user_id WHERE r.message_id = ?`, m.id);
    const readIds = new Set(reads.map((r) => r.user_id));
    const unread = memberIdsOf(room)
      .filter((uid) => !readIds.has(uid))
      .map((uid) => { const u = row('SELECT id, real_name FROM users WHERE id = ?', uid); return { user_id: uid, real_name: (u || {}).real_name || '사용자' }; });
    res.json({ ok: true, read: reads, unread });
  } catch (e) { res.status(500).json({ ok: false, error: '읽음 정보를 불러오지 못했어요.' }); }
});

/* 파일 업로드 파싱 (formidable — 유지보수 중인 것만 사용) */
function parseMultipart(req, maxFileSize) {
  const cap = maxFileSize || 100 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    try {
      const form = formidable({
        uploadDir: UPLOAD_DIR,
        keepExtensions: false,
        maxFileSize: cap,
        maxTotalFileSize: cap + 1024 * 1024,
      });
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        const arr = files && files.file;
        resolve({ fields: fields || {}, file: Array.isArray(arr) ? arr[0] || null : arr || null });
      });
    } catch (e) { reject(e); }
  });
}
app.post('/api/upload', needAuth, needStaff, async (req, res) => {
  let parsed = null;
  try {
    // 관리자 정책: 1회 업로드 최대 크기 (기본 100MB — admin.html에서 조절)
    const capMB = Math.max(1, Math.round(getPolicyNumber('uploadMaxMB') || 100));
    parsed = await parseMultipart(req, capMB * 1024 * 1024);
  }
  catch (e) { return res.status(400).json({ ok: false, error: '파일을 읽지 못했어요.' }); }
  const f = parsed.file;
  try {
    if (!f || !f.filepath) return res.status(400).json({ ok: false, error: '파일을 골라 주세요.' });
    const ext = path.extname(f.originalFilename || '').slice(0, 12).toLowerCase();
    // 실행 파일 업로드 차단 (우회 실행·유포 방지). 필요시 EDUTALK_ALLOW_EXECUTABLES=1 로 허용
    if (process.env.EDUTALK_ALLOW_EXECUTABLES !== '1') {
      const BLOCKED = new Set(['.exe', '.msi', '.bat', '.cmd', '.ps1', '.js', '.jse', '.vbs', '.vbe', '.scr', '.com', '.pif', '.jar', '.dll']);
      if (BLOCKED.has(ext)) return res.status(400).json({ ok: false, error: '보안상 실행 파일은 올릴 수 없어요.' });
    }
    const stored = uuid() + ext;
    try { fs.renameSync(f.filepath, path.join(UPLOAD_DIR, stored)); } catch (e) {
      return res.status(500).json({ ok: false, error: '파일을 저장하지 못했어요.' });
    }
    /* 교사·교직원 파일은 영구 보관한다. (학생 미디어만 아래 별도 API에서 만료일을 준다) */
    const r = run('INSERT INTO files (message_id, original_name, stored_filename, file_size, expires_at, owner_id, owner_role) VALUES (NULL, ?, ?, ?, ?, ?, ?)',
      f.originalFilename || '파일', stored, f.size || 0, '', req.user.id, String(req.user.role || '').toUpperCase());
    res.json({ ok: true, fileId: Number(r.lastInsertRowid), stored_filename: stored, expires_at: '' });
  } catch (e) { res.status(500).json({ ok: false, error: '파일을 올리지 못했어요.' }); }
  finally { try { if (f && f.filepath && fs.existsSync(f.filepath)) fs.unlinkSync(f.filepath); } catch (e) {} }
});

/* 학생이 쪽지에 첨부할 사진·동영상·파일. 30일 뒤 물리 파일과 DB 행을 함께 지운다. */
app.post('/api/student/media', needAuth, async (req, res) => {
  let parsed = null;
  try {
    if (String(req.user.role || '').toUpperCase() !== 'STUDENT') {
      return res.status(403).json({ ok: false, error: '학생 계정에서만 쓸 수 있는 첨부예요.' });
    }
    const capMB = Math.max(1, Math.round(getPolicyNumber('uploadMaxMB') || 100));
    parsed = await parseMultipart(req, capMB * 1024 * 1024);
  } catch (e) {
    return res.status(400).json({ ok: false, error: '파일을 읽지 못했어요. 용량을 확인해 주세요.' });
  }
  const f = parsed.file;
  try {
    if (!f || !f.filepath) return res.status(400).json({ ok: false, error: '파일을 골라 주세요.' });
    const ext = path.extname(f.originalFilename || '').slice(0, 12).toLowerCase();
    if (process.env.EDUTALK_ALLOW_EXECUTABLES !== '1') {
      const BLOCKED = new Set(['.exe', '.msi', '.bat', '.cmd', '.ps1', '.js', '.jse', '.vbs', '.vbe', '.scr', '.com', '.pif', '.jar', '.dll']);
      if (BLOCKED.has(ext)) return res.status(400).json({ ok: false, error: '보안상 실행 파일은 올릴 수 없어요.' });
    }
    const stored = uuid() + ext;
    try { fs.renameSync(f.filepath, path.join(UPLOAD_DIR, stored)); } catch (e) {
      return res.status(500).json({ ok: false, error: '파일을 저장하지 못했어요.' });
    }
    const expires = expiryForRole('STUDENT');
    const r = run('INSERT INTO files (message_id, original_name, stored_filename, file_size, expires_at, owner_id, owner_role) VALUES (NULL, ?, ?, ?, ?, ?, ?)',
      f.originalFilename || '파일', stored, f.size || 0, expires, req.user.id, 'STUDENT');
    res.json({ ok: true, fileId: Number(r.lastInsertRowid), stored_filename: stored, expires_at: expires });
  } catch (e) { res.status(500).json({ ok: false, error: '파일을 올리지 못했어요.' }); }
  finally { try { if (f && f.filepath && fs.existsSync(f.filepath)) fs.unlinkSync(f.filepath); } catch (e) {} }
});

/* 파일 내려받기 — 올린 사람, 쪽지 발신자·수신자, 같은 방 참여자만.
 * 만료일이 있는 파일(학생 미디어)만 기한을 검사한다. 교사 미디어('')는 영구 보관. */
app.get('/api/files/:id', needAuth, (req, res) => {
  try {
    const f = row('SELECT * FROM files WHERE id = ?', Number(req.params.id));
    if (!f) return res.status(404).json({ ok: false, error: '파일을 찾지 못했어요.' });
    const role = String(req.user.role || '').toUpperCase();
    const uid = Number(req.user.id);
    let allowed = role !== 'STUDENT' || Number(f.owner_id) === uid;
    if (!allowed && f.note_id) {
      const note = row('SELECT id, sender_id FROM notes WHERE id = ?', Number(f.note_id));
      if (note) {
        allowed = Number(note.sender_id) === uid || !!row('SELECT 1 FROM note_recipients WHERE note_id = ? AND recipient_id = ? LIMIT 1', Number(f.note_id), uid);
      }
    }
    if (!allowed && f.message_id) {
      const msg = row('SELECT room_id FROM messages WHERE id = ?', Number(f.message_id));
      const room = msg ? row('SELECT * FROM rooms WHERE id = ?', Number(msg.room_id)) : null;
      allowed = !!room && isMember(room, uid);
    }
    if (!allowed) return res.status(403).json({ ok: false, error: '이 파일을 볼 수 없어요.' });
    if (f.expires_at && String(f.expires_at) <= localTs(new Date())) {
      return res.status(410).json({ ok: false, error: '보관 기간이 지나 자동으로 삭제된 파일이에요.' });
    }
    const p = path.join(UPLOAD_DIR, path.basename(f.stored_filename));
    if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: '파일이 없어요.' });
    res.download(p, f.original_name || '파일');
  } catch (e) { res.status(500).json({ ok: false, error: '파일을 내려받지 못했어요.' }); }
});

/* ---------- 초기 설정 (학교 PC 본체에서만, 설정 완료 전 1회) ---------- */
app.get('/api/setup-state', (req, res) => {
  try{
    res.json({ ok:true, done:isSetupDone(), hasAdmin:!!row("SELECT id FROM users WHERE role='ADMIN' LIMIT 1"), license:license.verify().mode });
  }catch(e){ res.json({ ok:true, done:false }); }
});
function needSetupLocal(req, res, next){
  if(isSetupDone()) return res.status(400).json({ ok:false, error:'이미 설정이 끝났어요.' });
  if(!isLoopback(req)) return res.status(403).json({ ok:false, error:'학교 PC 본체에서만 초기 설정을 할 수 있어요.' });
  next();
}
app.post('/api/admin/setup/admin', setupLimiter, needSetupLocal, (req, res) => {
  try{
    if(row("SELECT id FROM users WHERE role='ADMIN' LIMIT 1")) return res.status(400).json({ ok:false, error:'관리자가 이미 있어요.' });
    const username=String(((req.body||{}).username)||'').trim();
    const realName=String(((req.body||{}).real_name)||'').trim()||'관리자';
    const pw=String(((req.body||{}).password)||'');
    if(!/^[A-Za-z0-9._-]{3,20}$/.test(username)) return res.status(400).json({ ok:false, error:'사번은 3~20자 영문·숫자로 적어 주세요.' });
    if(pw.length<4) return res.status(400).json({ ok:false, error:'비밀번호는 4자 이상으로 정해 주세요.' });
    run('INSERT INTO users (username, real_name, password_hash, role, status) VALUES (?,?,?,?,?)', username, realName, auth.hashPassword(pw), 'ADMIN', 'OFFLINE');
    try{ maybeFinishSetup(); }catch(e){}
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:'만들지 못했어요.' + (String((e&&e.message)||'').includes('UNIQUE')?' 이미 있는 사번이에요.':'') }); }
});
app.post('/api/admin/setup/license', setupLimiter, needSetupLocal, (req, res) => {
  try{
    const key=String(((req.body||{}).key)||'').trim();
    const trial=!!(req.body||{}).trial;
    if(key){ license.writeKeyFile(key); }
    else if(!trial) return res.status(400).json({ ok:false, error:'키를 넣거나 체험을 선택해 주세요.' });
    const v=license.verify();
    if(v.mode!=='licensed'&&v.mode!=='trial') return res.status(400).json({ ok:false, error:v.message||'라이선스가 올바르지 않아요.' });
    try{ maybeFinishSetup(); }catch(e){}
    res.json({ ok:true, license:license.verify() });
  }catch(e){ res.status(500).json({ ok:false, error:'저장하지 못했어요.' }); }
});

/* ---------- 관리자 ---------- */
app.get('/api/admin/status', adminLimiter, needAdmin, (req, res) => {
  try {
    res.json({ ok: true, license: license.verify(), school: license.schoolIdentity(), quota: userQuota(), studentPath: '/student/', hwid: license.serverHwid(), ips: localIPv4s(), port: PORT, counts: counts(), now: localTs(new Date()) });
  } catch (e) { res.status(500).json({ ok: false, error: '상태를 불러오지 못했어요.' }); }
});

/* 서버 등록 코드 (학교 PC 본체에서만 — 원격 유출 시 영구 위조 키가 되므로 loopback 강제) */
app.get('/api/admin/secret', adminLimiter, needAdmin, (req, res) => {
  try {
    if (!isLoopback(req)) return res.status(403).json({ ok: false, error: '학교 PC 본체에서만 확인할 수 있어요.' });
    res.json({ ok: true, secret: license.licenseSecret() });
  }
  catch (e) { res.status(500).json({ ok: false, error: '비밀을 불러오지 못했어요.' }); }
});

app.get('/api/admin/school', adminLimiter, needAdmin, (req, res) => {
  try { res.json({ ok: true, school: license.schoolIdentity() }); }
  catch (e) { res.status(500).json({ ok: false, error: '학교 정보를 불러오지 못했어요.' }); }
});

app.put('/api/admin/school', adminLimiter, needAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const code = String(b.code == null ? b.schoolCode : b.code).trim().toUpperCase();
    const name = String(b.name == null ? b.schoolName : b.name).trim().slice(0, 60);
    if (code && !/^[A-Z0-9_-]{3,20}$/.test(code)) {
      return res.status(400).json({ ok: false, error: '학교 코드는 3~20자의 영문·숫자·-·_ 만 쓸 수 있어요.' });
    }
    setKV('school.code', code);
    setKV('school.name', name);
    const school = license.schoolIdentity();
    writeServerAudit(req, 'admin', '관리자', 'admin_school_update', 'settings', 'school', { code, name });
    res.json({ ok: true, school });
  } catch (e) { res.status(500).json({ ok: false, error: '학교 정보를 저장하지 못했어요.' }); }
});

app.post('/api/admin/license', adminLimiter, needAdmin, (req, res) => {
  try {
    const key = String((req.body || {}).key || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'license.key 내용을 넣어 주세요.' });
    license.writeKeyFile(key);
    const v = license.verify();
    writeServerAudit(req, 'admin', '관리자', 'admin_license_update', 'settings', 'license', { mode: v.mode, maxUsers: v.maxUsers });
    res.json({ ok: true, license: v });
  } catch (e) { res.status(500).json({ ok: false, error: '라이선스를 저장하지 못했어요.' }); }
});

function randomTempPassword() {
  // 사번=비밀번호 같은 추측 가능한 기본값을 없앤다. base64url 12자(72비트 엔트로피).
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

function normPaid(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (['1', 'true', 'y', 'yes', '예', '유료'].includes(s)) return 1;
  return 0;
}
function normRole(v) {
  const s = String(v == null ? 'TEACHER' : v).trim().toUpperCase();
  if (['ADMIN', '관리자', '총관리자'].includes(s)) return 'ADMIN';
  if (['STAFF', '직원', '행정'].includes(s)) return 'STAFF';
  if (['STUDENT', '학생', '학생회'].includes(s)) return 'STUDENT';
  return 'TEACHER';
}
function ensureDepartmentByPath(depPath) {
  const parts = String(depPath || '').split('>').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  let parent = null;
  for (const name of parts) {
    let d = parent == null
      ? row('SELECT * FROM departments WHERE name = ? AND parent_id IS NULL', name)
      : row('SELECT * FROM departments WHERE name = ? AND parent_id = ?', name, parent);
    if (!d) {
      const r = run('INSERT INTO departments (name, parent_id) VALUES (?, ?)', name, parent);
      d = { id: Number(r.lastInsertRowid) };
      ensureDepartmentByPath.created = (ensureDepartmentByPath.created || 0) + 1;
    }
    parent = d.id;
  }
  return parent;
}

/* 교직원 엑셀 일괄 등록: username, real_name, password?, department(부모>자식), role, is_paid_dual_network */
app.post('/api/admin/users/import', adminLimiter, needAdmin, async (req, res) => {
  let parsed = null;
  try { parsed = await parseMultipart(req, 10 * 1024 * 1024); }
  catch (e) { return res.status(400).json({ ok: false, error: '엑셀 파일을 읽지 못했어요.' }); }
  const tmp = parsed.file && parsed.file.filepath;
  const finish = (code, body) => { try { if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {} res.status(code).json(body); };
  try {
    if (!tmp) return finish(400, { ok: false, error: '엑셀 파일을 골라 주세요.' });
    const wb = XLSX.readFile(tmp);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    ensureDepartmentByPath.created = 0;
    let created = 0, updated = 0;
    const quota = userQuota();
    let quotaLeft = quota.left;
    const errors = [];
    const temporaryPasswords = [];
    rows.slice(0, 5000).forEach((r, i) => {
      try {
        const username = String(r.username || r['사번'] || r['학번'] || '').trim();
        const realName = String(r.real_name || r['이름'] || '').trim();
        if (!username || !realName) throw new Error('사번·이름 필요');
        const depId = ensureDepartmentByPath(r.department || r['부서'] || '');
        const role = normRole(r.role || r['권한']);
        const paid = normPaid(r.is_paid_dual_network ?? r['유료'] ?? r['듀얼']);
        const ex = row('SELECT * FROM users WHERE username = ?', username);
        if (ex) {
          const q = ['UPDATE users SET real_name = ?, department_id = ?, role = ?, is_paid_dual_network = ?'];
          const p = [realName, depId, role, paid];
          const pw = String(r.password || r['비밀번호'] || '').trim();
          if (pw) { q.push(', password_hash = ?'); p.push(auth.hashPassword(pw)); }
          p.push(username);
          run(q.join('') + ' WHERE username = ?', ...p);
          updated++;
        } else {
          if (quotaLeft != null && quotaLeft <= 0) {
            throw new Error(`라이선스 인원(${quota.max}명)을 초과했어요.`);
          }
          const givenPw = String(r.password || r['비밀번호'] || '').trim();
          const pw = givenPw || randomTempPassword();
          run('INSERT INTO users (department_id, username, real_name, password_hash, role, is_paid_dual_network) VALUES (?, ?, ?, ?, ?, ?)',
            depId, username, realName, auth.hashPassword(pw), role, paid);
          if (!givenPw) temporaryPasswords.push({ username, password: pw });
          created++;
          if (quotaLeft != null) quotaLeft--;
        }
      } catch (e) { if (errors.length < 20) errors.push(`${i + 2}행: ${e.message || '실패'}`); }
    });
    writeServerAudit(req, 'admin', '관리자', 'admin_users_import', 'users', '', { created, updated, departmentsCreated: ensureDepartmentByPath.created || 0, errors: errors.length });
    finish(200, { ok: true, created, updated, departmentsCreated: ensureDepartmentByPath.created || 0, errors, quota: userQuota(), temporaryPasswords });
  } catch (e) { finish(500, { ok: false, error: '엑셀을 읽지 못했어요.' }); }
});

app.get('/api/admin/users', adminLimiter, needAdmin, (req, res) => {
  try {
    res.json({ ok: true, users: all(`SELECT u.id, u.username, u.real_name, u.department_id, d.name AS department_name, u.status, u.status_message, u.role, u.is_paid_dual_network, u.created_at FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.id DESC LIMIT 1000`) });
  } catch (e) { res.status(500).json({ ok: false, error: '사용자를 불러오지 못했어요.' }); }
});

/* 관리자 비밀번호 재설정 — 새 세션을 모두 끊고, 관리자가 정한 새 비밀번호를 적용한다. */
app.post('/api/admin/users/:id/password', adminLimiter, needAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const pw = String((req.body || {}).password || '');
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: '사용자 번호가 올바르지 않아요.' });
    if (pw.length < 8 || pw.length > 128) return res.status(400).json({ ok: false, error: '새 비밀번호는 8~128자로 정해 주세요.' });
    const u = row('SELECT id, username, real_name FROM users WHERE id = ?', id);
    if (!u) return res.status(404).json({ ok: false, error: '사용자를 찾지 못했어요.' });
    run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(pw), id);
    run('DELETE FROM sessions WHERE user_id = ?', id);
    writeServerAudit(req, 'admin', '관리자', 'admin_user_password_reset', 'user', id, { username: u.username });
    res.json({ ok: true, user: { id: Number(u.id), username: u.username, real_name: u.real_name } });
  } catch (e) { res.status(500).json({ ok: false, error: '비밀번호를 재설정하지 못했어요.' }); }
});

app.post('/api/admin/departments', adminLimiter, needAdmin, (req, res) => {
  try {
    const name = String((req.body || {}).name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ ok: false, error: '부서 이름을 적어 주세요.' });
    const parent = Number((req.body || {}).parent_id || 0) || null;
    const r = run('INSERT INTO departments (name, parent_id) VALUES (?, ?)', name, parent);
    writeServerAudit(req, 'admin', '관리자', 'admin_department_create', 'department', r.lastInsertRowid, { name, parent });
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) { res.status(500).json({ ok: false, error: '부서를 만들지 못했어요.' }); }
});

/* ---------- 쪽지(이메일형) API (5단계-1) ----------
 * 라우트는 routes/notes.js로 분리. 설계서: docs/NOTES_BACKEND_DESIGN.md */
app.use('/api/notes', require('./routes/notes')({ needAuth, getIo: () => io }));

/* ---------- AI 3줄 요약 (Gemini 서버 캐시 + 개인정보 마스킹) — 로드맵 1-1 ----------
 * 키는 .env에서만. 같은 공지는 1회 호출 후 DB 캐시에서 즉시 응답. */
app.use('/api/ai/summaries', require('./routes/summaries')({ needAuth, needStaff, aiLimiter }));

/* ---------- 차세대 기능 (2026-10) ----------
 *  · 상담 일지: 원문은 서버 DB, AI에는 마스킹된 텍스트만 전송
 *  · 간이 전자결재: 관리자 승인 + 전자서명 해시 + 실시간 알림
 *  · 협업 보드: REST 목록/저장 + Socket.io 실시간 이동 동기화 */
app.use('/api/consultations', require('./routes/consultations')({ needAuth, needStaff, aiLimiter }));
app.use('/api/approvals', require('./routes/approvals')({
  needAuth, needStaff, writeLimiter: collabLimiter, getIo: () => io,
}));
app.use('/api/whiteboards', require('./routes/whiteboards')({
  needAuth, needStaff, writeLimiter: collabLimiter, getIo: () => io,
}));

/* ---------- 보안 인쇄 대기열 (Killer ①) — 승인 전까지 문서가 종이로 나가지 않는다 ---------- */
app.use('/api/print', require('./routes/print')({ needAuth, needStaff }));

/* ---------- 나이스 학사일정·급식 연동 (Killer ③) — API 키는 서버에만 보관 ---------- */
app.use('/api/neis', require('./routes/neis')({ needAuth, needStaff }));

/* ---------- 관리자 도구 (CoolManager ③④⑤) — 감사 리포트·정책·데이터 정리·백업 ---------- */
app.use('/api/admin', require('./routes/admin-tools')({
  needAdmin, adminLimiter,
  purgeFiles: () => purgeExpiredFiles(UPLOAD_DIR),
  getIo: () => io,
}));

/* ---------- 서버 주도 OTA (5단계-3) ----------
 * 전산실이 updates/ 폴더에 설치본+latest.json 을 올리면 교사 PC가 받아 간다.
 * 읽기 전용·로그인 불필요 (설정/이용권 상태와 무관하게 갱신 가능해야 함) */
app.use('/api/updates', require('./routes/updates')({ forcedUpdate: () => getPolicyBool('forceUpdate') }));

app.use('/fonts', express.static(path.join(__dirname, 'fonts'), { maxAge: '7d' }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

/* 학생용 웹 (온프레미스 전용, 설치·클라우드 불필요) */
app.use('/student', express.static(path.join(__dirname, 'student'), { index: 'index.html', maxAge: '1h' }));
app.get('/', (req, res) => res.redirect('/student/'));

/* ---------- Socket.io ---------- */
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 32 * 1024 * 1024 });

io.use((socket, next) => {
  try {
    if(!isSetupDone()) return next(new Error('setup-required'));
    const m = license.verify().mode;
    if (m !== 'licensed' && m !== 'trial') return next(new Error('license-required'));
    const u = auth.userByToken(socket.handshake.auth && socket.handshake.auth.token);
    if (!u) return next(new Error('unauthorized'));
    socket.user = u;
    next();
  } catch (e) { next(new Error('unauthorized')); }
});

io.on('connection', (socket) => {
  const me = socket.user;
  socket.join('user:' + me.id);
  socket.on('room:join', (roomId, ack) => {
    try {
      const room = row('SELECT * FROM rooms WHERE id = ?', String(roomId || ''));
      if (!room || !isMember(room, me.id)) { if (ack) ack({ ok: false }); return; }
      socket.join('room:' + room.id);
      if (ack) ack({ ok: true });
    } catch (e) { if (ack) ack({ ok: false }); }
  });
  socket.on('room:leave', (roomId) => { try { socket.leave('room:' + String(roomId || '')); } catch (e) {} });

  socket.on('user:change_status', (payload, ack) => {
    try {
      const p = payload || {};
      const st = String(p.status || '').toUpperCase();
      if (!VALID_STATUS.has(st)) { if (ack) ack({ ok: false }); return; }
      const msg = String(p.statusMessage || p.status_message || '').slice(0, 80);
      run('UPDATE users SET status = ?, status_message = ? WHERE id = ?', st, msg, me.id);
      const out = { userId: me.id, status: st, statusMessage: msg, at: localTs(new Date()) };
      io.emit('user:status_updated', out);
      if (ack) ack({ ok: true, ...out });
    } catch (e) { if (ack) ack({ ok: false }); }
  });

  socket.on('message:send', (payload, ack) => {
    try {
      if (String(me.role || '').toUpperCase() === 'STUDENT') { if (ack) ack({ ok: false, error: 'staff-only' }); return; }
      const p = payload || {};
      const room = row('SELECT * FROM rooms WHERE id = ?', String(p.roomId || ''));
      if (!room || !isMember(room, me.id)) { if (ack) ack({ ok: false, error: 'no-room' }); return; }
      const content = String(p.content || '').slice(0, 1500);
      const fileId = Number(p.fileId || 0) || null;
      let poll = null;
      if (p.poll && typeof p.poll === 'object') {
        const q = String(p.poll.q || '').trim().slice(0, 80);
        const opts = Array.isArray(p.poll.opts) ? p.poll.opts.map((o) => String(o || '').trim().slice(0, 30)).filter(Boolean).slice(0, 6) : [];
        if (!q || opts.length < 2) { if (ack) ack({ ok: false, error: 'bad-poll' }); return; }
        poll = { q, opts };
      }
      if (!content && !fileId && !poll) { if (ack) ack({ ok: false }); return; }
      if (fileId) {
        const f = row('SELECT * FROM files WHERE id = ?', fileId);
        if (f) run('UPDATE files SET message_id = NULL WHERE id = ?', fileId);
      }
      const r = run('INSERT INTO messages (room_id, sender_id, content, is_notice) VALUES (?, ?, ?, ?)',
        room.id, me.id, content, p.isNotice ? 1 : 0);
      const mid = Number(r.lastInsertRowid);
      if (fileId) { try { run('UPDATE files SET message_id = ? WHERE id = ?', mid, fileId); } catch (e) {} }
      let fileInfo = null;
      if (fileId) {
        const f = row('SELECT id, original_name, file_size FROM files WHERE id = ?', fileId);
        if (f) fileInfo = { file_id: f.id, file_name: f.original_name, file_size: f.file_size };
      }
      const msg = { id: mid, room_id: room.id, sender_id: me.id, sender_name: me.real_name || '사용자', content, is_notice: p.isNotice ? 1 : 0, is_recalled: 0, fileId, ...(fileInfo || {}), created_at: localTs(new Date()) };
      if (poll) {
        try { run('INSERT OR REPLACE INTO polls (message_id, q, opts, created_by) VALUES (?, ?, ?, ?)', mid, poll.q, JSON.stringify(poll.opts), me.id); } catch (e) {}
        msg.poll_q = poll.q; msg.poll_opts = poll.opts; msg.poll_closed = 0; msg.poll_counts = []; msg.poll_mine = [];
      }
      io.to('room:' + room.id).emit('message:new', msg);
      if (ack) ack({ ok: true, message: msg });
    } catch (e) { if (ack) ack({ ok: false }); }
  });

  socket.on('message:read', (payload, ack) => {
    try {
      const mid = Number((payload || {}).messageId || 0);
      const m = row('SELECT * FROM messages WHERE id = ?', mid);
      if (!m) { if (ack) ack({ ok: false }); return; }
      const room = row('SELECT * FROM rooms WHERE id = ?', m.room_id);
      if (!room || !isMember(room, me.id)) { if (ack) ack({ ok: false }); return; }
      const at = localTs(new Date());
      try { run('INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)', mid, me.id, at); } catch (e) {}
      const cnt = (row('SELECT COUNT(*) c FROM message_reads WHERE message_id = ?', mid) || {}).c || 0;
      io.to('room:' + room.id).emit('message:read_updated', { messageId: mid, userId: me.id, readAt: at, readCount: cnt });
      if (ack) ack({ ok: true, readCount: cnt });
    } catch (e) { if (ack) ack({ ok: false }); }
  });

  socket.on('message:recall', (payload, ack) => {
    try {
      const mid = Number((payload || {}).messageId || 0);
      const m = row('SELECT * FROM messages WHERE id = ?', mid);
      if (!m || Number(m.sender_id) !== Number(me.id)) { if (ack) ack({ ok: false, error: '본인 메시지만 회수할 수 있어요.' }); return; }
      run("UPDATE messages SET is_recalled = 1, content = '회수된 메시지예요' WHERE id = ?", mid);
      io.to('room:' + m.room_id).emit('message:recalled', { messageId: mid, content: '회수된 메시지예요' });
      if (ack) ack({ ok: true });
    } catch (e) { if (ack) ack({ ok: false }); }
  });

  function pollCountsOf(mid) {
    const p = row('SELECT * FROM polls WHERE message_id = ?', mid);
    if (!p) return null;
    let opts = []; try { opts = JSON.parse(p.opts || '[]'); } catch (e) {}
    const counts = new Array(opts.length).fill(0);
    let total = 0;
    all('SELECT user_id, choices FROM poll_votes WHERE message_id = ?', mid).forEach((v) => {
      let ch = []; try { ch = JSON.parse(v.choices || '[]'); } catch (e) {}
      const valid = ch.filter((x) => Number.isInteger(x) && x >= 0 && x < opts.length);
      if (!valid.length) return;
      total++;
      valid.forEach((i) => counts[i]++);
    });
    return { counts, total, closed: !!p.closed };
  }

  socket.on('poll:vote', (payload, ack) => {
    try {
      const mid = Number((payload || {}).messageId || 0);
      const m = row('SELECT * FROM messages WHERE id = ?', mid);
      if (!m) { if (ack) ack({ ok: false }); return; }
      const room = row('SELECT * FROM rooms WHERE id = ?', m.room_id);
      if (!room || !isMember(room, me.id)) { if (ack) ack({ ok: false }); return; }
      const p = row('SELECT * FROM polls WHERE message_id = ?', mid);
      if (!p || p.closed) { if (ack) ack({ ok: false, error: 'closed' }); return; }
      let opts = []; try { opts = JSON.parse(p.opts || '[]'); } catch (e) {}
      const ch = Array.isArray((payload || {}).choices) ? (payload || {}).choices.filter((x) => Number.isInteger(x) && x >= 0 && x < opts.length).slice(0, opts.length) : [];
      if (!ch.length) { if (ack) ack({ ok: false }); return; }
      run('INSERT OR REPLACE INTO poll_votes (message_id, user_id, choices) VALUES (?, ?, ?)', mid, me.id, JSON.stringify(ch));
      const agg = pollCountsOf(mid) || { counts: [], total: 0 };
      io.to('room:' + m.room_id).emit('poll:votes_updated', { messageId: mid, counts: agg.counts, total: agg.total });
      if (ack) ack({ ok: true, mine: ch });
    } catch (e) { if (ack) ack({ ok: false }); }
  });

  socket.on('poll:close', (payload, ack) => {
    try {
      const mid = Number((payload || {}).messageId || 0);
      const m = row('SELECT * FROM messages WHERE id = ?', mid);
      if (!m) { if (ack) ack({ ok: false }); return; }
      if (Number(m.sender_id) !== Number(me.id) && me.role !== 'ADMIN') { if (ack) ack({ ok: false }); return; }
      run('UPDATE polls SET closed = 1 WHERE message_id = ?', mid);
      io.to('room:' + m.room_id).emit('poll:closed', { messageId: mid });
      if (ack) ack({ ok: true });
    } catch (e) { if (ack) ack({ ok: false }); }
  });

  /* ---------- 협업 보드 실시간 동기화 ---------- */
  socket.data.whiteboards = new Set();
  function socketActivity(action, detail) {
    writeActivity({
      socket: { remoteAddress: socket.handshake && socket.handshake.address },
      user: me,
      method: 'SOCKET',
      _activityPath: String(action || 'socket'),
    }, action, detail || {});
  }
  function boardRoom(id) { return 'whiteboard:' + String(id || ''); }
  function boardPresence(id) {
    try {
      const room = boardRoom(id);
      const count = (io.sockets.adapter.rooms.get(room) || new Set()).size;
      io.to(room).emit('whiteboard:presence', {
        boardId: String(id || ''),
        count,
        name: String(me.real_name || me.username || ''),
        at: localTs(new Date()),
      });
    } catch (e) { /* 표시용 정보라 실패해도 무시 */ }
  }

  socket.on('whiteboard:join', (payload, ack) => {
    try {
      if (String(me.role || '').toUpperCase() === 'STUDENT') {
        if (ack) ack({ ok: false, error: '선생님 계정에서만 사용할 수 있어요.' });
        return;
      }
      const id = String((payload && payload.boardId) || '');
      const board = whiteboard.getBoard(id);
      if (!board) { if (ack) ack({ ok: false, error: '보드를 찾지 못했어요.' }); return; }
      socket.join(boardRoom(id));
      socket.data.whiteboards.add(id);
      socketActivity('whiteboard_join', { boardId: id });
      boardPresence(id);
      if (ack) ack({ ok: true, board });
    } catch (e) { if (ack) ack({ ok: false, error: '보드에 들어가지 못했어요.' }); }
  });

  socket.on('whiteboard:leave', (payload, ack) => {
    try {
      const id = String((payload && payload.boardId) || '');
      socket.leave(boardRoom(id));
      socket.data.whiteboards.delete(id);
      socketActivity('whiteboard_leave', { boardId: id });
      boardPresence(id);
      if (ack) ack({ ok: true });
    } catch (e) { if (ack) ack({ ok: false }); }
  });

  socket.on('whiteboard:update', (payload, ack) => {
    try {
      if (String(me.role || '').toUpperCase() === 'STUDENT') {
        if (ack) ack({ ok: false, error: '선생님 계정에서만 사용할 수 있어요.' });
        return;
      }
      const now = Date.now();
      if (now - Number(socket.data.wbLast || 0) < 40) {
        if (ack) ack({ ok: false, error: '보드를 너무 빠르게 저장했어요. 잠시 후 다시 시도해 주세요.' });
        return;
      }
      socket.data.wbLast = now;
      const p = payload || {};
      const id = String(p.boardId || '');
      const result = whiteboard.updateBoard({
        id,
        data: p.data,
        expectedVersion: p.expectedVersion,
        user: me,
      });
      if (!result.ok && result.conflict) {
        if (ack) ack({ ok: true, conflict: true, board: result.board });
        return;
      }
      socketActivity('whiteboard_update', {
        boardId: result.board.id,
        version: result.board.version,
        items: result.board.data.items.length,
      });
      const out = {
        boardId: result.board.id,
        data: result.board.data,
        version: result.board.version,
        updatedByName: result.board.updatedByName,
        updatedAt: result.board.updatedAt,
        source: 'socket',
      };
      io.to(boardRoom(id)).emit('whiteboard:updated', out);
      if (ack) ack({ ok: true, board: result.board });
    } catch (e) {
      const msg = e && e.code === 'TOO_LARGE' ? e.message : (e && e.code === 'NOT_FOUND' ? e.message : '보드를 저장하지 못했어요.');
      if (ack) ack({ ok: false, error: msg });
    }
  });

  socket.on('disconnect', () => {
    try {
      for (const id of socket.data.whiteboards) boardPresence(id);
      socket.data.whiteboards.clear();
    } catch (e) { /* 무시 */ }
  });
});

/* ---------- 매일 00:00 학생 미디어 만료 배치 ----------
 *  · 텍스트(쪽지·대화)는 절대 삭제하지 않는다.
 *  · 교사·교직원이 올린 사진·동영상·파일도 영구 보관한다.
 *  · expires_at이 있는 학생 미디어만 실제 파일과 DB 행을 함께 지운다. */
function runPurgeBatch() {
  try {
    const n = purgeExpiredFiles(UPLOAD_DIR);
    // 보안 인쇄: 하루 지난 대기열 원문 삭제 (개인정보 최소 보관 — 목록/메타는 남긴다)
    let p = 0;
    try { p = require('./routes/print').purgeOldPrintContent(); } catch (e) { /* 다음 날 */ }
    if (n || p) {
      console.log(`  ${CC.dim}🧹 정리 완료 — 만료된 학생 미디어 ${n} · 인쇄 원문 ${p} (${localTs(new Date())})${CC.x}`);
    }
  } catch (e) { console.error('[purge] 실패:', e.message || e); }
}
cron.schedule('0 0 * * *', runPurgeBatch);

/* 매일 새벽 3시 30분 자동 DB 백업 (CoolManager ⑤) — 관리자 콘솔에서 수동 실행도 가능 */
cron.schedule('30 3 * * *', () => {
  try {
    const b = require('./backup').backupNow();
    console.log(`  ${CC.dim}🗄  자동 DB 백업 ${b.file} (${(b.bytes / 1048576).toFixed(1)}MB)${CC.x}`);
  } catch (e) { console.error('[backup] 실패:', e.message || e); }
});

/* ---------- 실행 ---------- */
const lic = license.verify();
// 콘솔 색상 (Windows 10+ · PowerShell 모두 표시됨)
const CC = { g:'\x1b[32m', y:'\x1b[33m', c:'\x1b[36m', b:'\x1b[1m', dim:'\x1b[2m', r:'\x1b[31m', x:'\x1b[0m' };
try{ process.title='브리즈 학내망 서버'; }catch(e){}
// 시작하자마자 죽으면 원인을 알 수 없으니 파일 로그 + 콘솔에 남긴다.
// 서비스 모드에서는 SCM이 자동 재시작하도록 빨리 비정상 종료해야 한다 (sc failure / node-windows 재시작 조건).
process.on('uncaughtException', (e) => {
  try{
    console.error(`  ${CC.r}✕ 서버가 시작 중 문제가 생겼어요:${CC.x}`, (e && e.message) || e);
    if (e && e.stack) { try { writeLog('ERROR', e.stack); } catch (_) {} }
    if (!IS_SERVICE) console.error(`  ${CC.dim}이 창을 닫고, exe와 같은 폴더에 쓰기 권한이 있는지 확인해 주세요.${CC.x}`);
  }catch(_){}
  if (IS_SERVICE) { setTimeout(() => { try{ process.exit(1); }catch(_){} }, 1000); }
  else { setTimeout(() => { try{ process.exit(1); }catch(_){} }, 30000); }
});
process.on('unhandledRejection', (reason) => {
  try {
    console.error('  처리되지 않은 Promise 거부:', (reason && reason.message) || reason);
    if (reason && reason.stack) { try { writeLog('ERROR', reason.stack); } catch (_) {} }
  } catch (e) {}
  // 서비스에서는 살려두되 로그에 남긴다 (요청 1개 실패로 전체를 내리지 않기 위해).
  // 치명적이면 위 uncaughtException 경로로 종료된다.
});
/* 정상 종료 (서비스 중지 / GUI 종료 시): 소켓·DB 정리 후 종료 */
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { console.log(`  종료 신호 받음 (${signal}). 정리 중...`); } catch (e) {}
  try { cron.getTasks().forEach((t) => { try { t.stop(); } catch (e) {} }); } catch (e) {}
  const done = () => { try { require('./db').db.close(); } catch (e) {} process.exit(0); };
  try {
    server.close(() => done());
    setTimeout(done, 5000).unref();
  } catch (e) { done(); }
}
try {
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGBREAK', () => gracefulShutdown('SIGBREAK'));
  process.on('message', (m) => { if (m === 'shutdown') gracefulShutdown('IPC'); });
} catch (e) {}
server.on('error', (e) => {
  try {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`  ${CC.r}✕ 포트 ${PORT}가 이미 사용 중이에요. 다른 브리즈 서버가 켜져 있는지 확인해 주세요.${CC.x}`);
    } else {
      console.error('  서버 소켓 오류:', (e && e.message) || e);
    }
  } catch (_) {}
  setTimeout(() => { try { process.exit(1); } catch (_) {} }, IS_SERVICE ? 1000 : 30000);
});
server.listen(PORT, '0.0.0.0', () => {
  try { const n = auth.purgeExpiredSessions(); if (n) writeLog('INFO', `만료 세션 ${n}개 정리`); } catch (e) {}
  const bar = CC.dim + '────────────────────────────────────────' + CC.x;
  console.log('');
  console.log(`  ${CC.b}🏫 브리즈 학내망 서버${CC.x}  ${CC.g}● 켜짐${CC.x}`);
  console.log('  ' + bar);
  console.log(`  ${CC.c}🌐 관리 페이지${CC.x}  http://localhost:${PORT}/admin`);
  if(!isSetupDone()){
    console.log(`  ${CC.y}⚠ 초기 설정 필요${CC.x}  관리자 계정 + 이용권 등록이 끝나야 채팅이 열립니다.`);
    console.log(`  ${CC.dim}학교 PC 본체에서 위 관리 페이지를 열어 1·2단계를 마치세요.${CC.x}`);
  }
  const ips = localIPv4s();
  if (ips.length) {
    console.log(`  ${CC.c}🏫 학교 접속 주소${CC.x}`);
    ips.forEach((x) => console.log(`     ${CC.b}http://${x.address}:${PORT}${CC.x}  ${CC.dim}(${x.iface})${CC.x}`));
    console.log(`  ${CC.c}🎓 학생 웹${CC.x}  ${CC.b}http://${(ips[0] || {}).address || 'localhost'}:${PORT}/student/${CC.x}  ${CC.dim}(크롬북·태블릿, 설치 불필요)${CC.x}`);
  } else {
    console.log(`  ${CC.r}✕ LAN IP를 찾지 못했어요. 네트워크 연결을 확인해 주세요.${CC.x}`);
  }
  console.log(`  ${CC.c}🎫 라이선스${CC.x}   ${lic.message} ${CC.dim}(만료 ${lic.expiresAt || '-'})${CC.x}`);
  console.log(`  ${CC.c}💎 듀얼 네트워크${CC.x}  ${lic.isPaidDualNetworkActive ? CC.g + '켜짐' + CC.x : CC.dim + '꺼짐' + CC.x}`);
  if (!process.env.EDUTALK_ADMIN_TOKEN) console.log(`  ${CC.c}🔑 관리자 토큰${CC.x}  ${ADMIN_TOKEN}  ${CC.dim}(처음 1회만 보여줘요)${CC.x}`);
  if (IS_SERVICE) console.log(`  ${CC.dim}백그라운드(서비스/GUI) 모드로 실행 중. 로그: ${LOG_DIR}${CC.x}`);
  else console.log(`  ${CC.dim}이 창을 닫으면 서버가 꺼져요. 백그라운드 실행은 서비스 등록 또는 GUI 앱을 쓰세요.${CC.x}`);
  console.log('  ' + bar);
  console.log('');
  runPurgeBatch();
});

module.exports = { app, server };
