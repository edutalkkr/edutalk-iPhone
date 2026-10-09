-- 에듀톡 로컬 저장소 정의 (SQLite)
-- 각 교사 PC 안에만 둔다. 암호화 빌드에서는 연결 직후 `PRAGMA key = '...'`
-- 로 잠근다. 서버로 올리는 표는 하나도 없다.

PRAGMA journal_mode = WAL;

-- 정식 쪽지 (제목·본문·작성자·보낸 시각·전송 경로)
CREATE TABLE IF NOT EXISTS memos (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  from_uid    TEXT NOT NULL,
  from_name   TEXT NOT NULL DEFAULT '',
  via         TEXT NOT NULL DEFAULT 'p2p',   -- p2p | cloud | local
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memos_created ON memos(created_at DESC);

-- 수신자별 수신 확인 (읽음/안 읽음 + 재촉)
CREATE TABLE IF NOT EXISTS memo_recipients (
  memo_id   TEXT NOT NULL,
  uid       TEXT NOT NULL,
  name      TEXT NOT NULL DEFAULT '',
  read_at   TEXT,                             -- NULL이면 안 읽음
  nudged_at TEXT,                             -- 마지막 재촉 시각
  PRIMARY KEY (memo_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_recipients_memo ON memo_recipients(memo_id);

-- 쪽지 하단 댓글 (가벼운 답장용, 쪽지 폭탄 방지)
CREATE TABLE IF NOT EXISTS comments (
  id        TEXT PRIMARY KEY,
  memo_id   TEXT NOT NULL,
  body      TEXT NOT NULL,
  from_uid  TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_memo ON comments(memo_id, created_at);

-- 1:1 빠른 대화 (5초 핑퐁용 짧은 기록, 7일 뒤 자동 정리)
CREATE TABLE IF NOT EXISTS quick_messages (
  id        TEXT PRIMARY KEY,
  peer_uid  TEXT NOT NULL,
  peer_name TEXT NOT NULL DEFAULT '',
  body      TEXT NOT NULL,
  mine      INTEGER NOT NULL DEFAULT 1,       -- 1=내가 보냄, 0=받음
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quick_peer ON quick_messages(peer_uid, created_at);

-- 교내망 동료 PC (mDNS·방송으로 찾은 목록)
CREATE TABLE IF NOT EXISTS peers (
  node_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL,
  tcp_port    INTEGER NOT NULL DEFAULT 47802,
  grade       TEXT NOT NULL DEFAULT '',
  room        TEXT NOT NULL DEFAULT '',       -- 담당 학급/교실 (예: 2학년 3반)
  last_seen   TEXT NOT NULL
);

-- 시간표 한 칸 (요일·교시·학년·반·과목·교실·교사)
CREATE TABLE IF NOT EXISTS timetable_slots (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_uid TEXT NOT NULL DEFAULT '',         -- 빈 값이면 공용(학급) 시간표
  weekday   INTEGER NOT NULL,                 -- 1=월 … 5=금
  period    INTEGER NOT NULL,                 -- 1~8
  grade     TEXT NOT NULL DEFAULT '',
  class_no  TEXT NOT NULL DEFAULT '',
  subject   TEXT NOT NULL DEFAULT '',
  room      TEXT NOT NULL DEFAULT '',
  teacher   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_slots_owner_day ON timetable_slots(owner_uid, weekday, period);

-- 시간표 가져오기 기록 (어느 파일·언제·몇 칸)
CREATE TABLE IF NOT EXISTS timetable_meta (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  source_name TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT '',
  slot_count  INTEGER NOT NULL DEFAULT 0
);

-- 대강(보강) 요청·수락 기록
CREATE TABLE IF NOT EXISTS substitutions (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,                  -- YYYY-MM-DD
  weekday     INTEGER NOT NULL,
  period      INTEGER NOT NULL,
  grade       TEXT NOT NULL DEFAULT '',
  class_no    TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  from_uid    TEXT NOT NULL,                  -- 비는 교사
  from_name   TEXT NOT NULL DEFAULT '',
  to_uid      TEXT,                           -- 맡은 교사 (수락 전 NULL)
  to_name     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',   -- open | accepted | declined | done
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_date ON substitutions(date, period);

-- 감사 기록 (유출 검사에서 걸린 것만, 내용은 종류만 적고 원문은 안 적는다)
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  kind        TEXT NOT NULL,                  -- dlp-block | dlp-warn
  rule_ids    TEXT NOT NULL DEFAULT '',       -- 걸린 규칙 (쉼표 나열)
  score       REAL NOT NULL DEFAULT 0,
  net_mode    TEXT NOT NULL DEFAULT '',       -- intranet | external
  actor_uid   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- ===== 2차분: 업무함·행정 모듈 =====

-- 쪽지 중요도 (본문 표에는 두지 않고 별도 표로 둬서 예전 DB도 깨지지 않는다)
-- memos.importance 열로 둔다 (없으면 앱이 ALTER로 추가)

-- 쪽지 안 미니 투표
CREATE TABLE IF NOT EXISTS polls (
  id        TEXT PRIMARY KEY,
  memo_id   TEXT NOT NULL,
  question  TEXT NOT NULL,
  options   TEXT NOT NULL DEFAULT '[]',       -- JSON 배열
  closed    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id  TEXT NOT NULL,
  uid      TEXT NOT NULL,
  choice   INTEGER NOT NULL,
  PRIMARY KEY (poll_id, uid)
);

-- 자주 쓰는 문구
CREATE TABLE IF NOT EXISTS templates (
  id    TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body  TEXT NOT NULL
);

-- 예약 발송 (다음 날 아침 등, 앱이 켜져 있을 때 시각 되면 보낸다)
CREATE TABLE IF NOT EXISTS scheduled_sends (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  to_json   TEXT NOT NULL DEFAULT '[]',
  run_at    TEXT NOT NULL,                    -- ISO 시각
  status    TEXT NOT NULL DEFAULT 'waiting',  -- waiting | sent | cancelled
  created_at TEXT NOT NULL
);

-- 학사일정 D-Day
CREATE TABLE IF NOT EXISTS school_events (
  id    TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date  TEXT NOT NULL                          -- YYYY-MM-DD
);

-- 담임 전용 비밀 기록장 (AES-256-GCM 암호문만 저장)
CREATE TABLE IF NOT EXISTS secret_memos (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  cipher     BLOB NOT NULL DEFAULT x'',
  updated_at TEXT NOT NULL DEFAULT ''
);

-- 조직도 (부서·학년·교사 3열, 엑셀/CSV로 한 번에 넣는다)
CREATE TABLE IF NOT EXISTS org_nodes (
  id    TEXT PRIMARY KEY,
  dept  TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  name  TEXT NOT NULL DEFAULT '',
  role  TEXT NOT NULL DEFAULT ''
);

-- 임시 출입 PIN (대체 강사·실습생용, 기한 지나면 무효)
CREATE TABLE IF NOT EXISTS guest_pins (
  pin       TEXT PRIMARY KEY,                  -- 6자리
  name      TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used      INTEGER NOT NULL DEFAULT 0
);

-- 보직 인수인계함 (개인 아닌 보직 태그 기준)
CREATE TABLE IF NOT EXISTS handover_notes (
  id        TEXT PRIMARY KEY,
  job_tag   TEXT NOT NULL,                     -- 예: 2026_과학부장
  body      TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_handover_tag ON handover_notes(job_tag, created_at DESC);

-- 부서 공용 수신함
CREATE TABLE IF NOT EXISTS dept_inbox (
  id        TEXT PRIMARY KEY,
  dept      TEXT NOT NULL,                     -- 예: 교무부
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  state     TEXT NOT NULL DEFAULT 'new',       -- new | doing | done
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_dept ON dept_inbox(dept, created_at DESC);

-- 교내 공용 HWP 서식함 (이름·설명만, 파일은 메모리 미리보기로)
CREATE TABLE IF NOT EXISTS hwp_templates (
  id    TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  note  TEXT NOT NULL DEFAULT ''
);

-- 동학년·동교과 동시 메모장 (마지막 저장 우선)
CREATE TABLE IF NOT EXISTS scratchpads (
  id         TEXT PRIMARY KEY,                 -- 예: 2학년-수학
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

-- 온기기지 검색용 역색인 (쪽지·댓글 저장 때 함께 넣는다)
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(ref_kind, ref_id, title, body);
