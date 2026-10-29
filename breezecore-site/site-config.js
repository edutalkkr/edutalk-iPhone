/* 브리즈코어 소개 사이트 기본 설정.
 * 관리자 페이지(/breezecore/admin)에서 저장한 Firestore 값이 있으면 그 값이 우선해요.
 * 외부 연결이 없거나 Firebase 설정이 비어 있으면 이 기본값으로 조용히 동작합니다. */
window.BREEZE_SITE_DEFAULTS = {
  siteTitle: "브리즈코어 · 학교 전용 업무 메신저",
  siteDescription:
    "선생님은 380px 데스크톱 앱으로, 학생은 설치 없이 브라우저로 쓰는 학교 전용 업무 메신저예요. 쪽지·학생 문의·시간표·공지·보안 기록을 교내 서버에서 관리해요.",
  heroDesc:
    "선생님은 380px 데스크톱 앱으로, 학생은 설치 없이 브라우저로 접속해요. 쪽지·학생 문의·시간표·공지·보안 기록을 교내 서버에서 관리해요.",
  breezeLabel: "Breeze",
  breezeUrl: "/breeze",
  popupEnabled: true,
  popupTitle: "브리즈코어 도입 안내",
  popupBody:
    "교내 서버 한 대와 학교 코드 하나로 시작해요. 교사 앱과 학생 웹, 관리자 콘솔이 어떻게 연결되는지 확인해 보세요.",
  popupLinkLabel: "도입 안내 보기",
  popupLinkUrl: "#adopt",
  popupHideDays: 1
};
