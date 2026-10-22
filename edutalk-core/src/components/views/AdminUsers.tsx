import { useMemo, useState } from "react";
import type { Teacher, AdminUser, UserRole, DeptGroup } from "../../types";
import { nextAvatar } from "./OrgTreePane";
import { STATUS_META } from "../../lib/status";
import { StatusBadge } from "../ui/BzStatus";
import { bzConfirm } from "../ui/BzDialog";

interface Props {
  teachers: Teacher[];
  adminUsers: AdminUser[];
  depts: DeptGroup[];
  onAddTeacher: (t: Omit<Teacher, "id" | "avatarColor" | "status" | "statusMessage" | "ip" | "subCount" | "phone">) => void;
  onUpdateTeacher: (id: string, patch: Partial<Teacher>) => void;
  onDeleteTeacher: (id: string) => void;
  onAddAdmin: (u: Omit<AdminUser, "id" | "avatarColor" | "createdAt">) => void;
  onUpdateAdmin: (id: string, patch: Partial<AdminUser>) => void;
  onDeleteAdmin: (id: string) => void;
  onToast: (t: string) => void;
}

export default function AdminUsers(p: Props) {
  const [tab, setTab] = useState<"teachers" | "admins">("teachers");
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState<{ type: "teacher" | "admin"; edit?: Teacher | AdminUser } | null>(null);

  const filteredTeachers = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return p.teachers;
    return p.teachers.filter(t => 
      t.name.toLowerCase().includes(s) ||
      t.dept.toLowerCase().includes(s) ||
      t.subject.toLowerCase().includes(s) ||
      t.position.toLowerCase().includes(s)
    );
  }, [p.teachers, q]);

  const filteredAdmins = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return p.adminUsers;
    return p.adminUsers.filter(u =>
      u.name.toLowerCase().includes(s) ||
      u.email.toLowerCase().includes(s) ||
      u.role.includes(s)
    );
  }, [p.adminUsers, q]);

  const handleSubmitTeacher = (data: Omit<Teacher, "id" | "avatarColor" | "status" | "statusMessage" | "ip" | "subCount" | "phone">) => {
    if (showForm?.edit && showForm.type === "teacher") {
      p.onUpdateTeacher((showForm.edit as Teacher).id, data);
      p.onToast("교사 정보를 수정했어요.");
    } else {
      p.onAddTeacher(data);
      p.onToast("교사를 추가했어요.");
    }
    setShowForm(null);
  };

  const handleSubmitAdmin = (data: Omit<AdminUser, "id" | "avatarColor" | "createdAt">) => {
    if (showForm?.edit && showForm.type === "admin") {
      p.onUpdateAdmin((showForm.edit as AdminUser).id, data);
      p.onToast("관리자 정보를 수정했어요.");
    } else {
      p.onAddAdmin(data);
      p.onToast("관리자를 추가했어요.");
    }
    setShowForm(null);
  };

  const deptOptions = p.depts.map(d => d.name);

  return (
    <div className="anim-page space-y-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-extrabold text-edu-strong">사용자 관리</h1>
        <div className="flex items-center gap-2">
          <select className="edu-input !w-auto !py-1.5" value={tab} onChange={e => { setTab(e.target.value as "teachers" | "admins"); setQ(""); }}>
            <option value="teachers">교사 ({p.teachers.length})</option>
            <option value="admins">관리자 ({p.adminUsers.length})</option>
          </select>
          <input className="edu-input !w-64 !py-1.5" placeholder="이름, 부서, 과목 검색" value={q} onChange={e => setQ(e.target.value)} />
          <button className="edu-btn" onClick={() => setShowForm({ type: tab === "teachers" ? "teacher" : "admin" })}>
            {tab === "teachers" ? "➕ 교사 추가" : "➕ 관리자 추가"}
          </button>
        </div>
      </div>

      <div className="anim-card edu-card">
        {tab === "teachers" ? (
          <TeacherList 
            teachers={filteredTeachers} 
            depts={deptOptions}
            onEdit={t => setShowForm({ type: "teacher", edit: t })}
            onDelete={async id => { const ok = await bzConfirm({ title: "정말 삭제하시겠습니까?", message: "이 교사를 조직도에서 삭제해요.", confirmText: "삭제", danger: true }); if (ok) p.onDeleteTeacher(id); }}
            onToast={p.onToast}
          />
        ) : (
          <AdminList 
            admins={filteredAdmins} 
            onEdit={a => setShowForm({ type: "admin", edit: a })}
            onDelete={async id => { const ok = await bzConfirm({ title: "정말 삭제하시겠습니까?", message: "이 관리자 계정을 삭제해요.", confirmText: "삭제", danger: true }); if (ok) p.onDeleteAdmin(id); }}
            onToast={p.onToast}
          />
        )}
      </div>

      {showForm && (
        <UserFormModal
          type={showForm.type}
          initial={showForm.edit}
          depts={deptOptions}
          onSubmit={showForm.type === "teacher" ? handleSubmitTeacher : handleSubmitAdmin}
          onClose={() => setShowForm(null)}
        />
      )}
    </div>
  );
}

function TeacherList({ teachers, depts, onEdit, onDelete, onToast }: { teachers: Teacher[]; depts: string[]; onEdit: (t: Teacher) => void; onDelete: (id: string) => void; onToast: (t: string) => void }) {
  return (
    <div className="edu-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-edu-bg border-b border-edu-line">
            <tr>
              <th className="p-3 text-left font-bold text-edu-sub">교사</th>
              <th className="p-3 text-left font-bold text-edu-sub">부서</th>
              <th className="p-3 text-left font-bold text-edu-sub">과목</th>
              <th className="p-3 text-left font-bold text-edu-sub">직위</th>
              <th className="p-3 text-left font-bold text-edu-sub">담임</th>
              <th className="p-3 text-left font-bold text-edu-sub">상태</th>
              <th className="p-3 text-left font-bold text-edu-sub">관리</th>
            </tr>
          </thead>
          <tbody className="anim-list divide-y divide-edu-line">
            {teachers.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-edu-sub">등록된 교사가 없어요.</td></tr>
            )}
            {teachers.map(t => (
              <tr key={t.id} className="anim-card hover:bg-edu-chip">
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full grid place-items-center text-white font-extrabold text-sm" style={{ background: t.avatarColor }}>
                      {(t.name || "?")[0]}
                    </span>
                    <span className="font-bold">{t.name}</span>
                  </div>
                </td>
                <td className="p-3 text-edu-sub">{t.dept}</td>
                <td className="p-3 text-edu-sub">{t.subject || "-"}</td>
                <td className="p-3 text-edu-sub">{t.position}</td>
                <td className="p-3 text-edu-sub">{t.grade && t.classNo ? `${t.grade} ${t.classNo}` : "-"}</td>
                <td className="p-3">
                  <StatusBadge status={t.status} compact text={STATUS_META[t.status].short} />
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1">
                    <button className="edu-btn !py-1 !px-2 !text-xs" onClick={() => onEdit(t)}>수정</button>
                    <button className="edu-btn !py-1 !px-2 !text-xs bg-[#FFF0F1] text-[#B42318] hover:bg-[#FECACA]" onClick={() => onDelete(t.id)}>삭제</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminList({ admins, onEdit, onDelete, onToast }: { admins: AdminUser[]; onEdit: (a: AdminUser) => void; onDelete: (id: string) => void; onToast: (t: string) => void }) {
  const ROLE_LABEL: Record<UserRole, string> = {
    teacher: "교사",
    admin: "관리자",
    superadmin: "슈퍼관리자",
  };

  return (
    <div className="edu-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-edu-bg border-b border-edu-line">
            <tr>
              <th className="p-3 text-left font-bold text-edu-sub">관리자</th>
              <th className="p-3 text-left font-bold text-edu-sub">이메일</th>
              <th className="p-3 text-left font-bold text-edu-sub">역할</th>
              <th className="p-3 text-left font-bold text-edu-sub">부서</th>
              <th className="p-3 text-left font-bold text-edu-sub">가입일</th>
              <th className="p-3 text-left font-bold text-edu-sub">최근 로그인</th>
              <th className="p-3 text-left font-bold text-edu-sub">관리</th>
            </tr>
          </thead>
          <tbody className="anim-list divide-y divide-edu-line">
            {admins.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-edu-sub">등록된 관리자가 없어요.</td></tr>
            )}
            {admins.map(a => (
              <tr key={a.id} className="anim-card hover:bg-edu-chip">
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full grid place-items-center text-white font-extrabold text-sm" style={{ background: a.avatarColor }}>
                      {(a.name || "?")[0]}
                    </span>
                    <span className="font-bold">{a.name}</span>
                  </div>
                </td>
                <td className="p-3 text-edu-sub">{a.email}</td>
                <td className="p-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                    a.role === "superadmin" ? "bg-[#FDF4FF] text-[#86198F]" :
                    a.role === "admin" ? "bg-[#E8F4FB] text-[#0069A8]" :
                    "bg-[#F0F4F8] text-[#475467]"
                  }`}>
                    {ROLE_LABEL[a.role]}
                  </span>
                </td>
                <td className="p-3 text-edu-sub">{a.dept || "-"}</td>
                <td className="p-3 text-edu-sub text-xs">{new Date(a.createdAt).toLocaleDateString()}</td>
                <td className="p-3 text-edu-sub text-xs">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleDateString() : "없음"}</td>
                <td className="p-3">
                  <div className="flex items-center gap-1">
                    <button className="edu-btn !py-1 !px-2 !text-xs" onClick={() => onEdit(a)}>수정</button>
                    <button className="edu-btn !py-1 !px-2 !text-xs bg-[#FFF0F1] text-[#B42318] hover:bg-[#FECACA]" onClick={() => onDelete(a.id)}>삭제</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserFormModal({ type, initial, depts, onSubmit, onClose }: { type: "teacher" | "admin"; initial?: Teacher | AdminUser; depts: string[]; onSubmit: (data: any) => void; onClose: () => void }) {
  const isEdit = !!initial;
  const [form, setForm] = useState<any>(initial || (type === "teacher" ? {
    name: "", dept: depts[0] || "", subject: "", position: "교사", grade: "", classNo: ""
  } : {
    name: "", email: "", role: "admin" as UserRole, schoolId: "", dept: ""
  }));

  const handleChange = (field: string, value: any) => setForm((f: any) => ({ ...f, [field]: value }));

  return (
    <div className="edu-overlay" onClick={onClose}>
      <div className="edu-modal w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-edu-line flex items-center justify-between">
          <h2 className="font-extrabold text-lg">{isEdit ? "수정" : "추가"} - {type === "teacher" ? "교사" : "관리자"}</h2>
          <button className="text-edu-muted hover:text-edu-strong text-xl" onClick={onClose}>×</button>
        </div>
        <div className="p-4 space-y-3">
          {type === "teacher" ? (
            <>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">이름 *</label><input className="edu-input" value={form.name} onChange={e => handleChange("name", e.target.value)} placeholder="홍길동" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">부서 *</label><select className="edu-input" value={form.dept} onChange={e => handleChange("dept", e.target.value)}>{depts.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">과목</label><input className="edu-input" value={form.subject} onChange={e => handleChange("subject", e.target.value)} placeholder="수학, 영어 등" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">직위</label><select className="edu-input" value={form.position} onChange={e => handleChange("position", e.target.value)}><option value="교사">교사</option><option value="담임">담임</option><option value="교감">교감</option><option value="교장">교장</option><option value="행정실장">행정실장</option><option value="행정직">행정직</option></select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-sm font-bold text-edu-sub mb-1">학년</label><input className="edu-input" value={form.grade} onChange={e => handleChange("grade", e.target.value)} placeholder="1~6" /></div>
                <div><label className="block text-sm font-bold text-edu-sub mb-1">반</label><input className="edu-input" value={form.classNo} onChange={e => handleChange("classNo", e.target.value)} placeholder="1~10" /></div>
              </div>
            </>
          ) : (
            <>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">이름 *</label><input className="edu-input" value={form.name} onChange={e => handleChange("name", e.target.value)} placeholder="홍길동" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">이메일 *</label><input className="edu-input" type="email" value={form.email} onChange={e => handleChange("email", e.target.value)} placeholder="admin@school.kr" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">역할 *</label><select className="edu-input" value={form.role} onChange={e => handleChange("role", e.target.value as UserRole)}><option value="admin">관리자</option><option value="superadmin">슈퍼관리자</option></select></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">학교 ID *</label><input className="edu-input" value={form.schoolId} onChange={e => handleChange("schoolId", e.target.value)} placeholder="school_001" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">부서</label><select className="edu-input" value={form.dept} onChange={e => handleChange("dept", e.target.value)}><option value="">선택 안 함</option>{depts.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
            </>
          )}
          <div className="flex gap-2 pt-2">
            <button className="edu-btn flex-1" onClick={() => onSubmit(form)}>{isEdit ? "수정 완료" : "추가 완료"}</button>
            <button className="edu-btn flex-1 border border-edu-line bg-white" onClick={onClose}>취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}