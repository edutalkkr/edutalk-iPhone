// 글꼴 선택지 (개인 설정 — 이 PC에만 저장). App과 설정 화면이 함께 쓴다.
export type FontKind = "system" | "malgun" | "gulim" | "dotum" | "batang";

export const FONT_OPTIONS: { id: FontKind; label: string; stack: string }[] = [
  { id: "system", label: "시스템 기본", stack: 'system-ui, sans-serif' },
  { id: "malgun", label: "맑은 고딕", stack: '"맑은 고딕", system-ui, sans-serif' },
  { id: "gulim", label: "굴림", stack: '굴림, system-ui, sans-serif' },
  { id: "dotum", label: "돋움", stack: '돋움, system-ui, sans-serif' },
  { id: "batang", label: "바탕", stack: '바탕, serif' },
];

/** 예전 저장값을 포함해 알 수 없는 글꼴 설정은 시스템 기본으로 되돌린다. */
export function normalizeFontKind(value: unknown): FontKind {
  const id = String(value || "").trim();
  return FONT_OPTIONS.some((f) => f.id === id) ? (id as FontKind) : "system";
}
