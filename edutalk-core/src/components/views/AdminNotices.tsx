import { useMemo, useState } from "react";
import type { AdminNotice, Teacher, DeptGroup } from "../../types";
import { bzConfirm } from "../ui/BzDialog";

interface Props {
  notices: AdminNotice[];
  teachers: Teacher[];
  depts: DeptGroup[];
  onAdd: (n: Omit<AdminNotice, "id" | "createdAt" | "readCount" | "totalCount" | "attachments">) => void;
  onUpdate: (id: string, patch: Partial<AdminNotice>) => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
  onToast: (t: string) => void;
}

export default function AdminNotices(p: Props) {
  const [q, setQ] = useState("");
  const [filterLevel, setFilterLevel] = useState<AdminNotice["level"] | "all">("all");
  const [filterScope, setFilterScope] = useState<AdminNotice["scope"] | "all">("all");
  const [showForm, setShowForm] = useState<{ edit?: AdminNotice } | null>(null);

  const filteredNotices = useMemo(() => {
    let result = [...p.notices];
    const s = q.trim().toLowerCase();
    if (s) result = result.filter(n => n.title.toLowerCase().includes(s) || n.body.toLowerCase().includes(s));
    if (filterLevel !== "all") result = result.filter(n => n.level === filterLevel);
    if (filterScope !== "all") result = result.filter(n => n.scope === filterScope);
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [p.notices, q, filterLevel, filterScope]);

  const handleSubmit = (data: Omit<AdminNotice, "id" | "createdAt" | "readCount" | "totalCount" | "attachments">) => {
    if (showForm?.edit) {
      p.onUpdate(showForm.edit.id, data);
      p.onToast("공지사항을 수정했어요.");
    } else {
      p.onAdd(data);
      p.onToast("공지사항을 작성했어요.");
    }
    setShowForm(null);
  };

  return (
    <div className="anim-page space-y-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-extrabold text-edu-strong">공지사항 관리</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input className="edu-input !w-64 !py-1.5" placeholder="제목, 내용 검색" value={q} onChange={e => setQ(e.target.value)} />
          <select className="edu-input !w-auto !py-1.5" value={filterLevel} onChange={e => setFilterLevel(e.target.value as any)}>
            <option value="all">전체 중요도</option>
            <option value="urgent">긴급</option>
            <option value="normal">일반</option>
            <option value="info">알림</option>
          </select>
          <select className="edu-input !w-auto !py-1.5" value={filterScope} onChange={e => setFilterScope(e.target.value as any)}>
            <option value="all">전체 대상</option>
            <option value="all">전체</option>
            <option value="dept">부서별</option>
            <option value="grade">학년별</option>
            <option value="class">학급별</option>
          </select>
          <button className="edu-btn" onClick={() => setShowForm({})}>➕ 공지 작성</button>
        </div>
      </div>

      <div className="anim-card edu-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-edu-bg border-b border-edu-line">
              <tr>
                <th className="p-3 text-left font-bold text-edu-sub">제목</th>
                <th className="p-3 text-left font-bold text-edu-sub">중요도</th>
                <th className="p-3 text-left font-bold text-edu-sub">대상 범위</th>
                <th className="p-3 text-left font-bold text-edu-sub">상태</th>
                <th className="p-3 text-left font-bold text-edu-sub">작성자</th>
                <th className="p-3 text-left font-bold text-edu-sub">작성일</th>
                <th className="p-3 text-left font-bold text-edu-sub">읽음</th>
                <th className="p-3 text-left font-bold text-edu-sub">관리</th>
              </tr>
            </thead>
            <tbody className="anim-list divide-y divide-edu-line">
              {filteredNotices.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-edu-sub">공지사항이 없어요.</td></tr>
              )}
              {filteredNotices.map(n => (
                <tr key={n.id} className="anim-card hover:bg-edu-chip">
                  <td className="p-3 max-w-xs">
                    <div className="font-bold truncate">{n.title}</div>
                    <div className="text-xs text-edu-sub truncate">{n.body.slice(0, 50)}...</div>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                      n.level === "urgent" ? "bg-[#FFF0F1] text-[#B42318]" :
                      n.level === "info" ? "bg-[#E8F4FB] text-[#0069A8]" :
                      "bg-[#F0F4F8] text-[#475467]"
                    }`}>
                      {n.level === "urgent" ? "긴급" : n.level === "info" ? "알림" : "일반"}
                    </span>
                  </td>
                  <td className="p-3 text-edu-sub text-xs">
                    {n.scope === "all" ? "전체" :
                     n.scope === "dept" ? `부서: ${n.targetDept}` :
                     n.scope === "grade" ? `학년: ${n.targetGrade}` :
                     `학급: ${n.targetGrade}-${n.targetClass}`}
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                      n.publishedAt ? "bg-[#ECFDF5] text-[#027A48]" : "bg-[#FFF0F1] text-[#B42318]"
                    }`}>
                      {n.publishedAt ? "게시됨" : "대기중"}
                    </span>
                  </td>
                  <td className="p-3 text-edu-sub">{n.fromAdminName}</td>
                  <td className="p-3 text-edu-sub text-xs">{new Date(n.createdAt).toLocaleDateString()}</td>
                  <td className="p-3 text-edu-sub font-bold">{n.readCount} / {n.totalCount}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <button className="edu-btn !py-1 !px-2 !text-xs" onClick={() => setShowForm({ edit: n })}>수정</button>
                      {!n.publishedAt && (
                        <button className="edu-btn !py-1 !px-2 !text-xs bg-[#E8F4FB] text-[#0069A8] hover:bg-[#D6EFFF]" onClick={() => p.onPublish(n.id)}>게시</button>
                      )}
                      <button className="edu-btn !py-1 !px-2 !text-xs bg-[#FFF0F1] text-[#B42318] hover:bg-[#FECACA]" onClick={async () => { const ok = await bzConfirm({ title: "정말 삭제하시겠습니까?", message: `"${n.title}" 공지를 삭제해요.`, confirmText: "삭제", danger: true }); if (ok) p.onDelete(n.id); }}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <NoticeFormModal
          initial={showForm.edit}
          teachers={p.teachers}
          depts={p.depts}
          onSubmit={handleSubmit}
          onClose={() => setShowForm(null)}
        />
      )}
    </div>
  );
}

function NoticeFormModal({ initial, teachers, depts, onSubmit, onClose }: { initial?: AdminNotice; teachers: Teacher[]; depts: DeptGroup[]; onSubmit: (data: any) => void; onClose: () => void }) {
  const isEdit = !!initial;
  const [form, setForm] = useState<any>(initial || {
    title: "", body: "", level: "normal" as AdminNotice["level"], scope: "all" as AdminNotice["scope"],
    targetDept: "", targetGrade: "", targetClass: "",
    fromAdminId: "admin_001", fromAdminName: "관리자",
    publishedAt: undefined, expiresAt: undefined,
    attachments: []
  });

  const handleChange = (field: string, value: any) => setForm((f: any) => ({ ...f, [field]: value }));

  const calculateTotalCount = () => {
    if (form.scope === "all") return teachers.length;
    if (form.scope === "dept") return teachers.filter(t => t.dept === form.targetDept).length;
    if (form.scope === "grade") return teachers.filter(t => t.grade === form.targetGrade).length;
    if (form.scope === "class") return teachers.filter(t => t.grade === form.targetGrade && t.classNo === form.targetClass).length;
    return 0;
  };

  const totalCount = calculateTotalCount();

  return (
    <div className="edu-overlay" onClick={onClose}>
      <div className="edu-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-edu-line flex items-center justify-between">
          <h2 className="font-extrabold text-lg">{isEdit ? "공지 수정" : "공지 작성"}</h2>
          <button className="text-edu-muted hover:text-edu-strong text-xl" onClick={onClose}>×</button>
        </div>
        <div className="p-4 space-y-4">
          <div><label className="block text-sm font-bold text-edu-sub mb-1">제목 *</label><input className="edu-input" value={form.title} onChange={e => handleChange("title", e.target.value)} placeholder="공지사항 제목" /></div>
          <div><label className="block text-sm font-bold text-edu-sub mb-1">내용 *</label><textarea className="edu-input !min-h-[120px]" value={form.body} onChange={e => handleChange("body", e.target.value)} placeholder="공지사항 내용" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-bold text-edu-sub mb-1">중요도</label><select className="edu-input" value={form.level} onChange={e => handleChange("level", e.target.value)}><option value="normal">일반</option><option value="urgent">긴급</option><option value="info">알림</option></select></div>
            <div><label className="block text-sm font-bold text-edu-sub mb-1">대상 범위</label><select className="edu-input" value={form.scope} onChange={e => handleChange("scope", e.target.value)}><option value="all">전체</option><option value="dept">부서별</option><option value="grade">학년별</option><option value="class">학급별</option></select></div>
          </div>
          {form.scope === "dept" && (
            <div><label className="block text-sm font-bold text-edu-sub mb-1">대상 부서</label><select className="edu-input" value={form.targetDept} onChange={e => handleChange("targetDept", e.target.value)}>{depts.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}</select></div>
          )}
          {form.scope === "grade" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-bold text-edu-sub mb-1">학년</label><input className="edu-input" value={form.targetGrade} onChange={e => handleChange("targetGrade", e.target.value)} placeholder="1~6" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">반 (학급별 선택 시)</label><input className="edu-input" value={form.targetClass} onChange={e => handleChange("targetClass", e.target.value)} placeholder="1~10" /></div>
            </div>
          )}
          {form.scope === "class" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-bold text-edu-sub mb-1">학년</label><input className="edu-input" value={form.targetGrade} onChange={e => handleChange("targetGrade", e.target.value)} placeholder="1~6" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">반</label><input className="edu-input" value={form.targetClass} onChange={e => handleChange("targetClass", e.target.value)} placeholder="1~10" /></div>
            </div>
          )}
          <div className="bg-edu-soft p-3 rounded-lg border border-edu-line">
            <div className="font-bold text-sm text-edu-strong">예상 수신자: {totalCount}명</div>
            <div className="text-xs text-edu-sub mt-1">대상 범위와 부서/학년/반에 따라 자동 계산돼요.</div>
          </div>
          <div className="flex gap-2 pt-2">
            <button className="edu-btn flex-1" onClick={() => onSubmit(form)}>{isEdit ? "수정 완료" : "작성 완료"}</button>
            <button className="edu-btn flex-1 border border-edu-line bg-white" onClick={onClose}>취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}