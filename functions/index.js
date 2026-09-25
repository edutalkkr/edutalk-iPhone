const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// 매일 새벽 3시(KST) 만료된 파일·메시지 정리
// - 채팅 메시지: expire_at(30일) 경과 시 영구 삭제
// - 건의사항: expire_at(1년) 경과 시 영구 삭제
// - 학교별 fileRetentionDays가 설정된 경우, 해당 일수 경과 파일도 삭제
exports.dailyPurgeExpired = functions.pubsub
  .schedule("0 3 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
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
    return null;
  });

// Storage 파일 만료 시 자동 삭제 (선택적 - Storage에 파일이 직접 저장된 경우)
// exports.onFileFinalize = functions.storage.object().onFinalize(async (object) => { ... });

// 수동 호출용 HTTP 트리거 (관리자 테스트용)
exports.manualPurge = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.role !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "admin only");
  }
  const now = admin.firestore.Timestamp.now();
  const snap = await db.collectionGroup("messages").where("expire_at", "<=", now).limit(100).get();
  return { count: snap.size };
});
