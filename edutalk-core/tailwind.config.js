/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // 브리즈 토큰: 스카이 블루 (대한항공 세련된 하늘색 모티브)
      // Primary Sky #0082C8 · Breeze Ice #E8F4FB · Cool Background #F8FAFC
      colors: {
        edu: {
          blue: "#0082C8", // Primary Sky — 브랜드·전송 버튼·활성 탭·주요 아이콘
          strong: "#0069A8", // 진한 하늘 — 그라디언트 끝·강조 텍스트
          soft: "#E8F4FB", // Breeze Ice — 내 말풍선·태그 배경·리스트 하이라이트
          line: "#E2E8F0",
          blueline: "#9BD3EE",
          ink: "#0F172A", // Text Dark Blue — 본문 타이포
          sub: "#475569",
          muted: "#64748B", // Text Muted — 시각·부서명·안 읽음 수
          bg: "#F8FAFC", // Cool Background — 앱 기본 배경
          chip: "#F1F5F9",
          hover: "#F1F5F9",
          green: "#16A34A",
          deepblue: "#2563EB",
          danger: "#E5484D",
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
