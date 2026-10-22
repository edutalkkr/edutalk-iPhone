// 쪽지 실시간 브리지 (5단계-2)
// - 소켓 연결 + memo-arrived / peer-read 이벤트 구독을 한 곳에서 관리
// - 미읽음 개수 조회 편의 함수 제공

import { socket } from './socket';
import api from './api';
import type { SocketEventPayload } from '../types/api';

export type MemoArrivedPayload = SocketEventPayload<'memo-arrived'>;
export type PeerReadPayload = SocketEventPayload<'peer-read'>;

export interface NotesRealtimeHandlers {
  onMemoArrived?: (payload: MemoArrivedPayload) => void;
  onPeerRead?: (payload: PeerReadPayload) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

/** 소켓 연결(베스트 에포트). 성공 여부를 반환하고, 실패해도 조용히 false. */
export function disconnectNotesRealtime(): void {
  socket.disconnect();
}

export async function connectNotesRealtime(opts: { url?: string; token?: string } = {}): Promise<boolean> {
  if (opts.url) socket.setUrl(opts.url);
  try {
    await socket.connect(opts.token);
    return true;
  } catch {
    return false;
  }
}

/**
 * 쪽지 이벤트 구독 시작. 반환값(구독 해제)을 컴포넌트 unmount에서 호출할 것.
 * 소켓 연결 이전에 호출해도 되며, 연결되면 자동으로 수신된다.
 */
export function startNotesRealtime(handlers: NotesRealtimeHandlers): () => void {
  const offs: Array<() => void> = [];

  if (handlers.onMemoArrived) {
    offs.push(socket.on('memo-arrived', handlers.onMemoArrived));
  }
  if (handlers.onPeerRead) {
    offs.push(socket.on('peer-read', handlers.onPeerRead));
  }
  if (handlers.onConnected) {
    offs.push(socket.on('connect', handlers.onConnected));
  }
  if (handlers.onDisconnected) {
    offs.push(socket.on('disconnect', handlers.onDisconnected));
  }

  return () => {
    offs.forEach((off) => off());
  };
}

/** 받은 쪽지함 미읽음 개수 조회 (실패 시 0) */
export async function fetchUnreadCount(): Promise<number> {
  const res = await api.getNotesInbox(1, true, 1);
  if (!res.ok || !res.data) return 0;
  return Number(res.data.unread) || 0;
}
