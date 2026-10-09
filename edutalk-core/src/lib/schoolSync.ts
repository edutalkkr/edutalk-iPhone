// 웹(브리즈)과 엮이는 부분 — 학교 이용권 상태 동기화.
// schools 문서는 가입 검색용으로 공개 읽기라서, 키 없이(공개 식별자만으로) 상태를 가져올 수 있다.
// 이용권 코드 원문은 절대 내려오지 않는다 (상태·만료·종류만).
import type { LicenseKind } from "../types";

const PROJECT = "school-chat-9e69f";
// 공개 식별자 (웹 firebase.js와 같은 값 — 비밀 키가 아님)
const API_KEY = "AIzaSyANLtEoKpVlu8iwt2gTFtBHiMMVsiE2Tbs";

export interface SchoolLicense {
  status: string;
  expiresText: string;
  expiresMs: number;
  type: string;
  typeLabel: string;
  network: string;
  singleNet: string;
  chatOnly: boolean;
  kind: LicenseKind;
  fetchedAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  single_1y: "단일망 이용권 1년",
  dual_unified_1y: "듀얼망 이용권 1년",
  single_chat_1y: "단일망 소통 전용 1년",
  dual_chat_1y: "듀얼망 소통 전용 1년",
  paid_1y: "1년 이용권 (구)",
  dual_1y: "듀얼 1년 (구)",
  admin_grant: "관리자 직접 부여",
};

function str(v: any): string {
  return typeof v?.stringValue === "string" ? v.stringValue : "";
}
function bool(v: any): boolean {
  return v?.booleanValue === true;
}
function tsMs(v: any): number {
  const t = typeof v?.timestampValue === "string" ? v.timestampValue : "";
  if (!t) return 0;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export async function fetchSchoolLicense(schoolId: string): Promise<SchoolLicense> {
  const sid = schoolId.trim();
  if (!sid) throw new Error("학교 ID가 비어 있어요.");
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/schools/${encodeURIComponent(sid)}?key=${API_KEY}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (r.status === 404) throw new Error("등록되지 않은 학교 ID예요.");
    if (!r.ok) throw new Error(`조회 실패 (HTTP ${r.status})`);
    const j = await r.json();
    const f = (j.fields || {}) as Record<string, unknown>;
    const status = str(f.licenseStatus) || "없음";
    const type = str(f.licenseType);
    const chatOnly = bool(f.licenseChatOnly);
    const expMs = tsMs(f.licenseExpiresAt);
    const expText = expMs ? new Date(expMs).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "-";
    const active = status === "active" && (!expMs || expMs > Date.now());
    return {
      status: active ? "active" : status,
      expiresText: expText,
      expiresMs: expMs,
      type,
      typeLabel: TYPE_LABELS[type] ?? (type || "-"),
      network: str(f.licenseNetwork),
      singleNet: str(f.licenseSingleNet),
      chatOnly,
      kind: chatOnly ? "chatOnly" : "full",
      fetchedAt: new Date().toLocaleString("ko-KR"),
    };
  } finally {
    clearTimeout(timer);
  }
}
