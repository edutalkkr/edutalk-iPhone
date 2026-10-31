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

// 사이트가 /breeze/·/breezecore/ 하위 경로에서 서빙되므로 상대 경로가 루트로 풀리지 않게
// 생성본에만 <base>를 넣는다 (public/ 원본은 Capacitor 네이티브가 그대로 쓰므로 건드리지 않는다).
function injectBase(dir, baseHref) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
  for (const file of files) {
    const filePath = path.join(dir, file);
    let html = fs.readFileSync(filePath, "utf8");
    const baseTag = `<base href="${baseHref}">`;
    if (html.includes(baseTag)) continue;
    // 이미 <base>가 있으면 그대로 둔다
    if (/<base\b/i.test(html)) continue;
    const headMatch = html.match(/<head[^>]*>/i);
    if (!headMatch) continue;
    const insertAt = headMatch.index + headMatch[0].length;
    html = html.slice(0, insertAt) + "\n  " + baseTag + html.slice(insertAt);
    fs.writeFileSync(filePath, html);
  }
}
injectBase(path.join(out, "breeze"), "/breeze/");
injectBase(path.join(out, "breezecore"), "/breezecore/");

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
