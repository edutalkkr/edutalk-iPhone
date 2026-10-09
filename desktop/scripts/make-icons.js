'use strict';

/**
 * 아이콘 생성 스크립트 (외부 패키지 의존성 없음 — Node 내장 zlib 만 사용)
 *
 *  - assets/icon.png : 256x256 (앱/설치 프로그램 아이콘)
 *  - assets/tray.png :  32x32 (트레이 아이콘)
 *
 * PNG 를 직접 인코딩합니다: 시그니처 + IHDR + IDAT + IEND, RGBA(컬러타입 6),
 * 각 스캔라인 앞에 filter byte 0 을 붙여 zlib.deflateSync 로 압축합니다.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRAND = { r: 0x00, g: 0x82, b: 0xc8 }; // #0082C8 (브리즈 스카이 블루)
const STRONG = { r: 0x00, g: 0x69, b: 0xa8 }; // #0069A8
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const SUBSAMPLES = 4; // 픽셀당 4x4 슈퍼샘플링 (가장자리 안티에일리어싱)

/* ------------------------------------------------------------------ CRC32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (stride + 1);
    raw[offset] = 0; // filter byte: None
    rgba.copy(raw, offset + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------------------------------------------- 그리기 */

// 모서리 반경이 size 의 약 22% 인 둥근 사각형 (0,0)-(size,size) 내부 여부
function insideRoundedRect(x, y, size) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const r = size * 0.22;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// 흰 말풍선(둥근 직사각형 + 위쪽 굵은 꼬리) — 스쿨플로우 체크 대신 점 3개
function insideBubble(x, y, size) {
  const x0 = size * (13 / 48);
  const x1 = size * (39 / 48);
  const y0 = size * (15 / 48);
  const y1 = size * (32 / 48);
  const r = size * (4 / 48);
  if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy > r * r) return false;
    return true;
  }
  // 위 꼬리 삼각형: (24,15) (35,6) (31,15) — 48 그리드 기준, 밑변 7칸 굵기
  const ax = size * (24 / 48);
  const ay = size * (15 / 48);
  const bx = size * (35 / 48);
  const by = size * (6 / 48);
  const cxp = size * (31 / 48);
  const cyp = size * (15 / 48);
  const d = (ax - cxp) * (by - cyp) - (bx - cxp) * (ay - cyp);
  if (d === 0) return false;
  const u = ((x - cxp) * (by - cyp) - (bx - cxp) * (y - cyp)) / d;
  const v = ((ax - cxp) * (y - cyp) - (x - cxp) * (ay - cyp)) / d;
  return u >= 0 && v >= 0 && u + v <= 1;
}

// 말풍선 안 점 3개 (채팅 …) — 진한 파랑
function insideDots(x, y, size) {
  const centers = [20 / 48, 26 / 48, 32 / 48];
  const cy = size * (24 / 48);
  const r = size * (2.3 / 48);
  for (const fx of centers) {
    const dx = x - size * fx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

function render(size) {
  const out = Buffer.alloc(size * size * 4); // 배경은 완전 투명
  const step = 1 / SUBSAMPLES;
  const total = SUBSAMPLES * SUBSAMPLES;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgHits = 0;
      let bubbleHits = 0;
      let dotHits = 0;

      for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
        for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (!insideRoundedRect(x, y, size)) continue;
          bgHits += 1;
          if (insideBubble(x, y, size)) bubbleHits += 1;
          if (insideDots(x, y, size)) dotHits += 1;
        }
      }

      if (bgHits === 0) continue;

      const alpha = bgHits / total;
      const bubble = bubbleHits / bgHits; // 파랑 위에 덮이는 흰색 비율
      const dot = dotHits / bgHits; // 흰색 위에 찍히는 진한 파랑 비율
      // 배경은 위(#14B8A6) → 아래(#0F766E) 세로 그라데이션
      const t = py / (size - 1);
      const baseR = Math.round(BRAND.r + (STRONG.r - BRAND.r) * t);
      const baseG = Math.round(BRAND.g + (STRONG.g - BRAND.g) * t);
      const baseB = Math.round(BRAND.b + (STRONG.b - BRAND.b) * t);
      const offset = (py * size + px) * 4;
      out[offset] = Math.round(baseR + (255 - baseR) * bubble * (1 - dot) + (STRONG.r - baseR) * dot);
      out[offset + 1] = Math.round(baseG + (255 - baseG) * bubble * (1 - dot) + (STRONG.g - baseG) * dot);
      out[offset + 2] = Math.round(baseB + (255 - baseB) * bubble * (1 - dot) + (STRONG.b - baseB) * dot);
      out[offset + 3] = Math.round(alpha * 255);
    }
  }

  return out;
}

/* ------------------------------------------------------------------ 실행 */

const TARGETS = [
  { file: path.join(ASSETS_DIR, 'icon.png'), size: 256, label: '앱 아이콘' },
  { file: path.join(ASSETS_DIR, 'tray.png'), size: 32, label: '트레이 아이콘' }
];

fs.mkdirSync(ASSETS_DIR, { recursive: true });

let failed = false;
for (const target of TARGETS) {
  const png = encodePng(target.size, target.size, render(target.size));
  fs.writeFileSync(target.file, png);

  const exists = fs.existsSync(target.file);
  const bytes = exists ? fs.statSync(target.file).size : 0;
  const ok = exists && bytes > 0;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${target.label} ${target.size}x${target.size} -> ${target.file} (${bytes} bytes)`
  );
}

if (failed) {
  console.error('아이콘 생성에 실패했습니다.');
  process.exit(1);
}

console.log('아이콘 생성 완료: assets/icon.png, assets/tray.png');
