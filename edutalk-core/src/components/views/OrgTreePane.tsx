import { useMemo, useState } from "react";
import type { DeptGroup, Teacher } from "../../types";
import type { Peer } from "../../lib/tauri";
import { AVATAR_COLORS, ME_ID, TEACHER_CSV_SAMPLE } from "../../mock/initialData";
import { readCsvText } from "../../lib/csv";
import { PresenceDot } from "../layout/LeftSidebar";

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
}

let seq = 1;

// 메인 화면 전체를 쓰는 조직도. 교사마다 바로 쪽지·대화·화면보기 버튼이 붙어 있어
// "누르면 이거겠다"를 바로 알 수 있게 한다. (글자는 잘리지 않고 줄바꿈된다)
export default function OrgTreePane(p: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
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
    return new Set(
      p.teachers.filter((t) => t.name.includes(s) || t.subject.includes(s) || t.dept.includes(s)).map((t) => t.id)
    );
  }, [q, p.teachers]);

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
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5">
        <input
          className="edu-input !py-2 !text-[13px] flex-1"
          placeholder="이름·과목·부서 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="edu-ghost !px-2.5 !py-2 shrink-0 !text-[12.5px]" title="교사를 한 명씩 등록" onClick={() => setShowAdd((v) => !v)}>+ 교사</button>
        <button className="edu-ghost !px-2.5 !py-2 shrink-0 !text-[12.5px]" title="CSV로 여러 명 한 번에 등록" onClick={() => setShowCsv((v) => !v)}>CSV</button>
      </div>

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

      <div className="flex flex-col gap-2 anim-list">
        {p.depts.length === 0 && (
          <div className="edu-card p-6 text-center text-edu-sub text-[13px]">
            부서가 없어요. 처음 실행 마법사에서 부서를 만들거나, 교사를 등록할 때 부서명을 적어 주세요.
          </div>
        )}
        {p.depts.map((d) => {
          const members = d.members.map((id) => byId[id]).filter(Boolean);
          const shown = filtered ? members.filter((m) => (filtered as Set<string>).has(m.id)) : members;
          if (filtered && shown.length === 0) return null;
          const online = members.filter((m) => m.status === "online" || m.status === "teaching").length;
          const isOpen = filtered ? true : open[d.id] !== false;
          return (
            <div key={d.id} className="edu-card overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-3 py-2.5 bg-edu-bg font-bold text-[13.5px]"
                onClick={() => setOpen((o) => ({ ...o, [d.id]: !isOpen }))}
              >
                <span className="text-edu-muted text-[12px]">{isOpen ? "▾" : "▸"}</span>
                <span>📁 {d.name}</span>
                <span className="ml-auto text-[11.5px] text-edu-sub font-semibold">{online}/{members.length} 접속</span>
              </button>
              {isOpen && (
                <div className="bg-white">
                  {shown.length === 0 && <div className="text-[12.5px] text-edu-muted px-3 py-3">아직 등록된 교사가 없어요.</div>}
                  {shown.map((m, i) => {
                    const isMe = m.id === ME_ID;
                    const isPeer = peerIds.has(m.id);
                    return (
                      <div
                        key={m.id}
                        className={`flex items-center gap-2.5 px-3 py-2.5 ${i > 0 ? "border-t border-edu-line" : ""}`}
                      >
                        <span
                          className="w-9 h-9 rounded-full grid place-items-center text-white font-extrabold shrink-0 text-[14px]"
                          style={{ background: m.avatarColor }}
                        >
                          {(m.name || "?")[0]}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-[13.5px] leading-snug break-words">
                            {m.name} {isMe && <span className="text-edu-strong">(나)</span>}
                          </div>
                          <div className="text-[11.5px] text-edu-sub leading-snug break-words">
                            {m.subject} · {m.position} · {m.dept}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-edu-sub break-words">
                            <PresenceDot status={m.status} /> {m.statusMessage}
                          </div>
                        </div>
                        {!isMe && (
                          <div className="flex shrink-0 gap-1">
                            <button className="icon-btn" title="쪽지 보내기" onClick={() => p.onMemo(m)}>✉️</button>
                            <button className="icon-btn" title="빠른 대화" onClick={() => p.onChat(m)}>💬</button>
                            {isPeer && (
                              <button className="icon-btn" title="화면 보기 요청 (교내망)" onClick={() => p.onRemotePc(m.id, m.name)}>🖥️</button>
                            )}
                          </div>
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
