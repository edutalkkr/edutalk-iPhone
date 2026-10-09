// 브리즈 데스크톱(교사 전용) 데이터 모델
// 브랜드 토큰: 스카이 블루 #0082C8 / #0069A8 / #E8F4FB / Pretendard

export type NetworkState = "intranet" | "external";

export type TeacherStatus =
  | "online"
  | "teaching"
  | "away"
  | "offwork"
  | "dnd";

export interface Teacher {
  id: string;
  name: string;
  dept: string;
  subject: string;
  position: string;
  grade?: string;
  classNo?: string;
  avatarColor: string;
  status: TeacherStatus;
  statusMessage: string;
  ip: string;
  subCount: number;
  phone: string;
}

export interface DeptGroup {
  id: string;
  name: string;
  members: string[];
}

export interface MemoRecipient {
  uid: string;
  name: string;
  readAt: string | null;
  nudgedAt: string | null;
}

export interface MemoComment {
  id: string;
  memoId: string;
  fromUid: string;
  fromName: string;
  body: string;
  createdAt: string;
}

export interface Memo {
  id: string;
  title: string;
  body: string;
  fromUid: string;
  fromName: string;
  to: MemoRecipient[];
  importance: "normal" | "urgent" | "ref";
  hwpName: string;
  hwpSize: number;
  createdAt: string;
  reservedAt?: string | null;
}

export interface ChatMessage {
  id: string;
  peerId: string;
  mine: boolean;
  body: string;
  createdAt: string;
  read: boolean;
  emoji: string[];
  // 낙관적 UI: 저장(전송) 완료 전 임시 말풍선 표시 (🕒 → 시각)
  pending?: boolean;
}

export interface TimetableCell {
  weekday: number;
  period: number;
  grade: string;
  classNo: string;
  subject: string;
  room: string;
  teacher: string;
}

export interface SwapRecord {
  id: string;
  rustId?: string | null;
  date: string;
  weekday: number;
  period: number;
  fromTeacher: string;
  fromUid?: string | null;
  fromClass: string;
  toTeacher: string;
  toUid?: string | null;
  toClass: string;
  grade?: string;
  classNo?: string;
  subject: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

export interface NoticeItem {
  id: string;
  title: string;
  body: string;
  level: "urgent" | "normal";
  scope: "all" | "dept";
  dept: string;
  fromName: string;
  createdAt: string;
  popup: boolean;
}

export interface AuditLog {
  id: string;
  createdAt: string;
  kind: "RRN" | "PHONE" | "SCORE" | "CARD" | "PASSWORD" | "HWP";
  ruleId: string;
  text: string;
  score: number;
  blocked: boolean;
}

export type LicenseKind = "full" | "chatOnly";

export type ActiveView =
  | "org"
  | "memo"
  | "chat"
  | "timetable"
  | "work"
  | "audit"
  | "settings";

export interface ToastMsg {
  id: number;
  text: string;
}
