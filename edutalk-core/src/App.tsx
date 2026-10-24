import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type {
  ActiveView,
  AdminAuditLog,
  AdminNotice,
  AdminUser,
  AuditLog,
  ChatMessage,
  DeptGroup,
  DlpRule,
  GradeClass,
  Memo,
  MemoComment,
  NetworkState,
  NoticeItem,
  School,
  SchoolSettings,
  SwapRecord,
  Teacher,
  TeacherStatus,
  TimetableCell,
  TimetableTemplate,
  ToastMsg,
  UserRole,
} from "./types";
import UpdateToast from "./components/UpdateToast";
import { ME_ID, nowIso, type SchoolSetup } from "./mock/initialData";
import { storeGet, storeSet } from "./lib/localStore";
import { call, emitEvent, listenEvent } from "./lib/tauri";
import { FONT_OPTIONS, normalizeFontKind, type FontKind } from "./lib/fonts";
import { isTauriDesktop } from "./lib/edition";
import type { Peer } from "./lib/tauri";
import { isFirebaseCloudSchool, intranetVisible, isExternalOnlySchool, isIntranetScoped, remoteBlockedReason } from "./lib/remotePolicy";
import { syncUiFromStorage, useEdu, applyLayoutAttr, applyMotionAttr, applyUiScale } from "./store";
import { api, normalizeServerUrl, setApiBaseUrl } from "./services/api";
import { connectNotesRealtime, disconnectNotesRealtime, startNotesRealtime } from "./services/notes";
import { socket } from "./services/socket";
import { defaultMessageFor, normalizeStatus } from "./lib/status";
import { useQuick } from "./lib/quickStore";
import { newOutboxItem, obAll, obDelete, obPut, type OutboxItem } from "./lib/outbox";
import QuickMemos from "./components/QuickMemos";
import BzTooltip from "./components/ui/BzTooltip";
import { playSiren, stopSiren } from "./lib/siren";
import { playStudentChime } from "./lib/chime";
import { FOCUS_MESSAGE, isFocusTime } from "./lib/focus";
import { summarize3 } from "./lib/ai";
import SurveyPane from "./components/views/SurveyPane";
import { DEMO_SCHOOL_NAME } from "./mock/demoData";
import { cellKey, isBreakNow } from "./lib/fusion";
import { isLunchTime, LUNCH_AUTO_MESSAGE } from "./utils/timetable";
import {
  exportAuditReport,
  fetchComments,
  fetchQuicks,
  hydrateMemos,
  mergeMemos,
  persistComment,
  persistImportance,
  persistMemo,
  persistNudge,
  persistQuick,
  persistRead,
  persistSwapAccept,
  persistSwapRequest,
  runPurge,
  rustEnabled,
  syncTimetable,
} from "./lib/repo";
import { fetchSchoolLicense, isDualNetworkSchool, type SchoolLicense } from "./lib/schoolSync";
import { useCloud } from "./lib/cloudStore";
import LeftSidebar, { navItemsForRole } from "./components/layout/LeftSidebar";
import RightPanel from "./components/layout/RightPanel";
import TitleBar from "./components/layout/TitleBar";
import BootSplash from "./components/BootSplash";
import DetachedChat from "./components/DetachedChat";
import MorningPopup from "./components/MorningPopup";
import OrgTreePane, { nextAvatar } from "./components/views/OrgTreePane";
import MemoPane, { type MemoSendExtras } from "./components/views/MemoPane";
import ChatPane from "./components/views/ChatPane";
import TimetablePane from "./components/views/TimetablePane";
import AuditPane from "./components/views/AuditPane";
import WorkPane from "./components/views/WorkPane";
import ConsultPane from "./components/views/ConsultPane";
import ApprovalPane from "./components/views/ApprovalPane";
import WhiteboardPane from "./components/views/WhiteboardPane";
import CloudPane from "./components/views/CloudPane";
import SettingsPane from "./components/views/SettingsPane";
import PrintPane from "./components/views/PrintPane";
import SetupWizard from "./components/views/SetupWizard";
import AdminDashboard from "./components/views/AdminDashboard";
import AdminUsers from "./components/views/AdminUsers";
import AdminNotices from "./components/views/AdminNotices";
import AdminTimetable from "./components/views/AdminTimetable";
import AdminAudit from "./components/views/AdminAudit";
import AdminSettings from "./components/views/AdminSettings";
import StudentInboxPane from "./components/views/StudentInboxPane";
import AdminSchool from "./components/views/AdminSchool";
import LoginWindow, { LoginCredentials } from "./components/LoginWindow";

let toastSeq = 1;
let idSeq = 100;

// 학교 서버(onprem) 응답 형태
interface ServerUser {
  id: number;
  username: string;
  real_name: string;
  department_id: number | null;
  status: string;
  status_message?: string;
  role: string;
}
interface ServerDeptNode {
  id: number;
  name: string;
  children?: ServerDeptNode[];
}

function uid(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

// 다가오는 해당 요일의 날짜 (1=월 … 5=금)
function dateForWeekday(weekday: number): string {
  const d = new Date();
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// 현재 시각 → 교시 판정 (1~7교시, fusion 교시표와 동일)
function periodNow(): { period: number; start: string; end: string } | null {
  const times = [["09:00", "09:50"], ["10:00", "10:50"], ["11:00", "11:50"], ["12:00", "12:50"], ["13:50", "14:40"], ["14:50", "15:40"], ["15:50", "16:40"]];
  const d = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  for (let i = 0; i < times.length; i++) {
    if (hm >= times[i][0] && hm < times[i][1]) return { period: i + 1, start: times[i][0], end: times[i][1] };
  }
  return null;
}

// 화면(탭) 이름 — 창 제목과 본문 머리에 같이 쓴다.
const VIEW_TITLE: Record<ActiveView, string> = {
  login: "로그인",
  org: "조직도",
  memo: "쪽지함",
  "student-inbox": "학생 문의",
  chat: "빠른 대화",
  timetable: "시간표·대강",
  work: "업무/공지",
  consult: "AI 상담 일지",
  approval: "전자결재",
  whiteboard: "협업 보드",
  cloud: "브리즈 클라우드",
  print: "보안 인쇄",
  survey: "설문조사",
  settings: "설정",
  audit: "보안·감사",
  "admin-dashboard": "관리자 대시보드",
  "admin-users": "사용자 관리",
  "admin-notices": "공지 관리",
  "admin-timetable": "시간표 관리",
  "admin-audit": "감사 로그",
  "admin-settings": "학교 설정",
  "admin-school": "학교 정보",
};

export default function App() {
  // 여러 창 모드: ?win=chat&peer=... 로 열린 독립 대화 창은 자체 UI만 그린다.
  const bootQs = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams("");
  if (bootQs.get("win") === "chat" && bootQs.get("peer")) {
    const pid = bootQs.get("peer") as string;
    return <DetachedChat peerId={pid} peerName={bootQs.get("name") || pid} />;
  }
  // 메뉴 팝업 창(?win=view&v=설정|쪽지함|…): 메인 창은 그대로 두고 그 화면 하나만 새 창에 띄운다.
  const popupView = bootQs.get("win") === "view" ? ((bootQs.get("v") as ActiveView | null) ?? "settings") : null;
  const popupMode = popupView !== null;
  const popupTo = bootQs.get("to") || "";
  const popupMemo = bootQs.get("memo") || "";
  const [booted, setBooted] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [view, setView] = useState<ActiveView>(popupView ?? "org");
  const [serverRole, setServerRole] = useState<UserRole>("teacher");
  const [hiddenTabs, setHiddenTabs] = useState<ActiveView[]>([]);
  const [tabOrder, setTabOrder] = useState<ActiveView[]>([]);
  const [net, setNet] = useState<NetworkState>("intranet");
  const [meStatus, setMeStatus] = useState<TeacherStatus>("online");
  const [autoStatus, setAutoStatus] = useState(true);
  // 연결 자동 전환(하이브리드 망): 교내망 PC가 보이면 교내연결, 안 보이면 외부연결
  const [netAuto, setNetAuto] = useState(true);
  const [font, setFont] = useState<FontKind>("pretendard");
  const [school, setSchool] = useState<SchoolSetup>({ schoolId: "", schoolName: "" });
  const [license, setLicense] = useState<SchoolLicense | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [depts, setDepts] = useState<DeptGroup[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [comments, setComments] = useState<Record<string, MemoComment[]>>({});
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [cells, setCells] = useState<TimetableCell[]>([]);
  const [swaps, setSwaps] = useState<SwapRecord[]>([]);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [cacheUsed, setCacheUsed] = useState(0.2);
  const [autoPurge, setAutoPurge] = useState(true);
const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());
  // 로그인 상태: 팝업 창은 메인 창에서 열린 것이므로 바로 로그인된 상태로 시작한다.
  const [isLoggedIn, setIsLoggedIn] = useState(() => popupMode);
  const [serverBase, setServerBase] = useState<string | null>(null);
  const [loginError, setLoginError] = useState("");
  // 관리자 모드 상태
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminNotices, setAdminNotices] = useState<AdminNotice[]>([]);
  const [adminAudits, setAdminAudits] = useState<AdminAuditLog[]>([]);
  const [templates, setTemplates] = useState<TimetableTemplate[]>([]);
  const [gradeClasses, setGradeClasses] = useState<GradeClass[]>([]);
  const [schoolInfo, setSchoolInfo] = useState<School | null>(null);
  const [schoolSettings, setSchoolSettings] = useState<SchoolSettings>({
    allowExternalNetwork: true,
    autoBackup: true,
    retentionDays: 365,
    dlpEnabled: true,
    dlpRules: [],
    notificationDefaultScope: "all",
  });
  // 쪽지 열기: 내 읽음을 남기고, 상대 PC 쪽지면 읽음 영수증을 보낸다.
  const [openMemoId, setOpenMemoId] = useState<string | null>(popupMemo || null);
  const openMemo = (id: string | null) => {
    setOpenMemoId(id);
    if (!id) return;
    setMemos((arr) => arr.map((m) => (m.id === id
      ? { ...m, to: m.to.map((r) => (r.uid === ME_ID && !r.readAt ? { ...r, readAt: nowIso() } : r)) }
      : m)));
    void persistRead(id);
    emitEvent("breeze-sync", { scope: "memo-read", memo: id });
    // SQLite에 쌓인 댓글을 게을리 가져온다 (N+1 대신 열 때 1번, 화면 작성분과 합친다)
    void fetchComments(id).then((rows) => {
      if (!rows || !rows.length) return;
      setComments((s) => {
        const list = s[id] ?? [];
        const have = new Set(list.map((c) => c.id));
        const fresh = rows.filter((c) => !have.has(c.id));
        if (!fresh.length) return s;
        return { ...s, [id]: [...list, ...fresh] };
      });
    });
    const mm = memos.find((m) => m.id === id);
    if (mm && mm.fromUid !== ME_ID && isPeer(mm.fromUid)) {
      void transmit(mm.fromUid, "read", "", "", id);
    }
  };
  const openMemoRef = useRef<(id: string | null) => void>(() => undefined);
  openMemoRef.current = openMemo;
  const [memoPreset, setMemoPreset] = useState<Teacher | null>(null);
  // 퀵 메모 → 쪽지 초안 넘기기
  const [memoDraft, setMemoDraft] = useState<{ title?: string; body: string } | null>(null);
  const quickLayerOpen = useQuick((s) => s.layerOpen);
  const quickNoteCount = useQuick((s) => s.notes.length);
  const [chatPeer, setChatPeer] = useState<Teacher | null>(null);
  // 3단 레이아웃: 우측 아크릴 패널(자리배치·파일·쪽지) 접기/펼치기
  const [rightPane, setRightPane] = useState(true);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [unreadStudent, setUnreadStudent] = useState(0);
  const [emergency, setEmergency] = useState<NoticeItem | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const [peers, setPeers] = useState<Peer[]>([]);
  const meRef = useRef<Teacher | null>(null);
  const teachersRef = useRef<Teacher[]>([]);
  const swapsRef = useRef<SwapRecord[]>([]);
  const chatsRef = useRef<Record<string, ChatMessage[]>>({});
  const memosRef = useRef<Memo[]>([]);
  const netRef = useRef<NetworkState>("intranet");
  // 7초 Undo Send: 유예 타이머 보관 (취소하면 전송·저장 자체를 하지 않는다)
  const undoHoldsRef = useRef<Map<string, number>>(new Map());
  // Focus Mode 활성 여부를 이벤트 핸들러에서 참조한다 (알림 무음)
  const focusActiveRef = useRef(false);
  // 자동 전환: 교내망 PC가 연속으로 안 보인 횟수 (튀는 전환 방지)
  const noPeerTicks = useRef(0);
  // 학교 서버 조직도를 이미 불러왔는지
  const srvLoadedRef = useRef(false);

  // ── 오프라인 감지 + 보관함 (네트워크 단선 대비 · 연결 복구 시 자동 전송) ──
  const [netOnline, setNetOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const netOnlineRef = useRef(netOnline);
  netOnlineRef.current = netOnline;
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const outboxRef = useRef<OutboxItem[]>([]);
  outboxRef.current = outboxItems;
  const peersRef = useRef<Peer[]>([]);
  peersRef.current = peers;
  const refreshOutbox = () => {
    void obAll(["memo", "chat"]).then(setOutboxItems);
  };
  useEffect(() => {
    refreshOutbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const on = () => setNetOnline(true);
    const off = () => setNetOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const layout = useEdu((s) => s.layout);
  const motion = useEdu((s) => s.motion);
  const darkMode = useEdu((s) => s.dark);
  const toastOn = useEdu((s) => s.toastOn);
  const offWork = useEdu((s) => s.offWork);
  const focusOn = useEdu((s) => s.focus);
  const sirenOn = useEdu((s) => s.siren);
  const uiScale = useEdu((s) => s.uiScale);
  const isClassic = layout === "classic";

  // Focus Mode: 설정이 켜져 있고 시간대(평일 18시~아침 8시·주말 종일)면 활성.
  //  1분마다 다시 계산해 자정을 넘겨도 알아서 켜지고 꺼진다.
  const [focusActive, setFocusActive] = useState(false);
  useEffect(() => {
    const calc = () => setFocusActive(focusOn && isFocusTime());
    calc();
    const t = window.setInterval(calc, 60000);
    return () => window.clearInterval(t);
  }, [focusOn]);
  focusActiveRef.current = focusActive;

  // 긴급 공지 팝업의 AI 3줄 요약 (팝업을 막지 않도록 비동기로 채운다)
  const [emgSummary, setEmgSummary] = useState<string[] | null>(null);

  // 창 폭을 실시간으로 본다: 창을 키우면 왼쪽 메뉴가 이름표를 달고 넓어지고,
  // 쪽지·업무 같은 화면은 넓은 화면용 배치를 쓴다 (여백 없이 꽉 차게).
  const [winW, setWinW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const wideWin = winW >= 900;

  useEffect(() => {
    applyLayoutAttr(layout);
  }, [layout]);

  useEffect(() => {
    applyMotionAttr(motion);
  }, [motion]);

  useEffect(() => {
    applyUiScale(uiScale);
  }, [uiScale]);

  // 첫 실행: 로컬 DB에서 전부 불러온다 (설치형 — 서버 없이 이 PC에서 돈다)
  useEffect(() => {
    (async () => {
      const got = await Promise.all([
        storeGet<boolean>("profile-done").then((v) => v === true),
        storeGet<NetworkState>("net"),
        storeGet<TeacherStatus>("status"),
        storeGet<boolean>("autostatus"),
        storeGet<FontKind>("font"),
        storeGet<SchoolSetup>("school"),
        storeGet<Teacher[]>("teachers"),
        storeGet<DeptGroup[]>("depts"),
        storeGet<Memo[]>("memos"),
        storeGet<Record<string, MemoComment[]>>("comments"),
        storeGet<Record<string, ChatMessage[]>>("chats"),
        storeGet<TimetableCell[]>("tt"),
        storeGet<SwapRecord[]>("swaps"),
        storeGet<NoticeItem[]>("notices"),
        storeGet<AuditLog[]>("audits"),
        storeGet<number>("cache"),
        storeGet<boolean>("purge"),
        storeGet<boolean>("netauto"),
        // 관리자 데이터
        storeGet<AdminUser[]>("adminUsers"),
        storeGet<AdminNotice[]>("adminNotices"),
        storeGet<AdminAuditLog[]>("adminAudits"),
        storeGet<TimetableTemplate[]>("templates"),
        storeGet<GradeClass[]>("gradeClasses"),
        storeGet<School>("schoolInfo"),
        storeGet<SchoolSettings>("schoolSettings"),
        storeGet<ActiveView[]>("nav-hidden"),
        storeGet<ActiveView[]>("nav-order"),
      ]);
      setHasProfile(got[0]);
      if (got[1]) setNet(got[1] as NetworkState);
      if (got[2]) setMeStatus(normalizeStatus(got[2]));
      if (got[3] != null) setAutoStatus(got[3] as boolean);
      if (got[4] != null) setFont(normalizeFontKind(got[4]));
      if (got[5]) setSchool(got[5] as SchoolSetup);
      if (got[6]) setTeachers((got[6] as Teacher[]).map((t) => ({ ...t, status: normalizeStatus(t.status) })));
      if (got[7]) setDepts(got[7] as DeptGroup[]);
      if (got[8]) setMemos(got[8] as Memo[]);
      if (got[9]) setComments(got[9] as Record<string, MemoComment[]>);
      if (got[10]) setChats(got[10] as Record<string, ChatMessage[]>);
      if (got[11]) setCells(got[11] as TimetableCell[]);
      if (got[12]) setSwaps(got[12] as SwapRecord[]);
      if (got[13]) {
        const raw = got[13] as NoticeItem[];
        setNotices(raw.map((n) => ({ ...n, scope: (n.scope ?? "all") as "all" | "dept", dept: n.dept ?? "" })));
      }
      if (got[14]) setAudits(got[14] as AuditLog[]);
      if (got[15] != null) setCacheUsed(got[15] as number);
      if (got[16] != null) setAutoPurge(got[16] as boolean);
      if (got[17] != null) setNetAuto(got[17] as boolean);
      // 관리자 데이터
      if (got[18]) setAdminUsers(got[18] as AdminUser[]);
      if (got[19]) setAdminNotices(got[19] as AdminNotice[]);
      if (got[20]) setAdminAudits(got[20] as AdminAuditLog[]);
      if (got[21]) setTemplates(got[21] as TimetableTemplate[]);
      if (got[22]) setGradeClasses(got[22] as GradeClass[]);
      if (got[23]) setSchoolInfo(got[23] as School);
      if (got[24]) setSchoolSettings(got[24] as SchoolSettings);
      if (Array.isArray(got[25])) setHiddenTabs(got[25] as ActiveView[]);
      if (Array.isArray(got[26])) setTabOrder(got[26] as ActiveView[]);
      const my = (got[6] as Teacher[] | null)?.find((t) => t.id === ME_ID);
      if (got[0] && my) syncMe(my.name);
      setBooted(true);
      void hydrateMemos().then((remote) => {
        if (remote && remote.length) setMemos((s) => mergeMemos(s, remote));
      });
      const tt = got[11] as TimetableCell[] | null;
      if (tt && tt.length) void syncTimetable(tt, "부팅 동기화");
    })();
  }, []);

  // 바뀌면 로컬 DB에 저장 (설치형이므로 서버 전송 없음)
  useEffect(() => { if (booted) storeSet("net", net); }, [net, booted]);
  // 사이드 메뉴 숨김·순서는 이 PC에만 저장한다.
  useEffect(() => { if (booted) void storeSet("nav-hidden", hiddenTabs); }, [hiddenTabs, booted]);
  useEffect(() => { if (booted) void storeSet("nav-order", tabOrder); }, [tabOrder, booted]);
  // 관리자 전용 화면은 학교 관리자 계정으로 로그인했을 때만 열린다.
  useEffect(() => {
    if (serverRole !== "admin" && String(view).startsWith("admin-")) setView("org");
  }, [serverRole, view]);
  // 망 모드를 코어(Rust)에도 알린다. 미리보기에서는 무시된다.
  useEffect(() => {
    if (!booted) return;
    call<string>("net_set_mode", { mode: net }).catch(() => undefined);
  }, [net, booted]);
  // 외부망으로 벗어나면 교내망 이웃 목록을 비운다 (내부망 채팅방이 목록에서 사라지는 효과)
  useEffect(() => {
    if (net !== "intranet") setPeers([]);
  }, [net]);
  // 내 표시 이름을 코어에도 알린다 (원격 요청 보낸 사람 이름용)
  function syncMe(name: string) {
    call("me_set", { uid: ME_ID, name }).catch(() => undefined);
  }

  const refreshPeers = async () => {
    try {
      const list = await call<Peer[]>("peer_list");
      setPeers(list);
      const ids = new Set(list.map((pc) => pc.node_id));
      setTeachers((ts) => {
        const have = new Set(ts.map((t) => t.id));
        const fresh = list.filter((pc) => !have.has(pc.node_id)).map((pc) => ({
          id: pc.node_id, name: pc.name || pc.node_id, dept: "교내망", subject: "",
          position: "교내망 PC", grade: "", classNo: "", avatarColor: nextAvatar(pc.name || pc.node_id),
          status: "online" as const, statusMessage: pc.address || "교내망", ip: pc.address || "",
          subCount: 0, phone: "",
        }));
        const base = fresh.length ? [...ts, ...fresh] : ts;
        return base.map((t) => (t.position === "교내망 PC" && t.id !== ME_ID
          ? { ...t, status: (ids.has(t.id) ? "online" : "away") as Teacher["status"], statusMessage: ids.has(t.id) ? "교내망" : "꺼져 있음" }
          : t));
      });
      setDepts((ds) => {
        const peerIds = list.map((pc) => pc.node_id);
        const ix = ds.findIndex((d) => d.name === "교내망");
        if (ix >= 0) {
          const merged = [...new Set([...ds[ix].members, ...peerIds])];
          return ds.map((d, j) => (j === ix ? { ...d, members: merged } : d));
        }
        return peerIds.length ? [...ds, { id: `d-net-${Date.now()}`, name: "교내망", members: peerIds }] : ds;
      });
    } catch {
      /* 다음에 */
    }
  };

  useEffect(() => {
    if (booted && hasProfile && view === "org") void refreshPeers();
  }, [booted, hasProfile, view]);

  // 학교 서버(onprem)에 연결되면 학교 계정(조직도)을 불러와 합친다.
  const applyServerOrg = (users: ServerUser[], tree: ServerDeptNode[]) => {
    const deptName = new Map<number, string>();
    const groups: { id: string; name: string; members: string[] }[] = [];
    const walk = (nodes: ServerDeptNode[]) => {
      nodes.forEach((n) => {
        deptName.set(n.id, n.name);
        groups.push({ id: `sd-${n.id}`, name: n.name, members: [] });
        walk(n.children || []);
      });
    };
    walk(tree);
    const mapped: Teacher[] = users.map((u) => ({
      id: String(u.id),
      name: u.real_name || u.username,
      dept: deptName.get(u.department_id as number) || "미지정",
      subject: "",
      position: u.role === "ADMIN" ? "관리자" : u.role === "STAFF" ? "행정" : "교사",
      grade: "",
      classNo: "",
      avatarColor: nextAvatar(u.real_name || u.username),
      status: normalizeStatus(u.status),
      statusMessage: u.status_message || "",
      ip: "",
      subCount: 0,
      phone: "",
    }));
    setTeachers((prev) => {
      const byId = new Map(prev.map((t) => [t.id, t]));
      for (const t of mapped) byId.set(t.id, t);
      return [...byId.values()];
    });
    setDepts((prev) => {
      const byName = new Map(prev.map((d) => [d.name, d]));
      for (const g of groups) {
        const existing = byName.get(g.name);
        const members = mapped.filter((t) => t.dept === g.name).map((t) => t.id);
        byName.set(g.name, existing ? { ...existing, members: [...new Set([...existing.members, ...members])] } : { ...g, members });
      }
      return [...byName.values()];
    });
  };

  useEffect(() => {
    if (!booted || !hasProfile || popupMode) return;
    let alive = true;
    const tick = async () => {
      try {
        const st = await call<{ connected: boolean }>("srv_status");
        if (!alive) return;
        if (!st?.connected) {
          srvLoadedRef.current = false;
          return;
        }
        if (srvLoadedRef.current) return;
        srvLoadedRef.current = true;
        const uRes = await call<{ users?: ServerUser[] }>("srv_get", { path: "/api/users" });
        const tRes = await call<{ tree?: ServerDeptNode[] }>("srv_get", { path: "/api/departments/tree" });
        if (!alive) return;
        applyServerOrg(uRes?.users ?? [], tRes?.tree ?? []);
        toast("학교 서버 계정을 불러왔어요.");
      } catch {
        srvLoadedRef.current = false;
      }
    };
    const id = setInterval(tick, 8000);
    tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, hasProfile]);
  useEffect(() => { if (booted) storeSet("status", meStatus); }, [meStatus, booted]);
  useEffect(() => { if (booted) storeSet("autostatus", autoStatus); }, [autoStatus, booted]);
  useEffect(() => { if (booted) storeSet("netauto", netAuto); }, [netAuto, booted]);
  useEffect(() => {
    if (!booted) return;
    storeSet("font", font);
    try {
      const opt = FONT_OPTIONS.find((f) => f.id === font);
      document.body.style.fontFamily = opt ? opt.stack : FONT_OPTIONS[0].stack;
    } catch { /* 다음에 */ }
  }, [font, booted]);
  useEffect(() => { if (booted) storeSet("school", school); }, [school, booted]);
  useEffect(() => { if (booted) storeSet("teachers", teachers); }, [teachers, booted]);
  useEffect(() => { if (booted) storeSet("depts", depts); }, [depts, booted]);
  useEffect(() => { if (booted) storeSet("memos", memos); }, [memos, booted]);
  useEffect(() => { if (booted) storeSet("comments", comments); }, [comments, booted]);
  useEffect(() => { if (booted) storeSet("chats", chats); }, [chats, booted]);
  useEffect(() => { if (booted) storeSet("tt", cells); }, [cells, booted]);
  useEffect(() => { if (booted) storeSet("swaps", swaps); }, [swaps, booted]);
  useEffect(() => { if (booted) storeSet("notices", notices); }, [notices, booted]);
  useEffect(() => { if (booted) storeSet("audits", audits); }, [audits, booted]);
  useEffect(() => { if (booted) storeSet("cache", cacheUsed); }, [cacheUsed, booted]);
  useEffect(() => { if (booted) storeSet("purge", autoPurge); }, [autoPurge, booted]);
  useEffect(() => { if (booted) storeSet("adminUsers", adminUsers); }, [adminUsers, booted]);
  useEffect(() => { if (booted) storeSet("adminNotices", adminNotices); }, [adminNotices, booted]);
  useEffect(() => { if (booted) storeSet("adminAudits", adminAudits); }, [adminAudits, booted]);
  useEffect(() => { if (booted) storeSet("templates", templates); }, [templates, booted]);
  useEffect(() => { if (booted) storeSet("gradeClasses", gradeClasses); }, [gradeClasses, booted]);
  useEffect(() => { if (booted) storeSet("schoolInfo", schoolInfo); }, [schoolInfo, booted]);
  useEffect(() => { if (booted) storeSet("schoolSettings", schoolSettings); }, [schoolSettings, booted]);

  const me = teachers.find((t) => t.id === ME_ID) ?? null;
  meRef.current = me;
  teachersRef.current = teachers;
  swapsRef.current = swaps;
  chatsRef.current = chats;
  memosRef.current = memos;
  netRef.current = net;
  const chatOnly = (license?.kind ?? "full") === "chatOnly";

  // 하이브리드 망: 내부망을 벗어나면 교내망 채팅방·조직을 목록에서 숨긴다 (서버엔 남아 있음 → 복귀 시 복원)
  const intranetOn = intranetVisible(net, license);
  const externalOnly = isExternalOnlySchool(license);
  const dualNetwork = isDualNetworkSchool(license);
  const visibleTeachers = useMemo(
    () => (intranetOn ? teachers : teachers.filter((t) => !isIntranetScoped(t))),
    [teachers, intranetOn]
  );
  const visibleDepts = useMemo(
    () => (intranetOn ? depts : depts.filter((d) => d.name !== "교내망")),
    [depts, intranetOn]
  );
  const visibleTeacherIds = useMemo(() => new Set(visibleTeachers.map((t) => t.id)), [visibleTeachers]);

  // 숨겨진(교내망) 상대가 선택돼 있으면 선택을 푼다
  useEffect(() => {
    if (chatPeer && !visibleTeacherIds.has(chatPeer.id)) setChatPeer(null);
    if (memoPreset && !visibleTeacherIds.has(memoPreset.id)) setMemoPreset(null);
  }, [visibleTeacherIds, chatPeer, memoPreset]);

  // 연결 자동 전환 (§5-③): 교내망 PC가 보이면 교내연결, 3회 연속 안 보이면 외부연결로
  useEffect(() => {
    if (!booted || !hasProfile || !netAuto || externalOnly || popupMode) return;
    let alive = true;
    const check = async () => {
      try {
        const list = await call<Peer[]>("peer_list");
        if (!alive) return;
        if (list.length > 0) {
          noPeerTicks.current = 0;
          if (netRef.current !== "intranet") {
            setNet("intranet");
            toast("🟢 교내망 PC를 찾아 교내연결로 자동 전환했어요.");
          }
        } else {
          noPeerTicks.current += 1;
          if (netRef.current === "intranet" && noPeerTicks.current >= 3) {
            setNet("external");
            toast("☁️ 교내망 PC가 보이지 않아 외부연결로 자동 전환했어요.");
          }
        }
      } catch {
        /* 다음 검사에 다시 */
      }
    };
    const first = setTimeout(check, 6000);
    const loop = setInterval(check, 45000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(loop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, hasProfile, netAuto, externalOnly]);

  // 교내망 PC를 명단에 올린다. 주고받는 상대가 실제 PC와 이어지게 하기 위해서다.
  const ensurePeerTeacher = (nodeId: string, name: string) => {
    if (!nodeId || nodeId === ME_ID) return;
    const label = name || nodeId;
    setTeachers((ts) => {
      if (ts.some((t) => t.id === nodeId)) return ts;
      return [...ts, {
        id: nodeId, name: label, dept: "교내망", subject: "", position: "교내망 PC",
        grade: "", classNo: "", avatarColor: nextAvatar(label), status: "online",
        statusMessage: "교내망", ip: "", subCount: 0, phone: "",
      }];
    });
    setDepts((ds) => {
      const ix = ds.findIndex((d) => d.name === "교내망");
      if (ix >= 0) {
        if (ds[ix].members.includes(nodeId)) return ds;
        return ds.map((d, j) => (j === ix ? { ...d, members: [...d.members, nodeId] } : d));
      }
      return [...ds, { id: `d-net-${Date.now()}`, name: "교내망", members: [nodeId] }];
    });
  };

  // P2P 도착: 쪽지·대화·댓글·읽음·재촉을 목록에 바로 넣는다.
  useEffect(() => {
    const offs = [
      listenEvent("memo-arrived", (pl) => {
        const ev = pl as { id: string; title: string; body: string; from: string; from_name: string; from_role?: string } | null;
        if (!ev || !ev.id || ev.from === ME_ID) return;
        const myName = meRef.current?.name ?? "";
        setMemos((s) => {
          if (s.some((m) => m.id === ev.id)) return s;
          return [{
            id: ev.id, title: ev.title || "(제목 없음)", body: ev.body || "",
            fromUid: ev.from, fromName: ev.from_name || ev.from,
            to: [{ uid: ME_ID, name: myName, readAt: null, nudgedAt: null }],
            importance: "normal" as const, hwpName: "", hwpSize: 0, createdAt: nowIso(),
          }, ...s];
        });
        ensurePeerTeacher(ev.from, ev.from_name || ev.from);
        // Focus Mode(퇴근 후 휴식) 동안에는 알림 토스트를 띄우지 않는다 (목록·뱃지는 그대로 쌓인다)
        if (!focusActiveRef.current) {
          if (String(ev.from_role || '').toUpperCase() === 'STUDENT') {
            playStudentChime();
            toastMain(`🎓 ${ev.from_name || "학생"} 학생이 새 메시지를 보냈어요.`);
          } else {
            toastMain(`${ev.from_name || "상대"}에게 쪽지가 왔어요.`);
          }
        }
      }),
      listenEvent("chat-arrived", (pl) => {
        const ev = pl as { kind: string; id: string; ref_id: string; body: string; from: string; from_name: string } | null;
        if (!ev || ev.from === ME_ID) return;
        if (ev.kind === "quick" && ev.id) {
          ensurePeerTeacher(ev.from, ev.from_name || ev.from);
          setChats((s) => {
            const list = s[ev.from] ?? [];
            if (list.some((m) => m.id === ev.id)) return s;
            return { ...s, [ev.from]: [...list, { id: ev.id, peerId: ev.from, mine: false, body: ev.body || "", createdAt: nowIso(), read: false, emoji: [] }] };
          });
          if (!focusActiveRef.current) toastMain(`${ev.from_name || "상대"}에게 대화가 왔어요.`);
        } else if (ev.kind === "comment" && ev.ref_id && ev.id) {
          setComments((s) => {
            const list = s[ev.ref_id] ?? [];
            if (list.some((c) => c.id === ev.id)) return s;
            return { ...s, [ev.ref_id]: [...list, { id: ev.id, memoId: ev.ref_id, fromUid: ev.from, fromName: ev.from_name || ev.from, body: ev.body || "", createdAt: nowIso() }] };
          });
        }
      }),
      listenEvent("peer-read", (pl) => {
        const ev = pl as { ref_id: string; from: string } | null;
        if (!ev || !ev.ref_id) return;
        setMemos((s) => s.map((m) => (m.id === ev.ref_id
          ? { ...m, to: m.to.map((r) => (r.uid === ev.from ? { ...r, readAt: r.readAt ?? nowIso() } : r)) }
          : m)));
      }),
      listenEvent("nudge-arrived", (pl) => {
        const ev = pl as { ref_id: string; from_name: string } | null;
        if (!ev || !ev.ref_id) return;
        setMemos((s) => s.map((m) => (m.id === ev.ref_id
          ? { ...m, to: m.to.map((r) => (r.uid === ME_ID ? { ...r, nudgedAt: nowIso() } : r)) }
          : m)));
        if (!focusActiveRef.current) toastMain(`${ev.from_name || "상대"}이 확인을 요청했어요.`);
      }),
      listenEvent("substitute-arrived", (pl) => {
        const ev = pl as { ref_id?: string; from?: string; from_name?: string; title?: string; body?: string } | string | null;
        const o = typeof ev === "string" ? { ref_id: ev } : ev ?? {};
        const refId = String(o.ref_id ?? "");
        const fromUid = String(o.from ?? "");
        const fromName = String(o.from_name ?? "상대");
        if (!refId || fromUid === ME_ID) return;
        // 세부 파싱 (신규 JSON → 구형 제목 파싱 순)
        let weekday = 1, period = 1, grade = "", classNo = "", subject = "수업", date = "";
        try {
          const j = JSON.parse(String(o.body ?? ""));
          if (j && typeof j === "object") {
            weekday = Number(j.weekday) || weekday; period = Number(j.period) || period;
            grade = String(j.grade ?? ""); classNo = String(j.class_no ?? j.classNo ?? "");
            subject = String(j.subject ?? subject); date = String(j.date ?? "");
          }
        } catch { /* 구형 페이로드 */ }
        if (!date) date = dateForWeekday(weekday);
        const myName = meRef.current?.name ?? "";
        setSwaps((s) => {
          if (s.some((x) => x.rustId === refId || x.id === refId)) return s;
          return [{
            id: uid("sw"), rustId: refId, date, weekday, period,
            fromTeacher: fromName, fromUid, fromClass: grade && classNo ? `${grade}-${classNo}` : "",
            toTeacher: myName, toUid: ME_ID, toClass: grade && classNo ? `${grade}-${classNo}` : "",
            grade, classNo, subject, status: "pending" as const, createdAt: nowIso(),
          }, ...s];
        });
        ensurePeerTeacher(fromUid, fromName);
        toastMain(`🔄 ${fromName}의 보강 요청이 왔어요. 시간표 탭에서 수락해 주세요.`);
      }),
      listenEvent("substitute-accepted", (pl) => {
        const ev = pl as { ref_id?: string; from_name?: string } | null;
        const refId = String(ev?.ref_id ?? "");
        if (!refId) return;
        const rec = swapsRef.current.find((x) => x.rustId === refId || x.id === refId);
        setSwaps((s) => s.map((x) => (x.rustId === refId || x.id === refId ? { ...x, status: "accepted" as const } : x)));
        if (rec) {
          const g = rec.grade ?? "", cn = rec.classNo ?? "";
          setCells((cs) => cs.map((c) =>
            c.weekday === rec.weekday && c.period === rec.period && (!g || c.grade === g) && (!cn || c.classNo === cn)
              ? { ...c, teacher: rec.toTeacher }
              : c
          ));
          setChangedKeys((prev) => {
            const n = new Set(prev);
            n.add(`${rec.weekday}-${rec.period}-${g}-${cn}`);
            return n;
          });
        }
        void persistSwapAccept(refId, true);
        toastMain(`✅ ${ev?.from_name || "상대"}가 보강을 수락했어요. 시간표에 반영했어요.`);
      }),
      listenEvent("substitute-rejected", (pl) => {
        const ev = pl as { ref_id?: string; from_name?: string } | null;
        const refId = String(ev?.ref_id ?? "");
        if (!refId) return;
        setSwaps((s) => s.map((x) => (x.rustId === refId || x.id === refId ? { ...x, status: "rejected" as const } : x)));
        void persistSwapAccept(refId, false);
        toastMain(`↩️ ${ev?.from_name || "상대"}가 보강을 거절했어요.`);
      }),
    ];
    return () => { offs.forEach((off) => off()); };
  }, []);

  // SQLite에 쌓인 대화를 화면 목록에 덧붙인다 (이미 있는 것은 중복 제외,
  // 같은 말을 여러 번 보냈을 때를 위해 개수만큼만 걸러낸다)
  const refreshQuick = (peerId: string) => {
    void fetchQuicks(peerId).then((rows) => {
      if (!rows || !rows.length) return;
      setChats((s) => {
        const list = s[peerId] ?? [];
        const haveIds = new Set(list.map((m) => m.id));
        const localMineCount = new Map<string, number>();
        list.filter((m) => m.mine).forEach((m) => {
          localMineCount.set(m.body, (localMineCount.get(m.body) ?? 0) + 1);
        });
        const skipped = new Map<string, number>();
        const fresh = rows.filter((q) => {
          if (haveIds.has(q.id)) return false;
          if (q.mine) {
            const allowed = localMineCount.get(q.body) ?? 0;
            const used = skipped.get(q.body) ?? 0;
            if (used < allowed) {
              skipped.set(q.body, used + 1);
              return false;
            }
          }
          return true;
        });
        if (!fresh.length) return s;
        return { ...s, [peerId]: [...list, ...fresh] };
      });
    });
  };

  // 창 사이 동기화: 팝업 창에서 쪽지를 보내거나 읽음·수락하면 이 창도 바로 따라온다.
  // (SQLite·스크래치 저장소가 진실이고, 이벤트는 "다시 읽어라" 신호일 뿐이다)
  useEffect(() => {
    const off = listenEvent("breeze-sync", (pl) => {
      const ev = pl as { scope?: string; peer?: string; memo?: string; swap?: string; status?: string; urgent?: NoticeItem } | null;
      const scope = ev?.scope ?? "";
      if (!scope) return;
      if (scope === "memos") {
        void hydrateMemos().then((rows) => {
          if (rows && rows.length) setMemos((s) => mergeMemos(s, rows));
        });
      } else if (scope === "memo-read" && ev?.memo) {
        const id = ev.memo;
        setMemos((s) => s.map((m) => (m.id === id
          ? { ...m, to: m.to.map((r) => (r.uid === ME_ID && !r.readAt ? { ...r, readAt: nowIso() } : r)) }
          : m)));
      } else if (scope === "comments" && ev?.memo) {
        const id = ev.memo;
        void fetchComments(id).then((rows) => {
          if (!rows || !rows.length) return;
          setComments((s) => {
            const list = s[id] ?? [];
            const have = new Set(list.map((c) => c.id));
            const fresh = rows.filter((c) => !have.has(c.id));
            if (!fresh.length) return s;
            return { ...s, [id]: [...list, ...fresh] };
          });
        });
      } else if (scope === "chats") {
        const ids = ev?.peer ? [ev.peer] : Object.keys(chatsRef.current);
        for (const pid of ids) refreshQuick(pid);
      } else if (scope === "swap-answer" && ev?.swap) {
        const key = ev.swap;
        const status = ev.status === "rejected" ? "rejected" : "accepted";
        const rec = swapsRef.current.find((x) => x.id === key || x.rustId === key) ?? null;
        setSwaps((s) => s.map((x) => (x.id === key || x.rustId === key ? { ...x, status } : x)));
        if (rec && status === "accepted") {
          const g = rec.grade ?? meRef.current?.grade ?? "";
          const cn = rec.classNo ?? meRef.current?.classNo ?? "";
          setCells((cs) => cs.map((c) =>
            c.weekday === rec.weekday && c.period === rec.period && (!g || c.grade === g) && (!cn || c.classNo === cn)
              ? { ...c, teacher: rec.toTeacher }
              : c
          ));
        }
      } else if (scope === "notices") {
        void storeGet<NoticeItem[]>("notices").then((rows) => {
          if (rows && rows.length) {
            setNotices(rows.map((n) => ({ ...n, scope: (n.scope ?? "all") as "all" | "dept", dept: n.dept ?? "" })));
          }
        });
        if (ev?.urgent) setEmergency(ev.urgent);
      } else if (scope === "admin") {
        void storeGet<AdminUser[]>("adminUsers").then((v) => { if (v) setAdminUsers(v); });
        void storeGet<AdminNotice[]>("adminNotices").then((v) => { if (v) setAdminNotices(v); });
        void storeGet<TimetableTemplate[]>("templates").then((v) => { if (v) setTemplates(v); });
        void storeGet<GradeClass[]>("gradeClasses").then((v) => { if (v) setGradeClasses(v); });
        void storeGet<School>("schoolInfo").then((v) => { if (v) setSchoolInfo(v); });
        void storeGet<SchoolSettings>("schoolSettings").then((v) => { if (v) setSchoolSettings(v); });
      } else if (scope === "ui") {
        syncUiFromStorage();
      } else if (scope === "prefs" && !popupMode) {
        void storeGet<boolean>("autostatus").then((v) => { if (v != null) setAutoStatus(v); });
        void storeGet<boolean>("netauto").then((v) => { if (v != null) setNetAuto(v); });
        void storeGet<FontKind>("font").then((v) => { if (v != null) setFont(normalizeFontKind(v)); });
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 팝업 창에서 관리자 자료·공지·대강 현황이 바뀌면 잠시 뒤(저장 완료 뒤) 메인 창에 알린다.
  useEffect(() => {
    if (!popupMode || !booted) return;
    const t = setTimeout(() => {
      emitEvent("breeze-sync", { scope: "admin" });
      emitEvent("breeze-sync", { scope: "notices" });
      emitEvent("breeze-sync", { scope: "swaps" });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminUsers, adminNotices, adminAudits, templates, gradeClasses, schoolInfo, schoolSettings, notices, swaps]);

  // 팝업이 "이 사람에게 쪽지 쓰기"처럼 열릴 때: 교사 목록이 실린 뒤 대상을 고른다.
  useEffect(() => {
    if (!popupMode || !booted || !popupTo) return;
    const t = teachers.find((x) => x.id === popupTo);
    if (t) setMemoPreset(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupMode, booted, popupTo, teachers]);

  // 이미 열린 팝업에 "이 쪽지를 보여줘 / 이 사람에게 쪽지 써줘" 신호가 오면 적용한다.
  useEffect(() => {
    if (!popupMode) return;
    const off = listenEvent("popup-apply", (pl) => {
      const ev = pl as { view?: string; params?: Record<string, string> } | null;
      if (!ev || ev.view !== popupView) return;
      const to = ev.params?.to;
      if (to) {
        const t = teachersRef.current.find((x) => x.id === to);
        if (t) { setMemoPreset(t); setView("memo"); }
      }
      const memoId = ev.params?.memo;
      if (memoId) {
        openMemoRef.current?.(memoId);
        setView("memo");
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupMode, popupView]);

  // 팝업(설정 창)에서 화면 설정·폰트·자동 상태를 바꾸면 메인 창에도 알린다.
  useEffect(() => {
    if (!popupMode || !booted) return;
    const t = setTimeout(() => {
      emitEvent("breeze-sync", { scope: "ui" });
      emitEvent("breeze-sync", { scope: "prefs" });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, autoStatus, netAuto, layout, motion, darkMode, toastOn, offWork]);

  const refreshLicense = async (sid?: string) => {
    const id = (sid ?? school.schoolId).trim();
    if (!id) return;
    try {
      const lic = await fetchSchoolLicense(id);
      setLicense(lic);
    } catch {
      /* 이용권 없음/조회 실패 → 전체 기능 기본값 유지 */
    }
  };

  // 학교가 정해지면 이용권 상태를 한 번 가져온다
  useEffect(() => {
    if (booted && hasProfile && school.schoolId.trim() && !license) refreshLicense();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, hasProfile]);

  // 1분마다 수업중 판정 (시간표 연동 자동 상태)
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const classNow = useMemo(() => {
    void nowTick;
    if (chatOnly || !me) return null;
    const pn = periodNow();
    if (!pn) return null;
    const wd = new Date().getDay();
    if (wd < 1 || wd > 5) return null;
    const mine =
      cells.find((c) => c.weekday === wd && c.period === pn.period && c.grade === me.grade && c.classNo === me.classNo) ??
      cells.find((c) => c.weekday === wd && c.period === pn.period && c.teacher === me.name);
    if (!mine) return null;
    return { ...pn, subject: mine.subject, room: mine.room };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick, cells, chatOnly, me?.grade, me?.classNo, me?.name]);

  // 스마트 출결: 평일 12:30~13:30 점심시간 자동 전환 (수업 중이면 수업 우선)
  const lunchNow = useMemo(() => {
    void nowTick;
    if (chatOnly || !me) return false;
    return isLunchTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick, chatOnly, me]);

  // 자동 상태: Focus Mode(퇴근 후 휴식) + 수업 시간(in_class) + 점심시간(lunch) 반영
  useEffect(() => {
    if (chatOnly) return;
    setTeachers((ts) =>
      ts.map((t) => {
        if (t.id !== ME_ID) return t;
        // Focus Mode — 온라인이면 "자리 비움 + 퇴근 후 업무 휴식 중"
        if (focusActive && (t.status === "online" || (autoStatus && classNow && t.status === "in_class"))) {
          return { ...t, status: "away" as TeacherStatus, statusMessage: FOCUS_MESSAGE };
        }
        if (!focusActive && t.status === "away" && t.statusMessage === FOCUS_MESSAGE && !classNow) {
          return { ...t, status: "online" as TeacherStatus, statusMessage: `${me?.grade ?? ""} ${me?.classNo ?? ""} 담임`.trim() };
        }
        if (!autoStatus) return t;
        if (classNow && (t.status === "online" || t.status === "in_class")) {
          return { ...t, status: "in_class" as TeacherStatus, statusMessage: `${classNow.period}교시 수업 중 (${me?.grade} ${me?.classNo} ${classNow.subject})` };
        }
        // 점심시간 자동 전환 (수업이 없을 때만) — 업무 가능/수업 중 상태에서만
        if (!classNow && lunchNow && (t.status === "online" || t.status === "in_class")) {
          return { ...t, status: "lunch" as TeacherStatus, statusMessage: LUNCH_AUTO_MESSAGE };
        }
        // 점심시간이 끝나면 자동 점심 → 온라인 복원 (수동으로 고른 점심은 그대로 둔다)
        if (!classNow && !lunchNow && t.status === "lunch" && t.statusMessage === LUNCH_AUTO_MESSAGE) {
          return { ...t, status: "online" as TeacherStatus, statusMessage: `${me?.grade} ${me?.classNo} 담임` };
        }
        if (!classNow && t.status === "in_class" && /수업 중/.test(t.statusMessage)) {
          return { ...t, status: "online" as TeacherStatus, statusMessage: `${me?.grade} ${me?.classNo} 담임` };
        }
        return t;
      })
    );
  }, [classNow, lunchNow, autoStatus, chatOnly, focusActive, me?.grade, me?.classNo]);

  // 긴급 공지: 중앙 팝업 + 사이렌 + AI 3줄 요약 (Focus Mode에서도 항상 울린다 — 안전 규칙)
  useEffect(() => {
    if (!emergency) {
      setEmgSummary(null);
      return;
    }
    let alive = true;
    if (sirenOn) playSiren(7);
    void summarize3(`${emergency.title}\n${emergency.body}`).then((r) => {
      if (alive) setEmgSummary(r.lines);
    });
    return () => {
      alive = false;
      stopSiren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emergency?.id, sirenOn]);

  const toast = (text: string) => {
    try {
      if (useEdu.getState().toastOn === false) return;
    } catch {
      /* 그대로 표시 */
    }
    const id = toastSeq++;
    // 글이 길수록 조금 더 머물되, 너무 오래 화면을 가리지 않는다.
    const durationMs = Math.max(3200, Math.min(6500, 2200 + Array.from(text).length * 28));
    // 웹 브리즈처럼 한 번에 하나만: 새 알림이 오면 이전 알림은 위로 스르륵 빠지며 사라진다.
    setToasts((s) => [...s.map((t) => ({ ...t, leaving: true })), { id, text, durationMs }].slice(-3));
    window.setTimeout(() => dismissToast(id), durationMs);
  };

  // 사라질 때 모션(0.26s 위로 상승)을 보여 준 뒤 실제로 지운다 — "뚝" 끊기지 않게.
  const dismissToast = (id: number) => {
    setToasts((s) => s.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((s) => s.filter((t) => t.id !== id)), 360);
  };

  const hideNavTab = (id: ActiveView) => {
    if (id === "settings") return;
    setHiddenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    if (view === id) setView("settings");
    toast("메뉴를 숨겼어요. 설정에서 언제든 다시 꺼낼 수 있어요.");
  };
  const restoreNavTab = (id: ActiveView) => {
    setHiddenTabs((prev) => prev.filter((x) => x !== id));
    toast("메뉴를 다시 표시했어요.");
  };
  const resetNavOrder = () => {
    setTabOrder([]);
    toast("메뉴 순서를 처음 상태로 되돌렸어요.");
  };

  // P2P 도착 알림은 메인 창에서만 띄운다 (팝업 창마다 뜨면 시끄럽다).
  const toastMain = (text: string) => {
    if (!popupMode) toast(text);
  };

  // 여러 창 모드: 대화를 새 창(chat-<id>)으로 띄운다. 실패하면 같은 창에서 연다.
  const windowMode = useEdu((s) => s.windowMode);
  const openDetached = async (peer: Teacher) => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const label = `chat-${peer.id}`.replace(/[^A-Za-z0-9._-]/g, "-");
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) { await existing.setFocus(); return; }
      const url = `index.html?win=chat&peer=${encodeURIComponent(peer.id)}&name=${encodeURIComponent(peer.name)}`;
      const w = new WebviewWindow(label, {
        url, width: 400, height: 620, minWidth: 320, minHeight: 380,
        title: `${peer.name} · 브리즈`, center: true, decorations: false, transparent: true,
      });
      // 생성 실패(권한 등)는 이벤트로 온다 — 조용히 넘어가지 않게 알린다.
      w.once("tauri://error", (e) => {
        toast(`새 창을 열지 못했어요. ${typeof e?.payload === "string" ? e.payload : ""}`);
      });
      // 새 창은 화면 가운데에 겹쳐 쌓이지 않게 계단식으로 놓는다
      w.once("tauri://created", () => {
        void call("place_popup", { label }).catch(() => undefined);
      });
    } catch {
      setChatPeer(peer);
      setView("chat");
    }
  };

  // 메뉴 팝업 창: 설정·쪽지함·시간표 등은 메인 창을 덮지 않고 새 창(?win=view)으로 연다.
  const POPUP_SIZES: Record<string, { w: number; h: number }> = {
    org: { w: 520, h: 680 },
    memo: { w: 880, h: 700 },
    chat: { w: 820, h: 640 },
    timetable: { w: 1040, h: 700 },
    work: { w: 880, h: 700 },
    consult: { w: 980, h: 760 },
    approval: { w: 900, h: 760 },
    whiteboard: { w: 1180, h: 780 },
    settings: { w: 520, h: 680 },
    audit: { w: 860, h: 640 },
  };
  const openPopup = async (v: ActiveView, extra?: Record<string, string>) => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const label = `view-${v}`.replace(/[^A-Za-z0-9._-]/g, "-");
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        // 이미 열려 있으면 "이 쪽지함의 이 내용으로" 같은 추가 정보만 다시 보낸다
        if (extra) void emitEvent("popup-apply", { view: v, params: extra });
        return;
      }
      const s = POPUP_SIZES[v] ?? (v.startsWith("admin-") ? { w: 1040, h: 720 } : { w: 800, h: 680 });
      const qs = new URLSearchParams({ win: "view", v });
      if (extra) for (const [k, val] of Object.entries(extra)) qs.set(k, val);
      const w = new WebviewWindow(label, {
        url: `index.html?${qs.toString()}`,
        width: s.w, height: s.h, minWidth: Math.min(s.w, 420), minHeight: 420,
        title: `${VIEW_TITLE[v] ?? "브리즈"} · 브리즈`,
        center: true, decorations: false, transparent: true,
      });
      w.once("tauri://error", (e) => {
        toast(`새 창을 열지 못했어요. ${typeof e?.payload === "string" ? e.payload : ""}`);
      });
      // 팝업이 화면 가운데에 똑같이 겹쳐 쌓이지 않게, 메인 창 옆에 계단식으로 놓는다
      w.once("tauri://created", () => {
        void call("place_popup", { label }).catch(() => undefined);
      });
    } catch {
      // 창 생성 자체가 안 되면 같은 창에서 연다 (미리보기 등)
      setView(v);
    }
  };

  // 창 작업 방식에 따른 화면 전환: multi면 메뉴는 새 팝업 창으로, single이면 같은 창에서 전환한다.
  const goView = (v: ActiveView) => {
    // 외부망에서는 무거운 클라우드로 들어가지 않고, 중앙 안내 모달을 띄운다.
    if (v === "cloud" && dualNetwork && net === "external") {
      setView("cloud");
      return;
    }
    // 조직도는 "메인 창의 기본 화면"이라 창을 새로 띄우지 않는다.
    if (v !== "org" && v !== "login" && windowMode === "multi" && isTauriDesktop() && v !== view) {
      void openPopup(v);
      return;
    }
    setView(v);
  };
  // 퀵 메모 → 쪽지 초안으로 옮긴다 (받는 사람은 사용자가 직접 고른다)
  const sendQuickToMemo = (text: string, sourceTitle?: string) => {
    setMemoDraft({ title: sourceTitle && sourceTitle !== "퀵 메모" ? sourceTitle : "", body: text });
    useQuick.getState().setLayerOpen(false);
    setView("memo");
    toast("퀵 메모를 쪽지 초안으로 옮겼어요. 받는 사람을 골라 보내 주세요.");
  };
  const toggleQuickMemos = () => {
    const q = useQuick.getState();
    if (!q.layerOpen) q.setLayerOpen(true);
    else if (!q.barOpen) q.setBarOpen(true);
    else q.setLayerOpen(false);
  };
  const switchNet = (next: NetworkState) => {
    if (!dualNetwork) return;
    setNetAuto(false);
    setNet((prev) => {
      if (prev === next) return prev;
      toast(next === "intranet" ? "🔵 교내연결로 바꿨어요." : "🟢 외부연결로 바꿨어요.");
      void api.logActivity("network_switch", { from: prev, to: next });
      return next;
    });
  };
  const handleOpenChat = (peer: Teacher) => {
    if (windowMode === "multi" && isTauriDesktop()) { void openDetached(peer); return; }
    setChatPeer(peer);
    setView("chat");
  };

  const audit = (kind: AuditLog["kind"], text: string, blocked: boolean) => {
    setAudits((s) => [
      { id: uid("a"), createdAt: nowIso(), kind, ruleId: kind === "RRN" ? "RRN-01" : kind === "PHONE" ? "PHONE-01" : kind === "SCORE" ? "SCORE-02" : kind === "CARD" ? "CARD-01" : kind === "PASSWORD" ? "PW-01" : "HWP-01", text: text.slice(0, 120), score: blocked ? 0.92 : 0.6, blocked },
      ...s,
    ].slice(0, 200));
  };

  // P2P 전송 한 줄. 받는 쪽 목록에 바로 꽂히도록 같은 ID를 쓴다.
  // 외부망(클라우드 중계)에서는 직접 전송을 시도하지 않고 이 PC에만 저장한다.
  const transmit = async (nodeId: string, kind: string, title: string, body: string, refId: string) => {
    if (net !== "intranet") return true;
    try {
      await call("p2p_send", {
        node_id: nodeId, kind, title, body, ref_id: refId,
        firebase_cloud: isFirebaseCloudSchool(net, license),
      });
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "전송하지 못했어요.");
      return false;
    }
  };

  const isPeer = (id: string) => peers.some((pc) => pc.node_id === id);
  const [remoteIn, setRemoteIn] = useState<{ refId: string; from: string; fromName: string } | null>(null);
  const [remoteView, setRemoteView] = useState<{ nodeId: string; name: string; refId: string; img: string; waiting: boolean } | null>(null);
  const [sharing, setSharing] = useState<{ nodeId: string; name: string; refId: string; sending: boolean } | null>(null);
  const remoteViewRef = useRef<{ nodeId: string; name: string; refId: string; img: string; waiting: boolean } | null>(null);
  const sharingRef = useRef<{ nodeId: string; name: string; refId: string; sending: boolean } | null>(null);
  remoteViewRef.current = remoteView;
  sharingRef.current = sharing;

  useEffect(() => {
    const off = listenEvent("remote-view-arrived", (pl) => {
      const ev = pl as { event: string; ref_id: string; from: string; from_name: string; image_b64?: string } | null;
      if (!ev || typeof ev !== "object") return;
      if (ev.event === "request") {
        const sh = sharingRef.current;
        if (sh && sh.nodeId === ev.from && !sh.sending) {
          setSharing({ ...sh, sending: true });
          sendSnapshot(sh.nodeId, sh.refId)
            .catch((e) => toast(e instanceof Error ? e.message : "화면을 못 보냈어요."))
            .finally(() => setSharing((x) => (x ? { ...x, sending: false } : x)));
          return;
        }
        if (!sh) setRemoteIn({ refId: ev.ref_id, from: ev.from, fromName: ev.from_name || ev.from });
      } else if (ev.event === "accept") {
        const v = remoteViewRef.current;
        if (v && v.refId === ev.ref_id) {
          setRemoteView({ ...v, waiting: false });
          toast("수락했어요. 화면이 오고 있어요.");
        }
      } else if (ev.event === "decline") {
        const v = remoteViewRef.current;
        if (v && v.refId === ev.ref_id) {
          setRemoteView(null);
          toast("거절했어요.");
        }
      } else if (ev.event === "frame") {
        const v = remoteViewRef.current;
        const img = typeof ev.image_b64 === "string" ? ev.image_b64 : "";
        if (v && v.refId === ev.ref_id && img) {
          setRemoteView({ ...v, img: `data:image/jpeg;base64,${img}`, waiting: false });
        }
      } else if (ev.event === "bye") {
        const v = remoteViewRef.current;
        const s = sharingRef.current;
        if (v && v.refId === ev.ref_id) {
          setRemoteView(null);
          toast("연결이 끊겼어요.");
        } else if (s && s.refId === ev.ref_id) {
          setSharing(null);
          toast("연결이 끊겼어요.");
        }
        setRemoteIn((r) => (r && r.refId === ev.ref_id ? null : r));
      }
    });
    return off;
  }, []);

  const sendSnapshot = async (nodeId: string, refId: string) => {
    const s = await call<{ data_url: string }>("remote_snapshot");
    const comma = s.data_url.indexOf(",");
    const b64 = comma >= 0 ? s.data_url.slice(comma + 1) : s.data_url;
    await call("remote_view_frame", { node_id: nodeId, request_id: refId, image_b64: b64 });
  };

  const requestRemote = async (nodeId: string, label: string) => {
    const blocked = remoteBlockedReason(net, license);
    if (blocked) {
      toast(blocked);
      return;
    }
    try {
      const r = await call<{ request_id: string }>("remote_view_request", {
        node_id: nodeId,
        firebase_cloud: isFirebaseCloudSchool(net, license),
      });
      setRemoteView({ nodeId, name: label, refId: r.request_id, img: "", waiting: true });
      toast(`${label}에게 요청을 보냈어요.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "원격 지원을 걸지 못했어요.");
    }
  };

  const refreshRemoteView = async () => {
    const v = remoteViewRef.current;
    if (!v) return;
    const blocked = remoteBlockedReason(net, license);
    if (blocked) {
      toast(blocked);
      return;
    }
    try {
      const r = await call<{ request_id: string }>("remote_view_request", {
        node_id: v.nodeId,
        firebase_cloud: isFirebaseCloudSchool(net, license),
      });
      setRemoteView({ ...v, refId: r.request_id, waiting: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "화면을 못 받아왔어요.");
    }
  };

  const closeRemoteView = async () => {
    const v = remoteViewRef.current;
    setRemoteView(null);
    if (!v) return;
    try {
      await call("remote_view_bye", { node_id: v.nodeId, request_id: v.refId });
    } catch {
      /* 다음에 */
    }
  };

  const acceptRemote = async (allow: boolean) => {
    const r = remoteIn;
    setRemoteIn(null);
    if (!r) return;
    try {
      await call("remote_view_respond", { node_id: r.from, request_id: r.refId, accept: allow });
    } catch (e) {
      toast(e instanceof Error ? e.message : "응답하지 못했어요.");
      return;
    }
    if (!allow) return;
    setSharing({ nodeId: r.from, name: r.fromName, refId: r.refId, sending: true });
    try {
      await sendSnapshot(r.from, r.refId);
    } catch (e) {
      toast(e instanceof Error ? e.message : "화면을 못 보냈어요.");
    } finally {
      setSharing((s) => (s ? { ...s, sending: false } : s));
    }
  };

  const resendSharing = async () => {
    const s = sharingRef.current;
    if (!s || s.sending) return;
    setSharing({ ...s, sending: true });
    try {
      await sendSnapshot(s.nodeId, s.refId);
    } catch (e) {
      toast(e instanceof Error ? e.message : "화면을 못 보냈어요.");
    } finally {
      setSharing((x) => (x ? { ...x, sending: false } : x));
    }
  };

  const stopSharing = async () => {
    const s = sharingRef.current;
    setSharing(null);
    if (!s) return;
    try {
      await call("remote_view_bye", { node_id: s.nodeId, request_id: s.refId });
    } catch {
      /* 다음에 */
    }
    toast("공유를 끊었어요.");
  };

  const unreadMemo = memos.filter((m) => !m.recalledAt && m.to.some((r) => r.uid === ME_ID && !r.readAt)).length;
  const unreadChat = Object.entries(chats)
    .filter(([pid]) => visibleTeacherIds.has(pid))
    .flatMap(([, list]) => list)
    .filter((m) => !m.mine && !m.read).length;
  const pendingSwap = swaps.filter((s) => s.status === "pending").length;

  const sendMemo = (
    title: string,
    body: string,
    toIds: string[],
    hwpName: string,
    importance: Memo["importance"],
    extras?: MemoSendExtras
  ) => {
    if (!me) return { ok: false as const, error: "프로필이 없어요." };
    const ccIds = extras?.ccIds ?? [];
    const bccIds = extras?.bccIds ?? [];
    const allIds = Array.from(new Set([...toIds, ...ccIds, ...bccIds])).filter((id) => id !== ME_ID || extras?.toSelf);
    if (!allIds.length) return { ok: false as const, error: "받는 사람을 1명 이상 골라 주세요." };
    const mk = (id: string, tag?: { cc?: boolean; bcc?: boolean }) => {
      const t = teachers.find((x) => x.id === id) ?? (id === ME_ID ? me : undefined);
      return { uid: id, name: t?.name ?? id, readAt: null as string | null, nudgedAt: null as string | null, ...tag };
    };
    const to = [
      ...toIds.filter((id) => id !== ME_ID || extras?.toSelf).map((id) => mk(id)),
      ...ccIds.map((id) => mk(id, { cc: true })),
      ...bccIds.map((id) => mk(id, { bcc: true })),
    ];
    const reserved = extras?.reservedAt ?? null;
    const m: Memo = {
      id: uid("memo"), title, body, fromUid: ME_ID, fromName: me.name, to,
      importance, hwpName, hwpSize: 0,
      attachments: extras?.attachments?.length ? extras.attachments : undefined,
      toSelf: extras?.toSelf || undefined,
      reservedAt: reserved,
      sentAt: null,
      createdAt: nowIso(),
    };
    setMemos((s) => [m, ...s]);
    // 실제 저장(SQLite)·P2P 전송은 유예(7초) 또는 예약 시각까지 보류한다.
    // 네트워크가 끊겨 있으면 이 PC(IndexedDB) 보관함에 담았다가 연결되면 자동 전송한다.
    const finalize = () => {
      void persistMemo(m).then(() => emitEvent("breeze-sync", { scope: "memos" }));
      const targets = allIds.filter((id) => id !== ME_ID);
      if (!netOnlineRef.current) {
        void obPut(
          newOutboxItem({ id: m.id, kind: "memo", memo: { title: title.trim(), body: body.trim(), toIds: targets } })
        ).then(refreshOutbox);
        toastMain("📴 오프라인이에요. 보관함에 담아 두었다가 연결되면 자동으로 보내 드려요.");
        return;
      }
      for (const id of targets) {
        if (isPeer(id)) void transmit(id, "memo", title.trim(), body.trim(), m.id);
      }
    };
    if (reserved) {
      void persistMemo(m).then(() => emitEvent("breeze-sync", { scope: "memos" }));
      toast(`예약 쪽지를 등록했어요 · ${new Date(reserved).toLocaleString("ko-KR")}`);
    } else if (extras?.undo !== false) {
      // 7초 Undo Send — 취소하면 그 무엇도 저장·전송되지 않는다
      const timer = window.setTimeout(() => {
        undoHoldsRef.current.delete(m.id);
        finalize();
      }, 7000);
      undoHoldsRef.current.set(m.id, timer);
      toast(`쪽지를 보냈어요 · 7초 안에 취소할 수 있어요 (${allIds.length}명)`);
    } else {
      finalize();
      toast(`쪽지를 보냈어요 (${net === "intranet" ? "교내망 P2P" : "외부망 · 이 PC 저장"}) · ${allIds.length}명`);
    }
    return { ok: true as const, memoId: m.id };
  };

  // 7초 Undo 취소 — 대기 중인 전송을 취소하고 쪽지를 지운다
  const undoSendMemo = (memoId: string) => {
    const t = undoHoldsRef.current.get(memoId);
    if (t != null) {
      window.clearTimeout(t);
      undoHoldsRef.current.delete(memoId);
    }
    setMemos((s) => s.filter((m) => m.id !== memoId));
    toast("발송을 취소했어요. 아무곳에도 저장·전송되지 않았어요.");
  };

  // 읽기 전 회수 — 아무도 읽지 않았을 때만 표시가 남는다 (수신 쪽 목록에서 사라진다)
  const recallMemo = (memoId: string) => {
    setMemos((s) => s.map((m) => (m.id === memoId ? { ...m, recalledAt: nowIso() } : m)));
    // 오프라인 보관함에 남아 있으면 함께 지운다 (회수한 쪽지가 나중에 자동 전송되지 않게)
    void obDelete(memoId).then(refreshOutbox);
    emitEvent("breeze-sync", { scope: "memos" });
    toast("쪽지를 회수했어요.");
  };

  // 🚗 이중주차 차량 이동 요청 (Killer ②) — 전화번호 노출 없이 곧바로 쪽지+팝업으로 알린다.
  //  · 유예(Undo) 없이 바로 발송해 주차 상황을 빠르게 푼다.
  const requestCarMove = (t: Teacher, car: string) => {
    const r = sendMemo(
      "[차량 이동 요청]",
      `🚗 ${t.name} 선생님, 차량(${car}) 이동을 요청하셨어요.\n주차 위치를 확인해 주세요.`,
      [t.id],
      "",
      "urgent",
      { undo: false }
    );
    toastMain(r.ok ? `🚗 ${t.name} 선생님께 차량 이동 요청을 보냈어요.` : r.error || "요청을 보내지 못했어요.");
  };

  // 중요(별표) 토글 — 내 쪽지함에서만 쓰는 개인 표시
  const starMemo = (memoId: string, starred: boolean) => {
    setMemos((s) => s.map((m) => (m.id === memoId ? { ...m, starred } : m)));
    toast(starred ? "중요 쪽지로 표시했어요." : "중요 표시를 해제했어요.");
  };

  // 쪽지 → 퀵 메모(포스트잇) 저장
  const quickSaveMemo = (m: Memo) => {
    useQuick.getState().add({
      title: m.title,
      body: `${m.body}\n\n— ${m.fromName} · ${m.createdAt.slice(0, 16).replace("T", " ")}`,
    });
    toast("퀵 메모로 저장했어요. 왼쪽 [퀵 메모] 버튼에서 볼 수 있어요.");
  };

  // 예약 쪽지 스케줄러 — 20초마다 확인해 시간이 된 쪽지를 내보낸다
  useEffect(() => {
    const tick = window.setInterval(() => {
      const now = nowIso();
      const due = memosRef.current.filter((m) => m.fromUid === ME_ID && m.reservedAt && !m.sentAt && m.reservedAt <= now);
      if (!due.length) return;
      const offline = !netOnlineRef.current;
      for (const m of due) {
        void persistMemo({ ...m, sentAt: now });
        const targets = m.to.filter((r) => r.uid !== ME_ID);
        if (offline) {
          void obPut(
            newOutboxItem({
              id: m.id, kind: "memo",
              memo: { title: m.title, body: m.body, toIds: targets.map((r) => r.uid) },
            })
          );
          continue;
        }
        for (const r of targets) {
          if (isPeer(r.uid)) void transmit(r.uid, "memo", m.title, m.body, m.id);
        }
      }
      if (offline) refreshOutbox();
      emitEvent("breeze-sync", { scope: "memos" });
      setMemos((s) => s.map((m) => (due.some((d) => d.id === m.id) ? { ...m, sentAt: now } : m)));
      toast(
        offline
          ? `예약 쪽지 ${due.length}건을 오프라인 보관함에 담았어요. 연결되면 자동으로 보내 드려요.`
          : `예약 쪽지 ${due.length}건을 보냈어요.`
      );
    }, 20000);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendChat = (peerId: string, body: string) => {
    // 낙관적 UI: 먼저 임시 말풍선(🕒)을 띄우고, 저장이 끝나면 시각으로 확정한다
    const msg: ChatMessage = { id: uid("q"), peerId, mine: true, body, createdAt: nowIso(), read: false, emoji: [], pending: true };
    setChats((s) => ({ ...s, [peerId]: [...(s[peerId] ?? []), msg] }));
    const peerName = teachersRef.current.find((t) => t.id === peerId)?.name ?? peerId;
    const settle = (realId: string | null) => {
      setChats((s) => ({
        ...s,
        [peerId]: (s[peerId] ?? []).map((x) =>
          x.id === msg.id ? { ...x, id: realId && realId !== msg.id ? realId : x.id, pending: false } : x
        ),
      }));
    };
    // Rust가 돌려준 진짜 ID로 갈아끼운다 (INSERT 중복 방지)
    void persistQuick(peerId, peerName, body)
      .then(settle)
      .catch(() => settle(null))
      .finally(() => emitEvent("breeze-sync", { scope: "chats", peer: peerId }));
    if (isPeer(peerId)) {
      if (!netOnlineRef.current) {
        // 오프라인 — 보관함에 담았다가 연결이 돌아오면 자동 전송한다
        void obPut(newOutboxItem({ id: msg.id, kind: "chat", chat: { peerId, peerName, body } })).then(refreshOutbox);
      } else {
        void transmit(peerId, "quick", "", body, msg.id);
      }
    }
    return { ok: true };
  };

  // ── 오프라인 보관함 자동 전송 — 연결이 돌아오거나 교내 PC가 보이면 다시 보낸다 ──
  const flushingRef = useRef(false);
  useEffect(() => {
    if (!netOnline || outboxItems.length === 0 || flushingRef.current) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const items = outboxRef.current;
        if (!items.length) return;
        flushingRef.current = true;
        const isPeerNow = (id: string) => peersRef.current.some((pc) => pc.node_id === id);
        let sent = 0;
        let kept = 0;
        for (const it of items) {
          if (!netOnlineRef.current) break; // 다시 끊기면 중단 — 다음 기회에
          try {
            if (it.kind === "memo" && it.memo) {
              const alive = memosRef.current.find((m) => m.id === it.id && !m.recalledAt);
              if (!alive) { await obDelete(it.id); continue; } // 회수·삭제된 쪽지는 보내지 않는다
              const targets = it.memo.toIds.filter((uid2) => isPeerNow(uid2));
              if (!targets.length) { kept++; continue; } // 상대 PC가 아직 안 보임 → 다음 기회에
              let okAll = true;
              for (const uid2 of targets) {
                const ok = await transmit(uid2, "memo", it.memo.title, it.memo.body, it.id);
                if (!ok) okAll = false;
              }
              if (okAll) { await obDelete(it.id); sent++; }
              else { await obPut({ ...it, tries: it.tries + 1 }); kept++; }
            } else if (it.kind === "chat" && it.chat) {
              if (!isPeerNow(it.chat.peerId)) { kept++; continue; }
              const ok = await transmit(it.chat.peerId, "quick", "", it.chat.body, it.id);
              if (ok) { await obDelete(it.id); sent++; }
              else { await obPut({ ...it, tries: it.tries + 1 }); kept++; }
            } else {
              await obDelete(it.id);
            }
          } catch {
            kept++;
          }
        }
        flushingRef.current = false;
        refreshOutbox();
        if (sent > 0) toastMain(`📤 오프라인 동안 보관한 ${sent}건을 자동으로 보냈어요.`);
        else if (kept > 0 && netOnlineRef.current) toastMain(`오프라인 보관 ${kept}건은 상대 PC가 보이면 자동으로 다시 보내요.`);
      })();
    }, 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netOnline, outboxItems.length, peers.length]);

  const importTeachersCsv = (csv: string) => {
    // 엑셀 CSV의 BOM(\uFEFF)이 있으면 첫 줄 판정이 어긋나 가짜 교사가 생긴다
    const lines = csv.replace(/^\uFEFF/, "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { ok: false, count: 0, error: "CSV가 비어 있어요." };
    const rows = lines[0].startsWith("이름") ? lines.slice(1) : lines;
    const made: Teacher[] = [];
    for (const line of rows) {
      const [nm, dp, sj, ps] = line.split(",").map((x) => (x ?? "").trim());
      if (!nm || !dp || !sj) return { ok: false, count: 0, error: `형식 오류: ${line}` };
      made.push({
        id: uid("t"), name: nm, dept: dp, subject: sj, position: ps || "교사",
        status: "online", statusMessage: "등록됨", avatarColor: nextAvatar(nm),
        ip: "교내망", subCount: 0, phone: "",
      });
    }
    if (!made.length) return { ok: false, count: 0, error: "등록할 행이 없어요." };
    let freshCount = 0;
    let mergedAll: Teacher[] | null = null;
    setTeachers((ts) => {
      const have = new Set(ts.map((t) => `${t.name}|${t.dept}`));
      const fresh = made.filter((m) => !have.has(`${m.name}|${m.dept}`));
      freshCount = fresh.length;
      if (!fresh.length) return ts;
      mergedAll = [...ts, ...fresh];
      return mergedAll;
    });
    if (freshCount === 0) {
      setTimeout(() => toast("이미 등록된 교사예요."), 0);
      return { ok: true, count: 0 };
    }
    // 부서 틀은 teachers 확정 후 별도로 갱신 (updater 안에서 setState 금지)
    setTimeout(() => {
      const all = mergedAll ?? [];
      const byDept = new Map<string, string[]>();
      all.forEach((t) => {
        if (!byDept.has(t.dept)) byDept.set(t.dept, []);
        byDept.get(t.dept)!.push(t.id);
      });
      setDepts((ds) => {
        const known = new Set(ds.map((d) => d.name));
        const extra = [...byDept.keys()].filter((n) => !known.has(n)).map((n, i) => ({ id: `d-csv-${Date.now()}-${i}`, name: n, members: byDept.get(n) ?? [] }));
        return [...ds.map((d) => ({ ...d, members: byDept.get(d.name) ?? [] })), ...extra];
      });
    }, 0);
    return { ok: true, count: freshCount };
  };

  const importCsv = (csv: string) => {
    const lines = csv.replace(/^\uFEFF/, "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { ok: false, count: 0, error: "CSV가 비어 있어요." };
    const wdMap: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
    const rows = lines[0].startsWith("요일") ? lines.slice(1) : lines;
    const next: TimetableCell[] = [];
    for (const line of rows) {
      const [wdS, perS, grade, classNo, subject, room, teacher] = line.split(",").map((x) => (x ?? "").trim());
      const wd = wdMap[wdS] ?? Number(wdS);
      const per = Number(perS);
      if (!(wd >= 1 && wd <= 5 && per >= 1 && per <= 7 && subject)) return { ok: false, count: 0, error: `형식 오류: ${line}` };
      next.push({ weekday: wd, period: per, grade: grade || me?.grade || "2학년", classNo: classNo || me?.classNo || "1반", subject, room: room || "본관", teacher: teacher || me?.name || "" });
    }
    setChangedKeys((s) => {
      const n = new Set(s);
      next.forEach((c) => n.add(cellKey(c)));
      return n;
    });
    // 전체 병합분을 SQLite에 동기화 (Rust는 DELETE 후 INSERT라 조각만 보내면 지워진다)
    const merged = [
      ...cells.filter((c) => !next.some((n) => n.weekday === c.weekday && n.period === c.period && n.grade === c.grade && n.classNo === c.classNo)),
      ...next,
    ];
    setCells(merged);
    void syncTimetable(merged, "CSV 가져오기");
    return { ok: true, count: next.length };
  };

  const requestSwap = (period: number, weekday: number, toTeacherId: string, reason: string) => {
    if (!me) return;
    const to = teachers.find((t) => t.id === toTeacherId);
    if (!to) return;
    const cell = cells.find((c) => c.weekday === weekday && c.period === period && c.grade === me.grade && c.classNo === me.classNo);
    const rec: SwapRecord = {
      id: uid("sw"), date: dateForWeekday(weekday), weekday, period,
      fromTeacher: me.name, fromUid: ME_ID, fromClass: `${me.grade?.[0] ?? ""}-${me.classNo?.[0] ?? ""}`, toTeacher: to.name, toUid: toTeacherId, toClass: `${me.grade?.[0] ?? ""}-${me.classNo?.[0] ?? ""}`,
      grade: me.grade ?? "", classNo: me.classNo ?? "",
      subject: cell?.subject ?? "수업", status: "pending", createdAt: nowIso(),
    };
    setSwaps((s) => [rec, ...s]);
    // SQLite 쪽 진짜 ID를 받아 적어둔다 (수락·거절이 Rust에도 닿아야 아침 팝업이 맞는다)
    void persistSwapRequest({
      date: rec.date,
      weekday,
      period,
      grade: me.grade ?? "",
      classNo: me.classNo ?? "",
      subject: rec.subject,
      toUid: toTeacherId,
      toName: to.name,
    }).then((rid) => {
      if (rid) setSwaps((s) => s.map((x) => (x.id === rec.id ? { ...x, rustId: rid } : x)));
    });
    sendMemo(`[보강 요청] ${["", "월", "화", "수", "목", "금"][weekday]} ${period}교시 ${rec.subject}`, `${to.name} 선생님, ${period}교시 보강을 부탁드려요.${reason ? `\n사유: ${reason}` : ""}\n수락하면 두 시간표가 즉시 바뀌어요.`, [toTeacherId], "", "normal");
    toast(`${to.name}에게 보강 요청 쪽지를 보냈어요.`);
  };

  const applySwapToCells = (s: SwapRecord) => {
    const g = s.grade ?? me?.grade ?? "";
    const cn = s.classNo ?? me?.classNo ?? "";
    setCells((cs) => cs.map((c) =>
      c.weekday === s.weekday && c.period === s.period && (!g || c.grade === g) && (!cn || c.classNo === cn)
        ? { ...c, teacher: s.toTeacher }
        : c
    ));
    setChangedKeys((prev) => {
      const n = new Set(prev);
      n.add(`${s.weekday}-${s.period}-${g}-${cn}`);
      return n;
    });
  };

  const acceptSwap = (id: string) => {
    const s = swaps.find((x) => x.id === id);
    if (!s || !me) return;
    setSwaps((arr) => arr.map((x) => (x.id === id ? { ...x, status: "accepted" } : x)));
    applySwapToCells(s);
    void persistSwapAccept(s.rustId ?? id, true);
    emitEvent("breeze-sync", { scope: "swap-answer", swap: s.rustId ?? s.id, status: "accepted" });
    // 요청자에게 수락을 알린다 (요청자 시간표도 자동 반영)
    const targetUid = s.fromUid && s.fromUid !== ME_ID ? s.fromUid : null;
    if (targetUid && isPeer(targetUid)) void transmit(targetUid, "substitute-accept", "", "", s.rustId ?? s.id);
    setTeachers((ts) => ts.map((t) => (t.name === s.toTeacher ? { ...t, subCount: t.subCount + 1 } : t)));
    toast("수락했어요. 두 시간표에 즉시 반영했어요.");
  };

  const rejectSwap = (id: string) => {
    const target = swaps.find((x) => x.id === id);
    setSwaps((s) => s.map((x) => (x.id === id ? { ...x, status: "rejected" } : x)));
    void persistSwapAccept(target?.rustId ?? id, false);
    emitEvent("breeze-sync", { scope: "swap-answer", swap: target?.rustId ?? id, status: "rejected" });
    const targetUid = target?.fromUid && target.fromUid !== ME_ID ? target.fromUid : null;
    if (targetUid && isPeer(targetUid)) void transmit(targetUid, "substitute-reject", "", "", target?.rustId ?? id);
    toast("거절했어요. 요청자에게 알렸어요.");
  };

  // 합체: 공강 겹침 회의 소집 → 단체 쪽지로 한 번에
  const inviteMeeting = (ids: string[]) => {
    if (!me || !ids.length) return;
    const names = ids.map((id) => teachers.find((t) => t.id === id)?.name ?? id).join(", ");
    sendMemo(
      `[회의 소집] ${names}`,
      `${me.name}이 공강 시간 회의로 불렀어요.\n대상: ${names}\n시간을 정해 답장해 주세요.`,
      ids,
      "",
      "normal"
    );
  };

  // 관리자 핸들러
  const addAdminUser = (u: Omit<AdminUser, "id" | "avatarColor" | "createdAt">) => {
    const newUser: AdminUser = { ...u, id: uid("adm"), avatarColor: nextAvatar(u.name), createdAt: nowIso() };
    setAdminUsers(au => [...au, newUser]);
    // 감사 로그
    addAdminAudit({ adminId: "admin_001", adminName: "관리자", action: "user_manage", targetType: "user", targetId: newUser.id, targetName: newUser.name, detail: `관리자 추가: ${newUser.name} (${newUser.role})`, blocked: false });
  };
  const updateAdminUser = (id: string, patch: Partial<AdminUser>) => {
    setAdminUsers(au => au.map(u => u.id === id ? { ...u, ...patch } : u));
  };
  const deleteAdminUser = (id: string) => {
    const u = adminUsers.find(x => x.id === id);
    setAdminUsers(au => au.filter(x => x.id !== id));
    if (u) addAdminAudit({ adminId: "admin_001", adminName: "관리자", action: "user_manage", targetType: "user", targetId: u.id, targetName: u.name, detail: `관리자 삭제: ${u.name}`, blocked: false });
  };

  const addAdminNotice = (n: Omit<AdminNotice, "id" | "createdAt" | "readCount" | "totalCount" | "attachments">) => {
    const totalCount = (() => {
      if (n.scope === "all") return teachers.length;
      if (n.scope === "dept") return teachers.filter(t => t.dept === n.targetDept).length;
      if (n.scope === "grade") return teachers.filter(t => t.grade === n.targetGrade).length;
      if (n.scope === "class") return teachers.filter(t => t.grade === n.targetGrade && t.classNo === n.targetClass).length;
      return 0;
    })();
    const newNotice: AdminNotice = { ...n, id: uid("an"), createdAt: nowIso(), readCount: 0, totalCount, attachments: [] };
    setAdminNotices(an => [newNotice, ...an]);
    addAdminAudit({ adminId: "admin_001", adminName: "관리자", action: "notice_send", targetType: "notice", targetId: newNotice.id, targetName: newNotice.title, detail: `공지 작성: ${newNotice.title} (${newNotice.scope})`, blocked: false });
  };
  const updateAdminNotice = (id: string, patch: Partial<AdminNotice>) => {
    setAdminNotices(an => an.map(n => n.id === id ? { ...n, ...patch } : n));
  };
  const deleteAdminNotice = (id: string) => {
    const n = adminNotices.find(x => x.id === id);
    setAdminNotices(an => an.filter(x => x.id !== id));
    if (n) addAdminAudit({ adminId: "admin_001", adminName: "관리자", action: "notice_send", targetType: "notice", targetId: n.id, targetName: n.title, detail: `공지 삭제: ${n.title}`, blocked: false });
  };
  const publishAdminNotice = (id: string) => {
    setAdminNotices(an => an.map(n => n.id === id ? { ...n, publishedAt: nowIso() } : n));
    const n = adminNotices.find(x => x.id === id);
    if (n) addAdminAudit({ adminId: "admin_001", adminName: "관리자", action: "notice_send", targetType: "notice", targetId: n.id, targetName: n.title, detail: `공지 게시: ${n.title}`, blocked: false });
  };

  const addTemplate = (t: Omit<TimetableTemplate, "id" | "createdAt" | "updatedAt" | "isPublished" | "publishedAt">) => {
    const newT: TimetableTemplate = { ...t, id: uid("tpl"), createdAt: nowIso(), updatedAt: nowIso(), isPublished: false };
    setTemplates(ts => [newT, ...ts]);
    addAdminAudit({ adminId: "admin_001", adminName: "관리자", action: "timetable_publish", targetType: "timetable", targetId: newT.id, targetName: newT.name, detail: `시간표 템플릿 생성: ${newT.name}`, blocked: false });
  };
  const updateTemplate = (id: string, patch: Partial<TimetableTemplate>) => {
    setTemplates(ts => ts.map(t => t.id === id ? { ...t, ...patch, updatedAt: nowIso() } : t));
  };
  const deleteTemplate = (id: string) => {
    const t = templates.find(x => x.id === id);
    setTemplates(ts => ts.filter(x => x.id !== id));
    if (t) addAdminAudit({ adminId: "admin_001", adminName: "관리자", action: "timetable_publish", targetType: "timetable", targetId: t.id, targetName: t.name, detail: `시간표 템플릿 삭제: ${t.name}`, blocked: false });
  };
  const publishTemplate = (id: string) => {
    setTemplates(ts => ts.map(t => t.id === id ? { ...t, isPublished: true, publishedAt: nowIso() } : t));
    const t = templates.find(x => x.id === id);
    if (t) addAdminAudit({ adminId: "admin_001", adminName: "관리자", action: "timetable_publish", targetType: "timetable", targetId: t.id, targetName: t.name, detail: `시간표 배포: ${t.name}`, blocked: false });
  };

  const addGradeClass = (gc: GradeClass) => {
    setGradeClasses(gcs => [...gcs, gc]);
  };
  const updateGradeClass = (grade: string, classNo: string, patch: Partial<GradeClass>) => {
    setGradeClasses(gcs => gcs.map(c => c.grade === grade && c.classNo === classNo ? { ...c, ...patch } : c));
  };

  const updateSchoolInfo = (patch: Partial<School>) => {
    setSchoolInfo(s => s ? { ...s, ...patch } : null);
  };
  const updateSchoolSettings = (patch: Partial<SchoolSettings>) => {
    setSchoolSettings(s => ({ ...s, ...patch }));
  };

  const addAdminAudit = (a: Omit<AdminAuditLog, "id" | "createdAt">) => {
    const newAudit: AdminAuditLog = { ...a, id: uid("aud"), createdAt: nowIso() };
    setAdminAudits(aa => [newAudit, ...aa].slice(0, 5000));
  };

  // 🎓 학년말 인수인계 마법사 (Killer ④) — 전임 교사의 클라우드 자료 소유권과 공지 작성자를 후임에게 한 번에 넘긴다.
  //  · 자료는 지우지 않고 관리 권한만 이동. 반대로 다시 실행하면 원상 복구된다.
  const runHandover = async (fromId: string, toId: string) => {
    // 권한: 전임 본인 계정이거나 브리즈코어 학교 관리자 계정만 실행할 수 있다.
    const canHandoverAll = serverRole === "admin";
    if (!canHandoverAll && fromId !== ME_ID) {
      return { error: "본인 계정의 자료만 인수인계할 수 있어요. 다른 교사 자료는 본인 또는 학교 관리자만 이관할 수 있어요." } as const;
    }
    const from = teachers.find((t) => t.id === fromId) ?? (fromId === ME_ID && me ? me : undefined);
    const to = teachers.find((t) => t.id === toId) ?? (toId === ME_ID && me ? me : undefined);
    if (!from || !to) return { error: "전임·후임 교사를 다시 골라 주세요." } as const;
    if (from.id === to.id) return { error: "전임과 후임이 같아요." } as const;
    const moved = useCloud.getState().reassignOwner(from.id, { id: to.id, name: to.name, dept: to.dept });
    const affected = notices.filter((n) => n.fromName === from.name);
    if (affected.length) {
      setNotices((ns) => ns.map((n) => (n.fromName === from.name ? { ...n, fromName: to.name } : n)));
      emitEvent("breeze-sync", { scope: "notices" });
    }
    addAdminAudit({
      adminId: me?.id ?? from.id,
      adminName: me?.name ?? "관리자",
      action: "handover",
      targetType: "teacher",
      targetId: to.id,
      targetName: to.name,
      detail: `인수인계: ${from.name} → ${to.name} (폴더 ${moved.folders} · 파일 ${moved.files} · 공지 ${affected.length})`,
      blocked: false,
    });
    toastMain(`🎓 ${from.name} → ${to.name} 인수인계를 마쳤어요.`);
    void api.logActivity("handover", { from: from.id, to: to.id, folders: moved.folders, files: moved.files, notices: affected.length });
    return { folders: moved.folders, files: moved.files, notices: affected.length };
  };

  // 예약 쪽지 due 체커: 30초마다 시각이 된 예약을 실제 쪽지로 보낸다
  useEffect(() => {
    // 팝업 창은 보내지 않는다 (여러 창이 동시에 보내는 것을 방지)
    if (!booted || !hasProfile || popupMode) return;
    let alive = true;
    const run = async () => {
      try {
        const due = await call<{ id: string; title: string; body: string; to_json: string; run_at: string }[]>("scheduled_due");
        if (!alive || !due.length) return;
        for (const r of due) {
          try {
            let toIds: string[] = [];
            try {
              const parsed = JSON.parse(r.to_json || "[]") as { uid: string; name: string }[];
              toIds = parsed.map((x) => x.uid).filter(Boolean);
            } catch {
              toIds = [];
            }
            // 이름으로 적힌 예약은 교사에서 ID로 푼다
            const resolved = toIds.flatMap((key) => {
              if (teachersRef.current.some((t) => t.id === key)) return [key];
              const hit = teachersRef.current.find((t) => t.name === key);
              return hit ? [hit.id] : [];
            });
            // 쉬는시간 전용 예약은 쉬는시간이 아니면 다음 틱으로 미룬다
            if (r.title.startsWith("[쉬는시간]") && !isBreakNow(new Date())) continue;
            if (resolved.length === 0) {
              await call("scheduled_mark", { id: r.id, status: "sent" }).catch(() => undefined);
              toast(`예약 쪽지 "${r.title}" 받는 사람을 찾지 못해 보내지 못했어요.`);
              continue;
            }
            sendMemo(r.title, r.body, resolved, "", "normal");
            await call("scheduled_mark", { id: r.id, status: "sent" }).catch(() => undefined);
          } catch {
            /* 다음 예약으로 */
          }
        }
      } catch {
        /* 다음에 */
      }
    };
    const id = setInterval(run, 30000);
    run();
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, hasProfile]);

  const classNowText = classNow ? `${classNow.period}교시 수업 중 (${me?.grade} ${me?.classNo})` : "";
  const displayStatus: TeacherStatus =
    focusActive && meStatus === "online"
      ? "away"
      : autoStatus && classNow && (meStatus === "online" || meStatus === "in_class")
        ? "in_class"
        : autoStatus && !classNow && lunchNow && (meStatus === "online" || meStatus === "in_class")
          ? "lunch"
          : meStatus;

  // 실제 학교 서버 로그인: Rust(srv_login)가 토큰을 들고, 조직도를 합쳐 온다.
  const handleLogin = useCallback(async (credentials: LoginCredentials) => {
    setLoginError("");
    try {
      const base = normalizeServerUrl(credentials.serverIp);
      const result = await call<{ ok?: boolean; user?: { id?: number | string; real_name?: string; username?: string; role?: string } }>("srv_login", {
        base,
        username: credentials.teacherId,
        password: credentials.password,
      });
      if (!result?.user) {
        throw new Error("인증에 실패했어요. 서버 주소와 교원 ID·비밀번호를 확인해 주세요.");
      }
      const rawRole = String(result.user.role || "").toUpperCase();
      if (rawRole === "STUDENT") {
        try { await call("srv_logout"); } catch { /* 무시 */ }
        throw new Error("학생 계정이에요. 학생은 브리즈 학생 웹에서 로그인해 주세요.");
      }
      setServerRole(rawRole === "ADMIN" || rawRole === "SUPERADMIN" ? "admin" : "teacher");
      // 로그인 성공 → 학교 서버 조직도를 조직도에 합친다
      try {
        const uRes = await call<{ users?: ServerUser[] }>("srv_get", { path: "/api/users" });
        const tRes = await call<{ tree?: ServerDeptNode[] }>("srv_get", { path: "/api/departments/tree" });
        applyServerOrg(uRes?.users ?? [], tRes?.tree ?? []);
      } catch {
        /* 조직도는 다음 폴링에서 채워진다 */
      }
      setIsLoggedIn(true);
      storeSet("logged-in", true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "로그인하지 못했어요.";
      setLoginError(msg);
      throw err;
    }
  }, []);

  // 데모 로그인: 서버 없이 샘플 학교(그린초등학교) 자료로 바로 체험한다.
  // 조직도·쪽지·빠른 대화·시간표·공지·감사에 샘플이 채워지고, 내 계정은 "정담임"(2학년 1반)이 된다.
  const handleDemoLogin = useCallback(async () => {
    const demoMe: Teacher = {
      id: ME_ID, name: "정담임", dept: "2학년부", subject: "국어", position: "담임",
      grade: "2학년", classNo: "1반", avatarColor: nextAvatar("정담임"),
      status: "online", statusMessage: "데모 체험 중", ip: "교내망", subCount: 0, phone: "",
    };
    const demoTeachers: Teacher[] = [
      demoMe,
      { id: "t-001", name: "이준희", dept: "교무기획부", subject: "국어", position: "부장", grade: "", classNo: "", avatarColor: nextAvatar("이준희"), status: "online", statusMessage: "교무기획부", ip: "교내망", subCount: 0, phone: "" },
      { id: "t-002", name: "박수진", dept: "1학년부", subject: "수학", position: "담임", grade: "1학년", classNo: "1반", avatarColor: nextAvatar("박수진"), status: "in_class", statusMessage: "1교시 수업 중", ip: "교내망", subCount: 0, phone: "" },
      { id: "t-003", name: "송미란", dept: "1학년부", subject: "영어", position: "교사", grade: "1학년", classNo: "2반", avatarColor: nextAvatar("송미란"), status: "online", statusMessage: "1학년부", ip: "교내망", subCount: 0, phone: "" },
      { id: "t-004", name: "최동환", dept: "2학년부", subject: "사회", position: "담임", grade: "2학년", classNo: "2반", avatarColor: nextAvatar("최동환"), status: "away", statusMessage: "외출/출장", ip: "교내망", subCount: 0, phone: "" },
      { id: "t-005", name: "한아영", dept: "3학년부", subject: "과학", position: "담임", grade: "3학년", classNo: "1반", avatarColor: nextAvatar("한아영"), status: "online", statusMessage: "3학년부", ip: "교내망", subCount: 2, phone: "" },
      { id: "t-010", name: "김행정", dept: "행정실", subject: "", position: "행정", grade: "", classNo: "", avatarColor: nextAvatar("김행정"), status: "online", statusMessage: "행정실", ip: "교내망", subCount: 0, phone: "" },
    ];
    const demoDepts: DeptGroup[] = [
      { id: "d-gyomu", name: "교무기획부", members: ["t-001"] },
      { id: "d-1", name: "1학년부", members: ["t-002", "t-003"] },
      { id: "d-2", name: "2학년부", members: [ME_ID, "t-004"] },
      { id: "d-3", name: "3학년부", members: ["t-005"] },
      { id: "d-admin", name: "행정실", members: ["t-010"] },
    ];
    const demoMemos: Memo[] = [
      {
        id: "demo-memo-1", title: "2학년 1반 국어 시험 범위 안내",
        body: "정담임 선생님, 2학년 1반 국어 지필평가 범위를 안내드려요.\n\n· 범위: p.50 ~ p.65 (3단원까지)\n· 일시: 다음 주 화요일 2교시\n\n확인 부탁드려요!",
        fromUid: "t-001", fromName: "이준희",
        to: [{ uid: ME_ID, name: "정담임", readAt: null, nudgedAt: null }],
        importance: "normal", hwpName: "", hwpSize: 0, createdAt: nowIso(35),
      },
      {
        id: "demo-memo-2", title: "수학 보충 자료 공유 요청",
        body: "선생님, 내일 1학년 수학 보충 학습 자료 좀 공유해 주실 수 있을까요?\n받으면 학년부에 함께 돌릴게요. 감사해요!",
        fromUid: "t-002", fromName: "박수진",
        to: [{ uid: ME_ID, name: "정담임", readAt: null, nudgedAt: null }],
        importance: "ref", hwpName: "", hwpSize: 0, createdAt: nowIso(90),
      },
      {
        id: "demo-memo-3", title: "오늘 점심 배식 순서 안내",
        body: "오늘 점심 배식 순서: 3학년 → 2학년 → 1학년\n학년부에서 학생들 동선 지도 부탁드려요.",
        fromUid: "t-010", fromName: "김행정",
        to: [{ uid: ME_ID, name: "정담임", readAt: nowIso(120), nudgedAt: null }, { uid: "t-005", name: "한아영", readAt: null, nudgedAt: null }],
        importance: "normal", hwpName: "", hwpSize: 0, createdAt: nowIso(200),
      },
    ];
    const demoChats: Record<string, ChatMessage[]> = {
      "t-002": [
        { id: "demo-q-1", peerId: "t-002", mine: false, body: "정담임 선생님, 내일 수학 보충 자료 공유 부탁드려요!", createdAt: nowIso(52), read: false, emoji: [] },
        { id: "demo-q-2", peerId: "t-002", mine: true, body: "네, 오후에 정리해서 보내드릴게요. 😊", createdAt: nowIso(50), read: true, emoji: [] },
        { id: "demo-q-3", peerId: "t-002", mine: false, body: "감사해요!", createdAt: nowIso(49), read: false, emoji: ["🙏"] },
      ],
      "t-005": [
        { id: "demo-q-4", peerId: "t-005", mine: false, body: "수요일 5교시 보강 가능하실까요?", createdAt: nowIso(150), read: true, emoji: [] },
      ],
    };
    const demoCells: TimetableCell[] = [
      { id: "demo-c-1", weekday: 1, period: 2, grade: "2학년", classNo: "1반", subject: "국어", room: "2-1 교실", teacher: "정담임" },
      { id: "demo-c-2", weekday: 1, period: 3, grade: "2학년", classNo: "2반", subject: "국어", room: "2-2 교실", teacher: "정담임" },
      { id: "demo-c-3", weekday: 2, period: 1, grade: "2학년", classNo: "1반", subject: "국어", room: "2-1 교실", teacher: "정담임" },
      { id: "demo-c-4", weekday: 3, period: 5, grade: "2학년", classNo: "1반", subject: "과학", room: "과학실", teacher: "한아영" },
      { id: "demo-c-5", weekday: 4, period: 2, grade: "2학년", classNo: "1반", subject: "국어", room: "2-1 교실", teacher: "정담임" },
      { id: "demo-c-6", weekday: 5, period: 3, grade: "1학년", classNo: "1반", subject: "수학", room: "1-1 교실", teacher: "박수진" },
      { id: "demo-c-7", weekday: 5, period: 4, grade: "3학년", classNo: "1반", subject: "과학", room: "과학실", teacher: "한아영" },
    ];
    const demoSwaps: SwapRecord[] = [
      {
        id: "demo-sw-1", rustId: null, date: dateForWeekday(3), weekday: 3, period: 5,
        fromTeacher: "한아영", fromUid: "t-005", fromClass: "3-1",
        toTeacher: "정담임", toUid: ME_ID, toClass: "2-1",
        grade: "2학년", classNo: "1반", subject: "과학",
        status: "pending", createdAt: nowIso(170),
      },
    ];
    const demoNotices: NoticeItem[] = [
      { id: "demo-notice-1", title: "전체 교직원 회의 안내", body: "이번 주 금요일 오후 3시, 2층 회의실에서 전체 교직원 회의가 있어요.\n학년별 협의 내용을 준비해 주세요.", level: "normal", scope: "all", dept: "", fromName: "김교장", createdAt: nowIso(60), popup: false },
      { id: "demo-notice-2", title: "방학 중 청소 차량 배치표", body: "방학 중 교내 청소 차량 배치표를 첨부와 같이 안내해요. 학년부별로 확인 부탁드려요.", level: "normal", scope: "all", dept: "", fromName: "김행정", createdAt: nowIso(240), popup: false },
    ];
    const demoAudits: AuditLog[] = [
      { id: "demo-a-1", createdAt: nowIso(210), kind: "HWP", ruleId: "HWP-01", text: "주민등록번호가 포함된 한글 파일 전송 차단", score: 0.92, blocked: true },
      { id: "demo-a-2", createdAt: nowIso(420), kind: "PHONE", ruleId: "PHONE-01", text: "학부모 연락처가 포함된 쪽지 전송 전 감지", score: 0.6, blocked: false },
    ];
    setTeachers(demoTeachers);
    setDepts(demoDepts);
    setMemos(demoMemos);
    setComments({});
    setChats(demoChats);
    setCells(demoCells);
    setSwaps(demoSwaps);
    setNotices(demoNotices);
    setAudits(demoAudits);
    setSchool({ schoolId: "green-demo", schoolName: DEMO_SCHOOL_NAME });
    setLicense(null);
    setMeStatus("online");
    setNet("intranet");
    setMemoPreset(null);
    setChatPeer(null);
    setServerRole("teacher");
    setHasProfile(true);
    setIsLoggedIn(true);
    syncMe("정담임");
    void syncTimetable(demoCells, "데모 자료");
    void storeSet("profile-done", true);
    void storeSet("logged-in", true);
  }, []);

  const handleLogout = useCallback(() => {
    setIsLoggedIn(false);
    setServerRole("teacher");
    setUnreadStudent(0);
    api.setAuthToken(null);
    disconnectNotesRealtime();
    void storeSet("server-token", "");
    storeSet("logged-in", false);
    call("srv_logout").catch(() => undefined);
  }, []);

  // 연결 상태 계산
  const connectionStatus: {
    connected: boolean;
    type: "intranet" | "external" | "connecting" | "disconnected";
    message: string;
  } = {
    connected: net === "intranet" || net === "external",
    type: net === "intranet" ? "intranet" : net === "external" ? "external" : "disconnected",
    message: net === "intranet" ? "교내망 연결됨" : net === "external" ? "외부망 연결됨" : "서버 접속 대기 중",
  };

  // 부팅 시 자동 로그인 확인
  useEffect(() => {
    if (booted && !isLoggedIn) {
      storeGet<boolean>("logged-in").then((v) => {
        if (v) setIsLoggedIn(true);
      });
    }
  }, [booted, isLoggedIn]);

  // 서버 주도 OTA: 로그인 후 학교 서버 주소를 읽어 새 버전 확인을 준비한다.
  useEffect(() => {
    if (!isLoggedIn) return;
    void storeGet<string>("server-base").then((v) => setServerBase(v || null));
  }, [isLoggedIn]);

  // 학생 문의 미읽음 수 (교사 앱 전체 배지)
  const refreshStudentUnread = useCallback(async () => {
    const res = await api.getNotesInbox(1, false, 100);
    if (!res.ok || !res.data) return;
    const n = (res.data.notes || []).filter((x) => x.sender_role === "STUDENT" && !Number(x.is_read)).length;
    setUnreadStudent(n);
  }, []);

  // 학생 웹 ↔ 교사 앱 실시간 연결: 앱을 다시 켠 경우에도 저장된 토큰으로 복구한다.
  useEffect(() => {
    if (!booted || !isLoggedIn) return;
    let alive = true;
    let off = () => {};
    const offApprovalNew = socket.on("approval:new", (p) => {
      if (!alive) return;
      if (focusActiveRef.current) return;
      toastMain(`🗂️ 새 결재가 올라왔어요. ${p.title || ""}`.trim());
    });
    const offApprovalDecided = socket.on("approval:decided", (p) => {
      if (!alive) return;
      if (focusActiveRef.current) return;
      const label = p.status === "APPROVED" ? "승인됐어요." : p.status === "REJECTED" ? "반려됐어요." : "처리됐어요.";
      toastMain(`🗂️ 올린 결재가 ${label}`);
    });
    void (async () => {
      const baseRaw = await storeGet<string>("server-base");
      const token = await storeGet<string>("server-token");
      if (!alive || !baseRaw || !token) return;
      const base = normalizeServerUrl(baseRaw);
      setApiBaseUrl(base);
      api.setAuthToken(token);
      try {
        const meRes = await api.getMe();
        const rawRole = String(meRes.data?.user?.role || "").toUpperCase();
        if (alive) setServerRole(rawRole === "ADMIN" || rawRole === "SUPERADMIN" ? "admin" : "teacher");
      } catch { /* 역할 확인 실패 — 교사 메뉴로 안전하게 둔다 */ }
      await connectNotesRealtime({ url: base, token });
      if (!alive) return;
      off = startNotesRealtime({
        onMemoArrived: (p) => {
          if (String(p.from_role || "").toUpperCase() !== "STUDENT") return;
          void refreshStudentUnread();
          if (focusActiveRef.current) return; // 퇴근 후 휴식(Focus) 중에는 소리·토스트를 끈다
          playStudentChime();
          toastMain(`🎓 ${p.from_name || "학생"} 학생이 새 메시지를 보냈어요.`);
        },
      });
      void refreshStudentUnread();
    })();
    return () => { alive = false; off(); offApprovalNew(); offApprovalDecided(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, isLoggedIn, refreshStudentUnread]);

  if (!booted) {
    return (
      <div className="h-screen flex flex-col bg-edu-bg">
      <TitleBar onPreviewAction={() => toast("미리보기예요. 창 버튼은 Windows 설치판에서 동작해요.")} />
      <div className="flex-1 min-h-0">
        <BootSplash />
      </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="h-screen flex flex-col bg-edu-bg">
        <TitleBar onPreviewAction={() => toast("미리보기예요. 창 버튼은 Windows 설치판에서 동작해요.")} />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <LoginWindow
            onLogin={handleLogin}
            onDemo={handleDemoLogin}
            onError={setLoginError}
            onSuccess={() => {}}
          />
        </div>
      </div>
    );
  }

  if (!hasProfile || !me) {
    return (
      <div className="h-screen flex flex-col bg-edu-bg">
      <TitleBar onPreviewAction={() => toast("미리보기예요. 창 버튼은 Windows 설치판에서 동작해요.")} />
      <div className="flex-1 min-h-0 overflow-y-auto">
      <SetupWizard
        onToast={toast}
        onDone={(profile, groups, sch, lic) => {
          setTeachers([profile]);
          setDepts(groups);
          setSchool(sch);
          setLicense(lic);
          setChatPeer(null);
          setHasProfile(true);
          storeSet("profile-done", true);
          syncMe(profile.name);
          if (sch.schoolId.trim() && !lic) refreshLicense(sch.schoolId);
          toast("설정이 끝났어요. 브리즈를 시작합니다.");
        }}
      />
      </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-edu-bg">
      {!isTauriDesktop() && (
        <div className="shrink-0 bg-[#8A6D00] text-white text-[11.5px] font-bold text-center py-1">
          미리보기 모드 · 실제 앱은 설치판(.exe)에서 실행돼요
        </div>
      )}
      <TitleBar onPreviewAction={() => toast("미리보기예요. 창 버튼은 Windows 설치판에서 동작해요.")} connectionStatus={connectionStatus} />
      {!popupMode && <MorningPopup />}
      {/* 퀵 메모(포스트잇) 레이어 — 좌측 레일의 [퀵 메모] 버튼으로 여닫는다 */}
      {quickLayerOpen && !popupMode && (
        <QuickMemos
          onClose={() => useQuick.getState().setBarOpen(false)}
          onSendAsMemo={sendQuickToMemo}
          onToast={toast}
        />
      )}
      {/* 외부망에서 클라우드(무거운 기능)를 열어 둔 채 전환하면 화면 중앙에 안내한다. 토스트가 아니다. */}
      {dualNetwork && net === "external" && view === "cloud" && !popupMode && (
        <div className="fixed inset-0 z-[1500] bg-[rgba(15,23,42,0.46)] backdrop-blur-[3px] grid place-items-center p-5" role="dialog" aria-modal="true" aria-labelledby="net-lock-title">
          <div className="w-full max-w-[420px] rounded-2xl bg-edu-surface border border-edu-line shadow-2xl p-6 text-center anim-pop">
            <div className="mx-auto w-14 h-14 rounded-2xl grid place-items-center text-2xl bg-edu-soft border border-edu-blueline" aria-hidden>☁️</div>
            <div id="net-lock-title" className="mt-4 text-[18px] font-extrabold text-edu-ink">내부망 전용 기능이에요</div>
            <p className="mt-2.5 text-[14px] leading-relaxed text-edu-sub font-semibold">
              이 기능은 내부망 전용 기능이에요. 해당 기능을 사용하시려면 내부망 연결로 바꿔주세요.
            </p>
            <div className="flex gap-2 mt-5">
              <button className="edu-btn flex-1" onClick={() => switchNet("intranet")}>내부망으로 바꾸기</button>
              <button className="edu-ghost flex-1 !py-2.5" onClick={() => setView("org")}>다른 화면으로</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 flex overflow-hidden">
      {!popupMode && (
      <LeftSidebar
        me={{ ...me, status: displayStatus }}
        teachers={visibleTeachers}
        depts={visibleDepts}
        net={net}
        intranetHidden={!intranetOn && teachers.some((t) => isIntranetScoped(t))}
        externalOnly={externalOnly}
        dualNetwork={dualNetwork}
        view={view}
        narrow={isClassic}
        expand={wideWin}
        autoCollapse={!wideWin && (view === "consult" || view === "approval" || view === "whiteboard")}
        unreadMemo={unreadMemo}
        unreadStudent={unreadStudent}
        unreadChat={unreadChat}
        pendingSwap={pendingSwap}
        autoStatus={autoStatus}
        classNowText={classNowText}
        onStatus={(s) => {
          setMeStatus(s);
          setTeachers((ts) => ts.map((t) => (t.id === ME_ID ? { ...t, status: s, statusMessage: s === "in_class" ? classNowText || defaultMessageFor(s) : s === "online" ? `${me.grade} ${me.classNo} 담임` : defaultMessageFor(s) } : t)));
        }}
        onNet={() => switchNet(net === "intranet" ? "external" : "intranet")}
        onView={goView}
        onToast={toast}
        onLogout={handleLogout}
        onQuickMemo={toggleQuickMemos}
        quickMemoOpen={quickLayerOpen ? quickNoteCount : 0}
        focusActive={focusActive}
        netOnline={netOnline}
        outboxCount={outboxItems.length}
        userRole={serverRole}
        hiddenTabs={hiddenTabs}
        tabOrder={tabOrder}
        onHideTab={hideNavTab}
        onReorderTabs={setTabOrder}
      />
      )}
      <main className="flex-1 min-w-0 h-full overflow-y-auto">
        <div key={view} className={`anim-page py-2.5 core-main-inner mx-auto ${isClassic && !popupMode ? "px-2.5 max-w-[430px]" : "px-3.5 max-w-[1100px]"}`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-2">
            <h1 className="shrink-0 whitespace-nowrap font-black text-[16px] tracking-[-0.2px]">{VIEW_TITLE[view]}</h1>
            <span className="min-w-0 basis-full text-[11px] text-edu-sub">
              {net === "intranet" ? "교내연결 · 내부망" : "외부연결"}
              {school.schoolName ? ` · ${school.schoolName}` : ""}
              {chatOnly ? " · 소통 전용" : ""}
            </span>
            {!isClassic && !popupMode && (
              <>
                <span className="flex-1" />
                <BzTooltip content="우측 패널(자리배치·파일·쪽지) 접기/펼치기" position="bottom">
                  <button
                    className="edu-ghost !py-1 !px-2.5 !text-[12px]"
                    onClick={() => setRightPane((v) => !v)}
                  >
                    {rightPane ? "▸ 패널 접기" : "◂ 패널 펴기"}
                  </button>
                </BzTooltip>
              </>
            )}
          </div>
          {view === "org" && (
            <OrgTreePane
              teachers={visibleTeachers}
              depts={visibleDepts}
              onMemo={(t) => {
                if (windowMode === "multi" && isTauriDesktop()) { void openPopup("memo", { to: t.id }); return; }
                setMemoPreset(t);
                setView("memo");
              }}
              onChat={handleOpenChat}
              onRemote={(t) => { void requestRemote(t.id, t.name); }}
              onAddTeacher={(t) => {
                const full: Teacher = {
                  ...t, id: uid("t"), avatarColor: nextAvatar(t.name),
                  grade: "", classNo: "", ip: "교내망", subCount: 0, phone: "",
                };
                setTeachers((ts) => [...ts, full]);
                setDepts((ds) => {
                  const ix = ds.findIndex((d) => d.name === full.dept);
                  if (ix >= 0) return ds.map((d, j) => (j === ix ? { ...d, members: [...d.members, full.id] } : d));
                  return [...ds, { id: `d-${Date.now()}`, name: full.dept, members: [full.id] }];
                });
                toast(`${full.name}을 등록했어요.`);
              }}
              onImportCsv={importTeachersCsv}
              onToast={toast}
              onCarRequest={requestCarMove}
              peers={peers}
              remoteBlocked={remoteBlockedReason(net, license)}
              onRefreshPeers={() => void refreshPeers()}
              onRemotePc={(nodeId, name) => void requestRemote(nodeId, name)}
            />
          )}
          {view === "memo" && (
            <MemoPane
              memos={memos}
              comments={comments}
              teachers={visibleTeachers}
              openId={openMemoId}
              presetTo={memoPreset}
              draft={memoDraft}
              onDraftConsumed={() => setMemoDraft(null)}
              onOpen={openMemo}
              onSend={sendMemo}
              onUndoSend={undoSendMemo}
              onRecall={recallMemo}
              onStar={starMemo}
              onQuickSave={quickSaveMemo}
              onNudge={(memoId, uid2) => {
                setMemos((arr) => arr.map((m) => (m.id === memoId ? { ...m, to: m.to.map((r) => (r.uid === uid2 ? { ...r, nudgedAt: nowIso() } : r)) } : m)));
                toast("재촉 팝업을 보냈어요.");
                // 설치판은 memo_nudge가 SQLite 기록+P2P를 함께 하므로 중복 전송하지 않는다
                if (rustEnabled()) void persistNudge(memoId, uid2);
                else if (isPeer(uid2)) void transmit(uid2, "nudge", "", "쪽지를 확인해 주세요.", memoId);
              }}
              onComment={(memoId, body) => {
                const c: MemoComment = { id: uid("c"), memoId, fromUid: ME_ID, fromName: me.name, body, createdAt: nowIso() };
                setComments((s) => ({ ...s, [memoId]: [...(s[memoId] ?? []), c] }));
                // Rust 진짜 ID로 갈아끼운다 (다음 열기 때 중복으로 안 보인다)
                void persistComment(memoId, body).then((realId) => {
                  if (realId && realId !== c.id) {
                    setComments((s) => ({
                      ...s,
                      [memoId]: (s[memoId] ?? []).map((x) => (x.id === c.id ? { ...x, id: realId } : x)),
                    }));
                  }
                }).then(() => emitEvent("breeze-sync", { scope: "comments", memo: memoId }));
                const target = memos.find((m) => m.id === memoId)?.fromUid;
                if (target && target !== ME_ID && isPeer(target)) void transmit(target, "comment", "", body, memoId);
              }}
              onImportance={(memoId, imp) => {
                setMemos((arr) => arr.map((m) => (m.id === memoId ? { ...m, importance: imp } : m)));
                void persistImportance(memoId, imp);
                toast(imp === "urgent" ? "긴급 쪽지로 표시했어요." : imp === "ref" ? "참고 쪽지로 표시했어요." : "일반 쪽지로 표시했어요.");
              }}
              onToast={toast}
              onGoChat={() => goView("chat")}
              onAudit={audit}
            />
          )}
          {view === "student-inbox" && (
            <StudentInboxPane
              onToast={(m) => toastMain(m)}
              onUnreadChange={setUnreadStudent}
              onNeedLogin={handleLogout}
            />
          )}
          {view === "chat" && (
            <ChatPane
              peer={chatPeer}
              teachers={teachers.filter((t) => t.id !== ME_ID)}
              chats={chats}
              onPeer={(t) => {
                if (windowMode === "multi" && isTauriDesktop()) {
                  setChats((s) => ({ ...s, [t.id]: (s[t.id] ?? []).map((m) => ({ ...m, read: true })) }));
                  void openDetached(t);
                  return;
                }
                setChatPeer(t);
                setChats((s) => ({ ...s, [t.id]: (s[t.id] ?? []).map((m) => ({ ...m, read: true })) }));
                // SQLite에 쌓인 대화를 덧붙인다 (refreshQuick: 이미 있는 것은 중복 제외)
                refreshQuick(t.id);
              }}
              onSend={sendChat}
              onReact={(peerId, msgId, emoji) => {
                setChats((s) => ({ ...s, [peerId]: (s[peerId] ?? []).map((m) => (m.id === msgId && !m.emoji.includes(emoji) ? { ...m, emoji: [...m.emoji, emoji] } : m)) }));
              }}
              onToast={toast}
              onGoMemo={() => goView("memo")}
              onAudit={audit}
            />
          )}
          {view === "timetable" && (
            <TimetablePane
              cells={cells}
              swaps={swaps}
              teachers={visibleTeachers}
              meId={ME_ID}
              myName={me.name}
              grade={me.grade ?? ""}
              classNo={me.classNo ?? ""}
              blocked={chatOnly}
              changedKeys={changedKeys}
              external={net === "external"}
              webUrl={String(import.meta.env.VITE_PUBLIC_WEB_URL || "https://edutalk.cloud").replace(/\/+$/, "")}
              onInviteMeeting={inviteMeeting}
              onImport={importCsv}
              onRequestSwap={requestSwap}
              onAcceptSwap={acceptSwap}
              onRejectSwap={rejectSwap}
              onRemote={(c) => {
                const blocked = remoteBlockedReason(net, license);
                if (blocked) {
                  toast(blocked);
                  return;
                }
                toast(`원격 지원은 조직도에서 대상 PC를 골라 걸어 주세요 (${c.grade} ${c.classNo} ${c.room}). 교내망 전용이에요.`);
              }}
              onToast={toast}
            />
          )}
          {view === "work" && (
            <WorkPane
              notices={notices}
              teachers={visibleTeachers.filter((t) => t.id !== ME_ID)}
              meName={me?.name ?? "나"}
              isAdmin={serverRole === "admin"}
              onPublish={(d) => {
                const n: NoticeItem = {
                  id: uid("n"),
                  title: d.title,
                  body: d.body,
                  level: d.urgent ? "urgent" : "normal",
                  scope: d.scope,
                  dept: d.dept,
                  fromName: me?.name ?? "나",
                  createdAt: nowIso(),
                  popup: d.urgent,
                  targetKind: d.targetKind,
                  targets: d.targets,
                  startAt: d.startAt,
                  expiresAt: d.expiresAt,
                  attachments: d.attachments.length ? d.attachments : undefined,
                };
                setNotices((s) => [n, ...s]);
                if (d.urgent) setEmergency(n);
                // 팝업 창에서 올린 긴급 공지는 메인 창에도 바로 띄운다
                if (popupMode && d.urgent) setTimeout(() => emitEvent("breeze-sync", { scope: "notices", urgent: n }), 80);
                const targetText =
                  d.targetKind === "dept"
                    ? `${d.dept}에`
                    : d.targetKind === "position"
                      ? `${d.targets.join(", ")} 직급에게`
                      : d.targetKind === "selected"
                        ? `${d.targets.length}명에게`
                        : "전교직원에게";
                toast(d.urgent ? "긴급 공지를 중앙 팝업으로 올렸어요. 사이렌이 울려요." : `${targetText} 공지를 올렸어요.`);
              }}
              onTogglePopup={(id) => {
                setNotices((s) => s.map((n) => (n.id === id ? { ...n, popup: !n.popup } : n)));
                const n = notices.find((x) => x.id === id);
                if (n && !n.popup) setEmergency({ ...n, popup: true });
              }}
              onDelete={(id) => {
                setNotices((s) => s.filter((n) => n.id !== id));
                if (emergency?.id === id) setEmergency(null);
                toast("공지를 강제 삭제했어요.");
              }}
              onToast={toast}
            />
          )}
          {view === "consult" && (
            <ConsultPane
              meName={me?.name ?? "나"}
              localIsAdmin={serverRole === "admin"}
              onToast={toast}
            />
          )}
          {view === "approval" && (
            <ApprovalPane
              meName={me?.name ?? "나"}
              localIsAdmin={serverRole === "admin"}
              onToast={toast}
            />
          )}
          {view === "whiteboard" && (
            <WhiteboardPane
              meName={me?.name ?? "나"}
              localIsAdmin={serverRole === "admin"}
              onToast={toast}
            />
          )}
          {view === "cloud" && (
            <CloudPane
              me={{
                id: ME_ID,
                name: me?.name ?? "나",
                dept: me?.dept ?? "미지정",
                role: serverRole === "admin" ? "admin" : "teacher",
              }}
              onToast={toast}
            />
          )}
          {view === "survey" && (
            <SurveyPane
              me={{ id: ME_ID, name: me?.name ?? "나", dept: me?.dept ?? "미지정" }}
              teachers={visibleTeachers.filter((t) => t.id !== ME_ID).map((t) => ({ id: t.id, name: t.name, dept: t.dept }))}
              onNotifySubjects={(title, body, targetIds) => {
                if (!targetIds.length) {
                  toast("대상자가 없어 알림을 보내지 못했어요.");
                  return;
                }
                // 설문 알림: 대상자에게 쪽지함 알림을 보낸다 (7초 Undo 없이 즉시)
                const r = sendMemo(title, body, targetIds, "", "ref", { undo: false });
                if (r.ok) toast(`설문 알림을 ${targetIds.length}명에게 보냈어요.`);
              }}
              onToast={toast}
            />
          )}
          {view === "audit" && (
            <AuditPane
              logs={audits}
              cacheUsed={cacheUsed}
              cacheTotal={3.0}
              autoPurge={autoPurge}
              onPurge={() => {
                void runPurge().then((r) => {
                  if (r) {
                    setCacheUsed(0.05);
                    toast(`정리했어요. ${r.freedMB.toFixed(1)}MB 비움 · 임시 ${r.totalMB.toFixed(1)}MB 남음`);
                  } else {
                    setCacheUsed(0.2);
                    toast("캐시를 정리했어요.");
                  }
                });
              }}
              onTogglePurge={() => setAutoPurge((v) => !v)}
              onReport={() => void exportAuditReport(toast)}
              onToast={toast}
            />
          )}
          {view === "print" && <PrintPane meName={me.name} onToast={toast} />}
          {view === "settings" && (
            <SettingsPane
              autoStatus={autoStatus}
              onAutoStatus={setAutoStatus}
              netAuto={netAuto}
              onNetAuto={setNetAuto}
              font={font}
              onFont={setFont}
              onLogout={handleLogout}
              car={me.carNumber ?? ""}
              onCar={(v) =>
                setTeachers((ts) =>
                  ts.map((t) => (t.id === ME_ID ? { ...t, carNumber: v || undefined } : t))
                )
              }
              handoverTeachers={[
                { id: ME_ID, name: me.name, dept: me.dept },
                ...teachers.filter((t) => t.id !== ME_ID).map((t) => ({ id: t.id, name: t.name, dept: t.dept })),
              ]}
              currentTeacherId={ME_ID}
              canHandoverAll={serverRole === "admin"}
              onHandover={runHandover}
              navItems={navItemsForRole(serverRole, net).map((t) => ({ id: t.id, label: t.label }))}
              hiddenTabs={hiddenTabs}
              onHideTab={hideNavTab}
              onRestoreTab={restoreNavTab}
              onRestoreAllTabs={() => { setHiddenTabs([]); toast("숨긴 메뉴를 모두 다시 표시했어요."); }}
              onResetTabOrder={resetNavOrder}
            />
          )}
          {view === "admin-dashboard" && (
            <AdminDashboard
              teachers={teachers}
              notices={adminNotices}
              audits={adminAudits}
              templates={templates}
              gradeClasses={gradeClasses}
              school={schoolInfo}
              onToast={toast}
            />
          )}
          {view === "admin-users" && (
            <AdminUsers
              teachers={teachers}
              adminUsers={adminUsers}
              depts={depts}
              onAddTeacher={(t) => {
                const full: Teacher = { ...t, id: uid("t"), avatarColor: nextAvatar(t.name), status: "online", statusMessage: "등록됨", ip: "교내망", subCount: 0, phone: "" };
                setTeachers(ts => [...ts, full]);
                setDepts(ds => {
                  const ix = ds.findIndex(d => d.name === full.dept);
                  if (ix >= 0) return ds.map((d, j) => (j === ix ? { ...d, members: [...d.members, full.id] } : d));
                  return [...ds, { id: `d-${Date.now()}`, name: full.dept, members: [full.id] }];
                });
                toast(`${full.name} 교사를 추가했어요.`);
              }}
              onUpdateTeacher={(id, patch) => setTeachers(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t))}
              onDeleteTeacher={(id) => setTeachers(ts => ts.filter(t => t.id !== id))}
              onAddAdmin={addAdminUser}
              onUpdateAdmin={updateAdminUser}
              onDeleteAdmin={deleteAdminUser}
              onToast={toast}
            />
          )}
          {view === "admin-notices" && (
            <AdminNotices
              notices={adminNotices}
              teachers={teachers}
              depts={depts}
              onAdd={addAdminNotice}
              onUpdate={updateAdminNotice}
              onDelete={deleteAdminNotice}
              onPublish={publishAdminNotice}
              onToast={toast}
            />
          )}
          {view === "admin-timetable" && (
            <AdminTimetable
              templates={templates}
              teachers={teachers}
              gradeClasses={gradeClasses}
              onAdd={addTemplate}
              onUpdate={updateTemplate}
              onDelete={deleteTemplate}
              onPublish={publishTemplate}
              onToast={toast}
            />
          )}
          {view === "admin-audit" && (
            <AdminAudit
              audits={adminAudits}
              onToast={toast}
            />
          )}
          {view === "admin-settings" && (
            <AdminSettings
              settings={schoolSettings}
              onUpdate={updateSchoolSettings}
              onToast={toast}
            />
          )}
          {view === "admin-school" && (
            <AdminSchool
              school={schoolInfo}
              onUpdate={updateSchoolInfo}
              onToast={toast}
            />
          )}
        </div>
      </main>
      {!popupMode && !isClassic && rightPane && (
        <RightPanel
          teachers={visibleTeachers}
          memos={memos.filter((m) => !m.recalledAt)}
          meId={ME_ID}
          onOpenMemo={(id) => {
            if (windowMode === "multi" && isTauriDesktop()) { void openPopup("memo", { memo: id }); return; }
            openMemo(id);
            setView("memo");
          }}
          onGoWork={() => setView("memo")}
          onToast={toast}
        />
      )}
      {emergency && (
        <div className="edu-overlay" onClick={() => { stopSiren(); setEmergency(null); }}>
          <div className="edu-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="font-black text-[17px] text-[#D92D20] emg-title-pulse">🚨 긴급 공지</div>
            <div className="font-extrabold text-[15px] mt-1">{emergency.title}</div>
            <div className="text-[13.5px] mt-1.5 whitespace-pre-wrap">{emergency.body}</div>
            {emgSummary && emgSummary.length > 0 && (
              <div className="mt-2 text-[12.5px] bg-edu-soft border border-edu-blueline rounded-xl px-3 py-2">
                <div className="font-extrabold text-edu-strong mb-0.5">AI 3줄 요약</div>
                <ul className="list-disc pl-4 leading-relaxed">
                  {emgSummary.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}
            <div className="text-[12px] text-edu-sub mt-1">{emergency.fromName} · {emergency.createdAt}</div>
            <button className="edu-btn w-full mt-3" onClick={() => { stopSiren(); setEmergency(null); }}>확인했어요</button>
          </div>
        </div>
      )}
      {remoteIn && (
        <div className="edu-overlay">
          <div className="edu-modal" style={{ maxWidth: 400 }}>
            <div className="font-black text-[16px]">🖥️ 화면 보기 요청</div>
            <div className="text-[13.5px] mt-1.5"><b>{remoteIn.fromName}</b>이 화면 보기를 요청했어요. 수락하면 지금 화면 1장을 보내요.</div>
            <div className="flex gap-2 mt-4">
              <button className="edu-ghost flex-1" onClick={() => void acceptRemote(false)}>거절</button>
              <button className="edu-btn flex-1" onClick={() => void acceptRemote(true)}>수락</button>
            </div>
          </div>
        </div>
      )}
      {remoteView && (
        <div className="edu-overlay">
          <div className="edu-modal" style={{ maxWidth: 720 }}>
            <div className="flex items-center gap-2">
              <div className="font-black text-[15px] flex-1">{remoteView.name} 화면</div>
              <button className="edu-ghost !py-1 !px-2.5 !text-[12px]" onClick={() => void refreshRemoteView()}>새로고침</button>
              <button className="edu-ghost !py-1 !px-2.5 !text-[12px]" onClick={() => void closeRemoteView()}>끊기</button>
            </div>
            <div className="mt-2 rounded-xl overflow-hidden border border-edu-line bg-black grid place-items-center min-h-[240px]">
              {remoteView.img ? (
                <img src={remoteView.img} alt={`${remoteView.name} 화면`} className="w-full h-auto block" />
              ) : (
                <div className="text-white text-[13px] py-16">{remoteView.waiting ? "화면을 받아오는 중이에요…" : "화면이 없어요."}</div>
              )}
            </div>
          </div>
        </div>
      )}
      {sharing && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[95] flex items-center gap-2 bg-[#191F28] text-white text-[13px] font-bold px-4 py-2.5 rounded-2xl shadow-lg">
          <span>{sharing.name}에게 공유 중{sharing.sending ? "…" : ""}</span>
          <button className="underline" onClick={() => void resendSharing()}>다시 보내기</button>
          <button className="underline" onClick={() => void stopSharing()}>끊기</button>
        </div>
      )}
      <UpdateToast enabled={isLoggedIn && !popupMode} base={serverBase} />
      <div className="edu-toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`edu-toast${t.leaving ? " leaving" : ""}`}>
            <span className="break-words">{t.text}</span>
            <button className="edu-toast-x" aria-label="알림 닫기" onClick={() => dismissToast(t.id)}>
              ✕
            </button>
            <span
              className="edu-toast-bar"
              aria-hidden="true"
              style={{ animationDuration: `${t.durationMs ?? 3200}ms` }}
            />
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
