// 메인 창 (5단계-2 WIP) — 웹 브리즈 디자인 이식 + 쪽지 실시간(토스트/뱃지) 통합
// 소켓: memo-arrived → 토스트+뱃지, peer-read → 토스트. 연결 실패는 조용히 무시(데모 허용).

import { useCallback, useEffect, useRef, useState } from "react";
import { DEPARTMENT_TREE, DEMO_SCHOOL_NAME } from "../mock/demoData";
import api from "../services/api";
import { connectNotesRealtime, fetchUnreadCount, startNotesRealtime } from "../services/notes";
import type { NoteInboxItem, ServerDeptNode } from "../types/api";
import NoteComposer from "./NoteComposer";
import type { NoteTeacher } from "./NoteComposer";
import NoteVault from "./NoteVault";

type ToastKind = "info" | "success" | "error";

interface ToastState {
  message: string;
  kind: ToastKind;
}

export default function MainWindow() {
  const [teachers, setTeachers] = useState<NoteTeacher[]>([]);
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{ recipient: NoteTeacher; title: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const toastTimer = useRef<number | null>(null);
  const teachersRef = useRef<NoteTeacher[]>([]);
  teachersRef.current = teachers;

  const showToast = useCallback((message: string, kind: ToastKind = "info") => {
    setToast({ message, kind });
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
  }, []);

  const loadTeachers = useCallback(async () => {
    const [usersRes, treeRes] = await Promise.all([api.getUsers(), api.getDeptTree()]);
    if (!usersRes.ok || !usersRes.data) return;

    const deptMap = new Map<number, string>();
    const walk = (nodes: ServerDeptNode[]) => {
      nodes.forEach((n) => {
        deptMap.set(n.id, n.name);
        if (n.children && n.children.length) walk(n.children);
      });
    };
    if (treeRes.ok && treeRes.data) walk(treeRes.data.tree);

    setTeachers(
      usersRes.data.map((u) => ({
        id: u.id,
        name: u.real_name,
        department: u.department_id != null ? deptMap.get(u.department_id) : undefined,
      }))
    );
  }, []);

  useEffect(() => {
    const off = startNotesRealtime({
      onMemoArrived: (p) => {
        showToast(`${p.from_name || "교사"}님에게 쪽지가 왔어요.`, "info");
        setUnread((u) => u + 1);
      },
      onPeerRead: (p) => {
        const name = teachersRef.current.find((t) => String(t.id) === String(p.from))?.name;
        showToast(name ? `${name}님이 쪽지를 읽었어요.` : "보낸 쪽지를 읽었어요.", "success");
      },
      onConnected: () => setConnected(true),
      onDisconnected: () => setConnected(false),
    });

    void (async () => {
      const ok = await connectNotesRealtime({});
      setConnected(ok);
      if (ok) {
        setUnread(await fetchUnreadCount());
        void loadTeachers();
      }
    })();

    return off;
  }, [showToast, loadTeachers]);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[var(--bz-bg)] text-[var(--bz-text)]">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--bz-line)] bg-[var(--bz-surface)]">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span
            className="grid h-9 w-9 place-items-center rounded-[12px] text-[15px] font-black text-white"
            style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}
          >
            B
          </span>
          <span>
            <span className="block text-[14px] font-extrabold leading-tight">브리즈</span>
            <span className="block text-[11px] text-[var(--bz-muted)]">{DEMO_SCHOOL_NAME}</span>
          </span>
        </div>

        <div className="bz-scroll flex-1 overflow-y-auto px-2.5 py-1">
          <div className="mb-1.5 px-2 text-[11px] font-bold text-[var(--bz-muted)]">조직도</div>
          {DEPARTMENT_TREE.map((node) => (
            <div key={node.id} className="mb-0.5">
              <div className="rounded-[10px] px-2 py-1.5 text-[13px] font-semibold hover:bg-[var(--bz-hover)]">
                {node.name}
              </div>
              {(node.children || []).map((child) => (
                <div
                  key={child.id}
                  className="rounded-[10px] px-2 py-1.5 pl-5 text-[12.5px] text-[var(--bz-sub)] hover:bg-[var(--bz-hover)]"
                >
                  {child.name}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--bz-line)] px-4 py-3 text-[11.5px] text-[var(--bz-muted)]">
          <span className={`bz-dot ${connected ? "online" : ""}`} />
          {connected ? "서버 연결됨" : "서버 연결 안 됨"}
        </div>
      </aside>

      <main className="bz-scroll flex-1 overflow-y-auto px-6 py-6">
        <h1 className="mb-1 text-[20px] font-extrabold tracking-[-0.4px]">쪽지</h1>
        <p className="mb-6 text-[12.5px] text-[var(--bz-sub)]">
          전교·학년·부서·개별 교사에게 쪽지를 보내고, 받은 쪽지를 확인해요.
        </p>

        <div className="grid max-w-[560px] grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="bz-card flex flex-col items-start gap-2 p-5 text-left transition hover:border-[var(--brand-line)]"
            onClick={() => setComposerOpen(true)}
          >
            <span
              className="grid h-11 w-11 place-items-center rounded-[14px] text-[19px] text-white"
              style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}
            >
              ✏️
            </span>
            <span className="text-[14.5px] font-bold">쪽지 쓰기</span>
            <span className="text-[12px] text-[var(--bz-muted)]">7초 안에 전송을 취소할 수 있어요</span>
          </button>

          <button
            type="button"
            className="bz-card flex flex-col items-start gap-2 p-5 text-left transition hover:border-[var(--brand-line)]"
            onClick={() => setVaultOpen(true)}
          >
            <span className="flex w-full items-start justify-between">
              <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-[var(--brand-soft)] text-[19px]">📥</span>
              {unread > 0 && <span className="bz-badge danger">{unread > 99 ? "99+" : unread}</span>}
            </span>
            <span className="text-[14.5px] font-bold">쪽지함</span>
            <span className="text-[12px] text-[var(--bz-muted)]">
              {unread > 0 ? `안 읽은 쪽지 ${unread}통` : "받은 쪽지와 보낸 쪽지"}
            </span>
          </button>
        </div>

        {teachers.length === 0 && (
          <p className="mt-5 max-w-[560px] rounded-[14px] border border-[var(--bz-line)] bg-[var(--bz-surface)] px-4 py-3 text-[12px] text-[var(--bz-muted)]">
            서버에 연결되면 교사 목록과 조직도가 채워져요. 로그인 후 자동으로 연결돼요.
          </p>
        )}
      </main>

      <NoteComposer
        open={composerOpen}
        onOpenChange={(next) => {
          setComposerOpen(next);
          if (!next) setReplyTarget(null);
        }}
        teachers={teachers}
        onToast={showToast}
        initialRecipient={replyTarget?.recipient || null}
        initialTitle={replyTarget?.title || ""}
        initialKey={replyTarget?.nonce || 0}
        onSent={() => { setReplyTarget(null); setVaultOpen(false); }}
      />

      <NoteVault
        open={vaultOpen}
        onOpenChange={setVaultOpen}
        onToast={showToast}
        onUnreadChange={setUnread}
        onReply={(sender, note: NoteInboxItem) => {
          setReplyTarget({
            recipient: { id: sender.id, name: sender.name, department: sender.department || "학생" },
            title: `Re: ${note.title}`,
            nonce: Date.now(),
          });
          setVaultOpen(false);
          setComposerOpen(true);
        }}
      />

      <div className={`bz-toast ${toast?.kind === "success" ? "success" : toast?.kind === "error" ? "error" : ""} ${toast ? "show" : ""}`}>
        {toast?.message || ""}
      </div>
    </div>
  );
}
