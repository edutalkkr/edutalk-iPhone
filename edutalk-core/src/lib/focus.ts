// Focus Mode (집중/휴식 모드)
//  · 설정에서 켜 두면 평일 18:00 ~ 다음날 08:00, 주말(토·일) 종일 자동으로 켜진다.
//  · 켜져 있는 동안: 내 상태가 "자리 비움(away)"으로 보이고 메시지가 "퇴근 후 업무 휴식 중"으로 표시된다.
//  · 긴급 공지(사이렌)는 Focus Mode에서도 항상 표시된다 (학교 안전 규칙).

export const FOCUS_MESSAGE = "퇴근 후 업무 휴식 중";
export const FOCUS_FROM_HOUR = 18; // 저녁 6시
export const FOCUS_TO_HOUR = 8; // 아침 8시

/** 지금이 Focus Mode 시간대인가? (주말은 종일) */
export function isFocusTime(d: Date = new Date()): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return true; // 토·일 종일
  const hm = d.getHours() * 60 + d.getMinutes();
  return hm >= FOCUS_FROM_HOUR * 60 || hm < FOCUS_TO_HOUR * 60;
}

/** 표시용 시간대 문구 */
export function focusWindowText(): string {
  return `평일 ${String(FOCUS_FROM_HOUR).padStart(2, "0")}:00 ~ 다음날 ${String(FOCUS_TO_HOUR).padStart(2, "0")}:00, 주말 종일`;
}

/** 다음에 Focus Mode가 끝나는 시각 (안내 문구용) */
export function focusUntilText(d: Date = new Date()): string {
  const hh = String(FOCUS_TO_HOUR).padStart(2, "0");
  const endHH = hh + ":00";
  if (d.getDay() === 6) return "월요일 " + endHH;
  if (d.getDay() === 0) return "월요일 " + endHH;
  if (d.getHours() >= FOCUS_FROM_HOUR) return "내일 " + endHH;
  if (d.getHours() < FOCUS_TO_HOUR) return "오늘 " + endHH;
  return "";
}
