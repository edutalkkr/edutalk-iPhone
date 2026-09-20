# Agent Project Guidelines

## 1. UI/UX & Motion Design
- **로딩 모션:** 표준적인 프로그래스 바 대신, Android TV 부팅 애니메이션처럼 매우 부드럽고 쫀득하며 유기적인 SVG/Lottie 기반(또나 Framer Motion / CSS keyframe) 모션 그래픽을 적용할 것.
- **디자인 정체성:** 특정 금융 앱(토스 등)의 고유 레이아웃이나 시그니처 색상/아이콘/폰트를 그대로 복제하지 말 것. 독창적이면서도 현대적이고 깔끔한 UX 구현.
- **애니메이션:** 페이지 전환, 버튼 클릭, 카드 호버 시 60fps의 부드러운 트랜지션 및 마이크로 인터랙션 추가.

## 2. 보안 및 저작권 (Legal & Security)
- **저작권 보호:** 타사 상표, 로고, 라이선스가 불투명한 외부 자산을 절대 사용하지 말 것.
- **보안 강화:**
  - 사용자 입력값 검증 및 산독화(Sanitization) 필수 적용.
  - API Key 및 환경 변수는 절대 클라이언트 코드에 하드코딩하지 말고 `.env`에서 관리할 것.
  - Firebase 사용 시 Firestore / Storage Security Rules를 엄격하게 설정하여 권한 없는 접근 차단.
  - CORS, CSRF, XSS 방지 로직 점검.

## 3. 안정성 및 자율 에이전트 작업 수행 규칙
- 모든 기능 구현 후 빌드 에러(`npm run build` 등)와 린트 에러가 0개인지 확인할 것.
- 예외 처리(Try-Catch, Error Boundary, Null-Check)를 철저히 작성하여 앱이 튕기거나 멈추지 않게 할 것.
- 수정 완료 후 자체 테스트 스크립트나 검증 로직을 돌려 에러가 없는지 자가 점검할 것.
