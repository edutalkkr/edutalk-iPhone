# 브리즈 데스크톱 (Breeze Desktop)

`https://edutalk.cloud` 를 그대로 불러오는 Electron 데스크톱 앱입니다.
웹(`public/`)을 수정해 배포하면 **앱을 다시 설치하지 않아도** 다음 실행/새로고침 때 바로 반영됩니다.
(웹 프로젝트 파일은 이 앱에서 전혀 수정하지 않습니다.)

## 사전 준비

- Windows 10 이상
- [Node.js](https://nodejs.org) **18 이상** (LTS 권장)

```powershell
node --version
```

## 설치

`desktop` 폴더에서 실행합니다.

```powershell
cd desktop
npm install
```

## 개발 실행

```powershell
cd desktop
npm start
```

- 실행 전에 `assets/icon.png`, `assets/tray.png` 가 자동 생성됩니다(`prestart` → `scripts/make-icons.js`).
- 아이콘만 다시 만들려면 `npm run icons`.

## 설치 파일(.exe) 빌드

```powershell
cd desktop
npm run build:win
```

- 결과물: **`desktop\dist\Breeze Setup.exe`**
- 빌드 전 아이콘도 자동 생성됩니다(`prebuild:win` → `scripts/make-icons.js`).

## 배포 / 설치 (사용자 입장)

**`Breeze Setup.exe` 파일 하나만 전달하면 됩니다.** 설치할 PC에 Node.js나 개발 도구는 필요 없습니다.

1. `Breeze Setup.exe` 실행
2. 설치 안내 창에서 **동의함** 클릭
3. 설치가 자동으로 진행되고, 끝나면 앱이 바로 실행됩니다.

- 설치 경로를 고르는 단계가 없고, 관리자 권한(UAC) 창도 뜨지 않습니다.
  (`%LOCALAPPDATA%\Programs\Breeze` 에 설치됩니다.)
- 바탕화면 / 시작 메뉴에 **브리즈** 바로가기가 만들어집니다.
- 설치 안내 문구는 [build/license.txt](build/license.txt) 에서 수정합니다.
  (한글이 깨지지 않도록 **UTF-8 BOM + CRLF** 를 유지하세요.)

### 코드 서명 관련 안내

이 프로젝트는 코드 서명 인증서 없이 빌드합니다. 따라서 설치 파일을 처음 실행할 때
Windows **SmartScreen** 경고(“Windows의 PC 보호” → “추가 정보” → “실행”)가 표시될 수 있습니다.
정상 동작이며, 경고 없이 배포하려면 별도의 코드 서명(EV/OV 인증서)이 필요합니다.

## 주요 동작

- **트레이 상주**: 창의 X(닫기) 버튼은 종료가 아니라 트레이로 숨깁니다. 실제 종료는 트레이 아이콘 우클릭 → **종료**.
- **트레이 메뉴**: 열기 / 새로고침 / 윈도우 시작 시 자동 실행(체크) / 시작할 때 창 열기(체크) / 종료.
  트레이 아이콘을 더블클릭하면 창이 열립니다.
- **윈도우 시작 시 자동 실행**: 첫 실행 시 자동으로 등록되며, 이후에는 트레이 메뉴의
  “윈도우 시작 시 자동 실행” 체크를 **해제**하면 꺼집니다.
- **시작할 때 창 열기**: 트레이 메뉴에서 켜고 끌 수 있습니다. 기본값은 **꺼짐**(트레이에만 상주)이고,
  켜면 윈도우 시작 시 창이 바로 열립니다. 설정은 `%APPDATA%\Breeze\preferences.json` 에 저장됩니다.
- **알림**: 웹에서 보내는 브라우저 알림(Notification API)이 윈도우 네이티브 토스트로 표시됩니다.
  창을 최소화했거나 트레이로 숨긴 상태, 또는 다른 채팅방을 보고 있을 때 뜹니다.
  웹의 설정 화면에서 “기기 알림”을 켜야 알림이 옵니다. (마이크/카메라 권한은 거부됩니다.)
- **외부 링크**: `edutalk.cloud` 이외의 주소와 `mailto:`, `tel:` 링크는 기본 브라우저/앱으로 열립니다.
- **구글 로그인**: 웹의 `signInWithPopup` 팝업은 앱 안의 창으로 열립니다(Firebase 인증 도메인 `*.firebaseapp.com/__/auth`).
  이 창을 기본 브라우저로 내보내면 로그인 결과가 앱으로 돌아오지 않으므로 반드시 앱 안에서 열어야 합니다.
- **창 크기/위치 기억**: 종료 시 크기·위치·최대화 상태를 저장하고 다음 실행 때 복원합니다.
  저장 위치는 `%APPDATA%\Breeze\window-state.json` (앱 데이터 폴더)입니다.

## 폴더 구조

```
desktop/
  main.js              메인 프로세스 (창/트레이/알림/자동 실행)
  preload.js           렌더러에 최소 정보만 노출 (contextBridge)
  scripts/make-icons.js  아이콘 PNG 생성 (외부 패키지 없이 Node zlib 만 사용)
  assets/              생성된 아이콘 (icon.png 256x256, tray.png 32x32)
  build/license.txt    설치 화면에 표시되는 설치 안내 문구
  dist/                빌드 결과물 (Breeze Setup.exe)
```

## 문제 해결

- **`npm` 실행이 막힐 때(PowerShell 스크립트 정책)**: `npm.cmd install` 처럼 `npm.cmd` 로 실행하거나,
  PowerShell을 관리자 권한으로 열고 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 를 적용하세요.
- **알림이 안 뜰 때**: 웹 설정에서 “기기 알림”이 켜져 있는지, Windows 설정 → 시스템 → 알림에서
  Breeze(브리즈) 알림이 켜져 있는지 확인하세요.
- **빌드 중 electron/nsis 다운로드 실패**: 첫 빌드는 Electron(약 110MB)·NSIS 등을 내려받으므로 네트워크가 필요합니다.
  다시 실행하거나 회사/학교 네트워크에서 GitHub 다운로드가 허용되는지 확인하세요.
- **빌드 중 `ERROR: Cannot create symbolic link ... winCodeSign` 오류**: Windows에서 심볼릭 링크 생성 권한이 없을 때 발생합니다.
  Windows 설정 → 개인 정보 및 보안 → 개발자용 → **개발자 모드**를 켠 뒤 다시 빌드하거나, 관리자 권한 터미널에서 빌드하세요.
  (그래도 안 되면 `%LOCALAPPDATA%\electron-builder\Cache` 를 삭제하고 재시도해 보세요.)
  한 번 성공하면 결과가 캐시되어 이후 빌드에서는 다시 나타나지 않습니다.
- **빌드 중 `cannot access the file ... app.asar` / `사용 중이므로` 오류**: 이전 빌드 결과물(`desktop\dist\win-unpacked`)을
  어떤 프로세스가 잡고 있을 때 발생합니다. 브리즈 앱을 모두 종료한 뒤 `desktop\dist\win-unpacked` 폴더를 지우고 다시 빌드하세요.
  폴더가 지워지지 않으면 PC를 재부팅한 뒤 삭제하세요.
