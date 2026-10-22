// BreezeServer API 클라이언트

import { useAuthStore } from '../store/authStore';

const API_BASE = '/api';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, headers, ...fetchOptions } = options;

  // URL 구성
  const url = new URL(`${API_BASE}${endpoint}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  // 인증 헤더 추가
  const token = useAuthStore.getState().token;
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const response = await fetch(url.toString(), {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    // 401 에러 시 자동 로그아웃
    if (response.status === 401) {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
    }
    throw new Error(data.message || '요청에 실패했습니다.');
  }

  return data;
}

export const api = {
  get: <T>(endpoint: string, params?: RequestOptions['params']) =>
    request<T>(endpoint, { method: 'GET', params }),

  post: <T>(endpoint: string, body?: any, params?: RequestOptions['params']) =>
    request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      params,
    }),

  patch: <T>(endpoint: string, body?: any, params?: RequestOptions['params']) =>
    request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
      params,
    }),

  delete: <T>(endpoint: string, params?: RequestOptions['params']) =>
    request<T>(endpoint, { method: 'DELETE', params }),

  // 파일 업로드
  upload: <T>(endpoint: string, file: File, additionalData?: Record<string, string>) => {
    const formData = new FormData();
    formData.append('file', file);
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    const token = useAuthStore.getState().token;
    return fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: formData,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '업로드에 실패했습니다.');
      return data as T;
    }),
  },
};

// Socket.io 클라이언트 (실시간 알림용)
let socket: any = null;

export function initializeSocket(onNotification?: (notification: any) => void, onClientsUpdate?: (clients: any[]) => void) {
  if (socket?.connected) return socket;

  // 개발 환경에서는 프록시, 프로덕션에서는 같은 오리진
  const socketUrl = import.meta.env.DEV ? 'http://localhost:38766' : '';

  // 동적 임포트
  import('socket.io-client').then(({ io }) => {
    socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socket.on('connect', () => {
      console.log('[Socket.io] Connected:', socket.id);

      // 인증 전송
      const { token, teacher } = useAuthStore.getState();
      if (token && teacher) {
        socket.emit('authenticate', {
          token,
          teacherId: teacher.id,
          teacherName: teacher.name,
          department: teacher.departmentName || '',
          version: '1.0.0',
          platform: 'win32',
        });
      }
    });

    socket.on('authenticated', (data: any) => {
      console.log('[Socket.io] Authenticated:', data);
    });

    socket.on('ota-notification', (notification: any) => {
      console.log('[Socket.io] OTA notification:', notification);
      onNotification?.(notification);
    });

    socket.on('clients-updated', (clients: any[]) => {
      onClientsUpdate?.(clients);
    });

    socket.on('disconnect', (reason: string) => {
      console.log('[Socket.io] Disconnected:', reason);
    });

    socket.on('connect_error', (error: Error) => {
      console.error('[Socket.io] Connection error:', error);
    });
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function sendHeartbeat() {
  if (socket?.connected) {
    socket.emit('heartbeat');
  }
}

// 주기적 하트비트
let heartbeatInterval: NodeJS.Timeout | null = null;

export function startHeartbeat(intervalMs = 30000) {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(sendHeartbeat, intervalMs);
}

export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}