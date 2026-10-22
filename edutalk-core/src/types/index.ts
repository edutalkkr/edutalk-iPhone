// 브리즈 데스크톱(교사 전용) 데이터 모델
// 브랜드 토큰: 스카이 블루 #0082C8 / #0069A8 / #E8F4FB / 시스템 기본 글꼴
//
// 2026-10-18 정합화: 레거시 소비처(App/views/lib)가 쓰는 기존 타입을 보존하면서,
// 관리자 패널 뷰가 필요로 하는 확장 타입(AdminUser/AdminNotice/AdminAuditLog 등)을 추가했다.

export type NetworkState = "intranet" | "external" | "hybrid";

// 상태 8종 (2026-10 개편 — 기존 학교 메신저를 대체하는 확장 상태)
//  online 온라인/업무 가능 · busy 업무 집중 중 · away 자리 비움 · in_class 수업 진행 중
//  out_of_office 외근/출장 · lunch 점심 시간 · meeting 회의 참석 중 · on_call 통화 중
//  (구형 teaching/offwork/dnd 값은 lib/status.ts normalizeStatus()가 흡수)
export type TeacherStatus =
  | "online"
  | "busy"
  | "away"
  | "in_class"
  | "out_of_office"
  | "lunch"
  | "meeting"
  | "on_call";

export type UserRole = "teacher" | "admin" | "superadmin";

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
  role?: UserRole;
  /** 차량 4자리 (이중주차 알림 — Killer ②) · 없으면 차량 검색에서 제외 */
  carNumber?: string;
}

export interface DeptGroup {
  id: string;
  name: string;
  members: string[];
  parentId?: string | null;
  order?: number;
  children?: DeptGroup[];
}

export interface MemoRecipient {
  uid: string;
  name: string;
  readAt: string | null;
  nudgedAt: string | null;
  /** 참조(CC) 수신자 — 수신확인표에서 "참조"로 표기 */
  cc?: boolean;
  /** 숨은참조(BCC) — 보낸 사람과 본인에게만 보인다 */
  bcc?: boolean;
}

export interface MemoComment {
  id: string;
  memoId: string;
  fromUid: string;
  fromName: string;
  body: string;
  createdAt: string;
}

// 파일 첨부 (쪽지·공지·설문 공용) — 바이너리는 IndexedDB(breeze-files)에 저장.
export interface MemoAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** IndexedDB 저장 키 */
  storeId?: string;
  /** 작은 이미지·화면 캡처용 데이터 URL (미리보기) */
  dataUrl?: string;
}

export interface Memo {
  id: string;
  title: string;
  body: string;
  /** 리치 텍스트(서식) 본문 — 없으면 body(평문)만 사용 */
  bodyHtml?: string;
  fromUid: string;
  fromName: string;
  to: MemoRecipient[];
  importance: "normal" | "urgent" | "ref";
  hwpName: string;
  hwpSize: number;
  attachments?: MemoAttachment[];
  createdAt: string;
  reservedAt?: string | null;
  /** 예약 발송이 실제로 나간 시각 */
  sentAt?: string | null;
  /** 중요(별표) 표시 */
  starred?: boolean;
  /** 회수 시각 (읽기 전에만 회수 가능) */
  recalledAt?: string | null;
  /** 나에게 보내기(자가 보관) */
  toSelf?: boolean;
  /** 회신 대상 메모 */
  inReplyTo?: string | null;
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
  id?: string;
  teacherId?: string;
  teacherName?: string;
  isPublished?: boolean;
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
  level: "urgent" | "normal" | "info";
  scope: "all" | "dept" | "grade" | "class";
  dept: string;
  fromName: string;
  createdAt: string;
  popup: boolean;
  targetGrade?: string;
  targetClass?: string;
  /** 게시 기간 */
  startAt?: string | null;
  expiresAt?: string | null;
  /** 타겟팅 — 전체/부서/직급/개별 선택 */
  targetKind?: "all" | "dept" | "position" | "selected";
  targets?: string[];
  attachments?: MemoAttachment[];
  updatedAt?: string;
}

// ============================================================
// 설문조사 (Survey)
// ============================================================

export interface SurveyQuestion {
  id: string;
  title: string;
  kind: "single" | "multi" | "text";
  options: { id: string; label: string }[];
}

export interface SurveyResponse {
  id: string;
  surveyId: string;
  respondentUid: string;
  respondentName: string;
  createdAt: string;
  /** questionId → 선택한 optionId 목록 (주관식은 텍스트 1건) */
  answers: Record<string, string[]>;
}

export interface SurveyItem {
  id: string;
  title: string;
  description: string;
  /** 공개(대상자 전원 열람·응답) / 미공개(작성자만 결과 포함 열람) */
  visibility: "public" | "private";
  targetKind: "all" | "dept" | "selected";
  /** 부서명 목록 또는 교사 uid 목록 */
  targets: string[];
  questions: SurveyQuestion[];
  attachments: MemoAttachment[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  closesAt?: string | null;
  nudgeCount: number;
  lastNudgedAt?: string | null;
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
  | "login"
  | "org"
  | "memo"
  | "student-inbox"
  | "chat"
  | "timetable"
  | "work"
  | "consult"
  | "approval"
  | "whiteboard"
  | "cloud"
  | "print"
  | "survey"
  | "audit"
  | "settings"
  | "admin-dashboard"
  | "admin-users"
  | "admin-notices"
  | "admin-timetable"
  | "admin-audit"
  | "admin-settings"
  | "admin-school";

/* ============================================================
 * 차세대 기능 (2026-10) — 상담 일지 · 간이 전자결재 · 협업 보드
 * ============================================================ */

export interface ConsultSummary {
  concerns: string[];
  observations: string[];
  actions: string[];
}

export interface ConsultationLog {
  id: number;
  authorId: number;
  authorName: string;
  studentName: string;
  contactType: "student" | "parent" | "guardian" | "other";
  topic: string;
  rawText: string;
  summary: ConsultSummary;
  source: "gemini" | "local" | "error";
  maskedCount: number;
  createdAt: string;
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type ApprovalCategory = "supplies" | "meeting" | "after_school" | "event" | "general";

export interface ApprovalRequest {
  id: number;
  requesterId: number;
  requesterName: string;
  title: string;
  category: ApprovalCategory;
  amount: number;
  content: string;
  status: ApprovalStatus;
  approverId: number | null;
  approverName: string;
  signature: string;
  signatureHash: string;
  decisionNote: string;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
  isMine: boolean;
  canDecide: boolean;
}

export type WhiteboardKind = "seating" | "groups" | "supervision" | "free";
export type WhiteboardItemType = "seat" | "group" | "label" | "table";

export interface WhiteboardItem {
  id: string;
  type: WhiteboardItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sublabel: string;
  color: string;
}

export interface WhiteboardData {
  background: "grid" | "plain";
  items: WhiteboardItem[];
}

export interface WhiteboardMeta {
  id: string;
  title: string;
  kind: WhiteboardKind;
  version: number;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhiteboardBoard extends WhiteboardMeta {
  data: WhiteboardData;
}

export interface ToastMsg {
  id: number;
  text: string;
  /** 사라지는 중(위로 올라가는 퇴장 모션) — 잠깐 남겨 두었다가 지운다 */
  leaving?: boolean;
}

// ============================================================
// 관리자 패널 확장 타입 (Admin* 뷰 + 설정 마법사)
// ============================================================

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  schoolId?: string;
  dept?: string;
  department?: string;
  avatarColor: string;
  createdAt: string;
  lastLoginAt?: string;
  status?: TeacherStatus;
}

export interface AdminNotice {
  id: string;
  title: string;
  body: string;
  level: "urgent" | "normal" | "info";
  scope: "all" | "dept" | "department" | "grade" | "class";
  targetDept?: string;
  targetGrade?: string;
  targetClass?: string;
  fromAdminId: string;
  fromAdminName: string;
  createdAt: string;
  publishedAt?: string;
  expiresAt?: string;
  readCount: number;
  totalCount: number;
  attachments: { id: string; name: string; size: number; url: string; type: string }[];
}

export interface AdminAuditLog {
  id: string;
  createdAt: string;
  adminId: string;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  detail: string;
  blocked: boolean;
  ip?: string;
  userAgent?: string;
}

export interface DlpRule {
  id: string;
  name: string;
  pattern: string;
  action: "block" | "warn" | "log";
  enabled: boolean;
  createdAt?: string;
}

export interface SchoolSettings {
  allowExternalNetwork: boolean;
  autoBackup: boolean;
  retentionDays: number;
  dlpEnabled: boolean;
  dlpRules: DlpRule[];
  notificationDefaultScope: "all" | "department" | "dept" | "grade";
  backupIntervalHours?: number;
  autoStatusEnabled?: boolean;
  statusSyncIntervalMinutes?: number;
}

export interface School {
  id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  principalName: string;
  adminId: string;
  licenseKind: LicenseKind;
  licenseExpiresAt?: string;
  createdAt: string;
  settings: SchoolSettings;
}

export interface GradeClass {
  grade: string;
  classNo: string;
  homeroomTeacherId?: string;
  homeroomTeacherName?: string;
  studentCount: number;
}

export interface TimetableTemplate {
  id: string;
  name: string;
  schoolId?: string;
  grade: string;
  classNo: string;
  cells: TimetableCell[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  isPublished?: boolean;
  publishedAt?: string;
  version?: number;
}
