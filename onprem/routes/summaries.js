'use strict';
/* AI 3줄 요약 — 서버(Gemini) 캐시 + 민감정보 마스킹 (로드맵 1-1)
 *
 *  · AI API 키는 이 서버의 .env에서만 관리한다. 교사 클라이언트에는 두지 않는다.
 *  · 같은 공지(정규화 본문 동일)는 딱 1회만 Gemini를 호출하고 결과를 ai_summaries에 저장(캐싱)한다.
 *    이후 어떤 교사가 열어도 DB에서 즉시(수 ms) 돌려준다 → API 중복 호출·비용/지연 제거.
 *  · Gemini로 보내기 전에 주민등록번호·휴대폰·카드번호 패턴을 ***로 마스킹한다 (개인정보 보호).
 *    마스킹 값으로 캐시 키를 만들므로 원문은 DB에 남지 않는다.
 *  · 키가 없거나 호출이 실패하면 로컬 문장 추출로 조용히 대체한다 (오프라인 학교망 OK).
 *
 *  POST /api/ai/summaries        { text, force? } → { ok, key, lines, source, cached, privacy }
 *  GET  /api/ai/summaries/:key                    → 캐시만 즉시 조회 (없으면 404)
 */
const express = require('express');
const crypto = require('crypto');
const { row, run } = require('../db');
const { maskSensitive } = require('../ai-shared');

const TEXT_MAX = 8000;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/* ---------- 로컬 폴백 요약 (Gemini 불가 시) ---------- */
function cleanLine(s) {
  let t = String(s || '')
    .replace(/^\s*(?:\d{1,3}[.)\]]\s*|[*•·\-–—]\s*)/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > 96) t = t.slice(0, 95) + '…';
  return t;
}

const KEY_HINTS = ['까지','마감','기한','일시','날짜','시간','장소','대상','신청','제출','참석','준비물','변경','취소','주의','필수'];
const FILLER_ONLY = /^(안녕하세요|안녕하십니까|알려드립니다|안내드립니다|공지합니다|감사합니다|고맙습니다|이상입니다|수고하셨습니다)[.!]?$/;

function cleanSegment(s) {
  return String(s || '')
    .replace(/^\s*(?:\d{1,3}[.)\]]\s*|[*•·\-–—]\s*)/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compressLine(s) {
  let t = cleanLine(s)
    .replace(/^(안녕하세요|안녕하십니까|알려드립니다|안내드립니다|공지합니다)[.!]?\s*/, '')
    .replace(/\s*(감사합니다|고맙습니다|부탁드립니다|바랍니다|주시기 바랍니다|해 주시기 바랍니다|해주시기 바랍니다)[.!]?$/, '')
    .replace(/\s*(해 주세요|해주세요|하시기 바랍니다)[.!]?$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > 78) {
    const cut = Math.max(t.lastIndexOf(',', 78), t.lastIndexOf('·', 78), t.lastIndexOf(' ', 62));
    t = (cut > 40 ? t.slice(0, cut) : t.slice(0, 77)).trim() + '…';
  }
  return t;
}

function toUnits(text) {
  const plain = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!plain) return [];
  let segments = plain
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?。！？])\s+/))
    .map(cleanSegment)
    .filter((s) => s.length >= 4 && !FILLER_ONLY.test(s) && !(s.length <= 26 && /(알려|안내|전달)드립니다[.!]?$/.test(s)));
  if (segments.length <= 1 && plain.length > 120) {
    segments = plain.split(/[,;]\s*|\s{2,}/).map(cleanSegment).filter((s) => s.length >= 8);
  }
  const units = [];
  let buf = '';
  for (const seg of segments) {
    if (!buf) buf = seg;
    else if (buf.length < 42 && !/[.!?。！？]$/.test(buf)) buf = buf + ' ' + seg;
    else { units.push(buf); buf = seg; }
  }
  if (buf) units.push(buf);
  return units;
}

function stemKo(w) {
  const stripped = w.replace(/(으로|에서|에게|까지|부터|보다|처럼|이며|이고|합니다|입니다|했다|한다|하는|하여|하고|으로써|은|는|이|가|을|를|의|에|께|로|와|과|도|만)$/u, '');
  return stripped.length > 1 ? stripped : w;
}

function tokenize(s) {
  const STOP = new Set(['그리고','그러나','하지만','또한','또는','및','등','위해','대한','통해','관련','에서','으로','에게','the','a','an','and','or','but','of','to','in','on','at','for','with','by','is','are','was','were']);
  return (String(s).toLowerCase().match(/[a-z가-힣0-9]+/g) || [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stemKo)
    .filter((w) => w.length > 1);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function localSummary(text) {
  const units = toUnits(text);
  if (!units.length) return [];
  const freq = new Map();
  for (const u of units) for (const w of tokenize(u)) freq.set(w, (freq.get(w) || 0) + 1);
  const maxFreq = Math.max(1, ...freq.values());
  const scored = units.map((s, idx) => {
    const words = tokenize(s);
    const avgFreq = words.reduce((acc, w) => acc + (freq.get(w) || 0), 0) / Math.max(1, words.length);
    const hintHits = KEY_HINTS.reduce((acc, h) => acc + (s.includes(h) ? 1 : 0), 0);
    const keyBoost = Math.min(0.36, hintHits * 0.12);
    const positionBoost = idx === 0 ? 0.1 : idx === 1 ? 0.05 : 0;
    const lengthPenalty = words.length < 4 ? -0.12 : words.length > 45 ? -0.08 : 0;
    const looksLikeTitle = !/[.!?。！？]$/.test(s) && !/(합니다|입니다|됩니다|해요|이며|이고|있습니다|없습니다|하세요|주세요|까지|부터|에서|으로|에게)$/.test(s) && words.length <= 8;
    const titlePenalty = looksLikeTitle ? -0.18 : 0;
    return { idx, s, words: new Set(words), score: (avgFreq / maxFreq) * 0.6 + keyBoost + positionBoost + lengthPenalty + titlePenalty };
  });
  const picked = [];
  for (const cand of scored.slice().sort((a, b) => b.score - a.score)) {
    if (picked.length >= 3) break;
    if (picked.some((p) => jaccard(p.words, cand.words) > 0.5)) continue;
    picked.push(cand);
  }
  picked.sort((a, b) => a.idx - b.idx);
  const out = picked.map((p) => compressLine(p.s)).filter(Boolean);
  const seen = new Set();
  const unique = out.filter((l) => {
    const k = l.replace(/[\s.,!?~…]/g, '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.slice(0, 3);
}

/* ---------- Gemini 호출 (실패하면 null → 로컬 폴백) ---------- */
async function callGemini(maskedText, model, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const prompt =
      '너는 학교 행정 공지를 요약하는 도우미다. 아래 공지를 학부모·교사가 3초에 파악할 수 있게 ' +
      '핵심만 한국어 3줄 이내로 요약해라. 각 줄은 60자 이내, 번호나 불릿 기호 없이 줄바꿈으로만 구분해라. ' +
      '날짜·장소·제출기한·대상이 있으면 반드시 포함해라.\n\n공지:\n' + maskedText;
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt =
      (data && data.candidates && data.candidates[0] && data.candidates[0].content &&
        Array.isArray(data.candidates[0].content.parts)
        ? data.candidates[0].content.parts.map((x) => (x && x.text) || '').join('\n')
        : '') || '';
    const lines = txt.split(/\n+/).map(cleanLine).filter(Boolean).slice(0, 3);
    return lines.length ? lines : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function safeLines(json) {
  try {
    const arr = JSON.parse(String(json || '[]'));
    return Array.isArray(arr) ? arr.map((x) => String(x)).slice(0, 3) : [];
  } catch (e) {
    return [];
  }
}

function clientIp(req) {
  try {
    return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '') || 'unknown';
  } catch (e) { return 'unknown'; }
}

function writeAudit(req, actor, action, detail) {
  try {
    run(
      `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      String(actor && actor.id != null ? actor.id : 'system'),
      String((actor && actor.real_name) || ''),
      String(action), 'ai', '', JSON.stringify(detail || {}), clientIp(req)
    );
  } catch (e) { /* 감사 실패는 본 동작을 막지 않는다 */ }
}

module.exports = function createSummariesRouter({ needAuth, needStaff, aiLimiter }) {
  const router = express.Router();
  const limitAi = typeof aiLimiter === 'function' ? aiLimiter : (req, res, next) => next();
  router.use(needAuth);
  if (needStaff) router.use(needStaff);

  /* GET /api/ai/summaries/:key — 캐시 전용(즉시). 없으면 404 → 클라이언트가 POST로 생성 요청 */
  router.get('/:key', (req, res) => {
    try {
      const key = String(req.params.key || '').trim().slice(0, 64);
      if (!key) return res.status(400).json({ ok: false, error: '요약 키가 없어요.' });
      const hit = row('SELECT lines, source, model, masked_count, created_at FROM ai_summaries WHERE cache_key = ?', key);
      if (!hit) return res.status(404).json({ ok: false, error: '저장된 요약이 없어요.' });
      res.json({
        ok: true, key,
        lines: safeLines(hit.lines),
        source: String(hit.source || 'local'),
        cached: true,
        model: String(hit.model || ''),
        privacy: { masked: Number(hit.masked_count) || 0 },
        createdAt: hit.created_at,
      });
    } catch (e) {
      console.error('[summaries] get error:', e);
      res.status(500).json({ ok: false, error: '요약을 불러오지 못했어요.' });
    }
  });

  /* POST /api/ai/summaries — 캐시 확인 → (없으면) 마스킹 → Gemini 1회 → DB 저장 */
  router.post('/', limitAi, async (req, res) => {
    try {
      const body = req.body || {};
      const raw = String(body.text || '').slice(0, TEXT_MAX).replace(/\r\n/g, '\n');
      if (!raw.trim()) return res.status(400).json({ ok: false, error: '요약할 공지 내용이 없어요.' });

      const { masked, hits, total } = maskSensitive(raw);
      const key = crypto.createHash('sha256').update(masked).digest('hex').slice(0, 32) + ':v2';
      const force = body.force === true;

      if (!force) {
        const hit = row('SELECT lines, source, model, masked_count FROM ai_summaries WHERE cache_key = ?', key);
        if (hit) {
          return res.json({
            ok: true, key,
            lines: safeLines(hit.lines),
            source: String(hit.source || 'local'),
            cached: true,
            model: String(hit.model || ''),
            privacy: { masked: Number(hit.masked_count) || 0, ...hits },
          });
        }
      }

      const envKey = String(process.env.GEMINI_API_KEY || '').trim();
      const model = String(process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim();
      let source = 'local';
      let lines = null;
      if (envKey.length > 8) {
        lines = await callGemini(masked, model, envKey);
        if (lines) source = 'gemini';
      }
      if (!lines) lines = localSummary(masked);
      if (!lines.length) lines = [cleanLine(masked.slice(0, 90)) || '요약할 내용이 없어요.'];

      try {
        run(
          `INSERT INTO ai_summaries (cache_key, lines, source, model, masked_count)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(cache_key) DO UPDATE SET
             lines = excluded.lines, source = excluded.source, model = excluded.model,
             masked_count = excluded.masked_count, created_at = datetime('now','localtime')`,
          key, JSON.stringify(lines), source, source === 'gemini' ? model : '', total
        );
      } catch (e) { /* 캐시 저장 실패는 응답을 막지 않는다 */ }

      writeAudit(req, req.user, 'ai_summary', {
        key, source, masked: total, hits,
        model: source === 'gemini' ? model : 'local',
      });

      res.json({
        ok: true, key, lines, source,
        cached: false,
        model: source === 'gemini' ? model : '',
        privacy: { masked: total, ...hits },
      });
    } catch (e) {
      console.error('[summaries] post error:', e);
      res.status(500).json({ ok: false, error: '요약을 만들지 못했어요.' });
    }
  });

  return router;
};
