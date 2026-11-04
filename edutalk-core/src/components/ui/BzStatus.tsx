// BzStatus — 브리즈 상태 표시 컴포넌트.
// [아이콘 + 컬러 점 + 텍스트] 조합으로 단순 색 점보다 직관성을 높인다.

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { STATUS_LIST, STATUS_META } from "../../lib/status";
import type { TeacherStatus } from "../../types";
import { StatusIcon } from "./BzIcons";

interface DotProps {
  status: TeacherStatus;
  /** 퇴근 후 업무 휴식(Focus Mode) 표시 */
  focus?: boolean;
  size?: number;
  className?: string;
}

/** 컬러 점 단독 (아바타 옆 등 밀집 영역용) */
export function StatusDot({ status, focus = false, size = 9, className = "" }: DotProps) {
  const color = focus ? "#64748B" : STATUS_META[status]?.color ?? "#94A3B8";
  return (
    <span
      className={`bz-st-dot-inline ${className}`}
      style={{ width: size, height: size, background: color }}
      aria-hidden="true"
    />
  );
}

interface BadgeProps {
  status: TeacherStatus;
  /** 표시 문구 (없으면 라벨) */
  text?: string;
  compact?: boolean;
  focus?: boolean;
  withDot?: boolean;
  className?: string;
}

/** [아이콘 + 컬러 점 + 텍스트] 뱃지 */
export function StatusBadge({ status, text, compact = false, focus = false, withDot = true, className = "" }: BadgeProps) {
  const meta = STATUS_META[status] ?? STATUS_META.online;
  const label = focus ? text ?? "퇴근 후 업무 휴식 중" : text ?? meta.label;
  return (
    <span className={`bz-st ${status} ${focus ? "focus" : ""} ${compact ? "compact" : ""} ${className}`}>
      <StatusIcon status={status} size={compact ? 12 : 13} className="bz-st-ico" />
      {withDot && <span className="bz-st-dot" aria-hidden="true" />}
      <span className="bz-st-txt">{label}</span>
    </span>
  );
}

interface PickerProps {
  value: TeacherStatus;
  onChange: (s: TeacherStatus) => void;
  focusActive?: boolean;
  /** 버튼에 덧붙일 클래스 */
  className?: string;
  /** 메뉴 캡션 */
  caption?: string;
  /** 접힘 표시(아이콘+텍스트 최소형) */
  compact?: boolean;
  /** 메뉴 아이템에 힌트(내부 사유 등) */
  hintFor?: (s: TeacherStatus) => string | undefined;
}

/** 내 상태 선택 — 버튼이 아래로 자라나며 목록이 펼쳐지고, 바깥을 누르면 접힌다. */
export function StatusPicker({ value, onChange, focusActive = false, className = "", caption = "내 상태", compact = false, hintFor }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [shell, setShell] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const expand = () => {
    clearCloseTimer();
    setShell(true);
    setOpen(true);
  };

  const collapse = () => {
    setOpen(false);
    clearCloseTimer();
    // 접히는 모션(0.26s)이 끝날 때까지 패널 배경을 유지한다.
    closeTimer.current = window.setTimeout(() => {
      setShell(false);
      closeTimer.current = null;
    }, 300);
  };

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        collapse();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const select = (s: TeacherStatus) => {
    onChange(s);
    collapse();
  };

  return (
    <div
      ref={containerRef}
      className={`bz-st-pick-wrap relative w-full ${shell ? "is-open" : ""}`}
    >
      <div
        className={`bz-st-backdrop ${open ? "show" : ""}`}
        aria-hidden="true"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          collapse();
        }}
      />
      <button
        type="button"
        className={`bz-st-pick ${className}`}
        onClick={() => (open ? collapse() : expand())}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <StatusBadge status={focusActive ? "away" : value} focus={focusActive} compact={compact} text={focusActive ? "퇴근 후 업무 휴식 중" : undefined} />
        <span className={`bz-st-caret ${open ? "is-open" : ""}`} aria-hidden="true">▾</span>
      </button>
      <div className={`bz-st-expander ${open ? "is-open" : ""}`} aria-hidden={!open}>
        <div className="bz-st-expander-inner">
          <div className="bz-st-menu" role="listbox" aria-label={caption}>
            {STATUS_LIST.map((s) => {
              const meta = STATUS_META[s];
              const active = s === value && !focusActive;
              return (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`bz-st-item ${active ? "is-active" : ""}`}
                  onClick={() => select(s)}
                >
                  <span style={{ color: meta.color, display: "inline-flex" }}>
                    <StatusIcon status={s} size={14} />
                  </span>
                  <span className="bz-st-dot" style={{ background: meta.color }} aria-hidden="true" />
                  <span className="bz-st-item-label">{meta.label}</span>
                  {hintFor?.(s) && <span className="bz-st-item-hint">{hintFor(s)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}