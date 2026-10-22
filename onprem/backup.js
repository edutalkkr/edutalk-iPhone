'use strict';
/* 자동 DB 백업(관리자 콘솔 ⑤) — 매일 새벽 일관된 스냅샷을 뜬다.
 *  · WAL 모드에서 단순 파일 복사는 깨질 수 있어 SQLite 의 VACUUM INTO 를 쓴다 (안전한 일관 복사).
 *  · data/backups 폴더에 최근 KEEP개만 남기고 오래된 것부터 지운다.
 *  · 실패해도 서버 동작을 막지 않는다 (다음 날 다시 시도). */
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

const KEEP = 14;

function backupDir() {
  return path.join(DATA_DIR, 'backups');
}

function listBackups() {
  try {
    return fs
      .readdirSync(backupDir())
      .filter((f) => /^edutalk-.*\.db$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(backupDir(), f));
        return { file: f, bytes: st.size, at: st.mtime.toISOString().slice(0, 19).replace('T', ' ') };
      })
      .sort((a, b) => b.file.localeCompare(a.file));
  } catch (e) {
    return [];
  }
}

/** 지금 백업 1회 → { ok, file, bytes } */
function backupNow() {
  fs.mkdirSync(backupDir(), { recursive: true });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const dest = path.join(backupDir(), `edutalk-${stamp}.db`);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  // 오래된 백업 정리
  const files = fs
    .readdirSync(backupDir())
    .filter((f) => /^edutalk-.*\.db$/.test(f))
    .sort();
  while (files.length > KEEP) {
    const old = files.shift();
    try { fs.unlinkSync(path.join(backupDir(), old)); } catch (e) { /* 다음에 */ }
  }
  const st = fs.statSync(dest);
  return { ok: true, file: path.basename(dest), bytes: st.size };
}

module.exports = { backupNow, listBackups, backupDir, KEEP };
