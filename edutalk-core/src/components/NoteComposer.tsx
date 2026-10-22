// 쪽지 쓰기 시트 (5단계-2) — 웹 브리즈 디자인 이식 + 7초 Undo Send + 실제 백엔드 연동
// 서버: onprem POST /api/notes/send (clientNoteId 멱등). 7초 유예는 이 컴포넌트가 담당한다.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import api from "../services/api";
import type { SendNotePayload } from "../types/api";

export interface NoteTeacher {
  id: number;
  name: string;
  department?: string;
}

export interface NoteSentInfo {
  noteId: number;
  recipientCount: number;
}

export interface NoteComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teachers: NoteTeacher[];
  onSent?: (info: NoteSentInfo) => void;
  onToast?: (message: string, kind?: "info" | "success" | "error") => void;
  /** 쪽지함에서 [답장]을 눌렀을 때 수신자·제목을 미리 채운다. */
  initialRecipient?: NoteTeacher | null;
  initialTitle?: string;
  /** 같은 수신자에게 연속 답장할 때도 초기화가 다시 실행되도록 하는 키 */
  initialKey?: number;
}

type Mode = "ALL" | "AUDIENCE" | "USER";
type AudienceKind = "GRADE" | "DEPT";
type ListKind = "TO" | "CC" | "BCC";

const UNDO_SECONDS = 7;
const LIST_META: Record<ListKind, { label: string; short: string }> = {
  TO: { label: "받는 사람", short: "받음" },
  CC: { label: "참조", short: "참조" },
  BCC: { label: "숨은참조", short: "숨은" },
};

interface DraftSnapshot {
  mode: Mode;
  audienceKind: AudienceKind;
  audienceKey: string;
  picked: Record<ListKind, number[]>;
  title: string;
  content: string;
}

interface PendingSend {
  clientNoteId: string;
  payload: SendNotePayload;
  snapshot: DraftSnapshot;
  label: string;
}

interface UndoState {
  clientNoteId: string;
  remaining: number;
  label: string;
}

const EMPTY_PICKED: Record<ListKind, number[]> = { TO: [], CC: [], BCC: [] };

export default function NoteComposer({ open, onOpenChange, teachers, onSent, onToast, initialRecipient, initialTitle, initialKey }: NoteComposerProps) {
  const [mode, setMode] = useState<Mode>("ALL");
  const [audienceKind, setAudienceKind] = useState<AudienceKind>("GRADE");
  const [audienceKey, setAudienceKey] = useState("");
  const [picked, setPicked] = useState<Record<ListKind, number[]>>(EMPTY_PICKED);
  const [pickTarget, setPickTarget] = useState<ListKind>("TO");
  const [filter, setFilter] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingSend | null>(null);

  const toast = (message: string, kind: "info" | "success" | "error" = "info") => onToast?.(message, kind);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  /* 답장: 수신자 1명을 미리 선택하고 제목을 Re: 로 채운다. 본문은 비워 둔다. */
  useEffect(() => {
    if (!open || !initialRecipient) return;
    setMode("USER");
    setAudienceKind("GRADE");
    setAudienceKey("");
    setPicked({ TO: [initialRecipient.id], CC: [], BCC: [] });
    setPickTarget("TO");
    setFilter("");
    setTitle(initialTitle || "");
    setContent("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !undo) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, undo, onOpenChange]);

  const grades = ["1학년", "2학년", "3학년"];
  // 답장 대상(학생 등)이 교사 목록에 없어도 선택된 수신자로 보이도록 합친다.
  const roster = initialRecipient && !teachers.some((t) => t.id === initialRecipient.id)
    ? [...teachers, initialRecipient]
    : teachers;
  const departments = Array.from(new Set(roster.map((t) => t.department).filter((d): d is string => Boolean(d))));
  const audienceOptions = audienceKind === "GRADE" ? grades : departments;

  const filtered = roster.filter((t) => {
    const q = filter.trim();
    if (!q) return true;
    return t.name.includes(q) || (t.department || "").includes(q);
  });

  const listOf = (id: number): ListKind | null => {
    for (const k of ["TO", "CC", "BCC"] as ListKind[]) {
      if (picked[k].includes(id)) return k;
    }
    return null;
  };

  const toggleTeacher = (id: number) => {
    setPicked((prev) => {
      const current = prev[pickTarget];
      if (current.includes(id)) {
        return { ...prev, [pickTarget]: current.filter((x) => x !== id) };
      }
      const next: Record<ListKind, number[]> = {
        TO: prev.TO.filter((x) => x !== id),
        CC: prev.CC.filter((x) => x !== id),
        BCC: prev.BCC.filter((x) => x !== id),
      };
      next[pickTarget] = [...next[pickTarget], id];
      return next;
    });
  };

  const captureDraft = (): DraftSnapshot => ({ mode, audienceKind, audienceKey, picked, title, content });

  const restoreDraft = (s: DraftSnapshot) => {
    setMode(s.mode);
    setAudienceKind(s.audienceKind);
    setAudienceKey(s.audienceKey);
    setPicked(s.picked);
    setTitle(s.title);
    setContent(s.content);
  };

  const resetDraft = () => {
    setMode("ALL");
    setAudienceKind("GRADE");
    setAudienceKey("");
    setPicked(EMPTY_PICKED);
    setPickTarget("TO");
    setFilter("");
    setTitle("");
    setContent("");
  };

  const buildPayload = (): { payload: SendNotePayload; label: string } | { error: string } => {
    const titleT = title.trim();
    const contentT = content.trim();
    if (!titleT) return { error: "쪽지 제목을 입력해 주세요." };
    if (!contentT) return { error: "쪽지 내용을 입력해 주세요." };

    if (mode === "ALL") {
      return { payload: { title: titleT, content: contentT, audience: "ALL" }, label: "전교 교사 전체" };
    }
    if (mode === "AUDIENCE") {
      const key = audienceKey.trim();
      if (!key) return { error: audienceKind === "GRADE" ? "학년을 선택해 주세요." : "부서를 선택해 주세요." };
      return { payload: { title: titleT, content: contentT, audience: audienceKind, targetKey: key }, label: key };
    }
    if (picked.TO.length === 0) return { error: "받는 사람을 한 명 이상 선택해 주세요." };
    return {
      payload: {
        title: titleT,
        content: contentT,
        recipientIds: picked.TO,
        ccIds: picked.CC,
        bccIds: picked.BCC,
      },
      label: "개별 선택",
    };
  };

  const ready =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    (mode !== "USER" || picked.TO.length > 0) &&
    (mode !== "AUDIENCE" || audienceKey.trim().length > 0);

  const startCountdown = (clientNoteId: string) => {
    clearTimer();
    let remaining = UNDO_SECONDS;
    timerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearTimer();
        void confirmSend(clientNoteId);
      } else {
        setUndo((prev) => (prev && prev.clientNoteId === clientNoteId ? { ...prev, remaining } : prev));
      }
    }, 1000);
  };

  const handleSendClick = () => {
    if (undo) return;
    const built = buildPayload();
    if ("error" in built) {
      toast(built.error, "error");
      return;
    }

    const clientNoteId = `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload: SendNotePayload = { ...built.payload, clientNoteId };

    pendingRef.current = { clientNoteId, payload, snapshot: captureDraft(), label: built.label };
    setUndo({ clientNoteId, remaining: UNDO_SECONDS, label: built.label });
    onOpenChange(false);
    startCountdown(clientNoteId);
  };

  const confirmSend = async (clientNoteId: string) => {
    const pending = pendingRef.current;
    if (!pending || pending.clientNoteId !== clientNoteId) return;

    setFinalizing(true);
    const res = await api.sendNote(pending.payload);
    setFinalizing(false);
    pendingRef.current = null;
    setUndo(null);

    if (res.ok && res.data) {
      resetDraft();
      toast(`쪽지를 보냈어요 · ${pending.label} ${res.data.recipientCount}명`, "success");
      onSent?.({ noteId: res.data.noteId, recipientCount: res.data.recipientCount });
    } else {
      restoreDraft(pending.snapshot);
      onOpenChange(true);
      toast(`${res.error || "쪽지를 보내지 못했어요."} 작성 내용은 그대로 두었어요.`, "error");
    }
  };

  const handleCancelSend = () => {
    clearTimer();
    const pending = pendingRef.current;
    if (pending) {
      restoreDraft(pending.snapshot);
      pendingRef.current = null;
    }
    setUndo(null);
    onOpenChange(true);
    toast("전송을 취소했어요. 작성 내용을 그대로 두었어요.", "info");
  };

  const handleClose = () => onOpenChange(false);

  const undoProgress = undo ? ((UNDO_SECONDS - undo.remaining + 1) / UNDO_SECONDS) * 100 : 0;

  return (
    <>
      <div className={`bz-sheet-wrap ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="bz-sheet-scrim" onClick={handleClose} />
        <div className="bz-sheet" role="dialog" aria-label="쪽지 쓰기">
          <div className="bz-head">
            <div className="bz-grow">
              <div className="bz-title">쪽지 쓰기</div>
              <div className="bz-desc">Enter는 줄바꿈 · 보내기 후 7초 안에 취소할 수 있어요</div>
            </div>
            <button type="button" className="bz-close" onClick={handleClose} aria-label="닫기">✕</button>
          </div>

          <div className="bz-scroll flex-1 overflow-y-auto px-[18px] py-4 space-y-5">
            <div>
              <label className="mb-2 block text-[12.5px] font-semibold text-[var(--bz-sub)]">수신자</label>
              <div className="bz-seg mb-3">
                <button type="button" className={`bz-seg-btn ${mode === "ALL" ? "active" : ""}`} onClick={() => setMode("ALL")}>
                  전교 교사 전체
                </button>
                <button type="button" className={`bz-seg-btn ${mode === "AUDIENCE" ? "active" : ""}`} onClick={() => setMode("AUDIENCE")}>
                  학년 / 부서
                </button>
                <button type="button" className={`bz-seg-btn ${mode === "USER" ? "active" : ""}`} onClick={() => setMode("USER")}>
                  개별 교사
                </button>
              </div>

              {mode === "ALL" && (
                <div className="rounded-[14px] border border-[var(--brand-line)] bg-[var(--brand-soft)] px-3.5 py-3 text-[12.5px] font-semibold text-[var(--brand-strong)]">
                  전교 교사 전체에게 보내요
                </div>
              )}

              {mode === "AUDIENCE" && (
                <div className="space-y-2.5">
                  <div className="bz-seg">
                    <button type="button" className={`bz-seg-btn ${audienceKind === "GRADE" ? "active" : ""}`} onClick={() => { setAudienceKind("GRADE"); setAudienceKey(""); }}>
                      학년
                    </button>
                    <button type="button" className={`bz-seg-btn ${audienceKind === "DEPT" ? "active" : ""}`} onClick={() => { setAudienceKind("DEPT"); setAudienceKey(""); }}>
                      부서
                    </button>
                  </div>
                  <select className="bz-select" value={audienceKey} onChange={(e) => setAudienceKey(e.target.value)}>
                    <option value="">-- 선택 --</option>
                    {audienceOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              )}

              {mode === "USER" && (
                <div className="space-y-2.5">
                  <div className="bz-seg">
                    {(["TO", "CC", "BCC"] as ListKind[]).map((k) => (
                      <button key={k} type="button" className={`bz-seg-btn ${pickTarget === k ? "active" : ""}`} onClick={() => setPickTarget(k)}>
                        {LIST_META[k].label} {picked[k].length > 0 ? `(${picked[k].length})` : ""}
                      </button>
                    ))}
                  </div>
                  <input
                    className="bz-input"
                    placeholder="이름 또는 부서 검색"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {(["TO", "CC", "BCC"] as ListKind[]).map((k) => (
                      <span key={k} className={`bz-chip ${picked[k].length ? "on" : ""}`}>
                        {LIST_META[k].label} {picked[k].length}
                      </span>
                    ))}
                  </div>
                  <div className="bz-scroll max-h-[210px] overflow-y-auto rounded-[14px] border border-[var(--bz-line)] p-1.5">
                    {filtered.length === 0 && (
                      <div className="px-3 py-6 text-center text-[12.5px] text-[var(--bz-muted)]">
                        {teachers.length === 0 ? "서버에서 교사 목록을 불러오면 여기에 표시돼요" : "검색 결과가 없어요"}
                      </div>
                    )}
                    {filtered.map((t) => {
                      const inList = listOf(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`bz-row ${inList ? "sel" : ""}`}
                          onClick={() => toggleTeacher(t.id)}
                        >
                          <span className="bz-avatar">{t.name.slice(0, 1)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-semibold text-[var(--bz-text)]">{t.name}</span>
                            {t.department && (
                              <span className="block truncate text-[11.5px] text-[var(--bz-muted)]">{t.department}</span>
                            )}
                          </span>
                          {inList && (
                            <span className="bz-badge">{LIST_META[inList].short}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="bz-field">
              <label>제목</label>
              <input
                className="bz-input"
                placeholder="제목을 입력해 주세요"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="bz-field">
              <label>본문</label>
              <textarea
                className="bz-textarea min-h-[180px]"
                placeholder={"메시지를 입력해 주세요\n(Enter는 줄바꿈, 보내기 버튼으로 발송)"}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--bz-line)] px-[18px] py-3">
            <button type="button" className="bz-btn-ghost" onClick={handleClose}>닫기</button>
            <button type="button" className="bz-btn" onClick={handleSendClick} disabled={!ready || Boolean(undo)}>
              {undo ? "전송 중…" : "보내기"}
            </button>
          </div>
        </div>
      </div>

      {undo && (
        <div className="bz-undo" role="status">
          <div
            className="bz-undo-ring"
            style={{ "--bz-progress": finalizing ? 100 : undoProgress } as CSSProperties}
          >
            <i>{finalizing ? "✓" : undo.remaining}</i>
          </div>
          <div className="bz-undo-text">
            <strong>{finalizing ? "보내는 중…" : "7초 안에 취소할 수 있어요"}</strong>
            <span>{undo.label}에게 쪽지를 보내요</span>
          </div>
          {!finalizing && (
            <button type="button" className="bz-btn-ghost" onClick={handleCancelSend}>
              전송 취소
            </button>
          )}
        </div>
      )}
    </>
  );
}
