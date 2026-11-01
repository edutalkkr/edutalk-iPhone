/* 학교 배포용 서버 키트를 만든다.
 * 1) onprem/dist/breeze-server.exe + deploy-kit 파일을 한 폴더로 모으고
 * 2) 민감 파일(license.*, data/, logs/, uploads/, .env)은 절대 넣지 않으며
 * 3) zip으로 묶는다.
 *
 * 실행: npm run kit:server   (또는 node scripts/build-server-kit.mjs)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const onprem = path.join(root, "onprem");
const kitSrc = path.join(onprem, "deploy-kit");
const exe = path.join(onprem, "dist", "breeze-server.exe");
const outRoot = path.join(onprem, "dist");
const folderName = "BreezeServer-win-x64";
const outDir = path.join(outRoot, folderName);
const zipPath = path.join(outRoot, `${folderName}.zip`);

if (!fs.existsSync(exe)) {
  console.error("✕ onprem/dist/breeze-server.exe 가 없어요. 먼저 npm run pkg:win 을 실행해 주세요.");
  process.exit(1);
}
if (!fs.existsSync(kitSrc)) {
  console.error("✕ onprem/deploy-kit 폴더가 없어요.");
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// exe 복사
fs.copyFileSync(exe, path.join(outDir, "breeze-server.exe"));

// 배포 문서·스크립트 복사 (.ps1은 Windows PowerShell 5.1에서 한글이 깨지지 않게 BOM 추가)
const files = fs.readdirSync(kitSrc);
for (const name of files) {
  const src = path.join(kitSrc, name);
  if (!fs.statSync(src).isFile()) continue;
  if (/^(license|\.env)/i.test(name)) continue; // 안전장치
  let buf = fs.readFileSync(src);
  if (name.endsWith(".ps1") && !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)) {
    buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf]);
  }
  fs.writeFileSync(path.join(outDir, name), buf);
}

// 민감 파일이 섞이지 않았는지 최종 확인
const forbidden = ["license.key", "license.secret", "license-vendor-private.key", ".env"];
const leaked = fs.readdirSync(outDir).filter((n) => forbidden.includes(n.toLowerCase()));
if (leaked.length) {
  console.error("✕ 민감 파일이 키트에 포함됐어요: " + leaked.join(", "));
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}
for (const dir of ["data", "logs", "uploads"]) {
  if (fs.existsSync(path.join(outDir, dir))) {
    console.error(`✕ ${dir}/ 폴더가 키트에 포함됐어요.`);
    process.exit(1);
  }
}

// zip 만들기 (zip 명령 → PowerShell 순서로 시도)
let zipped = false;
try {
  fs.rmSync(zipPath, { force: true });
  execFileSync("zip", ["-rq", zipPath, folderName], { cwd: outRoot, stdio: "ignore" });
  zipped = true;
} catch (e) {
  try {
    fs.rmSync(zipPath, { force: true });
    const winOut = outRoot.replace(/^\/mnt\/([a-z])\//i, (m, d) => `${d.toUpperCase()}:\\`).replace(/\//g, "\\");
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Compress-Archive -LiteralPath '${winOut}\\${folderName}' -DestinationPath '${winOut}\\${folderName}.zip' -Force`],
      { stdio: "ignore" }
    );
    zipped = true;
  } catch (e2) {}
}

const exeHash = crypto.createHash("sha256").update(fs.readFileSync(exe)).digest("hex");
const filesOut = fs.readdirSync(outDir);
console.log("✓ 배포 키트 준비 완료");
console.log("  폴더 : " + path.relative(root, outDir));
console.log("  파일 : " + filesOut.length + "개");
console.log("  exe  : " + (fs.statSync(exe).size / 1024 / 1024).toFixed(1) + " MB");
console.log("  SHA-256 : " + exeHash);
if (zipped) {
  console.log("  ZIP  : " + path.relative(root, zipPath) + " (" + (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1) + " MB)");
} else {
  console.log("  ZIP  : 자동 생성 실패 — 폴더를 직접 압축해 주세요.");
}
console.log("");
console.log("  포함 파일:");
for (const f of filesOut.sort()) console.log("   - " + f);
