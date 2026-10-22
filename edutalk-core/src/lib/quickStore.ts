// 퀵 메모(포스트잇) 저장소 — zustand persist
//  · 개별 창(레이어)에서 자유롭게 띄워 두는 포스트잇 메타데이터를 보관한다.
//  · 본문은 여기에 저장(작은 텍스트), 파일 전달은 본문을 쪽지 초안으로 넘긴다.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const NOTE_COLOR_COUNT = 6;

export interface QuickNote {
  id: string;
  title: string;
  body: string;
  /** 0..5 파스텔 톤 */
  color: number;
  x: number;
  y: number;
  collapsed: boolean;
  /** 맨 위 고정(항상 위) */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

function newId(): string {
  return `qn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

interface QuickState {
  notes: QuickNote[];
  /** 레이어(포스트잇 판) 열림 여부 — 얇은 입력바를 닫아도 메모가 남아 있도록 별도로 둔다. */
  layerOpen: boolean;
  /** 얇은 입력바(추가 창)만 열려 있는지. X를 눌러도 이 값만 false가 된다. */
  barOpen: boolean;
  add: (init?: Partial<QuickNote>) => string;
  update: (id: string, patch: Partial<QuickNote>) => void;
  remove: (id: string) => void;
  setLayerOpen: (v: boolean) => void;
  setBarOpen: (v: boolean) => void;
}

export const useQuick = create<QuickState>()(
  persist(
    (set) => ({
      notes: [],
      layerOpen: false,
      barOpen: true,
      add: (init) => {
        const id = newId();
        const now = new Date().toISOString();
        // 새 메모는 화면 오른쪽 위에서 살짝씩 어긋나게 놓는다
        set((s) => ({
          notes: [
            ...s.notes,
            {
              id,
              title: init?.title ?? "퀵 메모",
              body: init?.body ?? "",
              color: init?.color ?? s.notes.length % NOTE_COLOR_COUNT,
              x: init?.x ?? Math.max(24, window.innerWidth - 560 + (s.notes.length % 5) * 26),
              y: init?.y ?? 148 + (s.notes.length % 6) * 30,
              collapsed: init?.collapsed ?? false,
              pinned: init?.pinned ?? false,
              createdAt: now,
              updatedAt: now,
            },
          ],
          layerOpen: true,
          barOpen: true,
        }));
        return id;
      },
      update: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)),
        })),
      remove: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      setLayerOpen: (v) => set(v ? { layerOpen: true, barOpen: true } : { layerOpen: false }),
      setBarOpen: (v) => set({ barOpen: v }),
    }),
    { name: "breeze-quick-notes" }
  )
);

/** 쪽지 초안으로 넘길 문구 만들기 */
export function noteToMemoText(n: QuickNote): string {
  const head = n.title && n.title !== "퀵 메모" ? `[퀵 메모] ${n.title}\n\n` : "[퀵 메모]\n\n";
  return head + n.body;
}
