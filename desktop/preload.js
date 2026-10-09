'use strict';

// 최소 권한 원칙: 렌더러에는 허용된 채널의 invoke/on 만 노출 (ipcRenderer 원본은 넘기지 않음)
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE = new Set([
  'edutalk:notify', 'edutalk:get-notification-position', 'edutalk:set-notification-position',
  'edutalk:get-classic-mode', 'edutalk:set-classic-mode',
  'edutalk:get-always-on-top', 'edutalk:set-always-on-top',
  'edutalk:get-usb-log', 'edutalk:capture-masked',
  // Desktop-First Native (신규, 데스크톱 전용)
  'edutalk:get-netmode', 'edutalk:set-netmode',
  'edutalk:dlp-verify',
  'edutalk:p2p-peers', 'edutalk:p2p-send',
  'edutalk:ram-preview-put', 'edutalk:ram-preview-get', 'edutalk:ram-preview-free',
  'edutalk:local-memo-save', 'edutalk:local-memo-list',
]);
const ALLOWED_ON = new Set([
  'edutalk:open-room', 'edutalk:classic-mode', 'edutalk:notify-show',
  'edutalk:p2p-peers', 'edutalk:p2p-message', 'edutalk:netmode', 'edutalk:capture-mask',
]);

function safeInvoke(ch, ...args) {
  if (!ALLOWED_INVOKE.has(ch)) return Promise.reject(new Error('blocked-channel'));
  return ipcRenderer.invoke(ch, ...args);
}
function safeOn(ch, handler) {
  if (!ALLOWED_ON.has(ch) || typeof handler !== 'function') return;
  ipcRenderer.on(ch, (event, ...rest) => { try { handler(...rest); } catch (e) {} });
}

contextBridge.exposeInMainWorld('edutalkDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  isDesktop: true,
  nativeKind: 'electron-local-first',

  // 새 메시지 알림: 웹의 Notification API 대신 앱 자체 알림창(카톡 스타일)을 띄웁니다.
  notify: (payload) => safeInvoke('edutalk:notify', payload),

  // 알림창이 나타날 모니터 위치 (top-left · top-right · bottom-left · bottom-right)
  getNotificationPosition: () => safeInvoke('edutalk:get-notification-position'),
  setNotificationPosition: (position) => safeInvoke('edutalk:set-notification-position', position),

  // 알림창을 눌러 해당 채팅방을 열 때 웹으로 알려 줍니다.
  onOpenRoom: (handler) => {
    safeOn('edutalk:open-room', (roomId) => handler(String(roomId || '')));
  },

  // Classic org (narrow teacher panel): web asks main to resize the window.
  getClassicMode: () => safeInvoke('edutalk:get-classic-mode'),
  setClassicMode: (on) => safeInvoke('edutalk:set-classic-mode', !!on),
  onClassicMode: (handler) => {
    safeOn('edutalk:classic-mode', (on) => handler(!!on));
  },
  getAlwaysOnTop: () => safeInvoke('edutalk:get-always-on-top'),
  setAlwaysOnTop: (on) => safeInvoke('edutalk:set-always-on-top', !!on),
  getUsbLog: () => safeInvoke('edutalk:get-usb-log'),
  captureMasked: () => safeInvoke('edutalk:capture-masked'),
  // Notification window (notification.html) only
  onNotifyShow: (handler) => {
    safeOn('edutalk:notify-show', (payload) => handler(payload || {}));
  },
  notifyAction: (action, roomId) => ipcRenderer.send('edutalk:notify-action', {
    action: String(action || ''),
    roomId: String(roomId || '')
  }),

  // ---- Desktop-First Native (데스크톱 전용, 웹/Lite에서 호출 시 no-op 처리) ----
  getNetMode: () => safeInvoke('edutalk:get-netmode'),
  setNetMode: (m) => safeInvoke('edutalk:set-netmode', m),
  onNetMode: (h) => safeOn('edutalk:netmode', h),
  dlpVerify: (req) => safeInvoke('edutalk:dlp-verify', req || {}),
  p2pPeers: () => safeInvoke('edutalk:p2p-peers'),
  p2pSend: (req) => safeInvoke('edutalk:p2p-send', req || {}),
  onP2pPeers: (h) => safeOn('edutalk:p2p-peers', h),
  onP2pMessage: (h) => safeOn('edutalk:p2p-message', h),
  ramPreviewPut: (req) => safeInvoke('edutalk:ram-preview-put', req || {}),
  ramPreviewGet: (id) => safeInvoke('edutalk:ram-preview-get', String(id || '')),
  ramPreviewFree: (id) => safeInvoke('edutalk:ram-preview-free', String(id || '')),
  localMemoSave: (m) => safeInvoke('edutalk:local-memo-save', m || {}),
  localMemoList: () => safeInvoke('edutalk:local-memo-list'),
  onCaptureMask: (h) => safeOn('edutalk:capture-mask', h),
});
