'use strict';
// 빌드 후 NSIS 파일명을 ASCII로 고정한다.
// productName이 한글이라 "???_0.1.0_x64-setup.exe"로 깨져서 선생님께 그대로 못 드린다.
const fs = require('fs');
const path = require('path');

const DIR = path.join(
  process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(__dirname, '..', 'src-tauri', 'target'),
  'release', 'bundle', 'nsis'
);
const conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'));
const ver = conf.version || '0.1.0';
const ascii = `Breeze-${ver}_x64-setup.exe`;
const expected = `${conf.productName}_${ver}_x64-setup.exe`;

if (!fs.existsSync(DIR)) {
  console.log('nsis dir not found (build first): ' + DIR);
  process.exit(0);
}
const exes = fs.readdirSync(DIR).filter((f) => f.endsWith('-setup.exe'));
if (!exes.length) {
  console.log('no setup exe found');
  process.exit(0);
}
// 같은 폴더에 이전 버전 설치본이 남아 있어도, 이번 빌드가 만든 파일을 우선 고른다.
const candidates = exes.filter((f) => f !== ascii);
const src = candidates.find((f) => f === expected)
  || candidates.find((f) => f.includes(ver))
  || candidates
    .map((f) => ({ f, s: fs.statSync(path.join(DIR, f)).size }))
    .sort((a, b) => b.s - a.s)[0]?.f;
if (!src) {
  console.log('no version-matched setup exe found');
  process.exit(0);
}
fs.copyFileSync(path.join(DIR, src), path.join(DIR, ascii));
console.log(`installer: ${src} -> ${ascii}`);
