# Breeze 보안 점검 (신규 기능 + 기존 취약점)

점검일: 2026-09-30 / 대상: desktop-native + public memo-hybrid + firestore.rules / 기준: OWASP Top 10 + K-ISMS-P

## 신규 기능 보안 상태

### 1) Pre-Send On-Device DLP — 양호 (조건부)
- ✅ 차단 우선: `verdict=block` 시 클라우드 `add()` 호출 자체를 안 함 (memo-hybrid.js `sendMemo`).
- ✅ 평문 미저장: 감사로그는 AES-256-GCM 암호화, 샘플은 `[redacted]`.
- ⚠️ 우회 가능: 렌더러 변조 시 DLP 스킵 가능 → 서버사이드 2차 검증(Firestore Rules + Functions) 필수. 현재 Rules는 길이만 검사하므로 Functions에서 정규식 재검사를 권장.
- ⚠️ 모델 탈취: ONNX 파일이 번들에 평문이면 추출 가능 → 모델 난독화/무결성 체크 필요.

### 2) P2P Serverless — 주의
- ✅ LAN 한정: 브로드캐스트가 교내망 밖으로 안 나감 (255.255.255.255 + 서브넷).
- ⚠️ 평문 전송: 현재 TCP 프레임이 평문 JSON → 동일 LAN에서 스니핑 가능. **TLS-PSK 또는 NaCl box로 암호화 필수** (사전공유키를 학교코드로 파생).
- ⚠️ 스푸핑: `displayName` 위조 가능 → `nodeId = pubkey 해시` + 서명 검증으로 교체 권장.

### 3) RAM 미리보기 — 양호
- ✅ 디스크 기록 ZERO: `Buffer.fill(0)` 후 해제, tmpdir 미사용 (스모크 테스트 확인).
- ⚠️ 스왑/덤프: OS 페이징 시 RAM이 디스크로 스왑될 수 있음 → 민감문서는 미리보기 후 `destroyPreview` 즉시 호출, 최대 64MB 상한 유지.

### 4) AutoPurge — 양호
- ✅ 수신파일만 대상, 30일/TTL + 3GB 상한. `recv-cache` 외부 경로는 건드리지 않음.
- ⚠️ TOCTOU: 삭제 중 앱 종료 시 잔류 가능 → 시작 20초 후 1회 재실행으로 보완됨.

### 5) USB/캡처가드 — 부분적 방어
- ✅ 탐지+감사로그는 동작. `setContentProtection(true)`로 화면공유/스크린샷 1차 방어.
- ⚠️ 완전 차단 불가: 앱 레벨에서는 USB 복사 차단·커널 캡처 차단이 안 됨 → DLP 정책상 “경고+로그”로 명시하고, 드라이버(커널) 제품을 별도로 고지해야 함. 허위 “100% 차단” 문구 금지.

## 기존 코드에서 발견된 취약점 (수정 반영)

1. **[수정] preload allowlist 없음 → allowlist 추가**: 기존 `edutalkDesktop`이 invoke 채널을 무제한 노출하지는 않았지만, 신규 채널 추가 시 우회 우려 → `ALLOWED_INVOKE/ALLOWED_ON` + `safeInvoke/safeOn` 적용.
2. **[수정] Firestore `memos` 컬렉션 없음 → Rules 추가**: 제목/본문 길이 제한, `fromUid==auth.uid` 강제, `delete:false`, 댓글은 2000자·생성만 허용.
3. **[잔존] `firebase.js` apiKey 노출**: 공개 식별자라 정상이나, Console에서 HTTP referrer 제한 + App Check를 켜야 함. 서비스계정 키는 절대 포함 금지 (현재 없음, 유지).
4. **[잔존] XSS**: `app.js` 1MB에 innerHTML 다수 사용 → 신규 코드(`memo-hybrid.js`)는 `esc()` + `textContent` 사용. 기존 코드는 DOMPurify 도입 권장.
5. **[잔존] Electron `will-navigate`만 차단**: `new-window` 외에 `setWindowOpenHandler`는 이미 처리됨. `shell.openExternal`은 http/https/mailto/tel만 허용 (유지).
6. **[권장] CSP**: Tauri conf에 CSP 추가함. Electron도 `session.webRequest.onHeadersReceived`로 동일 CSP 적용 권장 (다음 단계).
7. **[권장] 자동업데이트 서명**: NSIS oneClick 배포 시 업데이트 파일 위변조 대비 `publisherName +签名` 설정 필요.

## 결론
- 데스크톱 전용 기능은 “로컬 우선 + 클라우드 미송신” 원칙을 지켜 DLP/RAM/Purge는 양호.
- P2P 암호화 + 서버사이드 DLP 2차검증 + CSP 헤더가 남았으니, 다음 릴리스 전에 3건만 마저 하면 실전 투입 가능.
