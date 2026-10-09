// 글꼴 선택지 (개인 설정 — 이 PC에만 저장). App과 설정 화면이 함께 쓴다.
export type FontKind = "pretendard" | "malgun" | "gulim" | "dotum" | "batang" | "system";

export const FONT_OPTIONS: { id: FontKind; label: string; stack: string }[] = [
  { id: "pretendard", label: "프리텐다드 (기본)", stack: 'Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: "malgun", label: "맑은 고딕", stack: '"맑은 고딕", "Malgun Gothic", Pretendard, sans-serif' },
  { id: "gulim", label: "굴림", stack: '굴림, Gulim, "맑은 고딕", sans-serif' },
  { id: "dotum", label: "돋움", stack: '돋움, Dotum, "맑은 고딕", sans-serif' },
  { id: "batang", label: "바탕", stack: '바탕, Batang, serif' },
  { id: "system", label: "시스템 기본", stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
];
