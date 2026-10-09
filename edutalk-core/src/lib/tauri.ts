// Rust 명령 호출 다리.
// Tauri 안에서 돌면 진짜 명령을 부르고, 브라우저에서 `npm run dev`로 열면
// 화면 확인용 가벼운 대체 저장소(메모리+localStorage)를 쓴다.

export type NetMode = "intranet" | "external";

export interface Recipient {
  uid: string;
  name: string;
}

export interface RecipientRow extends Recipient {
  read_at: string | null;
  nudged_at: string | null;
}

export interface Memo {
  id: string;
  title: string;
  body: string;
  from_uid: string;
  from_name: string;
  via: string;
  created_at: string;
  importance: string;
  recipients: RecipientRow[];
}

export interface PollRow {
  id: string;
  question: string;
  options: string[];
  closed: boolean;
  counts: number[];
  mine: number;
}

export interface TemplateRow {
  id: string;
  title: string;
  body: string;
}

export interface ScheduledRow {
  id: string;
  title: string;
  body: string;
  to_json: string;
  run_at: string;
}

export interface EventRow {
  id: string;
  title: string;
  date: string;
}

export interface OrgNode {
  id: string;
  dept: string;
  grade: string;
  name: string;
  role: string;
}

export interface GuestRow {
  pin: string;
  name: string;
  expires_at: string;
  used: boolean;
}

export interface HandoverRow {
  id: string;
  body: string;
  from_name: string;
  created_at: string;
}

export interface InboxRow {
  id: string;
  title: string;
  body: string;
  from_name: string;
  state: string;
  created_at: string;
}

export interface HwptplRow {
  id: string;
  title: string;
  note: string;
}

export interface ScratchRow {
  id: string;
  body: string;
  updated_at: string;
}

export interface SearchHit {
  kind: string;
  ref_id: string;
  title: string;
  snippet: string;
}

export interface UsbState {
  drives: { name: string; mount: string }[];
  added: string[];
}

export interface CommentItem {
  id: string;
  body: string;
  from_uid: string;
  from_name: string;
  created_at: string;
}

export interface QuickItem {
  id: string;
  body: string;
  mine: boolean;
  created_at: string;
}

export interface Peer {
  node_id: string;
  name: string;
  address: string;
  tcp_port: number;
  grade: string;
  room: string;
}

export interface Slot {
  weekday: number;
  period: number;
  grade: string;
  class_no: string;
  subject: string;
  room: string;
  teacher: string;
}

export interface Candidate {
  teacher: string;
  sub_count: number;
  reason: string;
}

export interface SubItem {
  id: string;
  date: string;
  weekday: number;
  period: number;
  grade: string;
  class_no: string;
  subject: string;
  from_name: string;
  to_name: string;
  status: string;
  created_at: string;
}

export interface AuditRow {
  id: number;
  created_at: string;
  kind: string;
  rule_ids: string;
  score: number;
  net_mode: string;
}

export interface DlpHit {
  id: string;
  label: string;
  count: number;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

async function realCall<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// ---- 화면 확인용 대체 저장소 ----

interface MockDb {
  memos: Memo[];
  comments: Record<string, CommentItem[]>;
  quick: Record<string, QuickItem[]>;
}

function loadMock(): MockDb {
  try {
    const raw = localStorage.getItem("edutalk-mock");
    if (raw) return JSON.parse(raw) as MockDb;
  } catch {
    /* 처음 실행 */
  }
  return { memos: [], comments: {}, quick: {} };
}

function saveMock(db: MockDb) {
  try {
    localStorage.setItem("edutalk-mock", JSON.stringify(db));
  } catch {
    /* 용량 초과 시 무시 */
  }
}

let mockMode: NetMode = "intranet";

function nowIso(): string {
  return new Date().toISOString();
}

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function mockCall<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const db = loadMock();
  const a = args ?? {};
  switch (cmd) {
    case "net_status":
      return { mode: mockMode, peers: 0 } as unknown as T;
    case "net_set_mode":
      mockMode = a["mode"] === "external" ? "external" : "intranet";
      return mockMode as unknown as T;
    case "me_set":
      return undefined as unknown as T;
    case "dlp_scan": {
      const text = String(a["text"] ?? "");
      const hits: DlpHit[] = [];
      let score = 0;
      if (/\d{6}[- ]?\d{7}/.test(text)) {
        hits.push({ id: "RRN", label: "주민등록번호", count: 1 });
        score += 0.9;
      }
      if (/(시험지|답지|성적표)/.test(text)) {
        hits.push({ id: "SCORE", label: "성적 표현", count: 1 });
        score += 0.7;
      }
      const verdict = score >= 0.85 ? "block" : score >= 0.45 ? "warn" : "allow";
      return { verdict, score, hits, elapsed_ms: 1, model: "mock" } as unknown as T;
    }
    case "memo_send": {
      const m = a["memo"] as { title: string; body: string; to: Recipient[]; file_name: string };
      const id = "m-" + rnd();
      db.memos.unshift({
        id,
        title: m.title,
        body: m.body,
        from_uid: "me",
        from_name: "나",
        via: mockMode === "intranet" ? "p2p" : "cloud",
        created_at: nowIso(),
        importance: "normal",
        recipients: (m.to ?? []).map((t) => ({ ...t, read_at: null, nudged_at: null })),
      });
      saveMock(db);
      return { ok: true, id, via: "mock" } as unknown as T;
    }
    case "memo_list":
      return (db.memos.slice(0, 200) as unknown) as T;
    case "memo_read":
    case "memo_nudge":
      return undefined as unknown as T;
    case "comment_add": {
      const id = "c-" + rnd();
      const list = db.comments[String(a["memo_id"])] ?? [];
      list.push({ id, body: String(a["body"]), from_uid: "me", from_name: "나", created_at: nowIso() });
      db.comments[String(a["memo_id"])] = list;
      saveMock(db);
      return id as unknown as T;
    }
    case "comment_list":
      return ((db.comments[String(a["memo_id"])] ?? []) as unknown) as T;
    case "quick_send": {
      const id = "q-" + rnd();
      const list = db.quick[String(a["peer_uid"])] ?? [];
      list.push({ id, body: String(a["body"]), mine: true, created_at: nowIso() });
      db.quick[String(a["peer_uid"])] = list;
      saveMock(db);
      return id as unknown as T;
    }
    case "quick_list":
      return ((db.quick[String(a["peer_uid"])] ?? []) as unknown) as T;
    case "peer_list":
    case "timetable_today":
    case "substitute_list":
    case "audit_list":
    case "poll_list":
    case "template_list":
    case "scheduled_list":
    case "scheduled_due":
    case "event_list":
    case "org_list":
    case "guest_list":
    case "handover_tags":
    case "hwptpl_list":
      return ([] as unknown) as T;
    case "handover_list":
    case "inbox_list":
      return ([] as unknown) as T;
    case "search":
      return ([] as unknown) as T;
    case "timetable_now":
      return (null as unknown) as T;
    case "timetable_import":
      return (0 as unknown) as T;
    case "substitute_candidates":
      return ([] as unknown) as T;
    case "substitute_request":
      return (("s-" + rnd()) as unknown) as T;
    case "poll_create":
      return (("p-" + rnd()) as unknown) as T;
    case "template_add":
      return (("tpl-" + rnd()) as unknown) as T;
    case "scheduled_add":
      return (("sch-" + rnd()) as unknown) as T;
    case "event_add":
      return (("e-" + rnd()) as unknown) as T;
    case "handover_add":
      return (("h-" + rnd()) as unknown) as T;
    case "inbox_add":
      return (("ib-" + rnd()) as unknown) as T;
    case "hwptpl_add":
      return (("hw-" + rnd()) as unknown) as T;
    case "guest_add":
      return ({ pin: "123456", expires_at: nowIso() } as unknown) as T;
    case "substitute_accept":
    case "scheduled_mark":
    case "event_delete":
    case "secret_save":
    case "template_delete":
    case "guest_revoke":
    case "inbox_set_state":
    case "hwptpl_delete":
    case "poll_vote":
    case "poll_close":
    case "memo_set_importance":
    case "capture_set":
    case "firewall_register":
      return undefined as unknown as T;
    case "secret_load":
      return ("" as unknown) as T;
    case "scratch_get":
      return ({ id: String(a["id"] ?? ""), body: "", updated_at: "" } as unknown) as T;
    case "scratch_save":
      return (nowIso() as unknown) as T;
    case "usb_check":
      return ({ drives: [], added: [] } as unknown) as T;
    case "layout_apply":
      return undefined as unknown as T;
    case "sample_timetable":
      return (30 as unknown) as T;
    case "audit_export":
      return ({ html: "", csv: "", count: 0 } as unknown) as T;
    case "ram_put":
      return (0 as unknown) as T;
    case "ram_get":
      return ([] as unknown) as T;
    case "ram_free":
      return (true as unknown) as T;
    case "purge_run":
      return ({ deleted_expired: 0, deleted_quota: 0, freed_bytes: 0, total_bytes: 0 } as unknown) as T;
    case "remote_view_request":
      return ({ request_id: "r-" + rnd() } as unknown) as T;
    case "remote_snapshot":
      return ({
        data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        width: 1,
        height: 1,
        bytes: 70,
      } as unknown) as T;
    case "remote_view_respond":
    case "remote_view_frame":
    case "remote_view_bye":
    case "p2p_send":
      return undefined as unknown as T;
    default:
      throw new Error("모르는 명령이에요: " + cmd);
  }
}

export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return realCall<T>(cmd, args);
  return mockCall<T>(cmd, args);
}

export function listenEvent(name: string, handler: (payload: unknown) => void): () => void {
  if (!isTauri()) return () => undefined;
  let stop: (() => void) | undefined;
  (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const un = await listen(name, (e) => handler(e.payload));
    stop = un;
  })();
  return () => {
    if (stop) stop();
  };
}
