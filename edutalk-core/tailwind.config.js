/** @type {import('tailwindcss').Config} */
// 브리즈 토큰: 모든 색을 CSS 변수(RGB 트리플렛)로 정의한다.
// 변수 정의는 src/styles.css 의 :root / [data-theme="dark"] 참고.
// → 다크모드 전환 시 컴포넌트 코드 수정 없이 명암비가 보정된다 (WCAG 4.5:1 이상).
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        edu: {
          blue: v("--edu-blue"), // Primary Sky — 브랜드·전송 버튼·활성 탭
          strong: v("--edu-strong"), // 강조 텍스트 (다크에선 밝은 하늘)
          soft: v("--edu-soft"), // Breeze Ice — 내 말풍선·태그 배경
          line: v("--edu-line"),
          blueline: v("--edu-blueline"),
          ink: v("--edu-ink"), // 본문 텍스트
          sub: v("--edu-sub"), // 보조 텍스트
          muted: v("--edu-muted"), // 시각·부서명·안 읽음 수
          bg: v("--edu-bg"), // 앱 기본 배경
          surface: v("--edu-surface"), // 카드·패널 표면 (다크에서 #1A2029)
          chip: v("--edu-chip"),
          hover: v("--edu-hover"),
          green: v("--edu-green"),
          deepblue: v("--edu-deepblue"),
          danger: v("--edu-danger"),
        },
      },
      borderRadius: {
        // 입력함·창처럼 상시 켜두는 면은 6~10pt의 미세한 곡률
        edu: "10px",
      },
    },
  },
  plugins: [],
};
