'use strict';
/* 서버 주도 OTA(자동 업데이트) — 5단계-3
 * 전산실이 updates/ 폴더에 설치본(.exe)과 latest.json 을 올리면 교사 PC(브리즈)가
 * 확인 → 내려받기 → 조용히 설치한다. 읽기 전용이라 로그인 없이 허용한다 (학내망 전용).
 *
 * latest.json 예:
 * { "version": "0.2.2", "file": "BreezeSetup-0.2.2.exe",
 *   "notes": "쪽지함 개선", "mandatory": false, "pub_date": "2026-10-18" } */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 검사값(SHA-256)은 파일이 바뀔 때만 다시 계산한다 (100MB 파일을 매 요청마다 읽지 않게)
const hashCache = new Map(); // full → { key, sha256 }

function fileInfo(full) {
  const st = fs.statSync(full);
  const key = st.size + '|' + st.mtimeMs;
  const hit = hashCache.get(full);
  if (hit && hit.key === key) return { size: st.size, sha256: hit.sha256 };
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  hashCache.set(full, { key, sha256 });
  return { size: st.size, sha256 };
}

module.exports = function updatesRouter(opts = {}) {
  const dir = path.resolve(
    opts.dir || process.env.BREEZE_UPDATES_DIR || path.join(__dirname, '..', 'updates')
  );
  const router = express.Router();
  /** 관리자 정책(forceUpdate) — 켜 두면 새 버전이 있는 모든 교사 PC에 강제 업데이트 */
  const forcedByPolicy = () => {
    try { return !!(opts.forcedUpdate && opts.forcedUpdate()); } catch (e) { return false; }
  };

  // 등록된 업데이트 정보 (없으면 404 → 교사 PC는 "최신"으로 해석)
  router.get('/latest', (req, res) => {
    try {
      const mp = path.join(dir, 'latest.json');
      if (!fs.existsSync(mp)) {
        return res.status(404).json({ ok: false, error: '등록된 업데이트가 없어요.' });
      }
      const man = JSON.parse(fs.readFileSync(mp, 'utf8'));
      const name = path.basename(String(man.file || ''));
      if (!name || !/\.exe$/i.test(name)) {
        return res.status(404).json({ ok: false, error: 'latest.json 의 file 값이 올바르지 않아요.' });
      }
      const full = path.join(dir, name);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        return res.status(404).json({ ok: false, error: '설치 파일이 아직 올라오지 않았어요.' });
      }
      const { size, sha256 } = fileInfo(full);
      res.json({
        ok: true,
        version: String(man.version || ''),
        file: name,
        size,
        sha256,
        notes: String(man.notes || ''),
        mandatory: man.mandatory === true || forcedByPolicy(),
        pub_date: String(man.pub_date || ''),
        url: '/api/updates/download/' + encodeURIComponent(name),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: '업데이트 정보를 읽지 못했어요.' });
    }
  });

  // 설치본 내려주기 (폴더 밖으로 나가는 요청·허용 외 확장자는 거부)
  router.get('/download/:file', (req, res) => {
    const raw = String(req.params.file || '');
    const name = path.basename(raw);
    if (!name || name !== raw || !/\.exe$/i.test(name)) {
      return res.status(400).json({ ok: false, error: '올바른 파일 이름이 아니에요.' });
    }
    const full = path.join(dir, name);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return res.status(404).json({ ok: false, error: '파일이 없어요.' });
    }
    res.sendFile(full);
  });

  return router;
};
