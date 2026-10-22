# Breeze 학내망 서버 (On-Premise)

학교 PC에서 돌리는 내부망 전용 메신저 서버입니다. Express + Socket.io + SQLite(node:sqlite 내장 모듈) 구성이라 네이티브 빌드 없이 `exe`로 패키징됩니다.

> 왜 `better-sqlite3`이 아닌가요: 네이티브 모듈은 `pkg`로 exe를 만들 때 바인딩이 깨지기 쉽습니다. Node 22 내장 `node:sqlite`는 exe 안에 그대로 들어가 관리가 쉽고 보안 업데이트도 Node만 올리면 됩니다.

## 실행

```bat
cd onprem
npm install
npm start
```

- 관리 페이지: `http://localhost:3000/admin`
- 학교 안에서 접속: 콘솔에 찍힌 `http://192.168.x.x:3000` 주소 사용
- 관리자 토큰: 첫 실행 때 콘솔에 1회 출력 (이후 바꾸려면 `EDUTALK_ADMIN_TOKEN` 환경변수)
- 포트 변경: `EDUTALK_PORT=8080 npm start`

## 학생 웹 (설치 없이 접속)

- 주소: `http://<서버IP>:3000/student/` — 루트 `/`로 들어와도 학생 웹으로 이동합니다.
- 로그인: **학교 코드 + 학번 + 비밀번호**. 학교 코드는 관리자 페이지에서 설정하며, 학생 화면에도 안내됩니다.
- 교사 앱(브리즈코어)과 학생 웹은 **같은 서버 주소**를 사용해야 쪽지·실시간 알림이 연결됩니다.
- 학생 계정은 엑셀 일괄 등록에서 `role: STUDENT`로 만듭니다. 학생은 선생님(TEACHER/STAFF)에게만 쪽지를 보낼 수 있고, 전체·부서·참조·숨은참조 발송은 막혀 있습니다.
- 학생이 보낸 쪽지는 교사 앱 왼쪽 레일의 **학생 문의** 탭에 실시간으로 도착합니다. 교사는 같은 화면에서 답장할 수 있고, 답장에도 7초 Undo Send가 적용됩니다.

## 차세대 기능 (AI 상담 · 전자결재 · 협업 보드)

세 기능 모두 학교 서버 SQLite에 저장하고, 교사 계정으로 로그인한 브리즈코어에서 사용합니다. 학생 계정은 `/api/consultations`, `/api/approvals`, `/api/whiteboards`에 접근할 수 없어요.

### AI 상담 일지 — `/api/consultations`
- `POST /api/consultations/summarize {text}` — 서버가 주민등록번호·휴대폰·카드번호를 먼저 가린 뒤 AI로 [핵심 고민·관찰한 점·후속 조치]를 정리합니다. `GEMINI_API_KEY`가 없거나 호출이 실패하면 로컬 문장 분류로 조용히 대체합니다.
- `GET /api/consultations?scope=mine|all` — 작성자는 내 일지만, 관리자는 `scope=all`로 전체를 봅니다.
- `POST /api/consultations`, `PUT /api/consultations/:id`, `DELETE /api/consultations/:id` — 작성자 본인 또는 관리자만 수정·삭제할 수 있습니다.
- 상담 원문은 AI로 보내지 않고, 서버에서 마스킹한 사본만 전송합니다. 원문은 감사 로그에 남기지 않습니다.
- AI 호출은 `aiLimiter`(분당 제한)로 보호하고, 응답은 15초에서 끊습니다.

### 교내 간이 전자결재 — `/api/approvals`
- `GET /api/approvals?scope=mine|all&status=PENDING` — 내 결재 또는 관리자 전체 목록
- `POST /api/approvals` — 제목·분류·금액·내용으로 품의 올리기. 관리자에게 `approval:new` 실시간 알림
- `POST /api/approvals/:id/decide {action: approve|reject, signature, note}` — **ADMIN만** 처리할 수 있고, 내가 올린 결재는 내가 승인할 수 없습니다.
- `POST /api/approvals/:id/cancel` — 신청자가 대기 중인 결재를 취소
- 승인 시 `signature_hash`(SHA-256)를 DB에 남기고, 신청자에게 `approval:decided`, 관리자에게 `approval:changed`를 보냅니다.
- 본문은 감사 로그에 남기지 않고 생성·승인·반려·취소 사실만 기록합니다.

### 실시간 협업 보드 — `/api/whiteboards` + Socket.io
- `GET /api/whiteboards` — 보드 목록, `POST /api/whiteboards` — 자리·모둠·감독·자유 템플릿으로 생성
- `GET /api/whiteboards/:id`, `PUT /api/whiteboards/:id {data, expectedVersion, title?}`, `DELETE /api/whiteboards/:id`
- 좌표·크기·색·글자 수를 서버에서 강제하고, 보드 JSON은 120KB·항목 240개로 제한합니다.
- `expectedVersion`이 다르면 `409 {conflict:true, board}`로 최신 보드를 돌려줍니다. 두 선생님이 동시에 저장해도 덮어쓰지 않아요.
- 실시간: `whiteboard:join`, `whiteboard:leave`, `whiteboard:update` → `whiteboard:updated`, `whiteboard:presence`, `whiteboard:deleted`
- 소켓 업데이트는 40ms 스로틀로 과도한 연속 저장을 막고, 보드 이동 이벤트도 서버 활동 로그에 남깁니다.
- 보드는 만든 사람 또는 ADMIN만 삭제할 수 있습니다. 학생 계정은 REST·소켓 모두 차단됩니다.

## 설정 파일 위치 (전부 `onprem/` 안에)

- `license.key` — 유료 키 (없으면 30일 체험)
- `license.secret` — 서버 등록 코드, 첫 실행 때 자동 생성 (앱 학교 관리에 1번 등록)
- `data/edutalk.db` — 전체 DB
- `data/.admin_token` — 관리자 토큰 (환경변수로 안 정했을 때)
- `data/.trial` — 체험 시작일
- `data/.setup_done` — 초기 설정 완료 표시 (지우면 설정 모드로 돌아감)
- `data/backups/` — 자동 DB 백업 (매일 새벽 3:30 · 최근 14개)
- `uploads/` — 올라온 파일 (30일 보관)
- `logs/activity-YYYY-MM-DD.log` — 사람이 읽는 텍스트 활동 로그 (아래 참고)

## 활동 로그 (서버 PC에 텍스트로 남기기)

누가·언제·어떤 기능을 썼는지 서버 컴퓨터의 `logs/activity-YYYY-MM-DD.log`에 한 줄씩 남깁니다. 관리자 페이지에서 따로 내려받지 않아도 메모장으로 바로 열어 확인할 수 있어요.

- API 요청: 시각 · IP · 사용자 · 권한 · 메서드 · 주소 · 응답 코드 · 처리 시간
- 화면 행동: 교내/외부망 전환, 클라우드 업로드/삭제, 인수인계처럼 `POST /api/activity`로 보내는 이벤트
- 협업 보드: `whiteboard_join` / `whiteboard_update` / `whiteboard_leave`도 `SOCKET` 줄로 기록
- 비밀번호·세션 토큰·쪽지 본문은 기록하지 않아요.
- 로그 폴더를 바꾸려면 `.env`에 `EDUTALK_LOG_DIR=...`를 지정하면 돼요.
- `logs/YYYY-MM-DD.log`에는 서버 기동·오류 같은 시스템 로그가 따로 쌓입니다.

## 초기 설정 잠금

- 처음 켜면 **관리자 계정 만들기 + 이용권 등록(또는 체험 시작)** 이 끝나기 전에는 로그인·채팅·소켓이 전부 막혀 있습니다 (503 + 안내).
- 초기 설정은 **학교 PC 본체에서만** 됩니다 (원격 차단). 관리 페이지를 열면 1·2단계 마법사가 뜹니다.

## 라이선스

- `onprem/license.key` 파일이 없으면 첫 실행일부터 **30일 무료 체험**으로 동작합니다.
- 서명 비밀값은 `onprem/license.secret` 파일에 들어 있습니다(이미 생성됨, git에 안 올라감). 환경변수 `EDUTALK_LICENSE_SECRET`이 있으면 그게 우선입니다.
- ⚠️ **`license-vendor-private.key`는 절대 배포 서버에 두지 마세요.** 이 파일이 있으면 누구나 유효한 라이선스를 만들 수 있습니다. 오프라인 벤더 PC로 옮기고, 서버에는 공개키 검증용 `license.key`만 두세요. `license.secret`도 외부에 노출하지 말고, 노출이 의심되면 새로 발급하세요.
- 유료 키 발급(서버 폴더에서 실행):
  `node -e "const l=require('./license');console.log(l.signLicense({school:'가락고',schoolId:'B10-7010559',expiresAt:'2027-09-28T00:00:00+09:00',isPaidDualNetworkActive:true,maxUsers:1500,issuedAt:new Date().toISOString()}))" > license.key`
- 만료되면 유료 듀얼 모드는 꺼지고 서버는 계속 돕니다(학교가 멈추지 않게).

## exe 만들기 (학교 PC 단독 실행)

```bat
cd onprem
npm install
npm run pkg:win
```

`dist/breeze-server.exe`가 생기면 학교 PC에 `exe + (선택) license.key`만 복사해 실행하면 됩니다. Node 설치 불필요. `data/`, `uploads/` 폴더는 exe 옆에 자동 생성됩니다.

## 엑셀 일괄 등록 · 계정 보안

관리 페이지 → 엑셀 올리기. 열 이름(한글 가능):
`username(사번/학번), real_name(이름), password(비밀번호·비우면 임시 비밀번호 자동 발급), department(부서·"교무부>1학년부" 트리 가능), role(권한), is_paid_dual_network(유료·1/예/유료)`

- 비밀번호를 비우면 **추측 불가능한 임시 비밀번호**가 만들어지고, 업로드 결과 화면에 **딱 한 번** 표시됩니다. 화면을 닫으면 다시 볼 수 없으니 바로 본인에게 전달하세요.
- `role`은 `TEACHER`(교사), `STAFF`(행정직), `STUDENT`(학생), `ADMIN`(관리자)을 씁니다. 학생은 `/student/`에서만 로그인할 수 있습니다.
- 관리자 페이지의 사용자 목록에서 **비밀번호 재설정**을 누르면 새 임시 비밀번호가 발급되고 기존 로그인 세션이 모두 끊깁니다.
- 교사 앱 설정의 **비밀번호 변경**, 학생 웹의 **비밀번호 변경**에서 본인이 직접 바꿀 수 있습니다. 변경 시 현재 기기만 유지되고 다른 기기는 로그아웃됩니다.
- 라이선스 `maxUsers`가 있으면 엑셀 신규 등록 인원에도 상한이 적용됩니다. (0 = 무제한)

## 보안 인쇄 대기열 (Killer ①)

시험지·성적표가 공용 프린터에 그대로 쌓여 나가는 것을 막는 "가상 프린트"입니다.

- `POST /api/print/jobs {title, content}` — 대기열에 보관 (일반 텍스트, 최대 200KB)
- `GET /api/print/jobs` — 대기 목록 + 최근 처리(승인자·시각)
- `POST /api/print/jobs/:id/release` — **[출력] 승인**. 이때만 본문이 내려가고 교사 PC가 실제 인쇄
- `DELETE /api/print/jobs/:id` — 대기 취소 (본인 또는 ADMIN)
- 하루가 지난 대기열 원문은 자동 삭제(목록·감사 기록은 유지) — `print_jobs`
- 제출/승인/취소는 `audit_logs`(`print_submit`/`print_release`/`print_cancel`)에 남습니다

## 나이스 학사일정·급식 연동 (Killer ③)

- `GET /api/neis/status` — 연동 준비 상태(키·코드 설정 여부)
- `GET /api/neis/meal?date=YYYYMMDD` — 급식 (알레르기 번호 제거, 조식/중식/석식)
- `GET /api/neis/schedule?from=YYYYMMDD&to=YYYYMMDD` — 학사일정
- 설정: `.env`의 `NEIS_API_KEY`(공공데이터포털 open.neis.go.kr) + 관리자 페이지 [시스템 정책]의 교육청·학교 코드
- 캐시: `school_cache` (급식 6시간 · 학사일정 12시간) — 나이스 응답이 늦어도 최근 자료는 계속 보입니다

## 관리자 도구 (CoolManager 스펙)

관리 페이지(`/admin`) 카드에서 사용합니다. 모두 `x-admin-token` 필요.

- **시스템 정책** — 업로드 최대 용량(MB) · 쪽지 회수 시간(분) · 보존 연수(0=자동 정리 안 함) · 강제 업데이트 · 나이스 코드. `system_kv`의 `policy.*`에 저장되어 재시작 없이 즉시 반영됩니다 (업로드 상한·OTA 강제·나이스 조회에 실제 연결됨)
- **데이터 유지보수** — `POST /api/admin/maintenance/purge {years}` : 보존 연수 지난 쪽지·대화 삭제 + 만료 파일 정리, 감사 기록 남김
- **감사 리포트** — `GET /api/admin/audit/export?from&to` : 접속·쪽지·파일·권한·공지 7시트 `.xlsx` (교육청 제출용)
- **서버 상태** — `GET /api/admin/health` : 가동 시간·메모리·동시 접속(소켓)·DB 크기·백업 목록
- **DB 백업** — 매일 새벽 3:30 자동 백업(`VACUUM INTO` 일관 스냅샷) + `POST /api/admin/backup/run`. `data/backups/`에 최근 14개 보관

## 자체 검증

```bat
npm run test:notes       :: 쪽지 API (20항목)
npm run test:summaries   :: AI 요약·마스킹·캐시 (20항목)
npm run test:print       :: 보안 인쇄 대기열 (20항목)
npm run test:cool        :: 정책·감사 리포트·데이터 정리·백업·나이스 (22항목)
npm run test:student     :: 학생 웹·학교 코드·학생 권한·계정 보안
npm run test:features    :: 상담 마스킹·결재 권한·보드 충돌·소켓 알림
npm test                 :: 전체 서버 자체 검사
```

## Socket 이벤트

- `user:change_status {status, statusMessage}` → `user:status_updated` 전체 브로드캐스트
- `room:join / room:leave`
- `message:send {roomId, content, isNotice, fileId}` → `message:new`
- `message:read {messageId}` → `message:read_updated {messageId, userId, readAt, readCount}`
- `message:recall {messageId}` (본인만) → `message:recalled`
- `approval:new` → 관리자, `approval:decided` → 신청자, `approval:changed` → 관리자
- `whiteboard:join / leave / update` → `whiteboard:updated / presence / deleted` (교사·관리자 전용)

## 파일 보관

- 업로드는 UUID 파일명으로 `./uploads` 저장, DB에 `expires_at = 생성+30일` 기록
- 매일 00:00 (`node-cron`) 만료 파일·레코드 영구 삭제 + 실행 때도 1회 정리
