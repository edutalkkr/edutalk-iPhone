'use strict';
// EduTalk Desktop Native smoke test (빌드 에러 0개 + 예외 방어 확인용)
const assert = require('node:assert');

const DLP = require('../native/dlp');
const { purgeCache } = require('../native/autopurge');
const RAM = require('../native/ramPreview');
const { detectNetMode, openLocalDb } = require('../native/netmode');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
function ok(name, fn) {
  try { fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); process.exitCode = 1; }
}

ok('dlp-block-rrn', () => {
  const r = DLP.verifySync({ text: '주민등록번호 900101-1234567 전달', netMode: 'external' });
  assert.equal(r.verdict, 'block');
  assert.ok(r.elapsedMs < 100, 'fast path');
});
ok('dlp-allow-normal', () => {
  const r = DLP.verifySync({ text: '내일 3반 제출 완료', netMode: 'external' });
  assert.equal(r.verdict, 'allow');
});
ok('dlp-intranet-no-block', () => {
  const r = DLP.verifySync({ text: '주민등록번호 900101-1234567', netMode: 'intranet' });
  assert.notEqual(r.verdict, 'block');
});
ok('ram-preview-zero-disk', () => {
  const before = fs.readdirSync(os.tmpdir()).length;
  const r = RAM.putRamPreview({ buf: Buffer.from('PK\x03\x04 fake hwpx'), mime: 'application/octet-stream', fileName: 'a.hwpx', ttlMs: 50 });
  assert.equal(RAM.sniffHwpKind(Buffer.from('PK\x03\x04')), 'hwpx(zip)');
  assert.ok(RAM.getRamPreview(r.id));
  RAM.destroyPreview(r.id);
  assert.equal(RAM.getRamPreview(r.id), null);
  assert.equal(fs.readdirSync(os.tmpdir()).length, before);
});
ok('autopurge-quota', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edutalk-purge-'));
  fs.writeFileSync(path.join(dir, 'old.bin'), Buffer.alloc(10));
  const old = Date.now() - 31 * 24 * 3600 * 1000;
  fs.utimesSync(path.join(dir, 'old.bin'), new Date(old), new Date(old));
  const res = purgeCache({ cacheDir: dir, quotaBytes: 1024 * 1024, ttlMs: 30 * 24 * 3600 * 1000 });
  assert.equal(res.deletedExpired, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
ok('localdb-fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edutalk-db-'));
  const db = openLocalDb(dir);
  db.insertMemo({ id: 'm1', title: 't', body: 'b', to: ['a'], fromUid: 'u', createdAt: new Date().toISOString(), net: 'external' });
  assert.ok(db.listMemos().length >= 1);
  try { db.close(); } catch (e) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
ok('netmode-detect', () => {
  const m = detectNetMode();
  assert.ok(m === 'intranet' || m === 'external');
});

console.log('smoke done: ' + pass + ' passed');
