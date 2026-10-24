// 쪽지함 (5단계-2) — 받은/보낸 쪽지 + 읽음 처리 + 실시간 갱신
// 서버: GET /api/notes/inbox · GET /api/notes/sent · PATCH /api/notes/:id/read

import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import { startNotesRealtime } from "../services/notes";
import type { NoteInboxItem, NotesInboxData, NotesSentData, NoteSentItem, NoteRecipientType } from "../types/api";

export interface NoteVaultProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToast?: (message: string, kind?: "info" | "success" | "error") => void;
  onUnreadChange?: (unread: number) => void;
  /** 받은 쪽지 상세에서 답장을 누르면 발신자에게 바로 답장할 수 있게 한다. */
  onReply?: (sender: { id: number; name: string; department?: string | null }, note: NoteInboxItem) => void;
}

type Tab = "inbox" | "sent";
type Selected = { kind: Tab; id: number } | null;

const TYPE_LABEL: Record<NoteRecipientType, string> = {
  ALL: "전교",
  DEPT: "부서",
  GRADE: "학년",
  USER: "받음",
  CC: "참조",
  BCC: "숨은",
};

function fmtTime(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).slice(5, 16);
}

export default function NoteVault({ open, onOpenChange, onToast, onUnreadChange, onReply }: NoteVaultProps) {
  const [tab, setTab] = useState<Tab>("inbox");
  const [inbox, setInbox] = useState<NotesInboxData | null>(null);
  const [sent, setSent] = useState<NotesSentData | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [loading, setLoading] = useState(false);
  const [onlyStudents, setOnlyStudents] = useState(false);

  const toast = (message: string, kind: "info" | "success" | "error" = "info") => onToast?.(message, kind);

  const loadInbox = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await api.getNotesInbox(1, false, 50);
    if (!silent) setLoading(false);
    if (res.ok && res.data) {
      setInbox(res.data);
      onUnreadChange?.(Number(res.data.unread) || 0);
    } else if (!silent) {
      toast(res.error || "받은 쪽지를 불러오지 못했어요.", "error");
    }
  }, [onUnreadChange]);

  const loadSent = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await api.getNotesSent(1, 50);
    if (!silent) setLoading(false);
    if (res.ok && res.data) {
      setSent(res.data);
    } else if (!silent) {
      toast(res.error || "보낸 쪽지를 불러오지 못했어요.", "error");
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      return;
    }
    if (tab === "inbox") void loadInbox();
    else void loadSent();
  }, [open, tab, loadInbox, loadSent]);

  useEffect(() => {
    if (!open) return;
    const off = startNotesRealtime({
      onMemoArrived: () => {
        if (tab === "inbox") void loadInbox(true);
      },
      onPeerRead: (p) => {
        setSent((prev) => {
          if (!prev) return prev;
          const notes = prev.notes.map((n) => {
            if (String(n.id) !== String(p.ref_id)) return n;
            let already = false;
            const recipients = (n.recipients || []).map((r) => {
              if (String(r.id) !== String(p.from)) return r;
              already = Boolean(r.is_read);
              return { ...r, is_read: 1, read_at: r.read_at || "방금" };
            });
            return { ...n, recipients, read_count: already ? n.read_count : n.read_count + 1 };
          });
          return { ...prev, notes };
        });
      },
    });
    return off;
  }, [open, tab, loadInbox]);

  const readNote = async (item: NoteInboxItem) => {
    setSelected({ kind: "inbox", id: item.id });
    if (item.is_read) return;

    setInbox((prev) => {
      if (!prev) return prev;
      const notes = prev.notes.map((n) => (n.id === item.id ? { ...n, is_read: 1, read_at: n.read_at } : n));
      const unread = Math.max(0, prev.unread - 1);
      onUnreadChange?.(unread);
      return { ...prev, notes, unread };
    });

    const res = await api.markNoteRead(item.id);
    if (res.ok && res.data) {
      setInbox((prev) => {
        if (!prev) return prev;
        const notes = prev.notes.map((n) => (n.id === item.id ? { ...n, read_at: res.data!.readAt } : n));
        return { ...prev, notes };
      });
    }
  };

  const selectedInbox: NoteInboxItem | null =
    selected?.kind === "inbox" ? inbox?.notes.find((n) => n.id === selected.id) || null : null;
  const selectedSent: NoteSentItem | null =
    selected?.kind === "sent" ? sent?.notes.find((n) => n.id === selected.id) || null : null;

  const inboxNotes = inbox?.notes || [];
  const studentUnread = inboxNotes.filter((n) => n.sender_role === "STUDENT" && !n.is_read).length;
  const rows: Array<NoteInboxItem | NoteSentItem> = selected
    ? []
    : tab === "inbox"
      ? (onlyStudents ? inboxNotes.filter((n) => n.sender_role === "STUDENT") : inboxNotes)
      : (sent?.notes || []);

  const unreadTotal = inbox?.unread || 0;

  return (
    <div className={`bz-overlay ${open ? "show" : ""}`} aria-hidden={!open} onClick={() => onOpenChange(false)}>
      <div
        className="bz-modal bz-scroll flex max-h-[min(720px,calc(100dvh-40px))] flex-col !p-0"
        role="dialog"
        aria-label="쪽지함"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bz-head">
          {selected ? (
            <button type="button" className="bz-btn-soft" onClick={() => setSelected(null)}>← 목록</button>
          ) : (
            <div className="bz-seg w-[220px]">
              <button type="button" className={`bz-seg-btn ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")}>
                받은 쪽지 {unreadTotal > 0 ? `· ${unreadTotal}` : ""}
              </button>
              <button type="button" className={`bz-seg-btn ${tab === "sent" ? "active" : ""}`} onClick={() => setTab("sent")}>
                보낸 쪽지
              </button>
            </div>
          )}
          <div className="bz-grow" />
          {!selected && tab === "inbox" && (
            <button
              type="button"
              className="bz-btn-soft"
              onClick={() => setOnlyStudents((v) => !v)}
              aria-pressed={onlyStudents}
              title="학생이 보낸 문의 쪽지만 모아 봅니다"
              style={onlyStudents ? { background: "#E8F4FD", color: "#0069A8", borderColor: "#BFE3F5" } : undefined}
            >
              🎓 학생 문의{studentUnread > 0 ? ` · ${studentUnread}` : ""}
            </button>
          )}
          <button
            type="button"
            className="bz-btn-soft"
            onClick={() => { tab === "inbox" ? void loadInbox() : void loadSent(); }}
            disabled={loading}
          >
            새로고침
          </button>
          <button type="button" className="bz-close" onClick={() => onOpenChange(false)} aria-label="닫기">✕</button>
        </div>

        <div className="bz-scroll flex-1 overflow-y-auto px-3 py-3">
          {loading && !selected && (
            <div className="px-1 py-1" aria-label="쪽지를 불러오는 중">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-2.5 px-2 py-2.5">
                  <span className="skeleton h-9 w-9 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1">
                    <span className="skeleton block h-3 w-2/5" />
                    <span className="skeleton mt-1.5 block h-2.5 w-4/5" />
                  </span>
                  <span className="skeleton h-2.5 w-10 shrink-0" />
                </div>
              ))}
            </div>
          )}

          {!loading && !selected && rows.length === 0 && (
            <div className="bz-empty">
              <strong>{tab === "inbox" ? (onlyStudents ? "학생 문의가 없어요" : "받은 쪽지가 없어요") : "보낸 쪽지가 없어요"}</strong>
              <span>{tab === "inbox" ? (onlyStudents ? "학생이 보낸 쪽지는 이곳에 모여요" : "새 쪽지가 도착하면 여기에서 확인할 수 있어요") : "쪽지를 보내면 여기에 기록돼요"}</span>
            </div>
          )}

          {!selected && tab === "inbox" &&
            (rows as NoteInboxItem[]).map((n) => (
              <button key={n.id} type="button" className={`bz-row ${n.is_read ? "" : "sel"}`} onClick={() => void readNote(n)}>
                <span className="bz-avatar">{n.sender_name.slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {!n.is_read && <span className="bz-dot" />}
                    <span className={`truncate text-[13.5px] ${n.is_read ? "font-semibold" : "font-bold"} text-[var(--bz-text)]`}>
                      {n.title}
                    </span>
                    {n.sender_role === "STUDENT" && (
                      <span className="shrink-0 rounded-full bg-[#E8F4FD] px-1.5 py-0.5 text-[10px] font-bold text-[#0069A8]">학생</span>
                    )}
                  </span>
                  <span className="block truncate text-[11.5px] text-[var(--bz-muted)]">
                    {n.sender_name}{n.sender_department ? ` · ${n.sender_department}` : ""} · {n.content.replace(/\n/g, " ")}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-[var(--bz-muted)]">{fmtTime(n.created_at)}</span>
              </button>
            ))}

          {!selected && tab === "sent" &&
            (rows as NoteSentItem[]).map((n) => (
              <button key={n.id} type="button" className="bz-row" onClick={() => setSelected({ kind: "sent", id: n.id })}>
                <span className="bz-avatar">📤</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-[var(--bz-text)]">{n.title}</span>
                  <span className="block truncate text-[11.5px] text-[var(--bz-muted)]">
                    {n.recipient_count}명 중 {n.read_count}명 읽음 · {n.content.replace(/\n/g, " ")}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-[var(--bz-muted)]">{fmtTime(n.created_at)}</span>
              </button>
            ))}

          {selectedInbox && (
            <div className="px-2 py-1">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="bz-avatar">{selectedInbox.sender_name.slice(0, 1)}</span>
                <span>
                  <span className="flex items-center gap-1.5">
                    <span className="block text-[13.5px] font-bold text-[var(--bz-text)]">{selectedInbox.sender_name}</span>
                    {selectedInbox.sender_role === "STUDENT" && (
                      <span className="rounded-full bg-[#E8F4FD] px-1.5 py-0.5 text-[10px] font-bold text-[#0069A8]">학생</span>
                    )}
                  </span>
                  <span className="block text-[11.5px] text-[var(--bz-muted)]">
                    {selectedInbox.sender_department || "부서 없음"} · {selectedInbox.created_at}
                  </span>
                </span>
                {onReply && (
                  <button
                    type="button"
                    className="bz-btn-soft ml-auto"
                    onClick={() => onReply(
                      { id: selectedInbox.sender_id, name: selectedInbox.sender_name, department: selectedInbox.sender_department },
                      selectedInbox
                    )}
                  >
                    ↩ 답장
                  </button>
                )}
              </div>
              <h3 className="mb-3 text-[16px] font-bold text-[var(--bz-text)]">{selectedInbox.title}</h3>
              <pre className="bz-scroll whitespace-pre-wrap break-words rounded-[14px] border border-[var(--bz-line)] bg-[var(--bz-bg)] px-4 py-3.5 text-[13.5px] leading-relaxed text-[var(--bz-text)]">
                {selectedInbox.content}
              </pre>
            </div>
          )}

          {selectedSent && (
            <div className="px-2 py-1">
              <div className="mb-2 text-[11.5px] text-[var(--bz-muted)]">
                {selectedSent.created_at} · {TYPE_LABEL[selectedSent.audience] || selectedSent.audience}
                {selectedSent.target_key ? ` ${selectedSent.target_key}` : ""} · {selectedSent.recipient_count}명 중 {selectedSent.read_count}명 읽음
              </div>
              <h3 className="mb-3 text-[16px] font-bold text-[var(--bz-text)]">{selectedSent.title}</h3>
              <pre className="bz-scroll mb-4 whitespace-pre-wrap break-words rounded-[14px] border border-[var(--bz-line)] bg-[var(--bz-bg)] px-4 py-3.5 text-[13.5px] leading-relaxed text-[var(--bz-text)]">
                {selectedSent.content}
              </pre>
              <div className="mb-1.5 text-[12.5px] font-bold text-[var(--bz-sub)]">수신 확인</div>
              <table className="bz-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>부서</th>
                    <th>구분</th>
                    <th>읽음</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedSent.recipients || []).map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td>{r.department || "-"}</td>
                      <td>{TYPE_LABEL[r.type] || r.type}</td>
                      <td>
                        {r.is_read ? (
                          <span className="font-semibold text-[var(--bz-green)]">{r.read_at || "읽음"}</span>
                        ) : (
                          <span className="text-[var(--bz-muted)]">안 읽음</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
