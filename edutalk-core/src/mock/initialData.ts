// 브리즈(교사 전용 설치형) 기본값 — 실명 목데이터 없음.
// 첫 실행에 설정 마법사가 내 프로필·부서를 만들고, 이후엔 로컬 DB에만 저장된다.
export const ME_ID = "me";

export function nowIso(minusMin = 0): string {
  const d = new Date(Date.now() - minusMin * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export interface SchoolSetup {
  schoolId: string;
  schoolName: string;
}

// 부서 틀 (사람 이름 없음 — 사람은 마법사·초대에서 직접 등록)
export const DEFAULT_DEPTS: { id: string; name: string }[] = [
  { id: "d-gyomu", name: "교무기획부" },
  { id: "d-1", name: "1학년부" },
  { id: "d-2", name: "2학년부" },
  { id: "d-admin", name: "행정실" },
];

export const AVATAR_COLORS = [
  "#0082C8", "#7C5CFF", "#22B07D", "#F59E0B", "#EC4899",
  "#0EA5E9", "#8B5CF6", "#10B981", "#F43F5E", "#64748B",
];

// 교사 CSV 양식: 이름,부서,과목,직책 (첫 줄은 설명이라 건너뜀)
export const TEACHER_CSV_SAMPLE = `이름,부서,과목,직책
홍길동,2학년부,수학,담임
김교사,1학년부,국어,교사`;

// 시간표 CSV 양식: 요일,교시,학년,반,과목,교실,교사
export const TIMETABLE_CSV_SAMPLE = `요일,교시,학년,반,과목,교실,교사
월,1,2학년,1반,국어,본관 201,담임
월,2,2학년,1반,수학,본관 201,담임`;
