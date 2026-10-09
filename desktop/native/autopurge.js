'use strict';
/**
 * EduTalk Desktop Native — 스마트 캐시 자가 세척 (Auto Purge)
 *  - 나에게 수신된 파일만 개별 저장
 *  - 30일 경과 임시파일 자동 삭제
 *  - 메신저 용량 상한선(기본 3GB) 초과 시 오래된 순 자동 청소
 *  - 데스크톱 전용
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_QUOTA_BYTES = 3 * 1024 * 1024 * 1024;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function walkFiles(dir, out) {
  out = out || [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    try {
      if (ent.isDirectory()) walkFiles(p, out);
      else if (ent.isFile()) {
        try {
          const st = fs.statSync(p);
          out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
        } catch (e) {}
      }
    } catch (e) {}
  }
  return out;
}

function purgeCache({ cacheDir, quotaBytes, ttlMs }) {
  const quota = Number(quotaBytes || DEFAULT_QUOTA_BYTES);
  const ttl = Number(ttlMs || DEFAULT_TTL_MS);
  const now = Date.now();
  const result = { scanned: 0, deletedExpired: 0, deletedQuota: 0, freedBytes: 0, totalBytes: 0 };
  if (!cacheDir || !fs.existsSync(cacheDir)) return result;
  const files = walkFiles(cacheDir);
  result.scanned = files.length;
  result.totalBytes = files.reduce((a, f) => a + (f.size || 0), 0);

  // 1) 30일 경과 삭제
  const fresh = [];
  for (const f of files) {
    if (now - f.mtimeMs > ttl) {
      try { fs.unlinkSync(f.path); result.deletedExpired += 1; result.freedBytes += f.size; } catch (e) { fresh.push(f); }
    } else fresh.push(f);
  }
  // 2) 상한선 초과 시 오래된 순 삭제
  let total = fresh.reduce((a, f) => a + (f.size || 0), 0);
  if (total > quota) {
    fresh.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of fresh) {
      if (total <= quota) break;
      try { fs.unlinkSync(f.path); result.deletedQuota += 1; result.freedBytes += f.size; total -= f.size; } catch (e) {}
    }
  }
  result.totalBytes = total;
  return result;
}

function scheduleAutoPurge({ cacheDir, quotaBytes, ttlMs, intervalMs }) {
  const run = () => {
    try { return purgeCache({ cacheDir, quotaBytes, ttlMs }); } catch (e) { return null; }
  };
  // 시작 20초 후 1회 + 6시간 간격
  const t1 = setTimeout(run, 20000);
  if (t1 && t1.unref) t1.unref();
  const timer = setInterval(run, Number(intervalMs || 6 * 60 * 60 * 1000));
  if (timer && timer.unref) timer.unref();
  return { run, timer };
}

module.exports = { DEFAULT_QUOTA_BYTES, DEFAULT_TTL_MS, purgeCache, scheduleAutoPurge };
