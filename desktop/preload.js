'use strict';

// 최소 권한 원칙: 렌더러에는 데스크톱 앱이라는 정보와 알림 관련 기능만 노출하고
// 그 밖의 Node.js API / ipcRenderer 는 일절 넘기지 않습니다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('edutalkDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  isDesktop: true,

  // 새 메시지 알림: 웹의 Notification API 대신 앱 자체 알림창(카톡 스타일)을 띄웁니다.
  notify: (payload) => ipcRenderer.invoke('edutalk:notify', payload),

  // 알림창이 나타날 모니터 위치 (top-left · top-right · bottom-left · bottom-right)
  getNotificationPosition: () => ipcRenderer.invoke('edutalk:get-notification-position'),
  setNotificationPosition: (position) => ipcRenderer.invoke('edutalk:set-notification-position', position),

  // 알림창을 눌러 해당 채팅방을 열 때 웹으로 알려 줍니다.
  onOpenRoom: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('edutalk:open-room', (event, roomId) => handler(String(roomId || '')));
  },

  // 알림창(notification.html) 전용
  onNotifyShow: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on('edutalk:notify-show', (event, payload) => handler(payload || {}));
  },
  notifyAction: (action, roomId) => ipcRenderer.send('edutalk:notify-action', {
    action: String(action || ''),
    roomId: String(roomId || '')
  })
});
