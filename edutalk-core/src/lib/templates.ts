// 교내 서식/공문 템플릿 저장소 (Breeze Templates)
//  · 자주 쓰는 쪽지·공문 문구를 서식으로 저장해 두고 쪽지/대화 작성 시 클릭 한 번으로 불러온다.
//  · localStorage(zustand persist)에 보관 — 서버 없이도 동작하고, 서버 연동 시 부서 공유(scope)로 확장 가능.
//  · 처음 실행하면 학교에서 자주 쓰는 기본 서식 4종이 들어 있다 (지우고 내 서식만 써도 됨).

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MemoTemplate {
  id: string;
  /** 서식 이름 (예: 가정통신문 안내) */
  title: string;
  /** 본문 — 쪽지 본문에 그대로 삽입된다 */
  body: string;
  /** private: 내 PC에만 저장 · dept: (서버 연동 시) 부서 공유 — 지금은 private만 사용 */
  scope: "private" | "dept";
  /** 기본 제공 서식인지 (표시용) */
  builtin?: boolean;
  createdAt: string;
  updatedAt: string;
}

function newId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 처음 실행 시 기본 제공 서식 — 학교에서 반복되는 문구를 바로 쓸 수 있게 */
function seedTemplates(): MemoTemplate[] {
  const now = new Date().toISOString();
  const mk = (title: string, body: string): MemoTemplate => ({
    id: newId(), title, body, scope: "private", builtin: true, createdAt: now, updatedAt: now,
  });
  return [
    mk(
      "가정통신문 안내",
      "[가정통신문] 제목\n\n학부모님께 안내드려요.\n• 일시: \n• 장소: \n• 대상: \n• 준비물: \n\n가정에서도 확인해 주시면 감사할게요."
    ),
    mk(
      "협조 요청",
      "[협조 요청] 제목\n\n선생님께 협조를 부탁드려요.\n• 내용: \n• 기한: \n• 방법: \n\n바쁘신 중에 감사해요."
    ),
    mk(
      "제출 기한 안내",
      "[제출 안내] 제목\n\n아래 서류를 기한 내 제출해 주세요.\n• 제출 서류: \n• 제출 기한: \n• 제출 방법: \n\n기한 이후에는 접수가 어려우니 미리 확인 부탁드려요."
    ),
    mk(
      "회의 참석 요청",
      "[회의 안내] 제목\n\n회의를 아래와 같이 진행합니다.\n• 일시: \n• 장소: \n• 참석 대상: \n• 안건: \n\n참석 여부를 회신해 주세요."
    ),
  ];
}

interface TemplateState {
  templates: MemoTemplate[];
  /** 새 서식 추가 → id 반환 */
  add: (title: string, body: string, scope?: MemoTemplate["scope"]) => string;
  update: (id: string, patch: Partial<Pick<MemoTemplate, "title" | "body" | "scope">>) => void;
  remove: (id: string) => void;
}

export const useTemplates = create<TemplateState>()(
  persist(
    (set) => ({
      templates: seedTemplates(),
      add: (title, body, scope = "private") => {
        const id = newId();
        const now = new Date().toISOString();
        set((s) => ({
          templates: [
            { id, title: title.trim() || "내 서식", body, scope, createdAt: now, updatedAt: now },
            ...s.templates,
          ].slice(0, 100),
        }));
        return id;
      },
      update: (id, patch) =>
        set((s) => ({
          templates: s.templates.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t)),
        })),
      remove: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),
    }),
    { name: "breeze-templates" }
  )
);

/** 본문에서 서식 이름을 유추한다 (제목이 비었을 때) */
export function suggestTemplateTitle(title: string, body: string): string {
  const t = title.trim();
  if (t) return t.slice(0, 40);
  const line = body.trim().split("\n")[0]?.trim() ?? "";
  if (line) return line.replace(/^\[|\]$/g, "").slice(0, 40) || "내 서식";
  return "내 서식";
}
