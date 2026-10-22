'use strict';
/* 시스템 정책(관리자 콘솔 ②) — system_kv 에 policy.* 키로 저장한다.
 *  · 관리자 콘솔(admin.html)에서 바꾸면 서버가 재시작 없이 즉시 반영한다.
 *  · 기본값은 항상 "안전한 쪽"으로: 강제 아님 · 용량 100MB · 자동 삭제 없음.
 *  실제 연결 지점:
 *   - uploadMaxMB     → POST /api/upload 파일 1개 최대 크기
 *   - recallMinutes   → 교사 앱 회수 안내(서버 기록) / 관리 기준
 *   - retentionYears  → 매일 새벽 자동 정리(0=안 함) — 쪽지·대화
 *   - forceUpdate     → GET /api/updates/latest 의 mandatory 강제
 *   - neisOfficeCode / neisSchoolCode → 나이스 급식·학사일정 조회 학교 코드 */
const { getKV, setKV } = require('./db');

const DEFAULTS = {
  uploadMaxMB: 100, // 1회 파일 업로드 최대 (MB)
  recallMinutes: 7, // 쪽지 보내기 취소(Undo Send) 허용 시간 (분)
  retentionYears: 0, // 0=자동 정리 안 함. N=매일 새벽 N년 지난 쪽지·대화 정리
  forceUpdate: '0', // 1이면 새 OTA가 있을 때 모든 교사 PC에 강제 업데이트
  neisOfficeCode: '', // 나이스 교육청 코드 (예: B10)
  neisSchoolCode: '', // 나이스 학교 코드 (예: 7010569)
};

const LIMITS = {
  uploadMaxMB: [1, 2048],
  recallMinutes: [1, 1440],
  retentionYears: [0, 30],
};

/** 단일 정책 값 (저장값이 없으면 기본값). 없는 키는 '' — 항상 문자열로 돌려준다 */
function getPolicy(key) {
  const k = String(key || '');
  if (!(k in DEFAULTS)) return '';
  const v = getKV('policy.' + k);
  return v === '' ? String(DEFAULTS[k]) : v;
}

function getPolicyNumber(key) {
  const n = Number(getPolicy(key));
  return Number.isFinite(n) ? n : Number(DEFAULTS[key]) || 0;
}

function getPolicyBool(key) {
  const v = String(getPolicy(key)).toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === '예';
}

function getPolicies() {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = getPolicy(k);
  return out;
}

/** 검증 후 저장. { ok, error?, policies } 반환 */
function setPolicies(patch) {
  const src = patch && typeof patch === 'object' ? patch : {};
  const keys = Object.keys(src);
  if (!keys.length) return { ok: false, error: '바꿀 정책 값이 없어요.' };
  for (const k of keys) {
    if (!(k in DEFAULTS)) return { ok: false, error: '알 수 없는 정책이에요: ' + k };
    let v = src[k];
    if (k === 'forceUpdate') {
      const s = String(v).toLowerCase();
      v = s === '1' || s === 'true' || s === 'on' || s === '예' || v === true ? '1' : '0';
    } else if (LIMITS[k]) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < LIMITS[k][0] || n > LIMITS[k][1]) {
        return { ok: false, error: `${k} 값은 ${LIMITS[k][0]}~${LIMITS[k][1]} 사이여야 해요.` };
      }
      v = String(Math.round(n * 10) / 10);
    } else {
      v = String(v == null ? '' : v).trim().slice(0, 40);
      if (!/^[A-Za-z0-9_-]*$/.test(v)) {
        return { ok: false, error: '학교 코드는 영문·숫자만 넣을 수 있어요.' };
      }
    }
    setKV('policy.' + k, String(v));
  }
  return { ok: true, policies: getPolicies() };
}

module.exports = { DEFAULTS, getPolicy, getPolicyNumber, getPolicyBool, getPolicies, setPolicies };
