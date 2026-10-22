'use strict';
/* AI 상담 일지 — /api/consultations
 *
 *  · 상담 원문은 학교 서버 SQLite에만 저장한다. 작성자와 관리자만 열람한다.
 *  · Gemini로 보내기 전에 주민등록번호·휴대폰·카드번호를 서버에서 마스킹한다.
 *  · Gemini 키가 없거나 호출이 실패하면 로컬 문장 분류로 조용히 대체한다.
 *  · 요약은 [핵심 고민, 관찰한 점, 후속 조치] 세 묶음으로 정리한다.
 */
const express = require('express');
const { row, all, run } = require('../db');
const { maskSensitive, cleanLine } = require('../ai-shared');
const { writeAudit } = require('../audit');

const TEXT_MAX = 12000;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const CONTACT_TYPES = new Set(['student', 'parent', 'guardian', 'other']);

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanMultiline(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function normalizeList(value, max) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of arr) {
    const line = cleanLine(item);
    if (line && !out.includes(line)) out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeSummary(value) {
  const src = value && typeof value === 'object' ? value : {};
  return {
    concerns: normalizeList(src.concerns, 3),
    observations: normalizeList(src.observations, 3),
    actions: normalizeList(src.actions, 3),
  };
}

function sentenceList(text) {
  const plain = String(text || '').replace(/\s+/g, ' ').trim();
  if (!plain) return [];
  const parts = plain
    .split(/(?<=[.!?。！？])\s+|[\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (parts.length) return parts;
  const chunks = [];
  for (let i = 0; i < plain.length && chunks.length < 12; i += 90) chunks.push(plain.slice(i, i + 90));
  return chunks;
}

const CONCERN_RE = /(걱정|고민|어려|불안|힘들|갈등|싸움|울|거부|무단|결석|위축|외로|스트레스|공격|욕설|자해|폭력)/;
const ACTION_RE = /(상담|연락|지도|지원|검사|의뢰|관찰|예정|필요|권장|가정|학부모|보호자|후속|안내|교육)/;

/** Gemini가 없을 때도 상담 기록을 세 묶음으로 나눠 준다. */
function localConsultSummary(masked) {
  const concerns = [];
  const observations = [];
  const actions = [];
  for (const sentence of sentenceList(masked)) {
    const line = cleanLine(sentence);
    if (!line) continue;
    if (ACTION_RE.test(line) && actions.length < 3) actions.push(line);
    else if (CONCERN_RE.test(line) && concerns.length < 3) concerns.push(line);
    else if (observations.length < 3) observations.push(line);
    if (concerns.length >= 3 && observations.length >= 3 && actions.length >= 3) break;
  }
  if (!concerns.length && observations.length) concerns.push(observations[0]);
  if (!observations.length && concerns.length) observations.push(concerns[0]);
  if (!actions.length && concerns.length) actions.push('다음 상담에서 변화를 함께 확인해요.');
  return { concerns: concerns.slice(0, 3), observations: observations.slice(0, 3), actions: actions.slice(0, 3) };
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch (e) { return null; }
}

async function callGeminiConsult(masked, model, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const prompt =
      '너는 학교 교사의 상담 일지를 정리하는 도우미다. 아래 상담 기록을 읽고 ' +
      '반드시 JSON 객체만 출력해라. 형식은 {"concerns":[],"observations":[],"actions":[]} 이다. ' +
      'concerns에는 학생의 핵심 고민·어려움, observations에는 교사가 관찰한 사실, ' +
      'actions에는 앞으로의 지원·연락·지도 계획을 넣어라. 각 배열은 최대 3개, 각 항목은 80자 이내의 한국어다. ' +
      '이름·전화번호·주민등록번호 같은 개인정보를 새로 만들거나 추측하지 말고, 확인되지 않은 사실은 쓰지 마라.\n\n' +
      '상담 기록:\n' + masked;
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 640,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      Array.isArray(data.candidates[0].content.parts)
      ? data.candidates[0].content.parts.map((x) => (x && x.text) || '').join('\n')
      : '';
    const parsed = parseJsonObject(txt);
    if (!parsed) return null;
    const summary = normalizeSummary(parsed);
    return (summary.concerns.length || summary.observations.length || summary.actions.length) ? summary : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function rowToLog(r) {
  let summary = { concerns: [], observations: [], actions: [] };
  try { summary = normalizeSummary(JSON.parse(String(r.summary_json || '{}'))); } catch (e) { /* 기본값 */ }
  return {
    id: Number(r.id),
    authorId: Number(r.author_id),
    authorName: String(r.author_name || ''),
    studentName: String(r.student_name || ''),
    contactType: String(r.contact_type || 'student'),
    topic: String(r.topic || ''),
    rawText: String(r.raw_text || ''),
    summary,
    source: String(r.source || 'local'),
    maskedCount: Number(r.masked_count) || 0,
    createdAt: String(r.created_at || ''),
  };
}

function isAdmin(user) {
  return String((user && user.role) || '').toUpperCase() === 'ADMIN';
}

module.exports = function createConsultationsRouter({ needAuth, needStaff, aiLimiter }) {
  const router = express.Router();
  const limitAi = typeof aiLimiter === 'function' ? aiLimiter : (req, res, next) => next();
  router.use(needAuth);
  if (needStaff) router.use(needStaff);

  /* POST /api/consultations/summarize — 저장 전 AI 미리보기 */
  router.post('/summarize', limitAi, async (req, res) => {
    try {
      const raw = cleanMultiline((req.body || {}).text, TEXT_MAX);
      if (!raw) return res.status(400).json({ ok: false, error: '상담 내용을 먼저 적어 주세요.' });
      const { masked, hits, total } = maskSensitive(raw);
      const envKey = String(process.env.GEMINI_API_KEY || '').trim();
      const model = String(process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim();
      let source = 'local';
      let summary = null;
      if (envKey.length > 8) {
        summary = await callGeminiConsult(masked, model, envKey);
        if (summary) source = 'gemini';
      }
      if (!summary) summary = localConsultSummary(masked);
      writeAudit(req, req.user, 'consult_summary', 'consultation', '', {
        source, masked: total, hits, chars: raw.length,
      });
      res.json({
        ok: true,
        summary,
        source,
        model: source === 'gemini' ? model : '',
        privacy: { masked: total, ...hits },
      });
    } catch (e) {
      console.error('[consultations] summarize error:', e);
      res.status(500).json({ ok: false, error: '상담 내용을 정리하지 못했어요.' });
    }
  });

  /* GET /api/consultations — 내 일지 목록 (관리자는 ?all=1로 전체) */
  router.get('/', (req, res) => {
    try {
      const wantsAll = (String(req.query.all || '') === '1' || String(req.query.scope || '') === 'all') && isAdmin(req.user);
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 80));
      const rows = wantsAll
        ? all('SELECT * FROM consultation_logs ORDER BY id DESC LIMIT ?', limit)
        : all('SELECT * FROM consultation_logs WHERE author_id = ? ORDER BY id DESC LIMIT ?', req.user.id, limit);
      res.json({ ok: true, logs: rows.map(rowToLog), scope: wantsAll ? 'all' : 'mine' });
    } catch (e) {
      console.error('[consultations] list error:', e);
      res.status(500).json({ ok: false, error: '상담 일지를 불러오지 못했어요.' });
    }
  });

  /* POST /api/consultations — 일지 저장 */
  router.post('/', (req, res) => {
    try {
      const body = req.body || {};
      const studentName = cleanText(body.studentName, 80);
      const topic = cleanText(body.topic, 120);
      const rawText = cleanMultiline(body.rawText, TEXT_MAX);
      const contactType = CONTACT_TYPES.has(String(body.contactType)) ? String(body.contactType) : 'student';
      if (!studentName) return res.status(400).json({ ok: false, error: '학생 이름을 적어 주세요.' });
      if (!rawText) return res.status(400).json({ ok: false, error: '상담 내용을 적어 주세요.' });
      let summary = normalizeSummary(body.summary);
      if (!summary.concerns.length && !summary.observations.length && !summary.actions.length) {
        summary = localConsultSummary(maskSensitive(rawText).masked);
      }
      const source = ['gemini', 'local', 'error'].includes(String(body.source)) ? String(body.source) : 'local';
      // 클라이언트가 보낸 숫자를 믿지 않고 서버에서 다시 마스킹해 실제 건수를 기록한다.
      const maskedCount = maskSensitive(rawText).total;
      const r = run(
        `INSERT INTO consultation_logs
           (author_id, author_name, student_name, contact_type, topic, raw_text, summary_json, source, masked_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.user.id,
        String(req.user.real_name || req.user.username || ''),
        studentName,
        contactType,
        topic,
        rawText,
        JSON.stringify(summary),
        source,
        maskedCount
      );
      const saved = row('SELECT * FROM consultation_logs WHERE id = ?', Number(r.lastInsertRowid));
      writeAudit(req, req.user, 'consult_create', 'consultation', Number(r.lastInsertRowid), {
        contactType, source, masked: maskedCount, chars: rawText.length,
      });
      res.json({ ok: true, log: rowToLog(saved) });
    } catch (e) {
      console.error('[consultations] create error:', e);
      res.status(500).json({ ok: false, error: '상담 일지를 저장하지 못했어요.' });
    }
  });

  /* GET /api/consultations/:id — 작성자 또는 관리자만 */
  router.get('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: '일지 번호가 올바르지 않아요.' });
      const hit = row('SELECT * FROM consultation_logs WHERE id = ?', id);
      if (!hit) return res.status(404).json({ ok: false, error: '상담 일지를 찾지 못했어요.' });
      if (Number(hit.author_id) !== Number(req.user.id) && !isAdmin(req.user)) {
        return res.status(403).json({ ok: false, error: '이 상담 일지를 볼 권한이 없어요.' });
      }
      res.json({ ok: true, log: rowToLog(hit) });
    } catch (e) {
      res.status(500).json({ ok: false, error: '상담 일지를 불러오지 못했어요.' });
    }
  });

  /* PUT /api/consultations/:id — 작성자만 수정 */
  router.put('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: '일지 번호가 올바르지 않아요.' });
      const hit = row('SELECT * FROM consultation_logs WHERE id = ?', id);
      if (!hit) return res.status(404).json({ ok: false, error: '상담 일지를 찾지 못했어요.' });
      if (Number(hit.author_id) !== Number(req.user.id)) {
        return res.status(403).json({ ok: false, error: '내가 쓴 상담 일지만 수정할 수 있어요.' });
      }
      const body = req.body || {};
      const studentName = cleanText(body.studentName, 80) || String(hit.student_name || '');
      const topic = cleanText(body.topic, 120);
      const rawText = cleanMultiline(body.rawText, TEXT_MAX) || String(hit.raw_text || '');
      const contactType = CONTACT_TYPES.has(String(body.contactType)) ? String(body.contactType) : String(hit.contact_type || 'student');
      const summary = normalizeSummary(body.summary);
      run(
        `UPDATE consultation_logs
         SET student_name = ?, contact_type = ?, topic = ?, raw_text = ?, summary_json = ?, source = ?
         WHERE id = ?`,
        studentName,
        contactType,
        topic,
        rawText,
        JSON.stringify(summary),
        ['gemini', 'local', 'error'].includes(String(body.source)) ? String(body.source) : String(hit.source || 'local'),
        id
      );
      writeAudit(req, req.user, 'consult_update', 'consultation', id, { chars: rawText.length });
      res.json({ ok: true, log: rowToLog(row('SELECT * FROM consultation_logs WHERE id = ?', id)) });
    } catch (e) {
      console.error('[consultations] update error:', e);
      res.status(500).json({ ok: false, error: '상담 일지를 수정하지 못했어요.' });
    }
  });

  /* DELETE /api/consultations/:id — 작성자 또는 관리자 */
  router.delete('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: '일지 번호가 올바르지 않아요.' });
      const hit = row('SELECT author_id FROM consultation_logs WHERE id = ?', id);
      if (!hit) return res.status(404).json({ ok: false, error: '상담 일지를 찾지 못했어요.' });
      if (Number(hit.author_id) !== Number(req.user.id) && !isAdmin(req.user)) {
        return res.status(403).json({ ok: false, error: '이 상담 일지를 삭제할 권한이 없어요.' });
      }
      run('DELETE FROM consultation_logs WHERE id = ?', id);
      writeAudit(req, req.user, 'consult_delete', 'consultation', id, {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: '상담 일지를 삭제하지 못했어요.' });
    }
  });

  return router;
};
