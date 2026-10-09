import { useMemo, useState } from "react";
import type { AuditLog } from "../../types";

function loadFeedback(): { body: string; at: string }[] {
  try {
    const raw = localStorage.getItem("edutalk-feedback");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.body === "string") : [];
  } catch {
    return [];
  }
}

interface Props {
  logs: AuditLog[];
  cacheUsed: number;
  cacheTotal: number;
  autoPurge: boolean;
  onPurge: () => void;
  onTogglePurge: () => void;
  onReport: () => void;
  onToast: (t: string) => void;
}

export default function AuditPane(p: Props) {
  const [filter, setFilter] = useState<"all" | AuditLog["kind"]>("all");
  const [showFb, setShowFb] = useState(false);
  const feedbacks = useMemo(loadFeedback, [showFb]);
  const rows = p.logs.filter((l) => (filter === "all" ? true : l.kind === filter));
  const pct = Math.round((p.cacheUsed / Math.max(1, p.cacheTotal)) * 100);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <div className="edu-card p-3.5 anim-card">
        <div className="font-extrabold text-[15px]">보안·감사 로그 ({rows.length})</div>
        <div className="text-[12.5px] text-edu-sub">보내기 전 기기 내 DLP가 주민번호·전화번호·성적표현을 잡아내요.</div>
        <div className="edu-filterbar mt-2 flex gap-1.5 flex-wrap">
          {(["all", "RRN", "PHONE", "SCORE", "HWP"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold ${filter === f ? "bg-edu-soft text-edu-strong" : "bg-edu-chip text-edu-sub"}`}
            >
              {f === "all" ? "전체" : f}
            </button>
          ))}
          <button className="edu-ghost !py-1.5 !text-[12px] ml-auto" onClick={p.onReport}>📄 준수 리포트 생성</button>
        </div>
        <div className="mt-2 flex flex-col gap-1.5 max-h-[440px] overflow-y-auto">
          {rows.map((l) => (
            <div key={l.id} className="border border-edu-line rounded-xl px-2.5 py-2 text-[12.5px]">
              <div className="flex items-center gap-1.5">
                <span className={`font-extrabold px-1.5 py-0.5 rounded-lg text-[11px] ${l.blocked ? "bg-[#FDE8E8] text-[#D92D20]" : "bg-edu-chip text-edu-sub"}`}>
                  {l.kind} {l.blocked ? "차단" : "경고"}
                </span>
                <span className="text-edu-sub ml-auto">{l.createdAt}</span>
              </div>
              <div className="mt-1 font-medium">{l.text}</div>
              <div className="text-[11.5px] text-edu-muted mt-0.5">규칙 {l.ruleId} · 점수 {l.score.toFixed(2)}</div>
            </div>
          ))}
          {rows.length === 0 && <div className="text-center text-edu-sub text-[13px] py-8">기록이 없어요.</div>}
        </div>
      </div>
      <div className="edu-card p-3.5 anim-card h-fit">
        <div className="font-extrabold text-[15px]">저장소 정리</div>
        <div className="mt-2 text-[13px] font-bold">
          디스크 캐시 {p.cacheUsed.toFixed(1)}GB / {p.cacheTotal.toFixed(1)}GB ({pct}%)
        </div>
        <div className="mt-1.5 h-2.5 rounded-full bg-edu-chip overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#0082C8,#0069A8)" }} />
        </div>
        <label className="mt-2.5 flex items-center gap-2 text-[13px] font-bold cursor-pointer">
          <input type="checkbox" checked={p.autoPurge} onChange={p.onTogglePurge} className="w-4 h-4" />
          30일 경과 자동 삭제 데몬 켜기
        </label>
        <button className="edu-btn w-full mt-2" onClick={p.onPurge}>지금 정리하기</button>
      </div>
      <div className="edu-card p-3.5 anim-card h-fit">
        <div className="font-extrabold text-[15px]">✋ 10월 베타 의견 ({feedbacks.length})</div>
        <div className="text-[12.5px] text-edu-sub">이 PC에 저장된 교사 의견을 모아서 보여줘요.</div>
        <button className="edu-ghost w-full mt-2" onClick={() => setShowFb((v) => !v)}>
          {showFb ? "접기" : "의견 보기"}
        </button>
        {showFb && (
          <div className="mt-2 flex flex-col gap-1.5 max-h-[300px] overflow-y-auto">
            {feedbacks.length === 0 && <div className="text-center text-edu-sub text-[13px] py-4">아직 의견이 없어요.</div>}
            {feedbacks.map((f, i) => (
              <div key={i} className="border border-edu-line rounded-xl px-2.5 py-2 text-[12.5px]">
                <div className="font-medium whitespace-pre-wrap break-words">{f.body}</div>
                <div className="text-[11.5px] text-edu-muted mt-0.5">{f.at}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
