import { useState } from "react";
import { isTauriDesktop } from "../../lib/edition";

// 브리즈 전용 창 버튼 — 항상 그린다.
// - 설치판(Tauri): 진짜 최소화·최대화·닫기.
// - 브라우저 미리보기: 겉모양은 같고, 누르면 설치판 안내를 띄운다 (X 위치는 고정).
export default function TitleBar({ onPreviewAction }: { onPreviewAction?: () => void }) {
  const [max, setMax] = useState(false);
  const desktop = isTauriDesktop();

  async function act(kind: "min" | "max" | "close") {
    if (!desktop) {
      onPreviewAction?.();
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if (kind === "min") await w.minimize();
      else if (kind === "close") await w.close();
      else {
        await w.toggleMaximize();
        // 토글 추정이 아니라 실제 상태를 읽는다 (OS로 최대화해도 어긋나지 않는다)
        setMax(await w.isMaximized());
      }
    } catch {
      onPreviewAction?.();
    }
  }

  return (
    <div
      data-tauri-drag-region
      className="h-10 shrink-0 flex items-center gap-2 pl-3 pr-1.5 bg-white border-b border-edu-line select-none"
      onDoubleClick={() => { void act("max"); }}
    >
      <span className="w-6 h-6 rounded-lg grid place-items-center text-white text-[13px] font-black" style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}>
        B
      </span>
      <span className="font-extrabold text-[13px]">브리즈</span>
      <span className="flex-1" />
      <button
        className="w-9 h-8 rounded-lg grid place-items-center text-[13px] text-edu-sub hover:bg-edu-chip transition-colors"
        title="최소화"
        onClick={() => { void act("min"); }}
      >
        ─
      </button>
      <button
        className="w-9 h-8 rounded-lg grid place-items-center text-[12px] text-edu-sub hover:bg-edu-chip transition-colors"
        title={max ? "복원" : "최대화"}
        onClick={() => { void act("max"); }}
      >
        {max ? "❐" : "▢"}
      </button>
      <button
        className="w-9 h-8 rounded-lg grid place-items-center text-[13px] font-bold text-edu-sub hover:bg-[#E5484D] hover:text-white transition-colors"
        title="끄기"
        aria-label="창 닫기"
        onClick={() => { void act("close"); }}
      >
        ✕
      </button>
    </div>
  );
}
