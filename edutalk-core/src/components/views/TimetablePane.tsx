import { useMemo, useState } from "react";
import type { SwapRecord, Teacher, TimetableCell } from "../../types";
import { TIMETABLE_CSV_SAMPLE } from "../../mock/initialData";
import { readCsvText } from "../../lib/csv";
import { FreeMatchBox, NextClassBanner } from "../FusionBanner";
import { cellKey, monthlySubCount } from "../../lib/fusion";

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

  // AI 보강 추천: 고른 교시에 공강 + 보강횟수 적은 순
  const candidates = useMemo(() => {
    if (!sel) return [];
    const busyByTeacher = new Map<string, number>();
    p.cells.forEach((c) => {
      if (c.weekday === sel.weekday && c.period === sel.period) {
        busyByTeacher.set(c.teacher, (busyByTeacher.get(c.teacher) ?? 0) + 1);
      }
    });
    return p.teachers
      .filter((t) => t.id !== p.meId)
      .map((t) => ({
        t,
        busy: busyByTeacher.has(t.name) ? 1 : 0,
      }))
      .sort((a, b) => a.busy - b.busy || a.t.subCount - b.t.subCount)
      .slice(0, 4);
  }, [sel, p.cells, p.meId]);

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
              <div className="text-[13px] font-bold">보강 추천 (이 시간 공강 + 보강 적은 순)</div>
              <div className="flex flex-col gap-1.5">
                {candidates.map(({ t, busy }) => (
                  <button
                    key={t.id}
                    onClick={() => setToTeacher(t.id)}
                    className={`flex items-center gap-2 border rounded-xl px-2.5 py-2 text-left ${toTeacher === t.id ? "border-edu-blueline bg-edu-soft" : "border-edu-line"}`}
                  >
                    <span className="w-7 h-7 rounded-full grid place-items-center text-white text-[12px] font-extrabold" style={{ background: t.avatarColor }}>
                      {(t.name || "?")[0]}
                    </span>
                    <span className="flex-1 text-[13px] font-bold">
                      {t.name} · {t.subject} <span className="font-medium text-edu-sub">보강 {t.subCount}회 {busy ? "· 이 시간 수업" : "· 공강"}</span>
                    </span>
                    {busy === 0 && <span className="text-[11px] font-extrabold text-edu-strong">추천</span>}
                  </button>
                ))}
              </div>
              <input className="edu-input" placeholder="사유 (예: 출장)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} />
              <div className="flex gap-1.5">
                <button
                  className="edu-btn flex-1"
                  onClick={() => {
                    if (!toTeacher) return p.onToast("대강 교사를 골라 주세요.");
                    p.onRequestSwap(sel.period, sel.weekday, toTeacher, reason.trim());
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
