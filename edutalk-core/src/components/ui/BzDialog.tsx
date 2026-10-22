// BzDialog — 브리즈 전용 확인/알림 모달 (Promise API).
// 네이티브 confirm()/alert() 을 대체한다. 로그아웃·삭제 등 파괴적 동작에 사용.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { usePresence } from "../../lib/usePresence";

export interface BzConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export interface BzAlertOptions {
  title: string;
  message?: ReactNode;
  okText?: string;
}

interface DialogState {
  kind: "confirm" | "alert";
  opts: BzConfirmOptions;
  resolve: (v: boolean) => void;
}

let dialogListener: ((d: DialogState | null) => void) | null = null;

export function bzConfirm(opts: BzConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!dialogListener) {
      // 호스트 미장착(초기 부팅 등) 시 최소 보장
      resolve(window.confirm(`${opts.title}${opts.message ? `\n${typeof opts.message === "string" ? opts.message : ""}` : ""}`));
      return;
    }
    dialogListener({ kind: "confirm", opts, resolve });
  });
}

export function bzAlert(opts: BzAlertOptions): Promise<void> {
  return new Promise((resolve) => {
    if (!dialogListener) {
      window.alert(`${opts.title}${opts.message ? `\n${typeof opts.message === "string" ? opts.message : ""}` : ""}`);
      resolve();
      return;
    }
    dialogListener({ kind: "alert", opts: { ...opts, confirmText: opts.okText ?? "확인" }, resolve: () => resolve() });
  });
}

export function BzDialogHost() {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const lastDialog = useRef<DialogState | null>(null);
  const { mounted, closing } = usePresence(Boolean(dialog), 170);

  useEffect(() => {
    const fn = (d: DialogState | null) => setDialog(d);
    dialogListener = fn;
    return () => {
      if (dialogListener === fn) dialogListener = null;
    };
  }, []);

  useEffect(() => {
    if (dialog) confirmRef.current?.focus();
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dialog.resolve(false);
        setDialog(null);
      } else if (e.key === "Enter") {
        e.stopPropagation();
        dialog.resolve(true);
        setDialog(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dialog]);

  if (dialog) lastDialog.current = dialog;
  const view = dialog ?? lastDialog.current;
  if (!mounted || !view) return null;
  const { kind, opts } = view;

  const finish = (v: boolean) => {
    if (!dialog) return;
    dialog.resolve(v);
    setDialog(null);
  };

  return createPortal(
    <div
      className={`bz-dialog-overlay ${closing ? "is-closing" : ""}`}
      aria-hidden={closing || undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget) finish(false); }}
    >
      <div className={`bz-dialog ${closing ? "is-closing" : ""}`} role="alertdialog" aria-modal="true" aria-label={opts.title}>
        <div className={`bz-dialog-title ${opts.danger ? "danger" : ""}`}>{opts.title}</div>
        {opts.message != null && <div className="bz-dialog-msg">{opts.message}</div>}
        <div className="bz-dialog-actions">
          {kind === "confirm" && <button type="button" className="bz-btn-ghost" onClick={() => finish(false)}>{opts.cancelText ?? "취소"}</button>}
          <button
            ref={confirmRef}
            type="button"
            className={`bz-btn ${opts.danger ? "danger" : ""}`}
            onClick={() => finish(true)}
          >
            {opts.confirmText ?? (kind === "alert" ? "확인" : "확인")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
