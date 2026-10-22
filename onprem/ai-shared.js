'use strict';
/* AI 공통 유틸 — 공지 요약과 상담 일지가 같은 민감정보 마스킹 규칙을 쓴다.
 *  · 카드(16자리) → 주민등록번호(13자리) → 휴대폰 순서로 검사한다.
 *  · 원문은 어디에도 저장하지 않고, 마스킹된 텍스트만 Gemini로 보낸다. */

const CARD_RE = /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g;
const RRN_RE = /\d{6}[- ]?\d{7}/g;
const PHONE_RE = /01[016789][- .]?\d{3,4}[- .]?\d{4}/g;

function maskSensitive(text) {
  const hits = { card: 0, rrn: 0, phone: 0 };
  let masked = String(text || '');
  masked = masked.replace(CARD_RE, () => { hits.card++; return '****-****-****-****'; });
  masked = masked.replace(RRN_RE, () => { hits.rrn++; return '******-*******'; });
  masked = masked.replace(PHONE_RE, () => { hits.phone++; return '010-****-****'; });
  const total = hits.card + hits.rrn + hits.phone;
  return { masked, hits, total };
}

function cleanLine(value) {
  let t = String(value || '')
    .replace(/^[\s>*•·\-–—\d.)\]]+/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > 120) t = t.slice(0, 119) + '…';
  return t;
}

module.exports = { maskSensitive, cleanLine };
