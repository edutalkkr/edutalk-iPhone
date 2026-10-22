/* Breeze cloud bootstrap
 * 실제 웹 앱 설정은 저장소에 두지 않고, 배포할 때 firebase-config.js 로 주입합니다.
 * firebase-config.example.js 를 복사해 값을 채우거나 배포 환경에서 생성해 주세요.
 * 보안 경계는 ① firestore.rules 의 접근 제어, ② 클라우드 콘솔의 API 키 제한입니다.
 */
(function () {
  'use strict';
  var cfg = window.BREEZE_FIREBASE_CONFIG;
  function unavailable(reason) {
    window.EduFirebase = { unavailable: true, reason: reason };
  }
  if (!cfg || !cfg.apiKey || !cfg.authDomain || !cfg.projectId || !cfg.appId) {
    unavailable('이 브라우저 버전은 서비스 설정이 없어 시작할 수 없어요.');
    return;
  }
  try {
    firebase.initializeApp(cfg);
    window.EduFirebase = {
      firebase: firebase,
      auth: firebase.auth(),
      db: firebase.firestore(),
      config: cfg
    };
  } catch (err) {
    try { console.error('[breeze-cloud]', err); } catch (_) {}
    unavailable('서비스 연결을 준비하지 못했어요.');
  }
})();
