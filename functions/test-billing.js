'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('crypto');
const billing = require('./billing-core');

test('요금제는 서버 가격표 기준으로 계산한다', () => {
  const plans = billing.planList();
  assert.equal(plans.length, 4);
  const basic = billing.resolvePlan('single_1y');
  assert.equal(basic.totalAmount, 198000);
  assert.equal(basic.supplyAmount + basic.vatAmount, 198000);
  assert.equal(basic.chatOnly, false);
  assert.deepEqual(billing.PLAN_ORDER, ['single_chat_1y', 'single_1y', 'dual_chat_1y', 'dual_unified_1y']);
});

test('주문 입력을 검증하고 이름·학교를 정리한다', () => {
  const good = billing.validateOrderRequest({
    planId: 'single_1y',
    method: 'card',
    agree: true,
    buyerName: '  김하늘  ',
    schoolName: '  한빛중학교 ',
    phone: '010-1234-5678',
  });
  assert.equal(good.ok, true);
  assert.equal(good.value.buyerName, '김하늘');
  assert.equal(good.value.schoolName, '한빛중학교');
  assert.equal(good.value.plan.totalAmount, 198000);

  assert.equal(billing.validateOrderRequest({ planId: 'nope', method: 'card', agree: true, buyerName: '김', schoolName: '학교' }).ok, false);
  assert.equal(billing.validateOrderRequest({ planId: 'single_1y', method: 'cash', agree: true, buyerName: '김', schoolName: '학교' }).ok, false);
  assert.equal(billing.validateOrderRequest({ planId: 'single_1y', method: 'card', agree: false, buyerName: '김', schoolName: '학교' }).ok, false);
  assert.equal(billing.validateOrderRequest({ planId: 'single_1y', method: 'card', agree: true, buyerName: ' ', schoolName: '학교' }).ok, false);
  assert.equal(billing.validateOrderRequest({ planId: 'single_1y', method: 'card', agree: true, buyerName: '김', schoolName: '학교', phone: 'abc' }).ok, false);
});

test('멱등 키는 재시도에 쓸 수 있는 형식만 허용한다', () => {
  assert.equal(billing.validateIdempotencyKey('0123456789abcdef0123456789abcdef'), true);
  assert.equal(billing.validateIdempotencyKey('req_1234567890_abcdef'), true);
  assert.equal(billing.validateIdempotencyKey('short'), false);
  assert.equal(billing.validateIdempotencyKey('has space in the key'), false);
  assert.equal(billing.validateIdempotencyKey('x'.repeat(81)), false);
});

test('결제 모드는 안전한 기본값과 허용 방법을 지킨다', () => {
  assert.equal(billing.resolvePaymentMode(''), 'manual');
  assert.equal(billing.resolvePaymentMode('unknown'), 'manual');
  assert.deepEqual(billing.methodsForMode('manual'), ['transfer']);
  assert.deepEqual(billing.methodsForMode('sandbox'), ['card', 'transfer']);
  assert.deepEqual(billing.methodsForMode('live'), ['card', 'transfer']);
});

test('주문 번호와 이용권 코드는 예측하기 어려운 형식이다', () => {
  const orderNo = billing.orderNumber(new Date('2026-10-22T00:00:00Z'), crypto.randomBytes);
  assert.match(orderNo, /^BRZ-20261022-[A-Z2-9]{6}$/);

  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const { code, authCode } = billing.generateLicenseCodes(crypto.randomBytes);
    assert.match(code, /^[A-Z2-9]{16}$/);
    assert.match(authCode, /^[A-Z2-9]{8}$/);
    assert.equal(code.startsWith('BRZ'), false);
    assert.notEqual(authCode, code.slice(0, 8));
    assert.equal(seen.has(code), false);
    seen.add(code);
  }
});

test('웹훅 서명을 확인하고 위조 요청을 거부한다', () => {
  const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment.paid', data: { orderId: 'o1', amount: 198000 } }));
  const secret = 'test-webhook-secret';
  const signature = billing.webhookSignature(body, secret);
  assert.equal(billing.verifyWebhookSignature(body, signature, secret), true);
  assert.equal(billing.verifyWebhookSignature(body, `sha256=${signature}`, secret), true);
  assert.equal(billing.verifyWebhookSignature(body, signature, 'wrong'), false);
  assert.equal(billing.verifyWebhookSignature(body, 'not-a-signature', secret), false);
  assert.equal(billing.verifyWebhookSignature(body, signature, ''), false);
});

test('주문 상태 전이는 허용된 경로만 통과한다', () => {
  assert.equal(billing.allowedTransition('pending', 'paid'), true);
  assert.equal(billing.allowedTransition('pending', 'cancelled'), true);
  assert.equal(billing.allowedTransition('pending', 'failed'), true);
  assert.equal(billing.allowedTransition('paid', 'pending'), false);
  assert.equal(billing.allowedTransition('cancelled', 'paid'), false);
  assert.equal(billing.allowedTransition('paid', 'paid'), false);
});
