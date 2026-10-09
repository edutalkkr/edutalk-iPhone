'use strict';
/* 브리즈 학내망 서버 Windows 서비스 해제
 * 실행: 관리자 권한 터미널에서 `npm run service:uninstall` 또는 `node uninstall-service.js`
 */
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVICE_NAME = 'BreezeServer';
const SCRIPT_PATH = path.join(__dirname, 'server.js');

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
async function uninstallViaNodeWindows() {
  try {
    const { Service } = require('node-windows');
    const svc = new Service({ name: SERVICE_NAME, script: SCRIPT_PATH });
    return await new Promise((resolve) => {
      let done = false;
      const finish = (msg) => { if (!done) { done = true; console.log(msg); resolve(true); } };
      svc.on('uninstall', () => finish('서비스 삭제됨 (node-windows)'));
      svc.on('error', () => finish('node-windows 해제 중 오류 (sc로 계속 진행)'));
      try { svc.uninstall(); } catch (e) { finish('node-windows 호출 실패 (sc로 계속 진행)'); }
      setTimeout(() => finish('시간 초과 (sc로 계속 진행)'), 15000);
    });
  } catch (e) {
    console.log('node-windows 없음 → sc로 해제합니다.');
    return true;
  }
}
async function main() {
  if (process.platform !== 'win32') { console.error('Windows에서만 실행할 수 있어요.'); process.exit(1); }
  if (!(await isAdmin())) { console.error('관리자 권한으로 실행해 주세요. (우클릭 → 관리자 권한으로 실행)'); process.exit(1); }
  await uninstallViaNodeWindows();
  // NSSM 잔재 정리 (있으면)
  try {
    const n = await execf('nssm', ['stop', SERVICE_NAME]);
    if (n.ok) console.log('NSSM 서비스 중지됨');
  } catch (e) {}
  try {
    const n = await execf('nssm', ['remove', SERVICE_NAME, 'confirm']);
    if (n.ok) console.log('NSSM 등록 삭제됨');
  } catch (e) {}
  let r = await execf('sc', ['stop', SERVICE_NAME]);
  console.log(r.ok ? '서비스 중지됨' : '중지 결과: ' + r.out.trim().split('\n').pop());
  // 잠시 대기 후 삭제 (STOP_PENDING 방지)
  await new Promise((res) => setTimeout(res, 2000));
  r = await execf('sc', ['delete', SERVICE_NAME]);
  console.log(r.ok ? '서비스 삭제됨' : '삭제 결과: ' + r.out.trim().split('\n').pop());
  // 방화벽 규칙 정리 (실패해도 무시)
  try { await execf('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=Breeze Server']); } catch (e) {}
  try { await execf('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=Breeze Server Port']); } catch (e) {}
  try { await execf('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=Breeze Server Exe']); } catch (e) {}
}
main().catch((e) => { console.error(e); process.exit(1); });
