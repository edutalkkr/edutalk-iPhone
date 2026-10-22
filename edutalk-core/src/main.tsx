import { createRoot } from "react-dom/client";
import App from "./App";
import { isTauriDesktop } from "./lib/edition";
import { BzContextMenuHost } from "./components/ui/BzContextMenu";
import { BzDialogHost } from "./components/ui/BzDialog";
import "./styles.css";
import "./breeze-web.css";

// 세로형 400px 클램프는 "브라우저 미리보기"에서만 켠다.
// 설치판(.exe)에서는 창을 키워도 내용이 창 폭을 그대로 채운다.
document.body.dataset.preview = isTauriDesktop() ? "0" : "1";

// 창(400x660)은 투명 + 테두리 없음이라, 바깥을 둥근 컨테이너로 감싸 모서리를 만든다.
// BzContextMenuHost/BzDialogHost: 윈도우 기본 우클릭 메뉴·confirm()을 대체하는 전역 호스트.
createRoot(document.getElementById("root")!).render(
  <div className="app-window">
    <App />
    <BzContextMenuHost />
    <BzDialogHost />
  </div>
);
