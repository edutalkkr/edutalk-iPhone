// 공지 게시 확인 팝업 — 일반/긴급 공통.
//  · 부모 컨테이너의 overflow/transform에 잘리지 않도록 body로 포털한다.
//  · 닫힐 때도 퇴장 모션을 보여 준다 (usePresence).
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../../lib/usePresence";
import { previewSiren } from "../../lib/siren";

export interface PublishPreview {
  title: string;
  body: string;
  urgent: boolean;
  targetLabel?: string;
}

interface Props {
  notice: PublishPreview | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function BzNoticePublishDialog({ notice, onCancel, onConfirm }: Props) {
  const { mounted, closing } = usePresence(Boolean(notice), 170);
  const lastNotice = useRef<PublishPreview | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  if (notice) lastNotice.current = notice;
  const view = notice ?? lastNotice.current;

  useEffect(() => {
    if (!notice) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [notice, onCancel]);

  if (!mounted || !view) return null;
  const closeClass = closing ? " is-closing" : "";

  return createPortal(
    <div
      className={`edu-overlay${closeClass}`}
      role="presentation"
      aria-hidden={closing || undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className={`edu-modal${closeClass}`}
        style={{ maxWidth: 460 }}
        role="alertdialog"
        aria-modal="true"
        aria-label={view.urgent ? "긴급 공지 확인" : "공지 미리보기"}
      >
        {view.urgent ? (
          <>
            <div className="font-black text-[17px] text-[#D92D20]">🚨 긴급 공지로 보내시겠어요?</div>
            <div className="text-[13px] mt-2 text-edu-sub leading-relaxed">
              공지 대상 교직원 컴퓨터에 팝업이 뜨고 사이렌이 울리게 돼요.
            </div>
            <div className="mt-3 bg-edu-bg border border-edu-line rounded-xl p-3">
              <div className="font-bold text-edu-ink">{view.title}</div>
              <div className="text-[12px] text-edu-sub mt-1 whitespace-pre-wrap">{previewBody(view.body, 240)}</div>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" className="edu-ghost flex-1" onClick={() => previewSiren()}>🔊 사이렌 미리 듣기</button>
            </div>
            <div className="flex gap-2 mt-2">
              <button type="button" className="edu-ghost flex-1" onClick={onCancel}>취소</button>
              <button
                ref={confirmRef}
                type="button"
                className="edu-btn flex-1"
                style={{ background: "#D92D20", borderColor: "#D92D20" }}
                onClick={onConfirm}
              >
                긴급 공지 보내기
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="font-black text-[17px]">공지 미리보기</div>
            <div className="text-[13px] mt-1 text-edu-sub">이 내용으로 공지를 보내시겠어요?</div>
            <div className="mt-3 bg-edu-bg border border-edu-line rounded-xl p-3">
              <div className="font-bold text-edu-ink">{view.title}</div>
              <div className="text-[12px] text-edu-sub mt-1 whitespace-pre-wrap">{previewBody(view.body, 300)}</div>
              {view.targetLabel && <div className="text-[11px] text-edu-muted mt-2">대상: {view.targetLabel}</div>}
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" className="edu-ghost flex-1" onClick={onCancel}>취소</button>
              <button ref={confirmRef} type="button" className="edu-btn flex-1" onClick={onConfirm}>공지 보내기</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function previewBody(body: string, max: number): string {
  return body.length > max ? `${body.slice(0, max)}…` : body;
}
