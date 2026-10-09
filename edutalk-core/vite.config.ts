import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 개발 서버 고정 포트 (tauri.conf.json의 devUrl과 맞춤)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust 빌드 결과물(src-tauri/target)은 감시에서 뺀다.
    // 안 빼면 계속 바뀌는 .dll에 걸려 감시기가 죽는다 (EBUSY).
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome105",
  },
});
