'use strict';
/* 협업 보드 공용 로직 — REST(/api/whiteboards)와 Socket.io가 같은 검증·저장 규칙을 쓴다.
 *
 *  · 좌표·크기·색·글자 길이를 서버에서 강제해 악의적인 거대 JSON/스크립트 문자열을 막는다.
 *  · version을 이용한 낙관적 잠금으로 두 교사가 동시에 저장할 때 덮어쓰기를 막는다.
 *  · React가 텍스트를 이스케이프해 렌더하므로 HTML을 저장하지 않는다. */
const crypto = require('crypto');
const { row, all, run } = require('./db');

const KINDS = new Set(['seating', 'groups', 'supervision', 'free']);
const ITEM_TYPES = new Set(['seat', 'group', 'label', 'table']);
const COLORS = new Set(['#0082c8', '#7c5cff', '#22b07d', '#f59e0b', '#ec4899', '#64748b', '#ef4444', '#0ea5e9']);
const MAX_ITEMS = 240;
const MAX_DATA_BYTES = 120 * 1024;

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function colorOf(value) {
  const v = String(value || '').toLowerCase();
  return COLORS.has(v) ? v : '#0082c8';
}

function idOf(value, index) {
  const raw = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return raw || `it-${Date.now().toString(36)}-${index}`;
}

function sanitizeItem(raw, index) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const type = ITEM_TYPES.has(String(it.type)) ? String(it.type) : 'seat';
  return {
    id: idOf(it.id, index),
    type,
    x: clampInt(it.x, 0, 4000, 40),
    y: clampInt(it.y, 0, 4000, 40),
    w: clampInt(it.w, 40, 620, type === 'group' ? 210 : 120),
    h: clampInt(it.h, 36, 420, type === 'group' ? 140 : 84),
    label: cleanText(it.label, 48),
    sublabel: cleanText(it.sublabel, 80),
    color: colorOf(it.color),
  };
}

/** 저장 전 보드 JSON을 정규화한다. 반환값은 항상 {background, items}. */
function sanitizeData(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const items = [];
  const seen = new Set();
  const list = Array.isArray(src.items) ? src.items.slice(0, MAX_ITEMS) : [];
  list.forEach((item, index) => {
    const safe = sanitizeItem(item, index);
    if (seen.has(safe.id)) safe.id = `${safe.id}-${index}`;
    seen.add(safe.id);
    items.push(safe);
  });
  return {
    background: src.background === 'plain' ? 'plain' : 'grid',
    items,
  };
}

function dataBytes(data) {
  try { return Buffer.byteLength(JSON.stringify(data), 'utf8'); } catch (e) { return Infinity; }
}

function parseData(text) {
  try {
    const data = sanitizeData(JSON.parse(String(text || '{}')));
    return data;
  } catch (e) {
    return { background: 'grid', items: [] };
  }
}

function templateData(kind) {
  if (kind === 'groups') {
    return {
      background: 'grid',
      items: [0, 1, 2, 3].map((i) => ({
        id: `group-${i + 1}`,
        type: 'group',
        x: 40 + (i % 2) * 250,
        y: 40 + Math.floor(i / 2) * 190,
        w: 210,
        h: 140,
        label: `${i + 1}모둠`,
        sublabel: '모둠원 이름을 적어 주세요',
        color: ['#0082c8', '#7c5cff', '#22b07d', '#f59e0b'][i],
      })),
    };
  }
  if (kind === 'supervision') {
    return {
      background: 'grid',
      items: [0, 1, 2, 3, 4, 5].map((i) => ({
        id: `supervision-${i + 1}`,
        type: 'table',
        x: 40 + (i % 3) * 180,
        y: 40 + Math.floor(i / 3) * 140,
        w: 150,
        h: 90,
        label: `${i + 1}감독`,
        sublabel: '교실 · 감독 교사',
        color: '#64748b',
      })),
    };
  }
  if (kind === 'seating') {
    return {
      background: 'grid',
      items: Array.from({ length: 12 }, (_, i) => ({
        id: `seat-${i + 1}`,
        type: 'seat',
        x: 40 + (i % 4) * 140,
        y: 40 + Math.floor(i / 4) * 110,
        w: 112,
        h: 82,
        label: `${i + 1}`,
        sublabel: '학생',
        color: '#0082c8',
      })),
    };
  }
  return { background: 'grid', items: [] };
}

function sanitizeTitle(value) {
  return cleanText(value, 60) || '이름 없는 보드';
}

function sanitizeKind(value) {
  return KINDS.has(String(value)) ? String(value) : 'free';
}

function boardOut(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    title: String(r.title || ''),
    kind: String(r.kind || 'free'),
    data: parseData(r.data),
    version: Number(r.version) || 1,
    createdByName: String(r.created_by_name || ''),
    updatedByName: String(r.updated_by_name || ''),
    createdAt: String(r.created_at || ''),
    updatedAt: String(r.updated_at || ''),
  };
}

function listBoards(limit = 60) {
  return all(
    `SELECT id, title, kind, version, created_by_name, updated_by_name, created_at, updated_at
     FROM whiteboards ORDER BY updated_at DESC, id DESC LIMIT ?`,
    Math.max(1, Math.min(100, Number(limit) || 60))
  ).map((r) => ({
    id: String(r.id),
    title: String(r.title || ''),
    kind: String(r.kind || 'free'),
    version: Number(r.version) || 1,
    createdByName: String(r.created_by_name || ''),
    updatedByName: String(r.updated_by_name || ''),
    createdAt: String(r.created_at || ''),
    updatedAt: String(r.updated_at || ''),
  }));
}

function getBoard(id) {
  return boardOut(row('SELECT * FROM whiteboards WHERE id = ?', String(id || '')));
}

function createBoard({ title, kind, user }) {
  const safeKind = sanitizeKind(kind);
  const id = `wb-${crypto.randomBytes(6).toString('hex')}`;
  const data = templateData(safeKind);
  run(
    `INSERT INTO whiteboards (id, title, kind, data, version, created_by, created_by_name, updated_by_name)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    id,
    sanitizeTitle(title),
    safeKind,
    JSON.stringify(data),
    user && user.id != null ? Number(user.id) : null,
    cleanText(user && (user.real_name || user.username), 80),
    cleanText(user && (user.real_name || user.username), 80)
  );
  return getBoard(id);
}

/**
 * 보드 저장. expectedVersion이 현재 version과 다르면 conflict를 돌려준다.
 * @returns {{ok:true, board:object}|{ok:false, conflict:true, board:object}}
 */
function updateBoard({ id, data, expectedVersion, user, title }) {
  const safe = sanitizeData(data);
  if (dataBytes(safe) > MAX_DATA_BYTES) {
    const err = new Error('보드 내용이 너무 커요. 항목을 조금 줄여 주세요.');
    err.code = 'TOO_LARGE';
    throw err;
  }
  const boardId = String(id || '');
  const current = getBoard(boardId);
  if (!current) {
    const err = new Error('보드를 찾지 못했어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const expected = Number(expectedVersion);
  if (Number.isInteger(expected) && expected > 0 && expected !== current.version) {
    return { ok: false, conflict: true, board: current };
  }
  const name = cleanText(user && (user.real_name || user.username), 80);
  const nextTitle = title === undefined ? current.title : sanitizeTitle(title);
  const r = run(
    `UPDATE whiteboards
     SET title = ?, data = ?, version = version + 1, updated_by_name = ?, updated_at = datetime('now','localtime')
     WHERE id = ? AND version = ?`,
    nextTitle,
    JSON.stringify(safe),
    name,
    boardId,
    current.version
  );
  if (!Number(r.changes)) {
    return { ok: false, conflict: true, board: getBoard(boardId) };
  }
  return { ok: true, board: getBoard(boardId) };
}

function deleteBoard(id) {
  const r = run('DELETE FROM whiteboards WHERE id = ?', String(id || ''));
  return Number(r.changes) > 0;
}

module.exports = {
  KINDS,
  MAX_DATA_BYTES,
  cleanText,
  sanitizeData,
  sanitizeTitle,
  sanitizeKind,
  templateData,
  listBoards,
  getBoard,
  createBoard,
  updateBoard,
  deleteBoard,
};
