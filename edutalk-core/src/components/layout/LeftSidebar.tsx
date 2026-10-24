// 브리즈 좌측 레일 (2026-10 개편)
//  · 세로형/가로형 구분 없이 "하나의 유연 레일" — 조직도 내장 패널 제거(중복 조직도 버그 근절)
//  · 좁은 창에서도 아이콘 단독 노출 금지 → 항상 [아이콘 + 텍스트]
//  · 최소 너비 140px (min-width), 창 폭에 따라 152↔208px 유연, 서브 텍스트 자동 축소
//  · 프로필 하단에 상태 픽커(8종) + 로그아웃 (ROLE_ADMIN / ROLE_TEACHER 공통)

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { ActiveView, DeptGroup, NetworkState, Teacher, TeacherStatus, UserRole } from "../../types";
import { STATUS_META, normalizeStatus, isPresentStatus } from "../../lib/status";
import { FOCUS_MESSAGE } from "../../lib/focus";
import BzTooltip from "../ui/BzTooltip";
import { useContextMenu, type BzMenuItem } from "../ui/BzContextMenu";
import { StatusBadge, StatusPicker } from "../ui/BzStatus";
import { bzConfirm } from "../ui/BzDialog";
import {
  IconBarChart,
  IconCalendar,
  IconChat,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconCloudIcon,
  IconGrid,
  IconLogout,
  IconMegaphone,
  IconNote,
  IconPrinter,
  IconReply,
  IconSchool,
  IconSettingsGear,
  IconShield,
  IconStickyNote,
} from "../ui/BzIcons";
import { APP_VERSION } from "../../lib/version";

// 레거시 호환 재수출 — 다른 화면들이 이 경로에서 상태 메타를 가져온다.
export { STATUS_META };

export function PresenceDot({ status, className = "" }: { status: TeacherStatus; className?: string }) {
  const s = normalizeStatus(status);
  return <span className={`presence-dot ${s} ${className}`} aria-hidden="true" />;
}

export interface TabDef {
  id: ActiveView;
  icon: ReactNode;
  label: string;
}

const TEACHER_TABS: TabDef[] = [
  { id: "org", icon: <IconSchool size={19} />, label: "조직도" },
  { id: "memo", icon: <IconNote size={19} />, label: "쪽지함" },
  { id: "student-inbox", icon: <IconReply size={19} />, label: "학생 문의" },
  { id: "chat", icon: <IconChat size={19} />, label: "빠른 대화" },
  { id: "timetable", icon: <IconCalendar size={19} />, label: "시간표·대강" },
  { id: "work", icon: <IconMegaphone size={19} />, label: "업무/공지" },
  { id: "consult", icon: <IconStickyNote size={19} />, label: "AI 상담 일지" },
  { id: "approval", icon: <IconCheckCircle size={19} />, label: "전자결재" },
  { id: "whiteboard", icon: <IconGrid size={19} />, label: "협업 보드" },
  { id: "cloud", icon: <IconCloudIcon size={19} />, label: "브리즈 클라우드" },
  { id: "print", icon: <IconPrinter size={19} />, label: "보안 인쇄" },
  { id: "survey", icon: <IconBarChart size={19} />, label: "설문조사" },
  { id: "audit", icon: <IconShield size={19} />, label: "보안·감사" },
  { id: "settings", icon: <IconSettingsGear size={19} />, label: "설정" },
];

const RAIL_MIN = 176;
const RAIL_MAX = 360;
const RAIL_COLLAPSE_AT = 128;

function clampRail(v: number) {
  return Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.round(v)));
}

const ADMIN_TABS: TabDef[] = [
  { id: "admin-dashboard", icon: <IconGrid size={19} />, label: "대시보드" },
  { id: "admin-users", icon: <IconSchool size={19} />, label: "사용자 관리" },
  { id: "admin-notices", icon: <IconMegaphone size={19} />, label: "공지 관리" },
  { id: "admin-timetable", icon: <IconCalendar size={19} />, label: "시간표 관리" },
  { id: "admin-audit", icon: <IconShield size={19} />, label: "감사 로그" },
  { id: "admin-settings", icon: <IconSettingsGear size={19} />, label: "학교 설정" },
  { id: "admin-school", icon: <IconSchool size={19} />, label: "학교 정보" },
  { id: "work", icon: <IconMegaphone size={19} />, label: "업무/공지" },
  { id: "memo", icon: <IconNote size={19} />, label: "쪽지함" },
  { id: "student-inbox", icon: <IconReply size={19} />, label: "학생 문의" },
  { id: "consult", icon: <IconStickyNote size={19} />, label: "AI 상담 일지" },
  { id: "approval", icon: <IconCheckCircle size={19} />, label: "전자결재" },
  { id: "whiteboard", icon: <IconGrid size={19} />, label: "협업 보드" },
  { id: "cloud", icon: <IconCloudIcon size={19} />, label: "브리즈 클라우드" },
  { id: "survey", icon: <IconBarChart size={19} />, label: "설문조사" },
  { id: "org", icon: <IconSchool size={19} />, label: "조직도" },
  { id: "settings", icon: <IconSettingsGear size={19} />, label: "설정" },
];

/** 로그인 역할과 네트워크에 따라 실제로 보여 줄 수 있는 메뉴 목록. */
export function navItemsForRole(role: UserRole | undefined, net: NetworkState): TabDef[] {
  const isAdmin = role === "admin" || role === "superadmin";
  return (isAdmin ? ADMIN_TABS : TEACHER_TABS).filter((t) => !(net === "external" && t.id === "cloud"));
}

function normalizeOrder(order: ActiveView[] | undefined, ids: ActiveView[]): ActiveView[] {
  const known = new Set(ids);
  const out: ActiveView[] = [];
  for (const id of order ?? []) {
    if (known.has(id) && !out.includes(id)) out.push(id);
  }
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

interface Props {
  me: Teacher;
  teachers: Teacher[];
  depts: DeptGroup[];
  net: NetworkState;
  view: ActiveView;
  /** 좁은 창(classic)일 때 컴팩트 레일 (아이콘+텍스트는 유지, 폭만 축소) */
  narrow?: boolean;
  /** 창을 넓게 키웠을 때 넓은 레일 */
  expand?: boolean;
  /** 좁은 화면에서 복잡한 새 기능을 열 때 레일을 잠시 접는다. */
  autoCollapse?: boolean;
  unreadMemo: number;
  unreadStudent: number;
  unreadChat: number;
  pendingSwap: number;
  autoStatus: boolean;
  classNowText: string;
  onStatus: (s: TeacherStatus) => void;
  onNet: () => void;
  onView: (v: ActiveView) => void;
  onToast: (t: string) => void;
  intranetHidden?: boolean;
  externalOnly?: boolean;
  /** 듀얼망 학교만 내부/외부 전환을 보여준다. 단일망 학교는 이 값을 false로 숨긴다. */
  dualNetwork?: boolean;
  userRole?: UserRole;
  /** 교사가 숨긴 메뉴 (설정에서 다시 표시) */
  hiddenTabs?: ActiveView[];
  /** 사용자가 끌어서 바꾼 메뉴 순서 */
  tabOrder?: ActiveView[];
  onHideTab?: (id: ActiveView) => void;
  onReorderTabs?: (order: ActiveView[]) => void;
  /** 로그아웃 (설정 화면과 동일 동작) */
  onLogout?: () => void;
  /** 퀵 메모(포스트잇) 레이어 토글 */
  onQuickMemo?: () => void;
  /** 퀵 메모 열려 있는 개수 뱃지 */
  quickMemoOpen?: number;
  /** Focus Mode(퇴근 후 업무 휴식) 활성 */
  focusActive?: boolean;
  /** 네트워크 연결 상태 (false면 오프라인 — 보관함 안내를 띄운다) */
  netOnline?: boolean;
  /** 오프라인 보관함에 쌓인 안 보낸 쪽지·대화 수 */
  outboxCount?: number;
}

export default function LeftSidebar(p: Props) {
  const isAdmin = p.userRole === "admin" || p.userRole === "superadmin";
  const compact = !!p.narrow && !p.expand;
  // 외부망에서는 무거운 클라우드 메뉴를 아예 숨기고, 교사가 숨긴 메뉴는 설정에서 되살린다.
  const baseTabs = navItemsForRole(p.userRole, p.net);
  const hidden = new Set(p.hiddenTabs ?? []);
  const orderedIds = normalizeOrder(p.tabOrder, baseTabs.map((t) => t.id));
  const orderIndex = new Map(orderedIds.map((id, i) => [id, i]));
  const tabs = baseTabs
    .filter((t) => !hidden.has(t.id))
    .sort((a, b) => (orderIndex.get(a.id) ?? 999) - (orderIndex.get(b.id) ?? 999));

  // 접기/펴기 — 넓은 화면에서 레일을 아이콘만 남겨 작업 공간을 확보한다.
  //  · 상태는 localStorage에 기억해 앱을 다시 켜도 유지된다.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("edutalk-rail-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [railWidth, setRailWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("edutalk-rail-width"));
      return clampRail(Number.isFinite(saved) && saved > 0 ? saved : compact ? 184 : 224);
    } catch {
      return compact ? 184 : 224;
    }
  });
  const [dragging, setDragging] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [dragTabId, setDragTabId] = useState<ActiveView | null>(null);
  const contextMenu = useContextMenu();
  const autoRestore = useRef<boolean | null>(null);

  // AI 상담·전자결재·협업 보드는 좁은 창에서 작업 공간이 필요하다.
  // 새 기능에 들어갈 때만 레일을 접고, 나올 때 사용자가 원래 두었던 상태로 돌린다.
  useEffect(() => {
    if (p.autoCollapse) {
      if (autoRestore.current === null) autoRestore.current = collapsed;
      if (!collapsed) persistCollapsed(true);
      return;
    }
    if (autoRestore.current !== null) {
      const restore = autoRestore.current;
      autoRestore.current = null;
      persistCollapsed(restore);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.autoCollapse]);

  const persistCollapsed = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem("edutalk-rail-collapsed", next ? "1" : "0");
    } catch {
      /* 저장소가 막혀 있어도 이번 실행 동안은 동작 */
    }
  };
  const toggleRail = () => persistCollapsed(!collapsed);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = collapsed ? 70 : compact ? Math.min(210, railWidth) : railWidth;
    let isCollapsed = collapsed;
    let nextWidth = railWidth;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const raw = startWidth + (ev.clientX - startX);
      if (raw < RAIL_COLLAPSE_AT) {
        if (!isCollapsed) {
          isCollapsed = true;
          persistCollapsed(true);
        }
        return;
      }
      if (isCollapsed) {
        isCollapsed = false;
        persistCollapsed(false);
      }
      const next = clampRail(raw);
      nextWidth = next;
      setRailWidth(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem("edutalk-rail-width", String(nextWidth));
        localStorage.setItem("edutalk-rail-collapsed", isCollapsed ? "1" : "0");
      } catch {
        /* 다음에 */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const effectiveWidth = collapsed ? 70 : compact ? Math.min(210, railWidth) : railWidth;

  const getBadge = (id: ActiveView) => {
    if (id === "memo") return p.unreadMemo;
    if (id === "student-inbox") return p.unreadStudent;
    if (id === "chat") return p.unreadChat;
    if (id === "timetable") return p.pendingSwap;
    if (id === "admin-timetable") return p.pendingSwap;
    return 0;
  };

  const presentCount = p.teachers.filter((t) => isPresentStatus(t.status)).length;

  const netLabel = p.externalOnly
    ? compact
      ? "외부 고정"
      : "외부연결 · 클라우드 고정"
    : p.net === "intranet"
      ? compact
        ? "교내연결"
        : "교내연결 · 교내망"
      : compact
        ? "외부연결"
        : "외부연결 · 외부망";

  const netTip = p.externalOnly
    ? "클라우드 고정 학교 — 교내연결을 쓸 수 없어요"
    : p.net === "intranet"
      ? "교내연결 (내부망) — 누르면 외부연결로 전환"
      : "외부연결 — 누르면 교내연결로 전환";

  const askLogout = async () => {
    if (!p.onLogout) return;
    const ok = await bzConfirm({
      title: "로그아웃 할까요?",
      message: "다시 이용하려면 교원 ID와 비밀번호로 로그인해야 해요.",
      confirmText: "로그아웃",
      danger: true,
    });
    if (ok) p.onLogout();
  };

  const openTabMenu = (e: React.MouseEvent, tab: TabDef) => {
    const items: BzMenuItem[] = [
      {
        id: "hide",
        label: "메뉴 숨기기",
        hint: tab.id === "settings" ? "항상 표시" : "설정에서 복원",
        disabled: tab.id === "settings",
        onSelect: () => p.onHideTab?.(tab.id),
      },
      { id: "sep", separator: true },
      {
        id: "reorder",
        label: "순서 변경",
        hint: "끌어서 이동",
        onSelect: () => {
          setReorderMode(true);
          p.onToast("메뉴를 끌어서 순서를 바꾼 뒤 [완료]를 눌러 주세요.");
        },
      },
    ];
    contextMenu(e, items, tab.label);
  };

  const commitReorder = (fromId: ActiveView, toId: ActiveView) => {
    if (fromId === toId || !p.onReorderTabs) return;
    const ids = normalizeOrder(p.tabOrder, baseTabs.map((t) => t.id));
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    p.onReorderTabs(ids);
  };

  return (
    <aside
      data-rail={compact ? "compact" : "wide"}
      data-collapsed={collapsed ? "true" : "false"}
      data-reorder={reorderMode ? "true" : "false"}
      style={{ width: effectiveWidth }}
      className={`edu-rail relative z-20 shrink-0 h-full bg-edu-surface border-r border-edu-line flex flex-col py-2.5 px-1.5 ${
        dragging ? "rail-dragging" : "transition-[width] duration-200"
      }`}
    >
      {/* ---------- 프로필 + 작은 접기 버튼 ---------- */}
      {/* 이름·부서는 각각 한 줄을 온전히 쓰고, 접힌 상태에서는 아바타와 펴기 버튼만 세로로 쌓는다. */}
      <div className={`profile-row relative flex flex-col px-1 ${collapsed ? "items-center gap-1.5" : "gap-1"}`}>
        <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? "flex-col gap-1.5" : "w-full"}`}>
          <BzTooltip content={`${p.me.name || "내 프로필"} · ${p.me.dept}`} position="right" disabled={!collapsed}>
            <div
              className={`${collapsed ? "w-8 h-8 rounded-lg text-[13px]" : "w-10 h-10 rounded-xl text-base"} grid place-items-center text-white font-black shrink-0 select-none`}
              style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}
            >
              {isAdmin ? "관" : (p.me.name || "B").slice(0, 1)}
            </div>
          </BzTooltip>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="rail-label font-extrabold truncate text-edu-ink" title={p.me.name || "내 프로필"}>
                {p.me.name || "내 프로필"}
              </div>
            </div>
          )}
          <BzTooltip content={collapsed ? "메뉴 펼치기" : "메뉴 접기"} position="right">
            <button
              type="button"
              onClick={toggleRail}
              aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
              aria-expanded={!collapsed}
              className="edu-rail-collapse shrink-0"
            >
              {collapsed ? <IconChevronRight size={13} /> : <IconChevronLeft size={13} />}
            </button>
          </BzTooltip>
        </div>
        {!collapsed && (
          <div className="rail-sub text-edu-sub truncate w-full" title={`${p.me.dept}${p.me.subject ? ` · ${p.me.subject}` : ""}`}>
            {p.me.dept}
            {p.me.subject ? ` · ${p.me.subject}` : ""}
          </div>
        )}
      </div>

      {/* 사이드바 폭 조절 손잡이 — 왼쪽 끝까지 끌면 접힌다. */}
      <div
        className="edu-rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="사이드바 폭 조절"
        title="끌어서 폭 조절 · 왼쪽 끝까지 끌면 접혀요"
        onPointerDown={startResize}
      />

      {/* ---------- 내 상태 (아이콘 + 컬러 점 + 텍스트) ---------- */}
      <div className="mt-2 px-0.5">
        <StatusPicker
          value={normalizeStatus(p.me.status)}
          onChange={p.onStatus}
          compact={compact || collapsed}
          focusActive={p.focusActive}
          className="w-full justify-between bg-edu-chip border border-edu-line px-2 py-1"
          caption={p.focusActive ? FOCUS_MESSAGE : "내 상태 바꾸기"}
        />
        {p.autoStatus && p.classNowText && (
          <div className="rail-status-extra mt-1.5 flex items-center gap-1">
            <StatusBadge status="in_class" compact text={p.classNowText} />
          </div>
        )}
      </div>

      {/* ---------- 네트워크 전환 (듀얼망 학교에만 표시) ---------- */}
      {p.dualNetwork && (
      <BzTooltip content={netTip} position="bottom" disabled={false} className="w-full">
        <button
          onClick={p.externalOnly ? undefined : p.onNet}
          aria-label={netLabel}
          title={netTip}
          className={`relative mt-2 w-full rounded-full h-9 text-[12.5px] font-extrabold text-white transition-transform active:scale-[0.98] inline-flex items-center justify-center gap-1.5 px-2 ${
            p.externalOnly ? "bg-edu-green cursor-default" : p.net === "intranet" ? "bg-edu-blue" : "bg-edu-green"
          }`}
        >
          <span aria-hidden>{p.externalOnly ? "☁️" : p.net === "intranet" ? "🔵" : "🟢"}</span>
          <span className="rail-label truncate">{netLabel}</span>
          {(p.netOnline === false || (p.outboxCount ?? 0) > 0) && (
            <span
              aria-hidden
              className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-edu-surface ${
                p.netOnline === false ? "bg-[#E5484D]" : "bg-[#F59E0B]"
              }`}
            />
          )}
        </button>
      </BzTooltip>
      )}
      {p.intranetHidden && (
        <div className="rail-sub mt-1.5 text-edu-sub bg-edu-chip border border-edu-line rounded-lg px-2 py-1">
          🔒 내부망 숨김
        </div>
      )}
      {p.netOnline === false && (
        <div className="rail-sub mt-1.5 text-edu-sub bg-edu-chip border border-edu-line rounded-lg px-2 py-1">
          📴 오프라인{p.outboxCount ? ` · 보관 ${p.outboxCount}건` : " · 보관함"}
        </div>
      )}
      {p.netOnline !== false && (p.outboxCount ?? 0) > 0 && (
        <div className="rail-sub mt-1.5 text-edu-sub bg-edu-chip border border-edu-line rounded-lg px-2 py-1">
          📤 전송 대기 {p.outboxCount}건
        </div>
      )}

      <span className="my-2 h-px bg-edu-line w-full" aria-hidden />

      {/* ---------- 탭 ---------- */}
      {reorderMode && (
        <div className="edu-rail-reorder mt-1 mb-1 mx-0.5 flex items-center gap-1 rounded-lg px-1.5 py-1">
          {!collapsed && <span className="min-w-0 flex-1 truncate text-[10.5px] font-bold">끌어서 순서 변경</span>}
          <button
            type="button"
            className="ml-auto rounded-md px-1.5 py-0.5 text-[10.5px] font-extrabold"
            onClick={() => {
              setReorderMode(false);
              setDragTabId(null);
              p.onToast("메뉴 순서를 저장했어요.");
            }}
          >
            완료
          </button>
        </div>
      )}
      <nav className="w-full flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5" aria-label="주 메뉴">
        {tabs.map((t) => {
          const badge = getBadge(t.id);
          const active = p.view === t.id;
          const btn = (
            <button
              key={t.id}
              onClick={() => { if (!reorderMode) p.onView(t.id); }}
              onContextMenu={(e) => openTabMenu(e, t)}
              draggable={reorderMode}
              onDragStart={(e) => {
                if (!reorderMode) return;
                setDragTabId(t.id);
                try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); } catch { /* Safari */ }
              }}
              onDragOver={(e) => { if (reorderMode) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
              onDrop={(e) => {
                if (!reorderMode) return;
                e.preventDefault();
                const from = (dragTabId || e.dataTransfer.getData("text/plain")) as ActiveView;
                if (from) commitReorder(from, t.id);
                setDragTabId(null);
              }}
              onDragEnd={() => setDragTabId(null)}
              className={`edu-rail-tab ${active ? "active" : ""} ${reorderMode ? "is-reordering" : ""} ${dragTabId === t.id ? "is-dragging" : ""}`}
              data-active={active ? "true" : undefined}
              aria-current={active ? "page" : undefined}
              aria-label={badge > 0 ? `${t.label}, 안 읽음 ${badge}` : t.label}
              title={reorderMode ? `${t.label} — 끌어서 순서를 바꿔 보세요` : undefined}
            >
              <span className="edu-rail-ico" aria-hidden>{t.icon}</span>
              <span className="rail-label edu-rail-txt truncate">{t.label}</span>
              {reorderMode && !collapsed && <span className="edu-rail-grip" aria-hidden>⋮⋮</span>}
              {!reorderMode && badge > 0 && <span className="edu-rail-badge">{badge > 99 ? "99+" : badge}</span>}
            </button>
          );
          // 접힌 상태에서는 아이콘만 보이므로 마우스를 올리면 이름(과 안읽음 수)을 툴팁으로 보여준다.
          return collapsed ? (
            <BzTooltip key={t.id} content={badge > 0 ? `${t.label} · 안읽음 ${badge}` : t.label} position="right" className="w-full">
              {btn}
            </BzTooltip>
          ) : (
            btn
          );
        })}
      </nav>

      <span className="my-2 h-px bg-edu-line w-full" aria-hidden />

      {/* ---------- 하단 유틸리티 ---------- */}
      <div className="w-full flex flex-col gap-0.5">
        <BzTooltip content="퀵 메모" position="right" disabled={!collapsed} className="w-full">
          <button className="edu-rail-tab" onClick={p.onQuickMemo} aria-label="퀵 메모">
            <span className="edu-rail-ico" aria-hidden><IconStickyNote size={18} /></span>
            <span className="rail-label edu-rail-txt truncate">퀵 메모</span>
            {p.quickMemoOpen ? <span className="edu-rail-badge soft">{p.quickMemoOpen}</span> : null}
          </button>
        </BzTooltip>
        <BzTooltip content="로그아웃" position="right" disabled={!collapsed} className="w-full">
          <button className="edu-rail-tab edu-rail-danger" onClick={askLogout} aria-label="로그아웃">
            <span className="edu-rail-ico" aria-hidden><IconLogout size={18} /></span>
            <span className="rail-label edu-rail-txt truncate">로그아웃</span>
          </button>
        </BzTooltip>
      </div>

      <div className="mt-2 px-1 flex items-center justify-between gap-1">
        <span className="rail-tiny text-edu-muted truncate">브리즈 v{APP_VERSION}</span>
        <span className="rail-tiny font-bold shrink-0 inline-flex items-center gap-1">
          <PresenceDot status="online" />
          <span className="text-edu-sub">{presentCount}</span>
        </span>
      </div>
    </aside>
  );
}
