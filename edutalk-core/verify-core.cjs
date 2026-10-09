'use strict';
// edutalk-core 정적 검증: 괄호 균형, 명령 일치, 브랜드 잔류, 필수 표
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\pupp0\\Downloads\\edutalk-firebase-v10-messenger\\edutalk-core';
let fail = 0;
function bad(msg) { console.log('BAD: ' + msg); fail++; }
function ok(msg) { console.log('ok: ' + msg); }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function stripRust(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:\\.|[^'\\])'/g, "''")
    .replace(/"(?:[^"\\]|\\.|\\\n)*"/g, '""');
}
function stripTs(s, isTsx) {
  stripTs.unclosed = false;
  // 한 글자씩 훑는 토크나이저: 문자열·정규식·주석을 코드로 오인하지 않는다.
  // (예전 정규식 방식은 https:// 안 //, /[",]/ 같은 경우를 잘못 먹었다)
  // TSX 추가 규칙: /> 와 </태그는 JSX 닫기이므로 정규식으로 보지 않는다.
  let out = '';
  let i = 0;
  const n = s.length;
  const isRegexPrev = () => {
    const t = out.replace(/\s+$/, '');
    if (!t) return true;
    const c = t[t.length - 1];
    // { } 는 제외: JSX 텍스트의 ({step + 1}/3) 같은 나눗셈을 정규식으로 오인한다
    if ('=(:,[!&|?;'.includes(c)) return true;
    return /(?:return|typeof|case|in|of|new|delete|void)$/.test(t);
  };
  // 템플릿 ${} 안에서는 더 빡세게 본다: ) 나 단어 뒤의 / 는 나눗셈이다
  const isRegexPrevTpl = () => {
    const t = interpBuf.replace(/\s+$/, '');
    if (!t) return true;
    const c = t[t.length - 1];
    if ('({[=,:;!&|?'.includes(c)) return true;
    return /(?:return|typeof|case|in|of|new|delete|void)$/.test(t);
  };
  let interpBuf = '';
  const isJsxClose = () => {
    const c = s[i], d = s[i + 1];
    if (c !== '/') return false;
    if (d === '>') return true; // />
    if (isTsx && /[A-Za-z]/.test(d || '')) return true; // </div>
    if (d === '=') return true; // /= (나누기 대입)
    return false;
  };
  const skipString = (q) => {
    i++; // 따옴표 소비
    let depth = 0; // 템플릿 ${} 안에 들어간 깊이
    let closed = false;
    while (i < n) {
      const c = s[i], d = s[i + 1];
      if (c === '\\') { i += 2; continue; }
      if (q === '`' && depth === 0 && c === '$' && d === '{') { depth = 1; interpBuf = ''; i += 2; continue; }
    if (q === '`' && depth > 0) {
      if (c === '{') { depth++; interpBuf += c; i++; continue; }
      if (c === '}') { depth--; interpBuf += c; i++; if (depth === 0) continue; else continue; }
      if (c === '"' || c === "'" || c === '`') { skipString(c); interpBuf += c; continue; }
      if (c === '/' && (d === '/' || d === '*')) { skipComment(); continue; }
      if (c === '/' && !isJsxClose() && isRegexPrevTpl()) { skipRegex(); continue; }
      interpBuf += c;
      i++;
      continue;
    }
      if (c === q) { i++; closed = true; break; }
      i++;
    }
    if (!closed) stripTs.unclosed = true;
  };
  const skipRegex = () => {
    i++; // 여는 / 소비
    let cls = false;
    while (i < n) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') { cls = true; i++; continue; }
      if (c === ']' ) { cls = false; i++; continue; }
      if (c === '/' && !cls) { i++; while (i < n && /[a-z]/i.test(s[i])) i++; break; }
      if (c === '\n') break;
      i++;
    }
  };
  const skipComment = () => {
    if (s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; }
    else { i += 2; while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; }
  };
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && (d === '/' || d === '*')) { skipComment(); continue; }
    if (c === '"' || c === "'" || c === '`') { skipString(c); continue; }
    if (c === '/' && !isJsxClose() && isRegexPrev()) { skipRegex(); continue; }
    out += c; i++;
  }
  return out;
}
function balance(s, open, close) {
  let n = 0;
  for (const c of s) { if (c === open) n++; if (c === close) n--; if (n < 0) return n; }
  return n;
}

const rsFiles = ['src-tauri/src/main.rs', 'src-tauri/src/db.rs', 'src-tauri/src/p2p.rs',
  'src-tauri/src/dlp.rs', 'src-tauri/src/timetable.rs', 'src-tauri/src/purge.rs', 'src-tauri/src/audit.rs'];
for (const f of rsFiles) {
  const s = stripRust(read(f));
  const b = balance(s, '{', '}'), p = balance(s, '(', ')'), q = balance(s, '[', ']');
  if (b === 0 && p === 0 && q === 0) ok(f + ' braces/parens');
  else bad(f + ' braces=' + b + ' parens=' + p + ' brackets=' + q);
  // 같은 이름 두 번 정의 검사 (컴파일러보다 먼저 잡는다)
  // 단, #[cfg]로 갈라진 정의(둘 중 하나만 컴파일)는 제외
  const seen = {};
  const lines = s.split('\n');
  const lineOf = (idx) => s.slice(0, idx).split('\n').length - 1;
  for (const m of s.matchAll(/(?:pub\s+)?(?:struct|fn)\s+([A-Za-z_][A-Za-z_0-9]*)/g)) {
    const n = m[1];
    const ln = lineOf(m.index);
    const cfg = ln > 0 && /#\[cfg/.test(lines[ln - 1]);
    if (seen[n] && !cfg && !seen[n].cfg) bad(f + ' duplicate definition: ' + n);
    else if (!seen[n]) seen[n] = { cfg };
  }
  if (!Object.keys(seen).length) bad(f + ' no definitions found');
  else ok(f + ' no duplicates');
}

const tsFiles = ['src/App.tsx', 'src/main.tsx', 'src/store.ts', 'src/lib/tauri.ts',
  'src/components/WorkBox.tsx',
  'src/components/ComposerExtras.tsx', 'src/components/MorningPopup.tsx',
  'vite.config.ts'];

// src 전체를 훑는다 (고정 목록에 없는 신규 파일도 빠짐없이 — 사각지대 방지)
function walkTs(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walkTs(full, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  return out;
}
const allTsFiles = [...new Set([...tsFiles, ...walkTs(path.join(ROOT, 'src'), []), 'vite.config.ts'])];
for (const f of allTsFiles) {
  const s = stripTs(read(f), f.endsWith('.tsx'));
  if (stripTs.unclosed) bad(f + ' unclosed string');
  const b = balance(s, '{', '}'), p = balance(s, '(', ')'), q = balance(s, '[', ']');
  if (b === 0 && p === 0 && q === 0) ok(f + ' braces/parens');
  else bad(f + ' braces=' + b + ' parens=' + p + ' brackets=' + q);
}
// 고정 목록에 없던 신규 파일이 있으면 알린다 (목록 갱신 유도)
const extra = allTsFiles.filter((f) => !tsFiles.includes(f));
if (extra.length) ok('extra files covered: ' + extra.length);

// 명령 일치: Rust generate_handler vs 프론트 call()
const mainRs = read('src-tauri/src/main.rs');
const handler = mainRs.slice(mainRs.indexOf('generate_handler!'));
const cmds = [...new Set([...handler.matchAll(/([a-z_][a-z_0-9]*),?/g)].map(m => m[1]))];
const front = allTsFiles.map(f => read(f)).join('\n');
// 중첩 제네릭(call<Record<string, X>>)까지 잡는다
const calls = [...new Set([...front.matchAll(/call(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>)?\("([a-z_0-9]+)"/g)].map(m => m[1]))];
const missing = calls.filter(c => !cmds.includes(c));
if (missing.length === 0) ok('commands match (' + calls.length + ' calls)');
else bad('frontend calls without rust command: ' + missing.join(','));
// substitute_request 인수 확인 (Rust SubRequest는 snake_case class_no를 받는다)
if (/class_no:\s*[A-Za-z_$][\w$]*\.classNo/.test(front)) ok('substitute args use class_no');
else bad('substitute args mismatch');

// schema 표 확인
const schema = read('schema.sql');
for (const t of ['memos', 'memo_recipients', 'comments', 'quick_messages', 'peers', 'timetable_slots', 'timetable_meta', 'substitutions', 'audit_logs']) {
  if (new RegExp('CREATE TABLE IF NOT EXISTS ' + t).test(schema)) ok('table ' + t);
  else bad('missing table ' + t);
}

// 브랜드·중국어 잔류 (src 전체 + 문서 — '토스트'는 benign이므로 먼저 뺀다)
const all = rsFiles.concat(allTsFiles, ['README.md', 'schema.sql', 'package.json', 'index.html']).map(f => read(f)).join('\n');
const brandHay = all.replace(/토스트/g, '');
const banned = ['컴시간', 'Comtime', 'COMTIME', 'comtime', '쿨메신저', 'CoolMessenger', '카카오톡', 'Kakao', '토스', 'Toss'];
const found = banned.filter(w => brandHay.includes(w));
if (found.length === 0) ok('no banned brands');
else bad('banned words: ' + found.join(','));
if (/[\u4e00-\u9fff]/.test(all)) bad('chinese chars remain');
else ok('no chinese chars');

// 한글 UI 확인 (주요 문구)
for (const w of ['쪽지 쓰기', '빠른 대화', '시간표', '대강', '교내연결', '외부연결', '보안 경고', '감사']) {
  if (!all.includes(w)) bad('missing korean UI: ' + w);
}
ok('korean UI strings present');

console.log(fail === 0 ? 'ALL-OK' : 'FAILURES=' + fail);
process.exit(fail === 0 ? 0 : 1);
