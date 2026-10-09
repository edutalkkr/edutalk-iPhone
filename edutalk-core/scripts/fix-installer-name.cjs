'use strict';
// 빌드 후 NSIS 파일명을 ASCII로 고정한다.
// productName이 한글이라 "???_0.1.0_x64-setup.exe"로 깨져서 선생님께 그대로 못 드린다.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'));
const ver = conf.version || '0.1.0';
const ascii = `Breeze-${ver}_x64-setup.exe`;

if (!fs.existsSync(DIR)) {
  console.log('nsis dir not found (build first): ' + DIR);
  process.exit(0);
}
const exes = fs.readdirSync(DIR).filter((f) => f.endsWith('-setup.exe'));
if (!exes.length) {
  console.log('no setup exe found');
  process.exit(0);
}
// ASCII 이름이 아니면(한글 깨짐 포함) 가장 큰 파일을 정본으로 복사한다
const src = exes
  .map((f) => ({ f, s: fs.statSync(path.join(DIR, f)).size }))
  .sort((a, b) => b.s - a.s)[0].f;
fs.copyFileSync(path.join(DIR, src), path.join(DIR, ascii));
console.log(`installer: ${src} -> ${ascii}`);
