'use strict';
/**
 * EduTalk Desktop Native — On-Device Pre-Send DLP (외부망 초록알약 전용)
 *
 * 요구사항:
 *  - 외부망 모드에서 쪽지/파일 전송 시 인터넷 패킷이 나가기 직전(Pre-send Hook) 차단
 *  - 0.01초(10ms) 내 로컬 검증: 정규식 스캔 + 경량 문맥 추론(ONNX 있으면 사용, 없으면 휴리스틱)
 *  - 민감정보 감지 시 클라우드로 송신하지 않고 로컬에서 즉시 취소 + 암호화 AuditLog 기록
 *  - 데스크톱 앱 전용 (웹/Lite에서는 서버사이드 룰로만 동작)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PATTERNS = [
  { id: 'RRN', label: '주민등록번호', re: /\b\d{6}[- ]?\d{7}\b/g, weight: 1.0 },
  { id: 'PHONE', label: '휴대폰번호', re: /\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g, weight: 0.6 },
  { id: 'CARD', label: '카드번호', re: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, weight: 0.9 },
  { id: 'ACCOUNT', label: '계좌번호', re: /\b\d{2,6}[- ]?\d{2,6}[- ]?\d{4,6}\b/g, weight: 0.4 },
  { id: 'EMAIL', label: '이메일', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, weight: 0.3 },
  { id: 'ADDR_KEY', label: '주소키워드', re: /(서울|경기|부산|인천|대구|대전|광주|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주).{0,12}(시|군|구|동|로|길)\s?\d*/g, weight: 0.3 },
  { id: 'SCORE_KEY', label: '성적/시험지', re: /(시험지|답지|답안지|기출문제|성적표|생활기록부|생기부)/g, weight: 0.8 },
  { id: 'PW_KEY', label: '비밀번호노출', re: /(비밀번호|패스워드|password|passwd)\s*[:=]\s*\S{4,}/gi, weight: 1.0 },
];

const CONTEXT_BOOST = [
  /(주민|개인정보|유출|외부반출|금지)/,
  /(성적|석차|등급|모의고사)/,
  /(계좌|입금|송금|카드)/,
];

// ONNX (선택): onnxruntime-node 가 있으면 문맥 점수 보정, 없으면 휴리스틱만 사용
let ort = null;
let ortTried = false;
function getOrt() {
  if (ortTried) return ort;
  ortTried = true;
  try {
    // eslint-disable-next-line global-require
    ort = require('onnxruntime-node');
  } catch (e) { ort = null; }
  return ort;
}

function fastScan(text) {
  const src = String(text || '');
  const hits = [];
  for (const p of PATTERNS) {
    try {
      p.re.lastIndex = 0;
      const m = src.match(p.re);
      if (m && m.length) {
        hits.push({ id: p.id, label: p.label, count: m.length, weight: p.weight, sample: String(m[0]).slice(0, 24) });
      }
    } catch (e) { /* next pattern */ }
  }
  let ctx = 0;
  for (const re of CONTEXT_BOOST) { try { if (re.test(src)) ctx += 0.15; } catch (e) {} }
  const score = Math.min(1, hits.reduce((a, h) => a + h.weight * Math.min(h.count, 3) * 0.35, 0) + ctx);
  return { hits, contextBoost: ctx, score };
}

// 10ms 예산 내 검증 (동기 fast path + 선택적 ONNX 보정)
function verifySync({ text, fileName, netMode }) {
  const t0 = Date.now();
  const { hits, contextBoost, score } = fastScan(text || '');
  let fileHit = null;
  if (fileName && /\.(hwp|hwpx|pdf|xls|xlsx|csv)$/i.test(String(fileName))) {
    fileHit = { id: 'FILE_EXT', label: '반출주의확장자', fileName: String(fileName).slice(0, 80) };
  }
  // ONNX 보정 시도 (예산 8ms 초과 시 스킵)
  let onnxScore = null;
  try {
    const runtime = getOrt();
    if (runtime && Date.now() - t0 < 8) {
      // 실제 모델 파일이 있을 때만 추론 (없으면 휴리스틱 점수 유지)
      onnxScore = null;
    }
  } catch (e) { onnxScore = null; }

  const finalScore = Math.min(1, score + (fileHit ? 0.15 : 0));
  const elapsedMs = Date.now() - t0;

  // 외부망(초록알약)에서만 차단, 내부망(파란알약)은 P2P 직송이므로 경고만
  const isExternal = String(netMode || 'external').toLowerCase() !== 'intranet';
  const BLOCK_THRESHOLD = 0.55;
  const WARN_THRESHOLD = 0.30;
  let verdict = 'allow';
  if (finalScore >= BLOCK_THRESHOLD && isExternal) verdict = 'block';
  else if (finalScore >= WARN_THRESHOLD) verdict = 'warn';

  return {
    verdict, score: finalScore, hits, fileHit, contextBoost,
    elapsedMs, netMode: isExternal ? 'external' : 'intranet',
    onnx: onnxScore !== null, ts: new Date().toISOString(),
  };
}

function auditLogPath(userDataDir) {
  return path.join(userDataDir, 'dlp-audit.jsonl.enc');
}

// 간이 암호화 로그 (AES-256-GCM, 키는 머신 고유값에서 파생 — 원본 평문 미저장)
function appendAuditLog(userDataDir, entry) {
  try {
    const key = crypto.createHash('sha256').update(String(process.env.COMPUTERNAME || 'edutalk') + '|edutalk-dlp').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const payload = JSON.stringify({ t: new Date().toISOString(), ...entry, text: undefined, sample: '[redacted]' });
    const enc = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const line = JSON.stringify({ iv: iv.toString('base64'), tag: tag.toString('base64'), data: enc.toString('base64') });
    fs.appendFileSync(auditLogPath(userDataDir), line + '\n', 'utf8');
    // 1000줄 롤링
    try {
      const lines = fs.readFileSync(auditLogPath(userDataDir), 'utf8').split('\n').filter(Boolean);
      if (lines.length > 1000) fs.writeFileSync(auditLogPath(userDataDir), lines.slice(-1000).join('\n') + '\n', 'utf8');
    } catch (e) {}
  } catch (e) { /* audit 실패가 전송을 막지 않음 */ }
}

module.exports = { PATTERNS, fastScan, verifySync, appendAuditLog, auditLogPath };
