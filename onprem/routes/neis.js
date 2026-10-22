'use strict';
/* 나이스(NEIS) 학사일정·급식 연동 — Killer ③
 *
 *  · 공공데이터포털의 나이스 Open API 를 서버가 대신 호출한다.
 *    (API 키는 서버 .env / 관리자 콘솔 정책에만 — 교사 앱에는 두지 않는다.)
 *  · 결과는 school_cache 에 잠시 보관(급식 6시간 · 학사일정 12시간)해 재호출·지연을 줄인다.
 *  · 키나 학교 코드가 없으면 503 + 안내 문구를 돌려주고, 교사 앱은 조용히 숨긴다.
 *
 *  설정 우선순위: 관리자 정책(neisOfficeCode/neisSchoolCode) > 서버 .env(NEIS_OFFICE_CODE/NEIS_SCHOOL_CODE)
 *  키: NEIS_API_KEY (.env) — 관리자 콘솔에는 두지 않는다(비밀키 보호).
 *
 *  계약:
 *   GET /api/neis/meal?date=YYYYMMDD      → { ok, date, meals: [{name, menu[], calories, origin, nutrition}] }
 *   GET /api/neis/schedule?from=YYYYMMDD&to=YYYYMMDD → { ok, events: [{date, title, etc}] }
 */
const express = require('express');
const { row, run } = require('../db');
const { getPolicy } = require('../policies');

const BASE = 'https://open.neis.go.kr/hub';
const MEAL_TTL_MIN = 6 * 60;
const SCHEDULE_TTL_MIN = 12 * 60;

const ymdRe = /^\d{8}$/;
const toDashed = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

function cacheGet(key, ttlMin) {
  try {
    const c = row('SELECT v, fetched_at FROM school_cache WHERE k = ?', String(key));
    if (!c) return null;
    const t = Date.parse(String(c.fetched_at).replace(' ', 'T'));
    if (!Number.isFinite(t)) return null;
    if (Date.now() - t > ttlMin * 60000) return null;
    return JSON.parse(String(c.v || 'null'));
  } catch (e) {
    return null;
  }
}

function cachePut(key, value) {
  try {
    run(
      `INSERT INTO school_cache (k, v, fetched_at) VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, fetched_at = excluded.fetched_at`,
      String(key), JSON.stringify(value)
    );
  } catch (e) { /* 캐시 실패는 응답을 막지 않는다 */ }
}

/** 연동 설정 상태 */
function integrationState() {
  const key = String(process.env.NEIS_API_KEY || '').trim();
  const office = String(getPolicy('neisOfficeCode') || process.env.NEIS_OFFICE_CODE || '').trim();
  const school = String(getPolicy('neisSchoolCode') || process.env.NEIS_SCHOOL_CODE || '').trim();
  const ready = key.length > 4 && office.length > 0 && school.length > 0;
  let missing = [];
  if (key.length <= 4) missing.push('API 키(NEIS_API_KEY)');
  if (!office) missing.push('교육청 코드');
  if (!school) missing.push('학교 코드');
  return { ready, key, office, school, missing };
}

async function neisFetch(path, params, key) {
  // KEY 는 서버 프로세스의 .env 에서만 읽어 쿼리에 붙인다 (클라이언트로 노출 금지).
  const qs = new URLSearchParams({ Type: 'json', pIndex: '1', pSize: '100', KEY: String(key || ''), ...params });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${BASE}/${path}?${qs.toString()}`, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, error: '나이스 응답을 읽지 못했어요.' };
    // 정상: { path: [ {head:[...]}, {row:[...]} ] } · 데이터 없음: { RESULT: {CODE:'INFO-200'} }
    const rows = Array.isArray(data[path]) && data[path][1] && Array.isArray(data[path][1].row) ? data[path][1].row : null;
    if (rows) return { ok: true, rows };
    const code = data.RESULT && data.RESULT.CODE;
    if (code === 'INFO-200') return { ok: true, rows: [] }; // 해당 날짜 데이터 없음 = 정상
    const msg = (data.RESULT && data.RESULT.MESSAGE) || '나이스 요청이 실패했어요.';
    return { ok: false, error: `나이스: ${msg} (${code || '?'})` };
  } catch (e) {
    return { ok: false, error: '나이스 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' };
  } finally {
    clearTimeout(timer);
  }
}

/* 급식 메뉴 문자열 정리: "밥<br/>국(1.2.5)<br/>..." → ["밥","국",...] (알레르기 번호 제거) */
function cleanMenu(raw) {
  return String(raw || '')
    .split('<br/>')
    .map((s) => s.replace(/\([\d.,\s]+\)\s*$/g, '').replace(/[*…]/g, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

module.exports = function createNeisRouter({ needAuth, needStaff }) {
  const router = express.Router();
  router.use(needAuth);
  if (needStaff) router.use(needStaff);

  /* 연동 준비 상태 — 앱이 설정 안내를 띄울지 판단한다 */
  router.get('/status', (req, res) => {
    const st = integrationState();
    res.json({ ok: true, ready: st.ready, hasKey: st.key.length > 4, officeCode: st.office, schoolCode: st.school, missing: st.missing });
  });

  /* 오늘의 급식 */
  router.get('/meal', async (req, res) => {
    try {
      const date = String(req.query.date || '').trim();
      if (!ymdRe.test(date)) return res.status(400).json({ ok: false, error: '날짜는 YYYYMMDD 형식으로 보내 주세요.' });
      const st = integrationState();
      if (!st.ready) return res.status(503).json({ ok: false, error: `나이스 연동이 아직 설정되지 않았어요 (필요: ${st.missing.join(', ')})`, missing: st.missing });

      const ck = `neis:meal:${date}`;
      const hit = cacheGet(ck, MEAL_TTL_MIN);
      if (hit) return res.json({ ok: true, date: toDashed(date), meals: hit, cached: true });

      const out = await neisFetch('mealServiceDietInfo', {
        ATPT_OFCDC_SC_CODE: st.office, SD_SCHUL_CODE: st.school, MLSV_YMD: date,
      }, st.key);
      if (!out.ok) return res.status(502).json({ ok: false, error: out.error });

      const meals = out.rows
        .map((r) => ({
          name: String(r.MMEAL_SC_NM || '중식'),
          menu: cleanMenu(r.DDISH_NM),
          calories: String(r.CAL_INFO || '').replace(/\s+/g, ' ').trim(),
          origin: String(r.ORPLC_INFO || '').replace(/<br\/>/g, ' · ').trim().slice(0, 300),
          nutrition: String(r.NTR_INFO || '').split('<br/>').map((s) => s.trim()).filter(Boolean).slice(0, 10),
        }))
        .filter((m) => m.menu.length);
      cachePut(ck, meals);
      res.json({ ok: true, date: toDashed(date), meals, cached: false });
    } catch (e) {
      console.error('[neis] meal error:', e);
      res.status(500).json({ ok: false, error: '급식 정보를 불러오지 못했어요.' });
    }
  });

  /* 학사일정 (기간) */
  router.get('/schedule', async (req, res) => {
    try {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      if (!ymdRe.test(from) || !ymdRe.test(to)) return res.status(400).json({ ok: false, error: '기간은 YYYYMMDD 형식으로 보내 주세요.' });
      const st = integrationState();
      if (!st.ready) return res.status(503).json({ ok: false, error: `나이스 연동이 아직 설정되지 않았어요 (필요: ${st.missing.join(', ')})`, missing: st.missing });

      const ck = `neis:schedule:${from}:${to}`;
      const hit = cacheGet(ck, SCHEDULE_TTL_MIN);
      if (hit) return res.json({ ok: true, from: toDashed(from), to: toDashed(to), events: hit, cached: true });

      const out = await neisFetch('SchoolSchedule', {
        ATPT_OFCDC_SC_CODE: st.office, SD_SCHUL_CODE: st.school, AA_FROM_YMD: from, AA_TO_YMD: to,
      }, st.key);
      if (!out.ok) return res.status(502).json({ ok: false, error: out.error });

      const events = out.rows
        .map((r) => ({
          date: String(r.EVENT_YMD || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
          title: String(r.EVENT_NM || '').trim(),
          etc: String(r.EVENT_CNTNT || '').replace(/<br\/>/g, ' ').trim().slice(0, 120),
        }))
        .filter((e) => e.date && e.title)
        .slice(0, 200);
      cachePut(ck, events);
      res.json({ ok: true, from: toDashed(from), to: toDashed(to), events, cached: false });
    } catch (e) {
      console.error('[neis] schedule error:', e);
      res.status(500).json({ ok: false, error: '학사일정을 불러오지 못했어요.' });
    }
  });

  return router;
};
