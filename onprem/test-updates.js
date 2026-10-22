'use strict';
/* OTA 업데이트 서빙 자체 검증 — 5단계-3
 * 실행: npm run test:updates
 * 임시 폴더에서만 동작하며 실제 updates/ 폴더는 건드리지 않는다. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const TMP = path.join(os.tmpdir(), 'breeze-updates-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}

/* 시드: 가짜 설치본 + latest.json */
const exeName = 'BreezeSetup-0.2.2.exe';
const exeBytes = crypto.randomBytes(64 * 1024);
fs.writeFileSync(path.join(TMP, exeName), exeBytes);
const sha256 = crypto.createHash('sha256').update(exeBytes).digest('hex');
fs.writeFileSync(path.join(TMP, 'latest.json'), JSON.stringify({
  version: '0.2.2', file: exeName, notes: '쪽지함 개선', mandatory: false, pub_date: '2026-10-18',
}));

const app = express();
app.use('/api/updates', require('./routes/updates')({ dir: TMP }));

let base = '';
const server = app.listen(0, '127.0.0.1', async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    console.log('\n[1] 매니페스트');
    let r = await fetch(base + '/api/updates/latest');
    let j = await r.json().catch(() => ({}));
    check('latest 200 + ok', r.status === 200 && j.ok === true, { status: r.status, j });
    check('version/file/size/sha256 채워짐', j.version === '0.2.2' && j.file === exeName && j.size === exeBytes.length && j.sha256 === sha256);
    check('url 은 download 경로', j.url === '/api/updates/download/' + encodeURIComponent(exeName), j.url);
    check('mandatory 는 boolean(false)', j.mandatory === false);
    check('notes/pub_date 전달', j.notes === '쪽지함 개선' && j.pub_date === '2026-10-18');

    console.log('\n[2] 설치본 내려받기');
    r = await fetch(base + '/api/updates/download/' + encodeURIComponent(exeName));
    const buf = Buffer.from(await r.arrayBuffer());
    check('download 200 + 바이트 일치', r.status === 200 && buf.equals(exeBytes), { status: r.status, len: buf.length });

    console.log('\n[3] 보안 (폴더 밖 접근·확장자)');
    r = await fetch(base + '/api/updates/download/..%2F..%2Flatest.json');
    check('경로 탈출 시도 → 400', r.status === 400, r.status);
    r = await fetch(base + '/api/updates/download/latest.json');
    check('.exe 아닌 파일 → 400', r.status === 400, r.status);
    r = await fetch(base + '/api/updates/download/none.exe');
    check('없는 파일 → 404', r.status === 404, r.status);

    console.log('\n[4] 업데이트 미등록 서버');
    fs.renameSync(path.join(TMP, 'latest.json'), path.join(TMP, 'latest.json.bak'));
    r = await fetch(base + '/api/updates/latest');
    j = await r.json().catch(() => ({}));
    check('latest.json 없음 → 404 + ok:false', r.status === 404 && j.ok === false, { status: r.status, j });

    fs.renameSync(path.join(TMP, 'latest.json.bak'), path.join(TMP, 'latest.json'));
    fs.renameSync(path.join(TMP, exeName), path.join(TMP, exeName + '.bak'));
    r = await fetch(base + '/api/updates/latest');
    check('설치 파일 미업로드 → 404', r.status === 404, r.status);
  } catch (e) {
    fail++;
    console.error('  ✗ 예외:', e);
  } finally {
    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    server.close(() => process.exit(fail ? 1 : 0));
  }
});
