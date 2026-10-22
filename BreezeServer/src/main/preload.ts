// BreezeServer Preload 스크립트 (보안 IPC)

import { contextBridge, ipcRenderer } from 'electron';

// 렌더러 프로세스에 노출할 API
contextBridge.exposeInMainWorld('breezeAPI', {
  // 창 제어
  window: {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
  },

  // 업데이트 알림 푸시
  pushUpdateNotification: (data: { versionId: string; targetType: string; targetIds?: string[] }) =>
    ipcRenderer.invoke('push-update-notification', data),

  // 연결된 클라이언트 조회
  getConnectedClients: () => ipcRenderer.invoke('get-connected-clients'),

  // 네비게이션
  navigateTo: (page: string) => ipcRenderer.send('navigate-to', page),

  // 이벤트 리스너
  onClientsUpdated: (callback: (clients: any[]) => void) => {
    ipcRenderer.on('clients-updated', (_, clients) => callback(clients));
    return () => ipcRenderer.removeAllListeners('clients-updated');
  },

  onOtaNotification: (callback: (notification: any) => void) => {
    ipcRenderer.on('ota-notification', (_, notification) => callback(notification));
    return () => ipcRenderer.removeAllListeners('ota-notification');
  },

  onNavigateTo: (callback: (page: string) => void) => {
    ipcRenderer.on('navigate-to', (_, page) => callback(page));
    return () => ipcRenderer.removeAllListeners('navigate-to');
  },
});

// 타입 선언
declare global {
  interface Window {
    breezeAPI: {
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
      pushUpdateNotification: (data: { versionId: string; targetType: string; targetIds?: string[] }) => Promise<{ success: boolean; sentCount?: number; error?: string }>;
      getConnectedClients: () => Promise<any[]>;
      navigateTo: (page: string) => void;
      onClientsUpdated: (callback: (clients: any[]) => void) => () => void;
      onOtaNotification: (callback: (notification: any) => void) => () => void;
      onNavigateTo: (callback: (page: string) => void) => () => void;
    };
  }
}