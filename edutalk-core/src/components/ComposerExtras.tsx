import { useEffect, useRef, useState } from "react";
import { suggestTemplateTitle, useTemplates } from "../lib/templates";
import { bzConfirm } from "./ui/BzDialog";
import BzTooltip from "./ui/BzTooltip";

// 자주 쓰는 문구 넣기 + 1초 답장 스티커 (쪽지 쓰기 옆에 붙는다)
export const STICKERS = ["확인했어요", "감사해요", "넵!", "제출 완료", "수고하셨어요"];

interface TemplatesBarProps {
  /** 서식을 골랐을 때 본문에 넣는다 */
  onInsert: (body: string) => void;
  /** 현재 작성 중인 쪽지/대화 — [＋ 현재 내용 저장]에 쓴다 */
  getCurrent?: () => { title: string; body: string };
  onToast?: (t: string) => void;
}

// 교내 서식/공문 템플릿 저장소 (Breeze Templates) — 클릭 한 번으로 본문에 삽입, 작성 중인 내용을 서식으로 저장
export function TemplatesBar({ onInsert, getCurrent, onToast }: TemplatesBarProps) {
  const templates = useTemplates((s) => s.templates);
  const addTpl = useTemplates((s) => s.add);
  const removeTpl = useTemplates((s) => s.remove);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const saveCurrent = () => {
    const cur = getCurrent?.();
    if (!cur || (!cur.title.trim() && !cur.body.trim())) {
      onToast?.("서식으로 저장할 내용을 먼저 적어 주세요.");
      return;
    }
    const title = name.trim() || suggestTemplateTitle(cur.title, cur.body);
    addTpl(title, cur.body);
    setName("");
    setSaving(false);
    onToast?.(`서식을 저장했어요: ${title}`);
  };

  const askRemove = async (id: string, title: string) => {
    const ok = await bzConfirm({
      title: "서식을 삭제할까요?",
      message: `"${title}" 서식을 목록에서 지워요. 다시 복구할 수 없어요.`,
      confirmText: "삭제",
      danger: true,
    });
    if (ok) {
      removeTpl(id);
      onToast?.("서식을 삭제했어요.");
    }
  };

  return (
    <div className="flex gap-2 flex-wrap items-center mb-2">
      <button className="edu-ghost !py-1 !px-2 !text-xs" onClick={() => setOpen((v) => !v)}>
        📄 서식·문구 {open ? "▲" : "▼"}
      </button>
      {STICKERS.map((s) => (
        <button key={s} className="edu-ghost !py-1 !px-2 !text-xs" onClick={() => onInsert(s)}>
          {s}
        </button>
      ))}
      {open && (
        <div className="w-full border border-edu-line rounded-xl p-2 bg-edu-surface">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11.5px] font-bold text-edu-sub">내 서식 {templates.length}개 · 클릭하면 본문에 들어가요</span>
            {getCurrent && (
              <button className="edu-ghost !py-1 !px-2 !text-xs" onClick={() => setSaving((v) => !v)}>
                ＋ 현재 내용 저장
              </button>
            )}
          </div>
          {saving && (
            <div className="flex gap-1.5 mb-1.5">
              <input
                className="edu-input !py-1 !text-xs flex-1"
                placeholder="서식 이름 (비우면 제목·첫 줄 사용)"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveCurrent();
                  }
                }}
              />
              <button className="edu-btn !py-1 !px-2.5 !text-xs" onClick={saveCurrent}>저장</button>
            </div>
          )}
          <div className="max-h-[220px] overflow-y-auto flex flex-col gap-0.5">
            {templates.length === 0 && (
              <span className="text-xs text-edu-sub px-2 py-1.5">저장된 서식이 없어요. 쪽지를 쓰다가 [＋ 현재 내용 저장]을 눌러 보세요.</span>
            )}
            {templates.map((t) => (
              <div key={t.id} className="flex items-stretch gap-1">
                <button
                  className="flex-1 min-w-0 text-left text-xs px-2 py-1.5 rounded-lg hover:bg-edu-hover"
                  onClick={() => {
                    onInsert(t.body);
                    setOpen(false);
                  }}
                >
                  <b className="truncate">{t.title}</b>
                  {t.builtin ? <span className="ml-1 text-[10px] text-edu-muted">기본</span> : null}
                  <span className="block text-edu-sub truncate">{t.body.slice(0, 60)}</span>
                </button>
                <BzTooltip content="서식 삭제" position="left">
                  <button
                    className="px-1.5 text-edu-muted hover:text-[#D92D20]"
                    onClick={() => void askRemove(t.id, t.title)}
                    aria-label={`${t.title} 서식 삭제`}
                  >
                    ✕
                  </button>
                </BzTooltip>
              </div>
            ))}
          </div>
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
