// BreezeServer Electron 메인 프로세스

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell, screen } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { startServer, app as expressApp } from '../server';
import { getDatabase, closeDatabase } from '../database';
import { Server as SocketIOServer, Socket } from 'socket.io';
import * as http from 'http';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let httpServer: http.Server | null = null;
let io: SocketIOServer | null = null;
let isQuitting = false;

// 연결된 클라이언트 관리
const connectedClients = new Map<string, {
  socketId: string;
  teacherId: string;
  teacherName: string;
  department: string;
  version: string;
  platform: string;
  ipAddress: string;
  lastSeen: string;
}>();

// 시스템 트레이 생성
function createTray(): void {
  const iconPath = join(__dirname, '..', '..', '..', 'resources', 'icons', 'tray-icon.png');
  let icon = nativeImage.createEmpty();

  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // 기본 아이콘 생성 (파란색 원)
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0082C8';
      ctx.beginPath();
      ctx.arc(8, 8, 7, 0, 2 * Math.PI);
      ctx.fill();
    }
    icon = nativeImage.createFromDataURL(canvas.toDataURL());
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '관리자 패널 열기',
      click: () => {
        showMainWindow();
      },
    },
    {
      label: '서버 상태 확인',
      click: () => {
        showMainWindow();
        // 상태 탭으로 이동하는 IPC 전송
        mainWindow?.webContents.send('navigate-to', 'status');
      },
    },
    { type: 'separator' },
    {
      label: '업데이트 배포',
      click: () => {
        showMainWindow();
        mainWindow?.webContents.send('navigate-to', 'updates');
      },
    },
    {
      label: '감사 로그 보기',
      click: () => {
        showMainWindow();
        mainWindow?.webContents.send('navigate-to', 'audit');
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('브리즈서버 - 학교 내부망 메신저 백엔드');
  tray.setContextMenu(contextMenu);

  // 트레이 아이콘 더블클릭으로 창 표시
  tray.on('double-click', () => {
    showMainWindow();
  });
}

// 메인 윈도우 생성
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: '브리즈서버 관리자 패널',
    icon: join(__dirname, '..', '..', '..', 'resources', 'icons', 'icon.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 개발 모드에서는 Vite 서버, 프로덕션에서는 빌드된 파일 로드
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  // 창 닫기 시 숨기기 (시스템 트레이로 최소화)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 준비되면 표시
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
}

// 메인 윈도우 표시
function showMainWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

// Socket.io 초기화
function initializeSocketIO(): void {
  if (!httpServer) return;

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // 클라이언트 인증
    socket.on('authenticate', (data: { token: string; teacherId: string; teacherName: string; department: string; version: string; platform: string }) => {
      const { token, teacherId, teacherName, department, version, platform } = data;

      // 토큰 검증 (실제로는 DB에서 세션 확인)
      // 여기서는 간단히 저장
      connectedClients.set(socket.id, {
        socketId: socket.id,
        teacherId,
        teacherName,
        department,
        version,
        platform,
        ipAddress: socket.handshake.address,
        lastSeen: new Date().toISOString(),
      });

      // 관리자 패널에 실시간 업데이트 전송
      broadcastClientListUpdate();

      socket.emit('authenticated', { success: true });
    });

    // 하트비트
    socket.on('heartbeat', () => {
      const client = connectedClients.get(socket.id);
      if (client) {
        client.lastSeen = new Date().toISOString();
      }
    });

    // 연결 해제
    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
      connectedClients.delete(socket.id);
      broadcastClientListUpdate();
    });
  });
}

// 연결된 클라이언트 목록 브로드캐스트
function broadcastClientListUpdate(): void {
  if (!io) return;

  const clients = Array.from(connectedClients.values()).map(c => ({
    id: c.socketId,
    teacherId: c.teacherId,
    teacherName: c.teacherName,
    department: c.department,
    version: c.version,
    platform: c.platform,
    ipAddress: c.ipAddress,
    lastSeen: c.lastSeen,
    status: 'online' as const,
  }));

  io.emit('clients-updated', clients);
}

// 업데이트 알림 푸시 (관리자 패널에서 호출)
ipcMain.handle('push-update-notification', async (_, data: { versionId: string; targetType: string; targetIds?: string[] }) => {
  if (!io) return { success: false, error: 'Socket.io not initialized' };

  const db = getDatabase();
  const version = db.prepare('SELECT * FROM client_versions WHERE id = ? AND is_active = 1').get(data.versionId) as any;

  if (!version) {
    return { success: false, error: 'Version not found' };
  }

  let targetSockets: Socket[] = [];

  if (data.targetType === 'online') {
    // 모든 온라인 클라이언트에게 전송
    targetSockets = Array.from(io.sockets.sockets.values());
  } else if (data.targetType === 'specific' && data.targetIds) {
    // 특정 클라이언트에게 전송
    for (const targetId of data.targetIds) {
      const socket = io.sockets.sockets.get(targetId);
      if (socket) targetSockets.push(socket);
    }
  }

  const notification = {
    type: 'update_available' as const,
    version: version.version,
    releaseNotes: version.release_notes,
    downloadUrl: version.download_url,
    mandatory: version.mandatory === 1,
  };

  for (const socket of targetSockets) {
    socket.emit('ota-notification', notification);
  }

  // 배포 상태 업데이트
  db.prepare('UPDATE update_deployments SET successful_count = ?, status = ? WHERE id = ?').run(
    targetSockets.length,
    'completed',
    data.versionId // 실제로는 deploymentId 필요
  );

  return { success: true, sentCount: targetSockets.length };
});

// IPC 핸들러: 창 제어
ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow?.hide();
});

ipcMain.handle('get-connected-clients', () => {
  return Array.from(connectedClients.values());
});

// 앱 초기화
async function initializeApp(): Promise<void> {
  // 단일 인스턴스 보장
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    showMainWindow();
  });

  // 데이터베이스 초기화
  getDatabase();

  // Express 서버 시작
  await startServer();

  // HTTP 서버 생성 (Socket.io용)
  httpServer = http.createServer(expressApp);
  httpServer.listen(38766, '0.0.0.0', () => {
    console.log(`[BreezeServer] Socket.io server started on port 38766`);
  });

  // Socket.io 초기화
  initializeSocketIO();

  // 시스템 트레이 생성
  createTray();

  // 메인 윈도우 생성 (초기에는 숨김)
  createMainWindow();

  // 앱 종료 시 정리
  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('will-quit', () => {
    if (io) io.close();
    if (httpServer) httpServer.close();
    closeDatabase();
  });
}

// 앱 준비 시 초기화
app.whenReady().then(initializeApp).catch(console.error);

// 모든 창 닫힘 시 종료하지 않음 (트레이에서 실행)
app.on('window-all-closed', (event) => {
  event.preventDefault();
});

// macOS에서 활성화 시 창 표시
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});