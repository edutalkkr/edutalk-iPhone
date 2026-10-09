import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// 창(400x860)은 투명 + 테두리 없음이라, 바깥을 둥근 컨테이너로 감싸 모서리를 만든다.
createRoot(document.getElementById("root")!).render(
  <div className="app-window">
    <App />
  </div>
);
