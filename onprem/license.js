'use strict';
/* EduTalk license verify (server-side).
 * license.key 형식: base64url(payload).base64url(HMAC-SHA256 서명)
 * payload JSON: { school, schoolId, expiresAt(ISO), isPaidDualNetworkActive(bool), maxUsers, issuedAt }
 * 키가 없으면 첫 실행일부터 30일 무료 체험. 만료되면 듀얼 모드 OFF + 관리자 경고 (서버는 계속 동작).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR, APP_ROOT, getKV, setKV } = require('./db');

const TRIAL_DAYS = 30;

/* ⚠ 운영 보안: 벤더 개인키는 절대 학교 서버 폴더에 두면 안 된다.
 * 이 파일이 있으면 서버 관리자/침입자가 임의의 라이선스를 발급할 수 있다. */
try {
  if (fs.existsSync(path.join(APP_ROOT(), 'license-vendor-private.key'))) {
    console.warn('[license] 경고: license-vendor-private.key 가 서버 폴더에 있습니다. 오프라인 벤더 PC로 즉시 옮기세요.');
  }
} catch (e) {}

/* 벤더 Ed25519 공개키 (서버에 내장 — 개인키는 절대 서버에 두지 말 것, 오프라인 보관)
 * 새 라이선스는 개인키로 서명 → 서버가 공개키로 검증. 서버 폴더의 license.secret(HMAC)은
 * 기존 학교 호환용 레거시로만 인정한다. EDUTALK_STRICT_LICENSE=1 이면 레거시 HMAC를 거부한다. */
const VENDOR_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAcsP0mjX7Ud0jAj0/igte8C3VDdU+s5eOcRlf86DBvo=
-----END PUBLIC KEY-----`;
const STRICT_LICENSE = process.env.EDUTALK_STRICT_LICENSE === '1';

function licenseSecret() {
  if (process.env.EDUTALK_LICENSE_SECRET) return process.env.EDUTALK_LICENSE_SECRET;
  // 학교 서버 폴더의 license.secret 파일 (없으면 자동 생성 — 서버마다 고유)
  const p = path.join(APP_ROOT(), 'license.secret');
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (raw) return raw;
  } catch (e) {}
  try {
    const gen = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(p, gen);
    return gen;
  } catch (e) {}
  // 비밀값을 파일로 저장하지 못한 경우: 알려진 상수(취약) 대신 매번 새 난수를 쓴다.
  // → 기존 legacy HMAC 키는 검증 실패(안전). 벤더 Ed25519 라이선스는 영향 없음.
  console.warn('[license] license.secret 저장 실패 — 임시 난수 비밀값으로 동작합니다 (legacy HMAC 키 검증 불가).');
  return crypto.randomBytes(32).toString('hex');
}

function b64uDecode(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function signLicense(payloadObj, secret) {
  const body = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret || licenseSecret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function licenseKeyPath() {
  return process.env.EDUTALK_LICENSE_PATH || path.join(APP_ROOT(), 'license.key');
}

function writeKeyFile(raw) {
  const p = licenseKeyPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(raw == null ? '' : raw).trim(), { mode: 0o600 });
}

function readKeyFile() {
  const p = licenseKeyPath();
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw || null;
  } catch (e) { return null; }
}

function serverHwid() {
  // PC 고유값: 호스트명 + 랜카드 주소 해시 (하드웨어 묶음용)
  try {
    const os = require('os');
    const macs = [];
    const ifs = os.networkInterfaces();
    Object.keys(ifs).forEach((n) => (ifs[n] || []).forEach((ni) => {
      if (ni.mac && ni.mac !== '00:00:00:00:00:00') macs.push(ni.mac);
    }));
    const raw = os.hostname() + '|' + [...new Set(macs)].sort().join(',');
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase();
  } catch (e) { return ''; }
}
function trialStart() {
  // 파일+DB 이중 보관: 둘 중 더 이른 날짜를 쓴다 (파일 삭제 리셋 방지).
  // DB가 있으면 파일이 지워져도 리셋 안 됨. 둘 다 없으면 지금 시각으로 둘 다 기록.
  let fileT = 0, dbT = 0;
  const marker = path.join(DATA_DIR, '.trial');
  try {
    const raw = fs.readFileSync(marker, 'utf8').trim();
    const t = new Date(raw).getTime();
    if (t) fileT = t;
  } catch (e) {}
  try {
    const raw = getKV('trial_start');
    const t = new Date(raw).getTime();
    if (t) dbT = t;
  } catch (e) {}
  let base = 0;
  if (fileT && dbT) base = Math.min(fileT, dbT);
  else base = fileT || dbT || 0;
  if (!base) {
    const now = new Date();
    base = now.getTime();
    try { fs.writeFileSync(marker, now.toISOString()); } catch (e) {}
    try { setKV('trial_start', now.toISOString()); } catch (e) {}
    return now;
  }
  // 한쪽이 비어 있으면 복구해 둔다
  try {
    const iso = new Date(base).toISOString();
    if (!fileT) { try { fs.writeFileSync(marker, iso); } catch (e) {} }
    if (!dbT) { try { setKV('trial_start', iso); } catch (e) {} }
  } catch (e) {}
  return new Date(base);
}

/* 벤더 Ed25519 검증: body(base64url JSON).sig(base64url 서명) */
function verifyVendorEd25519(raw) {
  const [body, sig] = String(raw || '').split('.');
  if (!body || !sig) return null;
  let payload;
  try { payload = JSON.parse(b64uDecode(body)); } catch (e) { return null; }
  try {
    const ok = crypto.verify(
      null,
      Buffer.from(body, 'utf8'),
      { key: VENDOR_PUBLIC_KEY_PEM, format: 'pem', type: 'spki' },
      Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    );
    if (!ok) return null;
    return payload;
  } catch (e) { return null; }
}

function payloadToResult(p, vendorSigned) {
  const now = Date.now();
  const exp = new Date(p.expiresAt).getTime();
  if (!exp) return { mode: 'invalid', licensed: false, isPaidDualNetworkActive: false, school: '', expiresAt: '', daysLeft: 0, message: 'license.key가 올바르지 않아요.', vendorSigned: !!vendorSigned, legacy: !vendorSigned };
  if (exp <= now) {
    return { mode: 'expired', licensed: false, isPaidDualNetworkActive: false, school: p.school || '', expiresAt: p.expiresAt, daysLeft: 0, message: '라이선스가 만료됐어요. 이용권을 갱신해 주세요.', vendorSigned: !!vendorSigned, legacy: !vendorSigned };
  }
  if (p.hwid && p.hwid !== serverHwid()) {
    return { mode: 'invalid', licensed: false, isPaidDualNetworkActive: false, school: p.school || '', expiresAt: p.expiresAt || '', daysLeft: 0, message: '다른 PC의 라이선스예요. 해당 학교 서버에서만 쓸 수 있어요.', vendorSigned: !!vendorSigned, legacy: !vendorSigned };
  }
  return {
    mode: 'licensed',
    licensed: true,
    isPaidDualNetworkActive: p.isPaidDualNetworkActive === true,
    school: p.school || '',
    schoolId: p.schoolId || '',
    maxUsers: Number(p.maxUsers || 0),
    expiresAt: p.expiresAt,
    daysLeft: Math.ceil((exp - now) / 86400000),
    message: p.isPaidDualNetworkActive ? '유료 듀얼 네트워크가 켜져 있어요.' : '라이선스는 유효해요. 듀얼 모드는 꺼져 있어요.',
    vendorSigned: !!vendorSigned,
    legacy: !vendorSigned,
  };
}

/* 학교 식별자(학교 코드) — 관리자 콘솔에서 바꿀 수 있고, 없으면 라이선스/HWID로
 * 결정적인 기본 코드를 만든다. 교사 앱과 학생 웹이 같은 서버를 가리키는지 확인하는 용도.
 * (비밀번호가 아니며, 서버 주소를 숨기는 보안 수단도 아니다.) */
function schoolIdentity() {
  const rawCode = String(getKV('school.code') || '').trim();
  const rawName = String(getKV('school.name') || '').trim();
  const lic = verify();
  let code = rawCode;
  if (!code) {
    const seed = String(lic.schoolId || lic.school || serverHwid() || 'breeze');
    code = 'BRZ-' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 6).toUpperCase();
    try { setKV('school.code', code); } catch (e) {}
  }
  let name = rawName || String(lic.school || '');
  if (name && !rawName) { try { setKV('school.name', name); } catch (e) {} }
  return { code, name, generated: !rawCode };
}

function verify() {
  const now = Date.now();
  const raw = readKeyFile();
  if (!raw) {
    const start = trialStart().getTime();
    const left = Math.max(0, Math.ceil((start + TRIAL_DAYS * 86400000 - now) / 86400000));
    return {
      mode: left > 0 ? 'trial' : 'expired',
      licensed: false,
      isPaidDualNetworkActive: false,
      school: '',
      expiresAt: new Date(start + TRIAL_DAYS * 86400000).toISOString(),
      daysLeft: left,
      message: left > 0 ? `무료 체험 ${left}일 남았어요.` : '무료 체험이 끝났어요. license.key를 넣어 주세요.',
      vendorSigned: false,
      legacy: false,
    };
  }
  // 1) 벤더 Ed25519 (위조 불가) 우선
  try {
    const p = verifyVendorEd25519(raw);
    if (p) return payloadToResult(p, true);
  } catch (e) {}
  // 2) 레거시 HMAC (기존 학교 호환 — 서버 폴더 secret으로 자체 서명 가능하므로 엄격모드에서는 거부)
  if (STRICT_LICENSE) {
    return { mode: 'invalid', licensed: false, isPaidDualNetworkActive: false, school: '', expiresAt: '', daysLeft: 0, message: '구형 라이선스예요. 벤더 서명 키로 재발급받아 주세요.', vendorSigned: false, legacy: true };
  }
  try {
    const [body, sig] = raw.split('.');
    if (!body || !sig) throw new Error('bad format');
    const expect = crypto.createHmac('sha256', licenseSecret()).update(body).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) throw new Error('bad signature');
    const p = JSON.parse(b64uDecode(body));
    return payloadToResult(p, false);
  } catch (e) {
    return { mode: 'invalid', licensed: false, isPaidDualNetworkActive: false, school: '', expiresAt: '', daysLeft: 0, message: 'license.key가 올바르지 않아요.', vendorSigned: false, legacy: false };
  }
}

/* 벤더 오프라인 발급용 (개인키는 서버에 두지 말고 벤더 PC에만 보관):
 *   const l = require('./license');
 *   const key = l.signLicenseEd25519({...}, process.env.EDUTALK_VENDOR_PRIVATE_KEY);
 * Ed25519 개인키 PEM은 환경변수/오프라인 USB로만 전달한다. */
function signLicenseEd25519(payloadObj, privateKeyPem) {
  const body = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from(body, 'utf8'), { key: privateKeyPem, format: 'pem', type: 'pkcs8' }).toString('base64url');
  return body + '.' + sig;
}

module.exports = {
  licenseKeyPath,
  writeKeyFile, verify, signLicense, signLicenseEd25519, licenseSecret, serverHwid, schoolIdentity, TRIAL_DAYS, STRICT_LICENSE };
