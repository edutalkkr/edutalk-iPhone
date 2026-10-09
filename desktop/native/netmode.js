'use strict';
/**
 * EduTalk Desktop Native — 네트워크 모드 (파란알약/초록알약) + 로컬 DB
 *  - intranet(파란): 교내 내부망, P2P 직송 우선, 클라우드 송신 금지
 *  - external(초록): 외부망, Pre-Send DLP 필수 경유
 *  - SQLite가 있으면 SQLite, 없으면 JSON 파일 폴백 (오프라인 0.001초 부팅용)
 */

const fs = require('fs');
const path = require('path');

function detectNetMode() {
  const forced = String(process.env.EDUTALK_NET || '').toLowerCase();
  if (forced === 'intranet' || forced === 'blue') return 'intranet';
  if (forced === 'external' || forced === 'green') return 'external';
  // 휴리스틱: 10.x / 172.16-31.x / 192.168.x 면 intranet 후보 (최종판정은 메인에서 핑으로 확정)
  try {
    const os = require('os');
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const ni of ifs[name] || []) {
        if (ni.family !== 'IPv4' || ni.internal) continue;
        const ip = String(ni.address);
        if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip)) return 'intranet';
      }
    }
  } catch (e) {}
  return 'external';
}

function openLocalDb(userDataDir) {
  // better-sqlite3 우선, 없으면 JSON 폴백
  try {
    // eslint-disable-next-line global-require
    const Database = require('better-sqlite3');
    const file = path.join(userDataDir, 'edutalk-local.db');
    const db = new Database(file);
    db.exec([
      'CREATE TABLE IF NOT EXISTS memos(id TEXT PRIMARY KEY, title TEXT, body TEXT, to_json TEXT, from_uid TEXT, created_at TEXT, net TEXT);',
      'CREATE TABLE IF NOT EXISTS memo_comments(id TEXT PRIMARY KEY, memo_id TEXT, body TEXT, from_uid TEXT, created_at TEXT);',
      'CREATE TABLE IF NOT EXISTS quickchat(id TEXT PRIMARY KEY, peer TEXT, body TEXT, dir TEXT, created_at TEXT);',
      'CREATE TABLE IF NOT EXISTS audit(kind TEXT, ts TEXT, summary TEXT);',
    ].join('\n'));
    return {
      kind: 'sqlite',
      insertMemo: (m) => { try { db.prepare('INSERT OR REPLACE INTO memos(id,title,body,to_json,from_uid,created_at,net) VALUES(?,?,?,?,?,?,?)').run(m.id, m.title, m.body, JSON.stringify(m.to || []), m.fromUid || '', m.createdAt, m.net || ''); } catch (e) {} },
      listMemos: () => { try { return db.prepare('SELECT * FROM memos ORDER BY created_at DESC LIMIT 200').all(); } catch (e) { return []; } },
      log: (kind, summary) => { try { db.prepare('INSERT INTO audit(kind,ts,summary) VALUES(?,?,?)').run(kind, new Date().toISOString(), String(summary || '').slice(0, 500)); } catch (e) {} },
      close: () => { try { db.close(); } catch (e) {} },
    };
  } catch (e) {
    const file = path.join(userDataDir, 'edutalk-local.json');
    let data = { memos: [], audit: [] };
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    const save = () => { try { fs.writeFileSync(file, JSON.stringify(data).slice(0, 5 * 1024 * 1024), 'utf8'); } catch (_) {} };
    return {
      kind: 'json',
      insertMemo: (m) => { data.memos.unshift(m); data.memos = data.memos.slice(0, 500); save(); },
      listMemos: () => data.memos.slice(0, 200),
      log: (kind, summary) => { data.audit.unshift({ kind, ts: new Date().toISOString(), summary: String(summary || '').slice(0, 500) }); data.audit = data.audit.slice(0, 500); save(); },
      close: () => {},
    };
  }
}

module.exports = { detectNetMode, openLocalDb };
