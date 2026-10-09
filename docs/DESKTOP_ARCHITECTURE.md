# Breeze Desktop-First Native Architecture (웹래퍼 탈피)

> 목표: 설치 파일 10~20MB, RAM <60MB, 오프라인(교내연결) 0.001초 부팅, OS 직접제어.

## 왜 웹래퍼가 불가한가 (3가지)
1. 내부망 차단 시 흰화면: `https://edutalk.cloud` 로드가 막히면 앱 자체가 안 뜸 → 로컬 `public/index.html` 우선 로드로 해결.
2. OS 제어 불가: USB(WM_DEVICECHANGE), PrintScreen 블러, P2P 소켓은 네이티브 백엔드만 가능 → Electron 메인 / Tauri Rust로 이동.
3. RAM 폭증: 브라우저 전체+웹래퍼 150~300MB → Tauri 30~50MB, Electron도 로컬-first + 백그라운드 스로틀 유지로 절감.

## 구조
```
[교사 PC]
┌ 브리즈 데스크톱 (Local Native Runtime) ─────────────┐
│ Local UI (public/*.html/css/js, 오프라인 우선)  IPC  Native Backend (Rust/C#/Node) │
└──────────────────────────────┬──────────────────────┘
                               ▼
                 SQLite DB / ONNX DLP / P2P Direct Socket / AutoPurge 캐시
```

## 현 구현 (Electron Local-First, Tauri 이행 다리)
- `desktop/main.js`: `localUiPath()` → `loadFile(public/index.html)` 우선, 실패 시만 클라우드 폴백. `did-fail-load`에서 file://는 재시도 안 함.
- `desktop/preload.js`: allowlist 채널만 노출 (`edutalk:*`), `ipcRenderer` 원본 차단.
- `desktop/native/`: `dlp.js` / `p2p.js` / `autopurge.js` / `ramPreview.js` / `deviceGuard.js` / `netmode.js`
- `desktop/package.json`: `public/**` + `native/**` 번들, `extraResources: ../public → public`
- `src-tauri/`: Tauri 2 + Rust 백엔드 (`dlp_verify`, `local_memo_save`, `p2p_peers`). `frontendDist=../public` 공유로 UI 재사용.
- `public/lite.js`: 외부 라이트 웹 (수신전용, 백그라운드 연산 차단). `?lite=1` 또는 모바일폭에서 자동.
- `public/memo-hybrid.js/css`: 클래식 쪽지(제목-수신자-본문/HWP-수신확인) + 하단 댓글 스레드 + 1:1 퀵채팅.

## 네트워크 모드
- `intranet (파란)`: P2P 직송 우선, 클라우드 송신 금지, DLP는 warn만.
- `external (초록)`: Pre-Send DLP 필수 경유 → block 시 패킷 송신 안 함 + 암호화 감사로그.

## Tauri 이행 순서 (권장)
1. `npm run smoke` (Electron native 스모크) 통과 확인.
2. `cargo tauri build` → 10~20MB 설치파일, RAM 30~50MB 확인.
3. ONNX는 `ort` 크레이트로 교체, HWP 파서는 Rust `hwpx` 계열로 이식, USB/캡처는 `windows` 크레이트로 네이티브 후킹.
