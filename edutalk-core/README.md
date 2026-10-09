# 브리즈 (교사 Windows판)

단일 브랜드 `브리즈` 중 교사 풀버전이다. Windows 설치판 전용이다.
웹 기본 브리즈(문자형 메신저)은 `public/`에서 돌아가고, 이 폴더는 웹에 올리지 않는다.
이유: 교내망 P2P·PC 내 SQLite·전송 전 검사·USB 감시·캡처 가림은 OS 기능이라 웹 기술로 구현이 어렵다.

## 에디션

- 웹 기본: 문자처럼 쓰는 메시지만. `public/index.html` + Firebase.
- Windows 풀: 조직도·쪽지·빠른 대화·시간표·대강·업무·감사. Tauri 2 + Rust.
- 같은 학교ID·이용권으로 엮인다 (`src/lib/schoolSync.ts`, 소통 전용이면 시간표 차단).
- 브라우저로 이 폴더를 열면 미리보기(mock)만 되고, 상단에 Windows 설치판 안내가 뜬다 (`src/lib/edition.ts`).

## 기술 구성

- 데스크톱 껍데기: Tauri 2 (화면은 가볍게, 운영체제 기능은 Rust로)
- 화면: React + TypeScript + TailwindCSS
- 상태: Zustand
- 저장소: PC 내 SQLite (memos, comments, peers, timetable, audit_logs)
- 유출 검사: 정규식 1차 + ONNX 한국어 분류 모델 2차 (CPU 실행)
- 교내망 탐색: mDNS + UDP 방송, 쪽지·파일은 TCP 직접 전송

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
