import { useEffect, useMemo, useState } from "react";
import type { SwapRecord, Teacher, TimetableCell } from "../../types";
import { TIMETABLE_CSV_SAMPLE } from "../../mock/initialData";
import { readCsvText } from "../../lib/csv";
import { FreeMatchBox, NextClassBanner } from "../FusionBanner";
import { cellKey, monthlySubCount, PERIOD_TABLE } from "../../lib/fusion";

const WD = ["", "월", "화", "수", "목", "금"];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

interface Props {
  cells: TimetableCell[];
  swaps: SwapRecord[];
  teachers: Teacher[];
  meId: string;
  grade: string;
  classNo: string;
  blocked: boolean;
  onImport: (csv: string) => { ok: boolean; count: number; error?: string };
  onRequestSwap: (period: number, weekday: number, toTeacherId: string, reason: string) => void;
  onAcceptSwap: (id: string) => void;
  onRejectSwap: (id: string) => void;
  onRemote: (cell: TimetableCell) => void;
  onToast: (t: string) => void;
  myName?: string;
  changedKeys?: Set<string>;
  external?: boolean;
  webUrl?: string;
  onInviteMeeting?: (ids: string[]) => void;
}

export function splitSubject(s: string): string[] {
  const t = s.trim();
  if (!t) return [];
  const parts = t.split(/[·․・\/／,+]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 3);
  const nospace = t.replace(/\s+/g, "");
  if (/기술.*가정|가정.*기술/.test(nospace) && nospace.length <= 8) return ["기술", "가정"];
  return [t];
}


const LOOKUP_DAYS = [1, 2, 3, 4, 5] as const;
const DAY_LABEL = ["", "월", "화", "수", "목", "금"];

function pad2(n: number) { return String(n).padStart(2, "0"); }

function TimetableLookup({ cells, teachers, meName, grade, classNo }: {
  cells: TimetableCell[];
  teachers: Teacher[];
  meName: string;
  grade: string;
  classNo: string;
}) {
  const [now, setNow] = useState(() => new Date());
  const [mode, setMode] = useState<"mine" | "teacher" | "class" | "today">("mine");
  const [teacherName, setTeacherName] = useState(meName);
  const [classKey, setClassKey] = useState(`${grade}|${classNo}`);
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const todayWd = now.getDay();
  const isWeekday = todayWd >= 1 && todayWd <= 5;
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  const currentPeriod = (() => {
    const hm = `${hh}:${mm}`;
    const t = PERIOD_TABLE.find((x) => hm >= x.start && hm < x.end);
    return t?.period ?? null;
  })();
  const dateLabel = `${now.getMonth() + 1}월 ${now.getDate()}일 ${["일", "월", "화", "수", "목", "금", "토"][todayWd]}요일`;

  const classOptions = useMemo(() => {
    const map = new Map<string, { key: string; grade: string; classNo: string; label: string }>();
    for (const c of cells) {
      if (!c.grade || !c.classNo) continue;
      const key = `${c.grade}|${c.classNo}`;
      if (!map.has(key)) map.set(key, { key, grade: c.grade, classNo: c.classNo, label: `${c.grade} ${c.classNo}` });
    }
    if (grade && classNo) {
      const key = `${grade}|${classNo}`;
      if (!map.has(key)) map.set(key, { key, grade, classNo, label: `${grade} ${classNo}` });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "ko"));
  }, [cells, grade, classNo]);

  const teacherOptions = useMemo(() => {
    const names = new Set<string>();
    if (meName) names.add(meName);
    for (const t of teachers) if (t.name) names.add(t.name);
    for (const c of cells) if (c.teacher) names.add(c.teacher);
    return [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }, [teachers, cells, meName]);

  const selectedClass = classOptions.find((c) => c.key === classKey) ?? classOptions[0];
  const selectedTeacher = teacherOptions.includes(teacherName) ? teacherName : (teacherOptions[0] ?? meName);

  const weekCells = useMemo(() => {
    if (mode === "class") {
      return cells.filter((c) => c.grade === selectedClass?.grade && c.classNo === selectedClass?.classNo);
    }
    if (mode === "teacher" || mode === "mine") {
      return cells.filter((c) => c.teacher === (mode === "mine" ? meName : selectedTeacher));
    }
    return [];
  }, [mode, cells, selectedClass, selectedTeacher, meName]);

  const renderWeek = (list: TimetableCell[]) => (
    <div className="overflow-x-auto">
      {/* 좁은 앱 창에서도 5일이 한눈에 들어오도록 교시·과목만 남기고
          학급·교사·교실은 칸의 title(마우스 올림)과 아래 상세 표에서 확인한다. */}
      <table className="w-full table-fixed border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="w-[30px] border border-edu-line bg-edu-bg px-0 py-1 text-[11px]">교시</th>
            {LOOKUP_DAYS.map((d) => (
              <th key={d} className={`border border-edu-line px-0.5 py-1 text-[11.5px] ${todayWd === d ? "bg-edu-soft text-edu-strong" : "bg-edu-bg"}`}>
                {DAY_LABEL[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((period) => {
            const time = PERIOD_TABLE.find((x) => x.period === period);
            return (
              <tr key={period}>
                <td
                  title={time ? `${period}교시 ${time.start}~${time.end}` : `${period}교시`}
                  className={`border border-edu-line px-0 py-1 text-center text-[11px] ${currentPeriod === period ? "bg-edu-soft font-extrabold text-edu-strong" : "bg-edu-bg font-bold"}`}
                >
                  {period}
                </td>
                {LOOKUP_DAYS.map((d) => {
                  const c = list.find((x) => x.weekday === d && x.period === period);
                  const detail = c
                    ? `${c.subject || "수업"} · ${mode === "class" ? c.teacher : `${c.grade} ${c.classNo}`}${c.room ? ` · ${c.room}` : ""}`
                    : "수업 없음";
                  return (
                    <td key={d} title={detail} className={`border border-edu-line p-0 align-middle ${todayWd === d ? "bg-[#F8FCFF]" : ""}`}>
                      <div className="min-h-[44px] px-0.5 py-1 text-center">
                        {c ? (
                          <div className="break-keep text-[12px] font-bold leading-snug text-edu-ink">
                            {c.subject || "수업"}
                          </div>
                        ) : (
                          <span className="text-[11px] text-edu-muted">—</span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const todayRows = useMemo(() => {
    if (!isWeekday) return [];
    return classOptions.map((c) => {
      const list = cells.filter((x) => x.weekday === todayWd && x.grade === c.grade && x.classNo === c.classNo);
      return { ...c, list };
    });
  }, [classOptions, cells, todayWd, isWeekday]);

  return (
    <div className="edu-card p-3.5 anim-card">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-extrabold text-edu-ink">시간표 조회</span>
            <span className={`text-[10.5px] font-extrabold rounded-full px-2 py-0.5 ${currentPeriod ? "bg-edu-soft text-edu-strong" : "bg-edu-chip text-edu-sub"}`}>
              {currentPeriod ? `지금 ${currentPeriod}교시` : "수업 시간 아님"}
            </span>
          </div>
          <div className="text-[12px] text-edu-sub mt-0.5">{dateLabel}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[22px] font-black tabular-nums tracking-[0.5px] text-edu-ink leading-none" aria-label="현재 시각">
            {hh}:{mm}<span className="text-[14px] font-extrabold text-edu-strong">:{ss}</span>
          </div>
          <div className="text-[10.5px] text-edu-muted mt-1">실시간 · 1초마다 갱신</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {([
          ["mine", "내 시간표"],
          ["teacher", "교사별"],
          ["class", "학급별"],
          ["today", "오늘 전체"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`px-3 py-1.5 rounded-xl text-[12.5px] font-extrabold transition-colors ${mode === id ? "bg-edu-soft text-edu-strong shadow-[inset_0_0_0_1px_rgb(var(--edu-blueline))]" : "bg-edu-chip text-edu-sub hover:text-edu-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "teacher" && (
        <div className="mt-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-edu-sub">선생님</span>
            <span className="ml-auto text-[11px] text-edu-muted">{weekCells.length}시간</span>
          </div>
          <select aria-label="선생님 선택" className="edu-input mt-1 w-full !py-1.5 !text-[12.5px]" value={selectedTeacher} onChange={(e) => setTeacherName(e.target.value)}>
            {teacherOptions.map((n) => <option key={n} value={n}>{n} 선생님</option>)}
          </select>
        </div>
      )}
      {mode === "class" && (
        <div className="mt-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-edu-sub">학급</span>
            <span className="ml-auto text-[11px] text-edu-muted">{weekCells.length}시간</span>
          </div>
          <select aria-label="학급 선택" className="edu-input mt-1 w-full !py-1.5 !text-[12.5px]" value={selectedClass?.key ?? ""} onChange={(e) => setClassKey(e.target.value)}>
            {classOptions.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      )}

      {mode === "today" ? (
        !isWeekday ? (
          <div className="mt-3 rounded-xl border border-dashed border-edu-line px-3 py-8 text-center text-[12.5px] text-edu-sub">
            오늘은 주말이라 수업이 없어요. 월요일 시간표를 확인해 주세요.
          </div>
        ) : (
          <div className="mt-2.5 flex flex-col gap-2">
            {todayRows.map((row) => (
              <div key={row.key} className="overflow-hidden rounded-xl border border-edu-line">
                <div className="flex items-center gap-2 bg-edu-bg px-2.5 py-1.5">
                  <span className="text-[12.5px] font-extrabold">{row.label}</span>
                  <span className="ml-auto text-[10.5px] font-bold text-edu-muted">
                    {row.list.length ? `${row.list.length}시간` : "수업 없음"}
                  </span>
                </div>
                <div className="divide-y divide-edu-line">
                  {[...row.list].sort((a, b) => a.period - b.period).map((c) => (
                    <div key={`${row.key}-${c.period}`} className="flex items-center gap-2 px-2.5 py-1">
                      <span className={`w-10 shrink-0 rounded-md px-0.5 py-0.5 text-center text-[11px] font-extrabold ${currentPeriod === c.period ? "bg-edu-soft text-edu-strong" : "bg-edu-chip text-edu-sub"}`}>
                        {c.period}교시
                      </span>
                      <span className="min-w-0 truncate text-[11.5px] font-bold">{c.subject || "수업"}</span>
                      <span className="ml-auto shrink-0 text-[10.5px] text-edu-sub">{c.teacher}</span>
                    </div>
                  ))}
                  {row.list.length === 0 && (
                    <div className="px-2.5 py-1.5 text-[11.5px] text-edu-muted">오늘은 수업이 없어요.</div>
                  )}
                </div>
              </div>
            ))}
            {todayRows.length === 0 && (
              <div className="rounded-xl border border-edu-line px-3 py-6 text-center text-[12.5px] text-edu-sub">
                등록된 학급 시간표가 없어요. 시간표를 먼저 가져와 주세요.
              </div>
            )}
          </div>
        )
      ) : (
        <div className="mt-2.5">
          {weekCells.length === 0 ? (
            <div className="rounded-xl border border-dashed border-edu-line px-3 py-8 text-center text-[12.5px] text-edu-sub">
              {mode === "mine" ? "내 시간표가 아직 없어요. 아래에서 CSV를 가져오거나 대강을 요청해 보세요." : "이 시간표에 등록된 수업이 없어요."}
            </div>
          ) : renderWeek(weekCells)}
        </div>
      )}
      <div className="mt-2 text-[10.5px] leading-relaxed text-edu-muted">
        교사별·학급별 시간표는 학교 서버에 등록된 주간 시간표를 기준으로 보여 줘요.
        주간 표의 칸에 마우스를 올리면 교사·교실까지 확인할 수 있어요.
      </div>
    </div>
  );
}

export default function TimetablePane(p: Props) {
  const classes = useMemo(() => {
    const s = new Set(p.cells.filter((c) => p.grade && c.grade === p.grade).map((c) => c.classNo));
    const list = [...s].sort();
    if (p.classNo && !list.includes(p.classNo)) list.unshift(p.classNo);
    return list.length ? list : p.classNo ? [p.classNo] : [];
  }, [p.cells, p.grade, p.classNo]);
  const [cls, setCls] = useState(p.classNo);
  const curCls = classes.includes(cls) ? cls : p.classNo;
  const [sel, setSel] = useState<{ weekday: number; period: number } | null>(null);
  const [toTeacher, setToTeacher] = useState("");
  const [reason, setReason] = useState("");
  const [showBusy, setShowBusy] = useState(false);
  const [csv, setCsv] = useState("");
  const [showImport, setShowImport] = useState(false);
  // 세로형 기본: 요일 하나씩 본다 (400px 창에 5일 표는 다 안 들어감). 0=전체.
  const todayWd = (() => { const d = new Date().getDay(); return d >= 1 && d <= 5 ? d : 1; })();
  const [dayTab, setDayTab] = useState<number>(todayWd);
  const days = dayTab === 0 ? [1, 2, 3, 4, 5] : [dayTab];
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthAgg = useMemo(() => monthlySubCount(p.swaps, monthKey), [p.swaps, monthKey]);

  const grid = useMemo(
    () => p.cells.filter((c) => c.grade === p.grade && c.classNo === curCls),
    [p.cells, p.grade, curCls]
  );
  const cellOf = (wd: number, per: number) => grid.find((c) => c.weekday === wd && c.period === per);

  // 스마트 보강 추천: 이 시간 공강인 선생님을 기본으로 보여 주고,
  // 같은 과목 → 보강 횟수 적은 순 → 이름 순으로 자동 정렬한다.
  const candidates = useMemo(() => {
    if (!sel) return [];
    const busyByTeacher = new Map<string, number>();
    p.cells.forEach((c) => {
      if (c.weekday === sel.weekday && c.period === sel.period) {
        busyByTeacher.set(c.teacher, (busyByTeacher.get(c.teacher) ?? 0) + 1);
      }
    });
    const target = cellOf(sel.weekday, sel.period);
    const targetSubject = (target?.subject || "").replace(/\s+/g, "");
    return p.teachers
      .filter((t) => t.id !== p.meId)
      .map((t) => {
        const busy = busyByTeacher.has(t.name) ? 1 : 0;
        const teacherSubject = (t.subject || "").replace(/\s+/g, "");
        const sameSubject = !!targetSubject && !!teacherSubject && (
          teacherSubject.includes(targetSubject) || targetSubject.includes(teacherSubject)
        );
        return { t, busy, sameSubject };
      })
      .sort((a, b) =>
        a.busy - b.busy ||
        Number(b.sameSubject) - Number(a.sameSubject) ||
        a.t.subCount - b.t.subCount ||
        a.t.name.localeCompare(b.t.name, "ko")
      );
  }, [sel, p.cells, p.meId]);
  const freeCandidates = candidates.filter((c) => c.busy === 0);
  const shownCandidates = (showBusy ? candidates : freeCandidates).slice(0, 12);

  if (p.blocked) {
    return (
      <div className="edu-card p-8 text-center anim-card">
        <div className="text-[28px]">🔒</div>
        <div className="font-extrabold text-[16px] mt-1">소통 전용 이용권은 시간표를 쓸 수 없어요</div>
        <div className="text-[13px] text-edu-sub mt-1">
          [E-TT-001] 시간표 조회·대강·CSV 가져오기는 브리즈 일반 이용권(교사 전용 앱) 기능이에요.
          <br />
          시간표가 필요하면 일반 이용권으로 변경해 주세요. 우회 시도는 차단돼요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <NextClassBanner cells={p.cells} grade={p.grade} classNo={p.classNo} myName={p.myName ?? ""} onToast={p.onToast} />
      <TimetableLookup cells={p.cells} teachers={p.teachers} meName={p.myName ?? ""} grade={p.grade} classNo={p.classNo} />
      {p.external && (
        <div className="edu-card p-3.5 anim-card border-edu-blueline">
          <div className="font-extrabold text-[14px]">🟢 외부연결 모드예요</div>
          <div className="text-[12.5px] text-edu-sub mt-0.5">
            대강 수락 자동반영은 교내연결에서 바로 돼요. 외부에서는 웹 변경함에서 승인해 주세요.
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button
              className="edu-ghost !text-[12.5px]"
              onClick={() => {
                const u = p.webUrl ?? "";
                if (!u) return p.onToast("웹 주소를 설정해 주세요.");
                try {
                  void navigator.clipboard?.writeText(u);
                  p.onToast("웹 주소를 복사했어요. 브라우저에 붙여넣어 주세요.");
                } catch {
                  p.onToast(u);
                }
              }}
            >
              📋 웹 변경함 주소 복사
            </button>
          </div>
        </div>
      )}
      <div className="edu-card p-3.5 anim-card">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold text-[15px]">주간 시간표 ({p.grade} {curCls} · 1~7교시)</span>
          {classes.map((c) => (
            <button
              key={c}
              onClick={() => setCls(c)}
              className={`px-3 py-1.5 rounded-xl text-[13px] font-bold ${curCls === c ? "bg-edu-soft text-edu-strong" : "bg-edu-chip text-edu-sub"}`}
            >
              {c}
            </button>
          ))}
          <span className="ml-auto flex gap-1.5">
            <button className="edu-ghost !text-[12.5px]" onClick={() => setShowImport((v) => !v)}>
              📥 CSV 가져오기
            </button>
          </span>
        </div>
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {([1, 2, 3, 4, 5] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDayTab(d)}
              className={`px-3 py-1.5 rounded-xl text-[13px] font-bold ${dayTab === d ? "bg-edu-soft text-edu-strong" : "bg-edu-chip text-edu-sub"}`}
            >
              {WD[d]}
            </button>
          ))}
          <button
            onClick={() => setDayTab(0)}
            className={`px-3 py-1.5 rounded-xl text-[13px] font-bold ${dayTab === 0 ? "bg-edu-soft text-edu-strong" : "bg-edu-chip text-edu-sub"}`}
          >
            전체
          </button>
        </div>
        {showImport && (
          <div className="mt-2.5 border border-dashed border-edu-blueline rounded-edu p-2.5 bg-edu-bg">
            <div className="text-[12.5px] font-bold">시간표.csv 드래그·붙여넣기 (형식: 요일,교시,학년,반,과목,교실,교사)</div>
            <textarea
              className="edu-input mt-1.5 min-h-[90px] !text-[12.5px] font-mono"
              placeholder={TIMETABLE_CSV_SAMPLE}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) {
                  void readCsvText(f).then((t) => setCsv(t));
                }
              }}
              onDragOver={(e) => e.preventDefault()}
            />
            <div className="mt-1.5 flex gap-1.5">
              <button
                className="edu-btn !py-2"
                onClick={() => {
                  const r = p.onImport(csv);
                  if (r.ok) { p.onToast(`${r.count}개 시간표를 반영했어요.`); setCsv(""); setShowImport(false); }
                  else p.onToast(r.error ?? "가져오지 못했어요.");
                }}
              >
                반영하기
              </button>
              <button className="edu-ghost" onClick={() => setCsv(TIMETABLE_CSV_SAMPLE)}>
                예시 넣기
              </button>
            </div>
          </div>
        )}
        <div className="mt-2.5 overflow-x-auto">
          <table className={`w-full border-collapse text-[12.5px] ${dayTab === 0 ? "min-w-[640px]" : "min-w-0"}`}>
            <thead>
              <tr>
                <th className="border border-edu-line bg-edu-bg px-2 py-1.5 w-[64px]">교시</th>
                {PERIODS.length && days.map((d) => (
                  <th key={WD[d]} className="border border-edu-line bg-edu-bg px-2 py-1.5">{WD[d]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map((per) => (
                <tr key={per}>
                  <td className="border border-edu-line bg-edu-bg font-extrabold text-center">{per}</td>
                  {days.map((wd) => {
                    const c = cellOf(wd, per);
                    const active = sel?.weekday === wd && sel?.period === per;
                    const subs = c ? splitSubject(c.subject) : [];
                    const changed = c && p.changedKeys?.has(cellKey({ weekday: wd, period: per, grade: p.grade, classNo: curCls }));
                    return (
                      <td
                        key={wd}
                        className={`border p-0 ${active ? "outline outline-2 outline-edu-blue outline-offset-[-2px]" : "border-edu-line"}`}
                      >
                        <button className="w-full text-left px-2 py-1.5 hover:bg-edu-soft min-h-[64px]" onClick={() => setSel({ weekday: wd, period: per })}>
                          {c ? (
                            <>
                              <span className="font-bold text-[13px] block leading-tight">
                                {subs.length > 1 ? subs.join(" / ") : c.subject}
                                {changed ? <span className="ml-1 text-[10px] font-extrabold text-[#B42318]">●변경</span> : null}
                              </span>
                              <span className="text-[11.5px] text-edu-sub block">{c.teacher} · {c.room}</span>
                            </>
                          ) : (
                            <span className="text-edu-muted text-[12px]">공강</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="edu-card p-3.5 anim-card">
          <div className="font-extrabold text-[14px]">
            시간표 변경·대강 요청 {sel ? `(${WD[sel.weekday]} ${sel.period}교시)` : ""}
          </div>
          {!sel ? (
            <div className="text-[13px] text-edu-sub mt-1">위 표에서 칸을 먼저 골라 주세요.</div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {(() => {
                const c = cellOf(sel.weekday, sel.period);
                return (
                  <div className="text-[12.5px] bg-edu-bg border border-edu-line rounded-xl px-2.5 py-2">
                    {c ? `${c.grade} ${c.classNo} · ${c.subject} (${c.teacher})` : "공강 시간대"} · {WD[sel.weekday]}요일 {sel.period}교시
                  </div>
                );
              })()}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[13px] font-bold">스마트 보강 추천</div>
                <span className="text-[11.5px] text-edu-sub">공강 {freeCandidates.length}명 · 자동 정렬</span>
                <button
                  className={`ml-auto text-[11.5px] font-bold rounded-full px-2 py-1 ${showBusy ? "bg-edu-soft text-edu-strong" : "bg-edu-chip text-edu-sub"}`}
                  onClick={() => setShowBusy((v) => !v)}
                >
                  {showBusy ? "공강만 보기" : "수업 있는 선생님도 보기"}
                </button>
              </div>
              {shownCandidates.length === 0 ? (
                <div className="text-[12.5px] text-edu-sub border border-dashed border-edu-line rounded-xl px-3 py-3 text-center">
                  이 시간에 공강인 선생님이 없어요. 위에서 [수업 있는 선생님도 보기]를 눌러 보세요.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-[300px] overflow-y-auto anim-list">
                  {shownCandidates.map(({ t, busy, sameSubject }) => (
                    <div
                      key={t.id}
                      className={`flex items-center gap-2 border rounded-xl px-2.5 py-2 ${toTeacher === t.id ? "border-edu-blueline bg-edu-soft" : "border-edu-line"}`}
                    >
                      <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => setToTeacher(t.id)}>
                        <span className="w-7 h-7 rounded-full grid place-items-center text-white text-[12px] font-extrabold shrink-0" style={{ background: t.avatarColor }}>
                          {(t.name || "?")[0]}
                        </span>
                        <span className="flex-1 min-w-0 text-[13px] font-bold">
                          <span className="block truncate">{t.name} · {t.subject}</span>
                          <span className="block text-[11.5px] font-medium text-edu-sub">
                            보강 {t.subCount}회 · {busy ? "이 시간 수업" : "공강"}
                            {sameSubject ? " · 같은 과목" : ""}
                          </span>
                        </span>
                        {!busy && <span className="text-[10.5px] font-extrabold text-edu-strong shrink-0">추천</span>}
                      </button>
                      <button
                        className={`shrink-0 rounded-lg px-2 py-1.5 text-[11px] font-extrabold ${busy ? "bg-edu-chip text-edu-muted" : "bg-edu-soft text-edu-strong hover:bg-edu-blueline"}`}
                        disabled={busy > 0}
                        onClick={() => {
                          setToTeacher(t.id);
                          p.onRequestSwap(sel.period, sel.weekday, t.id, reason.trim() || "개인 사정");
                          setReason("");
                          p.onToast(`${t.name} 선생님에게 보강을 바로 요청했어요.`);
                        }}
                      >
                        바로 요청
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input className="edu-input" placeholder="사유 (비우면 '개인 사정'으로 보내요)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} />
              <div className="flex gap-1.5">
                <button
                  className="edu-btn flex-1"
                  onClick={() => {
                    if (!toTeacher) return p.onToast("대강 교사를 골라 주세요.");
                    p.onRequestSwap(sel.period, sel.weekday, toTeacher, reason.trim() || "개인 사정");
                    setReason("");
                  }}
                >
                  보강 요청 보내기
                </button>
                <button
                  className="edu-ghost"
                  onClick={() => {
                    const c = cellOf(sel.weekday, sel.period);
                    if (c) p.onRemote(c);
                  }}
                >
                  🖥️ 화면 보기
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="edu-card p-3.5 anim-card">
          <div className="font-extrabold text-[14px]">대강·교체 기록 ({p.swaps.length})</div>
          <div className="text-[12px] text-edu-sub mt-0.5">이번 달({monthKey}) 수락 집계: {Object.keys(monthAgg).length ? Object.entries(monthAgg).map(([n, c]) => `${n} ${c}회`).join(" · ") : "없음"}</div>
          <div className="mt-2 flex flex-col gap-1.5 max-h-[320px] overflow-y-auto">
            {p.swaps.length === 0 && <div className="text-[13px] text-edu-sub text-center py-6">기록이 없어요.</div>}
            {p.swaps.map((s) => (
              <div key={s.id} className="border border-edu-line rounded-xl px-2.5 py-2 text-[13px]">
                <div className="font-bold">
                  {s.date} {WD[s.weekday]} {s.period}교시 · {s.subject} · {s.fromTeacher}({s.fromClass}) → {s.toTeacher}
                </div>
                <div className="text-[12px] text-edu-sub mt-0.5">
                  {s.status === "pending" ? "대기 중" : s.status === "accepted" ? "수락됨 · 시간표 즉시 반영" : "거절됨"} · {s.createdAt}
                </div>
                {s.status === "pending" && (
                  <div className="mt-1.5 flex gap-1.5">
                    <button className="edu-btn !py-1.5 flex-1" onClick={() => p.onAcceptSwap(s.id)}>수락 (시간표 즉시 반영)</button>
                    <button className="edu-ghost !py-1.5" onClick={() => p.onRejectSwap(s.id)}>거절</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <FreeMatchBox
        teachers={p.teachers}
        cells={p.cells}
        meId={p.meId}
        onInvite={(ids) => {
          if (p.onInviteMeeting) p.onInviteMeeting(ids);
          else p.onToast(`${ids.length}명에게 회의 쪽지를 보내세요 (쪽지함에서 단체 선택).`);
        }}
        onToast={p.onToast}
      />
    </div>
  );
}
