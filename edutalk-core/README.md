# 브리즈 (교사 PC판)

단일 브랜드 `브리즈` 중 교사 풀버전이다. PC 설치판 전용이다.
학생 웹은 온프레미스 서버가 `onprem/student/`를 `/student/`로 직접 서빙하며, 교사 앱과 같은 서버·학교 코드를 쓴다. `public/`은 Firebase 기반 레거시 웹이다. 이 폴더는 웹에 올리지 않는다.
이유: 교내망 P2P·PC 내 SQLite·전송 전 검사·USB 감시·캡처 가림은 OS 기능이라 웹 기술로 구현이 어렵다.

## 에디션

- 학생 웹(온프레미스): 설치 없이 `/student/` 접속. 학교 코드·학번·비밀번호 로그인, 선생님께 쪽지·실시간 알림.
- PC 풀: 조직도·쪽지·빠른 대화·시간표·대강·업무·감사. 데스크톱 런타임 + Rust.
- 웹 기본(레거시): 문자형 메신저. `public/index.html` + Firebase.
- 같은 학교ID·이용권으로 엮인다 (`src/lib/schoolSync.ts`, 소통 전용이면 시간표 차단).
- 브라우저로 이 폴더를 열면 미리보기(mock)만 되고, 상단에 PC 설치판 안내가 뜬다 (`src/lib/edition.ts`).

## 학생 웹 ↔ 교사 앱 연동

- 교사 앱 로그인 후 왼쪽 레일 **학생 문의**에서 학생이 보낸 쪽지를 실시간으로 확인·답장한다 (`components/views/StudentInboxPane.tsx`).
- 학생 메시지는 일반 쪽지와 구분되는 토스트·차임·미읽음 배지로 알린다 (`lib/chime.ts`).
- 답장은 기존 `NoteComposer`를 재사용해 **Enter=줄바꿈, [보내기] 클릭, 7초 Undo Send** 규칙을 그대로 지킨다.
- 앱을 껐다 켜도 저장된 서버 주소·토큰으로 실시간 연결을 복구한다. 로그아웃하면 토큰·소켓을 함께 정리한다.

## 기술 구성

- 데스크톱 껍데기: Tauri 2 (화면은 가볍게, 운영체제 기능은 Rust로)
- 화면: React + TypeScript + TailwindCSS
- 상태: Zustand
- 저장소: PC 내 SQLite (memos, comments, peers, timetable, audit_logs)
- 유출 검사: 정규식 1차 + ONNX 한국어 분류 모델 2차 (CPU 실행)
- 교내망 탐색: mDNS + UDP 방송, 쪽지·파일은 TCP 직접 전송

## 2026-10 UI/UX 전면 개편 (요약)

설계서: `../docs/UIUX_OVERHAUL_DESIGN.md`

- **네이티브 UI 제거:** HTML `title=` 툴팁 → `BzTooltip`, 우클릭 메뉴 → `BzContextMenu`, `confirm/alert` → `BzDialog`.
- **상태 8종:** 온라인·업무집중·자리비움·수업중·외근·점심·회의·통화 (`lib/status.ts` 단일 출처, 레거시 자동 변환).
- **LeftBar 단일화:** 중복 조직도 제거, 아이콘+텍스트 상시 표시(최소 140px), 프로필 하단 상태 픽커 + 로그아웃(교사·관리자 공통).
- **쪽지(관리함):** 필터(전체/중요/안읽음)+통합검색, 회신/전체회신/전달, 별표, 읽기 전 회수, 첨부(IndexedDB), CC/BCC, 나에게 보내기, 예약 발송(20초 스케줄러), 화면 캡처, 리치 텍스트, **7초 Undo Send**(7초 동안 저장·전송을 보류해 취소 시 흔적이 남지 않음).
- **퀵 메모:** 포스트잇 6색 레이어(드래그·접기·검색·파일 저장·쪽지 전달), 쪽지에서 1클릭 저장 — `components/QuickMemos.tsx`.
- **업무/공지:** 전체/부서/직급/개별 타겟팅, 게시기간, 첨부, 관리자 강제삭제, 긴급 중앙 팝업 + **사이렌**(WebAudio), **AI 3줄 요약**(서버 AI 키, 없으면 로컬 요약).
- **브리즈 클라우드:** 권한별(나만/부서/전교) 폴더, 일괄 업/다운로드, 진행률·속도·재시도, 용량 진행바 — `components/views/CloudPane.tsx` + `lib/cloudStore.ts`.
- **설문조사:** 공개/미공개·대상 지정·알림 쪽지·미투표자 독려·막대 차트·`.xlsx` 내보내기 — `components/views/SurveyPane.tsx` + `lib/surveyStore.ts`.
- **Focus Mode:** 평일 18:00~08:00·주말 종일 자동으로 알림 무음 + 상태 "퇴근 후 업무 휴식 중" (긴급은 항상 표시).
- **파일 저장소:** 쪽지·공지·설문·클라우드 첨부는 IndexedDB(`breeze-files`) — `lib/fileStore.ts`.
  - **브리즈 클라우드는 이 PC의 IndexedDB에 저장돼요.** 학교 서버나 Firebase로 자동 동기화되지 않으므로, 다른 PC와 자료를 나누려면 파일을 내려받아 쪽지·공용 폴더로 전달해 주세요.
- **화면 크기:** 설정에서 85~135%로 전체 글자·UI를 조절해요. Tauri에서는 WebView 확대, 브라우저 미리보기에서는 CSS 확대를 써요 (`store.ts`의 `applyUiScale`).

API 키는 저장소에 넣지 않는다. `edutalk-core/.env.example`을 `.env`로 복사해 채운다.

## 2026-10 로드맵·킬러 기능 (요약)

- **AI 3줄 요약 서버 캐시:** 서버(`onprem/routes/summaries.js`)가 마스킹 후 AI 1회 호출 → DB 캐시. 클라이언트는 서버 우선 + 로컬 폴백(`lib/ai.ts`, `services/api.ts summarizeAi`).
- **점심시간 자동 상태:** 평일 12:30~13:30 자동 "점심 시간 (12:30~13:30)" — 수업 중이 우선, 끝나면 원래 상태로 복귀 (`utils/timetable.ts`).
- **Breeze Templates:** 자주 쓰는 쪽지 서식 저장·불러오기 (`lib/templates.ts` + 쪽지함/업무 문구함 `TemplatesBar`, 기본 4종 시드).
- **오프라인 보관함:** 단선 시 쪽지·빠른메모·작성 초안을 IndexedDB(`breeze-outbox`)에 보관 → 재연결 시 자동 전송, 좌측 레일에 전송 대기 건수 표시 (`lib/outbox.ts`).
- **보안 인쇄(①):** 문서는 서버 대기열(`print_jobs`)에 보관 → 인쇄실·공용 PC에서 [출력] 승인 시에만 실제 인쇄(`lib/printQueue.ts`, `views/PrintPane.tsx`, 숨은 iframe 인쇄·텍스트만). 서버 미연결(데모)에선 이 PC 대기열로 동작.
- **차량 이동 요청(②):** 설정 → "내 차량 4자리" 저장, 조직도 검색창에 "1234" 입력 → 차주 카드 + [차량 이동 요청](긴급 쪽지, 전화번호 비노출).
- **나이스 연동(③):** 조직도 상단 "오늘의 학교" 카드 — 급식·다가오는 학사일정 (서버 `/api/neis/*` 프록시, 미설정 학교는 조용히 숨김).
- **인수인계 마법사(④):** 설정 하단 — 전임→후임 선택 한 번으로 클라우드 자료 소유권(`cloudStore.reassignOwner`)·공지 작성자 이관 + 감사로그.
- **설치 커스터마이징(⑤):** NSIS `installMode:"both"`(설치 위치 선택·기본 경로) · `portable.txt`/`BREEZE_DATA_DIR` 로컬 DB를 설치 폴더 기준(`data\`)으로 동기화(`src-tauri/src/main.rs resolve_data_dir`) · CSP 교내망(http/https) 허용.

검증: `npx tsc --noEmit` 0건 · `npm run build` 성공 · `node verify-core.cjs` ALL-OK

## 폴더 구조

```
edutalk-core/
  README.md
  package.json / vite.config.ts / tsconfig.json / tailwind.config.js
  index.html
  schema.sql                  # SQLite 테이블 정의
  src-tauri/
    Cargo.toml / tauri.conf.json / build.rs
    src/main.rs               # 명령 등록
    src/db.rs                 # SQLite 접근
    src/p2p.rs                # mDNS 탐색 + TCP 직접 전송
    src/dlp.rs                # 전송 전 검사 (정규식 + ONNX)
    src/timetable.rs          # 시간표 CSV 가져오기 + 공강 조회 + 대강 추천
    src/purge.rs              # 임시 파일 자동 정리 + 메모리 미리보기
    src/audit.rs              # 감사 기록 + 보고서 내보내기
  src/
    main.tsx / App.tsx / styles.css
    store.ts                  # Zustand 저장소
    lib/tauri.ts              # Rust 명령 호출 다리 (브라우저 개발용 대체 포함)
    lib/csv.ts                # 시간표 CSV 읽기
    components/
      NetPill.tsx             # 교내망/외부망 표시·전환
      MemoView.tsx            # 정식 쪽지 (제목·수신자·본문·첨부·수신확인)
      MemoThread.tsx          # 쪽지 하단 댓글
      QuickChat.tsx           # 1:1 빠른 대화
      PeerList.tsx            # 교내망 동료 PC 목록
      TimetableWidget.tsx     # 오늘 시간표 + 현재 상태
      SubstituteModal.tsx     # 대강 요청·수락
      DlpModal.tsx            # 보안 경고창
      AuditPanel.tsx          # 감사 기록·보고서
      RamPreview.tsx          # 첨부 메모리 미리보기
```

## 실행 (개발 PC에 Rust + Node가 있을 때)

```bash
cd edutalk-core
npm install
npm run tauri:dev
```

배포용 설치 파일:

```bash
npm run tauri:build
```

## 동작 모드

- 교내연결(교내망): PC끼리 직접 연결. 서버 없음. 원격 지원은 이 모드에서만.
- 외부연결(외부망): 클라우드 중계로 전환. 원격 지원·원본 직접 전송은 꺼짐.
  외부로 나가기 전에는 반드시 이 PC 안에서 유출 검사를 먼저 한다.
- **듀얼망 학교만** 교내/외부 전환 버튼을 봐요. 단일망 학교에는 전환 버튼이 숨겨져요.
- 외부망에서는 브리즈 클라우드 메뉴가 사라지고, 무거운 기능으로 들어가면 중앙 안내 모달이 떠요. 내부망으로 돌아오면 다시 쓸 수 있어요.

## 좌측 레일·퀵 메모

- 프로필 옆 작은 버튼으로 레일을 접고, 오른쪽 가장자리를 끌어 너비를 조절해요(접힘/최소/최대 애니메이션).
- 퀵 메모의 얇은 추가 창은 X로 닫아도 메모 목록은 그대로 남아요. 목록에서 메모를 고르거나, 떠 있는 [퀵 메모] 칩으로 다시 열 수 있고, 앱을 껐다 켜도 저장돼요.

## 차세대 기능 (좌측 레일)

- **AI 상담 일지:** 상담 원문을 서버에서 민감정보 마스킹 후 AI로 정리해요. 원문은 학교 서버에만 저장되고 작성자·관리자만 열람해요. 서버가 닿지 않으면 이 PC에 임시 저장돼요.
- **전자결재:** 품의를 올리면 관리자에게 실시간 알림이 가요. 관리자만 승인·반려할 수 있고, 내가 올린 결재는 제가 승인할 수 없어요. 승인은 전자서명 해시로 남아요.
- **협업 보드:** 자리 배치·모둠·시험 감독을 여러 선생님이 실시간으로 함께 편집해요. 다른 선생님이 먼저 저장하면 최신 보드를 불러오고, 충돌을 덮어쓰지 않아요.
- **스마트 대강:** 시간표에서 이 시간 공강인 선생님만 기본으로 보여 주고, 같은 과목·보강 횟수 순으로 추천해요. [바로 요청]을 누르면 기본 사유로 바로 보강을 요청해요.
- 새 기능에 들어가면 좁은 창에서는 레일이 잠시 접혀 작업 공간을 넓혀요. 나가면 원래 레일 상태로 돌아와요.

## 주고받기

- 쪽지·대화·댓글은 보내면 같은 망 PC 목록에 바로 꽂힌다 (`p2p_send`, 양쪽 같은 ID).
- 처음 보는 PC는 명단의 교내망에 자동으로 오른다.
- 쪽지를 열면 읽음 영수증이 가고, 재촉도 간다. 외부망·클라우드 학교는 전부 차단된다.

## 원격 지원 정책

- 교내망 P2P 전용이다 (`src-tauri/src/main.rs`, `src-tauri/src/remote.rs`, `src/lib/remotePolicy.ts`).
- Firebase 클라우드(외부망 중계)를 쓰는 학교는 차단된다:
  외부망 모드이거나 이용권이 외부망 고정(EXTERNAL)이면 요청 전에 막힌다.
- 상대방이 수락해야 1장씩 화면이 오고, 파일로 저장하지 않고 RAM에서만 본다.
  수락 기록은 감사로그에 남는다.

## 시간표 가져오기

시간표 CSV는 나이스(NEIS) 양식의 `교사별시간표.csv`, `학급별시간표.csv`를
그대로 읽는다. 특정 업체 이름이 파일에 적혀 있을 필요가 없다.
열 이름이 달라도(예: 교시/요일/학년/반/과목/교실) 자동으로 맞춘다.

## 첫 화면 (허브)

로블록스처럼 처음에 큰 카드를 고르면 각 방(쪽지함·빠른 대화·시간표·업무함·감사·설정)으로
들어가고, 위 탭으로 언제든 바로 옮길 수 있다. 프로그램은 하나, 안의 방이 여럿이다.

## 전체 설정

- 내 표시 이름 (쪽지·댓글에 함께 표시)
- 화면 모션 3단계 (기본: 켜기)
  - 켜기: 미끄러지듯 부드럽게
  - 페이드만: 나타나기·사라지기만
  - 끄기: 뚝뚝 끊기며 바로바로 바뀜
  - 정한 적 없으면 운영체제의 "모션 줄이기"를 따라 페이드만으로 시작한다.

## 주의

- 이 저장소에는 어떤 타사 메신저·알리미 상표도 적지 않는다.
  화면에 보이는 이름은 오직 "브리즈"이다.
- 원격 데스크톱 스트리밍은 MVP에서 연결 틀만 두었고 실제 화면 전송은 다음 단계에서 붙인다.
- 감사 보고서는 CSV + 인쇄용 HTML로 내보낸다 (PDF는 인쇄 대화상자에서 저장).
