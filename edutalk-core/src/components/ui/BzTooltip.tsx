// BzTooltip — 브리즈 전용 툴팁.
// 윈도우 OS 기본 툴팁(title="...")을 전면 대체한다.
//  · 앱 글꼴 설정을 그대로 상속
//  · 뷰포트 경계 자동 보정(클램프) + portal 렌더로 overflow 클리핑 회피
//  · 키보드 포커스 지원, 자유 위치(top/bottom/left/right)

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

export type TooltipPosition = "top" | "bottom" | "left" | "right";

interface BzTooltipProps {
  content: ReactNode;
  position?: TooltipPosition;
  /** 표시 지연(ms) */
  delay?: number;
  disabled?: boolean;
  /** 래퍼(span) 클래스 — w-full 등 배치 조정용 */
  className?: string;
  children: ReactNode;
}

export default function BzTooltip({
  content,
  position = "top",
  delay = 150,
  disabled = false,
  className = "",
  children,
}: BzTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [coords, setCoords] = useState<CSSProperties>({ left: -9999, top: -9999 });

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const show = useCallback(
    (withDelay: boolean) => {
      if (disabled || content == null) return;
      clearTimer();
      clearCloseTimer();
      const run = () => {
        openRef.current = true;
        setClosing(false);
        setPlaced(false);
        setOpen(true);
      };
      if (withDelay && delay > 0) timerRef.current = window.setTimeout(run, delay);
      else run();
    },
    [disabled, content, delay]
  );

  // 사라질 때도 짧게 애니메이션을 보여준 뒤 DOM에서 제거한다.
  const hide = useCallback(() => {
    clearTimer();
    clearCloseTimer();
    if (!openRef.current) return;
    openRef.current = false;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, 140);
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      clearCloseTimer();
    },
    []
  );

  // 열려 있는 동안: 스크롤·리사이즈되면 위치가 어긋나므로 닫는다 (데스크톱 앱 관례)
  useEffect(() => {
    if (!open) return;
    const close = () => hide();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("mousedown", close, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("mousedown", close, true);
    };
  }, [open, hide]);

  // 첫 페인트 후 실측 → 위치 확정 (깜빡임 방지: 확정 전 visibility hidden)
  useLayoutEffect(() => {
    if (!open) return;
    const a = anchorRef.current;
    const tip = tipRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const tw = tip?.offsetWidth ?? 0;
    const th = tip?.offsetHeight ?? 0;
    const gap = 9;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let pos: TooltipPosition = position;

    // 공간이 없으면 자동 플립
    if (pos === "top" && r.top - th - gap < pad) pos = "bottom";
    else if (pos === "bottom" && r.bottom + th + gap > vh - pad) pos = "top";
    else if (pos === "left" && r.left - tw - gap < pad) pos = "right";
    else if (pos === "right" && r.right + tw + gap > vw - pad) pos = "left";

    let x = 0;
    let y = 0;
    switch (pos) {
      case "top":
        x = r.left + r.width / 2 - tw / 2;
        y = r.top - th - gap;
        break;
      case "bottom":
        x = r.left + r.width / 2 - tw / 2;
        y = r.bottom + gap;
        break;
      case "left":
        x = r.left - tw - gap;
        y = r.top + r.height / 2 - th / 2;
        break;
      case "right":
        x = r.right + gap;
        y = r.top + r.height / 2 - th / 2;
        break;
    }
    x = Math.max(pad, Math.min(x, vw - tw - pad));
    y = Math.max(pad, Math.min(y, vh - th - pad));
    setCoords({ left: Math.round(x), top: Math.round(y) });
    setPlaced(true);
    // 화살표 방향: 실제 배치 위치 기준
    if (pos !== position) tip?.setAttribute("data-flip", pos);
    else tip?.removeAttribute("data-flip");
  }, [open, position, content]);

  if (content == null || disabled) {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={anchorRef}
        className={`bz-tip-anchor ${className}`}
        onMouseEnter={() => show(true)}
        onMouseLeave={hide}
        onFocusCapture={() => show(false)}
        onBlurCapture={hide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            className={`bz-tip${closing ? " closing" : ""}`}
            data-pos={position}
            data-closing={closing ? "true" : undefined}
            role="tooltip"
            style={{ ...coords, visibility: placed ? "visible" : "hidden" }}
          >
            {content}
            <i className="bz-tip-arrow" aria-hidden="true" />
          </div>,
          document.body
        )}
    </>
  );
}
