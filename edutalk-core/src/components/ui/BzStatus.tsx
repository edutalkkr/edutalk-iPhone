// BzStatus — 브리즈 상태 표시 컴포넌트.
// [아이콘 + 컬러 점 + 텍스트] 조합으로 단순 색 점보다 직관성을 높인다.

import type { ReactNode } from "react";
import { STATUS_LIST, STATUS_META } from "../../lib/status";
import type { TeacherStatus } from "../../types";
import { StatusIcon } from "./BzIcons";
import { useContextMenu } from "./BzContextMenu";

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

/** 내 상태 선택 — 클릭 시 브리즈 컨텍스트 메뉴로 8종 선택 */
export function StatusPicker({ value, onChange, focusActive = false, className = "", caption = "내 상태", compact = false, hintFor }: PickerProps) {
  const openMenu = useContextMenu();

  const items = STATUS_LIST.map((s) => {
    const meta = STATUS_META[s];
    return {
      id: s,
      label: meta.label,
      icon: (
        <span style={{ color: meta.color, display: "inline-flex" }}>
          <StatusIcon status={s} size={14} />
        </span>
      ),
      hint: s === value && focusActive ? "Focus Mode" : hintFor?.(s),
      onSelect: () => onChange(s),
    };
  });

  return (
    <button
      type="button"
      className={`bz-st-pick ${className}`}
      onClick={(e) => openMenu(e, items, caption)}
      aria-haspopup="menu"
    >
      <StatusBadge status={focusActive ? "away" : value} focus={focusActive} compact={compact} text={focusActive ? "퇴근 후 업무 휴식 중" : undefined} />
      <span className="bz-st-caret" aria-hidden="true">▾</span>
    </button>
  );
}
