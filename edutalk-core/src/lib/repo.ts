// 저장소 단일화층 — 화면은 이 파일만 보고, 뒤가 SQLite든 미리보기든 모른다.
// - 설치판(Tauri): Rust 명령 → PC 안 SQLite가 진짜 저장소.
// - 미리보기: 기존 localStorage 목업이 그대로 돈다.
// 모든 함수는 실패해도 조용히 넘어간다 (화면 상태가 1차 진실이므로).
import type {
  ChatMessage,
  Memo,
  MemoComment,
  SwapRecord,
  TimetableCell,
} from "../types";
import { ME_ID } from "../mock/initialData";
import { isTauriDesktop } from "./edition";
import { call, type CommentItem, type Memo as RustMemo, type QuickItem } from "./tauri";

export function rustEnabled(): boolean {
  return isTauriDesktop();
}

function ts(v: string): number {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

export function sortByTimeDesc<T>(arr: T[], pick: (x: T) => string): T[] {
  return [...arr].sort((a, b) => ts(pick(b)) - ts(pick(a)));
}

// ---------- 쪽지 ----------

export function rustMemoToApp(r: RustMemo): Memo {
  return {
    id: r.id,
    title: r.title || "(제목 없음)",
    body: r.body || "",
    fromUid: r.from_uid,
    fromName: r.from_name || r.from_uid,
    to: (r.recipients ?? []).map((x) => ({
      uid: x.uid,
      name: x.name || x.uid,
      readAt: x.read_at,
      nudgedAt: x.nudged_at,
    })),
    importance: r.importance === "urgent" || r.importance === "ref" ? r.importance : "normal",
    hwpName: "",
    hwpSize: 0,
    createdAt: r.created_at,
  };
}

export async function hydrateMemos(): Promise<Memo[] | null> {
  if (!rustEnabled()) return null;
  try {
    const rows = await call<RustMemo[]>("memo_list");
    return rows.map(rustMemoToApp);
  } catch {
    return null;
  }
}

export function mergeMemos(local: Memo[], remote: Memo[]): Memo[] {
  const map = new Map<string, Memo>();
  for (const m of local) map.set(m.id, m);
  for (const m of remote) {
    const cur = map.get(m.id);
    // 화면 상태(읽음·재촉 등)가 있으면 유지하고, 없는 쪽지만 덧붙인다
    if (!cur) map.set(m.id, m);
    else if (!cur.body && m.body) map.set(m.id, { ...cur, body: m.body, title: cur.title || m.title });
  }
  return sortByTimeDesc([...map.values()], (m) => m.createdAt);
}

// 같은 ID로 SQLite에도 저장 (P2P와 같은 ID를 써서 읽음·재촉이 어긋나지 않는다)
export async function persistMemo(m: Memo): Promise<void> {
  if (!rustEnabled()) return;
  try {
    await call("memo_send", {
      memo: {
        id: m.id,
        title: m.title,
        body: m.body,
        to: m.to.map((r) => ({ uid: r.uid, name: r.name })),
        file_name: m.hwpName || "",
      },
    });
  } catch {
    /* 화면 저장은 이미 끝남 */
  }
}

export async function persistRead(memoId: string): Promise<void> {
  if (!rustEnabled()) return;
  try {
    await call("memo_read", { memo_id: memoId });
  } catch {
    /* 다음에 */
  }
}

export async function persistNudge(memoId: string, uid: string): Promise<void> {
  if (!rustEnabled()) return;
  try {
    await call("memo_nudge", { memo_id: memoId, uid });
  } catch {
    /* 다음에 */
  }
}

export async function persistImportance(memoId: string, importance: string): Promise<void> {
  if (!rustEnabled()) return;
  try {
    await call("memo_set_importance", { memo_id: memoId, importance });
  } catch {
    /* 다음에 */
  }
}

// ---------- 댓글 ----------

export async function fetchComments(memoId: string): Promise<MemoComment[] | null> {
  if (!rustEnabled()) return null;
  try {
    const rows = await call<CommentItem[]>("comment_list", { memo_id: memoId });
    return rows.map((c) => ({
      id: c.id,
      memoId,
      fromUid: c.from_uid,
      fromName: c.from_name || c.from_uid,
      body: c.body,
      createdAt: c.created_at,
    }));
  } catch {
    return null;
  }
}

// Rust가 돌려준 진짜 ID를 돌려준다 (INSERT 중복 방지용 ID 교체)
export async function persistComment(memoId: string, body: string): Promise<string | null> {
  if (!rustEnabled()) return null;
  try {
    return await call<string>("comment_add", { memo_id: memoId, body });
  } catch {
    return null;
  }
}

// ---------- 빠른 대화 ----------

export async function fetchQuicks(peerId: string): Promise<ChatMessage[] | null> {
  if (!rustEnabled()) return null;
  try {
    const rows = await call<QuickItem[]>("quick_list", { peer_uid: peerId });
    return rows.map((q) => ({
      id: q.id,
      peerId,
      mine: q.mine,
      body: q.body,
      createdAt: q.created_at,
      read: true,
      emoji: [],
    }));
  } catch {
    return null;
  }
}

export async function persistQuick(peerId: string, peerName: string, body: string): Promise<string | null> {
  if (!rustEnabled()) return null;
  try {
    return await call<string>("quick_send", { peer_uid: peerId, peer_name: peerName, body });
  } catch {
    return null;
  }
}

// ---------- 시간표 (화면→SQLite 동기화: 오늘 상태·대타후보가 같은 표를 본다) ----------

const WD_NAME = ["", "월", "화", "수", "목", "금"];

export function cellsToCsv(cells: TimetableCell[]): string {
  const head = "요일,교시,학년,반,과목,교실,교사";
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, "'")}"` : s);
  const lines = cells.map((c) =>
    [WD_NAME[c.weekday] || String(c.weekday), String(c.period), c.grade, c.classNo, c.subject, c.room, c.teacher]
      .map((x) => esc(x ?? ""))
      .join(",")
  );
  return [head, ...lines].join("\n");
}

let lastTimetableHash = "";

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return `${s.length}:${h}`;
}

export async function syncTimetable(cells: TimetableCell[], sourceName: string): Promise<void> {
  if (!rustEnabled() || cells.length === 0) return;
  const csv = cellsToCsv(cells);
  const hash = hashStr(csv);
  if (hash === lastTimetableHash) return;
  lastTimetableHash = hash;
  try {
    await call<number>("timetable_import", { source_name: sourceName, csv });
  } catch {
    /* 다음에 */
  }
}

// ---------- 대강 (SQLite 감사 추적용 기록) ----------

export async function persistSwapRequest(r: {
  date: string;
  weekday: number;
  period: number;
  grade: string;
  classNo: string;
  subject: string;
  toUid: string;
  toName: string;
}): Promise<string | null> {
  if (!rustEnabled()) return null;
  try {
    return await call<string>("substitute_request", {
      req: {
        date: r.date,
        weekday: r.weekday,
        period: r.period,
        grade: r.grade,
        class_no: r.classNo,
        subject: r.subject,
        to_uid: r.toUid,
        to_name: r.toName,
      },
    });
  } catch {
    return null;
  }
}

export async function persistSwapAccept(id: string, accept: boolean): Promise<void> {
  if (!rustEnabled()) return;
  try {
    await call("substitute_accept", { id, accept });
  } catch {
    /* 다음에 */
  }
}

// ---------- 감사 리포트 내보내기 (설치판: 폴더 고르기 → HTML+CSV) ----------

export async function exportAuditReport(
  onToast: (t: string) => void
): Promise<void> {
  if (!rustEnabled()) {
    onToast("준수 리포트 생성했어요 (미리보기에서는 화면 목록만 보여요).");
    return;
  }
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false, title: "감사 보고서 저장 폴더" });
    if (!dir || typeof dir !== "string") {
      onToast("취소했어요.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const r = await call<{ html: string; csv: string; count: number }>("audit_export", {
      school: "",
      from: "",
      to: today,
      dir,
    });
    onToast(`보고서 저장했어요 (${r.count}건): ${r.html}`);
  } catch (e) {
    onToast(e instanceof Error ? e.message : "내보내지 못했어요.");
  }
}

// ---------- 임시 정리 (감사 탭 저장소 카드와 연결) ----------

export async function runPurge(): Promise<{ freedMB: number; totalMB: number } | null> {
  if (!rustEnabled()) return null;
  try {
    const r = await call<{ freed_bytes: number; total_bytes: number }>("purge_run");
    return { freedMB: r.freed_bytes / 1048576, totalMB: r.total_bytes / 1048576 };
  } catch {
    return null;
  }
}

// 대타 시수: 화면 기록 기준 (ME_ID 기준 작성분만 집계하므로 월말 수당 자료로 쓴다)
export function myMonthlySubs(swaps: SwapRecord[], yyyyMM: string): number {
  return swaps.filter((s) => s.status === "accepted" && s.date.startsWith(yyyyMM)).length;
}

export { ME_ID };
