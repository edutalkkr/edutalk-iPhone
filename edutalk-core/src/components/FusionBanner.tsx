import { useEffect, useMemo, useState } from "react";
import type { Teacher, TimetableCell } from "../types";
import {
  classStatusNow,
  freeTeachersAt,
  isFiveMinBefore,
  nextClassToday,
} from "../lib/fusion";

// 합체 배너: 다음 수업 + 5분 전 교실/준비물 알림 (메신저+시간표가 합쳐질 때만 가능)
export function NextClassBanner(p: {
  cells: TimetableCell[];
  grade: string;
  classNo: string;
  myName: string;
  onToast: (t: string) => void;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const st = useMemo(() => {
    void tick;
    return classStatusNow(new Date());
  }, [tick]);
  const next = useMemo(() => {
    void tick;
    return nextClassToday(p.cells, p.grade, p.classNo, p.myName, new Date());
  }, [tick, p.cells, p.grade, p.classNo, p.myName]);

  const urgent = next ? isFiveMinBefore(next.period) : false;

  // 5분 전이면 한 번만 토스트 (세션당 1회)
  useEffect(() => {
    if (!next || !urgent) return;
    try {
      const k = `edu-next-${new Date().toDateString()}-${next.period}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
      p.onToast(`🔔 ${next.period}교시 5분 전 — ${next.subject} (${next.room}, ${p.grade} ${p.classNo})`);
    } catch {
      /* 무시 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urgent, next?.period]);

  if (st.kind === "weekend" || st.kind === "after") return null;
  return (
    <div
      className={`rounded-2xl border px-3.5 py-2.5 text-[13px] font-bold flex items-center gap-2 anim-card ${
        st.kind === "in-class"
          ? "border-edu-blueline bg-edu-soft text-edu-strong"
          : urgent
            ? "border-[#F5C6C6] bg-[#FFF5F5] text-[#B42318]"
            : "border-edu-line bg-white text-edu-ink"
      }`}
    >
      <span aria-hidden>{st.kind === "in-class" ? "🔵" : urgent ? "🔔" : "📚"}</span>
      <span className="flex-1">
        {st.kind === "in-class" && st.period
          ? `${st.period}교시 수업 중 (${st.start}~${st.end} · ${st.minutesLeft}분 남음) — 쪽지는 쉬는시간에 몰아 보내요`
          : next
            ? `${next.period}교시 ${next.subject} (${next.room}) ${urgent ? "· 5분 전! 교실 이동하세요" : `· ${next.period}교시 시작까지 대기`}`
            : st.kind === "break"
              ? `쉬는시간 (${st.minutesLeft}분) — 밀린 쪽지를 지금 보내세요`
              : "오늘 수업을 준비하세요"}
      </span>
    </div>
  );
}

// 합체: 공강 겹침 회의 소집 (시간표로 겹치는 사람을 찾아 메신저 단체방으로)
export function FreeMatchBox(p: {
  teachers: Teacher[];
  cells: TimetableCell[];
  meId: string;
  onInvite: (ids: string[]) => void;
  onToast: (t: string) => void;
}) {
  const [wd, setWd] = useState(() => {
    const d = new Date().getDay();
    return d >= 1 && d <= 5 ? d : 1;
  });
  const [per, setPer] = useState(1);
  const free = useMemo(
    () => freeTeachersAt(p.teachers, p.cells, wd, per, p.meId),
    [p.teachers, p.cells, wd, per, p.meId]
  );
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => setSel([]), [wd, per]);
  const toggle = (id: string) =>
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(0, 10)));
  return (
    <div className="edu-card p-3.5 anim-card">
      <div className="font-extrabold text-[14px]">🤝 공강 겹침 회의 소집 <span className="text-[11.5px] font-bold text-edu-sub">합체 전용</span></div>
      <div className="text-[12.5px] text-edu-sub mt-0.5">같은 시간에 비는 사람을 시간표에서 찾아 한 번에 쪽지로 불러요.</div>
      <div className="mt-2 flex gap-1.5 flex-wrap">
        <select className="edu-input !w-[110px] !py-2 !text-[13px]" value={wd} onChange={(e) => setWd(Number(e.target.value))}>
          {["", "월", "화", "수", "목", "금"].slice(1).map((d, i) => (
            <option key={i + 1} value={i + 1}>{d}요일</option>
          ))}
        </select>
        <select className="edu-input !w-[110px] !py-2 !text-[13px]" value={per} onChange={(e) => setPer(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>{n}교시</option>
          ))}
        </select>
        <span className="text-[12.5px] font-bold text-edu-strong self-center">{free.length}명 공강</span>
      </div>
      <div className="mt-2 flex gap-1.5 flex-wrap max-h-[160px] overflow-y-auto">
        {free.length === 0 && <span className="text-[12.5px] text-edu-sub">이 시간에 비는 사람이 없어요.</span>}
        {free.map((t) => (
          <button
            key={t.id}
            onClick={() => toggle(t.id)}
            className={`px-2.5 py-1.5 rounded-full text-[12.5px] font-bold border ${sel.includes(t.id) ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
          >
            {sel.includes(t.id) ? "✓ " : ""}{t.name}·{t.subject}
          </button>
        ))}
      </div>
      <button
        className="edu-btn w-full mt-2.5"
        onClick={() => {
          if (!sel.length) return p.onToast("부를 사람을 1명 이상 골라 주세요.");
          p.onInvite(sel);
          setSel([]);
        }}
      >
        {sel.length ? `${sel.length}명에게 회의 쪽지 보내기` : "회의 쪽지 보내기"}
      </button>
    </div>
  );
}
