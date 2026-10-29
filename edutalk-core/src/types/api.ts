// Breeze API Types - 브리즈코어/브리즈서버 통신용 타입 정의
// 백엔드 API 응답 구조와 프론트엔드 상태를 분리하여 관리

import type {
  ApprovalRequest,
  ConsultationLog,
  ConsultSummary,
  WhiteboardBoard,
  WhiteboardData,
  WhiteboardMeta,
} from './index';

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  setupRequired?: boolean;
  licenseRequired?: boolean;
}

// 인증
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: ServerUser;
}

export interface ServerUser {
  id: number;
  username: string;
  real_name: string;
  department_id: number | null;
  status: string;
  status_message?: string;
  role: string;
  is_paid_dual_network?: boolean;
}

// 조직도
export interface ServerDeptNode {
  id: number;
  name: string;
  parent_id: number | null;
  order_index: number;
  children?: ServerDeptNode[];
}

export interface DeptTreeResponse {
  tree: ServerDeptNode[];
  unassigned: ServerUser[];
}

// 채팅방
export interface ServerRoom {
  id: string;
  name: string;
  network_type: 'INTERNAL' | 'EXTERNAL';
  member_ids: number[];
  created_by: number;
  created_at: string;
}

export interface MessageResponse {
  id: number;
  room_id: string;
  sender_id: number;
  content: string;
  is_notice: number;
  is_recalled: number;
  file_id?: number | null;
  file_name?: string | null;
  file_size?: number | null;
  created_at: string;
  sender_name?: string;
  poll_q?: string;
  poll_opts?: string[];
  poll_closed?: number;
  poll_counts?: number[];
  poll_mine?: number[];
}

// 파일
export interface FileResponse {
  id: number;
  original_name: string;
  stored_filename: string;
  file_size: number;
  expires_at: string;
  created_at: string;
}

// 할 일
export interface TodoResponse {
  id: number;
  room_id: string;
  text: string;
  done: number;
  created_by: number;
  done_by?: number | null;
  done_by_name?: string | null;
  created_at: string;
}

// 출석
export interface AttendanceSession {
  id: number;
  roomId: string;
  date: string;
  open: number;
  byUid: number;
  byName: string;
  present: number[];
}

// 공지
export interface NoticeResponse {
  id: string;
  title: string;
  body: string;
  level: 'urgent' | 'normal' | 'info';
  scope: 'all' | 'dept' | 'grade' | 'class';
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
  attachments: NoticeAttachment[];
}

export interface NoticeAttachment {
  id: string;
  name: string;
  size: number;
  url: string;
  type: string;
}

// 시간표
export interface TimetableCellResponse {
  weekday: number;
  period: number;
  grade: string;
  classNo: string;
  subject: string;
  room: string;
  teacher: string;
}

export interface TimetableTemplateResponse {
  id: string;
  name: string;
  schoolId: string;
  grade: string;
  classNo: string;
  cells: TimetableCellResponse[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isPublished: boolean;
  publishedAt?: string;
}

// 보강
export interface SwapResponse {
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
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

// 감사 로그
export interface AuditLogResponse {
  id: string;
  createdAt: string;
  kind: 'RRN' | 'PHONE' | 'SCORE' | 'CARD' | 'PASSWORD' | 'HWP';
  ruleId: string;
  text: string;
  score: number;
  blocked: boolean;
}

export interface AdminAuditLogResponse {
  id: string;
  createdAt: string;
  adminId: string;
  adminName: string;
  action: 'create' | 'update' | 'delete' | 'login' | 'logout' | 'export' | 'import' | 'permission_change' | 'notice_send' | 'timetable_publish' | 'user_manage';
  targetType: 'user' | 'notice' | 'timetable' | 'school' | 'dept' | 'memo' | 'chat' | 'settings';
  targetId: string;
  targetName: string;
  detail: string;
  blocked: boolean;
  ip?: string;
  userAgent?: string;
}

// 학교/설정
export interface SchoolResponse {
  id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  principalName: string;
  adminId: string;
  licenseKind: 'full' | 'chatOnly';
  licenseExpiresAt?: string;
  createdAt: string;
  settings: SchoolSettingsResponse;
}

export interface SchoolSettingsResponse {
  allowExternalNetwork: boolean;
  autoBackup: boolean;
  retentionDays: number;
  dlpEnabled: boolean;
  dlpRules: DlpRuleResponse[];
  notificationDefaultScope: 'all' | 'dept';
}

export interface DlpRuleResponse {
  id: string;
  name: string;
  pattern: string;
  action: 'block' | 'warn' | 'log';
  enabled: boolean;
}

// 관리자
export interface AdminUserResponse {
  id: string;
  name: string;
  email: string;
  role: 'teacher' | 'admin' | 'superadmin';
  schoolId: string;
  dept?: string;
  avatarColor: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface NetworkInfoResponse {
  serverIps: { iface: string; address: string }[];
  port: number;
  privateRanges: string[];
}

export interface PublicInfoResponse {
  dual: boolean;
  school: string;
  /** 서버가 발급/보관하는 학교 코드 — 교사 앱·학생 웹이 같은 서버를 가리키는지 확인 */
  schoolCode?: string;
  schoolName?: string;
  schoolConfigured?: boolean;
  version: string;
  now: string;
}

export interface SetupStateResponse {
  done: boolean;
  hasAdmin: boolean;
  license: string;
}

export interface LicenseResponse {
  mode: 'unlicensed' | 'trial' | 'licensed';
  message?: string;
  school?: string;
  isPaidDualNetworkActive?: boolean;
  expiryDays?: number;
}

// ============================================================
// 쪽지(노트) - onprem/routes/notes.js 계약 (5단계-2)
// ============================================================

export type NoteAudience = 'ALL' | 'DEPT' | 'GRADE' | 'USER';
export type NoteRecipientType = 'ALL' | 'DEPT' | 'GRADE' | 'USER' | 'CC' | 'BCC';

export interface SendNotePayload {
  title: string;
  content: string;
  /** 멱등 키: 7초 Undo 취소 후 재전송에도 중복 발송 방지 */
  clientNoteId?: string;
  audience?: Exclude<NoteAudience, 'USER'>;
  targetKey?: string;
  recipientIds?: number[];
  ccIds?: number[];
  bccIds?: number[];
}

export interface SendNoteData {
  ok: boolean;
  noteId: number;
  recipientCount: number;
  duplicate: boolean;
}

export interface NoteInboxItem {
  id: number;
  title: string;
  content: string;
  audience: NoteAudience;
  created_at: string;
  sender_id: number;
  sender_name: string;
  /** STUDENT 이면 학생 문의 쪽지 */
  sender_role?: string;
  sender_department: string | null;
  recipient_type: NoteRecipientType;
  is_read: number;
  read_at: string | null;
  /** 학생이 보낸 사진·파일 (30일 뒤 자동 삭제) */
  file_id?: number | null;
  file_name?: string | null;
  file_size?: number | null;
  file_expires_at?: string | null;
}

export interface NotesInboxData {
  ok: boolean;
  notes: NoteInboxItem[];
  total: number;
  unread: number;
  page: number;
  limit: number;
}

export interface NoteSentRecipient {
  id: number;
  name: string;
  department: string;
  type: NoteRecipientType;
  is_read: number;
  read_at: string | null;
}

export interface NoteSentItem {
  id: number;
  title: string;
  content: string;
  audience: NoteAudience;
  target_key: string;
  status: string;
  recipient_count: number;
  read_count: number;
  created_at: string;
  recipients?: NoteSentRecipient[];
  file_id?: number | null;
  file_name?: string | null;
  file_size?: number | null;
  file_expires_at?: string | null;
}

export interface NotesSentData {
  ok: boolean;
  notes: NoteSentItem[];
  total: number;
  page: number;
  limit: number;
}

export interface NoteReadData {
  ok: boolean;
  noteId: number;
  readAt: string;
}

// ============================================================
// AI 3줄 요약 - onprem/routes/summaries.js 계약 (로드맵 1-1)
//  · 서버가 공지당 1회만 AI를 호출하고 DB에 캐싱한다. 클라이언트엔 API 키가 없다.
// ============================================================
export interface AiSummaryData {
  ok: boolean;
  /** 캐시 키 (마스킹 본문 SHA-256 앞 32자리) */
  key: string;
  lines: string[];
  source: 'gemini' | 'local';
  /** DB 캐시에서 즉시 온 결과인지 (false면 이번에 생성) */
  cached: boolean;
  model?: string;
  privacy?: { masked: number; rrn?: number; phone?: number; card?: number } | null;
  createdAt?: string;
}

// ============================================================
// 보안 인쇄 대기열 (Killer ①) — onprem/routes/print.js 계약
//  · 문서는 바로 인쇄되지 않고 서버 대기열에 보관, 공용 PC에서 [출력] 승인 시에만 나간다.
// ============================================================
export interface PrintJobData {
  id: number;
  ownerId: string;
  ownerName: string;
  title: string;
  status: 'PENDING' | 'RELEASED' | 'CANCELLED';
  createdAt: string;
  releasedBy: string;
  releasedAt: string | null;
  /** 본문 크기(byte) — 목록에는 본문이 오지 않는다 */
  bytes: number;
  /** 승인(release) 응답에만 담기는 인쇄 본문 */
  content?: string;
}

export interface PrintJobsData {
  ok: boolean;
  pending: PrintJobData[];
  recent: PrintJobData[];
  maxBytes: number;
}

export interface PrintSubmitData {
  ok: boolean;
  job: PrintJobData;
}

// ============================================================
// 나이스 학사일정·급식 (Killer ③) — onprem/routes/neis.js 계약
// ============================================================
export interface NeisStatusData {
  ok: boolean;
  /** 키+교육청 코드+학교 코드가 모두 설정돼 바로 쓸 수 있는지 */
  ready: boolean;
  hasKey: boolean;
  officeCode: string;
  schoolCode: string;
  missing: string[];
}

export interface NeisMealItem {
  name: string;
  menu: string[];
  calories: string;
  origin: string;
  nutrition: string[];
}

export interface NeisMealData {
  ok: boolean;
  date: string;
  meals: NeisMealItem[];
  cached?: boolean;
}

export interface NeisEventItem {
  date: string;
  title: string;
  etc: string;
}

export interface NeisScheduleData {
  ok: boolean;
  from: string;
  to: string;
  events: NeisEventItem[];
  cached?: boolean;
}

// ============================================================
// 차세대 기능 API 계약 (2026-10)
// ============================================================
export interface ConsultSummaryData {
  ok: boolean;
  summary: ConsultSummary;
  source: 'gemini' | 'local';
  model?: string;
  privacy?: { masked: number; rrn?: number; phone?: number; card?: number } | null;
}

export interface ConsultationListData {
  ok: boolean;
  logs: ConsultationLog[];
  scope: 'mine' | 'all';
}

export interface ConsultationSaveData {
  ok: boolean;
  log: ConsultationLog;
}

export interface ApprovalListData {
  ok: boolean;
  approvals: ApprovalRequest[];
  scope: 'mine' | 'all';
}

export interface ApprovalData {
  ok: boolean;
  approval: ApprovalRequest;
}

export interface WhiteboardListData {
  ok: boolean;
  boards: WhiteboardMeta[];
}

export interface WhiteboardBoardData {
  ok: boolean;
  board: WhiteboardBoard;
}

export interface WhiteboardUpdateData {
  ok: boolean;
  board: WhiteboardBoard;
  conflict?: boolean;
}

export interface WhiteboardUpdatedEvent {
  boardId: string;
  data: WhiteboardData;
  version: number;
  updatedByName: string;
  updatedAt: string;
  source: 'socket' | 'rest';
}

export interface WhiteboardPresenceEvent {
  boardId: string;
  count: number;
  name: string;
  at: string;
}

export interface ApprovalEvent {
  id: number;
  title?: string;
  requesterName?: string;
  amount?: number;
  status?: string;
  approverName?: string;
  decidedAt?: string;
  createdAt?: string;
}

// 소켓 이벤트 타입
export interface SocketEvents {
  // 연결
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (error: Error) => void;

  // 방
  'room:join': (roomId: string) => void;
  'room:leave': (roomId: string) => void;

  // 사용자 상태
  'user:change_status': (payload: { status: string; statusMessage?: string }) => void;
  'user:status_updated': (payload: { userId: string; status: string; statusMessage: string; at: string }) => void;

  // 메시지
  'message:send': (payload: { roomId: string; content?: string; fileId?: number; isNotice?: boolean; poll?: { q: string; opts: string[] } }) => void;
  'message:new': (message: MessageResponse) => void;
  'message:read': (payload: { messageId: number }) => void;
  'message:read_updated': (payload: { messageId: number; userId: number; readAt: string; readCount: number }) => void;
  'message:recall': (payload: { messageId: number }) => void;
  'message:recalled': (payload: { messageId: number; content: string }) => void;

  // 투표
  'poll:vote': (payload: { messageId: number; choices: number[] }) => void;
  'poll:votes_updated': (payload: { messageId: number; counts: number[]; total: number }) => void;
  'poll:close': (payload: { messageId: number }) => void;
  'poll:closed': (payload: { messageId: number }) => void;

  // 원격 지원
  'remote-view-arrived': (payload: { event: 'request' | 'accept' | 'decline' | 'frame' | 'bye'; ref_id: string; from: string; from_name: string; image_b64?: string }) => void;
  remote_view_request: (payload: { node_id: string }) => void;
  remote_view_respond: (payload: { node_id: string; request_id: string; accept: boolean }) => void;
  remote_view_frame: (payload: { node_id: string; request_id: string; image_b64: string }) => void;
  remote_view_bye: (payload: { node_id: string; request_id: string }) => void;

  // 쪽지/대화/댓글 (P2P)
  'memo-arrived': (payload: { id: string; title: string; body: string; from: string; from_name: string; from_role?: string }) => void;
  'chat-arrived': (payload: { kind: 'quick' | 'comment'; id: string; ref_id?: string; body: string; from: string; from_name: string }) => void;
  'peer-read': (payload: { ref_id: string; from: string }) => void;
  'nudge-arrived': (payload: { ref_id: string; from_name: string }) => void;
  'substitute-arrived': (payload: { ref_id?: string; from?: string; from_name?: string; title?: string; body?: string }) => void;
  'substitute-accepted': (payload: { ref_id?: string; from_name?: string }) => void;
  'substitute-rejected': (payload: { ref_id?: string; from_name?: string }) => void;

  // 차세대 기능 — 전자결재 실시간 알림
  'approval:new': (payload: ApprovalEvent) => void;
  'approval:decided': (payload: ApprovalEvent) => void;
  'approval:changed': (payload: ApprovalEvent) => void;

  // 차세대 기능 — 협업 보드 실시간 동기화
  'whiteboard:join': (payload: { boardId: string }) => void;
  'whiteboard:leave': (payload: { boardId: string }) => void;
  'whiteboard:update': (payload: { boardId: string; data: WhiteboardData; expectedVersion: number }) => void;
  'whiteboard:updated': (payload: WhiteboardUpdatedEvent) => void;
  'whiteboard:presence': (payload: WhiteboardPresenceEvent) => void;
  'whiteboard:deleted': (payload: { boardId: string }) => void;
}

export type SocketEventName = keyof SocketEvents;
export type SocketEventPayload<K extends SocketEventName> = Parameters<SocketEvents[K]>[0];