// BzContextMenu — 브리즈 전용 우클릭 메뉴.
// 윈도우 기본 컨텍스트 메뉴를 전면 대체한다.
//  · 전역 호스트 1개 + useContextMenu() 훅으로 어디서든 부착
//  · 텍스트 입력(복사/붙여넣기)에서는 네이티브 메뉴 허용
//  · 배경·그림자·라운딩·폰트 모두 breeze-web.css(bz-) 토큰 사용

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { usePresence } from "../../lib/usePresence";

export interface BzMenuItem {
  id: string;
  label?: string;
  icon?: ReactNode;
  /** 단축키·상태 설명 등 오른쪽 힌트 */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** 구분선 (label 무시) */
  separator?: boolean;
  onSelect?: () => void;
}

interface MenuState {
  x: number;
  y: number;
  items: BzMenuItem[];
  caption?: string;
}

type MenuListener = (m: MenuState | null) => void;

let menuListener: MenuListener | null = null;

export function openContextMenu(x: number, y: number, items: BzMenuItem[], caption?: string) {
  if (!items.length) return;
  menuListener?.({ x, y, items, caption });
}

export function closeContextMenu() {
  menuListener?.(null);
}

// 컴포넌트에 바로 붙이는 핸들러 생성기
export function useContextMenu() {
  return useCallback(
    (
      e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
      items: BzMenuItem[],
      caption?: string
    ) => {
      if (!items.length) return;
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY, items, caption);
    },
    []
  );
}

export function BzContextMenuHost() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const lastMenu = useRef<MenuState | null>(null);
  const { mounted, closing } = usePresence(Boolean(menu), 140);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  const [placed, setPlaced] = useState(false);
  const [active, setActive] = useState(0);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const fn: MenuListener = (m) => {
      setMenu(m);
      setActive(0);
      setPlaced(false);
    };
    menuListener = fn;
    return () => {
      if (menuListener === fn) menuListener = null;
    };
  }, []);

  // 전역 네이티브 메뉴 차단 (입력 필드는 예외)
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (e.defaultPrevented) return; // 컴포넌트가 자체 메뉴를 연 경우
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, select, [contenteditable='true'], [data-native-menu]")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  // 닫힘 트리거: 바깥 클릭·스크롤·리사이즈·Esc·창 흐림
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && menuRef.current?.contains(t)) return;
      close();
    };
    const onScroll = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onScroll);
    };
  }, [menu, close]);

  // 실측 → 뷰포트 안으로 클램프
  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 8;
    let x = menu.x;
    let y = menu.y;
    if (x + w > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - w - pad);
    if (y + h > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - h - pad);
    setPos({ left: Math.round(x), top: Math.round(y) });
    setPlaced(true);
    el.focus();
  }, [menu]);

  if (menu) lastMenu.current = menu;
  const view = menu ?? lastMenu.current;
  if (!mounted || !view) return null;

  const selectables = view.items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !it.separator && !it.disabled);

  const move = (dir: 1 | -1) => {
    if (!selectables.length) return;
    const cur = selectables.findIndex(({ i }) => i === active);
    const next = selectables[(cur + dir + selectables.length) % selectables.length];
    setActive(next.i);
  };

  return createPortal(
    <div
      ref={menuRef}
      className={`bz-menu ${closing ? "is-closing" : ""}`}
      role="menu"
      tabIndex={-1}
      aria-hidden={closing || undefined}
      style={{ left: pos.left, top: pos.top, visibility: placed ? "visible" : "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const it = view.items[active];
          if (it && !it.disabled && !it.separator) {
            close();
            it.onSelect?.();
          }
        }
      }}
    >
      {view.caption && <div className="bz-menu-cap">{view.caption}</div>}
      {view.items.map((it, i) =>
        it.separator ? (
          <div key={it.id} className="bz-menu-sep" role="separator" />
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            className={`bz-menu-item ${it.danger ? "danger" : ""} ${active === i ? "active" : ""}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              if (it.disabled) return;
              close();
              it.onSelect?.();
            }}
          >
            {it.icon != null && <span className="bz-menu-ico">{it.icon}</span>}
            <span className="bz-menu-label">{it.label}</span>
            {it.hint && <span className="bz-menu-hint">{it.hint}</span>}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
