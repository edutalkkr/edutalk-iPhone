// Breeze Socket Client - 브리즈코어/브리즈서버 실시간 통신 (onprem, 기본 포트 3000)
// Socket.io 기반, 자동 재연결, 이벤트 타입 안전성 보장
//
// 개선점 (5단계-2):
// - connect() 이전에 on()으로 등록한 핸들러를 보관했다가 연결/재연결 시 일괄 재부착
// - 연결 중복 호출을 connectPromise로 합류시켜 경합 제거
// - 재연결 이벤트를 매니저(socket.io) 기준으로 수신 (socket.io-client v4)

import { io, Socket } from 'socket.io-client';
import type { SocketEventName, SocketEventPayload, SocketEvents } from '../types/api';
import type { WhiteboardBoard, WhiteboardData } from '../types';

type EventHandler<K extends SocketEventName> = (payload: SocketEventPayload<K>) => void;
type GenericHandler = (event: string, payload: unknown) => void;

interface SocketConfig {
  url?: string;
  token?: string;
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  timeout?: number;
}

interface HandlerEntry {
  orig: Function;
  wrapper: (payload: unknown) => void;
}

// 제네릭 이벤트명과 socket.io의 조건부 리스너 타입 간 마찰을 피하기 위한 느슨한 뷰
interface RawSocket {
  on(event: string, fn: (payload: unknown) => void): void;
  once(event: string, fn: (payload: unknown) => void): void;
  off(event: string, fn: (payload: unknown) => void): void;
}

class BreezeSocket {
  private socket: Socket | null = null;
  private config: Required<SocketConfig>;
  private handlers: Map<string, HandlerEntry[]> = new Map();
  private genericHandlers: Set<GenericHandler> = new Set();
  private connectPromise: Promise<void> | null = null;
  private manualDisconnect = false;
  private reattached = false;

  constructor(config: SocketConfig = {}) {
    this.config = {
      url: config.url || 'http://localhost:3000',
      token: config.token || '',
      autoConnect: config.autoConnect ?? true,
      reconnection: config.reconnection ?? true,
      reconnectionAttempts: config.reconnectionAttempts ?? 10,
      reconnectionDelay: config.reconnectionDelay ?? 3000,
      timeout: config.timeout ?? 10000,
    };
  }

  /** 서버 주소 변경 (연결 중이면 재연결) */
  setUrl(url: string) {
    const next = String(url || '').replace(/\/+$/, '');
    if (!next || next === this.config.url) return;
    this.config.url = next;
    if (this.socket) {
      this.disconnect();
      this.connect().catch(() => { /* 재연결 실패는 조용히 무시 */ });
    }
  }

  get url(): string {
    return this.config.url;
  }

  connect(token?: string): Promise<void> {
    if (this.socket?.connected) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.manualDisconnect = false;
    this.reattached = false;

    const authToken =
      token || this.config.token ||
      (typeof window !== 'undefined' ? localStorage.getItem('breeze_auth_token') : null) || '';

    this.socket = io(this.config.url, {
      auth: { token: authToken },
      autoConnect: true,
      reconnection: this.config.reconnection,
      reconnectionAttempts: this.config.reconnectionAttempts,
      reconnectionDelay: this.config.reconnectionDelay,
      timeout: this.config.timeout,
      transports: ['websocket', 'polling'],
    });

    const sock = this.socket;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        sock.off('connect', onConnect);
        sock.off('connect_error', onError);
        sock.off('connect_timeout', onTimeout);
      };
      const onConnect = () => {
        cleanup();
        this.attachStoredHandlers();
        this.emit('connect', undefined);
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error('Connection timeout'));
      };

      sock.once('connect', onConnect);
      sock.once('connect_error', onError);
      sock.once('connect_timeout', onTimeout);

      // 재연결 시 핸들러 재부착 + 상태 알림
      sock.io.on('reconnect', (attempt: number) => {
        this.attachStoredHandlers();
        this.emit('connect', undefined);
        this.emit('reconnect', { attempt });
      });
      sock.io.on('reconnect_attempt', (attempt: number) => {
        this.emit('reconnecting', { attempt });
      });
      sock.io.on('reconnect_failed', () => {
        this.emit('reconnect_failed', {});
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    // 영구 이벤트 핸들러 등록
    this.setupPermanentHandlers(sock);

    return this.connectPromise;
  }

  private setupPermanentHandlers(sock: Socket) {
    sock.on('disconnect', (reason) => {
      this.emit('disconnect', reason);
    });
  }

  /** socket.io 조건부 타입을 우회하는 느슨한 소켓 뷰 */
  private get raw(): RawSocket | null {
    return this.socket as unknown as RawSocket | null;
  }

  /** 등록된 사용자 핸들러를 현재 소켓에 (재)부착 */
  private attachStoredHandlers() {
    const raw = this.raw;
    if (!raw) return;
    if (this.reattached) return;
    this.reattached = true;
    this.handlers.forEach((entries, event) => {
      entries.forEach((entry) => {
        raw.off(event, entry.wrapper);
        raw.on(event, entry.wrapper);
      });
    });
  }

  disconnect() {
    this.manualDisconnect = true;
    this.reattached = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // === 방 관리 ===
  joinRoom(roomId: string): Promise<boolean> {
    return this.ack('room:join', roomId);
  }

  leaveRoom(roomId: string): void {
    this.socket?.emit('room:leave', roomId);
  }

  // === 사용자 상태 ===
  changeStatus(status: string, statusMessage?: string): Promise<{ userId: string; status: string; statusMessage: string; at: string }> {
    return this.ack('user:change_status', { status, statusMessage });
  }

  // === 메시지 ===
  sendMessage(payload: {
    roomId: string;
    content?: string;
    fileId?: number;
    isNotice?: boolean;
    poll?: { q: string; opts: string[] };
  }): Promise<{ message: SocketEventPayload<'message:new'> }> {
    return this.ack('message:send', payload);
  }

  readMessage(messageId: number): Promise<{ readCount: number }> {
    return this.ack('message:read', { messageId });
  }

  recallMessage(messageId: number): Promise<void> {
    return this.ack('message:recall', { messageId });
  }

  // === 투표 ===
  votePoll(messageId: number, choices: number[]): Promise<{ mine: number[] }> {
    return this.ack('poll:vote', { messageId, choices });
  }

  closePoll(messageId: number): Promise<void> {
    return this.ack('poll:close', { messageId });
  }

  // === 원격 지원 ===
  requestRemoteView(nodeId: string): Promise<{ request_id: string }> {
    return this.ack('remote_view_request', { node_id: nodeId });
  }

  respondRemoteView(nodeId: string, requestId: string, accept: boolean): Promise<void> {
    return this.ack('remote_view_respond', { node_id: nodeId, request_id: requestId, accept });
  }

  sendRemoteFrame(nodeId: string, requestId: string, imageB64: string): Promise<void> {
    return this.ack('remote_view_frame', { node_id: nodeId, request_id: requestId, image_b64: imageB64 });
  }

  byeRemoteView(nodeId: string, requestId: string): Promise<void> {
    return this.ack('remote_view_bye', { node_id: nodeId, request_id: requestId });
  }

  // === 협업 보드 ===
  joinWhiteboard(boardId: string): Promise<{ board: WhiteboardBoard }> {
    return this.ack('whiteboard:join', { boardId });
  }

  leaveWhiteboard(boardId: string): Promise<void> {
    return this.ack('whiteboard:leave', { boardId });
  }

  sendWhiteboardUpdate(
    boardId: string,
    data: WhiteboardData,
    expectedVersion: number
  ): Promise<{ conflict?: boolean; board: WhiteboardBoard }> {
    return this.ack('whiteboard:update', { boardId, data, expectedVersion });
  }

  // === 제네릭 ACK 패턴 ===
  private ack<T, K extends SocketEventName>(event: K, payload: SocketEventPayload<K>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      const timeout = setTimeout(() => reject(new Error('ACK timeout')), 5000);

      this.socket.emit(event, payload, (response: { ok: boolean; error?: string } & T) => {
        clearTimeout(timeout);
        if (response.ok) {
          resolve(response);
        } else {
          reject(new Error(response.error || 'Server error'));
        }
      });
    });
  }

  // === 이벤트 구독 ===
  /** 연결 전에도 등록 가능. 연결되면 자동 부착된다. 반환값은 구독 해제 함수. */
  on<K extends SocketEventName>(event: K, handler: EventHandler<K>): () => void {
    const wrapper = (payload: unknown) => {
      try {
        handler(payload as SocketEventPayload<K>);
      } catch { /* 핸들러 오류가 소켓을 깨지 않게 */ }
    };

    const entries = this.handlers.get(event) || [];
    entries.push({ orig: handler, wrapper });
    this.handlers.set(event, entries);

    this.raw?.on(event, wrapper);

    return () => this.off(event, handler);
  }

  once<K extends SocketEventName>(event: K, handler: EventHandler<K>): () => void {
    const wrapper = (payload: unknown) => {
      this.off(event, handler);
      handler(payload as SocketEventPayload<K>);
    };
    const entries = this.handlers.get(event) || [];
    entries.push({ orig: handler, wrapper });
    this.handlers.set(event, entries);
    this.raw?.once(event, wrapper);
    return () => this.off(event, handler);
  }

  off<K extends SocketEventName>(event: K, handler: EventHandler<K>): void {
    const entries = this.handlers.get(event);
    if (!entries) return;
    const next = entries.filter((e) => {
      if (e.orig === handler) {
        this.raw?.off(event, e.wrapper);
        return false;
      }
      return true;
    });
    if (next.length) this.handlers.set(event, next);
    else this.handlers.delete(event);
  }

  // 모든 이벤트 수신 (디버깅용)
  onAny(handler: GenericHandler): () => void {
    this.genericHandlers.add(handler);
    return () => {
      this.genericHandlers.delete(handler);
    };
  }

  private emit(event: string, payload: unknown) {
    this.genericHandlers.forEach((h) => {
      try { h(event, payload); } catch { /* ignore */ }
    });

    // 'connect' 등 시스템 이벤트도 구독자에게 전달
    const entries = this.handlers.get(event);
    if (entries) {
      entries.forEach((e) => {
        try { e.wrapper(payload); } catch { /* ignore */ }
      });
    }
  }

  // === 상태 확인 ===
  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  get id(): string | undefined {
    return this.socket?.id;
  }

  // 토큰 업데이트 (연결 중이면 auth 교체 + 재연결)
  updateToken(token: string) {
    this.config.token = token;
    if (this.socket) {
      this.socket.auth = { token };
      if (this.socket.connected) {
        this.socket.disconnect();
        this.socket.connect();
      }
    }
  }
}

// 싱글톤 인스턴스
export const socket = new BreezeSocket();

// 편의 훅 (React에서 사용)
export function useSocket() {
  return socket;
}

export default socket;
