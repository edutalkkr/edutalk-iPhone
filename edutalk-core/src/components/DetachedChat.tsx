import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import { nowIso } from "../mock/initialData";
import { storeGet } from "../lib/localStore";
import { call, emitEvent, listenEvent } from "../lib/tauri";
import { fetchQuicks, persistQuick } from "../lib/repo";
import BzTooltip from "./ui/BzTooltip";

// 여러 창 모드: 대화 하나를 독립된 창에서 띄운다 (창을 따로 옮겨 두고 쓰기 좋다).
function timeShort(iso: string): string {
  const m = String(iso ?? "").match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

export default function DetachedChat({ peerId, peerName }: { peerId: string; peerName: string }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement | null>(null);

  // 열릴 때: 로컬 저장 + Rust(SQLite)에서 대화를 모아 보여준다
  useEffect(() => {
    (async () => {
      const all = (await storeGet<Record<string, ChatMessage[]>>("chats")) ?? {};
      setMsgs(all[peerId] ?? []);
      const rows = await fetchQuicks(peerId);
      if (rows && rows.length) {
        setMsgs((s) => {
          const have = new Set(s.map((m) => m.id));
          const fresh = rows.filter((r) => !have.has(r.id));
          return fresh.length ? [...s, ...fresh] : s;
        });
      }
    })();
    // 이 창이 열려 있는 동안 도착한 대화를 바로 붙인다
    const off = listenEvent("chat-arrived", (pl) => {
      const ev = pl as { kind: string; id: string; ref_id: string; body: string; from: string } | null;
      if (!ev || ev.kind !== "quick" || ev.from !== peerId || !ev.id) return;
      setMsgs((s) => (s.some((m) => m.id === ev.id)
        ? s
        : [...s, { id: ev.id, peerId, mine: false, body: ev.body || "", createdAt: nowIso(), read: true, emoji: [] }]));
    });
    return () => off();
  }, [peerId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    const msg: ChatMessage = {
      id: `q-${Date.now().toString(36)}`, peerId, mine: true, body,
      createdAt: nowIso(), read: false, emoji: [], pending: true,
    };
    setMsgs((s) => [...s, msg]);
    setDraft("");
    void (async () => {
      try {
        const realId = await persistQuick(peerId, peerName, body);
        setMsgs((s) => s.map((m) => (m.id === msg.id ? { ...m, id: realId ?? m.id, pending: false } : m)));
        await call("p2p_send", { node_id: peerId, kind: "quick", title: "", body, ref_id: msg.id, firebase_cloud: false });
      } catch {
        setMsgs((s) => s.map((m) => (m.id === msg.id ? { ...m, pending: false } : m)));
      }
      // 메인 창의 대화 목록도 바로 따라오게 알린다
      emitEvent("breeze-sync", { scope: "chats", peer: peerId });
    })();
  };

  const winAct = async (kind: "min" | "close") => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if (kind === "min") await w.minimize();
      else await w.close();
    } catch {
      /* 미리보기에서는 창 조작 없음 */
    }
  };

  return (
    <div className="h-screen flex flex-col bg-edu-bg">
      <div
        data-tauri-drag-region
        className="h-10 shrink-0 flex items-center gap-2 pl-3 pr-1.5 bg-edu-surface border-b border-edu-line select-none"
      >
        <span className="w-6 h-6 rounded-lg grid place-items-center text-white text-[12px] font-black"
          style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}>B</span>
        <span className="font-extrabold text-[13px]">{peerName}</span>
        <span className="text-[11px] text-edu-muted">빠른 대화</span>
        <span className="flex-1" />
        <BzTooltip content="최소화" position="bottom">
          <button
            className="w-8 h-7 rounded-lg grid place-items-center text-[13px] text-edu-sub hover:bg-edu-chip transition-colors"
            onClick={() => { void winAct("min"); }}
            aria-label="최소화"
          >
            ─
          </button>
        </BzTooltip>
        <BzTooltip content="끄기" position="bottom">
          <button
            className="w-8 h-7 rounded-lg grid place-items-center text-[13px] font-bold text-edu-sub hover:bg-[#E5484D] hover:text-white transition-colors"
            aria-label="창 닫기"
            onClick={() => { void winAct("close"); }}
          >
            ✕
          </button>
        </BzTooltip>
      </div>
      <div ref={scroller} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
        {msgs.length === 0 && <div className="m-auto text-edu-sub text-[13px]">첫 메시지를 남겨 보세요.</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.mine ? "items-end" : "items-start"} anim-bubble`}>
            <div className={`bubble ${m.mine ? "me" : ""}`}>{m.body}</div>
            <span className="text-[11px] text-edu-muted mt-1">{m.pending ? "🕒 전송 중…" : timeShort(m.createdAt)}</span>
          </div>
        ))}
      </div>
      <div className="p-2.5 border-t border-edu-line flex gap-1.5 bg-edu-surface">
        <input
          className="edu-input"
          placeholder="메시지 입력"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1500}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="edu-btn shrink-0" onClick={send}>전송</button>
      </div>
    </div>
  );
}
