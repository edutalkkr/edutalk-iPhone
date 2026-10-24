import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Teacher } from "../../types";
import type { MessageResponse, ServerRoom, ServerUser } from "../../types/api";
import api from "../../services/api";
import { socket } from "../../services/socket";
import { scanDlp } from "./MemoPane";
import { TemplatesBar } from "../ComposerExtras";
import BzTooltip from "../ui/BzTooltip";

function timeShort(iso: string): string {
  const s = String(iso ?? "");
  // "YYYY-MM-DD HH:MM:SS" 또는 ISO 모두에서 HH:MM만 뽑는다
  const m = s.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

function memberLabel(id: number, users: ServerUser[]): string {
  return users.find((u) => Number(u.id) === Number(id))?.real_name || `사용자 ${id}`;
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

  // ── 그룹 대화 (학교 서버의 rooms API + Socket.io) ──
  const [groups, setGroups] = useState<ServerRoom[]>([]);
  const [groupMsgs, setGroupMsgs] = useState<Record<string, MessageResponse[]>>({});
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [groupWarn, setGroupWarn] = useState("");
  const [groupError, setGroupError] = useState("");
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [myServerId, setMyServerId] = useState<number | null>(null);
  const [serverUsers, setServerUsers] = useState<ServerUser[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [pickedMembers, setPickedMembers] = useState<number[]>([]);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const groupsRef = useRef<ServerRoom[]>([]);
  const myServerIdRef = useRef<number | null>(null);
  const activeGroupRef = useRef<string | null>(null);
  const toastRef = useRef(p.onToast);
  toastRef.current = p.onToast;
  activeGroupRef.current = activeGroupId;
  groupsRef.current = groups;
  myServerIdRef.current = myServerId;

  const activeGroup = groups.find((g) => g.id === activeGroupId) || null;
  const activeGroupMessages = activeGroupId ? groupMsgs[activeGroupId] ?? [] : [];

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    setGroupError("");
    try {
      const [roomsRes, usersRes, meRes] = await Promise.all([
        api.getRooms(),
        api.getUsers(),
        api.getMe(),
      ]);
      if (roomsRes.ok && roomsRes.data) {
        setGroups(roomsRes.data);
        // 참여 중인 모든 방을 구독해야 다른 탭을 보고 있어도 새 메시지 알림을 받는다.
        try { await socket.connect(); } catch { /* 오프라인이면 아래에서 안내 */ }
        for (const room of roomsRes.data) {
          void socket.joinRoom(room.id).catch(() => undefined);
        }
      } else {
        setGroupError(roomsRes.error || "그룹 대화를 불러오지 못했어요.");
      }
      if (usersRes.ok && usersRes.data) setServerUsers(usersRes.data);
      if (meRes.ok && meRes.data?.user) setMyServerId(Number(meRes.data.user.id));
    } catch {
      setGroupError("학교 서버에 연결하지 못했어요. 그룹 대화는 서버 로그인 후 사용할 수 있어요.");
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    const off = socket.on("message:new", (msg) => {
      if (!msg || !msg.room_id) return;
      setGroupMsgs((prev) => {
        const list = prev[msg.room_id] ?? [];
        if (list.some((m) => Number(m.id) === Number(msg.id))) return prev;
        return { ...prev, [msg.room_id]: [...list, msg] };
      });
      if (!groupsRef.current.some((g) => g.id === msg.room_id)) {
        // 다른 선생님이 새 그룹에 초대한 경우 목록을 다시 불러온다.
        void loadGroups();
      }
      if (Number(msg.sender_id) !== Number(myServerIdRef.current) && msg.room_id !== activeGroupRef.current) {
        const room = groupsRef.current.find((g) => g.id === msg.room_id);
        toastRef.current(`💬 ${room?.name || "그룹 대화"}에 새 메시지가 도착했어요.`);
      }
    });
    void loadGroups();
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeGroupId) return;
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [activeGroupId, activeGroupMessages.length]);

  const openGroup = async (room: ServerRoom) => {
    setActiveGroupId(room.id);
    setGroupWarn("");
    setGroupError("");
    if (!groupMsgs[room.id]) {
      const res = await api.getRoomMessages(room.id, 100);
      if (res.ok && res.data) {
        setGroupMsgs((prev) => ({ ...prev, [room.id]: [...res.data!].reverse() }));
      } else if (!res.ok) {
        setGroupError(res.error || "그룹 메시지를 불러오지 못했어요.");
      }
    }
    void socket.joinRoom(room.id).catch(() => undefined);
  };

  const sendDm = () => {
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

  const sendGroup = async () => {
    if (!activeGroup) return;
    const body = groupDraft.trim();
    if (!body) return;
    const hit = scanDlp(body);
    if (hit.blocked) {
      p.onAudit(hit.kind ?? "RRN", body.slice(0, 60), true);
      setGroupWarn(`보안 경고: 개인정보 유출 감지 (${hit.reason}) 전송이 멈췄어요.`);
      return;
    }
    if (hit.kind) {
      p.onAudit(hit.kind, body.slice(0, 60), false);
      if (!groupWarn) { setGroupWarn(`주의: ${hit.reason} 그래도 보내려면 한 번 더 보내기를 눌러 주세요.`); return; }
    }
    try {
      const r = await socket.sendMessage({ roomId: activeGroup.id, content: body });
      if (r.message) {
        setGroupMsgs((prev) => {
          const list = prev[activeGroup.id] ?? [];
          if (list.some((m) => Number(m.id) === Number(r.message.id))) return prev;
          return { ...prev, [activeGroup.id]: [...list, r.message] };
        });
      }
      setGroupDraft("");
      setGroupWarn("");
    } catch {
      setGroupError("그룹 메시지를 보내지 못했어요. 학교 서버 연결을 확인해 주세요.");
    }
  };

  const toggleMember = (id: number) => {
    setPickedMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setCreateError("");
  };

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) { setCreateError("그룹 이름을 적어 주세요."); return; }
    if (!pickedMembers.length) { setCreateError("함께할 선생님을 한 명 이상 골라 주세요."); return; }
    setCreating(true);
    setCreateError("");
    try {
      const res = await api.createRoom(name, pickedMembers);
      if (!res.ok || !res.data) {
        setCreateError(res.error || "그룹을 만들지 못했어요.");
        return;
      }
      const room = res.data;
      await loadGroups();
      setShowCreate(false);
      setNewGroupName("");
      setPickedMembers([]);
      setActiveGroupId(room.id);
      p.onToast(`그룹 대화 '${room.name}'을(를) 만들었어요.`);
      const msgRes = await api.getRoomMessages(room.id, 100);
      if (msgRes.ok && msgRes.data) setGroupMsgs((prev) => ({ ...prev, [room.id]: [...msgRes.data!].reverse() }));
      void socket.joinRoom(room.id).catch(() => undefined);
    } catch {
      setCreateError("그룹을 만들지 못했어요. 서버 연결을 확인해 주세요.");
    } finally {
      setCreating(false);
    }
  };

  const noServer = !!groupError && groups.length === 0;

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
      <div className="edu-card p-2.5 overflow-y-auto shrink-0 max-h-[230px] md:max-h-[calc(100vh-120px)] md:h-[calc(100vh-120px)] md:w-[300px]">
        <div className="flex items-center gap-1.5 px-1.5 py-1">
          <span className="text-[12px] font-bold text-edu-sub">그룹 대화</span>
          <BzTooltip content="여러 선생님과 함께 대화하는 방을 만들어요" position="bottom">
            <button
              className="ml-auto rounded-lg bg-edu-soft px-2 py-1 text-[11.5px] font-extrabold text-edu-strong disabled:opacity-45"
              onClick={() => { setShowCreate(true); setCreateError(""); }}
              disabled={noServer}
            >
              ＋ 그룹 만들기
            </button>
          </BzTooltip>
        </div>
        {groupError && (
          <div className="mx-1.5 mb-1 rounded-lg bg-[#FFF7ED] px-2 py-1.5 text-[10.5px] font-semibold leading-relaxed text-[#9A3412]">
            {groupError}
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {groupsLoading && groups.length === 0 && (
            <div className="px-2 py-2 text-[11.5px] text-edu-muted">그룹을 불러오는 중…</div>
          )}
          {groups.map((g) => {
            const list = groupMsgs[g.id] ?? [];
            const last = list.slice(-1)[0];
            const active = activeGroupId === g.id;
            return (
              <button
                key={g.id}
                onClick={() => void openGroup(g)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left ${active ? "bg-edu-soft" : "hover:bg-edu-chip"}`}
              >
                <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0 bg-[#E8F4FB] text-[15px]" aria-hidden>
                  #️⃣
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-bold text-edu-ink">{g.name}</span>
                    <span className="shrink-0 text-[10px] font-bold text-edu-muted">{g.member_ids.length}명</span>
                  </span>
                  <span className="block truncate text-[11.5px] text-edu-sub">
                    {last ? `${last.sender_name || memberLabel(last.sender_id, serverUsers)} · ${last.content}` : "첫 메시지를 남겨 보세요"}
                  </span>
                </span>
              </button>
            );
          })}
          {!groupsLoading && groups.length === 0 && !groupError && (
            <div className="px-2.5 py-2 text-[11.5px] leading-relaxed text-edu-muted">
              아직 그룹이 없어요. [＋ 그룹 만들기]로 함께할 선생님을 초대해 보세요.
            </div>
          )}
        </div>

        <div className="my-2 h-px bg-edu-line" aria-hidden />
        <div className="px-1.5 py-1 text-[12px] font-bold text-edu-sub flex items-center gap-2">
          <span>대화 상대</span>
          {p.onGoMemo && (
            <BzTooltip content="제목·수신확인 있는 정식 쪽지로 이동" position="bottom">
              <button className="ml-auto text-[12px] font-bold text-edu-strong hover:underline" onClick={p.onGoMemo}>
                ✉️ 쪽지함
              </button>
            </BzTooltip>
          )}
        </div>
        <div className="anim-list flex flex-col gap-0.5">
          {p.teachers.length === 0 && <div className="text-center text-edu-sub text-[12.5px] py-6">조직도에서 교사를 먼저 등록해 주세요.</div>}
          {p.teachers.map((t) => {
            const n = (p.chats[t.id] ?? []).length;
            const last = (p.chats[t.id] ?? []).slice(-1)[0];
            const active = !activeGroupId && p.peer?.id === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setActiveGroupId(null); p.onPeer(t); setWarn(""); setGroupWarn(""); }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left ${active ? "bg-edu-soft" : "hover:bg-edu-chip"}`}
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

      <div className="edu-card flex flex-col overflow-hidden anim-card min-h-[440px] max-h-[calc(100vh-340px)] md:min-h-[480px] md:max-h-[calc(100vh-120px)] md:h-[calc(100vh-120px)] flex-1 min-w-0">
        {activeGroup ? (
          <>
            <div className="px-4 py-2.5 border-b border-edu-line font-extrabold text-[14px] flex items-center gap-2">
              <span className="text-[15px]" aria-hidden>#️⃣</span>
              <span className="min-w-0 flex-1 truncate">{activeGroup.name}</span>
              <span className="shrink-0 text-[11px] font-medium text-edu-sub">
                {activeGroup.member_ids.length}명
              </span>
              <span className="hidden min-w-0 truncate text-[11px] font-medium text-edu-sub md:inline">
                · {activeGroup.member_ids.slice(0, 3).map((id) => memberLabel(id, serverUsers)).join(", ")}
                {activeGroup.member_ids.length > 3 ? " 외" : ""}
              </span>
              <button
                className="hidden shrink-0 edu-ghost !py-1 !px-2 !text-[11px] sm:inline-flex"
                onClick={() => void openGroup(activeGroup)}
                title="그룹 메시지 새로고침"
              >
                새로고침
              </button>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 bg-[#FAFAFD]">
              {activeGroupMessages.length === 0 && <div className="m-auto text-edu-sub text-[13px]">첫 메시지를 남겨 보세요.</div>}
              {activeGroupMessages.map((m) => {
                const mine = Number(m.sender_id) === Number(myServerId);
                return (
                  <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"} anim-bubble`}>
                    {!mine && <div className="mb-0.5 text-[10.5px] font-bold text-edu-sub">{m.sender_name || memberLabel(m.sender_id, serverUsers)}</div>}
                    <div className={`bubble ${mine ? "me" : ""}`}>{m.content}</div>
                    <span className="mt-1 text-[11px] text-edu-muted">{timeShort(m.created_at)}</span>
                  </div>
                );
              })}
            </div>
            {groupError && <div className="mx-3 mb-1.5 text-[12px] font-bold text-[#B42318] bg-[#FFF0F1] border border-[#F5C6C6] rounded-xl px-3 py-2">{groupError}</div>}
            {groupWarn && <div className="mx-3 mb-1.5 text-[12.5px] font-bold text-[#B42318] bg-[#FFF0F1] border border-[#F5C6C6] rounded-xl px-3 py-2">{groupWarn}</div>}
            <div className="px-2.5 pt-2">
              <TemplatesBar onInsert={(t) => setGroupDraft((s) => (s ? `${s} ${t}` : t))} />
            </div>
            <div className="p-2.5 border-t border-edu-line flex gap-1.5">
              <input
                className="edu-input"
                placeholder="그룹에 메시지 보내기 (주민번호·성적 포함 시 DLP가 막아요)"
                value={groupDraft}
                onChange={(e) => { setGroupDraft(e.target.value); setGroupWarn(""); setGroupError(""); }}
                maxLength={1500}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendGroup(); } }}
              />
              <button className="edu-btn shrink-0" onClick={() => void sendGroup()}>보내기</button>
            </div>
          </>
        ) : !p.peer ? (
          <div className="m-auto text-[13.5px] text-edu-sub text-center">
            대화 상대를 고르면 말풍선이 나와요.<br />
            <span className="text-[12px]">여러 명과 이야기하려면 [＋ 그룹 만들기]를 눌러 주세요.</span>
          </div>
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
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendDm(); } }}
              />
              <button className="edu-btn shrink-0" onClick={sendDm}>전송</button>
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-[1200] grid place-items-center bg-[rgba(15,23,42,0.46)] p-4 backdrop-blur-[3px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-create-title"
          onClick={() => { if (!creating) setShowCreate(false); }}
        >
          <div className="w-full max-w-[420px] rounded-2xl border border-edu-line bg-edu-surface p-4 shadow-2xl anim-pop" onClick={(e) => e.stopPropagation()}>
            <div id="group-create-title" className="text-[16px] font-extrabold text-edu-ink">그룹 대화 만들기</div>
            <div className="mt-1 text-[12px] text-edu-sub">함께할 선생님을 고르면 모두가 같은 대화방에서 이야기할 수 있어요.</div>
            <input
              className="edu-input mt-3"
              placeholder="그룹 이름 (예: 2학년부 업무방)"
              value={newGroupName}
              onChange={(e) => { setNewGroupName(e.target.value.slice(0, 40)); setCreateError(""); }}
              maxLength={40}
            />
            <div className="mt-2.5 max-h-[220px] overflow-y-auto rounded-xl border border-edu-line p-1.5">
              {serverUsers.length === 0 && (
                <div className="px-2 py-3 text-[12px] text-edu-sub">서버에서 선생님 목록을 불러오지 못했어요. 학교 서버 로그인을 확인해 주세요.</div>
              )}
              {serverUsers.filter((u) => Number(u.id) !== Number(myServerId)).map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-edu-chip">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[#0082C8]"
                    checked={pickedMembers.includes(Number(u.id))}
                    onChange={() => toggleMember(Number(u.id))}
                  />
                  <span className="min-w-0 flex-1 truncate font-bold text-edu-ink">{u.real_name || u.username}</span>
                  {u.role && <span className="shrink-0 text-[10px] font-bold text-edu-muted">{u.role === "ADMIN" ? "관리자" : "교사"}</span>}
                </label>
              ))}
            </div>
            {createError && <div className="mt-2 rounded-lg bg-[#FFF0F1] px-2.5 py-2 text-[12px] font-semibold text-[#B42318]">{createError}</div>}
            <div className="mt-3 flex gap-2">
              <button className="edu-ghost flex-1 !py-2.5" onClick={() => setShowCreate(false)} disabled={creating}>취소</button>
              <button className="edu-btn flex-1 !py-2.5" onClick={() => void createGroup()} disabled={creating}>
                {creating ? "만드는 중…" : "그룹 만들기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
