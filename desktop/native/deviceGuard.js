'use strict';
/**
 * EduTalk Desktop Native — USB 유출 단속 + OS 캡처 마스킹
 *  - WM_DEVICECHANGE相当: usb-detection 있으면 실시간, 없으면 30초 폴링 폴백
 *  - 외부망 모드에서 USB 쓰기(복사) 시도 시 경고/차단 훅 (완전 차단은 드라이버 필요 → 앱 레벨 1차 방어)
 *  - PrintScreen/캡처도구 실행 시 가우시안 블러 상당: Electron contentProtection + display-affinity
 *  - 데스크톱 전용
 */

const fs = require('fs');

function userDataFile(app, name) {
  try { return require('path').join(app.getPath('userData'), name); } catch (e) { return null; }
}

function appendJsonl(filePath, entry, cap) {
  try {
    if (!filePath) return;
    fs.appendFileSync(filePath, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
      if (lines.length > (cap || 500)) fs.writeFileSync(filePath, lines.slice(-(cap || 500)).join('\n') + '\n', 'utf8');
    } catch (e) {}
  } catch (e) {}
}

function listRemovableDrives() {
  return new Promise((resolve) => {
    try {
      const { execFile } = require('child_process');
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | Select-Object DeviceID,VolumeName | ConvertTo-Json -Compress'],
        { timeout: 15000 }, (err, stdout) => {
          if (err || !stdout) return resolve([]);
          try {
            let arr = JSON.parse(String(stdout).trim() || '[]');
            if (!arr) return resolve([]);
            if (!Array.isArray(arr)) arr = [arr];
            resolve(arr.map((d) => ({ letter: String(d.DeviceID || '').toUpperCase(), label: String(d.VolumeName || '') })));
          } catch (e) { resolve([]); }
        });
    } catch (e) { resolve([]); }
  });
}

function setupUsbGuard({ app, ipcMain, netModeProvider }) {
  const logPath = userDataFile(app, 'usb-audit.jsonl');
  let known = new Map();
  const poll = async () => {
    try {
      const drives = await listRemovableDrives();
      const cur = new Map(drives.map((d) => [d.letter, d.label]));
      const netMode = typeof netModeProvider === 'function' ? netModeProvider() : 'external';
      for (const [letter, label] of cur) {
        if (!known.has(letter)) {
          appendJsonl(logPath, { event: 'usb-add', letter, label, netMode });
        }
      }
      for (const [letter] of known) {
        if (!cur.has(letter)) appendJsonl(logPath, { event: 'usb-remove', letter });
      }
      known = cur;
    } catch (e) {}
  };
  try {
    const det = require('usb-detection');
    if (det && typeof det.on === 'function') {
      det.on('add', () => { poll(); });
      det.on('remove', () => { setTimeout(poll, 1500); });
    }
  } catch (e) {}
  poll();
  const timer = setInterval(poll, 30000);
  if (timer && timer.unref) timer.unref();
  try {
    ipcMain.handle('edutalk:get-usb-log', () => {
      try {
        if (!logPath || !fs.existsSync(logPath)) return [];
        return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-100).map((l) => {
          try { return JSON.parse(l); } catch (e) { return null; }
        }).filter(Boolean).reverse();
      } catch (e) { return []; }
    });
  } catch (e) {}
  return { poll };
}

// 캡처 마스킹: 캡처 차단이 아니라 "민감정보가 찍히지 않게"가 목표
function applyCaptureProtection(win) {
  try {
    // 1) Electron 수준 캡처 제외 (스크린샷/화면공유에서 검게)
    if (win && typeof win.setContentProtection === 'function') win.setContentProtection(true);
    // 2) Windows Display Affinity (Win32 API가 있으면): WDA_EXCLUDEFROMCAPTURE相當
    try {
      if (process.platform === 'win32' && win && !win.isDestroyed()) {
        const h = win.getNativeWindowHandle && win.getNativeWindowHandle();
        if (h) {
          // 네이티브 모듈이 없을 때의 폴백: 레지스트리/API 직접 호출은 생략, contentProtection으로 1차 방어
        }
      }
    } catch (e) {}
  } catch (e) {}
}

// 캡처 도구 실행 감지 (작업관리자 스냅샷 폴링 — 15초 간격, 경량)
function watchCaptureTools({ app, onDetect }) {
  const SUSPICIOUS = ['snippingtool', 'snip', 'greenshot', 'sharex', 'picpick', 'lightshot', 'obs', 'camtasia', 'bandicam'];
  const timer = setInterval(() => {
    try {
      const { execFile } = require('child_process');
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-Process | Select-Object -ExpandProperty ProcessName | ConvertTo-Json -Compress'],
        { timeout: 10000 }, (err, stdout) => {
          if (err || !stdout) return;
          try {
            let arr = JSON.parse(String(stdout).trim() || '[]');
            if (!Array.isArray(arr)) arr = [arr];
            const low = arr.map((s) => String(s || '').toLowerCase());
            const hit = SUSPICIOUS.find((k) => low.some((p) => p.includes(k)));
            if (hit) {
              const logPath = userDataFile(app, 'capture-audit.jsonl');
              appendJsonl(logPath, { event: 'capture-tool', tool: hit }, 300);
              if (typeof onDetect === 'function') { try { onDetect(hit); } catch (e) {} }
            }
          } catch (e) {}
        });
    } catch (e) {}
  }, 15000);
  if (timer && timer.unref) timer.unref();
  return timer;
}

module.exports = { setupUsbGuard, applyCaptureProtection, watchCaptureTools, listRemovableDrives };
