import { useState } from "react";
import { isTauriDesktop } from "../../lib/edition";
import { APP_VERSION } from "../../lib/version";
import BzTooltip from "../ui/BzTooltip";

interface ConnectionStatus {
  connected: boolean;
  type: "intranet" | "external" | "connecting" | "disconnected";
  message: string;
}

interface Props {
  onPreviewAction?: () => void;
  connectionStatus?: ConnectionStatus;
}

// 브리즈 전용 창 버튼 — 항상 그린다.
// - 설치판(Tauri): 진짜 최소화·최대화·닫기.
// - 브라우저 미리보기: 겉모양은 같고, 누르면 설치판 안내를 띄운다 (X 위치는 고정).
export default function TitleBar({ onPreviewAction, connectionStatus }: Props) {
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
        setMax(await w.isMaximized());
      }
    } catch {
      onPreviewAction?.();
    }
  }

  const getStatusColor = () => {
    if (!connectionStatus) return "bg-edu-muted";
    switch (connectionStatus.type) {
      case "intranet": return "bg-[#12b980]";
      case "external": return "bg-[#16A34A]";
      case "connecting": return "bg-[#f5b400]";
      case "disconnected": return "bg-[#E5484D]";
      default: return "bg-edu-muted";
    }
  };

  const getStatusText = () => {
    if (!connectionStatus) return "연결 안 됨";
    return connectionStatus.message;
  };

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
      <span className="text-[10.5px] font-bold text-edu-muted mt-0.5">v{APP_VERSION}</span>
      
      {connectionStatus && (
        <div className="flex items-center gap-1.5 ml-2 px-2 py-1 rounded-full bg-edu-chip border border-edu-line">
          <span className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
          <span className="text-[11px] font-medium text-edu-ink">{getStatusText()}</span>
        </div>
      )}
      
      <span className="flex-1" />
      <BzTooltip content="최소화" position="bottom">
        <button
          className="w-9 h-8 rounded-lg grid place-items-center text-[13px] text-edu-sub hover:bg-edu-chip transition-colors"
          onClick={() => { void act("min"); }}
          aria-label="최소화"
        >
          ─
        </button>
      </BzTooltip>
      <BzTooltip content={max ? "복원" : "최대화"} position="bottom">
        <button
          className="w-9 h-8 rounded-lg grid place-items-center text-[12px] text-edu-sub hover:bg-edu-chip transition-colors"
          onClick={() => { void act("max"); }}
          aria-label={max ? "복원" : "최대화"}
        >
          {max ? "❐" : "▢"}
        </button>
      </BzTooltip>
      <BzTooltip content="끄기" position="bottom">
        <button
          className="w-9 h-8 rounded-lg grid place-items-center text-[13px] font-bold text-edu-sub hover:bg-[#E5484D] hover:text-white transition-colors"
          aria-label="창 닫기"
          onClick={() => { void act("close"); }}
        >
          ✕
        </button>
      </BzTooltip>
    </div>
  );
}
