// 브리즈 Functions (v2 API · 리전 고정 asia-northeast3)
// DB가 서울 리전이라 Functions도 같은 리전으로 고정한다.
// 리전이 다르면 매 실행마다 태평양 횡단 전송료(egress)가 붙는다.
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const crypto = require("crypto");
const billing = require("./billing-core");
admin.initializeApp();
const db = admin.firestore();

const R = "asia-northeast3";

// 내부망 라이선스 서명 (학교별 비밀 = 학교가 등록한 서버 등록 코드)
function b64u(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}
function signInternalLicense(payload, secret) {
  const body = b64u(payload);
  const sig = crypto.createHmac("sha256", String(secret)).update(body).digest("base64url");
  return body + "." + sig;
}
async function schoolDualEntitlement(schoolId) {
  // 유료 듀얼 이용권이 해당 학교에 활성화돼 있으면 만료일을 돌려준다
  // 통합 요금제: dual_1y(구) + dual_unified_1y / dual_chat_1y(신) 모두 듀얼로 인정
  const DUAL_TYPES = ["dual_1y", "dual_unified_1y", "dual_chat_1y", "dual_1y_paid"];
  try {
    const snap = await db.collection("licenses").where("schoolId", "==", schoolId).where("status", "==", "active").limit(20).get();
    let best = null;
    snap.docs.forEach((d) => {
      const v = d.data() || {};
      if (!DUAL_TYPES.includes(v.type)) return;
      // 소통 전용도 네트워크 권한은 듀얼로 인정 (시간표 차단은 클라이언트+서버 별도)
      const exp = v.expiresAt ? new Date(v.expiresAt._seconds ? v.expiresAt._seconds * 1000 : v.expiresAt).getTime() : 0;
      if (exp > Date.now() && (!best || exp > best.exp)) best = { exp, id: d.id };
    });
    return best;
  } catch (e) {
    console.error("dual entitlement", e);
    return null;
  }
}

// 통합 요금제 메타 (클라이언트 LICENSE_TYPES와 동기화)
const UNIFIED_LICENSE_META = {
  single_1y: { days: 365, network: "single", chatOnly: false, label: "단일망 이용권 1년" },
  dual_unified_1y: { days: 365, network: "dual", chatOnly: false, label: "듀얼망 이용권 1년" },
  single_chat_1y: { days: 365, network: "single", chatOnly: true, label: "단일망 소통 전용 1년" },
  dual_chat_1y: { days: 365, network: "dual", chatOnly: true, label: "듀얼망 소통 전용 1년" },
  // 구형 호환
  paid_1y: { days: 365, network: "single", chatOnly: false, label: "1년 이용권 (구 단일망)" },
  dual_1y: { days: 365, network: "dual", chatOnly: false, label: "유료 듀얼 네트워크 1년 (구)" },
  free_1d: { days: 1, network: "single", chatOnly: false, label: "무료 1일" },
  free_10d: { days: 10, network: "single", chatOnly: false, label: "무료 10일" },
  free_1y: { days: 365, network: "single", chatOnly: false, label: "무료 1년" },
  free_unlimited: { days: 0, network: "single", chatOnly: false, label: "무제한" },
};

// ---------- 이용권 주문·결제 ----------
// 결제 금액은 이 파일의 요금제 정의에서만 계산한다. 클라이언트가 보낸 금액은 신뢰하지 않는다.
// 기본값은 안전한 무통장 입금 확인 방식이며, 결제 대행사 연동 시 PAYMENT_MODE=live를 쓴다.
function billingMode() {
  return billing.resolvePaymentMode(process.env.PAYMENT_MODE);
}

function billingBankInfo() {
  const bankName = String(process.env.BILLING_BANK_NAME || "").trim();
  const accountNumber = String(process.env.BILLING_ACCOUNT_NUMBER || "").trim();
  const accountHolder = String(process.env.BILLING_ACCOUNT_HOLDER || "").trim();
  return {
    bankName,
    accountNumber,
    accountHolder,
    guide: String(process.env.BILLING_TRANSFER_GUIDE || "입금자명을 학교명으로 남겨 주세요.").trim(),
    configured: !!(bankName && accountNumber && accountHolder),
  };
}

function billingDepositHours() {
  const n = Number(process.env.BILLING_DEPOSIT_DUE_HOURS || 72);
  return Number.isFinite(n) ? Math.min(168, Math.max(12, Math.round(n))) : 72;
}

function billingCheckoutUrl(order) {
  const template = String(process.env.BILLING_CHECKOUT_URL || "").trim();
  if (!template) return "";
  try {
    const url = new URL(template);
    if (url.protocol !== "https:") return "";
    url.searchParams.set("orderId", order.id);
    url.searchParams.set("orderNo", order.orderNo);
    url.searchParams.set("amount", String(order.totalAmount));
    url.searchParams.set("plan", order.planId);
    return url.toString();
  } catch (e) {
    console.error("billing checkout url", e);
    return "";
  }
}

async function billingActor(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요해요. [E-BILL-010]");
  const uid = request.auth.uid;
  const snap = await db.collection("users").doc(uid).get();
  const profile = snap.exists ? snap.data() || {} : {};
  const role = String(profile.role || (request.auth.token && request.auth.token.role) || "");
  if (role !== "admin" && role !== "school_admin") {
    throw new HttpsError("permission-denied", "학교 관리자 계정에서 이용권을 구매할 수 있어요. [E-BILL-011]");
  }
  return {
    uid,
    role,
    profile,
    email: String((request.auth.token && request.auth.token.email) || profile.email || ""),
    schoolId: String(profile.schoolId || ""),
    schoolName: String(profile.schoolName || ""),
  };
}

async function schoolNameFor(actor, requestedName) {
  if (actor.role === "school_admin") {
    if (!actor.schoolId) throw new HttpsError("failed-precondition", "학교 정보가 없어요. 학교 배정을 먼저 확인해 주세요. [E-BILL-012]");
    try {
      const s = await db.collection("schools").doc(actor.schoolId).get();
      if (s.exists) {
        const name = String((s.data() || {}).name || "").trim();
        if (name) return name;
      }
    } catch (e) {
      console.error("billing school name", e);
    }
    return actor.schoolName || String(requestedName || "").trim();
  }
  return String(requestedName || actor.schoolName || "").trim();
}

function publicOrder(order) {
  if (!order) return null;
  return {
    orderId: order.id || "",
    orderNo: order.orderNo || "",
    status: order.status || "pending",
    statusLabel: billing.orderStatusLabel(order.status),
    method: order.method || "",
    provider: order.provider || "",
    planId: order.planId || "",
    planLabel: order.planLabel || "",
    days: Number(order.days || 0),
    network: order.network || "single",
    chatOnly: !!order.chatOnly,
    supplyAmount: Number(order.supplyAmount || 0),
    vatAmount: Number(order.vatAmount || 0),
    totalAmount: Number(order.totalAmount || 0),
    buyerName: order.buyerName || "",
    buyerEmail: order.buyerEmail || "",
    schoolId: order.schoolId || "",
    schoolName: order.schoolName || "",
    licenseCode: order.licenseCode || "",
    createdAt: order.createdAt || null,
    paidAt: order.paidAt || null,
    dueAt: order.dueAt || null,
    cancelledAt: order.cancelledAt || null,
  };
}

function billingOrderPayload(order, mode, checkoutUrl) {
  const method = order.method || "";
  const dueMs = order.dueAt && typeof order.dueAt.toMillis === "function"
    ? order.dueAt.toMillis()
    : (Number(order.dueAt || 0) || null);
  const provider = order.provider || mode;
  const url = checkoutUrl != null
    ? checkoutUrl
    : (method === "card" && provider === "live" ? billingCheckoutUrl(order) : "");
  return {
    ok: true,
    orderId: order.id || "",
    orderNo: order.orderNo || "",
    status: order.status || "pending",
    method,
    mode: provider,
    planId: order.planId || "",
    planLabel: order.planLabel || "",
    days: Number(order.days || 0),
    totalAmount: Number(order.totalAmount || 0),
    supplyAmount: Number(order.supplyAmount || 0),
    vatAmount: Number(order.vatAmount || 0),
    bank: method === "transfer" ? billingBankInfo() : null,
    dueAt: dueMs,
    depositHours: billingDepositHours(),
    sandbox: provider === "sandbox" && method === "card",
    checkoutUrl: url,
  };
}

async function issueLicenseForOrder(orderId, meta) {
  const extra = meta && typeof meta === "object" ? meta : {};
  const orderRef = db.collection("licenseOrders").doc(orderId);
  return db.runTransaction(async (tx) => {
    const os = await tx.get(orderRef);
    if (!os.exists) throw new HttpsError("not-found", "주문을 찾을 수 없어요. [E-BILL-020]");
    const order = os.data() || {};
    if (order.status === "paid" && order.licenseCode) {
      const ls = await tx.get(db.collection("licenses").doc(order.licenseCode));
      return {
        ok: true,
        already: true,
        orderId,
        orderNo: order.orderNo || "",
        licenseCode: order.licenseCode,
        authCode: ls.exists ? String((ls.data() || {}).authCode || "") : "",
        status: "paid",
      };
    }
    if (!billing.allowedTransition(order.status || "pending", "paid")) {
      throw new HttpsError("failed-precondition", "지금은 결제를 완료할 수 없는 주문이에요. [E-BILL-021]");
    }
    const pair = billing.generateLicenseCodes(crypto.randomBytes);
    const licenseRef = db.collection("licenses").doc(pair.code);
    const exists = await tx.get(licenseRef);
    if (exists.exists) throw new HttpsError("internal", "이용권 코드를 다시 발급해 주세요. [E-BILL-022]");
    const now = () => admin.firestore.FieldValue.serverTimestamp();
    tx.set(licenseRef, {
      code: pair.code,
      authCode: pair.authCode,
      type: order.planId,
      days: Number(order.days || 365),
      price: Number(order.totalAmount || 0),
      status: "issued",
      schoolId: order.schoolId || "",
      purchasedBy: order.buyerUid,
      purchasedByName: order.buyerName || "",
      purchasedByEmail: order.buyerEmail || "",
      purchaseAt: now(),
      createdAt: now(),
      memo: "온라인 이용권 구매",
      orderId,
      paymentMethod: order.method || "",
      network: order.network || "single",
      chatOnly: !!order.chatOnly,
      updatedAt: now(),
    });
    tx.update(orderRef, {
      status: "paid",
      paidAt: now(),
      licenseCode: pair.code,
      providerRef: String(extra.providerRef || ""),
      confirmedBy: String(extra.confirmedBy || ""),
      updatedAt: now(),
    });
    return {
      ok: true,
      already: false,
      orderId,
      orderNo: order.orderNo || "",
      licenseCode: pair.code,
      authCode: pair.authCode,
      status: "paid",
    };
  });
}

function orderForBuyer(order, actor) {
  if (!order) return false;
  if (actor.role === "admin") return true;
  return String(order.buyerUid || "") === actor.uid;
}

exports.getBillingPlans = onCall({ region: R }, async (request) => {
  const actor = await billingActor(request);
  const mode = billingMode();
  const bank = billingBankInfo();
  return {
    ok: true,
    mode,
    methods: billing.methodsForMode(mode),
    plans: billing.planList(),
    bank: {
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      accountHolder: bank.accountHolder,
      guide: bank.guide,
      configured: !!(bank.bankName && bank.accountNumber && bank.accountHolder),
    },
    depositHours: billingDepositHours(),
    buyer: { name: actor.profile.displayName || "", email: actor.email, schoolName: await schoolNameFor(actor, "") },
  };
});

exports.createLicenseOrder = onCall({ region: R }, async (request) => {
  const actor = await billingActor(request);
  const idempotencyKey = String((request.data || {}).idempotencyKey || "").trim();
  if (!billing.validateIdempotencyKey(idempotencyKey)) {
    throw new HttpsError("invalid-argument", "주문 요청을 다시 확인해 주세요. [E-BILL-015]");
  }
  const check = billing.validateOrderRequest(request.data || {});
  if (!check.ok) throw new HttpsError("invalid-argument", check.error);
  const { plan, method, buyerName, phone } = check.value;
  const mode = billingMode();
  if (!billing.methodsForMode(mode).includes(method)) {
    throw new HttpsError("failed-precondition", "지금은 이 결제 방법을 쓸 수 없어요. 다른 방법을 골라 주세요. [E-BILL-013]");
  }
  const schoolName = await schoolNameFor(actor, check.value.schoolName);
  if (!schoolName) throw new HttpsError("invalid-argument", "학교 이름을 확인해 주세요. [E-BILL-005]");
  // 같은 요청이 네트워크 재시도로 두 번 와도 주문은 하나만 생긴다.
  const orderId = crypto.createHash("sha256").update(`${actor.uid}|${idempotencyKey}`).digest("hex").slice(0, 32);
  const orderRef = db.collection("licenseOrders").doc(orderId);
  const now = () => admin.firestore.FieldValue.serverTimestamp();
  const dueHours = billingDepositHours();
  const base = {
    orderNo: billing.orderNumber(new Date(), crypto.randomBytes),
    buyerUid: actor.uid,
    buyerEmail: actor.email,
    buyerName,
    buyerPhone: phone || "",
    schoolId: actor.role === "school_admin" ? actor.schoolId : "",
    schoolName,
    planId: plan.id,
    planLabel: plan.label,
    days: plan.days,
    network: plan.network,
    chatOnly: !!plan.chatOnly,
    supplyAmount: plan.supplyAmount,
    vatAmount: plan.vatAmount,
    totalAmount: plan.totalAmount,
    method,
    provider: mode,
    status: "pending",
    createdAt: now(),
    updatedAt: now(),
  };
  if (method === "transfer") {
    base.dueAt = admin.firestore.Timestamp.fromMillis(Date.now() + dueHours * 3600000);
  }
  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(orderRef);
    if (existing.exists) return { existing: { id: existing.id, ...(existing.data() || {}) } };
    tx.set(orderRef, base);
    return { created: true };
  });
  if (result.existing) {
    const existing = result.existing;
    if (String(existing.buyerUid || "") !== actor.uid) {
      throw new HttpsError("permission-denied", "이 주문을 확인할 권한이 없어요. [E-BILL-016]");
    }
    if (existing.planId !== plan.id || existing.method !== method) {
      throw new HttpsError("already-exists", "이미 처리 중인 주문이 있어요. 주문 내역을 확인해 주세요. [E-BILL-017]");
    }
    const payload = billingOrderPayload(existing, mode);
    if (existing.status === "paid" && existing.licenseCode) {
      const ls = await db.collection("licenses").doc(existing.licenseCode).get();
      payload.license = {
        code: existing.licenseCode,
        authCode: ls.exists ? String((ls.data() || {}).authCode || "") : "",
        type: existing.planId || "",
        days: Number(existing.days || 0),
        status: ls.exists ? String((ls.data() || {}).status || "issued") : "issued",
      };
    }
    return payload;
  }
  const order = { id: orderRef.id, ...base };
  const checkoutUrl = method === "card" && mode === "live" ? billingCheckoutUrl(order) : "";
  if (method === "card" && mode === "live" && !checkoutUrl) {
    await orderRef.update({ status: "failed", updatedAt: now() });
    throw new HttpsError("failed-precondition", "결제 창을 열 수 없어요. 잠시 후 다시 시도해 주세요. [E-BILL-014]");
  }
  return billingOrderPayload(order, mode, checkoutUrl);
});

exports.confirmLicenseOrder = onCall({ region: R }, async (request) => {
  const actor = await billingActor(request);
  if (billingMode() !== "sandbox") {
    throw new HttpsError("failed-precondition", "결제 확인은 결제 대행사 연결 후 처리할 수 있어요. [E-BILL-030]");
  }
  const orderId = String((request.data || {}).orderId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(orderId)) throw new HttpsError("invalid-argument", "주문 번호를 확인해 주세요. [E-BILL-031]");
  const ref = db.collection("licenseOrders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "주문을 찾을 수 없어요. [E-BILL-020]");
  const order = snap.data() || {};
  if (!orderForBuyer(order, actor)) throw new HttpsError("permission-denied", "이 주문을 확인할 권한이 없어요. [E-BILL-032]");
  if (order.method !== "card") throw new HttpsError("failed-precondition", "이 주문은 카드 결제 주문이 아니에요. [E-BILL-033]");
  if (order.status === "cancelled") throw new HttpsError("failed-precondition", "취소된 주문이에요. [E-BILL-034]");
  return issueLicenseForOrder(orderId, { providerRef: "sandbox", confirmedBy: actor.uid });
});

exports.getLicenseOrder = onCall({ region: R }, async (request) => {
  const actor = await billingActor(request);
  const orderId = String((request.data || {}).orderId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(orderId)) throw new HttpsError("invalid-argument", "주문 번호를 확인해 주세요. [E-BILL-031]");
  const snap = await db.collection("licenseOrders").doc(orderId).get();
  if (!snap.exists) throw new HttpsError("not-found", "주문을 찾을 수 없어요. [E-BILL-020]");
  const order = { id: snap.id, ...(snap.data() || {}) };
  if (!orderForBuyer(order, actor)) throw new HttpsError("permission-denied", "이 주문을 볼 권한이 없어요. [E-BILL-032]");
  let license = null;
  if (order.status === "paid" && order.licenseCode) {
    const ls = await db.collection("licenses").doc(order.licenseCode).get();
    if (ls.exists) {
      const l = ls.data() || {};
      license = {
        code: order.licenseCode,
        authCode: l.authCode || "",
        type: l.type || order.planId,
        days: Number(l.days || order.days || 0),
        status: l.status || "issued",
        activatedAt: l.activatedAt || null,
        expiresAt: l.expiresAt || null,
      };
    }
  }
  return { ok: true, order: publicOrder(order), license, bank: order.method === "transfer" ? billingBankInfo() : null };
});

exports.cancelLicenseOrder = onCall({ region: R }, async (request) => {
  const actor = await billingActor(request);
  const orderId = String((request.data || {}).orderId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(orderId)) throw new HttpsError("invalid-argument", "주문 번호를 확인해 주세요. [E-BILL-031]");
  const ref = db.collection("licenseOrders").doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "주문을 찾을 수 없어요. [E-BILL-020]");
    const order = snap.data() || {};
    if (!orderForBuyer(order, actor)) throw new HttpsError("permission-denied", "이 주문을 취소할 권한이 없어요. [E-BILL-032]");
    if (!billing.allowedTransition(order.status || "pending", "cancelled")) {
      throw new HttpsError("failed-precondition", "지금은 취소할 수 없는 주문이에요. [E-BILL-035]");
    }
    tx.update(ref, {
      status: "cancelled",
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, orderId, status: "cancelled" };
});

exports.markLicenseOrderPaid = onCall({ region: R }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요해요. [E-BILL-010]");
  const snap = await db.collection("users").doc(request.auth.uid).get();
  const role = snap.exists ? String((snap.data() || {}).role || "") : "";
  if (role !== "admin") throw new HttpsError("permission-denied", "총관리자만 입금을 확인할 수 있어요. [E-BILL-040]");
  const orderId = String((request.data || {}).orderId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(orderId)) throw new HttpsError("invalid-argument", "주문 번호를 확인해 주세요. [E-BILL-031]");
  const ref = db.collection("licenseOrders").doc(orderId);
  const os = await ref.get();
  if (!os.exists) throw new HttpsError("not-found", "주문을 찾을 수 없어요. [E-BILL-020]");
  const order = os.data() || {};
  if (order.method !== "transfer") throw new HttpsError("failed-precondition", "무통장 입금 주문만 확인할 수 있어요. [E-BILL-041]");
  if (order.status === "cancelled") throw new HttpsError("failed-precondition", "취소된 주문이에요. [E-BILL-034]");
  return issueLicenseForOrder(orderId, { providerRef: "manual-deposit", confirmedBy: request.auth.uid });
});

// 결제 대행사 웹훅: 서명이 맞고 금액이 주문과 같을 때만 이용권을 발급한다.
exports.licensePaymentWebhook = onRequest({ region: R }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const secret = String(process.env.PAYMENT_WEBHOOK_SECRET || "");
    if (!secret) {
      res.status(503).json({ ok: false, error: "webhook_not_configured" });
      return;
    }
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const signature = String(req.get("x-breeze-signature") || req.get("x-webhook-signature") || "");
    if (!billing.verifyWebhookSignature(raw, signature, secret)) {
      res.status(401).json({ ok: false, error: "invalid_signature" });
      return;
    }
    const event = req.body || {};
    if (String(event.type || "") !== "payment.paid") {
      res.status(202).json({ ok: true, ignored: true });
      return;
    }
    const data = event.data || {};
    const orderId = String(data.orderId || "").trim();
    const amount = Number(data.amount || 0);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(orderId) || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ ok: false, error: "invalid_payload" });
      return;
    }
    const orderSnap = await db.collection("licenseOrders").doc(orderId).get();
    if (!orderSnap.exists) {
      res.status(404).json({ ok: false, error: "order_not_found" });
      return;
    }
    const order = orderSnap.data() || {};
    if (Number(order.totalAmount || 0) !== Math.round(amount)) {
      res.status(409).json({ ok: false, error: "amount_mismatch" });
      return;
    }
    const result = await issueLicenseForOrder(orderId, {
      providerRef: String(data.transactionId || event.id || ""),
      confirmedBy: "payment-webhook",
    });
    res.status(200).json({ ok: true, orderId: result.orderId, status: result.status });
  } catch (e) {
    console.error("licensePaymentWebhook", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// 학교 관리자가 이용권을 직접 등록(활성화) — Rules 직접쓰기 금지(E-LIC-002) 해결용 서버 경유
// - 학교관리자(자기 학교) 또는 총관리자만 호출 가능
// - 단일망은 singleNet(EXTERNAL|INTERNAL) 필수, 등록 후 변경 불가(서버 강제)
// - 학교에 이미 active 이용권이 있으면 중복 등록 불가 (요금제 동시 사용 금지)
exports.redeemLicense = onCall({ region: R }, async (request) => {
  const data = request.data || {};
  const auth = request.auth;
  try {
    if (!auth) throw new HttpsError("unauthenticated", "[E-LIC-002] 로그인이 필요해요.");
    const uid = auth.uid;
    const code = String(data.code || "").trim().toUpperCase();
    const authCode = String(data.authCode || "").trim().toUpperCase();
    const singleNet = String(data.singleNet || "").trim().toUpperCase(); // EXTERNAL | INTERNAL | ''
    if (!/^[A-Z0-9]{16}$/.test(code)) throw new HttpsError("invalid-argument", "[E-LIC-004] 고유코드 16자리를 확인해 주세요.");
    if (!authCode) throw new HttpsError("invalid-argument", "[E-LIC-005] 인증코드를 입력해 주세요.");
    const udoc = await db.collection("users").doc(uid).get();
    const u = udoc.exists ? udoc.data() || {} : {};
    const isAdmin = u.role === "admin" || (auth.token && auth.token.role === "admin");
    const mySchool = String(u.schoolId || "");
    let schoolId = String(data.schoolId || mySchool || "");
    if (!isAdmin) {
      if (u.role !== "school_admin") throw new HttpsError("permission-denied", "[E-LIC-002] 학교 관리자 계정만 등록할 수 있어요. 역할=school_admin 필요.");
      if (!mySchool) throw new HttpsError("failed-precondition", "[E-LIC-003] 학교 정보가 없어요. 학교를 먼저 배정받아 주세요.");
      schoolId = mySchool; // 사칭 방지: 본인 학교로 고정
    }
    if (!schoolId) throw new HttpsError("invalid-argument", "[E-LIC-003] 학교를 확인할 수 없어요.");
    const ref = db.collection("licenses").doc(code);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "[E-LIC-001] 존재하지 않는 이용권 코드예요.");
    const lic = snap.data() || {};
    if (String(lic.authCode || "").toUpperCase() !== authCode) throw new HttpsError("permission-denied", "[E-LIC-005] 인증코드가 맞지 않아요.");
    if ((lic.status || "issued") !== "issued") throw new HttpsError("failed-precondition", "[E-LIC-006] 이미 쓰인 이용권이에요. 상태=" + (lic.status || "?"));
    const meta = UNIFIED_LICENSE_META[lic.type] || { days: Number(lic.days || 365), network: "single", chatOnly: false, label: lic.type };
    const days = Number(lic.days > 0 ? lic.days : meta.days || 365);
    // 단일망이면 외부/내부 선택 필수 + 이미 박힌 망과 충돌 검사
    let finalSingleNet = String(lic.singleNet || lic.lockedNet || "").toUpperCase();
    if (meta.network === "single") {
      if (!finalSingleNet) {
        if (singleNet !== "EXTERNAL" && singleNet !== "INTERNAL") throw new HttpsError("invalid-argument", "[E-LIC-007] 단일망 이용권은 외부망/내부망 중 하나를 선택해야 해요.");
        finalSingleNet = singleNet;
      } else if (singleNet && singleNet !== finalSingleNet) {
        throw new HttpsError("failed-precondition", "[E-LIC-008] 이미 " + finalSingleNet + "망으로 고정된 이용권이라 변경할 수 없어요.");
      }
    } else {
      finalSingleNet = "";
    }
    // 학교에 이미 이용 중(active) 이용권이 있으면 동시 사용 금지
    try {
      const activeSnap = await db.collection("licenses").where("schoolId", "==", schoolId).where("status", "==", "active").limit(5).get();
      const stillActive = activeSnap.docs.filter((d) => {
        const v = d.data() || {};
        if (d.id === code) return false;
        const exp = v.expiresAt ? new Date(v.expiresAt._seconds ? v.expiresAt._seconds * 1000 : v.expiresAt).getTime() : 0;
        if (v.days === 0 || v.type === "free_unlimited") return true;
        return exp > Date.now();
      });
      if (stillActive.length) throw new HttpsError("failed-precondition", "[E-LIC-009] 이미 이용 중인 이용권(" + stillActive[0].id.slice(0, 6) + "…)이 있어요. 요금제는 1개만 쓸 수 있어요.");
      const sdoc = await db.collection("schools").doc(schoolId).get();
      const sinfo = sdoc.exists ? sdoc.data() || {} : {};
      const sExp = sinfo.licenseExpiresAt ? new Date(sinfo.licenseExpiresAt._seconds ? sinfo.licenseExpiresAt._seconds * 1000 : sinfo.licenseExpiresAt).getTime() : 0;
      if ((sinfo.licenseStatus === "active") && sExp > Date.now()) throw new HttpsError("failed-precondition", "[E-LIC-009] 학교에 이미 이용 중인 이용권이 있어요. 만료·회수 후 등록해 주세요.");
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error("redeemLicense active-check", e);
    }
    const now = Date.now();
    const expiresAt = days > 0 ? admin.firestore.Timestamp.fromMillis(now + days * 86400000) : null;
    await ref.update({
      status: "active",
      schoolId,
      activatedBy: uid,
      activatedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
      singleNet: finalSingleNet || null,
      lockedNet: finalSingleNet || null,
      network: meta.network,
      chatOnly: !!meta.chatOnly,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection("schools").doc(schoolId).set({
      // 보안: 이용권 코드 원문은 schools에 저장하지 않는다 (schools는 가입 검색용 공개 읽기).
      // 코드는 licenses 컬렉션에서만 관리하고, 학교 문서는 상태·만료·종류만 갖는다.
      licenseCode: admin.firestore.FieldValue.delete(),
      licenseStatus: "active",
      licenseActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
      licenseExpiresAt: expiresAt,
      licenseType: lic.type,
      licenseNetwork: meta.network,
      licenseSingleNet: finalSingleNet || null,
      licenseChatOnly: !!meta.chatOnly,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, expiresAt: expiresAt ? expiresAt.toMillis() : null, singleNet: finalSingleNet || null, chatOnly: !!meta.chatOnly };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error("redeemLicense", e);
    throw new HttpsError("internal", "[E-LIC-000] 등록 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
  }
});
async function issueInternalLicenseFor(schoolId) {
  if (!schoolId) return null;
  const ent = await schoolDualEntitlement(schoolId);
  if (!ent) return null;
  let secret = "";
  let hwid = "";
  try {
    const ss = await db.collection("schoolSecrets").doc(schoolId).get();
    if (ss.exists) {
      secret = String((ss.data() || {}).secret || "");
      hwid = String((ss.data() || {}).hwid || "");
    }
  } catch (e) {}
  if (!secret) return null; // 서버 등록 코드를 아직 등록하지 않은 학교는 발급 보류
  let schoolName = "";
  try {
    const sc = await db.collection("schools").doc(schoolId).get();
    if (sc.exists) schoolName = String((sc.data() || {}).name || "");
  } catch (e) {}
  const payload = {
    school: schoolName,
    schoolId,
    hwid: hwid || undefined,
    expiresAt: new Date(ent.exp).toISOString(),
    isPaidDualNetworkActive: true,
    maxUsers: 0,
    issuedAt: new Date().toISOString(),
  };
  const key = signInternalLicense(payload, secret);
  await db.collection("internalLicenses").doc(schoolId).set({
    schoolId,
    schoolName,
    key,
    hwidBound: !!hwid,
    expiresAt: admin.firestore.Timestamp.fromMillis(ent.exp),
    licenseId: ent.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    auto: true,
  }, { merge: true });
  return key;
}

// 유료 듀얼 이용권이 활성화되면 내부망 라이선스를 자동으로 발급한다 (결제→등록 오토)
exports.onDualLicenseActive = onDocumentWritten(
  { document: "licenses/{licenseId}", region: R },
  async (event) => {
    try {
      const after = (event.data && event.data.after.exists) ? event.data.after.data() || {} : {};
      const dualTypes = ["dual_1y", "dual_unified_1y", "dual_chat_1y", "dual_1y_paid"];
      if (!dualTypes.includes(after.type) || after.status !== "active" || !after.schoolId) return null;
      await issueInternalLicenseFor(after.schoolId);
    } catch (e) {
      console.error("onDualLicenseActive", e);
    }
    return null;
  }
);

// 서버 등록 코드·hwid를 등록해도 (이미 결제한 학교는) 자동으로 발급된다
exports.onSchoolSecretRegistered = onDocumentWritten(
  { document: "schoolSecrets/{schoolId}", region: R },
  async (event) => {
    try {
      const sid = event.params.schoolId;
      if (!event.data || !event.data.after.exists) return null;
      await issueInternalLicenseFor(sid);
    } catch (e) {
      console.error("onSchoolSecretRegistered", e);
    }
    return null;
  }
);

// 학교 관리자의 수동 발급·재발급 (hwid 묶기 포함)
exports.issueInternalLicense = onCall({ region: R }, async (request) => {
  const data = request.data || {};
  const auth = request.auth;
  try {
    if (!auth) throw new HttpsError("unauthenticated", "login required");
    const uid = auth.uid;
    const schoolId = String(data.schoolId || "");
    const hwid = String(data.hwid || "").trim().toUpperCase().slice(0, 32);
    if (!schoolId) throw new HttpsError("invalid-argument", "schoolId required");
    const udoc = await db.collection("users").doc(uid).get();
    const u = udoc.exists ? udoc.data() || {} : {};
    const isAdmin = u.role === "admin" || (auth.token && auth.token.role === "admin");
    const isOwnSchoolAdmin = u.role === "school_admin" && u.schoolId === schoolId;
    if (!isAdmin && !isOwnSchoolAdmin) throw new HttpsError("permission-denied", "not allowed");
    if (hwid) {
      const ref = db.collection("schoolSecrets").doc(schoolId);
      const cur = await ref.get();
      if (!cur.exists) throw new HttpsError("failed-precondition", "register server first");
      await ref.set({ hwid, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    const key = await issueInternalLicenseFor(schoolId);
    if (!key) throw new HttpsError("failed-precondition", "no dual entitlement or no server secret");
    return { key };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error("issueInternalLicense", e);
    throw new HttpsError("internal", "issue failed");
  }
});

// 매일 새벽 3시(KST) 만료된 파일·메시지 정리
// - 채팅 메시지: expire_at(30일) 경과 시 영구 삭제
// - 건의사항: expire_at(1년) 경과 시 영구 삭제
// - 학교별 fileRetentionDays가 설정된 경우, 해당 일수 경과 파일도 삭제
exports.dailyPurgeExpired = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Asia/Seoul", region: R },
  async () => {
    const now = admin.firestore.Timestamp.now();
    let deletedMessages = 0;
    let deletedSuggestions = 0;

    // 1) 만료된 채팅 메시지 (channels/{room}/messages where expire_at <= now)
    // Firestore는 컬렉션 그룹 쿼리로 전체 메시지를 한 번에 조회
    try {
      const snap = await db.collectionGroup("messages").where("expire_at", "<=", now).limit(500).get();
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      if (!snap.empty) {
        await batch.commit();
        deletedMessages = snap.size;
      }
    } catch (e) {
      console.error("purge messages", e);
    }

    // 2) 만료된 건의사항 (suggestions where expire_at <= now)
    try {
      const snap2 = await db.collection("suggestions").where("expire_at", "<=", now).limit(500).get();
      const batch2 = db.batch();
      snap2.docs.forEach((doc) => batch2.delete(doc.ref));
      if (!snap2.empty) {
        await batch2.commit();
        deletedSuggestions = snap2.size;
      }
    } catch (e) {
      console.error("purge suggestions", e);
    }

    // 3) 학교별 fileRetentionDays 기반 파일 만료 (선택적)
    // 각 학교의 fileRetentionDays를 읽어, 해당 일수 이전의 첨부파일 메시지를 삭제
    // 실제 Storage 파일 삭제는 별도 Storage 트리거에서 처리하거나, 메시지 삭제 시 클라이언트가 Storage도 함께 삭제하도록 함
    console.log(`dailyPurgeExpired: messages ${deletedMessages}, suggestions ${deletedSuggestions}`);

    // 4) 마지막 1명이 나가서 삭제 표시된 방: 30일 뒤 대화 + 방 영구 파기 (유령방 방지)
    try {
      const rooms = await db.collection("channels").where("deleted", "==", true).where("expire_at", "<=", now).limit(20).get();
      for (const rdoc of rooms.docs) {
        try {
          const ms = await rdoc.ref.collection("messages").limit(500).get();
          if (!ms.empty) {
            const b = db.batch();
            ms.docs.forEach((d) => b.delete(d.ref));
            await b.commit();
          }
          const again = await rdoc.ref.collection("messages").limit(1).get();
          if (again.empty) await rdoc.ref.delete();
        } catch (e) {
          console.error("purge room", rdoc.id, e);
        }
      }
    } catch (e) {
      console.error("purge rooms", e);
    }
    return null;
  }
);

// Storage 파일 만료 시 자동 삭제 (선택적 - Storage에 파일이 직접 저장된 경우)
// exports.onFileFinalize = functions.storage.object().onFinalize(async (object) => { ... });

// 수동 호출용 HTTP 트리거 (관리자 테스트용)
exports.manualPurge = onCall({ region: R }, async (request) => {
  const auth = request.auth;
  if (!auth || !(auth.token && auth.token.role === "admin")) {
    throw new HttpsError("permission-denied", "admin only");
  }
  const now = admin.firestore.Timestamp.now();
  const snap = await db.collectionGroup("messages").where("expire_at", "<=", now).limit(100).get();
  return { count: snap.size };
});

// 새 메시지가 오면 방 멤버에게 푸시 발송 (iOS 오프라인·백그라운드 포함)
// - pushTokens/{uid} 에 저장된 FCM 토큰으로 multicast
// - 보낸 사람 제외, 최대 400명 (쿼리 500 제한 내)
exports.onMessagePush = onDocumentCreated(
  { document: "channels/{roomId}/messages/{messageId}", region: R },
  async (event) => {
    const snap = event.data;
    if (!snap) return null;
    const msg = snap.data() || {};
    const roomId = event.params.roomId;
    try {
      if (msg.deleted || msg.system) return null;
      const senderId = msg.senderId || "";
      const text = String(msg.text || "").slice(0, 120);
      if (!roomId) return null;
      let room = {};
      try {
        const rs = await db.collection("channels").doc(roomId).get();
        if (rs.exists) room = rs.data() || {};
      } catch (e) {}
      if (room.deleted || room.deleted_at) return null;
      const memberIds = Array.isArray(room.memberIds) ? room.memberIds.filter((id) => id && id !== senderId).slice(0, 400) : [];
      if (!memberIds.length) return null;
      const tokenDocs = await Promise.all(
        memberIds.map((uid) => db.collection("pushTokens").doc(uid).get().catch(() => null))
      );
      const tokens = [];
      tokenDocs.forEach((d) => {
        try {
          if (d && d.exists) {
            const t = d.data() || {};
            if (t.enabled !== false && t.token) tokens.push(String(t.token));
          }
        } catch (e) {}
      });
      const uniq = [...new Set(tokens)].slice(0, 400);
      if (!uniq.length) return null;
      const roomName = String(room.name || "브리즈");
      const senderName = String(msg.senderName || "새 메시지");
      const notification = {
        title: `${roomName} · ${senderName}`,
        body: text || "새 메시지가 왔어요.",
      };
      const data = { roomId: String(roomId), click_action: "FLUTTER_NOTIFICATION_CLICK" };
      // iOS는 APNs 경유: badge·sound 포함, 백그라운드·오프라인 뒤에도 도착
      await admin.messaging().sendEachForMulticast({
        tokens: uniq,
        notification,
        data,
        android: { priority: "high", notification: { sound: "default" } },
        apns: { payload: { aps: { sound: "default", badge: 1 } } },
      });
      return null;
    } catch (e) {
      console.error("onMessagePush", e);
      return null;
    }
  }
);

// 일시 이용정지 만료자 자동 해제 (1시간마다 — 과금 다이어트)
// - suspended==true 이고 suspendedUntil(Timestamp) 경과 시 정지 해제
// - 클라이언트 본인 해제는 규칙으로도 허용하지만, 오프라인 유저를 위해 서버가 확정 처리
exports.releaseExpiredSuspensions = onSchedule(
  { schedule: "17 * * * *", timeZone: "Asia/Seoul", region: R },
  async () => {
    try {
      const snap = await db.collection("users").where("suspended", "==", true).limit(200).get();
      const now = Date.now();
      const batch = db.batch();
      let n = 0;
      snap.docs.forEach((d) => {
        try {
          const v = d.data() || {};
          const u = v.suspendedUntil;
          const ms = u && typeof u.toMillis === "function" ? u.toMillis() : (typeof u === "number" ? u : 0);
          if (ms > 0 && ms <= now) {
            batch.update(d.ref, {
              suspended: false,
              suspendReason: "",
              suspendedAt: null,
              suspendedUntil: null,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            n += 1;
          }
        } catch (e) {}
      });
      if (n) await batch.commit();
      console.log(`releaseExpiredSuspensions: released ${n}`);
    } catch (e) {
      console.error("releaseExpiredSuspensions", e);
    }
    return null;
  }
);

// 예약 발송 확정 처리 (15분마다 — 과금 다이어트)
// - 클라이언트 타이머가 꺼져 있어도 서버가 발송 보장 (이중 발송은 status claim으로 방지)
exports.deliverScheduledNotices = onSchedule(
  { schedule: "*/15 * * * *", timeZone: "Asia/Seoul", region: R },
  async () => {
    try {
      const nowMs = Date.now();
      const snap = await db.collection("scheduledNotices").where("status", "==", "waiting").limit(50).get();
      let n = 0;
      for (const doc of snap.docs) {
        const r = doc.data() || {};
        const runMs = r.runAt && typeof r.runAt.toMillis === "function" ? r.runAt.toMillis() : 0;
        if (!(runMs > 0 && runMs <= nowMs)) continue;
        try {
          let claimed = false;
          await db.runTransaction(async (tx) => {
            const s = await tx.get(doc.ref);
            if (s.exists && s.data().status === "waiting") {
              tx.update(doc.ref, { status: "sending", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
              claimed = true;
            }
          });
          if (!claimed) continue;
          if (r.roomId) {
            const msgRef = db.collection("channels").doc(r.roomId).collection("messages").doc();
            const batch = db.batch();
            batch.set(msgRef, {
              text: String(r.text || ""),
              senderId: r.byUid || "",
              senderName: r.byName || "",
              senderRole: "teacher",
              replyToText: null,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              deleted: false,
              scheduled: true,
            });
            batch.update(db.collection("channels").doc(r.roomId), {
              lastText: String(r.text || ""),
              lastSenderId: r.byUid || "",
              lastSenderName: r.byName || "",
              lastCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            await batch.commit();
          }
          await doc.ref.update({ status: "sent", sentAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          n += 1;
        } catch (e) {
          console.error("deliverScheduled", doc.id, e);
        }
      }
      if (n) console.log(`deliverScheduledNotices: sent ${n}`);
    } catch (e) {
      console.error("deliverScheduledNotices", e);
    }
    return null;
  }
);
