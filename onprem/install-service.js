'use strict';
/* 브리즈 학내망 서버를 Windows 서비스로 등록 (검은 창 없이 백그라운드 실행)
 *
 * 실행: 관리자 권한 터미널에서
 *   cd onprem
 *   npm install        (node-windows 포함)
 *   npm run service:install
 *   또는: node install-service.js
 *
 * 동작:
 *  - node-windows 래퍼로 등록 → 부팅 시 로그인 없이 자동 실행 (start= auto)
 *  - 죽으면 래퍼가 즉시 재시작 + SCM(sc failure)도 1분 뒤 재시작 ×3 (이중 안전망)
 *  - 방화벽 인바운드 허용 규칙도 함께 등록
 *  - server.js는 --service pun 아니라 env EDUTALK_RUN_AS_SERVICE=1 로 서비스 모드 감지
 *    → 파일 로그(logs/YYYY-MM-DD.log), 빠른 비정상종료(재시작 유도), SIGTERM 정리
 *
 * exe만 있는 PC(Node 없음): node install-service.js "C:\\Breeze\\breeze-server.exe"
 *  → NSSM이 있으면 NSSM으로, 없으면 sc create로 등록 (sc 단독은 1053 오류 가능 → NSSM 권장)
 */
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVICE_NAME = 'BreezeServer';
const DISPLAY_NAME = 'BreezeServer';
const DISPLAY_DESC = '브리즈 학교 내부망 메신저 서버 (부팅 시 자동 실행)';
const SCRIPT_PATH = path.join(__dirname, 'server.js');
const PORT = process.env.EDUTALK_PORT || '3000';

function execf(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') });
    });
  });
}
async function isAdmin() {
  const r = await execf('net', ['session']);
  return r.ok;
}
function findExeArg() {
  const arg = process.argv[2];
  if (arg && fs.existsSync(arg)) return path.resolve(arg);
  if (process.env.EDUTALK_EXE && fs.existsSync(process.env.EDUTALK_EXE)) return process.env.EDUTALK_EXE;
  return null;
}
async function setFailureAndFirewall(exeOrNode, extraProgram) {
  // OS 레벨 자동 재시작: 죽으면 1분 뒤 재시작 ×3, 24시간마다 카운터 리셋
  const f = await execf('sc', ['failure', SERVICE_NAME, 'reset=', '86400', 'actions=', 'restart/60000/restart/60000/restart/60000']);
  console.log(f.ok ? '자동 재시작 설정됨 (죽으면 1분 뒤 재시작 ×3)' : '재시작 설정 결과: ' + f.out.trim().split('\n').pop());
  // 방화벽 허용 (node.exe + 서버 포트)
  try {
    const fw1 = await execf('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=Breeze Server', 'dir=in', 'action=allow', `program=${exeOrNode}`, 'enable=yes']);
    console.log(fw1.ok ? '방화벽 허용됨 (프로그램)' : '방화벽 결과: ' + fw1.out.trim().split('\n').pop());
  } catch (e) {}
  try {
    const fw2 = await execf('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=Breeze Server Port', 'dir=in', 'action=allow', 'protocol=TCP', `localport=${PORT}`, 'enable=yes']);
    if (fw2.ok) console.log(`방화벽 허용됨 (TCP ${PORT})`);
  } catch (e) {}
  if (extraProgram && extraProgram !== exeOrNode && fs.existsSync(extraProgram)) {
    try { await execf('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=Breeze Server Exe', 'dir=in', 'action=allow', `program=${extraProgram}`, 'enable=yes']); } catch (e) {}
  }
}

async function installViaNodeWindows() {
  let Service;
  try {
    Service = require('node-windows').Service;
  } catch (e) {
    console.error('node-windows가 없어요. 먼저 실행: npm install');
    process.exit(1);
  }
  const svc = new Service({
    name: SERVICE_NAME,
    description: DISPLAY_DESC,
    script: SCRIPT_PATH,
    workingDirectory: __dirname,
    nodeOptions: ['--max-old-space-size=512'],
    env: [
      { name: 'EDUTALK_RUN_AS_SERVICE', value: '1' },
      { name: 'EDUTALK_PORT', value: String(PORT) },
    ],
  });
  svc.on('install', async () => {
    console.log('서비스 등록됨 (node-windows 래퍼)');
    try {
      // 래퍼 exe 경로를 방화벽에 허용 + failure 설정
      await setFailureAndFirewall(process.execPath, null);
    } catch (e) {}
    svc.start();
  });
  svc.on('alreadyinstalled', () => {
    console.log('이미 등록되어 있어요. 시작을 시도합니다.');
    try { svc.start(); } catch (e) {}
  });
  svc.on('start', () => {
    console.log('서비스 시작됨. 이제 검은 창 없이 백그라운드에서 돕니다.');
    console.log('확인: services.msc → BreezeServer / 로그: onprem/logs/');
  });
  svc.on('error', (e) => {
    console.error('서비스 오류:', (e && e.message) || e);
  });
  svc.install();
}

async function installViaExe(exePath) {
  console.log('exe 모드:', exePath);
  // NSSM이 있으면 NSSM 우선 (일반 exe를 진짜 서비스로 감싸줌, 1053 오류 없음)
  const nssm = await execf('nssm', ['version']);
  if (nssm.ok) {
    console.log('NSSM으로 등록합니다.');
    const steps = [
      ['install', SERVICE_NAME, exePath],
      ['set', SERVICE_NAME, 'DisplayName', DISPLAY_NAME + ' (에듀톡 학내망 서버)'],
      ['set', SERVICE_NAME, 'Description', DISPLAY_DESC],
      ['set', SERVICE_NAME, 'Start', 'SERVICE_AUTO_START'],
      ['set', SERVICE_NAME, 'AppEnvironmentExtra', `EDUTALK_RUN_AS_SERVICE=1`],
      ['set', SERVICE_NAME, 'AppRestartDelay', '60000'],
    ];
    for (const a of steps) {
      const r = await execf('nssm', a);
      if (!r.ok) console.log('NSSM 결과:', r.out.trim().split('\n').pop());
    }
    await setFailureAndFirewall(exePath, null);
    const s = await execf('sc', ['start', SERVICE_NAME]);
    console.log(s.ok ? '서비스 시작됨 (NSSM).' : '시작 결과: ' + s.out.trim().split('\n').pop());
    return;
  }
  // 폴백: sc create (plain exe는 1053 오류가 날 수 있음 → NSSM 설치 권장 안내)
  console.log('NSSM이 없어 sc로 등록합니다. 1053 오류가 나면 NSSM(nssm.cc) 설치 후 다시 실행하세요.');
  let r = await execf('sc', ['create', SERVICE_NAME, 'binPath=', `"${exePath}"`, 'DisplayName=', DISPLAY_NAME + ' (에듀톡 학내망 서버)', 'start=', 'auto']);
  console.log(r.ok ? '서비스 등록됨' : '등록 결과: ' + r.out.trim().split('\n').pop());
  await execf('sc', ['description', SERVICE_NAME, DISPLAY_DESC]);
  await setFailureAndFirewall(exePath, null);
  r = await execf('sc', ['start', SERVICE_NAME]);
  console.log(r.ok ? '서비스 시작됨.' : '시작 결과: ' + r.out.trim().split('\n').pop());
}

async function main() {
  if (process.platform !== 'win32') { console.error('Windows에서만 실행할 수 있어요.'); process.exit(1); }
  if (!(await isAdmin())) { console.error('관리자 권한으로 실행해 주세요. (우클릭 → 관리자 권한으로 실행)'); process.exit(1); }
  const exeArg = findExeArg();
  if (exeArg) { await installViaExe(exeArg); return; }
  if (!fs.existsSync(SCRIPT_PATH)) { console.error('server.js를 찾지 못했어요.'); process.exit(1); }
  console.log('server.js 모드:', SCRIPT_PATH);
  await installViaNodeWindows();
}
main().catch((e) => { console.error(e); process.exit(1); });
