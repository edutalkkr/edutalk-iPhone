'use strict';
/* 아주 작은 .env 로더 — 외부 의존성 없이 서버 폴더의 .env 를 process.env 로 읽는다.
 *
 *  · AI API 키처럼 민감한 값은 서버의 .env 에서만 관리한다.
 *    (교사 클라이언트에는 키를 두지 않는다 — 유출 위험 제거. 로드맵 1-1)
 *  · 이미 설정된 환경 변수(서비스/명령줄/설치 스크립트)는 덮어쓰지 않는다.
 *  · 값 양끝의 따옴표("" 또는 '')는 벗겨 내고, # 주석·빈 줄은 무시한다.
 *  · exe(pkg) 배포판에서는 exe 옆 폴더의 .env 를 읽는다 (EDUTALK_HOME 우선).
 */
const fs = require('fs');
const path = require('path');

function envRoot() {
  try {
    if (process.env.EDUTALK_HOME) return process.env.EDUTALK_HOME;
    if (process.env.EDUTALK_ENV_DIR) return process.env.EDUTALK_ENV_DIR;
    if (process.pkg && process.execPath) return path.dirname(process.execPath);
  } catch (e) { /* 무시하고 아래로 */ }
  return __dirname;
}

/** .env 텍스트 → { KEY: value }. 형식이 어긋난 줄은 조용히 건너뛴다. */
function parseEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** .env 파일을 process.env 로. { path, loaded } 반환 — 실패해도 서버는 계속 뜬다. */
function loadEnv(file) {
  const target = file || path.join(envRoot(), '.env');
  try {
    if (!fs.existsSync(target)) return { path: target, loaded: 0 };
    const parsed = parseEnv(fs.readFileSync(target, 'utf8'));
    let loaded = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) { process.env[k] = v; loaded++; }
    }
    return { path: target, loaded };
  } catch (e) {
    return { path: target, loaded: 0 };
  }
}

module.exports = { loadEnv, parseEnv, envRoot };
