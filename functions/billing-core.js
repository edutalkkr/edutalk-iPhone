'use strict';

const crypto = require('crypto');

// 서버가 가격의 단일 기준이다. 클라이언트가 보낸 금액은 절대 쓰지 않는다.
const PLAN_DEFINITIONS = Object.freeze({
  single_chat_1y: {
    id: 'single_chat_1y',
    label: '소통 전용 1년',
    shortLabel: '소통 전용',
    totalAmount: 99000,
    days: 365,
    network: 'single',
    chatOnly: true,
    badge: '가볍게 시작',
    description: '쪽지와 학생 문의에 집중하는 학교용이에요.',
    features: ['쪽지·학생 문의', '실시간 알림', '학교 코드 초대', '시간표는 제외돼요'],
  },
  single_1y: {
    id: 'single_1y',
    label: '기본 1년',
    shortLabel: '기본',
    totalAmount: 198000,
    days: 365,
    network: 'single',
    chatOnly: false,
    badge: '가장 많이 선택',
    description: '학교 업무에 필요한 흐름을 한 번에 담았어요.',
    features: ['쪽지·학생 문의', '시간표·대강', '급식·학사 일정', '보안 기록'],
  },
  dual_chat_1y: {
    id: 'dual_chat_1y',
    label: '듀얼 소통 전용 1년',
    shortLabel: '듀얼 소통',
    totalAmount: 198000,
    days: 365,
    network: 'dual',
    chatOnly: true,
    badge: '교내·교외 소통',
    description: '교내망과 외부망을 오가며 소통만 쓰는 학교용이에요.',
    features: ['쪽지·학생 문의', '교내·외부망 전환', '실시간 알림', '시간표는 제외돼요'],
  },
  dual_unified_1y: {
    id: 'dual_unified_1y',
    label: '듀얼 1년',
    shortLabel: '듀얼',
    totalAmount: 297000,
    days: 365,
    network: 'dual',
    chatOnly: false,
    badge: '가장 넓은 범위',
    description: '교내 업무와 외부 협업을 모두 한 학교 계정으로 이어요.',
    features: ['모든 기본 기능', '교내·외부망 전환', '외부 승인 흐름', '우선 지원'],
  },
});

const PLAN_ORDER = Object.freeze(['single_chat_1y', 'single_1y', 'dual_chat_1y', 'dual_unified_1y']);
const METHODS = Object.freeze(['card', 'transfer']);
const MODES = Object.freeze(['manual', 'sandbox', 'live']);
const STATUSES = Object.freeze(['pending', 'paid', 'cancelled', 'failed']);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function wonAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function totalsFor(totalAmount) {
  const total = wonAmount(totalAmount);
  const supplyAmount = Math.round(total / 1.1);
  return { supplyAmount, vatAmount: total - supplyAmount, totalAmount: total };
}

function planList() {
  return PLAN_ORDER.map((id) => {
    const p = PLAN_DEFINITIONS[id];
    return { ...p, ...totalsFor(p.totalAmount), features: [...p.features] };
  });
}

function resolvePlan(planId) {
  const id = String(planId || '').trim();
  const p = PLAN_DEFINITIONS[id];
  if (!p) return null;
  return { ...p, ...totalsFor(p.totalAmount), features: [...p.features] };
}

function sanitizeText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function validateIdempotencyKey(value) {
  return /^[A-Za-z0-9_-]{16,80}$/.test(String(value || '').trim());
}

function normalizeBuyer(input) {
  const data = input && typeof input === 'object' ? input : {};
  const buyerName = sanitizeText(data.buyerName, 40);
  const schoolName = sanitizeText(data.schoolName, 60);
  const phone = sanitizeText(data.phone, 20);
  const email = sanitizeText(data.email, 120).toLowerCase();
  return { buyerName, schoolName, phone, email };
}

function validateOrderRequest(input) {
  const data = input && typeof input === 'object' ? input : {};
  const plan = resolvePlan(data.planId);
  if (!plan) return { ok: false, error: '요금제를 다시 골라 주세요. [E-BILL-001]' };
  const method = String(data.method || '').trim();
  if (!METHODS.includes(method)) return { ok: false, error: '결제 방법을 다시 골라 주세요. [E-BILL-002]' };
  if (data.agree !== true) return { ok: false, error: '이용권 안내와 결제 조건에 동의해 주세요. [E-BILL-003]' };
  const buyer = normalizeBuyer(data);
  if (buyer.buyerName.length < 1) return { ok: false, error: '구매자 이름을 입력해 주세요. [E-BILL-004]' };
  if (buyer.schoolName.length < 1) return { ok: false, error: '학교 이름을 확인해 주세요. [E-BILL-005]' };
  if (buyer.phone && !/^[0-9+\-\s()]{7,20}$/.test(buyer.phone)) {
    return { ok: false, error: '연락처 형식을 확인해 주세요. [E-BILL-006]' };
  }
  return { ok: true, value: { ...buyer, plan, method } };
}

function resolvePaymentMode(raw) {
  const mode = String(raw || 'manual').trim().toLowerCase();
  return MODES.includes(mode) ? mode : 'manual';
}

function methodsForMode(mode) {
  return resolvePaymentMode(mode) === 'manual' ? ['transfer'] : ['card', 'transfer'];
}

function allowedTransition(from, to) {
  const a = String(from || '');
  const b = String(to || '');
  if (!STATUSES.includes(a) || !STATUSES.includes(b)) return false;
  if (a === b) return false;
  return (
    (a === 'pending' && (b === 'paid' || b === 'cancelled' || b === 'failed')) ||
    (a === 'failed' && b === 'pending')
  );
}

function orderNumber(now, randomBytes) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const suffix = randomToken(randomBytes || crypto.randomBytes, 6).slice(0, 6);
  return `BRZ-${yyyy}${mm}${dd}-${suffix}`;
}

function randomToken(randomBytes, length) {
  const size = Math.max(1, Number(length) || 1);
  const bytes = randomBytes(Math.max(16, size * 2));
  let out = '';
  for (let i = 0; i < size; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function generateLicenseCodes(randomBytes) {
  const source = typeof randomBytes === 'function' ? randomBytes : crypto.randomBytes;
  let code = '';
  let authCode = '';
  do {
    code = randomToken(source, 16);
  } while (code.startsWith('BRZ') || /^[0-9]/.test(code));
  do {
    authCode = randomToken(source, 8);
  } while (authCode === code.slice(0, 8));
  return { code, authCode };
}

function webhookSignature(rawBody, secret) {
  return crypto.createHmac('sha256', String(secret || '')).update(rawBody).digest('hex');
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret) return false;
  const given = String(signature || '').trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = webhookSignature(rawBody, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) {
    return false;
  }
}

function orderStatusLabel(status) {
  return ({
    pending: '결제 대기',
    paid: '결제 완료',
    cancelled: '취소됨',
    failed: '결제 실패',
  })[status] || '확인 중';
}

module.exports = {
  PLAN_DEFINITIONS,
  PLAN_ORDER,
  METHODS,
  MODES,
  STATUSES,
  planList,
  resolvePlan,
  totalsFor,
  validateOrderRequest,
  validateIdempotencyKey,
  normalizeBuyer,
  resolvePaymentMode,
  methodsForMode,
  allowedTransition,
  orderNumber,
  generateLicenseCodes,
  webhookSignature,
  verifyWebhookSignature,
  orderStatusLabel,
  sanitizeText,
};
