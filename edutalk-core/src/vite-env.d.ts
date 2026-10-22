/** Vite 환경 변수 타입 (API 키는 서버 .env 로만 관리한다 — 클라이언트 하드코딩 금지) */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 앱 버전 표기 등 선택 값만 여기서 관리한다. */
  readonly VITE_APP_TITLE?: string;
  /** 학교 이용권 상태 조회용 공개 웹 앱 식별자 (비밀 키 아님) */
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  /** 시간표 화면에서 여는 공개 웹 주소 */
  readonly VITE_PUBLIC_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
