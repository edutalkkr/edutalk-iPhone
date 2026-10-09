import { useEffect, useRef, useState } from "react";
import { call, TemplateRow } from "../lib/tauri";

// 자주 쓰는 문구 넣기 + 1초 답장 스티커 (쪽지 쓰기 옆에 붙는다)
export const STICKERS = ["확인했습니다", "감사합니다", "넵!", "제출 완료", "수고하셨습니다"];

export function TemplatesBar({ onInsert }: { onInsert: (body: string) => void }) {
  const [tpls, setTtpls] = useState<TemplateRow[]>([]);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      setTtpls(await call<TemplateRow[]>("template_list"));
    } catch {
      /* 다음에 */
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex gap-2 flex-wrap items-center mb-2">
      <button className="edu-ghost !py-1 !px-2 !text-xs" onClick={() => { setOpen(!open); load(); }}>
        문구 넣기
      </button>
      {STICKERS.map((s) => (
        <button key={s} className="edu-ghost !py-1 !px-2 !text-xs" onClick={() => onInsert(s)}>
          {s}
        </button>
      ))}
      {open && (
        <div className="w-full border border-edu-line rounded-xl p-2 bg-white">
          {tpls.map((t) => (
            <button
              key={t.id}
              className="block w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-edu-hover"
              onClick={() => {
                onInsert(t.body);
                setOpen(false);
              }}
            >
              <b>{t.title}</b>
              <span className="block text-edu-sub truncate">{t.body.slice(0, 60)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 1초 꾹 누르기 버튼 (대량 발송·첨부 전송 잠금용)
export function HoldButton({ onDone, label, busyLabel }: { onDone: () => void; label: string; busyLabel: string }) {
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function start() {
    if (done) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      setDone(true);
      setHolding(false);
      onDone();
      // 다음 발송을 위해 잠시 뒤 리셋
      setTimeout(() => setDone(false), 1500);
    }, 1000);
  }
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }

  return (
    <button
      className="edu-btn flex-1"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
    >
      {done ? busyLabel : holding ? "꾹 누르는 중… (1초)" : label}
    </button>
  );
}
