# 브리즈 UI/UX 전면 개편 설계서 (2026-10-19)

> 목표: 운영체제 기본 UI 제거 → 브리즈 전용 디자인 토큰(`bz-`) 체계로 통일.
> 상태 표시 현대화(아이콘+컬러+텍스트), 반응형 레이아웃 버그 수정, 학교 업무 핵심/확장 기능 완전 구현.
> 적용 대상: `edutalk-core` (교사용 데스크톱 클라이언트).

---

## 1. 요구사항 → 구현 매핑

| 명세 | 구현 위치 |
| --- | --- |
| 네이티브 툴팁 제거 | `components/ui/BzTooltip.tsx` + 전 소스 `title=` 스윕 |
| 네이티브 컨텍스트 메뉴 제거 | `components/ui/BzContextMenu.tsx` (전역 호스트 + `useContextMenu`) |
| 로그아웃 버튼 (ADMIN/TEACHER 공통) | `LeftSidebar` 하단 프로필 영역 + `SettingsPane` |
| 다크모드 명암비 4.5:1 보정 | `tailwind.config.js` 토큰을 CSS 변수로 전환 + `styles.css` 다크 팔레트 |
| 가로형 레이아웃 조직도 중복 제거 | LeftSidebar에서 내장 조직도 제거 → 단일 유연 그리드 |
| 좁은 창 Left Bar | 아이콘+텍스트 상시 유지, 최소 140px, 서브텍스트 자동 축소 |
| 상태 시스템 8종 | `lib/status.ts` + `components/ui/BzStatus.tsx` |
| 쪽지(메시지) 관리함 | `MemoPane` 개편 + `NoteVault` 확장 + `ComposerExtras` |
| 공지 타겟팅·기간·첨부 | `WorkPane` + `AdminNotices` + `lib/fileStore.ts` |
| 퀵 메모(포스트잇) | `components/QuickMemos.tsx` + `lib/quickStore.ts` |
| 브리즈 클라우드 | `components/views/CloudPane.tsx` + `lib/fileStore.ts` |
| 설문조사 | `components/views/SurveyPane.tsx` + `lib/surveyStore.ts` |
| AI 공지 요약 | `lib/ai.ts` (서버 AI + 로컬 폴백) |
| 워라밸 Focus Mode | `store.ts` + `App.tsx` + `SettingsPane` |
| 긴급 재난 알림(사이렌) | `lib/siren.ts` + 기존 긴급 팝업 강화 |

---

## 2. 디자인 토큰 (bz-)

### 2-1. 토큰 계층

1. **브랜드/시맨틱 컬러** — `styles.css`의 `:root` 변수(RGB 트리플렛).
   Tailwind `edu-*` 색상이 전부 이 변수를 참조하므로 다크모드에서 파일 수정 없이 전환된다.
2. **`bz-` 컴포넌트 토큰** — `breeze-web.css`. 표면·라인·그림자·상태색까지 다크 오버라이드 포함.
3. **상태 컬러** — `--st-online` … `--st-on-call` (WCAG AA 대비 확보).

### 2-2. 다크모드 명암비 기준

- 본문 텍스트 ≥ 4.5:1 (`#E6EAF2` on `#12161D` ≈ 13:1)
- 보조 텍스트 ≥ 4.5:1 (`#A7B1C2` on `#1A2029` ≈ 7.3:1)
- 상태 텍스트: 컬러 칩 배경 위에도 4.5:1 이상이 되도록 `-soft` 배경 + 진한 텍스트 사용

---

## 3. 신규 기반 컴포넌트

### BzTooltip
- `<BzTooltip content position="top|bottom|left|right">` — `createPortal`로 `body`에 렌더, 뷰포트 클램프.
- 지연 120ms, 키보드 포커스 지원, `prefers-reduced-motion` 존중.
- 원칙: UI 텍스트는 앱 글꼴 설정을 그대로 상속 — 시스템 글꼴 노출을 일관되게 유지.

### BzContextMenu
- 전역 호스트 1개 + `useContextMenu()` 훅: `openMenu(e, items)`.
- 항목: `{ id, label, icon, hint, danger, disabled, separator, onSelect }`.
- 텍스트 입력 필드(input/textarea/contenteditable)에서는 네이티브 메뉴 허용(복사/붙여넣기), 그 외 전역 `contextmenu` 차단.

### BzDialog
- `BzConfirm`(확인/취소), `BzAlert` — 로그아웃·삭제 등 파괴적 동작에 사용.

### BzStatus
- `StatusBadge`(아이콘+점+텍스트), `StatusDot`(점), `StatusPicker`(8종 선택 드롭다운).
- ICE: `lib/status.ts`의 `STATUS_META` 단일 출처.

---

## 4. 상태 시스템 (8종)

| 코드 | 라벨 | 아이콘 | 컬러 |
| --- | --- | --- | --- |
| `online` | 온라인 / 업무 가능 | CheckCircle2 | #22C55E |
| `busy` | 업무 집중 중 | MinusCircle | #EF4444 |
| `away` | 자리 비움 | Clock | #F59E0B |
| `in_class` | 수업 진행 중 | GraduationCap | #3B82F6 |
| `out_of_office` | 외근 / 출장 | Briefcase | #A855F7 |
| `lunch` | 점심 시간 | Utensils | #EAB308 |
| `meeting` | 회의 참석 중 | Users | #EC4899 |
| `on_call` | 통화 중 | PhoneCall | #64748B |

- 레거시 매핑: `teaching→in_class`, `offwork→away(퇴근)`, `dnd→busy`, `TRIP→out_of_office`, `AWAY→away`.
- 저장 데이터(localStorage·서버 조직도) 로드 시 `normalizeStatus()`로 일괄 정규화.
- "접속 중" 집계 = online/busy/in_class/lunch/meeting/on_call (away·out_of_office 제외).
- Focus Mode 활성 시: 상태 자동 `away` + 표시 문구 "퇴근 후 업무 휴식 중".

---

## 5. 레이아웃 — Single Flexible Grid

```
┌ TitleBar ──────────────────────────────────────────────┐
│ LeftBar(≥140px) │ Main (flex-1, max-w 없음) │ RightPanel │
└────────────────────────────────────────────────────────┘
```

- LeftBar는 **하나의 컴포넌트**로 통합: 아이콘+텍스트 상시, `width: clamp(148px, …, 208px)`.
  - 조직도 내장 패널 **삭제**(중복 조직도 제거). 조직도는 Main의 "조직도" 탭에서만.
- 서브 텍스트: 창 폭에 따라 10.5→11.5px 자동 축소(`data-rail="compact|wide"`).
- 프로필 영역 하단: 상태 픽커 + 로그아웃(+Focus 표시).
- 로그아웃은 SettingsPane 최상단에도 배치.

---

## 6. 모듈 설계

### 6-1. 쪽지 (실시간 + 관리함)
- `Memo` 확장: `starred`, `attachments[]`, `bodyHtml?`, `recalledAt?`, `scheduledAt?`.
- 발송: 실시간(memo-arrived/peer-read 소켓 유지) + 7초 Undo(멱등 `clientNoteId`) 유지.
- 수신/참조/숨은참조: TO/CC/BCC 칩 선택 — 실제 앱은 `MemoPane` 쓰기 탭(기본), 서버 직결 실험판은 `NoteComposer`.
- 관리함: 필터(전체/중요/안읽음/별표), 검색(제목·내용·작성자·ID), 회신/전체회신/전달/회수(읽기 전), 수신확인 시각.
- 고급: 예약 전송(ScheduledBox 연동), 나에게 보내기, 화면 캡처(getDisplayMedia 1프레임) 첨부, 스티커, 리치 텍스트 툴바(글꼴/크기/굵기/색).

### 6-2. 공지
- 타겟: 전체/부서/직급/개별 선택, 게시 기간(시작~종료), 첨부(파일·폴더).
- 작성자 수정/삭제 + ROLE_ADMIN 강제 삭제, 온라인 사용자 중앙 팝업.
- 상단 "3줄 요약 보기"(AI). 긴급 공지는 사이렌 + 강제 중앙 팝업.

### 6-3. 퀵 메모
- 플로팅 레이어(드래그·색 6종·접기/펼치기·검색·내보내기 .txt·쪽지로 전달).
- 쪽지 상세 "퀵 메모로 저장" 1클릭 변환.

### 6-4. 브리즈 클라우드
- IndexedDB(`breeze-files`) 기반 파일함: 폴더 생성, 업로드(다중/폴더), 다운로드(폴더 재귀), 삭제, 이름변경.
- 진행률·속도·재시도 UI, `navigator.storage.estimate()` 기반 용량 시각화.
- 권한: 폴더별 공유범위(개인/부서/전교) 메타.

### 6-5. 설문조사
- 등록: 공개/미공개, 대상자(전체/부서/선택), 첨부, 알림 쪽지 발송.
- 미투표자 리스트 + 독려 재전송.
- 결과: CSS 차트(막대) + 실제 .xlsx 내보내기(SheetJS, 요약·응답 2시트).

### 6-6. AI · 워라밸 · 재난
- AI 요약: 서버 `.env`의 AI 키로 호출하고, 키 없음/실패 시 로컬 추출 요약으로 폴백합니다. 결과는 캐시합니다.
- Focus Mode: 평일 18:00~다음날 08:00 + 주말 종일 자동(우선 고정) → 무음(쪽지·대화 토스트) + 내 상태 "자리 비움 · 퇴근 후 업무 휴식 중". 긴급(사이렌)은 항상 통과. 시각 커스터마이즈는 다음 단계.
- 긴급: WebAudio 2톤 사이렌 루프(중지 버튼), 중앙 강제 팝업(기존 emergency 상태 확장).

---

## 7. 데이터 저장 전략

| 데이터 | 저장소 |
| --- | --- |
| 화면 설정·상태·쪽지 메타 | localStorage (`storeGet/storeSet` 기존 체계) |
| 파일 바이너리(클라우드/첨부) | IndexedDB `breeze-files` |
| 설문·퀵메모 | localStorage (zustand persist) |
| 서버 연동(쪽지 발송/조직도) | onprem REST + Socket.io (기존 유지) |

---

## 8. 구현 순서

1. 기반: 상태 모듈, 아이콘, Tooltip, ContextMenu, Dialog, Status, CSS 토큰
2. 토큰 전환(다크모드 대비) + 불투명 하드코딩 색 정리
3. 상태 시스템 전면 적용 + 레이아웃(LeftBar 단일화·로그아웃)
4. 쪽지 확장
5. 퀵 메모
6. 공지·긴급·AI·Focus
7. 클라우드·설문
8. 빌드/검증, 문서 갱신

---

## 9. 구현 현황 (2026-10-19 · 전 단계 완료)

| 영역 | 상태 | 핵심 파일 |
| --- | --- | --- |
| 프리미티브(Tooltip/ContextMenu/Dialog/Status/Icons) | ✅ | `components/ui/` |
| 상태 8종 + 레거시 정규화 | ✅ | `lib/status.ts` |
| 다크모드 대비(토큰 CSS 변수화) | ✅ | `tailwind.config.js`, `styles.css`, `breeze-web.css` |
| LeftBar 단일화(중복 조직도 제거·로그아웃·퀵메모) | ✅ | `components/layout/LeftSidebar.tsx` |
| 쪽지 관리함(필터·통합검색·회신/전체회신/전달·별표·읽기 전 회수·첨부·CC/BCC·나에게 보내기·예약·화면 캡처·리치 텍스트) | ✅ | `components/views/MemoPane.tsx` |
| 7초 Undo Send — 7초 동안 실저장·실전송 보류(취소 시 흔적 없음) | ✅ | `App.tsx` (`undoHoldsRef` · `undoSendMemo`) |
| 예약 쪽지 스케줄러(20초 주기) | ✅ | `App.tsx` |
| 퀵 메모(포스트잇 6색·드래그·검색·쪽지 전달·파일 저장) | ✅ | `components/QuickMemos.tsx`, `lib/quickStore.ts` |
| 공지 타겟팅(전체/부서/직급/개별)·게시기간·첨부·관리자 강제삭제·중앙 팝업 | ✅ | `components/views/WorkPane.tsx` |
| AI 3줄 요약(서버 AI + 로컬 폴백, 긴급 팝업 요약 포함) | ✅ | `lib/ai.ts`, `onprem/.env.example` |
| 긴급 사이렌(WebAudio 2톤) + 팝업 강화 | ✅ | `lib/siren.ts`, `App.tsx` |
| Focus Mode(18:00~08:00·주말·알림 무음·상태 문구) | ✅ | `lib/focus.ts`, `store.ts`, `App.tsx`, `SettingsPane` |
| 브리즈 클라우드(권한 폴더·일괄 업/다운·진행률/속도·재시도·용량) | ✅ | `components/views/CloudPane.tsx`, `lib/cloudStore.ts`, `lib/fileStore.ts` |
| 설문조사(대상·알림·독려·차트·.xlsx 내보내기) | ✅ | `components/views/SurveyPane.tsx`, `lib/surveyStore.ts` |
| 네이티브 confirm/alert·HTML title 완전 제거 | ✅ | 전 소스 스윕 (남은 것은 BzDialog 폴백 주석뿐) |
| 설정(로그아웃·Focus·사이렌 미리듣기·데이터 초기화 강화) | ✅ | `components/views/SettingsPane.tsx` |

**검증:** `npx tsc --noEmit` 0건 · `npm run build` 성공 (Vite 5, 2026-10-19).

### 의도적으로 남긴 것
- `NoteComposer` / `NoteVault` / `MainWindow`는 서버 REST 직결 실험판으로 보존 — 실제 앱 화면은 `App.tsx` 라우팅 + `MemoPane`을 쓴다 (제거하지 않고 참고용 유지).
- 리치 텍스트는 안전한 마커 방식(`**굵게**` · `*기울임*` · `__밑줄__` · `• 목록`) — HTML 그대로 렌더하지 않아 XSS 원천 차단.
- Focus Mode 시간대는 우선 고정값이고, AI 키는 서버 `.env`에만 둡니다. 키가 없으면 로컬 요약으로 자동 대체되어 오프라인 교내망에서도 동작합니다.
