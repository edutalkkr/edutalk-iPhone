// 학생 문의함 — 학생 웹에서 온 쪽지를 교사 앱에서 바로 확인·답장한다.
// 서버: GET /api/notes/inbox · GET /api/notes/sent · PATCH /api/notes/:id/read (기존 쪽지 API 재사용)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../../services/api";
import { startNotesRealtime } from "../../services/notes";
import { downloadBlob } from "../../lib/fileStore";
import NoteComposer from "../NoteComposer";
import type { NoteInboxItem, NoteSentItem } from "../../types/api";

export interface StudentInboxPaneProps {
  onToast?: (message: string, kind?: "info" | "success" | "error") => void;
  onUnreadChange?: (unread: number) => void;
  onNeedLogin?: () => void;
}

interface StudentThread {
  id: number;
  name: string;
  department: string;
  last: NoteInboxItem;
  unread: number;
}

function timeText(s: string | null | undefined): string {
  if (!s) return "";
  const t = String(s);
  return t.length >= 16 ? t.slice(5, 16) : t;
}

export default function StudentInboxPane({ onToast, onUnreadChange, onNeedLogin }: StudentInboxPaneProps) {
  const [inbox, setInbox] = useState<NoteInboxItem[]>([]);
  const [sent, setSent] = useState<NoteSentItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyNote, setReplyNote] = useState<NoteInboxItem | null>(null);
  const [replyKey, setReplyKey] = useState(0);

  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const toast = useCallback((message: string, kind: "info" | "success" | "error" = "info") => {
    onToastRef.current?.(message, kind);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [iRes, sRes] = await Promise.all([
      api.getNotesInbox(1, false, 100),
      api.getNotesSent(1, 100),
    ]);
    if (!silent) setLoading(false);
    if (!iRes.ok || !iRes.data || !sRes.ok || !sRes.data) {
      setError(iRes.error || sRes.error || "학생 문의를 불러오지 못했어요.");
      if (!silent) toast(iRes.error || sRes.error || "학생 문의를 불러오지 못했어요.", "error");
      return;
    }
    const students = (iRes.data.notes || []).filter((n) => n.sender_role === "STUDENT");
    setInbox(students);
    setSent(sRes.data.notes || []);
    setError("");
    onUnreadChange?.(students.filter((n) => !Number(n.is_read)).length);
  }, [onUnreadChange, toast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const off = startNotesRealtime({
      onMemoArrived: (p) => {
        if (String(p.from_role || "").toUpperCase() !== "STUDENT") return;
        void load(true);
      },
    });
    const timer = window.setInterval(() => { void load(true); }, 30000);
    return () => { off(); window.clearInterval(timer); };
  }, [load]);

  const threads = useMemo<StudentThread[]>(() => {
    const map = new Map<number, StudentThread>();
    for (const n of inbox) {
      const id = Number(n.sender_id);
      const prev = map.get(id);
      if (!prev) {
        map.set(id, {
          id,
          name: n.sender_name || "학생",
          department: n.sender_department || "학생",
          last: n,
          unread: Number(n.is_read) ? 0 : 1,
        });
      } else if (Number(n.id) > Number(prev.last.id)) {
        prev.last = n;
        prev.unread += Number(n.is_read) ? 0 : 1;
      } else {
        prev.unread += Number(n.is_read) ? 0 : 1;
      }
    }
    return [...map.values()].sort((a, b) => Number(b.last.id) - Number(a.last.id));
  }, [inbox]);

  const selected = threads.find((t) => t.id === selectedId) || null;

  const threadNotes = useMemo(() => {
    if (!selectedId) return [] as Array<(NoteInboxItem | NoteSentItem) & { _dir: "in" | "out" }>;
    const incoming = inbox
      .filter((n) => Number(n.sender_id) === selectedId)
      .map((n) => ({ ...n, _dir: "in" as const }));
    const outgoing = sent
      .filter((n) => (n.recipients || []).some((r) => Number(r.id) === selectedId))
      .map((n) => ({ ...n, _dir: "out" as const }));
    return [...incoming, ...outgoing].sort((a, b) => Number(a.id) - Number(b.id));
  }, [inbox, sent, selectedId]);

  const openThread = useCallback(async (id: number) => {
    setSelectedId(id);
    const unread = inbox.filter((n) => Number(n.sender_id) === id && !Number(n.is_read));
    if (!unread.length) return;
    const results = await Promise.all(unread.map((n) => api.markNoteRead(n.id)));
    const readIds = new Set(unread.filter((_, i) => results[i].ok).map((n) => n.id));
    if (readIds.size) {
      setInbox((prev) => prev.map((n) => (readIds.has(n.id) ? { ...n, is_read: 1 } : n)));
      onUnreadChange?.(inbox.filter((n) => !Number(n.is_read) && !readIds.has(n.id)).length);
    }
  }, [inbox, onUnreadChange]);

  const openReply = (note: NoteInboxItem) => {
    setReplyNote(note);
    setReplyKey(Date.now());
    setReplyOpen(true);
  };

  const downloadAttachment = useCallback(async (fileId: number, name: string) => {
    try {
      const blob = await api.downloadFile(fileId);
      downloadBlob(name || "첨부파일", blob);
    } catch (e) {
      toast(e instanceof Error ? e.message : "파일을 내려받지 못했어요.", "error");
    }
  }, [toast]);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-edu-sub leading-relaxed">
            학생 웹에서 보낸 쪽지가 도착하면 실시간으로 알려 드려요. 학생에게는 선생님 답장이 바로 전달돼요.
          </p>
        </div>
        <button type="button" className="edu-ghost !py-1.5 !px-3 !text-[12px]" onClick={() => void load()} disabled={loading}>
          새로고침
        </button>
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FBC5C5] bg-[#FDE8E8] px-3 py-2.5 text-[12px] font-semibold text-[#B42318]">
          {error}
          {String(error).includes("로그인") && onNeedLogin && (
            <button type="button" className="ml-2 underline" onClick={onNeedLogin}>다시 로그인</button>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,290px)_minmax(0,1fr)]">
        <section className={`bz-card !p-0 overflow-hidden ${selected ? "hidden lg:block" : "block"}`} aria-label="학생 목록">
          <div className="flex items-center justify-between border-b border-[var(--bz-line)] px-3.5 py-2.5">
            <strong className="text-[13px] text-[var(--bz-text)]">학생 문의</strong>
            <span className="text-[11px] font-bold text-[var(--bz-muted)]">
              {threads.reduce((n, t) => n + t.unread, 0) > 0
                ? `안 읽음 ${threads.reduce((n, t) => n + t.unread, 0)}`
                : "모두 확인"}
            </span>
          </div>
          <div className="max-h-[440px] overflow-y-auto p-1.5">
            {loading && threads.length === 0 && (
              <div className="p-1.5" aria-label="학생 문의를 불러오는 중">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2.5 px-2.5 py-2.5">
                    <span className="skeleton h-9 w-9 shrink-0 rounded-full" />
                    <span className="min-w-0 flex-1">
                      <span className="skeleton block h-3 w-2/5" />
                      <span className="skeleton mt-1.5 block h-2.5 w-4/5" />
                      <span className="skeleton mt-1.5 block h-2.5 w-3/5" />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {threads.length === 0 && !loading && (
              <div className="px-4 py-10 text-center text-[12px] leading-relaxed text-[var(--bz-muted)]">
                아직 학생이 보낸 쪽지가 없어요.<br />학생 웹에서 쪽지가 오면 여기에 표시돼요.
              </div>
            )}
            {threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void openThread(t.id)}
                className={`bz-row w-full text-left ${selectedId === t.id ? "sel" : ""}`}
              >
                <span className="bz-avatar">{t.name.slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-bold text-[var(--bz-text)]">{t.name}</span>
                    <span className="shrink-0 rounded-full bg-[#E8F4FD] px-1.5 py-0.5 text-[9.5px] font-bold text-[#0069A8]">학생</span>
                    {t.unread > 0 && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-[#E5484D]" aria-label={`안 읽음 ${t.unread}`} />}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--bz-muted)]">
                    {t.department} · {t.last.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--bz-sub)]">
                    {t.last.content.replace(/\n/g, " ")}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-[var(--bz-muted)]">{timeText(t.last.created_at)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={`bz-card !p-0 overflow-hidden ${selected ? "block" : "hidden lg:block"}`} aria-label="학생 쪽지 상세">
          {!selected && (
            <div className="grid min-h-[360px] place-content-center px-6 text-center">
              <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[22px]">🎓</div>
              <strong className="text-[14px] text-[var(--bz-text)]">학생을 선택해 주세요</strong>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--bz-muted)]">왼쪽에서 학생을 고르면<br />주고받은 쪽지와 답장 버튼이 열립니다.</p>
            </div>
          )}
          {selected && (
            <>
              <div className="flex items-center gap-2.5 border-b border-[var(--bz-line)] px-3.5 py-2.5">
                <button type="button" className="bz-btn-soft lg:hidden" onClick={() => setSelectedId(null)}>← 목록</button>
                <span className="bz-avatar">{selected.name.slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <strong className="truncate text-[13.5px] text-[var(--bz-text)]">{selected.name}</strong>
                    <span className="rounded-full bg-[#E8F4FD] px-1.5 py-0.5 text-[9.5px] font-bold text-[#0069A8]">학생</span>
                  </div>
                  <span className="block truncate text-[11px] text-[var(--bz-muted)]">{selected.department}</span>
                </div>
                <button type="button" className="bz-btn-soft" onClick={() => openReply(selected.last)}>↩ 답장</button>
              </div>

              <div className="bz-scroll max-h-[440px] space-y-3 overflow-y-auto p-3.5">
                {threadNotes.length === 0 && (
                  <div className="py-10 text-center text-[12px] text-[var(--bz-muted)]">주고받은 쪽지가 없어요.</div>
                )}
                {threadNotes.map((n) => {
                  const incoming = n._dir === "in";
                  const inboxNote = n as NoteInboxItem;
                  const sentNote = n as NoteSentItem;
                  const mine = !incoming && (sentNote.recipients || []).find((r) => Number(r.id) === selected.id);
                  return (
                    <article
                      key={`${n._dir}-${n.id}`}
                      className={`rounded-[13px] border px-3.5 py-3 ${
                        incoming
                          ? "border-[var(--bz-line)] bg-[var(--bz-surface)] border-l-[3px] border-l-[var(--brand)]"
                          : "border-[#D5ECF9] bg-[#F2F9FE]"
                      }`}
                    >
                      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold text-[var(--bz-muted)]">
                        <span className="font-bold text-[var(--bz-sub)]">{incoming ? `${selected.name} 학생` : "나"}</span>
                        <span>·</span>
                        <span>{n.created_at || ""}</span>
                        {!incoming && (
                          <span className="ml-auto font-bold text-[var(--brand-strong)]">
                            {mine && (Number(mine.is_read) || mine.read_at) ? "읽음" : "전송됨"}
                          </span>
                        )}
                      </div>
                      <h3 className="mb-1 text-[13px] font-bold text-[var(--bz-text)]">{n.title || "(제목 없음)"}</h3>
                      <pre className="whitespace-pre-wrap break-words font-[inherit] text-[12.5px] leading-relaxed text-[var(--bz-text)]">{n.content}</pre>
                      {n.file_id ? (
                        <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-[#D7E8F4] bg-[#F8FCFF] px-2.5 py-2">
                          <span aria-hidden="true">📎</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11.5px] font-bold text-[var(--bz-text)]">{n.file_name || "첨부 파일"}</div>
                            <div className="text-[10px] text-[var(--bz-muted)]">
                              {n.file_expires_at ? `${String(n.file_expires_at).slice(0, 10)}까지 보관` : "영구 보관"}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="bz-btn-soft !py-1 !text-[10.5px]"
                            onClick={() => void downloadAttachment(Number(n.file_id), n.file_name || "첨부파일")}
                          >
                            내려받기
                          </button>
                        </div>
                      ) : null}
                      {incoming && (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            className="bz-btn-soft !py-1 !text-[11px]"
                            onClick={() => openReply(inboxNote)}
                          >
                            ↩ 이 쪽지에 답장
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      <NoteComposer
        open={replyOpen}
        onOpenChange={setReplyOpen}
        teachers={[]}
        onToast={toast}
        initialRecipient={replyNote && selected
          ? { id: selected.id, name: selected.name, department: selected.department }
          : null}
        initialTitle={replyNote ? (replyNote.title.startsWith("Re:") ? replyNote.title : `Re: ${replyNote.title}`) : ""}
        initialKey={replyKey}
        onSent={() => { setReplyOpen(false); void load(true); }}
      />
    </div>
  );
}
