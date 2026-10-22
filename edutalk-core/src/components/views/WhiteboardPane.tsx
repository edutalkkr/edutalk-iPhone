// 협업 보드 (2026-10)
//  · 좌석 배치·모둠 편성·시험 감독 배치를 여러 교사가 실시간으로 함께 편집한다.
//  · 이동/추가는 Socket.io로 즉시 공유하고, 연결이 끊기면 REST 저장으로 자동 대체한다.
//  · 서버가 없을 때는 이 PC에만 저장되는 오프라인 보드로 계속 사용할 수 있다.
//  · 학생 계정은 서버에서 차단된다.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { WhiteboardBoard, WhiteboardData, WhiteboardItem, WhiteboardItemType, WhiteboardKind, WhiteboardMeta } from "../../types";
import { api } from "../../services/api";
import { socket } from "../../services/socket";
import { storeGet, storeSet } from "../../lib/localStore";
import { bzConfirm } from "../ui/BzDialog";
import BzTooltip from "../ui/BzTooltip";
import { usePresence } from "../../lib/usePresence";
import {
  IconCloudIcon,
  IconGrid,
  IconPlus,
  IconStickyNote,
  IconTrash,
  IconUsers,
  IconX,
} from "../ui/BzIcons";

const LOCAL_KEY = "whiteboards-local";
const KINDS: { value: WhiteboardKind; label: string; icon: string }[] = [
  { value: "seating", label: "자리 배치", icon: "🪑" },
  { value: "groups", label: "모둠 편성", icon: "👥" },
  { value: "supervision", label: "감독 배치", icon: "📋" },
  { value: "free", label: "자유 보드", icon: "🎨" },
];
const KIND_LABEL: Record<WhiteboardKind, string> = {
  seating: "자리 배치",
  groups: "모둠 편성",
  supervision: "감독 배치",
  free: "자유 보드",
};
const COLORS = ["#0082c8", "#7c5cff", "#22b07d", "#f59e0b", "#ec4899", "#64748b", "#ef4444", "#0ea5e9"];
const ITEM_LABEL: Record<WhiteboardItemType, string> = { seat: "자리", group: "모둠", table: "감독", label: "메모" };

interface Props {
  meName: string;
  localIsAdmin?: boolean;
  onToast: (t: string) => void;
}

function nowLabel() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function templateData(kind: WhiteboardKind): WhiteboardData {
  if (kind === "groups") {
    return {
      background: "grid",
      items: [0, 1, 2, 3].map((i) => ({
        id: `group-${Date.now()}-${i}`,
        type: "group" as const,
        x: 40 + (i % 2) * 250,
        y: 40 + Math.floor(i / 2) * 190,
        w: 210, h: 140,
        label: `${i + 1}모둠`,
        sublabel: "모둠원 이름을 적어 주세요",
        color: COLORS[i],
      })),
    };
  }
  if (kind === "supervision") {
    return {
      background: "grid",
      items: [0, 1, 2, 3, 4, 5].map((i) => ({
        id: `supervision-${Date.now()}-${i}`,
        type: "table" as const,
        x: 40 + (i % 3) * 180,
        y: 40 + Math.floor(i / 3) * 140,
        w: 150, h: 90,
        label: `${i + 1}감독`,
        sublabel: "교실 · 감독 교사",
        color: "#64748b",
      })),
    };
  }
  if (kind === "seating") {
    return {
      background: "grid",
      items: Array.from({ length: 12 }, (_, i) => ({
        id: `seat-${Date.now()}-${i}`,
        type: "seat" as const,
        x: 40 + (i % 4) * 140,
        y: 40 + Math.floor(i / 4) * 110,
        w: 112, h: 82,
        label: `${i + 1}`,
        sublabel: "학생",
        color: "#0082c8",
      })),
    };
  }
  return { background: "grid", items: [] };
}

function localBoard(title: string, kind: WhiteboardKind, meName: string): WhiteboardBoard {
  const stamp = nowLabel();
  return {
    id: `local-${Date.now()}`,
    title,
    kind,
    data: templateData(kind),
    version: 1,
    createdByName: meName,
    updatedByName: meName,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function toMeta(b: WhiteboardBoard): WhiteboardMeta {
  return {
    id: b.id, title: b.title, kind: b.kind, version: b.version,
    createdByName: b.createdByName, updatedByName: b.updatedByName,
    createdAt: b.createdAt, updatedAt: b.updatedAt,
  };
}

export default function WhiteboardPane({ meName, localIsAdmin = false, onToast }: Props) {
  const [boards, setBoards] = useState<WhiteboardMeta[]>([]);
  const [current, setCurrent] = useState<WhiteboardBoard | null>(null);
  const [data, setData] = useState<WhiteboardData | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [isAdmin, setIsAdmin] = useState(localIsAdmin);
  const [realtime, setRealtime] = useState(false);
  const [presence, setPresence] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<WhiteboardKind>("seating");
  const [dragging, setDragging] = useState(false);
  const [leavingItemId, setLeavingItemId] = useState<string | null>(null);
  const [remoteNotice, setRemoteNotice] = useState("");

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef<WhiteboardData | null>(null);
  const currentRef = useRef<WhiteboardBoard | null>(null);
  const versionRef = useRef(1);
  const dirtyRef = useRef(false);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const persistTimer = useRef<number | null>(null);
  const localBoardsRef = useRef<WhiteboardBoard[]>([]);
  const lastItem = useRef<WhiteboardItem | null>(null);
  const selectedItem = data?.items.find((it) => it.id === selectedItemId) ?? null;
  const itemPresence = usePresence(Boolean(selectedItem), 140);

  const setBoard = useCallback((board: WhiteboardBoard | null) => {
    currentRef.current = board;
    setCurrent(board);
    versionRef.current = board?.version || 1;
    dataRef.current = board?.data || null;
    setData(board?.data || null);
    dirtyRef.current = false;
    setDirty(false);
    setSelectedItemId(null);
    setLeavingItemId(null);
    lastItem.current = null;
  }, []);

  const upsertMeta = useCallback((board: WhiteboardBoard) => {
    setBoards((prev) => {
      const meta = toMeta(board);
      const ix = prev.findIndex((b) => b.id === board.id);
      if (ix < 0) return [meta, ...prev];
      return prev.map((b) => b.id === board.id ? meta : b);
    });
  }, []);

  const saveLocalBoards = useCallback(async (next: WhiteboardBoard[]) => {
    localBoardsRef.current = next;
    await storeSet(LOCAL_KEY, next);
  }, []);

  const loadLocal = useCallback(async () => {
    const saved = await storeGet<WhiteboardBoard[]>(LOCAL_KEY);
    let list = Array.isArray(saved) ? saved : [];
    if (!list.length) {
      const first = localBoard("우리 반 자리 배치", "seating", meName);
      list = [first];
      await saveLocalBoards(list);
    }
    localBoardsRef.current = list;
    setBoards(list.map(toMeta));
    setOffline(true);
    setBoard(list[0] || null);
  }, [meName, saveLocalBoards, setBoard]);

  const openBoard = useCallback(async (id: string) => {
    const local = localBoardsRef.current.find((b) => b.id === id);
    if (local) {
      setBoard(local);
      setRemoteNotice("");
      return;
    }
    if (offline) {
      onToast("오프라인에서는 이 PC에 저장한 보드만 열 수 있어요.");
      return;
    }
    try {
      const res = await api.getWhiteboard(id);
      if (res.ok && res.data?.board) {
        setBoard(res.data.board);
        upsertMeta(res.data.board);
        setRemoteNotice("");
      } else {
        onToast(res.error || "보드를 불러오지 못했어요.");
      }
    } catch {
      onToast("서버에 닿지 않아 보드를 불러오지 못했어요.");
    }
  }, [offline, onToast, setBoard, upsertMeta]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      try {
        const me = await api.getMe();
        if (me.ok && me.data?.user) {
          setIsAdmin(localIsAdmin || String(me.data.user.role || "").toUpperCase() === "ADMIN");
        }
      } catch { /* 서버 계정 확인 실패는 무시 */ }
      const res = await api.getWhiteboards();
      if (res.ok && res.data?.boards) {
        setBoards(res.data.boards);
        setOffline(false);
        if (res.data.boards[0]) {
          const first = res.data.boards[0];
          const full = await api.getWhiteboard(first.id);
          if (full.ok && full.data?.board) {
            setBoard(full.data.board);
          } else {
            setBoard(null);
          }
        } else {
          setBoard(null);
        }
      } else {
        await loadLocal();
      }
    } catch {
      await loadLocal();
    } finally {
      setLoading(false);
    }
  }, [loadLocal, localIsAdmin, setBoard]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(async (nextData: WhiteboardData) => {
    const board = currentRef.current;
    if (!board) return;
    if (offline || board.id.startsWith("local-")) {
      const updated: WhiteboardBoard = {
        ...board, data: nextData, version: board.version + 1,
        updatedByName: meName, updatedAt: nowLabel(),
      };
      const next = localBoardsRef.current.map((b) => b.id === board.id ? updated : b);
      if (!next.some((b) => b.id === board.id)) next.unshift(updated);
      await saveLocalBoards(next);
      setBoard(updated);
      setBoards(next.map(toMeta));
      setRemoteNotice("");
      return;
    }
    setSaving(true);
    try {
      const r = await socket.sendWhiteboardUpdate(board.id, nextData, versionRef.current);
      if (r.conflict && r.board) {
        setBoard(r.board);
        upsertMeta(r.board);
        setRemoteNotice("다른 선생님이 먼저 저장했어요. 최신 보드를 불러왔어요.");
        onToast("다른 선생님이 먼저 저장해 최신 보드를 불러왔어요.");
        return;
      }
      if (r.board) {
        currentRef.current = r.board;
        setCurrent(r.board);
        versionRef.current = r.board.version;
        dataRef.current = r.board.data;
        setData(r.board.data);
        dirtyRef.current = false;
        setDirty(false);
        upsertMeta(r.board);
        setRemoteNotice("");
      }
    } catch {
      // 소켓이 끊겼을 때 REST로 한 번 더 시도한다.
      try {
        const res = await api.updateWhiteboard(board.id, nextData, versionRef.current);
        if (res.ok && res.data?.board) {
          setBoard(res.data.board);
          upsertMeta(res.data.board);
        } else {
          const fresh = await api.getWhiteboard(board.id);
          if (fresh.ok && fresh.data?.board) {
            setBoard(fresh.data.board);
            upsertMeta(fresh.data.board);
            setRemoteNotice("다른 선생님이 먼저 저장했어요. 최신 보드를 불러왔어요.");
          } else {
            onToast(res.error || "보드를 저장하지 못했어요.");
          }
        }
      } catch {
        onToast("서버에 닿지 않아 보드를 저장하지 못했어요.");
      }
    } finally {
      setSaving(false);
    }
  }, [meName, offline, onToast, saveLocalBoards, setBoard, upsertMeta]);

  const schedulePersist = useCallback((nextData: WhiteboardData) => {
    dataRef.current = nextData;
    dirtyRef.current = true;
    setDirty(true);
    if (persistTimer.current != null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      void persist(dataRef.current || nextData);
    }, 110);
  }, [persist]);

  const applyData = useCallback((next: WhiteboardData) => {
    dataRef.current = next;
    setData(next);
    schedulePersist(next);
  }, [schedulePersist]);

  useEffect(() => () => {
    if (persistTimer.current != null) window.clearTimeout(persistTimer.current);
  }, []);

  // 실시간 이벤트 구독
  useEffect(() => {
    const offUpdated = socket.on("whiteboard:updated", (ev) => {
      const board = currentRef.current;
      if (!board || ev.boardId !== board.id) return;
      if (dragRef.current) return;
      if (dirtyRef.current) {
        setRemoteNotice("다른 선생님이 보드를 수정했어요. 저장하면 최신 내용과 합쳐져요.");
        return;
      }
      const next: WhiteboardBoard = {
        ...board,
        data: ev.data,
        version: ev.version,
        updatedByName: ev.updatedByName,
        updatedAt: ev.updatedAt,
      };
      currentRef.current = next;
      setCurrent(next);
      versionRef.current = next.version;
      dataRef.current = next.data;
      setData(next.data);
      upsertMeta(next);
      setRemoteNotice("");
    });
    const offPresence = socket.on("whiteboard:presence", (ev) => {
      if (currentRef.current && ev.boardId === currentRef.current.id) setPresence(Number(ev.count) || 0);
    });
    const offDeleted = socket.on("whiteboard:deleted", (ev) => {
      if (currentRef.current && ev.boardId === currentRef.current.id) {
        setBoard(null);
        setBoards((prev) => prev.filter((b) => b.id !== ev.boardId));
        onToast("다른 선생님이 보드를 삭제했어요.");
      }
    });
    return () => { offUpdated(); offPresence(); offDeleted(); };
  }, [onToast, setBoard, upsertMeta]);

  // 보드에 입장/퇴장 (소켓 재연결 시 자동 재입장)
  useEffect(() => {
    const board = current;
    if (!board || offline || board.id.startsWith("local-")) {
      setRealtime(false);
      setPresence(0);
      return;
    }
    let alive = true;
    const join = () => {
      socket.joinWhiteboard(board.id)
        .then(() => { if (alive) setRealtime(true); })
        .catch(() => { if (alive) setRealtime(false); });
    };
    join();
    const off = socket.on("connect", join);
    return () => {
      alive = false;
      off();
      void socket.leaveWhiteboard(board.id).catch(() => undefined);
      setRealtime(false);
      setPresence(0);
    };
  }, [current?.id, offline]);

  const addItem = (type: WhiteboardItemType) => {
    if (!data) return;
    const n = data.items.length;
    const item: WhiteboardItem = {
      id: `it-${Date.now()}-${n}`,
      type,
      x: 50 + (n % 5) * 24,
      y: 50 + (n % 4) * 24,
      w: type === "group" ? 210 : type === "table" ? 150 : 120,
      h: type === "group" ? 140 : type === "table" ? 90 : 84,
      label: type === "group" ? "새 모둠" : type === "table" ? "새 감독" : type === "label" ? "메모" : "새 자리",
      sublabel: type === "seat" ? "학생" : "",
      color: COLORS[n % COLORS.length],
    };
    applyData({ ...data, items: [...data.items, item] });
    setSelectedItemId(item.id);
  };

  const patchItem = (id: string, patch: Partial<WhiteboardItem>) => {
    if (!data) return;
    applyData({ ...data, items: data.items.map((it) => it.id === id ? { ...it, ...patch } : it) });
  };

  const removeItem = (id: string) => {
    const boardId = currentRef.current?.id;
    setLeavingItemId(id);
    window.setTimeout(() => {
      if (currentRef.current?.id !== boardId) return;
      const currentData = dataRef.current;
      setLeavingItemId(null);
      setSelectedItemId(null);
      if (!currentData) return;
      applyData({ ...currentData, items: currentData.items.filter((it) => it.id !== id) });
    }, 160);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, item: WhiteboardItem) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedItemId(item.id);
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저 */ }
    dragRef.current = {
      id: item.id, startX: e.clientX, startY: e.clientY,
      origX: item.x, origY: item.y, moved: false,
    };
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !dataRef.current) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    const canvas = canvasRef.current;
    const maxX = canvas ? Math.max(0, canvas.clientWidth - 40) : 3600;
    const maxY = canvas ? Math.max(0, canvas.clientHeight - 40) : 3600;
    const next = {
      ...dataRef.current,
      items: dataRef.current.items.map((it) => it.id === drag.id ? {
        ...it,
        x: Math.max(0, Math.min(maxX, Math.round(drag.origX + dx))),
        y: Math.max(0, Math.min(maxY, Math.round(drag.origY + dy))),
      } : it),
    };
    dataRef.current = next;
    setData(next);
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    const moved = dragRef.current.moved;
    dragRef.current = null;
    setDragging(false);
    if (moved && dataRef.current) schedulePersist(dataRef.current);
  };

  const createBoard = async () => {
    if (!newTitle.trim()) return onToast("보드 이름을 적어 주세요.");
    const title = newTitle.trim();
    try {
      const res = await api.createWhiteboard(title, newKind);
      if (res.ok && res.data?.board) {
        setBoards((prev) => [toMeta(res.data!.board), ...prev]);
        setBoard(res.data.board);
        setOffline(false);
        setNewOpen(false);
        setNewTitle("");
        onToast("새 보드를 만들었어요. 선생님들을 초대해 함께 편집해 보세요.");
      } else {
        await createLocal(title, "서버에 닿지 않아 이 PC에만 보드를 만들었어요.");
      }
    } catch {
      await createLocal(title, "서버에 닿지 않아 이 PC에만 보드를 만들었어요.");
    }
  };

  const createLocal = async (title: string, message: string) => {
    const board = localBoard(title, newKind, meName);
    const next = [board, ...localBoardsRef.current];
    await saveLocalBoards(next);
    setBoards(next.map(toMeta));
    setBoard(board);
    setOffline(true);
    setNewOpen(false);
    setNewTitle("");
    onToast(message);
  };

  const deleteBoard = async () => {
    if (!current) return;
    const ok = await bzConfirm({
      title: "이 보드를 지울까요?",
      message: "함께 편집하던 선생님 화면에서도 사라져요. 되돌릴 수 없어요.",
      confirmText: "보드 지우기",
      danger: true,
    });
    if (!ok) return;
    if (current.id.startsWith("local-")) {
      const next = localBoardsRef.current.filter((b) => b.id !== current.id);
      await saveLocalBoards(next);
      setBoards(next.map(toMeta));
      setBoard(next[0] || null);
      onToast("이 PC의 보드를 지웠어요.");
      return;
    }
    const res = await api.deleteWhiteboard(current.id);
    if (res.ok) {
      const next = boards.filter((b) => b.id !== current.id);
      setBoards(next);
      if (next[0]) await openBoard(next[0].id);
      else setBoard(null);
      onToast("보드를 지웠어요.");
    } else {
      onToast(res.error || "보드를 지우지 못했어요.");
    }
  };

  const canDelete = current && (current.id.startsWith("local-") || isAdmin || current.createdByName === meName);
  const selected = selectedItem;
  if (selected) lastItem.current = selected;
  const itemView = selected ?? lastItem.current;

  if (loading) {
    return <div className="edu-card p-8 text-center text-[13px] text-edu-sub anim-card">보드를 불러오는 중…</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="edu-card p-3.5 anim-card wb-hero">
        <div className="flex items-start gap-2">
          <div className="wb-hero-icon"><IconGrid size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-[15px]">함께 그리는 교실 보드</div>
            <div className="text-[12.5px] text-edu-sub mt-0.5">
              자리 배치·모둠 편성·시험 감독을 여러 선생님이 실시간으로 함께 맞춰요.
            </div>
          </div>
          <span className={`wb-live ${realtime ? "on" : ""}`}>
            <span className="wb-live-dot" />
            {realtime ? `실시간 · ${presence || 1}명` : offline ? "오프라인" : "저장 모드"}
          </span>
        </div>
        {remoteNotice && <div className="wb-remote-note mt-2">{remoteNotice}</div>}
      </div>

      <div className="edu-card p-3 anim-card">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-extrabold text-[13.5px]">보드 목록</span>
          <span className="text-[11.5px] text-edu-sub">{boards.length}개</span>
          <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px] ml-auto inline-flex items-center gap-1" onClick={() => setNewOpen((v) => !v)}>
            <IconPlus size={13} /> 새 보드
          </button>
        </div>
        <div className="wb-board-list mt-2">
          {boards.length === 0 && <div className="text-[12.5px] text-edu-sub py-3">아직 보드가 없어요. [새 보드]로 시작해 보세요.</div>}
          {boards.map((b) => (
            <button key={b.id} className={`wb-board-chip ${current?.id === b.id ? "active" : ""}`} onClick={() => void openBoard(b.id)}>
              <span>{KIND_LABEL[b.kind] || "보드"}</span>
              <b className="truncate">{b.title}</b>
              <em>v{b.version}</em>
            </button>
          ))}
        </div>
        <div className={`wb-new-wrap ${newOpen ? "is-open" : ""}`}>
          <div className="wb-new-inner">
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px_auto] gap-2 mt-2.5">
              <input className="edu-input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={60} placeholder="보드 이름 (예: 2학년 3반 자리 배치)" />
              <select className="edu-input" value={newKind} onChange={(e) => setNewKind(e.target.value as WhiteboardKind)}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.icon} {k.label}</option>)}
              </select>
              <button className="edu-btn" onClick={() => void createBoard()} disabled={!newTitle.trim()}>만들기</button>
            </div>
          </div>
        </div>
      </div>

      {!current || !data ? (
        <div className="edu-card p-8 text-center anim-card">
          <div className="text-[28px]">🗂️</div>
          <div className="font-extrabold text-[15px] mt-1">보드를 하나 골라 주세요</div>
          <div className="text-[12.5px] text-edu-sub mt-1">새 보드를 만들면 자리·모둠·감독 배치를 바로 시작할 수 있어요.</div>
          <button className="edu-btn mt-3 inline-flex items-center gap-1.5" onClick={() => setNewOpen(true)}><IconPlus size={14} /> 새 보드 만들기</button>
        </div>
      ) : (
        <>
          <div className="edu-card p-3.5 anim-card">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="font-extrabold text-[14px] truncate">{current.title}</div>
                <div className="text-[11.5px] text-edu-sub">
                  {KIND_LABEL[current.kind]} · {current.createdByName || "선생님"} · v{current.version}
                  {dirty ? " · 저장 대기" : saving ? " · 저장 중…" : " · 저장됨"}
                </div>
              </div>
              <span className={`wb-save-state ${dirty ? "dirty" : saving ? "saving" : ""}`}>
                {dirty ? "변경됨" : saving ? "저장 중" : "저장됨"}
              </span>
              {canDelete && (
                <BzTooltip content="이 보드 지우기" position="left">
                  <button className="consult-icon-btn danger" onClick={() => void deleteBoard()} aria-label="보드 지우기"><IconTrash size={14} /></button>
                </BzTooltip>
              )}
            </div>

            <div className="wb-toolbar mt-2.5">
              <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px]" onClick={() => addItem("seat")}><span className="wb-tool-ico">🪑</span> 자리</button>
              <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px]" onClick={() => addItem("group")}><span className="wb-tool-ico">👥</span> 모둠</button>
              <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px]" onClick={() => addItem("table")}><span className="wb-tool-ico">📋</span> 감독</button>
              <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px]" onClick={() => addItem("label")}><span className="wb-tool-ico">🏷️</span> 메모</button>
              <span className="text-[11.5px] text-edu-sub ml-auto hidden sm:inline">항목을 끌어서 옮겨 보세요</span>
            </div>

            <div className="wb-canvas-wrap mt-2.5">
              <div
                ref={canvasRef}
                className={`wb-canvas ${data.background === "plain" ? "plain" : "grid"} ${dragging ? "dragging" : ""}`}
                onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedItemId(null); }}
              >
                {data.items.map((it) => (
                  <div
                    key={it.id}
                    className={`wb-item wb-${it.type} ${selectedItemId === it.id ? "selected" : ""} ${leavingItemId === it.id ? "is-leaving" : ""}`}
                    style={{ left: it.x, top: it.y, width: it.w, height: it.h, borderColor: it.color, background: it.type === "label" ? "transparent" : `${it.color}18` }}
                    onPointerDown={(e) => onPointerDown(e, it)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  >
                    <span className="wb-item-label" style={{ color: it.type === "label" ? it.color : undefined }}>{it.label || ITEM_LABEL[it.type]}</span>
                    {it.sublabel && <span className="wb-item-sub">{it.sublabel}</span>}
                    {it.type === "seat" && <span className="wb-seat-dot" style={{ background: it.color }} />}
                  </div>
                ))}
                {data.items.length === 0 && (
                  <div className="wb-empty">
                    <IconStickyNote size={22} />
                    <div>위 도구로 자리·모둠·감독을 추가해 보세요.</div>
                  </div>
                )}
              </div>
            </div>

            {itemPresence.mounted && itemView && (
              <div className={`wb-inspector anim-pop ${itemPresence.closing ? "is-closing" : ""}`}>
                <div className="wb-inspector-head">
                  <span className="font-extrabold text-[12.5px]">{ITEM_LABEL[itemView.type]} 편집</span>
                  <button className="consult-icon-btn ml-auto" onClick={() => setSelectedItemId(null)} aria-label="편집 닫기"><IconX size={13} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                  <label className="consult-field">
                    <span>이름</span>
                    <input className="edu-input" value={itemView.label} onChange={(e) => patchItem(itemView.id, { label: e.target.value })} maxLength={48} />
                  </label>
                  <label className="consult-field">
                    <span>설명</span>
                    <input className="edu-input" value={itemView.sublabel} onChange={(e) => patchItem(itemView.id, { sublabel: e.target.value })} maxLength={80} placeholder="예: 1학년 2반" />
                  </label>
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="text-[11.5px] font-bold text-edu-sub">색</span>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      className={`wb-color ${itemView.color === c ? "active" : ""}`}
                      style={{ background: c }}
                      onClick={() => patchItem(itemView.id, { color: c })}
                      aria-label={`색 ${c}`}
                    />
                  ))}
                  <button className="edu-ghost !px-2 !py-1 !text-[11.5px] ml-auto inline-flex items-center gap-1" onClick={() => removeItem(itemView.id)}>
                    <IconTrash size={12} /> 삭제
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="edu-card p-3 wb-guide">
            <div className="font-extrabold text-[13px] inline-flex items-center gap-1.5"><IconUsers size={14} /> 함께 쓰는 보드</div>
            <div className="text-[12px] text-edu-sub mt-1 leading-relaxed">
              같은 보드를 연 선생님 화면에 이동이 바로 보여요. 인터넷이 끊겨도 이 PC에 저장되고, 다시 연결되면 서버에 이어서 저장해요.
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 text-[11.5px] text-edu-sub">
              <IconCloudIcon size={12} /> {realtime ? "학교 서버와 실시간 연결 중" : offline ? "이 PC에만 저장 중" : "서버 저장 모드"}
              {current.updatedByName && <span>· 마지막 편집 {current.updatedByName}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
