'use strict';
/**
 * EduTalk Desktop Native — RAM 상 1초 미리보기 (용량 점유 ZERO)
 *  - HWP/HWPX를 다운로드 폴더에 저장하지 않고 메모리에서만 열람 후 즉시 파기
 *  - 실제 HWP 렌더러가 있으면 위임, 없으면 메타/텍스트 추출 폴백
 *  - 데스크톱 전용
 */

const crypto = require('crypto');

const ramStore = new Map(); // previewId -> {buf, mime, fileName, createdAt, timer}
const MAX_RAM_BYTES = 64 * 1024 * 1024;
let ramUsed = 0;

function putRamPreview({ buf, mime, fileName, ttlMs }) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length > MAX_RAM_BYTES) throw new Error('too-large');
  if (ramUsed + b.length > MAX_RAM_BYTES) sweepExpired(true);
  const id = 'pv-' + crypto.randomBytes(8).toString('hex');
  const ttl = Number(ttlMs || 60 * 1000);
  const rec = { buf: b, mime: String(mime || 'application/octet-stream'), fileName: String(fileName || 'preview'), createdAt: Date.now(), timer: null };
  ramUsed += b.length;
  rec.timer = setTimeout(() => destroyPreview(id), ttl);
  if (rec.timer && rec.timer.unref) rec.timer.unref();
  ramStore.set(id, rec);
  return { id, size: b.length, ttlMs: ttl };
}

function getRamPreview(id) {
  const rec = ramStore.get(String(id || ''));
  if (!rec) return null;
  return { mime: rec.mime, fileName: rec.fileName, size: rec.buf.length, createdAt: rec.createdAt, buf: rec.buf };
}

function destroyPreview(id) {
  const rec = ramStore.get(String(id || ''));
  if (!rec) return false;
  try { clearTimeout(rec.timer); } catch (e) {}
  try { rec.buf.fill(0); } catch (e) {}
  ramUsed = Math.max(0, ramUsed - rec.buf.length);
  ramStore.delete(String(id || ''));
  return true;
}

function sweepExpired(forceOldest) {
  const now = Date.now();
  for (const [id, rec] of ramStore) {
    if (now - rec.createdAt > 60 * 1000) destroyPreview(id);
  }
  if (forceOldest && ramUsed > MAX_RAM_BYTES * 0.8) {
    const sorted = Array.from(ramStore.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [id] of sorted) {
      destroyPreview(id);
      if (ramUsed <= MAX_RAM_BYTES * 0.6) break;
    }
  }
}

// HWPX는 ZIP 기반이므로 매직바이트로 가볍게 판별 (PK\x03\x04), HWP는 OLE(CFB) 판별
function sniffHwpKind(buf) {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return 'hwpx(zip)';
    if (b.length >= 8 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'hwp(ole)';
    return 'unknown';
  } catch (e) { return 'unknown'; }
}

module.exports = { putRamPreview, getRamPreview, destroyPreview, sniffHwpKind, MAX_RAM_BYTES };
