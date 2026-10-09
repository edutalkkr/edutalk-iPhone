// 브리즈 Functions (v2 API · 리전 고정 asia-northeast3)
// DB가 서울 리전이라 Functions도 같은 리전으로 고정한다.
// 리전이 다르면 매 실행마다 태평양 횡단 전송료(egress)가 붙는다.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const crypto = require("crypto");
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
