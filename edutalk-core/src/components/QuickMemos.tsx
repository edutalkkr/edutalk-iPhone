// 퀵 메모(포스트잇) 레이어 — 개별 포스트잇 창을 띄워 두는 화면
//  · 드래그 이동 · 6색 파스텔 · 접기/펼치기 · 맨 위 고정 · 내용 검색
//  · 파일(.txt) 저장 · 쪽지로 전달(초안) · 우클릭 메뉴(색/고정/삭제)
//  · 쪽지 상세의 "퀵 메모로 저장"과 같은 저장소(useQuick)를 공유한다.

import { useEffect, useMemo, useRef, useState } from "react";
import { NOTE_COLOR_COUNT, noteToMemoText, useQuick, type QuickNote } from "../lib/quickStore";
import { downloadBlob } from "../lib/fileStore";
import BzTooltip from "./ui/BzTooltip";
import { useContextMenu } from "./ui/BzContextMenu";
import { bzConfirm } from "./ui/BzDialog";
import { IconChevronDown, IconPin, IconPlus, IconSearch, IconStickyNote, IconTrash } from "./ui/BzIcons";
import { api } from "../services/api";

interface Props {
  onClose: () => void;
  /** 쪽지로 전달 — App이 쪽지 쓰기 초안으로 넘긴다 */
  onSendAsMemo: (text: string, sourceTitle?: string) => void;
  onToast: (t: string) => void;
}

const COLOR_NAMES = ["노랑", "분홍", "하늘", "민트", "라벤더", "살구"];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export default function QuickMemos({ onClose, onSendAsMemo, onToast }: Props) {
  const notes = useQuick((s) => s.notes);
  const add = useQuick((s) => s.add);
  const update = useQuick((s) => s.update);
  const remove = useQuick((s) => s.remove);
  const barOpen = useQuick((s) => s.barOpen);
  const setBarOpen = useQuick((s) => s.setBarOpen);
  const openMenu = useContextMenu();
  const [q, setQ] = useState("");
  const [zSeq, setZSeq] = useState<Record<string, number>>({});
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const seqRef = useRef(1);

  // 새 메모 본문 자동 포커스용
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    // 접힌 메모가 화면 밖으로 나가 있으면 안으로 끌어온다
    notes.forEach((n) => {
      const nx = clamp(n.x, 4, Math.max(4, window.innerWidth - 260));
      const ny = clamp(n.y, 4, Math.max(4, window.innerHeight - 60));
      if (nx !== n.x || ny !== n.y) update(n.id, { x: nx, y: ny });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return new Set(
      notes.filter((n) => n.body.toLowerCase().includes(s) || n.title.toLowerCase().includes(s)).map((n) => n.id)
    );
  }, [q, notes]);

  const bringToFront = (id: string) => {
    setZSeq((z) => ({ ...z, [id]: seqRef.current++ }));
  };

  const removeAnimated = (id: string) => {
    if (leaving.has(id)) return;
    setLeaving((s) => new Set(s).add(id));
    window.setTimeout(() => {
      remove(id);
      setLeaving((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 180);
    void api.logActivity("quick_note_delete", { id });
  };

  const focusNote = (n: QuickNote) => {
    bringToFront(n.id);
    if (n.collapsed) update(n.id, { collapsed: false });
  };

  const startDrag = (e: React.PointerEvent, n: QuickNote) => {
    if ((e.target as HTMLElement).closest("button, input, textarea")) return;
    bringToFront(n.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = n.x;
    const oy = n.y;
    const move = (ev: PointerEvent) => {
      update(n.id, {
        x: clamp(ox + (ev.clientX - sx), 2, Math.max(2, window.innerWidth - 254)),
        y: clamp(oy + (ev.clientY - sy), 2, Math.max(2, window.innerHeight - 46)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const saveTxt = (n: QuickNote) => {
    try {
      const text = `${n.title}\n${"=".repeat(Math.max(4, n.title.length))}\n\n${n.body}\n\n— 작성: ${n.createdAt.slice(0, 16).replace("T", " ")}`;
      downloadBlob(`${sanitize(n.title || "퀵메모")}.txt`, new Blob([text], { type: "text/plain;charset=utf-8" }));
      onToast("메모를 파일로 저장했어요.");
    } catch {
      onToast("파일 저장에 실패했어요.");
    }
  };

  const noteMenu = (n: QuickNote) => [
    { id: "add", label: "새 메모", icon: <IconPlus size={14} />, onSelect: () => addNote() },
    { id: "sep1", separator: true },
    ...Array.from({ length: NOTE_COLOR_COUNT }, (_, i) => ({
      id: `c${i}`,
      label: `색 · ${COLOR_NAMES[i]}`,
      icon: <span className="bz-color-dot" data-c={i} aria-hidden />,
      hint: n.color === i ? "현재" : undefined,
      onSelect: () => update(n.id, { color: i }),
    })),
    { id: "sep2", separator: true },
    {
      id: "pin",
      label: n.pinned ? "맨 위 고정 해제" : "맨 위 고정 (항상 위)",
      icon: <IconPin size={14} />,
      onSelect: () => update(n.id, { pinned: !n.pinned }),
    },
    {
      id: "fold",
      label: n.collapsed ? "펼치기" : "접기",
      onSelect: () => update(n.id, { collapsed: !n.collapsed }),
    },
    { id: "sep3", separator: true },
    {
      id: "memo",
      label: "쪽지로 전달",
      icon: <IconStickyNote size={14} />,
      onSelect: () => onSendAsMemo(noteToMemoText(n), n.title),
    },
    { id: "save", label: "파일로 저장 (.txt)", onSelect: () => saveTxt(n) },
    { id: "sep4", separator: true },
    {
      id: "del",
      label: "삭제",
      danger: true,
      icon: <IconTrash size={14} />,
      onSelect: async () => {
        const ok = await bzConfirm({ title: "메모를 지울까요?", message: "되돌릴 수 없어요.", confirmText: "삭제", danger: true });
        if (ok) removeAnimated(n.id);
      },
    },
  ];

  const addNote = () => {
    const id = add({});
    pendingFocus.current = id;
    setBarOpen(true);
    onToast("새 퀵 메모를 띄웠어요. 이 PC에 자동 저장돼요.");
    void api.logActivity("quick_note_add", { id });
  };

  return (
    <div className="bz-notes-layer" aria-label="퀵 메모 레이어">
      {/* 얇은 입력바 — X를 눌러도 포스트잇은 사라지지 않고, 작은 칩으로 다시 열 수 있다. */}
      {barOpen ? (
        <div className="bz-notes-bar">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-extrabold text-edu-ink">
            <IconStickyNote size={15} /> 퀵 메모
            <span className="text-edu-muted font-bold">{notes.length}</span>
          </span>
          <div className="bz-notes-search relative inline-flex items-center">
            <IconSearch size={13} className="absolute left-2.5 text-edu-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="메모 내용 검색"
              aria-label="메모 내용 검색"
              style={{ paddingLeft: 26 }}
            />
          </div>
          <BzTooltip content="모두 접기" position="bottom">
            <button className="bz-notes-fold edu-ghost !px-2 !py-1.5 !text-[12px]" onClick={() => notes.forEach((n) => update(n.id, { collapsed: true }))}>
              접기
            </button>
          </BzTooltip>
          <BzTooltip content="새 메모 (Ctrl+Alt+N)" position="bottom">
            <button className="edu-btn !h-8 !px-2.5 !text-[12px] inline-flex items-center gap-1" onClick={addNote}>
              <IconPlus size={13} /> 새 메모
            </button>
          </BzTooltip>
          <BzTooltip content="입력바만 접기 (메모는 남아 있어요)" position="bottom">
            <button className="edu-ghost !px-2 !py-1.5" onClick={onClose} aria-label="퀵 메모 입력바 접기">
              <IconChevronDown size={15} />
            </button>
          </BzTooltip>
        </div>
      ) : (
        <button className="bz-notes-chip" onClick={() => setBarOpen(true)} aria-label="퀵 메모 입력바 열기">
          <IconStickyNote size={14} />
          <span>퀵 메모</span>
          <b>{notes.length}</b>
          <IconChevronDown size={12} />
        </button>
      )}

      {/* 얇은 창 안의 메모 목록 — 누르면 해당 포스트잇을 맨 앞으로 가져온다. */}
      {barOpen && notes.length > 0 && (
        <div className="bz-notes-list" aria-label="퀵 메모 목록">
          {notes.map((n) => (
            <button key={n.id} className="bz-notes-list-item" onClick={() => focusNote(n)} title={n.body || n.title}>
              <span className="bz-color-dot" data-c={n.color % NOTE_COLOR_COUNT} aria-hidden />
              <span className="truncate">{n.title || "제목 없는 메모"}</span>
              {n.collapsed && <span className="bz-list-fold">접힘</span>}
            </button>
          ))}
        </div>
      )}

      {/* 포스트잇 */}
      {notes.map((n) => {
        const z = 1 + (zSeq[n.id] ?? 0) + (n.pinned ? 500 : 0);
        const dim = matches ? !matches.has(n.id) : false;
        return (
          <div
            key={n.id}
            className={`bz-note c${n.color % NOTE_COLOR_COUNT} ${n.collapsed ? "collapsed" : ""} ${n.pinned ? "pinned" : ""} ${dim ? "dimmed" : ""} ${leaving.has(n.id) ? "leaving" : ""}`}
            style={{ left: n.x, top: n.y, zIndex: z }}
            onPointerDown={() => bringToFront(n.id)}
            onContextMenu={(e) => openMenu(e, noteMenu(n), n.title)}
          >
            <div className="bz-note-head" onPointerDown={(e) => startDrag(e, n)} onDoubleClick={() => update(n.id, { collapsed: !n.collapsed })}>
              <input
                className="bz-note-title"
                style={{ background: "transparent", border: 0, outline: "none" }}
                value={n.title}
                onChange={(e) => update(n.id, { title: e.target.value })}
                aria-label="메모 제목"
              />
              {n.pinned && (
                <BzTooltip content="항상 위" position="bottom">
                  <span className="bz-note-btn" aria-label="고정됨"><IconPin size={12} /></span>
                </BzTooltip>
              )}
              <BzTooltip content={n.collapsed ? "펼치기" : "접기"} position="bottom">
                <button className="bz-note-btn" onClick={() => update(n.id, { collapsed: !n.collapsed })} aria-label="접기/펼치기">
                  {n.collapsed ? "▸" : "▾"}
                </button>
              </BzTooltip>
              <BzTooltip content="삭제" position="bottom">
                <button
                  className="bz-note-btn"
                  aria-label="메모 삭제"
                  onClick={async () => {
                    const ok = await bzConfirm({ title: "메모를 지울까요?", message: "되돌릴 수 없어요.", confirmText: "삭제", danger: true });
                    if (ok) removeAnimated(n.id);
                  }}
                >
                  ✕
                </button>
              </BzTooltip>
            </div>
            <textarea
              className="bz-note-body"
              value={n.body}
              placeholder="여기에 바로 적어 두세요. (자동 저장)"
              autoFocus={pendingFocus.current === n.id}
              onChange={(e) => update(n.id, { body: e.target.value })}
              spellCheck={false}
            />
            <div className="bz-note-foot">
              <span>{(n.updatedAt || "").slice(5, 16).replace("T", " ")} 저장</span>
              <span className="flex-1" />
              <button className="font-bold hover:underline" onClick={() => onSendAsMemo(noteToMemoText(n), n.title)}>
                쪽지로 전달
              </button>
            </div>
          </div>
        );
      })}

      {barOpen && notes.length === 0 && (
        <div className="bz-notes-empty">
          아직 메모가 없어요. <b>새 메모</b>를 눌러 바로 적어 보세요.
        </div>
      )}
    </div>
  );
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "퀵메모";
}
