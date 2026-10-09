import { useEffect, useState } from "react";
import { call, type PollRow } from "../lib/tauri";

// 쪽지 안 미니 투표 (장소 선정·참석 여부 취합용)
export default function PollBox(p: { memoId: string; onToast: (t: string) => void }) {
  const [rows, setRows] = useState<PollRow[]>([]);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState("");

  async function load() {
    try {
      setRows(await call<PollRow[]>("poll_list", { memo_id: p.memoId }));
    } catch {
      /* 다음에 */
    }
  }
  useEffect(() => {
    setRows([]);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.memoId]);

  async function create() {
    const options = opts.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6);
    if (!q.trim() || options.length < 2) return p.onToast("질문과 보기 2개 이상을 적어 주세요 (보기는 최대 6개).");
    try {
      await call<string>("poll_create", { memo_id: p.memoId, question: q.trim(), options });
      setQ("");
      setOpts("");
      await load();
    } catch (e) {
      p.onToast(e instanceof Error ? e.message : "만들지 못했어요.");
    }
  }

  async function vote(id: string, choice: number) {
    try {
      await call("poll_vote", { poll_id: id, choice });
      await load();
    } catch (e) {
      p.onToast(e instanceof Error ? e.message : "투표하지 못했어요.");
    }
  }

  return (
    <div className="mt-3 border-t border-edu-line pt-2.5">
      <div className="font-extrabold text-[13.5px]">📊 쪽지 투표 ({rows.length})</div>
      {rows.map((r) => {
        const total = r.counts.reduce((a, b) => a + b, 0);
        return (
          <div key={r.id} className="mt-1.5 border border-edu-line rounded-xl p-2.5">
            <div className="font-bold text-[13px]">{r.question} {r.closed && <span className="text-edu-sub">(마감)</span>}</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {r.options.map((op, i) => {
                const c = r.counts[i] ?? 0;
                const pct = total ? Math.round((c / total) * 100) : 0;
                return (
                  <button
                    key={i}
                    disabled={r.closed}
                    onClick={() => void vote(r.id, i)}
                    className={`text-left border rounded-lg px-2.5 py-1.5 text-[12.5px] ${r.mine === i ? "border-edu-blueline bg-edu-soft font-bold" : "border-edu-line"}`}
                  >
                    <span className="flex justify-between gap-2"><span>{op}</span><span className="text-edu-sub font-bold">{c}표 {pct}%</span></span>
                    <span className="block h-1.5 rounded-full bg-edu-chip mt-1 overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#0082C8,#0069A8)" }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="mt-2 flex flex-col gap-1.5">
        <input className="edu-input !py-2" placeholder="새 투표 질문 (예: 회식 장소)" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
        <textarea className="edu-input !py-2 min-h-[56px]" placeholder={"보기 (줄마다 1개)\n예: 시청 앞\n예: 학교 앞"} value={opts} onChange={(e) => setOpts(e.target.value)} maxLength={400} />
        <button className="edu-ghost" onClick={() => void create()}>투표 만들기</button>
      </div>
    </div>
  );
}
