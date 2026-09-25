'use strict';

/**
 * 에듀톡(Edutalk) 데스크톱 앱 — Electron 메인 프로세스
 *
 *  - https://edutalk.cloud 를 그대로 로드하는 얇은 셸(웹을 수정하면 앱 재배포 없이 반영)
 *  - 트레이 상주 + 부팅 시 자동 실행
 *  - 웹의 Notification API 알림을 윈도우 네이티브 토스트로 표시
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeTheme,
  screen,
  session,
  shell
} = require('electron');
const fs = require('fs');
const path = require('path');

const APP_URL = 'https://edutalk.cloud/';
const APP_ORIGIN = 'https://edutalk.cloud';
const APP_ID = 'com.edutalk.messenger';

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray.png');

// 자체 알림창(카톡 스타일) 설정
const NOTIF_WIDTH = 380;
const NOTIF_HEIGHT = 124;
const NOTIF_MARGIN = 16;
const NOTIF_VISIBLE_MS = 6000;
const NOTIFICATION_POSITIONS = [
  ['top-left', '왼쪽 위'],
  ['top-right', '오른쪽 위'],
  ['bottom-left', '왼쪽 아래'],
  ['bottom-right', '오른쪽 아래']
];
const DEFAULT_NOTIFICATION_POSITION = 'bottom-right';

// 자동 실행으로 켜진 경우(--hidden) 창은 숨긴 채로 시작합니다.
const START_HIDDEN = process.argv.includes('--hidden');

const RELOAD_DELAY_MS = 5000;
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 820;
const MIN_WIDTH = 380;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let reloadScheduled = false;
let reloadTimer = null;

/* ------------------------------------------------------------- 유틸리티 */

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function isInternalUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === APP_ORIGIN;
  } catch (err) {
    return false;
  }
}

// Firebase 팝업 로그인(signInWithPopup)이 여는 인증 창인지 여부
//  - Firebase가 먼저 여는 about:blank 창
//  - https://<project>.firebaseapp.com/__/auth/handler (웹 firebaseConfig.authDomain)
//  - https://<project>.web.app/__/auth/handler
// 이 창을 Electron 밖(기본 브라우저)으로 보내면 opener 가 없어 로그인 결과가 앱으로 돌아오지 않습니다.
function isFirebaseAuthUrl(rawUrl) {
  if (rawUrl === 'about:blank') return true;
  try {
    const { protocol, hostname, pathname } = new URL(rawUrl);
    if (protocol !== 'https:' || !pathname.startsWith('/__/auth')) return false;
    return isInternalUrl(rawUrl) || hostname.endsWith('.firebaseapp.com') || hostname.endsWith('.web.app');
  } catch (err) {
    return false;
  }
}

function openExternal(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return;
  }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return;
  shell.openExternal(rawUrl).catch((err) => {
    console.warn('[edutalk] 외부 링크 열기 실패:', err.message);
  });
}

/* ----------------------------------------------------------- 창 상태 저장 */

function readWindowState() {
  const fallback = {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    x: undefined,
    y: undefined,
    isMaximized: false
  };

  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(userDataFile('window-state.json'), 'utf8'));
  } catch (err) {
    return fallback;
  }
  if (!saved || typeof saved !== 'object') return fallback;

  const state = {
    width: Number.isFinite(saved.width) && saved.width >= MIN_WIDTH ? saved.width : DEFAULT_WIDTH,
    height: Number.isFinite(saved.height) && saved.height > 0 ? saved.height : DEFAULT_HEIGHT,
    x: Number.isFinite(saved.x) ? saved.x : undefined,
    y: Number.isFinite(saved.y) ? saved.y : undefined,
    isMaximized: saved.isMaximized === true
  };

  // 저장된 위치가 지금 연결된 모니터 밖이면 위치를 버리고 기본값으로 엽니다.
  if (!isVisibleOnSomeDisplay(state)) {
    state.x = undefined;
    state.y = undefined;
  }
  return state;
}

function isVisibleOnSomeDisplay(state) {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      state.x < area.x + area.width - 40 &&
      state.x + state.width > area.x + 40 &&
      state.y < area.y + area.height - 40 &&
      state.y + state.height > area.y + 40
    );
  });
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    const data = { ...bounds, isMaximized: win.isMaximized() };
    fs.writeFileSync(userDataFile('window-state.json'), JSON.stringify(data), 'utf8');
  } catch (err) {
    console.warn('[edutalk] 창 상태 저장 실패:', err.message);
  }
}

/* ------------------------------------------------------- 자동 실행(로그인) */

// 시작할 때 창을 자동으로 띄울지 여부(트레이 메뉴에서 바꿀 수 있음).
// 기본값은 트레이에만 상주하고 창은 열지 않는 것입니다.
function isNotificationPosition(value) {
  return NOTIFICATION_POSITIONS.some(([v]) => v === value);
}

function readPrefs() {
  const defaults = { showWindowOnStartup: false, notificationPosition: DEFAULT_NOTIFICATION_POSITION };
  try {
    const saved = JSON.parse(fs.readFileSync(userDataFile('preferences.json'), 'utf8'));
    if (!saved || typeof saved !== 'object') return { ...defaults };
    return {
      showWindowOnStartup: saved.showWindowOnStartup === true,
      notificationPosition: isNotificationPosition(saved.notificationPosition)
        ? saved.notificationPosition
        : defaults.notificationPosition
    };
  } catch (err) {
    return { ...defaults };
  }
}

// 넘긴 항목만 바꾸고 나머지 설정은 그대로 둡니다.
function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    fs.writeFileSync(userDataFile('preferences.json'), JSON.stringify(next), 'utf8');
  } catch (err) {
    console.warn('[edutalk] 설정 저장 실패:', err.message);
  }
  return next;
}

// 개발 실행(`electron .`)일 때는 실행 인자에 앱 경로가 함께 필요합니다.
function getLoginItemArgs() {
  const args = [];
  if (!readPrefs().showWindowOnStartup) args.push('--hidden');
  if (!app.isPackaged) args.unshift(app.getAppPath());
  return args;
}

function loginItemOptions(openAtLogin) {
  const options = { openAtLogin };
  if (process.platform === 'win32') {
    options.path = process.execPath;
    options.args = getLoginItemArgs();
  }
  return options;
}

function isAutoLaunchEnabled() {
  try {
    return app.getLoginItemSettings(loginItemOptions(true)).openAtLogin === true;
  } catch (err) {
    return false;
  }
}

function applyAutoLaunch(enabled) {
  try {
    app.setLoginItemSettings(loginItemOptions(enabled));
  } catch (err) {
    console.warn('[edutalk] 자동 실행 설정 실패:', err.message);
  }
  refreshTrayMenu();
}

// 시작할 때 창을 띄울지 저장하고, 자동 실행 바로가기 인자도 새로 맞춥니다.
// (설정을 먼저 바꾸면 기존 바로가기 인자와 달라져 자동 실행 여부를 못 읽으므로 순서에 주의)
function applyShowWindowOnStartup(enabled) {
  const autoLaunchOn = isAutoLaunchEnabled();
  writePrefs({ showWindowOnStartup: enabled });
  if (autoLaunchOn) applyAutoLaunch(true);
  else refreshTrayMenu();
}

// 첫 실행에서만 자동 실행을 등록합니다(이후에는 트레이 메뉴로 직접 켜고 끕니다).
function registerAutoLaunchOnFirstRun() {
  const flagPath = userDataFile('login-item-registered');
  if (fs.existsSync(flagPath)) return;
  try {
    app.setLoginItemSettings(loginItemOptions(true));
    fs.writeFileSync(flagPath, new Date().toISOString(), 'utf8');
  } catch (err) {
    console.warn('[edutalk] 자동 실행 등록 실패:', err.message);
  }
}

/* ------------------------------------------------------------- 권한 설정 */

function setupPermissions() {
  const allowed = new Set(['notifications', 'fullscreen', 'clipboard-sanitized-write']);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = (details && details.requestingUrl) || (webContents && webContents.getURL()) || '';
    if (!isInternalUrl(requestingUrl)) {
      callback(false);
      return;
    }
    // 알림은 허용, 카메라/마이크(media)를 포함한 나머지는 거부
    callback(allowed.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (!isInternalUrl(requestingOrigin)) return false;
    return allowed.has(permission);
  });
}

/* ------------------------------------------------------- 자체 알림창(카톡 스타일) */

let notifWindow = null;
let notifTimer = null;

// 현재 커서가 있는 모니터의 작업 영역 기준으로, 고른 모서리에 알림창을 놓습니다.
function notificationBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const position = readPrefs().notificationPosition;
  const onLeft = position.endsWith('left');
  const onTop = position.startsWith('top');
  return {
    x: Math.round(onLeft ? area.x + NOTIF_MARGIN : area.x + area.width - NOTIF_WIDTH - NOTIF_MARGIN),
    y: Math.round(onTop ? area.y + NOTIF_MARGIN : area.y + area.height - NOTIF_HEIGHT - NOTIF_MARGIN),
    width: NOTIF_WIDTH,
    height: NOTIF_HEIGHT
  };
}

function ensureNotifWindow() {
  if (notifWindow && !notifWindow.isDestroyed()) return notifWindow;
  notifWindow = new BrowserWindow({
    ...notificationBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  notifWindow.setAlwaysOnTop(true, 'screen-saver');
  notifWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notifWindow.loadFile(path.join(__dirname, 'assets', 'notification.html')).catch((err) => {
    console.warn('[edutalk] 알림창 로드 실패:', err.message);
  });
  notifWindow.on('closed', () => { notifWindow = null; });
  return notifWindow;
}

function hideNotifWindow() {
  clearTimeout(notifTimer);
  notifTimer = null;
  if (notifWindow && !notifWindow.isDestroyed()) notifWindow.hide();
}

// 로딩 중일 때만 '한 번' 실행되도록 예약한다.
// (같은 웹콘텐츠에 여러 번 예약하면 did-finish-load 가 한꺼번에 여러 콜백을 실행해
//  알림이 연쇄로 뜨거나 같은 동작이 반복되므로, 마지막 콜백 하나만 남긴다)
function onceLoaded(wc, fn) {
  if (!wc || wc.isDestroyed()) return;
  if (!wc.isLoading()) { fn(); return; }
  wc.__edutalkReady = fn;
  if (wc.__edutalkReadyBound) return;
  wc.__edutalkReadyBound = true;
  wc.once('did-finish-load', () => {
    wc.__edutalkReadyBound = false;
    const queued = wc.__edutalkReady;
    wc.__edutalkReady = null;
    if (queued) queued();
  });
}

// 웹(app.js)에서 알림 요청이 오면 앱 자체 알림창을 띄웁니다.
// 단, 메인창을 직접 보고 있으면(포커스) 띄우지 않는다 — 내려놓거나 꺼뒀을 때만.
function showNotification(payload) {
  try{
    if(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) return;
  }catch(e){}
  const win = ensureNotifWindow();
  if (!win || win.isDestroyed()) return;
  const data = {
    title: String((payload && payload.title) || '에듀톡').slice(0, 60),
    body: String((payload && payload.body) || '').slice(0, 160),
    roomId: String((payload && payload.roomId) || '')
  };
  const show = () => {
    if (!notifWindow || notifWindow.isDestroyed()) return;
    notifWindow.setBounds(notificationBounds());
    notifWindow.webContents.send('edutalk:notify-show', data);
    if (!notifWindow.isVisible()) notifWindow.showInactive();
    clearTimeout(notifTimer);
    notifTimer = setTimeout(hideNotifWindow, NOTIF_VISIBLE_MS);
  };
  onceLoaded(win.webContents, show);
}

// 알림창을 누르면 창을 열고 해당 채팅방으로 이동합니다.
function openRoomFromNotification(roomId) {
  showWindow();
  if (!roomId || !mainWindow || mainWindow.isDestroyed()) return;
  const send = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('edutalk:open-room', roomId); };
  onceLoaded(mainWindow.webContents, send);
}

function setupNotificationIpc() {
  ipcMain.handle('edutalk:notify', (event, payload) => {
    showNotification(payload);
    return true;
  });
  ipcMain.handle('edutalk:get-notification-position', () => readPrefs().notificationPosition);
  ipcMain.handle('edutalk:set-notification-position', (event, position) => {
    if (!isNotificationPosition(position)) return readPrefs().notificationPosition;
    writePrefs({ notificationPosition: position });
    refreshTrayMenu();
    if (notifWindow && !notifWindow.isDestroyed() && notifWindow.isVisible()) {
      notifWindow.setBounds(notificationBounds());
    }
    return position;
  });
  ipcMain.on('edutalk:notify-action', (event, message) => {
    const action = message && message.action;
    const roomId = message && message.roomId;
    hideNotifWindow();
    if (action === 'open' && roomId) openRoomFromNotification(roomId);
  });
}

/* ------------------------------------------------------------------ 창 */

function createWindow() {
  const state = readWindowState();

  const options = {
    width: state.width,
    height: state.height,
    minWidth: MIN_WIDTH,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#F6F8FC',
    title: '에듀톡',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
      // 주의: backgroundThrottling 을 false 로 두면 창을 숨기거나 최소화해도
      // document.hidden 이 false 로 고정되어(웹 알림 조건), 새 메시지 토스트가 뜨지 않습니다.
      // 메시지 수신은 WebSocket(Firestore)이라 타이머 스로틀링과 무관하므로 기본값을 유지합니다.
    }
  };
  if (typeof state.x === 'number' && typeof state.y === 'number') {
    options.x = state.x;
    options.y = state.y;
  }

  mainWindow = new BrowserWindow(options);

  if (state.isMaximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    if (!START_HIDDEN) showWindow();
  });

  mainWindow.on('close', (event) => {
    saveWindowState(mainWindow);
    if (isQuitting) return;
    // 트레이에 상주: 실제 종료는 트레이 메뉴 [종료] 로만
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    reloadScheduled = false;
    clearTimeout(reloadTimer);
    reloadTimer = null;
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // ERR_ABORTED 는 무시
    console.warn(`[edutalk] 로드 실패(${errorCode} ${errorDescription}) ${validatedURL}`);
    if (reloadScheduled) return;
    reloadScheduled = true;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(APP_URL).catch((err) => {
          console.warn('[edutalk] 재시도 실패:', err.message);
        });
      }
    }, RELOAD_DELAY_MS);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.warn('[edutalk] 렌더러 종료:', details && details.reason);
  });

  // 창 안에서 외부 사이트로 이동하는 것은 차단하고 기본 브라우저로 넘깁니다.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Firebase 팝업 로그인은 반드시 앱 안의 창으로 열어야 결과가 앱으로 돌아옵니다.
    if (isFirebaseAuthUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 700,
          autoHideMenuBar: true,
          title: '에듀톡 로그인',
          backgroundColor: '#FFFFFF',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    }
    // 앱 내부 링크는 현재 창에서 이동, 그 외는 외부 브라우저로
    if (isInternalUrl(url)) {
      mainWindow.loadURL(url).catch(() => {});
      return { action: 'deny' };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(APP_URL).catch((err) => {
    console.warn('[edutalk] 초기 페이지 로드 실패:', err.message);
  });

  return mainWindow;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* ---------------------------------------------------------------- 트레이 */

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '열기', click: () => showWindow() },
    {
      label: '새로고침',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
      }
    },
    { type: 'separator' },
    {
      label: '윈도우 시작 시 자동 실행',
      type: 'checkbox',
      checked: isAutoLaunchEnabled(),
      click: (menuItem) => applyAutoLaunch(menuItem.checked)
    },
    {
      label: '시작할 때 창 열기',
      type: 'checkbox',
      checked: readPrefs().showWindowOnStartup,
      click: (menuItem) => applyShowWindowOnStartup(menuItem.checked)
    },
    {
      label: '알림창 위치',
      submenu: NOTIFICATION_POSITIONS.map(([value, label]) => ({
        label,
        type: 'radio',
        checked: readPrefs().notificationPosition === value,
        click: () => {
          writePrefs({ notificationPosition: value });
          refreshTrayMenu();
        }
      }))
    },
    { type: 'separator' },
    { label: '종료', click: () => quitApp() }
  ]);
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  try {
    tray = new Tray(TRAY_ICON_PATH);
  } catch (err) {
    console.warn('[edutalk] 트레이 아이콘 생성 실패:', err.message);
    return;
  }
  tray.setToolTip('에듀톡');
  refreshTrayMenu();
  tray.on('double-click', () => showWindow());
}

function quitApp() {
  isQuitting = true;
  saveWindowState(mainWindow);
  clearTimeout(notifTimer);
  clearTimeout(reloadTimer);
  reloadTimer = null;
  if (notifWindow && !notifWindow.isDestroyed()) notifWindow.destroy();
  if (tray && !tray.isDestroyed()) tray.destroy();
  app.quit();
}

/* ------------------------------------------------------------ 앱 라이프사이클 */

if (!app.requestSingleInstanceLock()) {
  // 이미 실행 중이면 새 창을 띄우지 않고 종료합니다.
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID); // 윈도우 알림 표시에 필수
    nativeTheme.themeSource = 'system'; // 다크모드는 OS 설정을 따름

    setupPermissions();
    setupNotificationIpc();
    registerAutoLaunchOnFirstRun();
    createWindow();
    createTray();

    app.on('activate', () => showWindow());
  });

  app.on('before-quit', () => {
    isQuitting = true;
    saveWindowState(mainWindow);
    clearTimeout(notifTimer);
    clearTimeout(reloadTimer);
    reloadTimer = null;
    if (notifWindow && !notifWindow.isDestroyed()) notifWindow.hide();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
