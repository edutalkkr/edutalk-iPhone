import { useEffect, useMemo, useState } from "react";
import type { DeptGroup, Teacher, TeacherStatus } from "../../types";
import type { Peer } from "../../lib/tauri";
import { api } from "../../services/api";
import type { NeisEventItem, NeisMealItem } from "../../types/api";
import { AVATAR_COLORS, ME_ID, TEACHER_CSV_SAMPLE } from "../../mock/initialData";
import { readCsvText } from "../../lib/csv";
import { STATUS_META, isPresentStatus, statusSortKey } from "../../lib/status";
import { StatusBadge } from "../ui/BzStatus";
import BzTooltip from "../ui/BzTooltip";
import { useContextMenu } from "../ui/BzContextMenu";

interface Props {
  teachers: Teacher[];
  depts: DeptGroup[];
  onMemo: (teacher: Teacher) => void;
  onChat: (teacher: Teacher) => void;
  onRemote?: (teacher: Teacher) => void;
  peers: Peer[];
  remoteBlocked: string | null;
  onRefreshPeers: () => void;
  onRemotePc: (nodeId: string, name: string) => void;
  onAddTeacher: (t: Omit<Teacher, "id" | "avatarColor" | "ip" | "subCount" | "phone">) => void;
  onImportCsv: (csv: string) => { ok: boolean; count: number; error?: string };
  onToast: (t: string) => void;
  /** 차량 번호(4자리) 검색 결과에서 [차량 이동 요청]을 눌렀을 때 (Killer ②) */
  onCarRequest?: (teacher: Teacher, car: string) => void;
}

// 🏫 오늘의 학교 — 나이스 급식·학사일정 (Killer ③). 서버 연동이 준비된 학교에서만 조용히 나타난다.
function NeisCard() {
  const [data, setData] = useState<{ meal: NeisMealItem[]; events: NeisEventItem[] } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const st = await api.getNeisStatus();
        if (!alive || !st.ok || !st.data?.ready) return;
        const pad = (n: number) => String(n).padStart(2, "0");
        const d = new Date();
        const from = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        const d2 = new Date(d.getTime() + 14 * 86400000);
        const to = `${d2.getFullYear()}${pad(d2.getMonth() + 1)}${pad(d2.getDate())}`;
        const [meal, sched] = await Promise.all([api.getNeisMeal(from), api.getNeisSchedule(from, to)]);
        if (!alive) return;
        setData({
          meal: meal.ok && meal.data?.ok ? meal.data.meals : [],
          events: sched.ok && sched.data?.ok ? sched.data.events.slice(0, 3) : [],
        });
      } catch {
        /* 연동 안 됨 — 카드 숨김 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;
  const lunch = data.meal.find((m) => m.name.includes("중식")) || data.meal[0];
  if (!lunch && !data.events.length) return null;
  return (
    <div className="edu-card p-3 anim-card">
      <div className="text-[12.5px] font-bold mb-1">🏫 오늘의 학교 <span className="text-[10.5px] text-edu-muted font-medium">나이스 연동</span></div>
      {lunch && (
        <div className="text-[12.5px] leading-relaxed">
          🍱 <b>{lunch.name}</b> · {lunch.menu.join(" · ")}
          {lunch.calories && <span className="text-edu-muted text-[11px]"> ({lunch.calories})</span>}
        </div>
      )}
      {data.events.length > 0 && (
        <div className="mt-1 text-[12px] text-edu-sub">
          📅 다가오는 일정: {data.events.map((e) => `${e.date.slice(5)} ${e.title}`).join(" · ")}
        </div>
      )}
    </div>
  );
}

let seq = 1;

// 메인 화면 전체를 쓰는 조직도. 한 줄에 이름·과목·상태·바로가기가 모두 보이는
// 압축 목록이라 스크롤이 거의 없다. 창이 넓어지면 2단으로 붙는다.
export default function OrgTreePane(p: Props) {
  const openMenu = useContextMenu();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [onlineFirst, setOnlineFirst] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [csv, setCsv] = useState("");
  const [fName, setFName] = useState("");
  const [fDept, setFDept] = useState("");
  const [fSubject, setFSubject] = useState("");
  const [fPosition, setFPosition] = useState("교사");
  const byId = useMemo(() => Object.fromEntries(p.teachers.map((t) => [t.id, t])), [p.teachers]);
  const peerIds = useMemo(() => new Set(p.peers.map((pc) => pc.node_id)), [p.peers]);
  const filtered = useMemo(() => {
    const s = q.trim();
    if (!s) return null;
    const digits = s.replace(/[\s-]/g, "");
    return new Set(
      p.teachers
        .filter((t) =>
          t.name.includes(s) ||
          t.subject.includes(s) ||
          t.dept.includes(s) ||
          (!!t.carNumber && digits.length >= 3 && String(t.carNumber).replace(/\D/g, "").includes(digits))
        )
        .map((t) => t.id)
    );
  }, [q, p.teachers]);

  // 🚗 차량 번호 검색 (Killer ②) — "1234"만 치면 차주가 바로 뜨고 [차량 이동 요청] 한 번으로 해결
  const carHits = useMemo(() => {
    const digits = q.trim().replace(/[\s-]/g, "");
    if (!/^\d{3,4}$/.test(digits)) return [] as { t: Teacher; car: string }[];
    return p.teachers
      .map((t) => ({ t, car: String(t.carNumber || "").replace(/\D/g, "") }))
      .filter(({ car }) => car.length >= 3 && (car === digits || car.endsWith(digits)));
  }, [q, p.teachers]);

  const onlineCount = p.teachers.filter((t) => isPresentStatus(t.status)).length;
  const sortMembers = (arr: Teacher[]) =>
    onlineFirst
      ? [...arr].sort((a, b) => statusSortKey(a.status) - statusSortKey(b.status) || a.name.localeCompare(b.name, "ko"))
      : arr;

  const doAdd = () => {
    if (!fName.trim()) return p.onToast("이름을 적어 주세요.");
    if (!fDept.trim()) return p.onToast("부서를 적어 주세요.");
    if (!fSubject.trim()) return p.onToast("과목을 적어 주세요.");
    p.onAddTeacher({
      name: fName.trim(), dept: fDept.trim(), subject: fSubject.trim(), position: fPosition.trim() || "교사",
      status: "online", statusMessage: "등록됨",
    });
    setFName(""); setFDept(""); setFSubject(""); setShowAdd(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="edu-filterbar flex items-center gap-1.5 flex-wrap">
        <input
          className="edu-input !py-2 !text-[13px] flex-1 min-w-[150px]"
          placeholder="이름·과목·부서·차량번호 검색 (예: 1234)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <BzTooltip content="지금 켜져 있는 교사만 보기" position="bottom">
          <button
            className={`edu-ghost !px-2.5 !py-2 shrink-0 !text-[12.5px] ${onlineOnly ? "!bg-edu-soft !text-edu-strong ring-1 ring-edu-blueline" : ""}`}
            onClick={() => setOnlineOnly((v) => !v)}
          >
            🟢 접속만
          </button>
        </BzTooltip>
        <BzTooltip content="교사를 한 명씩 등록" position="bottom">
          <button className="edu-ghost !px-2.5 !py-2 shrink-0 !text-[12.5px]" onClick={() => setShowAdd((v) => !v)}>+ 교사</button>
        </BzTooltip>
        <BzTooltip content="CSV로 여러 명 한 번에 등록" position="bottom">
          <button className="edu-ghost !px-2.5 !py-2 shrink-0 !text-[12.5px]" onClick={() => setShowCsv((v) => !v)}>CSV</button>
        </BzTooltip>
      </div>

      {/* 한 줄 현황: 스크롤을 내리기 전에 전체 규모가 먼저 보인다 */}
      <div className="flex items-center gap-1.5 px-0.5 text-[11.5px] text-edu-sub flex-wrap">
        <span>전체 <b>{p.teachers.length}</b>명</span>
        <span className="text-edu-muted">·</span>
        <span>접속 <b className="text-[#16A34A]">{onlineCount}</b>명</span>
        <span className="text-edu-muted">·</span>
        <span>부서 <b>{p.depts.length}</b>개</span>
        <BzTooltip content="접속 중인 교사를 위로 올려 정렬해요" position="bottom">
          <button
            className={`ml-auto px-2 py-0.5 rounded-full font-bold ${onlineFirst ? "bg-edu-soft text-edu-strong ring-1 ring-edu-blueline" : "bg-edu-chip"}`}
            onClick={() => setOnlineFirst((v) => !v)}
          >
            {onlineFirst ? "✓ 접속 우선" : "접속 우선"}
          </button>
        </BzTooltip>
      </div>

      <NeisCard />

      {carHits.length > 0 && (
        <div className="edu-card p-3 anim-card">
          <div className="text-[12.5px] font-bold mb-1">🚗 차량 번호 {q.trim()} — 검색 결과</div>
          {carHits.map(({ t, car }) => (
            <div key={t.id} className="flex items-center gap-2 py-1">
              <span className="flex-1 min-w-0 text-[13px] truncate">
                <b>{t.name}</b> <span className="text-edu-sub text-[12px]">{t.dept}{t.subject ? ` · ${t.subject}` : ""} · 차량 {car}</span>
              </span>
              <button
                className="edu-btn !py-1.5 !px-3 !text-[12px] shrink-0"
                onClick={() => p.onCarRequest?.(t, car)}
              >
                차량 이동 요청
              </button>
            </div>
          ))}
          <div className="text-[11px] text-edu-sub mt-0.5">
            전화번호 노출 없이 상대 교사에게 곧바로 알림(긴급 쪽지)이 가요.
          </div>
        </div>
      )}

      {showAdd && (
        <div className="edu-card p-3 flex flex-col gap-1.5 anim-card">
          <div className="text-[12.5px] font-bold">교사 직접 등록</div>
          <div className="grid grid-cols-2 gap-1.5">
            <input className="edu-input !py-2" placeholder="이름" value={fName} onChange={(e) => setFName(e.target.value)} maxLength={20} />
            <input className="edu-input !py-2" placeholder="부서" value={fDept} onChange={(e) => setFDept(e.target.value)} maxLength={20} />
            <input className="edu-input !py-2" placeholder="과목" value={fSubject} onChange={(e) => setFSubject(e.target.value)} maxLength={20} />
            <input className="edu-input !py-2" placeholder="직책 (교사)" value={fPosition} onChange={(e) => setFPosition(e.target.value)} maxLength={20} />
          </div>
          <button className="edu-btn !py-2" onClick={doAdd}>등록하기</button>
        </div>
      )}

      {showCsv && (
        <div className="edu-card p-3 anim-card">
          <div className="text-[12.5px] font-bold">CSV로 한 번에 등록 — 형식: 이름,부서,과목,직책</div>
          <textarea
            className="edu-input mt-1.5 min-h-[90px] !text-[12.5px] font-mono"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { void readCsvText(f).then((t) => setCsv(t)); } }}
            onDragOver={(e) => e.preventDefault()}
            placeholder={TEACHER_CSV_SAMPLE}
          />
          <div className="mt-1.5 flex gap-1.5">
            <button className="edu-btn !py-2" onClick={() => { const r = p.onImportCsv(csv); if (r.ok) { p.onToast(`${r.count}명을 등록했어요.`); setCsv(""); setShowCsv(false); } else p.onToast(r.error ?? "가져오지 못했어요."); }}>반영하기</button>
            <button className="edu-ghost !py-2" onClick={() => setCsv(TEACHER_CSV_SAMPLE)}>양식 넣기</button>
          </div>
        </div>
      )}

      {/* 창이 넓으면(md 이상) 부서 카드가 2단으로 붙어 스크롤이 절반이 된다 */}
      <div className="columns-1 md:columns-2 gap-2 anim-list [&>*]:break-inside-avoid [&>*]:mb-2 [&>*:last-child]:mb-0">
        {p.depts.length === 0 && (
          <div className="edu-card p-6 text-center text-edu-sub text-[13px] md:col-span-2">
            부서가 없어요. 처음 실행 마법사에서 부서를 만들거나, 교사를 등록할 때 부서명을 적어 주세요.
          </div>
        )}
        {p.depts.map((d) => {
          const members = d.members.map((id) => byId[id]).filter(Boolean);
          let shown = filtered ? members.filter((m) => (filtered as Set<string>).has(m.id)) : members;
          if (onlineOnly) shown = shown.filter((m) => isPresentStatus(m.status) || m.id === ME_ID);
          if ((filtered || onlineOnly) && shown.length === 0) return null;
          const online = members.filter((m) => isPresentStatus(m.status)).length;
          const isOpen = filtered || onlineOnly ? true : open[d.id] !== false;
          const rows = sortMembers(shown);
          return (
            <div key={d.id} className="edu-card overflow-hidden">
              <button
                className="w-full flex items-center gap-1.5 px-2.5 py-2 bg-edu-bg font-bold text-[13px]"
                onClick={() => setOpen((o) => ({ ...o, [d.id]: !isOpen }))}
              >
                <span className="w-3 text-edu-muted text-[11px]">{isOpen ? "▾" : "▸"}</span>
                <span className="truncate">📁 {d.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-edu-sub font-semibold">{online}/{members.length} 접속</span>
              </button>
              {isOpen && (
                <div className="bg-white">
                  {shown.length === 0 && <div className="text-[12px] text-edu-muted px-3 py-2">아직 등록된 교사가 없어요.</div>}
                  {rows.map((m, i) => {
                    const isMe = m.id === ME_ID;
                    const isPeer = peerIds.has(m.id);
                    const meta = STATUS_META[m.status];
                    const rowMenu = () => {
                      const items = [
                        { id: "memo", label: "쪽지 보내기", icon: <span aria-hidden>✉️</span>, onSelect: () => p.onMemo(m) },
                        { id: "chat", label: "빠른 대화", icon: <span aria-hidden>💬</span>, onSelect: () => p.onChat(m) },
                      ] as { id: string; label?: string; icon?: React.ReactNode; hint?: string; danger?: boolean; disabled?: boolean; separator?: boolean; onSelect?: () => void }[];
                      if (isPeer) items.push({ id: "screen", label: "화면 보기 요청", icon: <span aria-hidden>🖥️</span>, hint: "교내망", onSelect: () => p.onRemotePc(m.id, m.name) });
                      if (p.onRemote) items.push({ id: "remote", label: "원격 지원", icon: <span aria-hidden>🛠️</span>, onSelect: () => p.onRemote?.(m) });
                      items.push({ id: "sep", separator: true });
                      items.push({ id: "info", label: `상태: ${meta.label} · ${m.statusMessage}`, disabled: true });
                      return items;
                    };
                    return (
                      <div
                        key={m.id}
                        className={`flex items-center gap-2 px-2.5 py-1.5 ${i > 0 ? "border-t border-edu-line" : ""}`}
                        onContextMenu={(e) => openMenu(e, rowMenu(), m.name)}
                      >
                        <BzTooltip content={`${m.name} · ${meta.label}`} position="top">
                          <span
                            className="w-7 h-7 rounded-full grid place-items-center text-white font-extrabold shrink-0 text-[12px] cursor-default"
                            style={{ background: m.avatarColor }}
                          >
                            {(m.name || "?")[0]}
                          </span>
                        </BzTooltip>
                        <span className="font-bold text-[13px] shrink-0 max-w-[88px] truncate">
                          {m.name}
                          {isMe && <span className="text-edu-strong"> (나)</span>}
                        </span>
                        <BzTooltip className="min-w-0 flex-1" content={`${m.subject} · ${m.position} · ${m.dept}\n${m.statusMessage || meta.label}`} position="top">
                          <span className="min-w-0 w-full text-[11.5px] text-edu-sub truncate text-left">
                            {m.subject} · {m.position}
                          </span>
                        </BzTooltip>
                        <BzTooltip content={`${meta.label} · ${m.statusMessage || "상태 메시지 없음"}`} position="top">
                          <span className="shrink-0 inline-flex">
                            <StatusBadge status={m.status} compact text={meta.short} />
                          </span>
                        </BzTooltip>
                        {!isMe && (
                          <span className="flex shrink-0 gap-0.5">
                            <BzTooltip content="쪽지 보내기" position="left">
                              <button className="w-7 h-7 grid place-items-center rounded-lg text-[13px] hover:bg-edu-chip" onClick={() => p.onMemo(m)} aria-label="쪽지 보내기">✉️</button>
                            </BzTooltip>
                            <BzTooltip content="빠른 대화" position="left">
                              <button className="w-7 h-7 grid place-items-center rounded-lg text-[13px] hover:bg-edu-chip" onClick={() => p.onChat(m)} aria-label="빠른 대화">💬</button>
                            </BzTooltip>
                            {isPeer && (
                              <BzTooltip content="화면 보기 요청 (교내망)" position="left">
                                <button className="w-7 h-7 grid place-items-center rounded-lg text-[13px] hover:bg-edu-chip" onClick={() => p.onRemotePc(m.id, m.name)} aria-label="화면 보기 요청">🖥️</button>
                              </BzTooltip>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {p.peers.length > 0 && (
        <div className="flex items-center gap-2 px-1 text-[11.5px] text-edu-sub">
          <span className="flex-1 break-words">
            같은 망에 켜진 PC {p.peers.length}대 · {p.remoteBlocked ? p.remoteBlocked : "교내망 PC는 🖥️ 화면 보기 요청을 쓸 수 있어요."}
          </span>
          <button className="edu-ghost !px-2.5 !py-1.5 shrink-0 !text-[11.5px]" onClick={p.onRefreshPeers}>새로고침</button>
        </div>
      )}
    </div>
  );
}

export function nextAvatar(name: string): string {
  seq += 1;
  return AVATAR_COLORS[(name.length + seq) % AVATAR_COLORS.length];
}
