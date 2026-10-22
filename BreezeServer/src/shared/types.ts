// BreezeServer 공통 타입 정의

export interface Teacher {
  id: string;
  employeeNumber: string; // 교원번호
  name: string;
  departmentId: string | null;
  departmentName?: string;
  position: string; // 교장, 교감, 교사, 행정실장, 행정직 등
  grade?: string; // 담임인 경우 학년
  classNo?: string; // 담임인 경우 반
  role: 'superadmin' | 'admin' | 'teacher';
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolSettings {
  id: string;
  schoolName: string;
  schoolCode: string;
  address: string;
  phone: string;
  principalName: string;
  autoUpdateEnabled: boolean;
  updateCheckInterval: number; // 분 단위
  maintenanceMode: boolean;
  maxFileSize: number; // MB
  allowedFileTypes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  adminId: string;
  adminName: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  targetName: string;
  detail: string;
  ipAddress: string;
  userAgent: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
  createdAt: string;
  // 서명/해시 필드 (위변조 방지)
  hash: string;
  previousHash: string;
}

export type AuditAction =
  | 'teacher_create'
  | 'teacher_update'
  | 'teacher_delete'
  | 'teacher_suspend'
  | 'teacher_activate'
  | 'department_create'
  | 'department_update'
  | 'department_delete'
  | 'role_change'
  | 'settings_update'
  | 'message_delete'
  | 'message_read'
  | 'file_delete'
  | 'file_download'
  | 'audit_log_export'
  | 'system_shutdown'
  | 'system_restart'
  | 'backup_create'
  | 'backup_restore'
  | 'update_upload'
  | 'update_deploy'
  | 'update_rollback'
  | 'login'
  | 'logout'
  | 'failed_login';

export type AuditTargetType =
  | 'teacher'
  | 'department'
  | 'school_settings'
  | 'message'
  | 'file'
  | 'audit_log'
  | 'system'
  | 'update';

export interface ClientVersion {
  version: string;
  buildNumber: number;
  releaseNotes: string;
  downloadUrl: string;
  mandatory: boolean;
  minSupportedVersion: string;
  releasedAt: string;
  fileSize: number;
  sha256: string;
  platform: 'win32' | 'darwin' | 'linux';
}

export interface UpdateManifest {
  latestVersion: string;
  minSupportedVersion: string;
  versions: ClientVersion[];
}

export interface ConnectedClient {
  id: string;
  teacherId: string;
  teacherName: string;
  department: string;
  version: string;
  platform: string;
  ipAddress: string;
  lastSeen: string;
  status: 'online' | 'away' | 'offline';
  socketId?: string;
}

export interface OTAUpdateNotification {
  type: 'update_available' | 'update_mandatory' | 'update_downloading' | 'update_ready' | 'update_failed';
  version: string;
  releaseNotes: string;
  downloadUrl: string;
  mandatory: boolean;
  progress?: number;
}

export interface LoginCredentials {
  schoolCode: string;
  employeeNumber: string;
  password: string;
}

export interface AuthResult {
  success: boolean;
  teacher?: Teacher;
  token?: string;
  error?: string;
  requiresUpdate?: boolean;
  latestVersion?: string;
}

export interface ServerStatus {
  status: 'running' | 'stopped' | 'maintenance';
  uptime: number;
  connectedClients: number;
  totalTeachers: number;
  totalDepartments: number;
  diskUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  currentVersion: string;
  latestVersion: string;
}