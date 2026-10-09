import { useState } from "react";
import type { NoticeItem } from "../../types";
import WorkBox from "../WorkBox";
import ScheduledBox from "../ScheduledBox";

interface Props {
  notices: NoticeItem[];
  onPublish: (title: string, body: string, urgent: boolean, scope: "all" | "dept", dept: string) => void;
  onTogglePopup: (id: string) => void;
  onToast: (t: string) => void;
}

export default function WorkPane(p: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [scope, setScope] = useState<"all" | "dept">("all");
  const [dept, setDept] = useState("");
  const [tab, setTab] = useState<"notice" | "box" | "reserved">("notice");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {(["notice", "box", "reserved"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-xl text-[13px] font-bold ${tab === t ? "bg-edu-soft text-edu-strong" : "text-edu-sub hover:bg-edu-chip"}`}
          >
            {t === "notice" ? "📢 공지" : t === "box" ? "🧰 업무함 (검색·일정·인수인계·수신함)" : "⏰ 예약 쪽지"}
          </button>
        ))}
      </div>
      {tab === "box" && <WorkBox onToast={p.onToast} />}
      {tab === "reserved" && <ScheduledBox onToast={p.onToast} />}
      {tab === "notice" && (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <div className="edu-card p-3.5 anim-card">
        <div className="font-extrabold text-[15px]">업무/공지</div>
        <div className="text-[12.5px] text-edu-sub">긴급으로 올리면 전 교사 화면에 팝업으로 강제 표시돼요.</div>
        <div className="mt-2.5 flex flex-col gap-2">
          <input className="edu-input" placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          <textarea className="edu-input min-h-[96px]" placeholder="내용" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`px-3 py-1.5 rounded-full text-[12.5px] font-bold border ${scope === "all" ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
            >
              전교직원에게
            </button>
            <button
              type="button"
              onClick={() => setScope("dept")}
              className={`px-3 py-1.5 rounded-full text-[12.5px] font-bold border ${scope === "dept" ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
            >
              이 부서에게
            </button>
          </div>
          {scope === "dept" && (
            <input className="edu-input" placeholder="부서명 (예: 2학년부)" value={dept} onChange={(e) => setDept(e.target.value)} maxLength={20} />
          )}
          <label className="flex items-center gap-2 text-[13px] font-bold">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="w-4 h-4" />
            긴급 공지 (전체 팝업 강제 포커스)
          </label>
          <button
            className="edu-btn"
            onClick={() => {
              if (!title.trim() || !body.trim()) return p.onToast("제목·내용을 적어 주세요.");
              if (scope === "dept" && !dept.trim()) return p.onToast("부서명을 적어 주세요.");
              p.onPublish(title.trim(), body.trim(), urgent, scope, dept.trim());
              setTitle(""); setBody(""); setUrgent(false); setScope("all"); setDept("");
            }}
          >
            올리기
          </button>
        </div>
      </div>
      <div className="edu-card p-3.5 anim-card">
        <div className="font-extrabold text-[15px]">올라온 공지 ({p.notices.length})</div>
        <div className="mt-2 flex flex-col gap-1.5 max-h-[440px] overflow-y-auto">
          {p.notices.map((n) => (
            <div key={n.id} className={`border rounded-edu px-3 py-2.5 ${n.level === "urgent" ? "border-[#F5C6C6] bg-[#FFF7F7]" : "border-edu-line"}`}>
              <div className="flex items-center gap-1.5">
                {n.level === "urgent" && <span className="text-[10.5px] font-extrabold bg-[#D92D20] text-white rounded-lg px-1.5 py-0.5">긴급</span>}
                <span className="text-[10.5px] font-extrabold bg-edu-chip text-edu-sub rounded-lg px-1.5 py-0.5">
                  {(n.scope ?? "all") === "dept" ? `부서${n.dept ? `·${n.dept}` : ""}` : "전체"}
                </span>
                <span className="font-bold text-[13.5px] flex-1">{n.title}</span>
              </div>
              <div className="text-[13px] mt-1 whitespace-pre-wrap">{n.body}</div>
              <div className="text-[11.5px] text-edu-sub mt-1">{n.fromName} · {n.createdAt}</div>
              <button className="text-[12px] font-bold text-edu-strong mt-1" onClick={() => p.onTogglePopup(n.id)}>
                {n.popup ? "팝업 끄기" : "팝업 켜기"}
              </button>
            </div>
          ))}
          {p.notices.length === 0 && <div className="text-center text-edu-sub text-[13px] py-8">올라온 공지가 없어요.</div>}
        </div>
      </div>
    </div>
      )}
    </div>
  );
}
