// Breeze API Client - 브리즈코어/브리즈서버 REST API 통신
// 온프레미스 서버(http://localhost:4000) 및 클라우드 API와 통신

import type {
  ApiResponse,
  LoginRequest,
  LoginResponse,
  ServerUser,
  ServerDeptNode,
  DeptTreeResponse,
  ServerRoom,
  MessageResponse,
  FileResponse,
  TodoResponse,
  AttendanceSession,
  NoticeResponse,
  TimetableCellResponse,
  TimetableTemplateResponse,
  SwapResponse,
  AuditLogResponse,
  AdminAuditLogResponse,
  SchoolResponse,
  SchoolSettingsResponse,
  AdminUserResponse,
  NetworkInfoResponse,
  PublicInfoResponse,
  SetupStateResponse,
  LicenseResponse,
  SendNoteData,
  SendNotePayload,
  NotesInboxData,
  NotesSentData,
  NoteReadData,
  AiSummaryData,
  PrintJobsData,
  PrintSubmitData,
  NeisStatusData,
  NeisMealData,
  NeisScheduleData,
  ConsultSummaryData,
  ConsultationListData,
  ConsultationSaveData,
  ApprovalListData,
  ApprovalData,
  WhiteboardListData,
  WhiteboardBoardData,
  WhiteboardUpdateData,
} from '../types/api';
import type {
  ApprovalCategory,
  ApprovalStatus,
  ConsultSummary,
  WhiteboardData,
  WhiteboardKind,
} from '../types';

// API 기본 설정 (onprem 서버 기본 포트 3000)
const DEFAULT_API_BASE = 'http://localhost:3000';
const DEFAULT_TIMEOUT = 10000;

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private adminToken: string | null = null;
  private timeout: number;

  constructor(baseUrl?: string, timeout?: number) {
    this.baseUrl = baseUrl || DEFAULT_API_BASE;
    this.timeout = timeout || DEFAULT_TIMEOUT;
    // 저장된 토큰 복원
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('breeze_auth_token');
      this.adminToken = localStorage.getItem('breeze_admin_token');
    }
  }

  setBaseUrl(url: string) {
    this.baseUrl = String(url || '').replace(/\/+$/, '') || DEFAULT_API_BASE;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setAuthToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) localStorage.setItem('breeze_auth_token', token);
      else localStorage.removeItem('breeze_auth_token');
    }
  }

  setAdminToken(token: string | null) {
    this.adminToken = token;
    if (typeof window !== 'undefined') {
      if (token) localStorage.setItem('breeze_admin_token', token);
      else localStorage.removeItem('breeze_admin_token');
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { isAdmin?: boolean; skipAuth?: boolean; timeoutMs?: number }
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (!options?.skipAuth) {
      const token = options?.isAdmin ? this.adminToken : this.token;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    if (options?.isAdmin && this.adminToken) {
      headers['x-admin-token'] = this.adminToken;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          ok: false,
          error: data.error || `HTTP ${response.status}: ${response.statusText}`,
          setupRequired: data.setupRequired,
          licenseRequired: data.licenseRequired,
        };
      }

      return { ok: true, data: data as T };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, error: '요청 시간 초과' };
      }
      return { ok: false, error: error instanceof Error ? error.message : '네트워크 오류' };
    }
  }

  // === 인증 ===
  async login(username: string, password: string): Promise<ApiResponse<LoginResponse>> {
    const result = await this.request<LoginResponse>('POST', '/api/login', { username, password }, { skipAuth: true });
    if (result.ok && result.data?.token) {
      this.setAuthToken(result.data.token);
    }
    return result;
  }

  async logout(): Promise<ApiResponse<void>> {
    const result = await this.request<void>('POST', '/api/logout');
    if (result.ok) this.setAuthToken(null);
    return result;
  }

  async getMe(): Promise<ApiResponse<{ user: ServerUser }>> {
    return this.request<{ user: ServerUser }>('GET', '/api/me');
  }

  async getNetworkInfo(): Promise<ApiResponse<NetworkInfoResponse>> {
    return this.request<NetworkInfoResponse>('GET', '/api/network-info', undefined, { skipAuth: true });
  }

  async getPublicInfo(): Promise<ApiResponse<PublicInfoResponse>> {
    return this.request<PublicInfoResponse>('GET', '/api/public-info', undefined, { skipAuth: true });
  }

  // === 조직도 ===
  async getDeptTree(): Promise<ApiResponse<DeptTreeResponse>> {
    return this.request<DeptTreeResponse>('GET', '/api/departments/tree');
  }

  async getUsers(): Promise<ApiResponse<ServerUser[]>> {
    return this.request<ServerUser[]>('GET', '/api/users');
  }

  // === 채팅방 ===
  async getRooms(): Promise<ApiResponse<ServerRoom[]>> {
    return this.request<ServerRoom[]>('GET', '/api/rooms');
  }

  async createRoom(name: string, memberIds: number[]): Promise<ApiResponse<{ id: string; name: string; network_type: string }>> {
    return this.request('POST', '/api/rooms', { name, member_ids: memberIds });
  }

  async getRoom(roomId: string): Promise<ApiResponse<ServerRoom>> {
    return this.request<ServerRoom>('GET', `/api/rooms/${roomId}`);
  }

  async getRoomMessages(roomId: string, limit = 100, before?: number): Promise<ApiResponse<MessageResponse[]>> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', String(before));
    return this.request<MessageResponse[]>(`GET`, `/api/rooms/${roomId}/messages?${params}`);
  }

  async getRoomFiles(roomId: string): Promise<ApiResponse<FileResponse[]>> {
    return this.request<FileResponse[]>('GET', `/api/rooms/${roomId}/files`);
  }

  async searchRoomMessages(roomId: string, query: string): Promise<ApiResponse<MessageResponse[]>> {
    return this.request<MessageResponse[]>('GET', `/api/rooms/${roomId}/search?q=${encodeURIComponent(query)}`);
  }

  // === 쪽지 (onprem/routes/notes.js) ===
  async sendNote(payload: SendNotePayload): Promise<ApiResponse<SendNoteData>> {
    return this.request<SendNoteData>('POST', '/api/notes/send', payload);
  }

  async getNotesInbox(page = 1, unreadOnly = false, limit = 30): Promise<ApiResponse<NotesInboxData>> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (unreadOnly) params.set('unreadOnly', '1');
    return this.request<NotesInboxData>('GET', `/api/notes/inbox?${params.toString()}`);
  }

  async getNotesSent(page = 1, limit = 30): Promise<ApiResponse<NotesSentData>> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return this.request<NotesSentData>('GET', `/api/notes/sent?${params.toString()}`);
  }

  async markNoteRead(noteId: number): Promise<ApiResponse<NoteReadData>> {
    return this.request<NoteReadData>('PATCH', `/api/notes/${noteId}/read`);
  }

  /** 내 비밀번호 변경 (현재 세션은 유지, 다른 기기 세션은 서버에서 폐기) */
  async changeMyPassword(currentPassword: string, newPassword: string): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('POST', '/api/me/password', { currentPassword, newPassword });
  }

  // === AI 3줄 요약 (onprem/routes/summaries.js — 서버 캐시 + 개인정보 마스킹) ===
  //  · 같은 공지는 서버 DB 캐시에서 즉시 온다(cached=true). 키가 없으면 로컬 요약으로 대체.
  //  · 요약이 늦어도 화면이 멈추지 않도록 짧은 타임아웃(기본 7초)을 쓴다.
  async summarizeAi(text: string, opts?: { force?: boolean; timeoutMs?: number }): Promise<ApiResponse<AiSummaryData>> {
    return this.request<AiSummaryData>(
      'POST',
      '/api/ai/summaries',
      { text, force: opts?.force === true },
      { timeoutMs: opts?.timeoutMs ?? 7000 }
    );
  }

  // === 보안 인쇄 대기열 (Killer ①) — onprem/routes/print.js ===
  //  · 제출해도 바로 인쇄되지 않는다. 공용 PC(인쇄실)에서 [출력] 승인 시에만 내용이 내려간다.
  async listPrintJobs(): Promise<ApiResponse<PrintJobsData>> {
    return this.request<PrintJobsData>('GET', '/api/print/jobs', undefined, { timeoutMs: 8000 });
  }
  async submitPrintJob(title: string, content: string): Promise<ApiResponse<PrintSubmitData>> {
    return this.request<PrintSubmitData>('POST', '/api/print/jobs', { title, content }, { timeoutMs: 10000 });
  }
  async releasePrintJob(id: number): Promise<ApiResponse<PrintSubmitData>> {
    return this.request<PrintSubmitData>('POST', `/api/print/jobs/${id}/release`, {}, { timeoutMs: 10000 });
  }
  async cancelPrintJob(id: number): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('DELETE', `/api/print/jobs/${id}`, undefined, { timeoutMs: 8000 });
  }

  // === 나이스 학사일정·급식 (Killer ③) — 키는 서버에만 있다 ===
  async getNeisStatus(): Promise<ApiResponse<NeisStatusData>> {
    return this.request<NeisStatusData>('GET', '/api/neis/status', undefined, { timeoutMs: 5000 });
  }
  async getNeisMeal(date: string): Promise<ApiResponse<NeisMealData>> {
    return this.request<NeisMealData>('GET', `/api/neis/meal?date=${encodeURIComponent(date)}`, undefined, { timeoutMs: 8000 });
  }
  async getNeisSchedule(from: string, to: string): Promise<ApiResponse<NeisScheduleData>> {
    return this.request<NeisScheduleData>(
      'GET',
      `/api/neis/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      undefined,
      { timeoutMs: 8000 }
    );
  }

  // === 할 일 ===
  async getTodos(roomId: string): Promise<ApiResponse<TodoResponse[]>> {
    return this.request<TodoResponse[]>('GET', `/api/rooms/${roomId}/todos`);
  }

  async createTodo(roomId: string, text: string): Promise<ApiResponse<{ id: number }>> {
    return this.request('POST', `/api/rooms/${roomId}/todos`, { text });
  }

  async toggleTodo(todoId: number): Promise<ApiResponse<{ done: boolean }>> {
    return this.request('POST', `/api/todos/${todoId}/toggle`);
  }

  async deleteTodo(todoId: number): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/api/todos/${todoId}`);
  }

  // === 출석 ===
  async getTodayAttendance(roomId: string): Promise<ApiResponse<{ session: AttendanceSession | null }>> {
    return this.request('GET', `/api/rooms/${roomId}/attendance/today`);
  }

  async startAttendance(roomId: string): Promise<ApiResponse<{ existed: boolean }>> {
    return this.request('POST', `/api/rooms/${roomId}/attendance/start`);
  }

  async markAttendance(roomId: string): Promise<ApiResponse<void>> {
    return this.request('POST', `/api/rooms/${roomId}/attendance/mark`);
  }

  async closeAttendance(roomId: string): Promise<ApiResponse<void>> {
    return this.request('POST', `/api/rooms/${roomId}/attendance/close`);
  }

  // === 멤버 관리 ===
  async addRoomMembers(roomId: string, userIds: number[]): Promise<ApiResponse<{ count: number }>> {
    return this.request('POST', `/api/rooms/${roomId}/members`, { user_ids: userIds });
  }

  async leaveRoom(roomId: string): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/api/rooms/${roomId}/members/me`);
  }

  async deleteRoom(roomId: string): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/api/rooms/${roomId}`);
  }

  // === 파일 업로드 ===
  async uploadFile(file: File, onProgress?: (progress: number) => void): Promise<ApiResponse<{ fileId: number; stored_filename: string; expires_at: string }>> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${this.baseUrl}/api/upload`;
    const headers: HeadersInit = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, data });
          else resolve({ ok: false, error: data.error || '업로드 실패' });
        } catch {
          resolve({ ok: false, error: '응답 파싱 실패' });
        }
      };
      xhr.onerror = () => resolve({ ok: false, error: '네트워크 오류' });
      xhr.ontimeout = () => resolve({ ok: false, error: '업로드 시간 초과' });
      xhr.timeout = this.timeout;
      xhr.send(formData);
    });
  }

  async downloadFile(fileId: number): Promise<Blob> {
    const url = `${this.baseUrl}/api/files/${fileId}`;
    const headers: HeadersInit = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('다운로드 실패');
    return response.blob();
  }

  // === 초기 설정 ===
  async getSetupState(): Promise<ApiResponse<SetupStateResponse>> {
    return this.request<SetupStateResponse>('GET', '/api/setup-state', undefined, { skipAuth: true });
  }

  async setupAdmin(username: string, realName: string, password: string): Promise<ApiResponse<void>> {
    return this.request('POST', '/api/admin/setup/admin', { username, real_name: realName, password }, { skipAuth: true });
  }

  async setupLicense(key?: string, trial = false): Promise<ApiResponse<LicenseResponse>> {
    return this.request('POST', '/api/admin/setup/license', { key, trial }, { skipAuth: true });
  }

  // === 관리자 ===
  async getAdminStatus(): Promise<ApiResponse<{ license: LicenseResponse; hwid: string; ips: NetworkInfoResponse['serverIps']; port: number; counts: Record<string, number>; now: string }>> {
    return this.request('GET', '/api/admin/status', undefined, { isAdmin: true });
  }

  async getAdminSecret(): Promise<ApiResponse<{ secret: string }>> {
    return this.request('GET', '/api/admin/secret', undefined, { isAdmin: true });
  }

  async updateLicense(key: string): Promise<ApiResponse<LicenseResponse>> {
    return this.request('POST', '/api/admin/license', { key }, { isAdmin: true });
  }

  async importUsers(file: File): Promise<ApiResponse<{ created: number; updated: number; departmentsCreated: number; errors: string[] }>> {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${this.baseUrl}/api/admin/users/import`;
    const headers: HeadersInit = { 'x-admin-token': this.adminToken || '' };

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, data });
          else resolve({ ok: false, error: data.error || '가져오기 실패' });
        } catch {
          resolve({ ok: false, error: '응답 파싱 실패' });
        }
      };
      xhr.onerror = () => resolve({ ok: false, error: '네트워크 오류' });
      xhr.send(formData);
    });
  }

  async getAdminUsers(): Promise<ApiResponse<AdminUserResponse[]>> {
    return this.request<AdminUserResponse[]>('GET', '/api/admin/users', undefined, { isAdmin: true });
  }

  async createDepartment(name: string, parentId?: number): Promise<ApiResponse<{ id: number }>> {
    return this.request('POST', '/api/admin/departments', { name, parent_id: parentId }, { isAdmin: true });
  }

  async getNotices(): Promise<ApiResponse<NoticeResponse[]>> {
    return this.request<NoticeResponse[]>('GET', '/api/admin/notices');
  }

  async createNotice(notice: Partial<NoticeResponse>): Promise<ApiResponse<NoticeResponse>> {
    return this.request('POST', '/api/admin/notices', notice, { isAdmin: true });
  }

  async getAuditLogs(): Promise<ApiResponse<AdminAuditLogResponse[]>> {
    return this.request<AdminAuditLogResponse[]>('GET', '/api/admin/audit', undefined, { isAdmin: true });
  }

  // === AI 상담 일지 (onprem/routes/consultations.js) ===
  async summarizeConsultation(text: string, opts?: { timeoutMs?: number }): Promise<ApiResponse<ConsultSummaryData>> {
    return this.request<ConsultSummaryData>(
      'POST',
      '/api/consultations/summarize',
      { text },
      { timeoutMs: opts?.timeoutMs ?? 9000 }
    );
  }

  async getConsultations(scope: 'mine' | 'all' = 'mine'): Promise<ApiResponse<ConsultationListData>> {
    return this.request<ConsultationListData>('GET', `/api/consultations?scope=${scope}`);
  }

  async saveConsultation(payload: {
    studentName: string;
    contactType: 'student' | 'parent' | 'guardian' | 'other';
    topic: string;
    rawText: string;
    summary: ConsultSummary;
    source: 'gemini' | 'local' | 'error';
    maskedCount: number;
  }): Promise<ApiResponse<ConsultationSaveData>> {
    return this.request<ConsultationSaveData>('POST', '/api/consultations', payload);
  }

  async updateConsultation(id: number, payload: {
    studentName?: string;
    contactType?: 'student' | 'parent' | 'guardian' | 'other';
    topic?: string;
    rawText?: string;
    summary?: ConsultSummary;
    source?: 'gemini' | 'local' | 'error';
  }): Promise<ApiResponse<ConsultationSaveData>> {
    return this.request<ConsultationSaveData>('PUT', `/api/consultations/${id}`, payload);
  }

  async deleteConsultation(id: number): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('DELETE', `/api/consultations/${id}`);
  }

  // === 간이 전자결재 (onprem/routes/approvals.js) ===
  async getApprovals(scope: 'mine' | 'all' = 'mine', status?: ApprovalStatus): Promise<ApiResponse<ApprovalListData>> {
    const params = new URLSearchParams({ scope });
    if (status) params.set('status', status);
    return this.request<ApprovalListData>('GET', `/api/approvals?${params.toString()}`);
  }

  async createApproval(payload: {
    title: string;
    category: ApprovalCategory;
    amount: number;
    content: string;
  }): Promise<ApiResponse<ApprovalData>> {
    return this.request<ApprovalData>('POST', '/api/approvals', payload);
  }

  async decideApproval(
    id: number,
    action: 'approve' | 'reject',
    signature: string,
    note = ''
  ): Promise<ApiResponse<ApprovalData>> {
    return this.request<ApprovalData>('POST', `/api/approvals/${id}/decide`, { action, signature, note });
  }

  async cancelApproval(id: number): Promise<ApiResponse<ApprovalData>> {
    return this.request<ApprovalData>('POST', `/api/approvals/${id}/cancel`);
  }

  // === 협업 보드 (onprem/routes/whiteboards.js) ===
  async getWhiteboards(): Promise<ApiResponse<WhiteboardListData>> {
    return this.request<WhiteboardListData>('GET', '/api/whiteboards');
  }

  async getWhiteboard(id: string): Promise<ApiResponse<WhiteboardBoardData>> {
    return this.request<WhiteboardBoardData>('GET', `/api/whiteboards/${encodeURIComponent(id)}`);
  }

  async createWhiteboard(title: string, kind: WhiteboardKind): Promise<ApiResponse<WhiteboardBoardData>> {
    return this.request<WhiteboardBoardData>('POST', '/api/whiteboards', { title, kind });
  }

  async updateWhiteboard(
    id: string,
    data: WhiteboardData,
    expectedVersion: number,
    title?: string
  ): Promise<ApiResponse<WhiteboardUpdateData>> {
    return this.request<WhiteboardUpdateData>(
      'PUT',
      `/api/whiteboards/${encodeURIComponent(id)}`,
      { data, expectedVersion, title },
      { timeoutMs: 8000 }
    );
  }

  async deleteWhiteboard(id: string): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('DELETE', `/api/whiteboards/${encodeURIComponent(id)}`);
  }

  async getTimetableTemplates(): Promise<ApiResponse<TimetableTemplateResponse[]>> {
    return this.request<TimetableTemplateResponse[]>('GET', '/api/admin/timetable/templates');
  }

  async createTimetableTemplate(template: Omit<TimetableTemplateResponse, 'id' | 'createdAt' | 'updatedAt' | 'isPublished' | 'publishedAt'>): Promise<ApiResponse<TimetableTemplateResponse>> {
    return this.request('POST', '/api/admin/timetable/templates', template, { isAdmin: true });
  }

  async publishTimetableTemplate(id: string): Promise<ApiResponse<void>> {
    return this.request('POST', `/api/admin/timetable/templates/${id}/publish`, undefined, { isAdmin: true });
  }

  async getGradeClasses(): Promise<ApiResponse<{ grade: string; classNo: string; homeroomTeacherId?: string; homeroomTeacherName?: string; studentCount: number }[]>> {
    return this.request('GET', '/api/admin/timetable/grade-classes');
  }

  async getSchoolInfo(): Promise<ApiResponse<SchoolResponse>> {
    return this.request<SchoolResponse>('GET', '/api/admin/school', undefined, { isAdmin: true });
  }

  async updateSchoolInfo(school: Partial<SchoolResponse>): Promise<ApiResponse<SchoolResponse>> {
    return this.request('PUT', '/api/admin/school', school, { isAdmin: true });
  }

  async getSchoolSettings(): Promise<ApiResponse<SchoolSettingsResponse>> {
    return this.request<SchoolSettingsResponse>('GET', '/api/admin/school/settings', undefined, { isAdmin: true });
  }

  async updateSchoolSettings(settings: Partial<SchoolSettingsResponse>): Promise<ApiResponse<SchoolSettingsResponse>> {
    return this.request('PUT', '/api/admin/school/settings', settings, { isAdmin: true });
  }

  /** 화면에서 일어난 일을 서버 컴퓨터의 텍스트 활동 로그에 남긴다. 실패해도 화면은 멈추지 않는다. */
  async logActivity(action: string, detail?: Record<string, unknown>): Promise<void> {
    try {
      await this.request('POST', '/api/activity', { action, detail }, { timeoutMs: 4000 });
    } catch {
      /* 로그는 보조 기능 — 통신 실패를 사용자에게 알리지 않는다. */
    }
  }

  // === 헬스 체크 ===
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/public-info`, { 
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// 싱글톤 인스턴스
export const api = new ApiClient();

// 환경별 베이스 URL 설정 헬퍼 (인스턴스 유지 → 토큰 보존)
export function setApiBaseUrl(url: string) {
  api.setBaseUrl(url);
}

/** 서버 주소 입력값(예: "192.168.1.100", "192.168.1.100:3000")을 API 베이스 URL로 변환 */
export function normalizeServerUrl(input: string, fallbackPort = 3000): string {
  let s = String(input || '').trim();
  if (!s) return DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '');
  try {
    const u = new URL(s);
    if (!u.port) u.port = String(fallbackPort);
    return u.origin;
  } catch {
    return DEFAULT_API_BASE;
  }
}

export default api;