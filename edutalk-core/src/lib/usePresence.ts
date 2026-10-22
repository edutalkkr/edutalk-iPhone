import { useEffect, useRef, useState } from "react";

/**
 * 열림/닫힘 상태에 맞춰 컴포넌트를 잠깐 더 유지해 주는 훅.
 *  · open=false 가 되면 closing=true 로 바꾸고 exitMs 뒤에 unmount 한다.
 *  · 닫히는 동안 CSS에서 .is-closing 애니메이션(페이드/슬라이드)을 적용할 수 있다.
 *  · 새 창을 빠르게 다시 열면 예약된 unmount를 취소한다.
 */
export function usePresence(open: boolean, exitMs = 180) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
      timer.current = null;
    }, Math.max(0, exitMs));
    return () => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [open, mounted, exitMs]);

  return { mounted, closing };
}
