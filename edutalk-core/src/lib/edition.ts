// 브리즈 에디션 단일 정의: 웹=기본(문자형), Windows 설치판=교사 풀버전.
// 코어의 P2P/SQLite/DLP/USB/캡처가림은 OS 기능이라 웹 기술로 올리기 어렵다.
// 그래서 웹에는 올리지 않고 Windows 전용으로 둔다.
export const EDITION_WEB = "web-basic" as const;
export const EDITION_WINDOWS = "windows-full" as const;

export const WINDOWS_ONLY_FEATURES = [
  "교내망 P2P 직접 전송",
  "PC 내 SQLite 저장",
  "전송 전 유출 검사",
  "시간표·대강",
  "USB 감시·캡처 가림",
] as const;

export function isTauriDesktop(): boolean {
  try {
    if (typeof window === "undefined") return false;
    // __TAURI__(withGlobalTauri) 또는 __TAURI_INTERNALS__(v2 기본 IPC) 중 하나라도 있으면 진짜 앱이다.
    // 이 검사가 틀리면 설치판에서도 앱이 스스로 '미리보기'로 착각해 러스트 기능을 건너뛴다.
    return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
  } catch {
    return false;
  }
}

// 브라우저 미리보기에서는 풀버전이 아니다 (mock 저장소만 동작)
export function isWindowsFull(): boolean {
  return isTauriDesktop();
}
