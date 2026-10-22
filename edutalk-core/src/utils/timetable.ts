// Breeze Timetable Utils - 시간표 유틸리티 및 자동 상태 계산
// 시간표 연동: 교시별 시간표 데이터와 연동하여 [수업 중] 상태 자동 전환

import type { Teacher, TeacherStatus, TimetableCell } from '../types';

// 한국 표준 교시 시간표 (교육부 권장)
export const PERIOD_TIMES: readonly [string, string][] = [
  ['08:40', '09:30'],  // 1교시
  ['09:40', '10:30'],  // 2교시
  ['10:40', '11:30'],  // 3교시
  ['11:40', '12:30'],  // 4교시
  ['13:10', '14:00'],  // 5교시 (중식 후)
  ['14:10', '15:00'],  // 6교시
  ['15:10', '16:00'],  // 7교시
] as const;

export type PeriodInfo = {
  period: number;
  start: string;
  end: string;
  isActive: boolean;
};

export type CurrentClassInfo = {
  period: number;
  start: string;
  end: string;
  subject: string;
  room: string;
  grade: string;
  classNo: string;
  teacher: string;
} | null;

export type Weekday = 1 | 2 | 3 | 4 | 5; // 월~금

// 현재 시각 기준 현재 교시 계산
export function getCurrentPeriod(now: Date = new Date()): PeriodInfo | null {
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  for (let i = 0; i < PERIOD_TIMES.length; i++) {
    const [start, end] = PERIOD_TIMES[i];
    const isActive = hm >= start && hm < end;
    if (isActive || (i === PERIOD_TIMES.length - 1 && hm >= end)) {
      return {
        period: i + 1,
        start,
        end,
        isActive,
      };
    }
  }
  return null;
}

// 현재 요일 계산 (1=월, ..., 5=금, 0/6=주말)
export function getCurrentWeekday(now: Date = new Date()): Weekday | null {
  const day = now.getDay(); // 0=일, 1=월, ..., 6=토
  if (day === 0 || day === 6) return null;
  return day as Weekday;
}

// ── 스마트 출결(일과 상태) 연동 — 점심시간 자동 전환 ────────────────────────
// 평일 12:30~13:30에는 프로필 상태를 "점심 시간"으로 자동 변경한다 (수업 중이면 수업 우선).
export const LUNCH_START = '12:30';
export const LUNCH_END = '13:30';
/** 자동 점심 상태 문구 — 수동으로 고른 "점심 시간"과 구분해 자동 복귀 판단에 쓴다 */
export const LUNCH_AUTO_MESSAGE = '점심 시간 (12:30~13:30)';

export function isLunchTime(now: Date = new Date()): boolean {
  if (!getCurrentWeekday(now)) return false;
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hm >= LUNCH_START && hm < LUNCH_END;
}

// 교사의 현재 수업 정보 조회
export function getCurrentClass(
  teacher: Teacher,
  cells: TimetableCell[],
  now: Date = new Date()
): CurrentClassInfo {
  const periodInfo = getCurrentPeriod(now);
  const weekday = getCurrentWeekday(now);
  
  if (!periodInfo?.isActive || !weekday) return null;
  
  // 교사의 담당 학년/반으로 먼저 찾기
  let cell = cells.find(
    (c) =>
      c.weekday === weekday &&
      c.period === periodInfo.period &&
      c.grade === teacher.grade &&
      c.classNo === teacher.classNo
  );
  
  // 담임이 아닌 경우 교사명으로 찾기
  if (!cell) {
    cell = cells.find(
      (c) =>
        c.weekday === weekday &&
        c.period === periodInfo.period &&
        c.teacher === teacher.name
    );
  }
  
  if (!cell) return null;
  
  return {
    period: periodInfo.period,
    start: periodInfo.start,
    end: periodInfo.end,
    subject: cell.subject,
    room: cell.room,
    grade: cell.grade,
    classNo: cell.classNo,
    teacher: cell.teacher,
  };
}

// 자동 상태 메시지 생성
export function generateTeachingStatusMessage(classInfo: CurrentClassInfo): string {
  if (!classInfo) return "";
  return `${classInfo.period}교시 수업 중 (${classInfo.grade} ${classInfo.classNo} - ${classInfo.subject})`;
}

// 교사 상태 자동 계산 (시간표 연동 + 점심시간)
export function computeAutoStatus(
  teacher: Teacher,
  cells: TimetableCell[],
  now: Date = new Date()
): { status: TeacherStatus; statusMessage: string } | null {
  // 수동 상태(DND/외출/외근/회의/통화)는 자동 변경하지 않음
  if (teacher.status === 'busy' || teacher.status === 'away' || teacher.status === 'out_of_office' || teacher.status === 'meeting' || teacher.status === 'on_call') {
    return null;
  }

  const classInfo = getCurrentClass(teacher, cells, now);

  if (classInfo) {
    // 수업 중 (점심시간과 겹쳐도 수업이 우선)
    return {
      status: 'in_class',
      statusMessage: generateTeachingStatusMessage(classInfo),
    };
  }

  // 점심시간(평일 12:30~13:30) — 업무 가능/수업 중이었다면 점심으로 자동 전환
  if (isLunchTime(now) && (teacher.status === 'online' || teacher.status === 'in_class')) {
    return { status: 'lunch', statusMessage: LUNCH_AUTO_MESSAGE };
  }

  // 점심시간이 끝나면 자동 점심 → 온라인 복원 (수동으로 고른 점심 상태는 건드리지 않는다)
  if (!isLunchTime(now) && teacher.status === 'lunch' && teacher.statusMessage === LUNCH_AUTO_MESSAGE) {
    const baseMsg = teacher.grade && teacher.classNo
      ? `${teacher.grade} ${teacher.classNo} 담임`
      : '온라인';
    return { status: 'online', statusMessage: baseMsg };
  }

  // 수업 시간 외이고 현재 '수업 중' 상태라면 '온라인'으로 복원
  if (teacher.status === 'in_class' && /수업 중/.test(teacher.statusMessage || '')) {
    const baseMsg = teacher.grade && teacher.classNo 
      ? `${teacher.grade} ${teacher.classNo} 담임`
      : '온라인';
    return {
      status: 'online',
      statusMessage: baseMsg,
    };
  }
  
  return null;
}

// 주간 시간표 그리드 생성 (UI용)
export function buildWeeklyGrid(cells: TimetableCell[], grade?: string, classNo?: string): (TimetableCell | null)[][] {
  const grid: (TimetableCell | null)[][] = Array.from({ length: 7 }, () => Array(5).fill(null)); // 7교시 x 5일
  
  const filtered = cells.filter((c) => {
    if (grade && c.grade !== grade) return false;
    if (classNo && c.classNo !== classNo) return false;
    return true;
  });
  
  for (const cell of filtered) {
    const periodIdx = cell.period - 1;
    const weekdayIdx = cell.weekday - 1;
    if (periodIdx >= 0 && periodIdx < 7 && weekdayIdx >= 0 && weekdayIdx < 5) {
      grid[periodIdx][weekdayIdx] = cell;
    }
  }
  
  return grid;
}

// 시간표 충돌 검사
export function checkTimetableConflict(
  cells: TimetableCell[],
  newCell: TimetableCell
): TimetableCell[] {
  return cells.filter(
    (c) =>
      c.weekday === newCell.weekday &&
      c.period === newCell.period &&
      c.grade === newCell.grade &&
      c.classNo === newCell.classNo
  );
}

// 교사별 주간 수업 시수 계산
export function calculateWeeklyHours(cells: TimetableCell[], teacherName: string): number {
  return cells.filter((c) => c.teacher === teacherName).length;
}

// 요일 한글명
export const WEEKDAY_NAMES: Record<Weekday, string> = {
  1: '월',
  2: '화',
  3: '수',
  4: '목',
  5: '금',
};

export function formatWeekday(day: Weekday): string {
  return WEEKDAY_NAMES[day];
}

// 교시 한글명
export function formatPeriod(period: number): string {
  return `${period}교시`;
}

// 시간표 셀 키 생성 (중복 체크용)
export function cellKey(cell: Pick<TimetableCell, 'weekday' | 'period' | 'grade' | 'classNo'>): string {
  return `${cell.weekday}-${cell.period}-${cell.grade}-${cell.classNo}`;
}

// 다음 주 같은 요일 날짜 계산
export function getDateForWeekday(weekday: Weekday, from: Date = new Date()): string {
  const diff = (weekday - from.getDay() + 7) % 7;
  const target = new Date(from);
  target.setDate(from.getDate() + (diff === 0 ? 7 : diff)); // 오늘이면 다음 주
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${target.getFullYear()}-${m}-${d}`;
}

// 시간표 CSV 파싱
export interface ParsedTimetableRow {
  weekday: Weekday;
  period: number;
  grade: string;
  classNo: string;
  subject: string;
  room: string;
  teacher: string;
}

export function parseTimetableCSV(csv: string): { rows: ParsedTimetableRow[]; errors: string[] } {
  const lines = csv.replace(/^\uFEFF/, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const rows: ParsedTimetableRow[] = [];
  const errors: string[] = [];
  
  const wdMap: Record<string, Weekday> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
  const startRow = lines[0].startsWith('요일') ? 1 : 0;
  
  for (let i = startRow; i < lines.length; i++) {
    const line = lines[i];
    const [wdS, perS, grade, classNo, subject, room, teacher] = line.split(',').map((x) => x?.trim() || '');
    
    const weekday = wdMap[wdS] ?? Number(wdS);
    const period = Number(perS);
    
    if (!(weekday >= 1 && weekday <= 5 && period >= 1 && period <= 7 && subject)) {
      errors.push(`${i + 1}행: 형식 오류 (${line})`);
      continue;
    }
    
    rows.push({
      weekday: weekday as Weekday,
      period,
      grade: grade || '1학년',
      classNo: classNo || '1반',
      subject,
      room: room || '본관',
      teacher: teacher || '',
    });
  }
  
  return { rows, errors };
}

// 시간표 CSV 내보내기
export function exportTimetableCSV(cells: TimetableCell[]): string {
  const header = '요일,교시,학년,반,과목,교실,교사\n';
  const wdNames = ['', '월', '화', '수', '목', '금'];
  const rows = cells
    .sort((a, b) => a.weekday - b.weekday || a.period - b.period)
    .map((c) => `${wdNames[c.weekday]},${c.period},${c.grade},${c.classNo},${c.subject},${c.room},${c.teacher}`)
    .join('\n');
  return header + rows;
}

// 시간표 병합 (기존 + 신규, 중복 시 신규 우선)
export function mergeTimetables(
  existing: TimetableCell[],
  incoming: TimetableCell[]
): TimetableCell[] {
  const existingMap = new Map(existing.map((c) => [cellKey(c), c]));
  
  for (const cell of incoming) {
    existingMap.set(cellKey(cell), cell);
  }
  
  return Array.from(existingMap.values());
}

// 오늘의 내 수업 목록
export function getTodaysClasses(
  teacher: Teacher,
  cells: TimetableCell[],
  now: Date = new Date()
): TimetableCell[] {
  const weekday = getCurrentWeekday(now);
  if (!weekday) return [];
  
  return cells
    .filter(
      (c) =>
        c.weekday === weekday &&
        ((teacher.grade && teacher.classNo && c.grade === teacher.grade && c.classNo === teacher.classNo) ||
          c.teacher === teacher.name)
    )
    .sort((a, b) => a.period - b.period);
}