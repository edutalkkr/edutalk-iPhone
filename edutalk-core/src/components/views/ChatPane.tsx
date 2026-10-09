import { useMemo, useState } from "react";
import type { ChatMessage, Teacher } from "../../types";
import { scanDlp } from "./MemoPane";
import { TemplatesBar } from "../ComposerExtras";

function timeShort(iso: string): string {
  const s = String(iso ?? "");
  // "YYYY-MM-DD HH:MM:SS" 또는 ISO 모두에서 HH:MM만 뽑는다
  const m = s.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

interface Props {
  peer: Teacher | null;
  teachers: Teacher[];
  chats: Record<string, ChatMessage[]>;
  onPeer: (t: Teacher) => void;
  onSend: (peerId: string, body: string) => { ok: boolean; error?: string };
  onReact: (peerId: string, msgId: string, emoji: string) => void;
  onToast: (t: string) => void;
  onGoMemo?: () => void;
  onAudit: (kind: "RRN" | "PHONE" | "SCORE" | "CARD" | "PASSWORD" | "HWP", text: string, blocked: boolean) => void;
}

export default function ChatPane(p: Props) {
  const [draft, setDraft] = useState("");
  const [warn, setWarn] = useState("");
  const msgs = useMemo(() => (p.peer ? p.chats[p.peer.id] ?? [] : []), [p.peer, p.chats]);
  const send = () => {
    if (!p.peer) return p.onToast("왼쪽에서 대화 상대를 골라 주세요.");
    const body = draft.trim();
    if (!body) return;
    const hit = scanDlp(body);
    if (hit.blocked) {
      p.onAudit(hit.kind ?? "RRN", body.slice(0, 60), true);
      setWarn(`보안 경고: 개인정보 유출 감지 (${hit.reason}) 전송이 멈췄어요.`);
      return;
    }
    if (hit.kind) {
      p.onAudit(hit.kind, body.slice(0, 60), false);
      if (!warn) { setWarn(`주의: ${hit.reason} 그래도 보내려면 한 번 더 보내기를 눌러 주세요.`); return; }
    }
    const r = p.onSend(p.peer.id, body);
    if (r.ok) { setDraft(""); setWarn(""); }
    else p.onToast(r.error ?? "보내지 못했어요.");
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="edu-card p-2.5 overflow-y-auto max-h-[190px] shrink-0">
        <div className="px-1.5 py-1 text-[12px] font-bold text-edu-sub flex items-center gap-2">
          <span>대화 상대</span>
          {p.onGoMemo && (
            <button className="ml-auto text-[12px] font-bold text-edu-strong hover:underline" onClick={p.onGoMemo} title="제목·수신확인 있는 정식 쪽지로 이동">
              ✉️ 쪽지함
            </button>
          )}
        </div>
        <div className="anim-list flex flex-col gap-0.5">
        {p.teachers.length === 0 && <div className="text-center text-edu-sub text-[12.5px] py-6">조직도에서 교사를 먼저 등록해 주세요.</div>}
        {p.teachers.map((t) => {
          const n = (p.chats[t.id] ?? []).length;
          const last = (p.chats[t.id] ?? []).slice(-1)[0];
          return (
            <button
              key={t.id}
              onClick={() => { p.onPeer(t); setWarn(""); }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left ${p.peer?.id === t.id ? "bg-edu-soft" : "hover:bg-edu-chip"}`}
            >
              <span className="w-9 h-9 rounded-full grid place-items-center text-white font-extrabold shrink-0" style={{ background: t.avatarColor }}>
                {(t.name || "?")[0]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-bold text-[13.5px]">
                  <span className="truncate">{t.name}</span>
                  {n > 0 && <span className="text-[10.5px] bg-edu-chip rounded-full px-1.5 py-0.5 text-edu-sub">{n}</span>}
                </span>
                <span className="block text-[12px] text-edu-sub truncate">{last ? last.body : t.statusMessage}</span>
              </span>
            </button>
          );
        })}
        </div>
      </div>
      <div className="edu-card flex flex-col overflow-hidden anim-card min-h-[440px] max-h-[calc(100vh-340px)]">
        {!p.peer ? (
          <div className="m-auto text-[13.5px] text-edu-sub text-center">대화 상대를 고르면<br />말풍선이 나와요.</div>
        ) : (
          <>
            <div className="px-4 py-2.5 border-b border-edu-line font-extrabold text-[14px] flex items-center gap-2">
              {p.peer.name} <span className="text-[12px] font-medium text-edu-sub">· {p.peer.dept} · {p.peer.ip}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 bg-[#FAFAFD]">
              {msgs.length === 0 && <div className="m-auto text-edu-sub text-[13px]">첫 메시지를 남겨 보세요.</div>}
              {msgs.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.mine ? "items-end" : "items-start"} anim-bubble`}>
                  <div className={`bubble ${m.mine ? "me" : ""}`}>{m.body}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[11px] text-edu-muted">
                      {m.pending ? "🕒 전송 중…" : timeShort(m.createdAt)}
                    </span>
                    {(["👍", "❤️", "✅"] as const).map((e) => (
                      <button key={e} className="text-[13px] hover:scale-110 transition-transform" onClick={() => p.onReact(p.peer!.id, m.id, e)}>
                        {e}
                      </button>
                    ))}
                    {m.emoji.length > 0 && <span className="text-[12px]">{m.emoji.join(" ")}</span>}
                  </div>
                </div>
              ))}
            </div>
            {warn && <div className="mx-3 mb-1.5 text-[12.5px] font-bold text-[#B42318] bg-[#FFF0F1] border border-[#F5C6C6] rounded-xl px-3 py-2">{warn}</div>}
            <div className="px-2.5 pt-2">
              <TemplatesBar onInsert={(t) => setDraft((s) => (s ? `${s} ${t}` : t))} />
            </div>
            <div className="p-2.5 border-t border-edu-line flex gap-1.5">
              <input
                className="edu-input"
                placeholder="메시지 입력 (주민번호·성적 포함 시 DLP가 막아요)"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setWarn(""); }}
                maxLength={1500}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              />
              <button className="edu-btn shrink-0" onClick={send}>전송</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
