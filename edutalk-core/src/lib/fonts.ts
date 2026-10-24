// 글꼴 선택지 (개인 설정 — 이 PC에만 저장). App과 설정 화면이 함께 쓴다.
export type FontKind = "pretendard" | "system" | "malgun" | "gulim" | "dotum" | "batang";

export const FONT_OPTIONS: { id: FontKind; label: string; stack: string }[] = [
  { id: "pretendard", label: "프리텐다드", stack: '"Pretendard Variable", Pretendard, system-ui, sans-serif' },
  { id: "malgun", label: "맑은 고딕", stack: '"맑은 고딕", system-ui, sans-serif' },
  { id: "gulim", label: "굴림", stack: '굴림, system-ui, sans-serif' },
  { id: "dotum", label: "돋움", stack: '돋움, system-ui, sans-serif' },
  { id: "batang", label: "바탕", stack: '바탕, serif' },
];

/** 저장값이 없거나 예전 시스템 기본이면 프리텐다드로 시작한다. */
export function normalizeFontKind(value: unknown): FontKind {
  const id = String(value || "").trim();
  if (id === "system") return "pretendard";
  return FONT_OPTIONS.some((f) => f.id === id) ? (id as FontKind) : "pretendard";
}
