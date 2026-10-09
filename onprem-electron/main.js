'use strict';
/**
 * 브리즈 학내망 서버 GUI — Electron 메인 프로세스
 *
 * - 검은 CMD 창 없음: 백엔드(server.js)를 windowsHide/fork 자식으로 띄움
 * - X 버튼 → 종료가 아니라 트레이로 최소화, 백그라운드 계속 실행
 * - 트레이 우클릭: [열기 / 관리자 페이지 열기 / 종료]
 * - 백엔드 죽으면 3초 뒤 자동 재시작 (Auto-restart)
 * - 부팅 자동실행: 첫 실행 시 로그인 항목 등록 (services.msc 방식이 필요하면 onprem/service:install 병행)
 */
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork } = require('child_process');

const PORT = Number(process.env.EDUTALK_PORT || 3000);
const START_HIDDEN = process.argv.includes('--hidden');
const APP_ID = 'com.edutalk.server';

let mainWindow = null;
let tray = null;
let isQuitting = false;
let backend = null;
let backendStatus = 'starting'; // starting | running | stopped
let restartTimer = null;
let restartCount = 0;

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_PATH = path.join(__dirname, 'assets', 'tray.png');

/* ---------- 경로 ---------- */
function userHome() {
  const p = path.join(app.getPath('userData'), 'server-home');
  try { fs.mkdirSync(p, { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(path.join(p, 'logs'), { recursive: true }); } catch (e) {}
  return p;
}
function resolveServerScript() {
  if (process.env.EDUTALK_SERVER_SCRIPT && fs.existsSync(process.env.EDUTALK_SERVER_SCRIPT)) {
    return process.env.EDUTALK_SERVER_SCRIPT;
  }
  const candidates = [
    path.join(__dirname, '..', 'onprem', 'server.js'), // 개발 실행
    path.join(process.resourcesPath || '', 'onprem', 'server.js'), // 패키징 extraResources
    path.join(__dirname, 'onprem', 'server.js'),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch (e) {}
  }
  return null;
}
function backendEnv(script) {
  const env = { ...process.env, EDUTALK_RUN_AS_SERVICE: '1', EDUTALK_PORT: String(PORT) };
  if (app.isPackaged) env.EDUTALK_HOME = userHome();
  // server.js가 onprem 폴더 기준 상대경로(admin.html 등)를 쓰므로 cwd를 맞춰준다
  return env;
}

/* ---------- 백엔드 ---------- */
function backendLog(...args) {
  try {
    const home = app.isPackaged ? userHome() : path.dirname(resolveServerScript() || __dirname);
    const dir = path.join(home, 'logs');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    const d = new Date();
    const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.log`;
    fs.appendFileSync(path.join(dir, name), `[gui] ` + args.join(' ') + '\n');
  } catch (e) {}
}

function startBackend() {
  if (isQuitting) return;
  const script = resolveServerScript();
  if (!script) {
    backendStatus = 'stopped';
    backendLog('server.js를 찾지 못했어요.');
    pushStatus();
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('브리즈 서버', 'server.js를 찾지 못했어요.\nGUI와 onprem 폴더를 함께 설치해 주세요.');
    }
    return;
  }
  clearTimeout(restartTimer);
  backendStatus = 'starting';
  pushStatus();
  try {
    backend = fork(script, ['--service'], {
      env: backendEnv(script),
      cwd: path.dirname(script),
      silent: true,
      windowsHide: true,
    });
    backendLog(`backend start pid=${backend.pid} script=${script}`);
    if (backend.stdout) backend.stdout.on('data', (d) => backendLog(String(d).trim()));
    if (backend.stderr) backend.stderr.on('data', (d) => backendLog('[stderr] ' + String(d).trim()));
    backend.on('spawn', () => {
      backendStatus = 'running';
      restartCount = 0;
      pushStatus();
      refreshTray();
    });
    backend.on('exit', (code, signal) => {
      backendLog(`backend exit code=${code} signal=${signal}`);
      backend = null;
      if (isQuitting) return;
      backendStatus = 'stopped';
      pushStatus();
      refreshTray();
      // 자동 재시작 (3초 뒤)
      restartCount += 1;
      const delay = Math.min(30000, 3000 * Math.min(restartCount, 5));
      clearTimeout(restartTimer);
      restartTimer = setTimeout(startBackend, delay);
    });
    backend.on('error', (e) => {
      backendLog('backend error ' + ((e && e.message) || e));
    });
  } catch (e) {
    backendStatus = 'stopped';
    backendLog('backend spawn 실패 ' + ((e && e.message) || e));
    pushStatus();
    clearTimeout(restartTimer);
    restartTimer = setTimeout(startBackend, 5000);
  }
}
function stopBackend() {
  clearTimeout(restartTimer);
  return new Promise((resolve) => {
    if (!backend || backend.killed) return resolve();
    try {
      backend.send('shutdown');
    } catch (e) {}
    const killer = setTimeout(() => { try { backend.kill(); } catch (e) {} resolve(); }, 5000);
    try {
      backend.once('exit', () => { clearTimeout(killer); resolve(); });
    } catch (e) { clearTimeout(killer); resolve(); }
  });
}

/* ---------- 상태 조회 (렌더러용) ---------- */
function lanIPs() {
  const out = [];
  try {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const ni of ifs[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) out.push({ iface: name, address: ni.address });
      }
    }
  } catch (e) {}
  return out;
}
async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 2500);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function collectStatus() {
  const base = `http://127.0.0.1:${PORT}`;
  const ips = lanIPs();
  const primary = (ips.find((x) => String(x.address).startsWith('192.168.')) || ips[0] || {}).address || 'localhost';
  const lanUrl = `http://${primary}:${PORT}`;
  const adminUrl = `http://localhost:${PORT}/admin`;
  const status = {
    backend: backendStatus,
    running: backendStatus === 'running',
    port: PORT,
    lanUrl,
    adminUrl,
    ips,
    school: '',
    license: null,
    setupDone: null,
    checkedAt: new Date().toISOString(),
  };
  // running이어도 HTTP가 안 뜨면 starting으로 취급 (부팅 직후)
  if (backendStatus === 'running' || backendStatus === 'starting') {
    let setupMode = '';
    try {
      const st = await fetchJson(base + '/api/setup-state', 2500);
      if (st && st.ok !== undefined) {
        status.setupDone = !!st.done;
        if (st.license) { status.setupLicense = st.license; setupMode = String(st.license); }
      }
    } catch (e) {}
    try {
      const pub = await fetchJson(base + '/api/public-info', 2500);
      if (pub && pub.ok) {
        status.license = { daysLeft: null, message: '', dual: !!pub.dual, school: pub.school || '' };
        status.school = pub.school || '';
        if (backendStatus === 'starting') { backendStatus = 'running'; status.running = true; }
      } else if (setupMode) {
        // 초기 설정 전에는 public-info가 503 → setup-state 모드로 대체 표기
        status.license = {
          dual: false, school: '',
          message: setupMode === 'trial' ? '무료 체험 진행 중 (관리자 설정 필요)' : `라이선스 상태: ${setupMode}`,
        };
        if (backendStatus === 'starting') { backendStatus = 'running'; status.running = true; }
      }
    } catch (e) {
      if (setupMode) {
        status.license = {
          dual: false, school: '',
          message: setupMode === 'trial' ? '무료 체험 진행 중 (관리자 설정 필요)' : `라이선스 상태: ${setupMode}`,
        };
        if (backendStatus === 'starting') { backendStatus = 'running'; status.running = true; }
      }
    }
    // 라이선스 상세 (관리자 토큰 없이 public-info만으로 표기, 만료일은 setup-state에 없음 → 메시지로 대체)
    try {
      const net = await fetchJson(base + '/api/network-info', 2500);
      if (net && net.ok && Array.isArray(net.serverIps) && net.serverIps.length) {
        status.ips = net.serverIps;
        const p2 = (net.serverIps.find((x) => String(x.address).startsWith('192.168.')) || net.serverIps[0] || {}).address;
        if (p2) status.lanUrl = `http://${p2}:${PORT}`;
      }
    } catch (e) {}
  } else {
    status.running = false;
  }
  status.backend = backendStatus;
  status.running = backendStatus === 'running';
  // 라이선스 텍스트 보강: admin API는 토큰 필요라 GUI에서는 public-info + 로컬 파일로 추정
  return status;
}
function pushStatus() {
  collectStatus().then((s) => {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('edutalk:status', s); } catch (e) {}
    try { if (tray && !tray.isDestroyed()) tray.setToolTip(s.running ? `브리즈 서버 작동 중 (${s.lanUrl})` : '브리즈 서버 중지됨'); } catch (e) {}
  }).catch(() => {});
}

/* ---------- 창/트레이 ---------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 480,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#FFFFFF',
    title: '브리즈 서버',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch(() => {});
  mainWindow.once('ready-to-show', () => {
    if (!START_HIDDEN) mainWindow.show();
  });
  // X → 종료가 아니라 트레이로 숨김 (상주형 메신저 표준 동작)
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
}
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '열기', click: () => showWindow() },
    { label: '관리자 페이지 열기', click: () => { shell.openExternal(`http://localhost:${PORT}/admin`).catch(() => {}); } },
    { type: 'separator' },
    {
      label: '윈도우 시작 시 자동 실행',
      type: 'checkbox',
      checked: isAutoLaunch(),
      click: (mi) => applyAutoLaunch(mi.checked),
    },
    { type: 'separator' },
    { label: backendStatus === 'running' ? '서버 실행 중' : '서버 중지됨', enabled: false },
    {
      label: '서버 종료', click: async () => {
        isQuitting = true;
        clearTimeout(restartTimer);
        await stopBackend();
        if (tray && !tray.isDestroyed()) tray.destroy();
        app.quit();
      },
    },
  ]);
}
function createTray() {
  try {
    const p = fs.existsSync(TRAY_PATH) ? TRAY_PATH : ICON_PATH;
    tray = new Tray(p);
  } catch (e) { return; }
  tray.setToolTip('브리즈 서버');
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => showWindow());
}

/* ---------- 자동실행 (로그인 시) ---------- */
function loginOpts(on) {
  const o = { openAtLogin: on };
  if (process.platform === 'win32') {
    o.path = process.execPath;
    const args = [];
    if (!app.isPackaged) args.unshift(app.getAppPath());
    args.push('--hidden');
    o.args = args;
  }
  return o;
}
function isAutoLaunch() {
  try { return app.getLoginItemSettings(loginOpts(true)).openAtLogin === true; } catch (e) { return false; }
}
function applyAutoLaunch(on) {
  try { app.setLoginItemSettings(loginOpts(on)); } catch (e) {}
  refreshTray();
}
function registerAutoLaunchOnce() {
  const flag = path.join(app.getPath('userData'), 'login-item-registered');
  if (fs.existsSync(flag)) return;
  try {
    app.setLoginItemSettings(loginOpts(true));
    fs.writeFileSync(flag, new Date().toISOString(), 'utf8');
  } catch (e) {}
}

/* ---------- IPC ---------- */
function setupIpc() {
  ipcMain.handle('edutalk:get-status', async () => collectStatus());
  ipcMain.handle('edutalk:open-admin', async () => {
    await shell.openExternal(`http://localhost:${PORT}/admin`).catch(() => {});
    return true;
  });
  ipcMain.handle('edutalk:copy', async (_e, text) => {
    try { clipboard.writeText(String(text || '')); return true; } catch (e) { return false; }
  });
  ipcMain.handle('edutalk:restart-server', async () => {
    try { if (backend) backend.kill(); } catch (e) {}
    backendStatus = 'stopped';
    pushStatus();
    clearTimeout(restartTimer);
    restartTimer = setTimeout(startBackend, 1000);
    return true;
  });
  ipcMain.handle('edutalk:show', async () => { showWindow(); return true; });
}

/* ---------- 라이프사이클 ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(() => {
    try { app.setAppUserModelId(APP_ID); } catch (e) {}
    setupIpc();
    registerAutoLaunchOnce();
    createWindow();
    createTray();
    startBackend();
    // 3초마다 상태 푸시 (뱃지 갱신용)
    setInterval(pushStatus, 3000);
    setTimeout(pushStatus, 1500);
    app.on('activate', () => showWindow());
  });
  app.on('before-quit', () => { isQuitting = true; });
  app.on('window-all-closed', () => {
    // 트레이 상주이므로 창을 다 닫아도 종료하지 않음 (macOS와 동일 정책, Windows에서도 유지)
  });
  process.on('SIGINT', async () => { isQuitting = true; await stopBackend(); app.quit(); });
  process.on('SIGTERM', async () => { isQuitting = true; await stopBackend(); app.quit(); });
}
