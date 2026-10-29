# 브리즈 (Breeze)

차세대 학교 전용 업무 메신저. 기존 학교 메신저를 대체하고, 학교의 정보 흐름과 행정을 잇는 온프레미스(On-Premise) 업무 메신저.

---

## 1. 프로젝트 개요 및 지향점

- **목적:** 기존 학교 메신저를 대체하는 온프레미스 업무 메신저로, 학교의 정보 흐름과 행정을 장악하는 것.
- **배포 및 접속 아키텍처:**
  - **선생님용 클라이언트:** PC 데스크탑 앱 (380px 슬림 컴팩트 유틸리티 폼팩터, 시스템 트레이 백그라운드 상주)
  - **학생용 클라이언트:** 별도 설치 없이 크롬북 등의 웹 브라우저에서 내부망 IP나 도메인으로 접속하는 웹 인터페이스
  - **서버:** 교내 내부망 서버 (BreezeCore / BreezeServer)

---

## 2. 완료된 프론트엔드 구현 내역 (1~4단계)

1. **`src/mock/demoData.ts`:** 가상 학교 조직도(교무기획부, 1~3학년부, 행정실), 샘플 교사/학생, 시간표 및 메시지 데이터.
2. **`src/components/LoginWindow.tsx`:** 정제된 미니멀 스타일의 로그인 폼 및 데모 로그인 기능.
3. **`src/components/MainWindow.tsx`:** 380px 세로형 컴팩트 레이아웃, Slate/Blue 패밀리룩 아이콘, 부서별 접기/펼치기 조직도 트리.
4. **`src/components/NoteComposer.tsx` (핵심 쪽지 시스템):**
   - **이메일/쪽지 폼:** 실시간 대화창을 배제하고, 장문의 이메일형 쪽지 작성 기능 구현. 수신자 지정([전교 교사 전체], [학년/부서 전체], [개별 교사]), 참조/숨은참조 탭 지원.
   - **엔터키 전송 금지:** 입력 중 Enter 키는 오직 줄바꿈(`\n`)만 수행하며, 오직 마우스로 [보내기] 버튼을 클릭해야만 발송 프로세스 시작.
   - **7초 발송 취소 (Undo Send) 시스템:** [보내기] 누르면 작성 창이 닫히고 메인 조직도로 복귀함과 동시에, 우측 하단에 "메시지를 보내고 있어요... (7s)" 슬림 플로팅 팝업과 [전송 취소] 버튼 노출. 7초 내 취소 시 발송 무효화 및 복원.

---

## 3. 진행 상황 (5단계: 백엔드 및 시스템 연동)

- [x] **5-1. 백엔드 DB 스키마 및 API 도면 설계** (2026-10-18)
  - 설계서: `docs/NOTES_BACKEND_DESIGN.md`
  - 스키마: `onprem/db.js`에 `notes` / `note_recipients` / `audit_logs`(Append-Only 트리거) 추가
  - API 뼈대: `onprem/routes/notes.js` (send/inbox/sent/read) + `server.js` 마운트, `/api/auth/login` 별칭
  - 자체 검증: `npm run test:notes` (20개 항목 통과)
- [x] **5-2. 실서비스 연동 (교사 클라이언트 쪽지)** (2026-10-18)
  - 웹전용 디자인 시스템 이식: `edutalk-core/src/breeze-web.css` (토큰·시트·모달·토스트·Undo 팝업)
  - 서비스 계층: `services/api.ts`(쪽지 4종 API + 기본 포트 3000 + setApiBaseUrl 버그 수정), `services/socket.ts`(연결 전 구독 보관·재연결 재부착), `services/notes.ts`(실시간 브리지)
  - `components/NoteComposer.tsx` 전면 재작성: 실제 `POST /api/notes/send` + 7초 Undo Send(취소 시 초안 복원, `clientNoteId` 멱등)
  - `components/NoteVault.tsx` 신규: 받은/보낸 쪽지함 + 읽음 처리(수신확인표) + 실시간 갱신
  - `components/MainWindow.tsx` 재작성: 쪽지 배지·토스트(memo-arrived/peer-read)·컴포저/쪽지함 통합, `LoginWindow.tsx` import 수정 + 로그인 후 REST/소켓 시드
  - 빌드 무결성: 레거시 타입 오류 191건 → 0건 (`types/index.ts` 레거시+관리자 병합 정리), `npm run build`(tsc 포함) 무경고 통과
  - 신규 UI(NoteComposer/NoteVault/MainWindow)의 App.tsx 통합은 후속 작업
- [x] **5-3. 트레이 상주 + 서버 주도 OTA 자동 업데이트** (2026-10-18)
  - 트레이 상주(데스크톱 런타임): 창 닫기(X) → 종료 대신 숨김(백그라운드에서 쪽지·알림 수신 유지), 트레이 왼쪽 클릭/메뉴 "열기"로 복귀, 실제 종료는 트레이 메뉴 "종료"만 (`src-tauri/src/main.rs`, `Cargo.toml` `tray-icon` feature)
  - 서버(OTA): `onprem/routes/updates.js` — `GET /api/updates/latest`(매니페스트 + SHA-256·크기 자동 채움, 없으면 404) · `GET /api/updates/download/:file`(경로 탈출·비`.exe` 차단). 전산실은 `onprem/updates/`에 설치본 + `latest.json`만 올리면 됨. 설정/이용권 게이트와 무관하게 갱신 가능
  - 클라이언트(Rust): `src-tauri/src/updater.rs` — `update_check` / `update_download`(진행률 `update-progress` 이벤트 + SHA-256 검증) / `update_install`(앱 종료 후 NSIS `/S` 무음 설치 → 자동 재시작)
  - 클라이언트(UI): `services/update.ts` + `components/UpdateToast.tsx` — 로그인 후 5초 뒤·10분마다 확인, 새 버전이면 하단 안내 카드(진행률 → 설치), "나중에"는 버전 단위 기억, 필수 업데이트는 닫기 불가
  - 자체 검증: `npm run test:updates` (11개 항목 통과) · `npm run test:notes` 재통과(20개) · `npm run build` 무경고
- [x] **5-4. 교사 클라이언트 UI/UX 전면 개편 + 확장 기능** (2026-10-19)
  - 설계서: `docs/UIUX_OVERHAUL_DESIGN.md` · 적용: `edutalk-core`
  - 네이티브 UI 제거(BzTooltip/BzContextMenu/BzDialog), 상태 8종 시스템, 다크모드 대비 보정(토큰 CSS 변수화), LeftBar 단일화(중복 조직도 제거·로그아웃·상태 픽커)
  - 쪽지 관리함(필터·통합검색·회신/전체회신/전달·별표·읽기 전 회수·CC/BCC·나에게 보내기·예약·화면 캡처·리치 텍스트·7초 Undo Send)
  - 퀵 메모(포스트잇), 브리즈 클라우드(권한 폴더·진행률·용량), 설문조사(대상·알림·독려·차트·xlsx), 공지 타겟팅·게시기간·강제삭제, 긴급 사이렌, AI 3줄 요약(서버 AI+로컬 폴백), Focus Mode(퇴근 후 휴식 자동 무음)
  - 검증: `npx tsc --noEmit` 0건 · `npm run build` 성공
- [x] **5-5. 로드맵 1차: AI 요약 서버 캐시 · 점심 자동 상태 · 서식(Template) · 오프라인 보관함** (2026-10-19)
  - AI 3줄 요약 서버화: `onprem/routes/summaries.js` — 주민번호·휴대폰·카드번호 마스킹 후 AI 1회 호출 → `ai_summaries` DB 캐시(같은 공지는 즉시 응답, `cached:true`). 키는 `onprem/.env`에만, 키가 없으면 로컬 문장 추출 폴백. 생성 시 감사로그(`ai_summary`) 기록. 자체 검증 `npm run test:summaries` (20/20)
  - 점심시간(12:30~13:30) 자동 상태 전환: 수업 중이 우선, 자동 문구는 수동 점심과 구분해 복귀 시 원상복구 (`utils/timetable.ts`)
  - Breeze Templates: 자주 쓰는 쪽지 서식 저장·클릭 한 번 불러오기 (쪽지함·업무 문구함 공용 스토어, 기본 서식 4종 시드)
  - 오프라인 보관함: 단선 시 작성 중 쪽지·빠른메모·초안을 IndexedDB에 보관, 재연결 시 자동 전송 (좌측 레일에 대기 건수 표시)
- [x] **5-6. 킬러 기능 4종 + 설치 커스터마이징 + 학교 운영 관리자 도구** (2026-10-19)
  - ① 보안 인쇄 대기열: 문서는 곧바로 종이로 나가지 않고 서버 `print_jobs` 대기열에 보관 → 인쇄실·공용 PC의 브리즈 앱에서 [출력]을 누른 순간에만 인쇄(숨은 iframe 인쇄, 텍스트만). 제출/승인/취소 전부 감사 기록, 하루 지난 원문은 자동 삭제(개인정보 최소 보관). `npm run test:print` (20/20)
  - ② 이중주차 차량 알림: 설정에서 내 차량 4자리 저장 → 조직도 검색창에 "1234"만 쳐도 차주 검색 + [차량 이동 요청] 한 번으로 긴급 쪽지 발송 (전화번호 비노출)
  - ③ 나이스 연동: `onprem/routes/neis.js` 프록시(키는 서버 `.env`에만) + `school_cache` TTL 캐시. 조직도 상단에 오늘의 급식·다가오는 학사일정 카드. 미설정 학교에서는 조용히 숨김
  - ④ 학년말 인수인계 마법사: 설정에서 전임→후임 선택 한 번으로 클라우드 자료(폴더·파일) 소유권 + 공지 작성자 일괄 이관, 관리자 감사로그 기록 (`cloudStore.reassignOwner`)
  - ⑤ 관리자 도구(CoolManager 5대 스펙): 정책 제어(업로드 용량·회수 시간·보존 연수·강제 업데이트·나이스 코드 — 서버 즉시 반영), 데이터 유지보수(보존 연수 경과 정리), 감사 리포트 `.xlsx` 자동 추출(접속·쪽지·파일·권한·공지 7시트), 서버 모니터링 + 매일 새벽 3:30 자동 DB 백업(VACUUM INTO, 최근 14개 보관). `npm run test:cool` (21/21)
  - 설치 커스터마이징: NSIS `installMode:"both"`(설치 마법사에서 설치 위치 Browse — 기본 경로 선택 가능), `portable.txt`/`BREEZE_DATA_DIR`로 저장소를 설치 폴더 기준으로 동기화, CSP를 교내망(http/https) 서버 호출 허용으로 수정
- [x] **5-7. 학생 웹 ↔ 교사 앱 실시간 연동 · 계정 보안 (2026-10-20)**
  - `onprem/student/`에 설치 없는 학생 웹 신규 구현: 학교 코드·학번·비밀번호 로그인, 선생님 목록/검색/상태, 이메일형 쪽지 작성·수신·읽음, Socket.IO 실시간 알림·알림음·브라우저 알림, 모바일 드로어
  - 교사 앱에 `학생 문의` 탭(`StudentInboxPane`) 추가: 학생 메시지 전용 토스트·차임·미읽음 배지, `NoteComposer` 재사용 답장(7초 Undo Send 유지)
  - 학교 코드 단일화: 관리자 콘솔에서 코드·이름 설정 → `/api/public-info`로 학생 로그인·교사 로그인 사전 대조. 서버에 코드가 없으면 라이선스 학교ID/HWID 기반 `BRZ-XXXXXX` 자동 생성
  - 학생 권한 분리: `STUDENT` 역할은 조직도·채팅방·인쇄·NEIS·AI 등 교사용 API 차단. 학생은 선생님(TEACHER/STAFF)에게만 최대 3명, 참조/숨은참조·전체/부서 발송 금지
  - 계정 보안: 엑셀 등록 시 비밀번호를 비우면 추측 불가능한 임시 비밀번호 자동 발급·1회 표시, 관리자 비밀번호 재설정, 학생/교사 본인 비밀번호 변경(다른 기기 세션 폐기), 관리자 API rate limit, `maxUsers` 엑셀 등록 강제
  - 검증: `npm test`, `npm run test:student`, `test:notes|summaries|print|cool|updates` 전부 통과 · `npx tsc --noEmit` 0건 · `npm run build` 성공 · Chrome headless로 학생 로그인→쪽지 발송→비밀번호 변경 모달 실화면 확인
- [x] **5-8. 마무리 UX · 권한/망 전환 · 서버 활동 로그 · 브리즈코어 소개 사이트** (2026-10-21)
  - 좌측 레일 접기 버튼·드래그 너비 조절(최소/최대/자동 접힘), 전체 화면 크기 85~135%(설치판은 창 크기도 함께 보정)
  - 퀵 메모: 얇은 입력바를 닫아도 메모 목록 유지, 떠 있는 칩으로 다시 열기, 재시작 후 복원, 추가/삭제/펼침 모션
  - 스마트 배너: 안 읽은 학생 메시지·오늘 할 일·일정, 10:30~13:30 급식 메뉴를 5분마다 갱신
  - 학년말 인수인계: 비관리자는 본인 계정으로만, 관리자는 전체 이관 가능
  - 듀얼망 학교만 내부/외부 전환 버튼 노출. 외부망에서 브리즈 클라우드 메뉴 숨김 + 내부망 전용 기능 중앙 안내 모달
  - 서버 활동 로그: `onprem/logs/activity-YYYY-MM-DD.log`에 API 요청·주요 화면 행동을 텍스트로 기록(비밀번호·토큰·본문 제외), 자체 테스트 추가
  - `breezecore-site/` 신규: 브리즈코어 제품 소개 정적 사이트(자체 디자인, 외부 자산 없음, 라이트/다크, 모바일 대응)
- [x] **5-9. 차세대 기능 4종 · 모션 · 보안 정리** (2026-10-22)
  - **AI 상담 일지:** 서버가 주민번호·휴대폰·카드번호를 마스킹한 뒤 AI로 [핵심 고민·관찰·후속 조치]를 정리하고, 키가 없으면 로컬 분류로 대체. 원문은 학교 SQLite에만 저장하고 작성자·관리자만 열람. `POST /api/consultations/summarize` · `/api/consultations`
  - **스마트 대강 매칭:** 시간표에서 이 시간 공강인 선생님만 기본 표시하고, 같은 과목 → 보강 횟수 적은 순으로 자동 정렬. 카드의 [바로 요청]으로 기본 사유('개인 사정')까지 한 번에 요청
  - **간이 전자결재:** 관리자만 승인/반려, 내 결재 자기승인 차단, 전자서명 SHA-256 해시 보관, 신청자·관리자 실시간 알림(`approval:new`/`decided`/`changed`)
  - **실시간 협업 보드:** 자리·모둠·감독·자유 템플릿, Socket.io 실시간 동기화, version 낙관적 잠금(409 충돌 시 최신 보드), 120KB·240항목 제한, 학생 차단. REST `/api/whiteboards` + `whiteboard:*` 소켓
  - **모션/UX:** 새 기능 카드·목록·상세·폼 접힘, 보드 항목 삭제, 다이얼로그·메뉴·툴팁 퇴장 모션. 좁은 창에서는 새 기능 진입 시 레일을 잠시 접고 나가면 원래 상태로 복원
  - **보안/중복 정리:** 공개 웹 스마트 배너의 원시 HTML 주입 경로를 `esc()` + action/class 화이트리스트로 차단, 상담 마스킹 건수 서버 재계산, 승인/보드 권한·rate limit·소켓 스로틀 보강
  - 검증: `test-self`, `test-notes`, `test-summaries`, `test-print`, `test-cool`, `test-updates`, `test-student`, `test-features` 전부 통과 · `tsc --noEmit` 0건 · PC `npm run build` / `npm run tauri:build` 성공 · NSIS 설치본 `Breeze-0.2.1_x64-setup.exe` 생성
- [x] **5-10. 이용권 주문·결제·발급 흐름** (2026-10-22)
  - 서버 기준 요금제 4종(소통 전용·기본·듀얼 소통·듀얼)과 부가세 포함 금액 계산. 클라이언트가 보낸 금액은 사용하지 않음
  - `functions/billing-core.js` + `licenseOrders` 서버 전용 쓰기: 플랜 선택 → 결제 방법 → 주문 → 이용권 발급 → 영수증·주문 내역
  - 안전한 기본값은 **무통장 입금**(총관리자 입금 확인 후 발급). `PAYMENT_MODE=sandbox`로 카드 흐름을 실제 청구 없이 확인하고, `live`는 결제 창 URL·웹훅 서명 키를 연결해 사용
  - 멱등 키를 해시한 주문 ID + Firestore 트랜잭션으로 네트워크 재시도에도 주문·이용권이 중복 발급되지 않음. 웹훅은 HMAC 서명과 주문 금액 일치를 모두 확인
  - 학교 관리자 화면에 구매 CTA·내 주문·결제 확인서 인쇄, 총관리자 화면에 입금 확인 대기 목록 추가. `licenseOrders`는 Functions만 쓰고 구매자·총관리자만 읽음
  - 검증: `npm run test:billing` (7/7), Firestore 규칙·Functions 구문 검사, 결제 화면 900px/500px 시각 검증
  - 실카드 결제는 사업자등록·결제대행사 계약 전까지 라이브 검증 불가. 연동 절차는 `docs/BILLING.md` 참조
- [x] **5-11. 학생 미디어 보관 정책 · 사이트 분리 · 대화 내보내기** (2026-10-28)
  - 학생이 보낸 사진·동영상·파일은 `expires_at = 전송 시각 + 30일`로 서버 DB에 기록하고, 매일 00:00에 실제 파일과 DB 행을 함께 정리. 교사가 올린 자료와 쪽지·대화 텍스트는 지우지 않음
  - 관리자 보관 기간 설정(30/90/180/365일, 기본 30일), 학생 첨부 전 `📌 파일 전송 안내` 1회 안내, 교사 앱 학생 문의함 첨부 미리보기·내려받기
  - 데스크톱 저장소 화면에 실제 `breeze.db`·WAL·임시 파일·디스크 사용량 표시, `임시 파일 비우기`·`수동 VACUUM 실행`, 시작·종료 시 자동 VACUUM. 기존 `edutalk.db`는 `breeze.db`로 안전하게 이전
  - 그룹 대화는 최근 50개부터 불러오고 위로 스크롤하면 이전 메시지를 50개씩 추가. 대화방을 TXT·PDF(인쇄 창)·AES-GCM 암호화 `.bzchat`로 내보내기
  - 오프라인 보관함은 원래 순서를 지켜 전송하고, 일부 수신자에게만 성공한 쪽지는 성공 대상을 빼고 나머지만 재시도
  - 공개 사이트를 `edutalk.cloud/breeze`와 `edutalk.cloud/breezecore`로 분리. 두 사이트 모두 Pretendard를 로컬에 포함하고, BreezeCore 소개 페이지는 실제 앱 화면·하늘색 팔레트·블루 틴트 흰 배경 사용
  - 검증: `node onprem/test-cool.js` 21/21, `npx tsc --noEmit`, `npm run build`, Rust `cargo check` 통과

- [ ] 관리자 감사 뷰 (서버 `audit_logs` 데이터 표시)
- [ ] 숨김 상태 수신 알림: PC 알림(토스트) 연동 검토 (tray balloon/알림 플러그인)

---

## 4. 디렉토리 구조 (주요)

| 경로 | 설명 |
| --- | --- |
| `onprem/` | 온프레미스 본서버 (Express + node:sqlite, `server.js`/`db.js`/`routes/notes.js`) |
| `onprem/student/` | **현재 학생용 웹** — 서버가 `/student/`로 직접 서빙 (설치 불필요) |
| `breezecore-site/` | **브리즈코어 소개 사이트** — 정적 HTML/CSS/JS, 로컬 Pretendard·실제 앱 화면·사이트 관리자 포함 |
| `edutalk-core/` | 교사용 클라이언트 (데스크톱 런타임 + React, 로컬 SQLite) |
| `BreezeServer/` | 관리자 패널·배포(OTA) 도구 |
| `onprem-electron/` | 온프레미스 데스크톱 관련 |
| `functions/`, `firestore.rules`, `firebase.json` | 클라우드 병행 (레거시) |
| `public/` | 레거시 클라우드 학생 웹 (신규 온프레미스 학생 웹은 `onprem/student/`) |
| `android/`, `ios/` | 모바일(Capacitor) |
| `docs/` | 설계 문서 (NOTES_BACKEND_DESIGN, DESKTOP_ARCHITECTURE, SECURITY_AUDIT, BILLING, patterns) |

## 5. 사이트 배포

```bash
npm run site:build   # hosting-dist/ 생성 (/breeze/ + /breezecore/)
npm run site:deploy  # Hosting + Firestore 규칙 배포
```

- `https://edutalk.cloud/` → `/breeze/`로 이동
- `https://edutalk.cloud/breeze/` → 브리즈 웹
- `https://edutalk.cloud/breezecore/` → 브리즈코어 소개
- `https://edutalk.cloud/breezecore/admin` → 사이트 문구·팝업 관리자

생성 폴더 `hosting-dist/`와 Firebase 설정 파일은 저장소에 올리지 않습니다.

> 레거시 공개 웹의 클라우드 웹 앱 설정은 `public/firebase-config.example.js`를 `public/firebase-config.js`로 복사해 채웁니다. 이 파일은 저장소에 올리지 않으며, 값이 없으면 공개 웹은 안내 화면을 보여 줍니다. 교사 앱은 같은 공개 식별자를 `edutalk-core/.env`의 `VITE_FIREBASE_PROJECT_ID`·`VITE_FIREBASE_API_KEY`로 주입합니다. 서비스 계정 키·토큰은 어느 클라이언트에도 두지 않습니다.
