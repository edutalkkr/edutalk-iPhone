import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Teacher } from "../../types";
import type { MessageResponse, ServerRoom, ServerUser } from "../../types/api";
import api from "../../services/api";
import { socket } from "../../services/socket";
import { call } from "../../lib/tauri";
import { isTauriDesktop } from "../../lib/edition";
import { scanDlp } from "./MemoPane";
import { TemplatesBar } from "../ComposerExtras";
import BzTooltip from "../ui/BzTooltip";

const PAGE_SIZE = 50;

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dateText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function safeName(name: string): string {
  return (name || "대화").replace(/[\\/:*?"<>|]/g, "_").slice(0, 48);
}

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

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
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"txt" | "pdf" | "enc">("txt");
  const [exportPassword, setExportPassword] = useState("");
  const [exportPassword2, setExportPassword2] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [groupLoaded, setGroupLoaded] = useState<Record<string, boolean>>({});
  const [groupHasMore, setGroupHasMore] = useState<Record<string, boolean>>({});
  const [groupLoadingOlder, setGroupLoadingOlder] = useState<Record<string, boolean>>({});
  const [dmVisible, setDmVisible] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dmScrollRef = useRef<HTMLDivElement | null>(null);
  const groupsRef = useRef<ServerRoom[]>([]);
  const myServerIdRef = useRef<number | null>(null);
  const activeGroupRef = useRef<string | null>(null);
  const nearBottomRef = useRef(true);
  const dmNearBottomRef = useRef(true);
  const initialRoomRef = useRef<string | null>(null);
  const initialDmRef = useRef<string | null>(null);
  const pendingGroupPrepend = useRef<{ height: number; top: number } | null>(null);
  const pendingDmPrepend = useRef<{ height: number; top: number } | null>(null);
  const groupLoadingRef = useRef<Set<string>>(new Set());
  const dmPagingRef = useRef(false);
  const toastRef = useRef(p.onToast);
  toastRef.current = p.onToast;
  activeGroupRef.current = activeGroupId;
  groupsRef.current = groups;
  myServerIdRef.current = myServerId;

  const activeGroup = groups.find((g) => g.id === activeGroupId) || null;
  const activeGroupMessages = activeGroupId ? groupMsgs[activeGroupId] ?? [] : [];
  const visibleMsgs = useMemo(() => (msgs.length > dmVisible ? msgs.slice(-dmVisible) : msgs), [msgs, dmVisible]);

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

  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    if (pendingGroupPrepend.current) {
      const prev = pendingGroupPrepend.current;
      pendingGroupPrepend.current = null;
      box.scrollTop = box.scrollHeight - prev.height + prev.top;
      return;
    }
    if (!activeGroupId) return;
    if (initialRoomRef.current !== activeGroupId || nearBottomRef.current) {
      box.scrollTop = box.scrollHeight;
      initialRoomRef.current = activeGroupId;
    }
  }, [activeGroupId, activeGroupMessages.length]);

  useLayoutEffect(() => {
    const box = dmScrollRef.current;
    if (!box || !p.peer) return;
    if (pendingDmPrepend.current) {
      const prev = pendingDmPrepend.current;
      pendingDmPrepend.current = null;
      box.scrollTop = box.scrollHeight - prev.height + prev.top;
      dmPagingRef.current = false;
      return;
    }
    if (initialDmRef.current !== p.peer.id || dmNearBottomRef.current) {
      box.scrollTop = box.scrollHeight;
      initialDmRef.current = p.peer.id;
    }
  }, [p.peer?.id, msgs.length, dmVisible]);

  useEffect(() => {
    // 다른 사람과의 대화로 바뀌면 처음 50개부터 다시 보여 준다.
    setDmVisible(PAGE_SIZE);
    dmNearBottomRef.current = true;
    initialDmRef.current = null;
    dmPagingRef.current = false;
  }, [p.peer?.id]);

  const loadOlderGroup = async (roomId: string) => {
    const list = groupMsgs[roomId] ?? [];
    const oldest = list[0];
    if (!oldest || groupLoadingRef.current.has(roomId) || groupLoadingOlder[roomId] || groupHasMore[roomId] === false) return;
    groupLoadingRef.current.add(roomId);
    const box = scrollRef.current;
    pendingGroupPrepend.current = box ? { height: box.scrollHeight, top: box.scrollTop } : { height: 0, top: 0 };
    setGroupLoadingOlder((s) => ({ ...s, [roomId]: true }));
    try {
      const res = await api.getRoomMessages(roomId, PAGE_SIZE, Number(oldest.id));
      if (!res.ok || !res.data) {
        pendingGroupPrepend.current = null;
        setGroupError(res.error || "이전 메시지를 불러오지 못했어요.");
        return;
      }
      const have = new Set(list.map((m) => Number(m.id)));
      const older = res.data.filter((m) => !have.has(Number(m.id)));
      if (older.length) {
        setGroupMsgs((prev) => ({ ...prev, [roomId]: [...older, ...(prev[roomId] ?? [])] }));
      } else {
        pendingGroupPrepend.current = null;
      }
      setGroupHasMore((s) => ({ ...s, [roomId]: res.data!.length >= PAGE_SIZE && older.length > 0 }));
    } catch {
      pendingGroupPrepend.current = null;
      setGroupError("이전 메시지를 불러오지 못했어요. 서버 연결을 확인해 주세요.");
    } finally {
      groupLoadingRef.current.delete(roomId);
      setGroupLoadingOlder((s) => ({ ...s, [roomId]: false }));
    }
  };

  const onGroupScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    nearBottomRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 72;
    if (box.scrollTop < 28 && activeGroupId) void loadOlderGroup(activeGroupId);
  };

  const loadOlderDm = () => {
    if (dmPagingRef.current || dmVisible >= msgs.length) return;
    dmPagingRef.current = true;
    const box = dmScrollRef.current;
    pendingDmPrepend.current = box ? { height: box.scrollHeight, top: box.scrollTop } : { height: 0, top: 0 };
    setDmVisible((n) => Math.min(msgs.length, n + PAGE_SIZE));
  };

  const onDmScroll = () => {
    const box = dmScrollRef.current;
    if (!box) return;
    dmNearBottomRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 72;
    if (box.scrollTop < 28) loadOlderDm();
  };

  const openGroup = async (room: ServerRoom, force = false) => {
    setActiveGroupId(room.id);
    setGroupWarn("");
    setGroupError("");
    initialRoomRef.current = null;
    nearBottomRef.current = true;
    if (!groupLoaded[room.id] || force) {
      const res = await api.getRoomMessages(room.id, PAGE_SIZE);
      if (res.ok && res.data) {
        const incoming = res.data;
        setGroupMsgs((prev) => {
          const current = prev[room.id] ?? [];
          if (force || !current.length) return { ...prev, [room.id]: incoming };
          const have = new Set(current.map((m) => Number(m.id)));
          const older = incoming.filter((m) => !have.has(Number(m.id)));
          return { ...prev, [room.id]: [...older, ...current] };
        });
        setGroupLoaded((s) => ({ ...s, [room.id]: true }));
        setGroupHasMore((s) => ({ ...s, [room.id]: incoming.length >= PAGE_SIZE }));
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
    if (r.ok) {
      dmNearBottomRef.current = true;
      setDraft("");
      setWarn("");
    } else p.onToast(r.error ?? "보내지 못했어요.");
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
        nearBottomRef.current = true;
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
      initialRoomRef.current = null;
      nearBottomRef.current = true;
      p.onToast(`그룹 대화 '${room.name}'을(를) 만들었어요.`);
      const msgRes = await api.getRoomMessages(room.id, PAGE_SIZE);
      if (msgRes.ok && msgRes.data) {
        setGroupMsgs((prev) => ({ ...prev, [room.id]: msgRes.data! }));
        setGroupLoaded((s) => ({ ...s, [room.id]: true }));
        setGroupHasMore((s) => ({ ...s, [room.id]: msgRes.data!.length >= PAGE_SIZE }));
      }
      void socket.joinRoom(room.id).catch(() => undefined);
    } catch {
      setCreateError("그룹을 만들지 못했어요. 서버 연결을 확인해 주세요.");
    } finally {
      setCreating(false);
    }
  };

  type ExportLine = { at: string; who: string; body: string };
  const exportTitle = activeGroup?.name || p.peer?.name || "대화";

  const openExport = () => {
    setExportFormat("txt");
    setExportPassword("");
    setExportPassword2("");
    setExportError("");
    setExportOpen(true);
  };

  const collectExport = async (): Promise<{ lines: ExportLine[]; partial: boolean }> => {
    if (activeGroup) {
      let partial = false;
      let list = groupMsgs[activeGroup.id] ?? [];
      try {
        const fetched: MessageResponse[] = [];
        let before: number | undefined;
        for (let page = 0; page < 50; page += 1) {
          const res = await api.getRoomMessages(activeGroup.id, 200, before);
          if (!res.ok || !res.data) throw new Error(res.error || "메시지를 불러오지 못했어요.");
          const chunk = res.data;
          if (!chunk.length) break;
          fetched.unshift(...chunk);
          if (chunk.length < 200) break;
          before = Number(chunk[0].id);
        }
        if (fetched.length) list = fetched;
      } catch {
        partial = list.length > 0;
        if (!list.length) throw new Error("대화를 불러오지 못했어요. 서버 연결을 확인해 주세요.");
      }
      const lines = list
        .map((m) => {
          const who = Number(m.sender_id) === Number(myServerId)
            ? "나"
            : (m.sender_name || memberLabel(m.sender_id, serverUsers));
          const body = [m.content, m.file_name ? `[첨부] ${m.file_name}` : ""].filter(Boolean).join("\n");
          return { at: m.created_at, who, body };
        })
        .filter((line) => line.body.trim());
      return { lines, partial };
    }
    if (p.peer) {
      const lines = (p.chats[p.peer.id] ?? []).map((m) => ({
        at: m.createdAt,
        who: m.mine ? "나" : p.peer!.name,
        body: m.body,
      }));
      return { lines, partial: false };
    }
    return { lines: [], partial: false };
  };

  const transcriptText = (lines: ExportLine[], partial: boolean): string => {
    const header = [
      "브리즈 대화 내보내기",
      `대화: ${exportTitle}`,
      `내보낸 시각: ${dateText(new Date().toISOString())}`,
      partial ? "안내: 서버 연결이 끊겨 현재 불러온 메시지만 담았어요." : "",
      "────────────────────────────",
      "",
    ].filter(Boolean);
    const body = lines.map((line) => `[${dateText(line.at)}] ${line.who}\n${line.body}`);
    return [...header, ...body].join("\n\n") + "\n";
  };

  const saveTextFile = async (filename: string, content: string): Promise<boolean> => {
    if (isTauriDesktop()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: filename,
        filters: [
          { name: filename.endsWith(".bzchat") ? "브리즈 암호화 대화" : "텍스트", extensions: [filename.endsWith(".bzchat") ? "bzchat" : "txt"] },
        ],
      });
      if (!path) return false;
      await call("export_write", { path, content });
      return true;
    }
    const blob = new Blob([content], { type: filename.endsWith(".bzchat") ? "application/json;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  };

  const printPdf = (lines: ExportLine[], partial: boolean) => {
    const rows = lines.map((line) => `
      <article>
        <div class="meta"><strong>${esc(line.who)}</strong><span>${esc(dateText(line.at))}</span></div>
        <div class="body">${esc(line.body).replace(/\n/g, "<br>")}</div>
      </article>`).join("");
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(exportTitle)} 대화</title>
      <style>
        @page { margin: 18mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #0f172a; font-family: "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size: 11pt; line-height: 1.65; }
        h1 { margin: 0 0 6px; font-size: 20pt; letter-spacing: -0.04em; }
        .head { border-bottom: 1px solid #dbe6f2; padding-bottom: 12px; margin-bottom: 18px; }
        .head p { margin: 2px 0; color: #64748b; font-size: 9.5pt; }
        .notice { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #f1f8fe; color: #0069a8; font-size: 9.5pt; }
        article { break-inside: avoid; padding: 8px 0 10px; border-bottom: 1px solid #eef3f8; }
        .meta { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 3px; }
        .meta strong { color: #0069a8; }
        .meta span { color: #94a3b8; font-size: 8.5pt; white-space: nowrap; }
        .body { white-space: normal; word-break: break-word; }
      </style></head><body>
      <div class="head"><h1>${esc(exportTitle)}</h1><p>브리즈 대화 내보내기 · ${esc(dateText(new Date().toISOString()))}</p>
      ${partial ? '<p class="notice">서버 연결이 끊겨 현재 불러온 메시지만 담았어요.</p>' : ""}</div>
      ${rows || "<p>저장할 메시지가 없어요.</p>"}
      </body></html>`;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:800px;height:1000px;opacity:0;pointer-events:none;border:0;";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      setExportError("PDF 인쇄 창을 열지 못했어요.");
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    window.setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        p.onToast("인쇄 창에서 'PDF로 저장'을 골라 주세요.");
      } catch {
        setExportError("PDF 인쇄 창을 열지 못했어요.");
      }
      window.setTimeout(() => frame.remove(), 120000);
    }, 250);
  };

  const runExport = async () => {
    setExportError("");
    if (exportFormat === "enc") {
      if (exportPassword.length < 8) { setExportError("암호는 8자 이상으로 정해 주세요."); return; }
      if (exportPassword !== exportPassword2) { setExportError("암호가 서로 달라요. 다시 확인해 주세요."); return; }
    }
    setExporting(true);
    try {
      const { lines, partial } = await collectExport();
      if (!lines.length) { setExportError("저장할 메시지가 없어요."); return; }
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `${safeName(exportTitle)}_${stamp}`;
      if (exportFormat === "pdf") {
        printPdf(lines, partial);
        setExportOpen(false);
        return;
      }
      const text = transcriptText(lines, partial);
      if (exportFormat === "txt") {
        const saved = await saveTextFile(`${filename}.txt`, text);
        if (!saved) return;
        p.onToast(partial ? "현재 불러온 메시지만 TXT로 저장했어요." : "대화를 TXT로 저장했어요.");
        setExportOpen(false);
        return;
      }
      // 암호화 파일: 실제 AES-GCM 암호문만 저장한다 (평문은 파일에 남기지 않는다).
      const encoder = new TextEncoder();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const baseKey = await crypto.subtle.importKey("raw", encoder.encode(exportPassword), "PBKDF2", false, ["deriveKey"]);
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
      );
      const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(text)));
      const payload = {
        format: "breeze-chat",
        version: 1,
        kdf: "PBKDF2-SHA256",
        iterations: 210000,
        salt: base64(salt),
        iv: base64(iv),
        data: base64(encrypted),
        createdAt: new Date().toISOString(),
      };
      const saved = await saveTextFile(`${filename}.bzchat`, JSON.stringify(payload, null, 2));
      if (!saved) return;
      p.onToast("대화를 암호화 파일(.bzchat)로 저장했어요. 암호를 잊으면 열 수 없어요.");
      setExportOpen(false);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "내보내지 못했어요.");
    } finally {
      setExporting(false);
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
                onClick={() => void openGroup(activeGroup, true)}
                title="그룹 메시지 새로고침"
              >
                새로고침
              </button>
              <button
                className="shrink-0 edu-ghost !py-1 !px-2 !text-[11px]"
                onClick={openExport}
                title="이 그룹 대화를 내보내기"
              >
                내보내기
              </button>
            </div>
            <div ref={scrollRef} onScroll={onGroupScroll} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 bg-[#FAFAFD]">
              <div className="pb-1 text-center text-[10.5px] text-edu-muted">
                {groupLoadingOlder[activeGroup.id]
                  ? "이전 메시지를 불러오는 중…"
                  : groupHasMore[activeGroup.id]
                    ? "위로 올리면 이전 메시지를 불러와요"
                    : activeGroupMessages.length > 0
                      ? "대화의 시작이에요"
                      : ""}
              </div>
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
              <span className="min-w-0 truncate">{p.peer.name}</span>
              <span className="hidden text-[12px] font-medium text-edu-sub sm:inline">· {p.peer.dept} · {p.peer.ip}</span>
              <button
                className="ml-auto shrink-0 edu-ghost !py-1 !px-2 !text-[11px]"
                onClick={openExport}
                title="이 대화를 내보내기"
              >
                내보내기
              </button>
            </div>
            <div ref={dmScrollRef} onScroll={onDmScroll} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 bg-[#FAFAFD]">
              {msgs.length > dmVisible && (
                <button
                  type="button"
                  className="mx-auto rounded-full bg-edu-chip px-3 py-1 text-[10.5px] font-bold text-edu-sub hover:bg-edu-soft"
                  onClick={loadOlderDm}
                >
                  이전 대화 {msgs.length - dmVisible}개 더 보기
                </button>
              )}
              {msgs.length === 0 && <div className="m-auto text-edu-sub text-[13px]">첫 메시지를 남겨 보세요.</div>}
              {visibleMsgs.map((m) => (
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

      {exportOpen && (
        <div
          className="fixed inset-0 z-[1200] grid place-items-center bg-[rgba(15,23,42,0.46)] p-4 backdrop-blur-[3px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-export-title"
          onClick={() => { if (!exporting) setExportOpen(false); }}
        >
          <div className="w-full max-w-[440px] rounded-2xl border border-edu-line bg-edu-surface p-4 shadow-2xl anim-pop" onClick={(e) => e.stopPropagation()}>
            <div id="chat-export-title" className="text-[16px] font-extrabold text-edu-ink">대화 내보내기</div>
            <div className="mt-1 text-[12px] leading-relaxed text-edu-sub">
              <strong className="text-edu-ink">{exportTitle}</strong> 대화를 내 PC에 저장해요.
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {([
                ["txt", "TXT", "텍스트 파일"],
                ["pdf", "PDF", "인쇄 창에서 저장"],
                ["enc", "암호화", ".bzchat 파일"],
              ] as const).map(([id, label, hint]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setExportFormat(id); setExportError(""); }}
                  className={`rounded-xl border px-2 py-2 text-center transition-colors ${exportFormat === id ? "border-edu-blue bg-edu-soft text-edu-strong" : "border-edu-line bg-edu-surface text-edu-sub hover:bg-edu-chip"}`}
                >
                  <span className="block text-[12.5px] font-extrabold">{label}</span>
                  <span className="mt-0.5 block text-[9.5px] opacity-75">{hint}</span>
                </button>
              ))}
            </div>
            {exportFormat === "enc" && (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  className="edu-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="암호 (8자 이상)"
                  value={exportPassword}
                  onChange={(e) => { setExportPassword(e.target.value); setExportError(""); }}
                />
                <input
                  className="edu-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="암호 확인"
                  value={exportPassword2}
                  onChange={(e) => { setExportPassword2(e.target.value); setExportError(""); }}
                />
                <div className="text-[10.5px] leading-relaxed text-edu-muted sm:col-span-2">
                  AES-GCM으로 암호화해 저장해요. 암호를 잊으면 열 수 없어요.
                </div>
              </div>
            )}
            {exportFormat === "pdf" && (
              <div className="mt-2 rounded-lg bg-edu-soft px-2.5 py-2 text-[10.5px] leading-relaxed text-edu-sub">
                인쇄 창에서 프린터를 &lsquo;Microsoft Print to PDF&rsquo;로 골라 저장해 주세요.
              </div>
            )}
            {exportError && <div className="mt-2 rounded-lg bg-[#FFF0F1] px-2.5 py-2 text-[12px] font-semibold text-[#B42318]">{exportError}</div>}
            <div className="mt-3 flex gap-2">
              <button className="edu-ghost flex-1 !py-2.5" onClick={() => setExportOpen(false)} disabled={exporting}>취소</button>
              <button className="edu-btn flex-1 !py-2.5" onClick={() => void runExport()} disabled={exporting}>
                {exporting ? "준비하는 중…" : exportFormat === "pdf" ? "PDF 인쇄" : "내보내기"}
              </button>
            </div>
          </div>
        </div>
      )}

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
