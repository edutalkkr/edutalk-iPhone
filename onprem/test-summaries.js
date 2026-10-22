'use strict';
/* AI 요약 API 검증 — 로드맵 1-1 (Gemini 서버 캐시 + 개인정보 마스킹)
 * 실행: npm run test:summaries
 * 임시 DB에서만 동작하며 실제 data/ 폴더는 건드리지 않는다. 네트워크(Gemini)는 호출하지 않는다. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'breeze-summaries-test');
process.env.EDUTALK_DATA_DIR = TMP;
process.env.EDUTALK_DB_PATH = path.join(TMP, 'test.db');
process.env.GEMINI_API_KEY = ''; // 키 없음 → 로컬 요약 + 캐시 (오프라인 학교망과 같은 조건)
fs.rmSync(TMP, { recursive: true, force: true });

const { row, run } = require('./db');
const auth = require('./auth');
const express = require('express');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}

run('INSERT INTO users (username, real_name, role, password_hash) VALUES (?, ?, ?, ?)',
  't1', '김하나', 'TEACHER', auth.hashPassword('pw1234'));

function needAuth(req, res, next) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const u = auth.userByToken(token);
  if (!u) return res.status(401).json({ ok: false, error: '로그인이 필요해요.' });
  req.user = u; req.token = token; next();
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/ai/summaries', require('./routes/summaries')({ needAuth }));

let base = '';
const server = app.listen(0, '127.0.0.1', async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  const client = (token, method, p, body) =>
    fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

  const NOTICE =
    '1) 일시: 10월 24일(금) 오후 2시\n' +
    '2) 장소: 각 반 교실\n' +
    '3) 대상: 전교생\n' +
    '제출기한은 10월 22일까지입니다. 담임 선생님은 900101-1234567 로 연락 바랍니다. ' +
    '문의 010-2345-6789, 후원 계좌 1234-5678-9012-3456.';

  try {
    const t1 = auth.login('t1', 'pw1234').token;

    console.log('\n[1] 인증·입력 검증');
    let r = await client('', 'POST', '/api/ai/summaries', { text: NOTICE });
    check('토큰 없음 → 401', r.status === 401, r.json);
    r = await client(t1, 'POST', '/api/ai/summaries', { text: '   ' });
    check('빈 내용 → 400', r.status === 400, r.json);

    console.log('\n[2] 개인정보 마스킹 + 로컬 요약 (Gemini 키 없음)');
    r = await client(t1, 'POST', '/api/ai/summaries', { text: NOTICE });
    const first = r.json;
    check('요약 200 + 1~3줄', r.status === 200 && Array.isArray(first.lines) && first.lines.length >= 1 && first.lines.length <= 3, first);
    check('개인정보 3건 마스킹', first.privacy && first.privacy.masked === 3, first.privacy);
    const joined = (first.lines || []).join(' ');
    check('요약문에 원본 주민번호 없음', !joined.includes('900101'), joined);
    check('요약문에 원본 휴대폰 없음', !joined.includes('010-2345'), joined);
    check('요약문에 원본 카드번호 없음', !joined.includes('1234-5678'), joined);
    check('키 없음 → source local + cached false', first.source === 'local' && first.cached === false, { source: first.source, cached: first.cached });
    check('키 없는 요약은 모델명 없음', first.model === '', first.model);

    console.log('\n[3] 캐시 — 두 번째 요청은 DB에서 즉시');
    r = await client(t1, 'POST', '/api/ai/summaries', { text: NOTICE });
    const second = r.json;
    check('cached true + 같은 키/줄', second.cached === true && second.key === first.key && JSON.stringify(second.lines) === JSON.stringify(first.lines), second);
    check('마스킹 수는 캐시에도 보존', second.privacy && second.privacy.masked === 3, second.privacy);
    const rows1 = Number(row('SELECT COUNT(*) c FROM ai_summaries').c);
    check('DB에는 1건만 저장(중복 호출 없음)', rows1 === 1, { rows: rows1 });
    const cachedJson = String(row('SELECT lines FROM ai_summaries WHERE cache_key = ?', first.key).lines);
    check('캐시 원문에 주민번호 미잔류', !cachedJson.includes('900101'), cachedJson.slice(0, 80));

    console.log('\n[4] GET 캐시 조회');
    r = await client(t1, 'GET', `/api/ai/summaries/${first.key}`);
    check('GET 캐시 hit → 같은 줄', r.status === 200 && JSON.stringify(r.json.lines) === JSON.stringify(first.lines), r.json);
    r = await client(t1, 'GET', '/api/ai/summaries/deadbeefdeadbeefdeadbeefdeadbeef');
    check('없는 키 → 404', r.status === 404, r.json);
    r = await client('', 'GET', `/api/ai/summaries/${first.key}`);
    check('GET도 로그인 필요 → 401', r.status === 401, r.json);

    console.log('\n[5] force 재생성 (같은 키 upsert)');
    r = await client(t1, 'POST', '/api/ai/summaries', { text: NOTICE, force: true });
    check('force → cached false, 같은 키', r.json.cached === false && r.json.key === first.key, r.json);
    const rows2 = Number(row('SELECT COUNT(*) c FROM ai_summaries').c);
    check('행 수는 그대로 1 (upsert)', rows2 === 1, { rows: rows2 });

    console.log('\n[6] 다른 공지 → 다른 캐시 키');
    r = await client(t1, 'POST', '/api/ai/summaries', { text: '체험학습 신청서를 10월 25일까지 제출해 주세요. 대상은 3학년입니다.' });
    check('다른 본문 → 다른 키 + 새 행', r.json.key !== first.key && Number(row('SELECT COUNT(*) c FROM ai_summaries').c) === 2, r.json.key);

    console.log('\n[7] 감사 로그 (ai_summary)');
    const audits = Number(row("SELECT COUNT(*) c FROM audit_logs WHERE action='ai_summary'").c);
    check('생성 3건만 감사 기록 (캐시 응답 제외)', audits === 3, { audits });
  } catch (e) {
    fail++;
    console.error('  ✗ 예외:', e);
  } finally {
    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    server.close(() => process.exit(fail ? 1 : 0));
  }
});
