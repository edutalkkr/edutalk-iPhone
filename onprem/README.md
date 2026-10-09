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

## 설정 파일 위치 (전부 `onprem/` 안에)

- `license.key` — 유료 키 (없으면 30일 체험)
- `license.secret` — 서버 등록 코드, 첫 실행 때 자동 생성 (앱 학교 관리에 1번 등록)
- `data/edutalk.db` — 전체 DB
- `data/.admin_token` — 관리자 토큰 (환경변수로 안 정했을 때)
- `data/.trial` — 체험 시작일
- `data/.setup_done` — 초기 설정 완료 표시 (지우면 설정 모드로 돌아감)
- `uploads/` — 올라온 파일 (30일 보관)

## 초기 설정 잠금

- 처음 켜면 **관리자 계정 만들기 + 이용권 등록(또는 체험 시작)** 이 끝나기 전에는 로그인·채팅·소켓이 전부 막혀 있습니다 (503 + 안내).
- 초기 설정은 **학교 PC 본체에서만** 됩니다 (원격 차단). 관리 페이지를 열면 1·2단계 마법사가 뜹니다.

## 라이선스

- `onprem/license.key` 파일이 없으면 첫 실행일부터 **30일 무료 체험**으로 동작합니다.
- 서명 비밀값은 `onprem/license.secret` 파일에 들어 있습니다(이미 생성됨, git에 안 올라감). 환경변수 `EDUTALK_LICENSE_SECRET`이 있으면 그게 우선입니다.
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

## 엑셀 일괄 등록

관리 페이지 → 엑셀 올리기. 열 이름(한글 가능):
`username(사번/학번), real_name(이름), password(비밀번호·비우면 사번), department(부서·"교무부>1학년부" 트리 가능), role(권한), is_paid_dual_network(유료·1/예/유료)`

## Socket 이벤트

- `user:change_status {status, statusMessage}` → `user:status_updated` 전체 브로드캐스트
- `room:join / room:leave`
- `message:send {roomId, content, isNotice, fileId}` → `message:new`
- `message:read {messageId}` → `message:read_updated {messageId, userId, readAt, readCount}`
- `message:recall {messageId}` (본인만) → `message:recalled`

## 파일 보관

- 업로드는 UUID 파일명으로 `./uploads` 저장, DB에 `expires_at = 생성+30일` 기록
- 매일 00:00 (`node-cron`) 만료 파일·레코드 영구 삭제 + 실행 때도 1회 정리
