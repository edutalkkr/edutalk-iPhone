// 원격 지원 정책: 교내망 P2P 전용. Firebase 클라우드(외부망 중계) 학교는 차단.
// - 외부망 모드이면 클라우드 중계라서 상대 PC를 직접 찾을 수 없다.
// - 이용권이 외부망 고정(EXTERNAL)이면 그 학교는 Firebase 클라우드를 쓰는 학교라서 차단.
// 실제 화면 전송은 다음 단계이며, 지금은 연결 틀(핸드셰이크)까지만 제공한다.
import type { NetworkState } from "../types";
import type { SchoolLicense } from "./schoolSync";

export function isFirebaseCloudSchool(net: NetworkState, license: SchoolLicense | null): boolean {
  if (net !== "intranet") return true;
  try {
    const s = String(license?.singleNet || "").toUpperCase();
    if (s === "EXTERNAL") return true;
  } catch {
    /* 기본값 */
  }
  return false;
}

export function remoteBlockedReason(net: NetworkState, license: SchoolLicense | null): string | null {
  if (net !== "intranet") {
    return "외부연결(외부망 중계)에서는 원격 지원을 쓸 수 없어요. 교내연결에서 이용해 주세요.";
  }
  try {
    const s = String(license?.singleNet || "").toUpperCase();
    if (s === "EXTERNAL") {
      return "Firebase 클라우드(외부망 고정) 이용권 학교에서는 원격 지원을 쓸 수 없어요.";
    }
  } catch {
    /* 통과 */
  }
  return null;
}

// ---- 망 범위(스코프): 내부망 전용 채팅방·조직을 언제 보여줄지 ----
// - 외부망 고정(EXTERNAL) 학교: 교내망 항목을 아예 보여주지 않는다.
// - 하이브리드(단일망 미지정)·내부망 학교: 내부망일 때만 교내망 항목을 보여주고,
//   외부망으로 벗어나면 목록에서 사라진다(서버에 남아 있으므로 재접속 시 복원).
export function isExternalOnlySchool(license: SchoolLicense | null): boolean {
  try {
    return String(license?.singleNet || "").toUpperCase() === "EXTERNAL";
  } catch {
    return false;
  }
}

export function isIntranetOnlySchool(license: SchoolLicense | null): boolean {
  try {
    return String(license?.singleNet || "").toUpperCase() === "INTERNAL";
  } catch {
    return false;
  }
}

// 교내망에서 발견된 항목(PC·부서)인지 — 외부망일 때 숨길 대상 판정
export function isIntranetScoped(t: { position?: string; dept?: string }): boolean {
  return t.position === "교내망 PC" || t.dept === "교내망";
}

// 지금 교내망 항목(내부망 채팅방·조직)을 보여줄지
export function intranetVisible(net: NetworkState, license: SchoolLicense | null): boolean {
  return net === "intranet" && !isExternalOnlySchool(license);
}
