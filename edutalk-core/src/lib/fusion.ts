// 메신저 × 시간표 합체 전용 로직 (브리즈 중심)
// - 어느 한쪽만 있을 때는 할 수 없고, 둘을 합쳐야만 되는 기능만 둔다.
import type { SwapRecord, Teacher, TimetableCell } from "../types";

// 기본 교시표 (학교마다 쉬는시간이 다르므로 분 단위로만 계산한다)
export const PERIOD_TABLE: { period: number; start: string; end: string }[] = [
  { period: 1, start: "09:00", end: "09:50" },
  { period: 2, start: "10:00", end: "10:50" },
  { period: 3, start: "11:00", end: "11:50" },
  { period: 4, start: "12:00", end: "12:50" },
  { period: 5, start: "13:50", end: "14:40" },
  { period: 6, start: "14:50", end: "15:40" },
  { period: 7, start: "15:50", end: "16:40" },
];

export function hmNow(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export interface ClassStatus {
  kind: "before" | "in-class" | "break" | "after" | "weekend";
  period: number | null;
  start: string;
  end: string;
  minutesLeft: number;
  nextPeriod: number | null;
  nextStart: string | null;
}

export function classStatusNow(d = new Date()): ClassStatus {
  const wd = d.getDay();
  if (wd < 1 || wd > 5) {
    return { kind: "weekend", period: null, start: "", end: "", minutesLeft: 0, nextPeriod: null, nextStart: null };
  }
  const hm = hmNow(d);
  const cur = toMin(hm);
  for (const t of PERIOD_TABLE) {
    const s = toMin(t.start);
    const e = toMin(t.end);
    if (cur >= s && cur < e) {
      return { kind: "in-class", period: t.period, start: t.start, end: t.end, minutesLeft: e - cur, nextPeriod: null, nextStart: null };
    }
  }
  // 쉬는시간 / 수업 전 / 방과후
  const first = toMin(PERIOD_TABLE[0].start);
  const last = toMin(PERIOD_TABLE[PERIOD_TABLE.length - 1].end);
  if (cur < first) {
    return { kind: "before", period: null, start: "", end: "", minutesLeft: first - cur, nextPeriod: 1, nextStart: PERIOD_TABLE[0].start };
  }
  if (cur >= last) {
    return { kind: "after", period: null, start: "", end: "", minutesLeft: 0, nextPeriod: null, nextStart: null };
  }
  for (let i = 0; i < PERIOD_TABLE.length - 1; i++) {
    const e = toMin(PERIOD_TABLE[i].end);
    const s = toMin(PERIOD_TABLE[i + 1].start);
    if (cur >= e && cur < s) {
      return { kind: "break", period: null, start: PERIOD_TABLE[i].end, end: PERIOD_TABLE[i + 1].start, minutesLeft: s - cur, nextPeriod: PERIOD_TABLE[i + 1].period, nextStart: PERIOD_TABLE[i + 1].start };
    }
  }
  return { kind: "break", period: null, start: "", end: "", minutesLeft: 0, nextPeriod: null, nextStart: null };
}

// 내 다음 수업 1칸 (오늘, 지금 이후 가장 빠른 것)
export function nextClassToday(
  cells: TimetableCell[],
  grade: string,
  classNo: string,
  myName: string,
  d = new Date()
): TimetableCell | null {
  const wd = d.getDay();
  if (wd < 1 || wd > 5) return null;
  const hm = hmNow(d);
  const mine = cells
    .filter((c) => c.weekday === wd && (c.grade === grade || c.teacher === myName))
    .sort((a, b) => a.period - b.period);
  for (const c of mine) {
    const t = PERIOD_TABLE.find((x) => x.period === c.period);
    if (!t) continue;
    if (hm < t.start) return c;
  }
  return null;
}

// 수업 5분 전인지 (합체 알림용)
export function isFiveMinBefore(period: number, d = new Date()): boolean {
  const t = PERIOD_TABLE.find((x) => x.period === period);
  if (!t) return false;
  const diff = toMin(t.start) - toMin(hmNow(d));
  return diff >= 0 && diff <= 5;
}

// 쉬는시간인지 (쉬는시간 발송 예약용 — 수업 중 발송 금지, 쉬는시간에 몰아 보내기)
export function isBreakNow(d = new Date()): boolean {
  const s = classStatusNow(d);
  return s.kind === "break" || s.kind === "before";
}

// 공강 겹치는 교사 (회의 소집용)
export function freeTeachersAt(
  teachers: Teacher[],
  cells: TimetableCell[],
  weekday: number,
  period: number,
  meId: string
): Teacher[] {
  const busy = new Set(
    cells.filter((c) => c.weekday === weekday && c.period === period).map((c) => c.teacher)
  );
  return teachers.filter((t) => t.id !== meId && !busy.has(t.name));
}

// 주간 변경 diff 키 (바뀐 칸 하이라이트용)
export function cellKey(c: Pick<TimetableCell, "weekday" | "period" | "grade" | "classNo">): string {
  return `${c.weekday}-${c.period}-${c.grade}-${c.classNo}`;
}

// 월별 대타 시수 집계 (수당 자료용)
export function monthlySubCount(swaps: SwapRecord[], yyyyMM: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of swaps) {
    if (s.status !== "accepted") continue;
    if (!s.date.startsWith(yyyyMM)) continue;
    out[s.toTeacher] = (out[s.toTeacher] ?? 0) + 1;
  }
  return out;
}

// 수업 중이면 쪽지를 예약큐로 (합체 DND — 수업 방해 금지)
export function shouldQueueDuringClass(autoDnd: boolean, d = new Date()): boolean {
  if (!autoDnd) return false;
  return classStatusNow(d).kind === "in-class";
}
