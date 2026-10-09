import type { ActiveView, DeptGroup, NetworkState, Teacher, TeacherStatus } from "../../types";

export const STATUS_META: Record<TeacherStatus, { short: string; label: string }> = {
  online: { short: "온라인", label: "온라인" },
  teaching: { short: "수업중", label: "수업 중" },
  away: { short: "외출", label: "외출/출장" },
  offwork: { short: "퇴근", label: "퇴근" },
  dnd: { short: "금지", label: "방해금지" },
};

export function PresenceDot({ status, className = "" }: { status: TeacherStatus; className?: string }) {
  return <span className={`presence-dot ${status} ${className}`} aria-hidden="true" />;
}

const TABS: { id: ActiveView; icon: string; label: string; badge?: number }[] = [
  { id: "org", icon: "🏫", label: "조직도" },
  { id: "memo", icon: "✉️", label: "쪽지함" },
  { id: "chat", icon: "💬", label: "빠른 대화" },
  { id: "timetable", icon: "📚", label: "시간표·대강" },
  { id: "work", icon: "📢", label: "업무/공지" },
  { id: "audit", icon: "🛡️", label: "보안·감사" },
  { id: "settings", icon: "⚙️", label: "설정" },
];

interface Props {
  me: Teacher;
  teachers: Teacher[];
  depts: DeptGroup[];
  net: NetworkState;
  view: ActiveView;
  narrow?: boolean;
  unreadMemo: number;
  unreadChat: number;
  pendingSwap: number;
  autoStatus: boolean;
  classNowText: string;
  onStatus: (s: TeacherStatus) => void;
  onNet: () => void;
  onView: (v: ActiveView) => void;
  onToast: (t: string) => void;
  intranetHidden?: boolean;
  externalOnly?: boolean;
}

export default function LeftSidebar(p: Props) {
  const statusList: TeacherStatus[] = ["online", "teaching", "away", "offwork", "dnd"];
  if (p.narrow) {
    return (
      <aside className="relative z-20 w-[64px] shrink-0 h-full bg-white border-r border-edu-line flex flex-col items-center py-3">
        <div
          className="w-10 h-10 rounded-xl grid place-items-center text-white font-black text-base shrink-0"
          style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}
          title={`${p.me.name} · ${p.me.dept}`}
        >
          B
        </div>
        <span className="my-2 h-px w-9 bg-edu-line" aria-hidden />
        <button
          onClick={p.externalOnly ? undefined : p.onNet}
          title={p.externalOnly ? "클라우드 고정 학교 — 교내연결을 쓸 수 없어요" : p.net === "intranet" ? "교내연결 (내부망)" : "외부연결"}
          className={`relative group w-10 h-10 rounded-full text-[15px] text-white shrink-0 transition-transform duration-150 hover:scale-[1.08] ${
            p.externalOnly ? "bg-[#16A34A] cursor-default" : p.net === "intranet" ? "bg-[#0082C8]" : "bg-[#16A34A]"
          }`}
        >
          {p.externalOnly ? "☁️" : p.net === "intranet" ? "🔵" : "🟢"}
          <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#101828] px-2.5 py-1.5 text-[12.5px] font-bold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
            {p.externalOnly ? "외부연결 · 클라우드 고정" : p.net === "intranet" ? "교내연결 · 내부망" : "외부연결"}
          </span>
        </button>
        {p.intranetHidden && (
          <span className="mt-1 text-[12px]" title="교내망을 벗어나 내부망 채팅방을 숨겼어요">🔒</span>
        )}
        <span className="my-2 h-px w-9 bg-edu-line" aria-hidden />
        <nav className="w-full flex flex-col items-center">
          {TABS.map((t, i) => {
            const badge =
              t.id === "memo" ? p.unreadMemo : t.id === "chat" ? p.unreadChat : t.id === "timetable" ? p.pendingSwap : 0;
            const active = p.view === t.id;
            return (
              <div key={t.id} className="w-full flex flex-col items-center">
                {i > 0 && <span className="my-1 h-px w-8 bg-edu-line" aria-hidden />}
                <button
                  onClick={() => p.onView(t.id)}
                  aria-label={t.label}
                  className={`relative group w-12 h-12 rounded-2xl grid place-items-center text-[21px] transition-all duration-150 hover:scale-[1.08] ${
                    active ? "bg-edu-soft tab-active ring-1 ring-edu-blueline" : "hover:bg-edu-chip"
                  }`}
                >
                  <span>{t.icon}</span>
                  {badge > 0 && (
                    <span className="absolute top-0.5 right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#E5484D] text-white text-[10px] font-extrabold grid place-items-center">
                      {badge}
                    </span>
                  )}
                  <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#101828] px-2.5 py-1.5 text-[12.5px] font-bold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                    {t.label}
                  </span>
                </button>
              </div>
            );
          })}
        </nav>
        <span className="my-2 h-px w-9 bg-edu-line" aria-hidden />
        <div className="mt-auto flex flex-col items-center gap-1">
          <select
            className="w-12 text-[11px] border border-edu-line rounded-lg py-1 bg-white"
            value={p.me.status}
            title="내 상태 (온라인·수업중·외출·퇴근·방해금지)"
            onChange={(e) => p.onStatus(e.target.value as TeacherStatus)}
          >
            {statusList.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].short}
              </option>
            ))}
          </select>
        </div>
      </aside>
    );
  }
  return (
    <aside className="w-[320px] shrink-0 h-full bg-white border-r border-edu-line flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-edu-line">
        <div className="flex items-center gap-2.5">
          <div
            className="w-11 h-11 rounded-2xl grid place-items-center text-white font-black text-lg"
            style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}
          >
            B
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-[16px] leading-tight break-words">
              {p.me.name} <span className="font-semibold text-edu-sub text-[12.5px]">· {p.me.grade} {p.me.classNo} 담임</span>
            </div>
            <div className="text-[12px] text-edu-sub break-words">{p.me.dept} · {p.me.subject}</div>
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <select
            className="edu-input !py-1.5 !text-[13px]"
            value={p.me.status}
            onChange={(e) => p.onStatus(e.target.value as TeacherStatus)}
          >
            {statusList.map((s) => (
              <option key={s} value={s}>
                {s === "teaching" && p.classNowText ? `${p.classNowText}` : STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>
        {p.autoStatus && p.classNowText && (
          <div className="mt-1.5 text-[12px] font-bold text-edu-strong bg-edu-soft border border-edu-blueline rounded-lg px-2 py-1 inline-flex items-center gap-1.5">
            <PresenceDot status="teaching" /> {p.classNowText} · DND 동기화 중
          </div>
        )}
        <button
          onClick={p.externalOnly ? undefined : p.onNet}
          title={p.externalOnly ? "클라우드(Firebase) 고정 학교 — 교내연결을 쓸 수 없어요" : undefined}
          className={`mt-2.5 w-full rounded-full py-2 text-[13px] font-extrabold text-white transition-transform active:scale-[0.98] ${
            p.externalOnly ? "bg-[#16A34A] cursor-default" : p.net === "intranet" ? "bg-[#0082C8]" : "bg-[#16A34A]"
          }`}
        >
          {p.externalOnly ? "☁️ 외부연결 · 클라우드 고정" : p.net === "intranet" ? "🔵 교내연결 · 교내망" : "🟢 외부연결 · 외부망"}
        </button>
        {p.intranetHidden && (
          <div className="mt-1.5 text-[11.5px] font-bold text-edu-sub bg-edu-chip border border-edu-line rounded-lg px-2 py-1">
            🔒 교내망 벗어남 · 내부망 채팅방 숨김
          </div>
        )}
      </div>
      <nav className="px-2 py-2 grid grid-cols-3 gap-1.5 border-b border-edu-line">
        {TABS.map((t) => {
          const badge =
            t.id === "memo" ? p.unreadMemo : t.id === "chat" ? p.unreadChat : t.id === "timetable" ? p.pendingSwap : 0;
          const active = p.view === t.id;
          return (
            <button
              key={t.id}
              onClick={() => p.onView(t.id)}
              className={`relative rounded-xl px-2 py-2.5 text-[12.5px] font-bold flex flex-col items-center gap-0.5 transition-colors ${
                active ? "bg-edu-soft text-edu-strong tab-active" : "text-edu-sub hover:bg-edu-chip"
              }`}
            >
              <span className="text-[17px]">{t.icon}</span>
              {t.label}
              {badge > 0 && (
                <span className="absolute top-1 right-1 min-w-[19px] h-[19px] px-1 rounded-full bg-[#E5484D] text-white text-[10.5px] font-extrabold grid place-items-center">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <OrgTreeInline teachers={p.teachers} depts={p.depts} onToast={p.onToast} />
      </div>
      <div className="px-3 py-2 border-t border-edu-line text-[11px] text-edu-muted flex items-center justify-between">
        <span>브리즈 데스크톱 · 교사 전용</span>
        <span className={p.net === "intranet" ? "text-edu-blue font-bold" : "text-[#16A34A] font-bold"}>
          {p.net === "intranet" ? "● 교내망" : "● 외부망"}
        </span>
      </div>
    </aside>
  );
}

import { useMemo, useState } from "react";

function OrgTreeInline({ teachers, depts, onToast }: { teachers: Teacher[]; depts: DeptGroup[]; onToast: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const byId = useMemo(() => Object.fromEntries(teachers.map((t) => [t.id, t])), [teachers]);
  const filtered = useMemo(() => {
    const s = q.trim();
    if (!s) return null as Set<string> | null;
    return new Set(teachers.filter((t) => t.name.includes(s) || t.subject.includes(s) || t.dept.includes(s)).map((t) => t.id));
  }, [q, teachers]);
  return (
    <div className="p-3">
      <input
        className="edu-input !py-2 !text-[13px]"
        placeholder="이름·과목·부서 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-2 flex flex-col gap-1.5">
        {depts.length === 0 && <div className="text-center text-edu-sub text-[12px] py-4">조직도에서 부서를 만들어 주세요.</div>}
        {depts.map((d) => {
          const members = d.members.map((id) => byId[id]).filter(Boolean);
          const shown = filtered ? members.filter((m) => filtered.has(m.id)) : members;
          if (filtered && shown.length === 0) return null;
          const online = members.filter((m) => m.status === "online" || m.status === "teaching").length;
          const isOpen = filtered ? true : open[d.id] !== false;
          return (
            <div key={d.id} className="edu-card !shadow-none overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-3 py-2.5 font-bold text-[13.5px]"
                onClick={() => setOpen((o) => ({ ...o, [d.id]: !isOpen }))}
              >
                <span className="text-edu-muted text-[12px]">{isOpen ? "▾" : "▸"}</span>📁 {d.name}
                <span className="ml-auto text-[11.5px] text-edu-sub font-semibold">
                  ({online}/{members.length})
                </span>
              </button>
              {isOpen && (
                <div className="px-1.5 pb-1.5 flex flex-col gap-0.5">
                  {shown.map((m) => (
                    <button
                      key={m.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-edu-chip text-left"
                      onClick={() => onToast(`${m.name} · ${m.statusMessage} · ${m.ip}`)}
                    >
                      <span
                        className="w-7 h-7 rounded-full grid place-items-center text-white text-[12px] font-extrabold shrink-0"
                        style={{ background: m.avatarColor }}
                      >
                        {(m.name || "?")[0]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold break-words">
                          {m.name} <span className="font-medium text-edu-sub">· {m.subject}</span>
                        </span>
                        <span className="block text-[11px] text-edu-sub break-words">
                          <span className="inline-flex items-center gap-1.5">
                            <PresenceDot status={m.status} />
                            {m.statusMessage}
                          </span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
