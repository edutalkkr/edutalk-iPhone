# 브리즈 백엔드 설계서 — 쪽지(Notes) 시스템 (5단계-1)

> 대상 서버: `onprem/` (Node.js ≥22 + Express + Socket.io + `node:sqlite`)
> 관련 프론트: `edutalk-core/src/components/NoteComposer.tsx` (7초 Undo Send), `edutalk-core/src/services/api.ts`
> 구현 뼈대: `onprem/db.js`(스키마), `onprem/routes/notes.js`(라우트), `onprem/server.js`(마운트)

---

## 1. 전제와 범위

- **온프레미스 본서버는 `onprem/`이다.** 교내망에서 실행되며 `server.js`(Express) + `db.js`(SQLite) 구조를 쓴다.
  - 네이티브 빌드가 필요 없는 Node 22 내장 `node:sqlite`를 사용한다 (`better-sqlite3` 아님 — exe 패키징 안정성).
  - 포트 기본 3000 (`EDUTALK_PORT`), DB 파일 `data/edutalk.db`.
- **`BreezeServer/`는 관리자 패널·배포(OTA) 도구**이고, **`edutalk-core/`는 교사용 클라이언트**다. 이번 단계는 onprem 서버에 쪽지 API를 추가한다.
- 쪽지(메모)는 **카톡형 실시간 대화가 아니라 이메일형 장문 쪽지**다. 실시간 대화는 기존 `rooms`/`messages`(소켓)가 담당한다.
- **7초 Undo Send는 클라이언트가 담당**한다. 서버는 7초가 지나 확정된 발송만 수신한다(무상태). 자세한 내용은 §4.

---

## 2. 데이터베이스 스키마 (SQLite DDL)

### 2.1 기존 `users` 테이블과의 매핑

사용자 요구 스키마의 `users`는 onprem 기존 테이블을 그대로 사용한다(변경 없음).

| 설계서 표기 | onprem 실제 컬럼 | 비고 |
| --- | --- | --- |
| `id` | `users.id` (INTEGER PK) | |
| `name` | `users.real_name` | 표시 이름 |
| `department` | `users.department_id` → `departments.name` | 부서 트리(`parent_id`) |
| `role` | `users.role` | `ADMIN` / `TEACHER` / `STAFF` |
| `password_hash` | `users.password_hash` | `scrypt$salt$dk` 형식 (`auth.js`) |
| (로그인 ID) | `users.username` | 사번/학번 |

### 2.2 쪽지 본문 `notes`

```sql
CREATE TABLE IF NOT EXISTS notes (
  id              INTEGER PRIMARY KEY,
  client_note_id  TEXT UNIQUE,                 -- 멱등 키: 같은 쪽지 재전송 방지 (NULL 허용)
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT '',
  content         TEXT NOT NULL DEFAULT '',
  audience        TEXT NOT NULL DEFAULT 'USER'
                  CHECK (audience IN ('ALL','DEPT','GRADE','USER')),  -- 전교/부서/학년/개별
  target_key      TEXT NOT NULL DEFAULT '',    -- DEPT=부서명|ID, GRADE=학년(예: '1학년'), 그 외 ''
  status          TEXT NOT NULL DEFAULT 'SENT'
                  CHECK (status IN ('SENT','CANCELLED')),             -- 예약 필드 (7초 취소는 클라 담당)
  cancelled_at    TEXT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,  -- 발송 확정 인원 (감사·목록 표시용)
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notes_sender ON notes(sender_id, id DESC);
```

### 2.3 수신자·읽음 `note_recipients`

```sql
CREATE TABLE IF NOT EXISTS note_recipients (
  note_id        INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  recipient_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL DEFAULT 'USER'
                 CHECK (recipient_type IN ('ALL','DEPT','GRADE','USER','CC','BCC')),
                 -- ALL/DEPT/GRADE/USER = 받는사람, CC = 참조, BCC = 숨은참조
  is_read        INTEGER NOT NULL DEFAULT 0,
  read_at        TEXT NULL,
  PRIMARY KEY (note_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_note_recipients_inbox
  ON note_recipients(recipient_id, is_read, note_id DESC);
```

**발송 시 수신자 확장(expand) 규칙**

1. `전교(ALL)` → `role != 'ADMIN'`인 전원 (시스템 관리자 계정 제외) − 발신자 본인
2. `부서(DEPT)` / `학년(GRADE)` → 부서 트리를 **재귀 CTE로 하위 부서까지** 확장해 소속 사용자 추출
   - `GRADE`의 `target_key='1학년'` → `departments.name LIKE '1학년%'`(예: `1학년부`) 매칭
3. `개별(USER)` / `CC` / `BCC` → 지정된 사용자 ID 그대로
4. 중복 시 우선순위: **받는사람(TO) > CC > BCC** (한 사람당 1행, `PK(note_id, recipient_id)`)
5. 발신자 본인은 수신자에서 제외. 확장 결과 0명이면 `400` 반환.

### 2.4 감사 로그 `audit_logs` (Append-Only)

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id      INTEGER PRIMARY KEY,
  actor_id    TEXT NOT NULL DEFAULT '',        -- 'users.id' 문자열, 시스템은 'system'
  actor_name  TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,                   -- note_send | note_cancel | login | ...
  target_type TEXT NOT NULL DEFAULT '',        -- memo | user | room | settings | ...
  target_id   TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '{}',      -- JSON (부가 정보)
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor   ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action  ON audit_logs(action);

-- Append-Only 강제: 수정/삭제 시도는 DB가 차단한다.
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
```

> 선택 보강(후속): BreezeServer처럼 해시 체인(`hash`, `previous_hash`)을 추가하면 사후 변조 탐지가 가능하다. onprem 단계에서는 트리거 기반 무결성으로 시작한다.

---

## 3. 핵심 API 명세

**공통 규칙**

- 응답 봉투: `{ "ok": true, ... }` / `{ "ok": false, "error": "설명" }` (onprem 기존 규칙)
- 인증: `Authorization: Bearer <토큰>` (`auth.js` 세션 토큰)
- 시간 형식: `YYYY-MM-DD HH:mm:ss` (로컬 시간, 기존 DB 규칙)
- 라우터: `onprem/routes/notes.js` → `server.js`에서 `/api/notes`에 마운트. 라우터 자체에 `needAuth` 적용.

### 3.1 `POST /api/auth/login` — 교원 인증

기존 `POST /api/login`과 동일 핸들러의 **별칭 경로**로 추가한다(프론트/문서 호환용).

```
요청  { "username": "2026001", "password": "****" }
응답  { "ok": true, "token": "…64hex…", "user": { "id": 3, "username": "2026001",
        "real_name": "김하나", "department_id": 2, "role": "TEACHER", ... } }
오류  401 { "ok": false, "error": "사번(학번)이나 비밀번호를 확인해 주세요." }
```

- 비밀번호 검증: `scrypt` (`auth.js`). 실패 시 600ms 지연(무차별 대입 완화) + 레이트리밋 30회/분.

### 3.2 `POST /api/notes/send` — 쪽지 발송 (7초 유예 **후** 호출)

```
요청  {
  "clientNoteId": "web-1729238100000-4",     // 멱등 키 (재전송 안전, 선택)
  "title": "2학년 체험학습 안내",
  "content": "1) 일시 … \n2) 준비물 …",       // \n 줄바꿈 보존, 최대 20,000자
  "audience": "ALL" | "DEPT" | "GRADE" | "USER",
  "targetKey": "1학년",                      // DEPT/GRADE일 때
  "recipientIds": [3, 7, 11],                // 개별(USER) 수신자
  "ccIds": [5], "bccIds": [9]
}
응답  { "ok": true, "noteId": 42, "recipientCount": 34, "duplicate": false }
오류  400 제목/내용 누락, 수신자 0명 | 500 발송 실패
```

- 같은 `clientNoteId`가 이미 저장돼 있으면 새로 만들지 않고 `duplicate: true`로 기존 `noteId`를 돌려준다.
- 트랜잭션(`BEGIN IMMEDIATE`)으로 `notes` 1행 + `note_recipients` N행을 원자적으로 기록한다.
- 발송 성공 시 수신자 전원의 개인 룸(`user:<id>`)에 소켓 이벤트 `memo-arrived`를 보낸다 (§6).
- 감사 로그 기록: `action='note_send'`, `target_type='memo'`, `target_id=noteId`.

### 3.3 `GET /api/notes/inbox` — 받은 쪽지함

```
쿼리  ?page=1&limit=30&unreadOnly=1
응답  { "ok": true, "notes": [ {
          "id": 42, "title": "…", "content": "…",
          "sender_id": 3, "sender_name": "김하나", "sender_department": "1학년부",
          "recipient_type": "USER", "is_read": 0, "read_at": null,
          "audience": "USER", "created_at": "2026-10-18 11:52:00"
        } ], "total": 57, "unread": 4, "page": 1, "limit": 30 }
```

- `status='SENT'`인 쪽지만. 본인 수신 행만 반환(BCC 여부는 본인 것만 보임 — 수신자 목록 비노출).

### 3.4 `GET /api/notes/sent` — 보낸 쪽지함 (수신자별 열람 상태 모달용)

```
쿼리  ?page=1&limit=30
응답  { "ok": true, "notes": [ {
          "id": 42, "title": "…", "content": "…", "audience": "GRADE", "target_key": "1학년",
          "status": "SENT", "recipient_count": 34, "read_count": 10,
          "created_at": "2026-10-18 11:52:00",
          "recipients": [ { "id": 5, "name": "박두나", "department": "2학년부",
                            "type": "CC", "is_read": 1, "read_at": "2026-10-18 12:01:02" } ]
        } ], "total": 12, "page": 1, "limit": 30 }
```

- 페이지에 포함된 쪽지들의 수신자는 `IN` 1회 조회로 묶어 N+1을 피한다.

### 3.5 `PATCH /api/notes/:id/read` — 읽음 처리

```
응답  { "ok": true, "noteId": 42, "readAt": "2026-10-18 12:01:02" }
오류  404 { "ok": false, "error": "쪽지를 찾을 수 없어요." }   (내 수신 행이 없을 때)
```

- 이미 읽은 경우 멱등: 기존 `read_at` 그대로 반환.
- 최초 읽음이면 발신자의 룸(`user:<sender_id>`)에 `peer-read` 이벤트를 보낸다.

---

## 4. 7초 Undo Send 프로토콜

```
[교사 클라이언트]                                        [onprem 서버]
[보내기] 클릭
 ├─ 작성 창 닫힘 + "보내고 있어요 (7s)" 팝업 표시
 ├─ 7초 카운트다운 (클라이언트 타이머)
 │    ├─ [전송 취소] 클릭 → 아무 요청 없음, 발송 무효
 │    └─ 7초 경과 → onNoteSend 실행
 └──────────────── POST /api/notes/send (clientNoteId 포함) ──▶ 트랜잭션 저장
                                                                ├─ 수신자 확장
                                                                ├─ audit_logs 기록
                                                                └─ 소켓 memo-arrived 전파
```

- **서버는 대기(pending) 상태를 갖지 않는다.** 취소 여부는 7초 동안 클라이언트에서만 존재하므로 서버 구현이 단순하고, 네트워크 단절에도 쪽지가 중복/유실되지 않는다.
- 중복 클릭·재시도로 같은 요청이 두 번 도착해도 `client_note_id UNIQUE`가 두 번째를 걸러 `duplicate: true`로 응답한다.
- `status='CANCELLED'`와 `cancelled_at`은 **예약 필드**다. 향후 서버 측 취소(예: 예약 발송)를 도입할 때 사용한다.

---

## 5. 서버 디렉토리 구조와 라우트 분리

### 5.1 현재 → 목표

```
onprem/
  server.js            # 진입점: 미들웨어 + 라우터 마운트만 (현재는 라우트 인라인 → 점진 분리)
  db.js                # SQLite 스키마 + 공용 헬퍼 (row/all/run)
  auth.js              # scrypt 인증 + 세션 토큰
  license.js           # 이용권
  routes/              # ★ 5단계-1 신규: 라우트 모듈 (CommonJS, 팩토리 패턴)
    notes.js           #   /api/notes/*  ← 이번 단계 구현
    (예정) rooms.js    #   /api/rooms/*  (기존 인라인 코드 분리)
    (예정) admin.js    #   /api/admin/*
    (예정) auth.js     #   /api/login, /api/auth/login 분리
  admin.html  install-service.js  test-self.js
  data/  uploads/  logs/
docs/
  NOTES_BACKEND_DESIGN.md   # ← 본 문서
```

### 5.2 `server.js` 마운트 (뼈대)

```js
/* ---------- 쪽지(이메일형) API (5단계-1) ---------- */
app.use('/api/notes', require('./routes/notes')({ needAuth, getIo: () => io }));

/* 로그인 별칭: 기존 /api/login + 신규 /api/auth/login */
app.post(['/api/login', '/api/auth/login'], loginLimiter, (req, res) => { /* 기존 핸들러 */ });
```

- 라우트 모듈은 **팩토리 패턴** `module.exports = ({ needAuth, getIo }) => router` — `server.js`의 미들웨어와 소켓 인스턴스를 주입받아 인라인 코드와 결합도를 낮춘다.
- `getIo`를 지연 함수로 넘겨 `io` 생성 순서(라우트 등록 → `http.createServer` → `io`) 문제를 피한다.

### 5.3 `routes/notes.js` 뼈대 요약

```js
module.exports = function createNotesRouter({ needAuth, getIo }) {
  const router = express.Router();
  router.use(needAuth);                       // 쪽지 API 전체 로그인 필수
  router.post('/send', handlerSend);          // §3.2
  router.get('/inbox', handlerInbox);         // §3.3
  router.get('/sent', handlerSent);           // §3.4
  router.patch('/:id/read', handlerRead);     // §3.5
  return router;
};
```

---

## 6. 소켓 이벤트 (기존 클라이언트 타입과 일치)

`edutalk-core/src/types/api.ts`의 `SocketEvents`에 이미 정의된 이름을 그대로 쓴다.

| 이벤트 | 방향 | 페이로드 | 시점 |
| --- | --- | --- | --- |
| `memo-arrived` | 서버 → 수신자 전원 | `{ id, title, body, from, from_name }` | 쪽지 저장 직후 |
| `peer-read` | 서버 → 발신자 | `{ ref_id, from }` | 수신자가 최초 열람 시 |

---

## 7. 후속 작업 (5단계-2 예고)

- [ ] 소켓 `memo-arrived`/`peer-read`를 교사 클라이언트 UI(안읽음 배지, 재촉하기)에 연결
- [ ] 관리자 감사 조회(`admin.html`)에 `note_send` 로그 뷰 추가
- [ ] `server.js`의 rooms/admin 라우트를 `routes/`로 분리 (파일 비대화 방지)
- [ ] 감사 로그 해시 체인(변조 탐지) 도입 검토 — BreezeServer 설계와 통일
