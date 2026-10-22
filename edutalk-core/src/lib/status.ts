// 브리즈 상태 시스템 (8종) — 단일 출처(single source of truth)
// 상태 코드 · 라벨 · 색 · 정렬 · 레거시 정규화를 모두 여기서 관리한다.
//
// [디자인 명세]
//  ONLINE          CheckCircle2  #22C55E  온라인 / 업무 가능
//  BUSY            MinusCircle   #EF4444  업무 집중 중
//  AWAY            Clock         #F59E0B  자리 비움
//  IN_CLASS        GraduationCap #3B82F6  수업 진행 중
//  OUT_OF_OFFICE   Briefcase     #A855F7  외근 / 출장
//  LUNCH           Utensils      #EAB308  점심 시간
//  MEETING         Users         #EC4899  회의 참석 중
//  ON_CALL         PhoneCall     #64748B  통화 중

import type { TeacherStatus } from "../types";

export type StatusIconName =
  | "checkCircle"
  | "minusCircle"
  | "clock"
  | "graduationCap"
  | "briefcase"
  | "utensils"
  | "users"
  | "phoneCall";

export interface StatusMeta {
  code: TeacherStatus;
  /** UI 표기용 코드 (서버·감사로그 호환) */
  upper: string;
  /** 긴 라벨 — 온라인 / 업무 가능 */
  label: string;
  /** 짧은 라벨 — 온라인 */
  short: string;
  /** 아이콘 */
  icon: StatusIconName;
  /** 대표 컬러 (점·아이콘) */
  color: string;
  /** 정렬 우선순위 (낮을수록 위) */
  order: number;
  /** "접속 중(업무 가능성 있음)" 집계 대상 */
  present: boolean;
}

export const STATUS_META: Record<TeacherStatus, StatusMeta> = {
  online: { code: "online", upper: "ONLINE", label: "온라인 / 업무 가능", short: "온라인", icon: "checkCircle", color: "#22C55E", order: 0, present: true },
  in_class: { code: "in_class", upper: "IN_CLASS", label: "수업 진행 중", short: "수업중", icon: "graduationCap", color: "#3B82F6", order: 1, present: true },
  busy: { code: "busy", upper: "BUSY", label: "업무 집중 중", short: "집중중", icon: "minusCircle", color: "#EF4444", order: 2, present: true },
  lunch: { code: "lunch", upper: "LUNCH", label: "점심 시간", short: "점심", icon: "utensils", color: "#EAB308", order: 3, present: true },
  meeting: { code: "meeting", upper: "MEETING", label: "회의 참석 중", short: "회의중", icon: "users", color: "#EC4899", order: 4, present: true },
  on_call: { code: "on_call", upper: "ON_CALL", label: "통화 중", short: "통화중", icon: "phoneCall", color: "#64748B", order: 5, present: true },
  away: { code: "away", upper: "AWAY", label: "자리 비움", short: "자리비움", icon: "clock", color: "#F59E0B", order: 6, present: false },
  out_of_office: { code: "out_of_office", upper: "OUT_OF_OFFICE", label: "외근 / 출장", short: "외근", icon: "briefcase", color: "#A855F7", order: 7, present: false },
};

/** 상태 선택 메뉴 표시 순서 */
export const STATUS_LIST: TeacherStatus[] = [
  "online",
  "busy",
  "away",
  "in_class",
  "out_of_office",
  "lunch",
  "meeting",
  "on_call",
];

/**
 * 레거시·서버 표기 → 신규 코드 정규화.
 *  - 구형(5종): teaching → in_class, offwork → away, dnd → busy
 *  - 서버(onprem): ONLINE/IN_CLASS/TRIP/AWAY/BUSY/LUNCH/MEETING/ON_CALL …
 */
export function normalizeStatus(raw: unknown): TeacherStatus {
  const s = String(raw ?? "").trim().toLowerCase();
  switch (s) {
    case "online":
      return "online";
    case "busy":
    case "dnd":
      return "busy";
    case "away":
      return "away";
    case "in_class":
    case "inclass":
    case "teaching":
    case "class":
      return "in_class";
    case "out_of_office":
    case "outofoffice":
    case "trip":
    case "business_trip":
      return "out_of_office";
    case "lunch":
      return "lunch";
    case "meeting":
      return "meeting";
    case "on_call":
    case "oncall":
    case "call":
      return "on_call";
    case "offwork":
    case "off_work":
    case "off":
      // 퇴근은 "자리 비움"으로 흡수 (표시 문구로 구분)
      return "away";
    default:
      return "online";
  }
}

/** 접속(업무 가능성) 집계 */
export function isPresentStatus(status: TeacherStatus): boolean {
  return STATUS_META[status]?.present ?? false;
}

/** 배열 정렬: 접속 우선 → 이름 */
export function statusSortKey(status: TeacherStatus): number {
  return STATUS_META[status]?.order ?? 99;
}

/** Focus Mode(퇴근 후 업무 휴식) 표시 문구 */
export const FOCUS_MESSAGE = "퇴근 후 업무 휴식 중";

export interface StatusDisplay {
  status: TeacherStatus;
  /** 프로필 상태 문구 (Focus Mode면 고정 문구) */
  text: string;
  short: string;
  color: string;
  icon: StatusIconName;
  /** Focus Mode로 표출 중인지 */
  focus: boolean;
}

/**
 * 상태 표시 계산 — Focus Mode(퇴근 후)면 "퇴근 후 업무 휴식 중"으로 덮어쓴다.
 */
export function displayStatus(status: TeacherStatus, focusActive: boolean, statusMessage?: string): StatusDisplay {
  const meta = STATUS_META[status] ?? STATUS_META.online;
  if (focusActive) {
    return { status: "away", text: FOCUS_MESSAGE, short: "휴식중", color: "#64748B", icon: "clock", focus: true };
  }
  return {
    status,
    text: statusMessage?.trim() || meta.label,
    short: meta.short,
    color: meta.color,
    icon: meta.icon,
    focus: false,
  };
}

/** 기본 상태 문구 (내 상태를 바꿀 때 프로필에 넣는 문구) */
export function defaultMessageFor(s: TeacherStatus): string {
  switch (s) {
    case "online":
      return "업무 가능";
    case "busy":
      return "업무 집중 중";
    case "away":
      return "자리 비움";
    case "in_class":
      return "수업 진행 중";
    case "out_of_office":
      return "외근 / 출장";
    case "lunch":
      return "점심 시간";
    case "meeting":
      return "회의 참석 중";
    case "on_call":
      return "통화 중";
    default:
      return "업무 가능";
  }
}
