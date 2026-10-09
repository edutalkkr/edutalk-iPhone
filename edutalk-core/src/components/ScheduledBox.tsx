import { useEffect, useState } from "react";
import { call, type ScheduledRow } from "../lib/tauri";

// datetime-local 값을 Rust(chrono::Local RFC3339)와 같은 로컬 오프셋 문자열로 바꾼다.
// UTC(Z)로 보내면 문자열 비교(run_at<=now)에서 순서가 어긋나 due 조회가 빗나간다.
function toLocalRFC3339(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

// 예약 쪽지함 (예약 전송 + 쉬는시간 발송 합체)
// - 앱이 켜져 있을 때 시각이 되면 실제 쪽지로 보낸다 (App의 due 체커가 처리).
export default function ScheduledBox(p: { onToast: (t: string) => void }) {
  const [rows, setRows] = useState<ScheduledRow[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const [runAt, setRunAt] = useState("");

  async function load() {
    try {
      setRows(await call<ScheduledRow[]>("scheduled_list"));
    } catch {
      /* 다음에 */
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function add(breakOnly: boolean) {
    if (!title.trim() || !body.trim()) return p.onToast("제목·내용을 적어 주세요.");
    if (!runAt) return p.onToast("보낼 시각을 정해 주세요.");
    const dt = new Date(runAt);
    if (Number.isNaN(dt.getTime())) return p.onToast("시각이 올바르지 않아요.");
    if (dt.getTime() < Date.now() - 60000) return p.onToast("지난 시각에는 예약할 수 없어요.");
    const max = Date.now() + 90 * 86400000;
    if (dt.getTime() > max) return p.onToast("예약은 최대 3개월까지예요.");
    const names = to.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const toJson = JSON.stringify(names.map((n) => ({ uid: n, name: n })));
    try {
      await call<string>("scheduled_add", {
        title: (breakOnly ? "[쉬는시간] " : "") + title.trim(),
        body: body.trim(),
        to: JSON.parse(toJson),
        run_at: toLocalRFC3339(dt),
      });
      setTitle("");
      setBody("");
      setTo("");
      setRunAt("");
      await load();
      p.onToast(breakOnly ? "쉬는시간에 맞춰 보내도록 예약했어요." : "예약했어요. 앱이 켜져 있을 때 보내요.");
    } catch (e) {
      p.onToast(e instanceof Error ? e.message : "예약하지 못했어요.");
    }
  }

  async function cancel(id: string) {
    try {
      await call("scheduled_mark", { id, status: "cancelled" });
      await load();
    } catch {
      /* 다음에 */
    }
  }

  return (
    <div className="edu-card p-3.5 anim-card">
      <div className="font-extrabold text-[14px]">⏰ 예약 쪽지 <span className="text-[11.5px] font-bold text-edu-sub">최대 3개월</span></div>
      <div className="text-[12.5px] text-edu-sub mt-0.5">잊기 쉬운 쪽지를 미리 적어 두면 시각이 되면 보내요.</div>
      <div className="mt-2 flex flex-col gap-1.5">
        <input className="edu-input !py-2" placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        <textarea className="edu-input !py-2 min-h-[72px]" placeholder="내용" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
        <input className="edu-input !py-2" placeholder="받는 사람 (이름 쉼표로, 예: 김교사,이교사)" value={to} onChange={(e) => setTo(e.target.value)} maxLength={200} />
        <input type="datetime-local" className="edu-input !py-2" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
        <div className="flex gap-1.5">
          <button className="edu-btn flex-1" onClick={() => void add(false)}>예약하기</button>
          <button className="edu-ghost flex-1" onClick={() => void add(true)}>🔔 쉬는시간에 보내기</button>
        </div>
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
        {rows.length === 0 && <div className="text-[12.5px] text-edu-sub text-center py-3">예약이 없어요.</div>}
        {rows.map((r) => (
          <div key={r.id} className="border border-edu-line rounded-xl px-2.5 py-2 text-[12.5px]">
            <div className="font-bold truncate">{r.title}</div>
            <div className="text-edu-sub truncate">{r.body} · {String(r.run_at).slice(0, 16).replace("T", " ")}</div>
            <button className="text-edu-strong font-bold text-[12px] mt-0.5" onClick={() => void cancel(r.id)}>예약 취소</button>
          </div>
        ))}
      </div>
    </div>
  );
}
