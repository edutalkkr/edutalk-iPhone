# 브리즈코어 소개 사이트

브리즈코어(BreezeCore)를 처음 보는 학교 관리자와 교직원을 위한 **제품 소개용 정적 웹사이트**예요. 설치형 교사 앱, 교내 서버, 학생 웹, 스마트 배너, 보안·기록 기능을 한 페이지에서 살펴볼 수 있어요.

## 구성

- `index.html` — 메인 소개 페이지
- `styles.css` — 자체 디자인 시스템, 반응형, 라이트/다크 테마
- `admin.html` / `admin.js` / `admin.css` — 사이트 문구·팝업 관리자 (Firebase Auth 관리자 전용)
- `site-config.js` — Firestore가 비어 있을 때 쓰는 기본 문구·팝업 설정
- `breezecore-app.png` — 실제 브리즈코어 데스크톱 화면 (예시 이미지)
- `fonts/PretendardVariable.woff2` — 로컬 Pretendard 폰트
- `favicon.svg` — 직접 만든 브리즈코어 바람 마크

소개 페이지는 외부 폰트·이미지 CDN 없이 동작해요. 관리자 로그인만 Firebase Auth를 쓰므로 인터넷이 필요해요.

## 미리 보기

```bash
cd breezecore-site
python3 -m http.server 5600
```

브라우저에서 `http://localhost:5600/`을 열어 주세요. `index.html`을 직접 열어도 되지만, 로컬 서버로 보는 편이 테마 저장과 상대 경로 확인에 좋아요.

## 배포

정적 호스팅이면 어디든 올릴 수 있어요. 빌드 과정은 없어요.

- 학교 홈페이지의 별도 소개 페이지 폴더
- GitHub Pages / Netlify / Cloudflare Pages 같은 정적 호스팅
- 교내 서버의 `/intro/` 같은 하위 경로

이 저장소에서는 Firebase Hosting의 `/breezecore/` 아래에 배포해요. 상위 폴더에서 `npm run site:build`를 실행하면 `hosting-dist/breezecore/`가 만들어지고, `npm run site:deploy`로 Hosting과 Firestore 규칙을 함께 올려요.

하위 경로에 올릴 때는 `index.html`의 `styles.css`, `app.js`, `fonts/`, `favicon.svg` 경로가 상대 경로라 그대로 동작해요.

## 수정할 때

- **연락처**: 현재 사이트는 실제 문의를 접수하지 않아요. `도입 문의 안내` 대화상자의 안내 문구를 학교·공급자 연락처에 맞게 바꿔 주세요.
- **정책 문서**: `개인정보 처리방침`과 `이용약관`은 소개 페이지용 요약본이에요. 실제 학교 서비스에 적용할 때는 법적 검토를 거친 정식 문서로 교체해 주세요.
- **수치·기능**: 화면에 보이는 예시(학생 문의 3건, 급식 메뉴, 4교시 수학 등)는 디자인을 위한 샘플이에요. 실제 학교 데이터가 아니에요.
- **색상**: `styles.css`의 `:root` 변수만 바꾸면 전체 팔레트가 바뀌어요. 다크 모드는 `[data-theme="dark"]`에서 관리해요.

## 접근성·모션

- 키보드로 모든 메뉴와 대화상자를 쓸 수 있어요. `Esc`로 메뉴와 대화상자를 닫아요.
- `prefers-reduced-motion`이 켜져 있으면 자동 배너와 스크롤 모션을 줄여요.
- 스마트 배너는 5.2초마다 자동으로 넘어가고, 마우스를 올리거나 포커스하면 잠시 멈춰요.
- 모바일 390px에서 가로 스크롤이 생기지 않도록 확인했어요.

## 확인한 것

- Chrome 데스크톱 1440px / 모바일 390px에서 가로 오버플로 없음
- 스마트 배너 4페이지·점 이동, 하루 탭 4종, FAQ, 정책 대화상자, 테마 전환 동작
- JavaScript 예외 0건
- 외부 요청 없음
