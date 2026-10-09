# 브리즈 기능 패턴 모음 (신규 기능 만들 때 재사용)

> 익명 건의함을 만들면서 정립한 규칙. 이후 기능에도 동일 패턴을 쓴다.

## 1. 민감 기능 3단 확인
- 실행 버튼 → 3초 카운트(`countConfirm`) 또는 5초 확인(`openDangerConfirm`, 개인정보·돈 관련)
- 확인 팝업에는 결과(보관 기간·되돌리기 불가)를 반드시 적는다
- `dismissible:false`로 ESC 무한대기 방지

## 2. 삭제는 소프트 삭제 + TTL
- 화면에서만 숨기고 DB는 `status:'deleted'`로 상태값만 변경
- `expire_at`을 함께 기록 (건의 1년, 채팅 30일)
- Cloud Functions 스케줄러가 기간 지나면 영구 삭제돼요. 도입 전까지는 수동 안내
- 수사 협조 건은 `legalHold:true`로 동결하면 자동 파기 대상에서 제외 (해제 전까지 삭제 불가)
- 삭제 팝업에 보관 기간·사유를 명시하고, 영향받는 사용자에게도 알린다

## 3. 접속 로그는 암호문 보관 + 화면 비노출
- IP·UA·기기ID는 AES-GCM 암호문(`ipEnc/uaEnc/devEnc`) + 해시(`ipHash`)로만 저장
- 목록·상세 화면에는 절대 렌더링하지 않는다 (`esc()` 여부와 무관하게 읽어오지 않음)
- 열람은 총관리자만, 규칙에서 `isAdmin()`으로 강제

## 4. 담당 지정·이관 감사 로그
- `suggestionAudit` 형태: `{schoolId, action:'assign', fromUid/fromName, toUid/toName, byUid/byName, createdAt}`
- 지정·변경·해제 모두 기록, 지정 모달에서 이력 조회 가능
- 이관 시旧 담당 접근은 규칙의 `handlerUid` 기준으로 자동 차단 (별도 회수 코드 불필요)
- 형식 예시: `[2026-03-01] 학교 관리자(admin_01)가 '익명 건의함' 담당자를 A 교사에서 B 교사로 변경함.

## 5. 계정 조치 알림
- 학교 변경·권한 변경·타임아웃·정지·해제·교사 승인 시 `directNotices`로 본인에게 팝업
- `notifyAccountAction(targetUid, text)` 사용, 본인에게는 보내지 않음
- 팝업은 X로 닫을 수 있게 (`read-notice` 확인 시 읽음 처리)

## 6. 대용량 파일 청크
- 850KB 초과 시 `800KB` 조각으로 `messages/{id}/chunks/{id}_{i}` 저장 (최대 10조각·8MB)
- 청크 문서는 `{i, senderUid, data}` + 읽기 시 `senderUid==메시지 작성자` 검증
- 메시지는 청크를 먼저 쓰고 마지막에 만든다 (미완성 노출 방지)

## 7. 다크모드
- 고정 색상 금지, 반드시 `var(--...)` 사용 (`--surface`, `--danger`, `--danger-soft` 등)
- `html.dark` 오버라이드는 변수로 못 덮는 경우만 추가

## 8. 규칙 배포 체크리스트
- 새 컬렉션/필드는 `firestore.rules`에 match 추가 후 `firebase deploy --only firestore:rules`
- 배포 전에는 클라이언트가 권한 에러로 실패한다 → 실패 시 조용히 Degrade + 토스트
