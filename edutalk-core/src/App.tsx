import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActiveView,
  AuditLog,
  ChatMessage,
  DeptGroup,
  Memo,
  MemoComment,
  NetworkState,
  NoticeItem,
  SwapRecord,
  Teacher,
  TeacherStatus,
  TimetableCell,
  ToastMsg,
} from "./types";
import { ME_ID, nowIso, type SchoolSetup } from "./mock/initialData";
import { storeGet, storeSet } from "./lib/localStore";
import { call, listenEvent } from "./lib/tauri";
import { FONT_OPTIONS, type FontKind } from "./lib/fonts";
import type { Peer } from "./lib/tauri";
import { isFirebaseCloudSchool, intranetVisible, isExternalOnlySchool, isIntranetScoped, remoteBlockedReason } from "./lib/remotePolicy";
import { useEdu, applyLayoutAttr, applyMotionAttr } from "./store";
import { cellKey, isBreakNow } from "./lib/fusion";
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
import { fetchSchoolLicense, type SchoolLicense } from "./lib/schoolSync";
import LeftSidebar from "./components/layout/LeftSidebar";
import RightPanel from "./components/layout/RightPanel";
import TitleBar from "./components/layout/TitleBar";
import BootSplash from "./components/BootSplash";
import MorningPopup from "./components/MorningPopup";
import OrgTreePane, { nextAvatar } from "./components/views/OrgTreePane";
import MemoPane from "./components/views/MemoPane";
import ChatPane from "./components/views/ChatPane";
import TimetablePane from "./components/views/TimetablePane";
import AuditPane from "./components/views/AuditPane";
import WorkPane from "./components/views/WorkPane";
import SettingsPane from "./components/views/SettingsPane";
import SetupWizard from "./components/views/SetupWizard";

let toastSeq = 1;
let idSeq = 100;

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

export default function App() {
  const [booted, setBooted] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [view, setView] = useState<ActiveView>("org");
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
  // 쪽지 열기: 내 읽음을 남기고, 상대 PC 쪽지면 읽음 영수증을 보낸다.
  const [openMemoId, setOpenMemoId] = useState<string | null>(null);
  const openMemo = (id: string | null) => {
    setOpenMemoId(id);
    if (!id) return;
    setMemos((arr) => arr.map((m) => (m.id === id
      ? { ...m, to: m.to.map((r) => (r.uid === ME_ID && !r.readAt ? { ...r, readAt: nowIso() } : r)) }
      : m)));
    void persistRead(id);
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
  const [memoPreset, setMemoPreset] = useState<Teacher | null>(null);
  const [chatPeer, setChatPeer] = useState<Teacher | null>(null);
  // 3단 레이아웃: 우측 아크릴 패널(자리배치·파일·쪽지) 접기/펼치기
  const [rightPane, setRightPane] = useState(true);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [emergency, setEmergency] = useState<NoticeItem | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const [peers, setPeers] = useState<Peer[]>([]);
  const meRef = useRef<Teacher | null>(null);
  const teachersRef = useRef<Teacher[]>([]);
  const swapsRef = useRef<SwapRecord[]>([]);
  const netRef = useRef<NetworkState>("intranet");
  // 자동 전환: 교내망 PC가 연속으로 안 보인 횟수 (튀는 전환 방지)
  const noPeerTicks = useRef(0);
  const layout = useEdu((s) => s.layout);
  const motion = useEdu((s) => s.motion);
  const isClassic = layout === "classic";

  useEffect(() => {
    applyLayoutAttr(layout);
  }, [layout]);

  useEffect(() => {
    applyMotionAttr(motion);
  }, [motion]);

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
      ]);
      setHasProfile(got[0]);
      if (got[1]) setNet(got[1] as NetworkState);
      if (got[2]) setMeStatus(got[2] as TeacherStatus);
      if (got[3] != null) setAutoStatus(got[3] as boolean);
      if (got[4]) setFont(got[4] as FontKind);
      if (got[5]) setSchool(got[5] as SchoolSetup);
      if (got[6]) setTeachers(got[6] as Teacher[]);
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
      const my = (got[6] as Teacher[] | null)?.find((t) => t.id === ME_ID);
      if (got[0] && my) syncMe(my.name);
      setBooted(true);
      // 설치판이면 SQLite가 진짜 저장소 — 화면 상태와 합친 뒤 시간표를 역동기화한다
      void hydrateMemos().then((remote) => {
        if (remote && remote.length) setMemos((s) => mergeMemos(s, remote));
      });
      const tt = got[11] as TimetableCell[] | null;
      if (tt && tt.length) void syncTimetable(tt, "부팅 동기화");
    })();
  }, []);

  // 바뀌면 로컬 DB에 저장 (설치형이므로 서버 전송 없음)
  useEffect(() => { if (booted) storeSet("net", net); }, [net, booted]);
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
          ? { ...t, status: (ids.has(t.id) ? "online" : "offwork") as Teacher["status"], statusMessage: ids.has(t.id) ? "교내망" : "꺼져 있음" }
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

  const me = teachers.find((t) => t.id === ME_ID) ?? null;
  meRef.current = me;
  teachersRef.current = teachers;
  swapsRef.current = swaps;
  netRef.current = net;
  const chatOnly = (license?.kind ?? "full") === "chatOnly";

  // 하이브리드 망: 내부망을 벗어나면 교내망 채팅방·조직을 목록에서 숨긴다 (서버엔 남아 있음 → 복귀 시 복원)
  const intranetOn = intranetVisible(net, license);
  const externalOnly = isExternalOnlySchool(license);
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
    if (!booted || !hasProfile || !netAuto || externalOnly) return;
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
        const ev = pl as { id: string; title: string; body: string; from: string; from_name: string } | null;
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
        toast(`${ev.from_name || "상대"}에게 쪽지가 왔어요.`);
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
          toast(`${ev.from_name || "상대"}에게 대화가 왔어요.`);
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
        toast(`${ev.from_name || "상대"}이 확인을 요청했어요.`);
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
        toast(`🔄 ${fromName}의 보강 요청이 왔어요. 시간표 탭에서 수락해 주세요.`);
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
        toast(`✅ ${ev?.from_name || "상대"}가 보강을 수락했어요. 시간표에 반영했어요.`);
      }),
      listenEvent("substitute-rejected", (pl) => {
        const ev = pl as { ref_id?: string; from_name?: string } | null;
        const refId = String(ev?.ref_id ?? "");
        if (!refId) return;
        setSwaps((s) => s.map((x) => (x.rustId === refId || x.id === refId ? { ...x, status: "rejected" as const } : x)));
        void persistSwapAccept(refId, false);
        toast(`↩️ ${ev?.from_name || "상대"}가 보강을 거절했어요.`);
      }),
    ];
    return () => { offs.forEach((off) => off()); };
  }, []);

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

  // 자동 상태가 켜져 있으면 수업 시간에 수업중으로, 끝나면 온라인으로 되돌린다
  useEffect(() => {
    if (!autoStatus || chatOnly) return;
    setTeachers((ts) =>
      ts.map((t) => {
        if (t.id !== ME_ID) return t;
        if (classNow && (t.status === "online" || t.status === "teaching")) {
          return { ...t, status: "teaching", statusMessage: `${classNow.period}교시 수업 중 (${me?.grade} ${me?.classNo} ${classNow.subject})` };
        }
        if (!classNow && t.status === "teaching" && /수업 중/.test(t.statusMessage)) {
          return { ...t, status: "online", statusMessage: `${me?.grade} ${me?.classNo} 담임` };
        }
        return t;
      })
    );
  }, [classNow, autoStatus, chatOnly, me?.grade, me?.classNo]);

  const toast = (text: string) => {
    try {
      if (useEdu.getState().toastOn === false) return;
    } catch {
      /* 그대로 표시 */
    }
    const id = toastSeq++;
    setToasts((s) => [...s.slice(-2), { id, text }]);
    setTimeout(() => setToasts((s) => s.filter((t) => t.id !== id)), 3200);
  };

  const dismissToast = (id: number) => {
    setToasts((s) => s.filter((t) => t.id !== id));
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

  const unreadMemo = memos.filter((m) => m.to.some((r) => r.uid === ME_ID && !r.readAt)).length;
  const unreadChat = Object.entries(chats)
    .filter(([pid]) => visibleTeacherIds.has(pid))
    .flatMap(([, list]) => list)
    .filter((m) => !m.mine && !m.read).length;
  const pendingSwap = swaps.filter((s) => s.status === "pending").length;

  const sendMemo = (title: string, body: string, toIds: string[], hwpName: string, importance: Memo["importance"]) => {
    if (!me) return { ok: false, error: "프로필이 없어요." };
    const to = toIds.map((id) => {
      const t = teachers.find((x) => x.id === id);
      return { uid: id, name: t?.name ?? id, readAt: null as string | null, nudgedAt: null as string | null };
    });
    const m: Memo = {
      id: uid("memo"), title, body, fromUid: ME_ID, fromName: me.name, to,
      importance, hwpName, hwpSize: 0,
      createdAt: nowIso(),
    };
    setMemos((s) => [m, ...s]);
    // 같은 ID로 SQLite에도 저장 (검색·감사·재부팅 복구가 같은 쪽지를 본다)
    void persistMemo(m);
    toast(`쪽지를 보냈어요 (${net === "intranet" ? "교내망 P2P" : "외부망 · 이 PC 저장"}) · ${to.length}명`);
    for (const id of toIds) {
      if (isPeer(id)) void transmit(id, "memo", title.trim(), body.trim(), m.id);
    }
    return { ok: true };
  };

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
    void persistQuick(peerId, peerName, body).then(settle).catch(() => settle(null));
    if (isPeer(peerId)) void transmit(peerId, "quick", "", body, msg.id);
    return { ok: true };
  };

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

  // 예약 쪽지 due 체커: 30초마다 시각이 된 예약을 실제 쪽지로 보낸다
  useEffect(() => {
    if (!booted || !hasProfile) return;
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
    autoStatus && classNow && (meStatus === "online" || meStatus === "teaching") ? "teaching" : meStatus;

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
      <TitleBar onPreviewAction={() => toast("미리보기예요. 창 버튼은 Windows 설치판에서 동작해요.")} />
      <MorningPopup />
      <div className="flex-1 min-h-0 flex overflow-hidden">
      <LeftSidebar
        me={{ ...me, status: displayStatus }}
        teachers={visibleTeachers}
        depts={visibleDepts}
        net={net}
        intranetHidden={!intranetOn && teachers.some((t) => isIntranetScoped(t))}
        externalOnly={externalOnly}
        view={view}
        narrow={isClassic}
        unreadMemo={unreadMemo}
        unreadChat={unreadChat}
        pendingSwap={pendingSwap}
        autoStatus={autoStatus}
        classNowText={classNowText}
        onStatus={(s) => {
          setMeStatus(s);
          setTeachers((ts) => ts.map((t) => (t.id === ME_ID ? { ...t, status: s, statusMessage: s === "online" ? `${me.grade} ${me.classNo} 담임` : s === "teaching" ? classNowText || "수업 중" : s === "away" ? "외출/출장" : s === "offwork" ? "퇴근" : "방해금지" } : t)));
        }}
        onNet={() => {
          // 직접 누르면 자동 전환은 꺼진다 (사용자 선택을 존중)
          setNetAuto(false);
          setNet((n) => (n === "intranet" ? "external" : "intranet"));
          toast(net === "intranet" ? "🟢 외부연결로 바꿨어요." : "🔵 교내연결로 바꿨어요.");
        }}
        onView={setView}
        onToast={toast}
      />
      <main className="flex-1 min-w-0 h-full overflow-y-auto">
        <div key={view} className={`anim-page py-3 core-main-inner mx-auto ${isClassic ? "px-3 max-w-[430px]" : "px-4 max-w-[1100px]"}`}>
          <div className="flex items-center gap-2 mb-2.5">
            <h1 className="font-black text-[17px]">
              {view === "org" ? "조직도" : view === "memo" ? "쪽지함" : view === "chat" ? "빠른 대화" : view === "timetable" ? "시간표·대강" : view === "work" ? "업무/공지" : view === "settings" ? "설정" : "보안·감사"}
            </h1>
            <span className="text-[11.5px] text-edu-sub">
              {net === "intranet" ? "교내연결 · 내부망" : "외부연결"}
              {school.schoolName ? ` · ${school.schoolName}` : ""}
              {chatOnly ? " · 소통 전용" : ""}
            </span>
            {!isClassic && (
              <>
                <span className="flex-1" />
                <button
                  className="edu-ghost !py-1 !px-2.5 !text-[12px]"
                  onClick={() => setRightPane((v) => !v)}
                  title="우측 패널(자리배치·파일·쪽지) 접기/펼치기"
                >
                  {rightPane ? "▸ 패널 접기" : "◂ 패널 펴기"}
                </button>
              </>
            )}
          </div>
          {view === "org" && (
            <OrgTreePane
              teachers={visibleTeachers}
              depts={visibleDepts}
              onMemo={(t) => { setMemoPreset(t); setView("memo"); }}
              onChat={(t) => { setChatPeer(t); setView("chat"); }}
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
              onOpen={openMemo}
              onSend={sendMemo}
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
                });
                const target = memos.find((m) => m.id === memoId)?.fromUid;
                if (target && target !== ME_ID && isPeer(target)) void transmit(target, "comment", "", body, memoId);
              }}
              onImportance={(memoId, imp) => {
                setMemos((arr) => arr.map((m) => (m.id === memoId ? { ...m, importance: imp } : m)));
                void persistImportance(memoId, imp);
                toast(imp === "urgent" ? "긴급 쪽지로 표시했어요." : imp === "ref" ? "참고 쪽지로 표시했어요." : "일반 쪽지로 표시했어요.");
              }}
              onToast={toast}
              onGoChat={() => setView("chat")}
              onAudit={audit}
            />
          )}
          {view === "chat" && (
            <ChatPane
              peer={chatPeer}
              teachers={teachers.filter((t) => t.id !== ME_ID)}
              chats={chats}
              onPeer={(t) => {
                setChatPeer(t);
                setChats((s) => ({ ...s, [t.id]: (s[t.id] ?? []).map((m) => ({ ...m, read: true })) }));
                // SQLite에 쌓인 대화를 덧붙인다 (이미 있는 본문은 중복 제외)
                // 같은 말을 여러 번 보냈을 때를 위해 개수만큼만 걸러낸다
                void fetchQuicks(t.id).then((rows) => {
                  if (!rows || !rows.length) return;
                  setChats((s) => {
                    const list = s[t.id] ?? [];
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
                    return { ...s, [t.id]: [...list, ...fresh] };
                  });
                });
              }}
              onSend={sendChat}
              onReact={(peerId, msgId, emoji) => {
                setChats((s) => ({ ...s, [peerId]: (s[peerId] ?? []).map((m) => (m.id === msgId && !m.emoji.includes(emoji) ? { ...m, emoji: [...m.emoji, emoji] } : m)) }));
              }}
              onToast={toast}
              onGoMemo={() => setView("memo")}
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
              webUrl="https://school-chat-9e69f.web.app"
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
              onPublish={(title, body, urgent, scope, dept) => {
                const n: NoticeItem = { id: uid("n"), title, body, level: urgent ? "urgent" : "normal", scope, dept, fromName: me.name, createdAt: nowIso(), popup: urgent };
                setNotices((s) => [n, ...s]);
                if (urgent) setEmergency(n);
                toast(urgent ? "긴급 공지를 전체 팝업으로 올렸어요." : scope === "dept" ? `${dept}에 공지를 올렸어요.` : "전교직원 공지를 올렸어요.");
              }}
              onTogglePopup={(id) => {
                setNotices((s) => s.map((n) => (n.id === id ? { ...n, popup: !n.popup } : n)));
                const n = notices.find((x) => x.id === id);
                if (n && !n.popup) setEmergency({ ...n, popup: true });
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
          {view === "settings" && (
            <SettingsPane
              autoStatus={autoStatus}
              onAutoStatus={setAutoStatus}
              netAuto={netAuto}
              onNetAuto={setNetAuto}
              font={font}
              onFont={setFont}
            />
          )}
        </div>
      </main>
      {!isClassic && rightPane && (
        <RightPanel
          teachers={visibleTeachers}
          memos={memos}
          meId={ME_ID}
          onOpenMemo={(id) => { openMemo(id); setView("memo"); }}
          onGoWork={() => setView("memo")}
          onToast={toast}
        />
      )}
      {emergency && (
        <div className="edu-overlay" onClick={() => setEmergency(null)}>
          <div className="edu-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="font-black text-[17px] text-[#D92D20]">🚨 긴급 공지</div>
            <div className="font-extrabold text-[15px] mt-1">{emergency.title}</div>
            <div className="text-[13.5px] mt-1.5 whitespace-pre-wrap">{emergency.body}</div>
            <div className="text-[12px] text-edu-sub mt-1">{emergency.fromName} · {emergency.createdAt}</div>
            <button className="edu-btn w-full mt-3" onClick={() => setEmergency(null)}>확인했어요</button>
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
      <div className="edu-toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className="edu-toast">
            <span className="break-words">{t.text}</span>
            <button className="edu-toast-x" aria-label="알림 닫기" onClick={() => dismissToast(t.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
