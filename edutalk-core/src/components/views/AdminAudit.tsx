import { useMemo, useState } from "react";
import type { AdminAuditLog } from "../../types";

interface Props {
  audits: AdminAuditLog[];
  onToast: (t: string) => void;
}

const ACTION_LABELS: Record<AdminAuditLog["action"], string> = {
  create: "생성", update: "수정", delete: "삭제", login: "로그인", logout: "로그아웃",
  export: "내보내기", import: "가져오기", permission_change: "권한 변경",
  notice_send: "공지 발송", timetable_publish: "시간표 배포", user_manage: "사용자 관리",
};

const TARGET_LABELS: Record<AdminAuditLog["targetType"], string> = {
  user: "사용자", notice: "공지", timetable: "시간표", school: "학교",
  dept: "부서", memo: "쪽지", chat: "대화", settings: "설정",
};

export default function AdminAudit(p: Props) {
  const [q, setQ] = useState("");
  const [filterAction, setFilterAction] = useState<AdminAuditLog["action"] | "all">("all");
  const [filterTarget, setFilterTarget] = useState<AdminAuditLog["targetType"] | "all">("all");
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: "", end: "" });

  const filteredAudits = useMemo(() => {
    let result = [...p.audits];
    const s = q.trim().toLowerCase();
    if (s) result = result.filter(a => a.detail.toLowerCase().includes(s) || a.adminName.toLowerCase().includes(s) || a.targetName.toLowerCase().includes(s));
    if (filterAction !== "all") result = result.filter(a => a.action === filterAction);
    if (filterTarget !== "all") result = result.filter(a => a.targetType === filterTarget);
    if (dateRange.start) result = result.filter(a => a.createdAt >= dateRange.start);
    if (dateRange.end) result = result.filter(a => a.createdAt <= dateRange.end + "T23:59:59");
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [p.audits, q, filterAction, filterTarget, dateRange]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  return (
    <div className="anim-page space-y-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-extrabold text-edu-strong">감사 로그</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input className="edu-input !w-64 !py-1.5" placeholder="내용, 관리자, 대상 검색" value={q} onChange={e => setQ(e.target.value)} />
          <select className="edu-input !w-auto !py-1.5" value={filterAction} onChange={e => setFilterAction(e.target.value as any)}>
            <option value="all">전체 작업</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="edu-input !w-auto !py-1.5" value={filterTarget} onChange={e => setFilterTarget(e.target.value as any)}>
            <option value="all">전체 대상</option>
            {Object.entries(TARGET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="edu-input !w-40 !py-1.5" type="date" value={dateRange.start} onChange={e => setDateRange(d => ({ ...d, start: e.target.value }))} />
          <span className="text-edu-sub">~</span>
          <input className="edu-input !w-40 !py-1.5" type="date" value={dateRange.end} onChange={e => setDateRange(d => ({ ...d, end: e.target.value }))} />
        </div>
      </div>

      <div className="anim-card edu-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-edu-bg border-b border-edu-line">
              <tr>
                <th className="p-3 text-left font-bold text-edu-sub">일시</th>
                <th className="p-3 text-left font-bold text-edu-sub">관리자</th>
                <th className="p-3 text-left font-bold text-edu-sub">작업</th>
                <th className="p-3 text-left font-bold text-edu-sub">대상</th>
                <th className="p-3 text-left font-bold text-edu-sub">상세</th>
                <th className="p-3 text-left font-bold text-edu-sub">IP</th>
                <th className="p-3 text-left font-bold text-edu-sub">결과</th>
              </tr>
            </thead>
            <tbody className="anim-list divide-y divide-edu-line">
              {filteredAudits.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-edu-sub">감사 로그가 없어요.</td></tr>
              )}
              {filteredAudits.map(a => (
                <tr key={a.id} className="anim-card hover:bg-edu-chip">
                  <td className="p-3 text-xs text-edu-sub whitespace-nowrap">{formatDate(a.createdAt)}</td>
                  <td className="p-3 font-bold">{a.adminName}</td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${["delete", "permission_change"].includes(a.action) ? "bg-[#FFF0F1] text-[#B42318]" : "bg-[#E8F4FB] text-[#0069A8]"}`}>
                      {ACTION_LABELS[a.action]}
                    </span>
                  </td>
                  <td className="p-3 text-edu-sub">{TARGET_LABELS[a.targetType]}</td>
                  <td className="p-3 max-w-xs">
                    <div className="font-medium truncate">{a.targetName}</div>
                    <div className="text-xs text-edu-sub truncate">{a.detail}</div>
                  </td>
                  <td className="p-3 text-edu-sub text-xs">{a.ip || "-"}</td>
                  <td className="p-3">
                    {a.blocked ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-[#FFF0F1] text-[#B42318]">차단됨</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-[#ECFDF5] text-[#027A48]">성공</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="anim-card edu-card p-4 text-sm text-edu-sub">
        <div className="font-bold text-edu-strong mb-2">필터링 결과: {filteredAudits.length}건 / 전체: {p.audits.length}건</div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-edu-soft rounded-lg">
            <div className="text-2xl font-extrabold text-[#027A48]">{filteredAudits.filter(a => !a.blocked).length}</div>
            <div className="text-xs">성공</div>
          </div>
          <div className="p-3 bg-edu-soft rounded-lg">
            <div className="text-2xl font-extrabold text-[#B42318]">{filteredAudits.filter(a => a.blocked).length}</div>
            <div className="text-xs">차단</div>
          </div>
          <div className="p-3 bg-edu-soft rounded-lg">
            <div className="text-2xl font-extrabold text-edu-strong">{new Set(filteredAudits.map(a => a.adminId)).size}</div>
            <div className="text-xs">관리자 수</div>
          </div>
        </div>
      </div>
    </div>
  );
}