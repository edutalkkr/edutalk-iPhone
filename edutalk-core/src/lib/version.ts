// 앱 버전·에디션 표시용 (tauri.conf.json / Cargo.toml / package.json 버전과 함께 올린다)
export const APP_VERSION = "0.2.1";

// 에디션: 교육기관용(학교) 우선. 회사용은 추후 확장.
export const EDITION_ID = "edu" as const;
export const EDITION_LABEL = "교육기관용";
