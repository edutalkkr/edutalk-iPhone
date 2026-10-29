/* Firebase Hosting 배포용 사이트 묶음.
 *  · public/         → /breeze/      (브리즈 웹)
 *  · breezecore-site → /breezecore/  (브리즈코어 소개·관리자)
 *  · public/firebase-config.js가 있으면 breezecore에도 복사해 관리자 로그인을 켠다.
 * 생성 폴더(hosting-dist)는 .gitignore에 있어 저장소를 더럽히지 않는다. */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "hosting-dist");
const publicDir = path.join(root, "public");
const coreDir = path.join(root, "breezecore-site");

if (!fs.existsSync(publicDir) || !fs.existsSync(coreDir)) {
  console.error("public/ 또는 breezecore-site/ 폴더를 찾지 못했어요.");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(publicDir, path.join(out, "breeze"), { recursive: true });
fs.cpSync(coreDir, path.join(out, "breezecore"), { recursive: true });

const firebaseConfig = path.join(publicDir, "firebase-config.js");
const coreConfig = path.join(out, "breezecore", "firebase-config.js");
if (fs.existsSync(firebaseConfig)) {
  fs.copyFileSync(firebaseConfig, coreConfig);
  console.log("✓ breezecore/firebase-config.js 연결");
} else {
  fs.rmSync(coreConfig, { force: true });
  console.warn("! public/firebase-config.js가 없어 관리자 저장은 기본값으로 동작해요.");
}

console.log("✓ hosting-dist 준비 완료 (/breeze/ + /breezecore/)");
