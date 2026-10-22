import { useState } from "react";
import type { School, LicenseKind } from "../../types";

interface Props {
  school: School | null;
  onUpdate: (s: Partial<School>) => void;
  onToast: (t: string) => void;
}

export default function AdminSchool(p: Props) {
  const [form, setForm] = useState<Partial<School>>(p.school || {
    name: "", code: "", address: "", phone: "", principalName: "",
    adminId: "admin_001", licenseKind: "full" as LicenseKind,
  });

  const handleChange = (field: string, value: any) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = () => {
    p.onUpdate(form);
    p.onToast("학교 정보를 저장했어요.");
  };

  if (!p.school) {
    return (
      <div className="anim-page space-y-4 p-4 overflow-y-auto">
        <h1 className="text-2xl font-extrabold text-edu-strong">학교 정보 설정</h1>
        <div className="anim-card edu-card p-6 text-center">
          <div className="text-4xl mb-3">🏫</div>
          <h2 className="font-bold text-lg mb-2">학교 정보가 아직 없어요</h2>
          <p className="text-edu-sub mb-6">최초 설정 시 학교 기본 정보를 입력해 주세요.</p>
          <SchoolForm form={form} onChange={handleChange} onSubmit={handleSubmit} />
        </div>
      </div>
    );
  }

  return (
    <div className="anim-page space-y-6 p-4 overflow-y-auto max-w-4xl">
      <h1 className="text-2xl font-extrabold text-edu-strong">학교 정보</h1>

      <div className="anim-card edu-card p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <div className="md:col-span-3">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2">📋 기본 정보</h2>
            <div className="anim-list grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-bold text-edu-sub mb-1">학교명 *</label><input className="edu-input" value={form.name} onChange={e => handleChange("name", e.target.value)} placeholder="○○초등학교" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">학교 코드 *</label><input className="edu-input" value={form.code} onChange={e => handleChange("code", e.target.value)} placeholder="SEOUL_001" /></div>
              <div className="md:col-span-2"><label className="block text-sm font-bold text-edu-sub mb-1">주소</label><input className="edu-input" value={form.address} onChange={e => handleChange("address", e.target.value)} placeholder="서울특별시 강남구 테헤란로 123" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">전화번호</label><input className="edu-input" value={form.phone} onChange={e => handleChange("phone", e.target.value)} placeholder="02-1234-5678" /></div>
              <div><label className="block text-sm font-bold text-edu-sub mb-1">교장명</label><input className="edu-input" value={form.principalName} onChange={e => handleChange("principalName", e.target.value)} placeholder="홍길동" /></div>
            </div>
          </div>
        </div>

        <div className="border-t border-edu-line pt-4">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">📄 이용권 정보</h2>
          <div className="anim-list grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-edu-sub mb-1">이용권 종류</label>
              <select className="edu-input" value={form.licenseKind} onChange={e => handleChange("licenseKind", e.target.value)}>
                <option value="full">전체 기능 (Full)</option>
                <option value="chatOnly">대화 전용 (Chat Only)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-edu-sub mb-1">만료일</label>
              <input type="date" className="edu-input" value={form.licenseExpiresAt?.split("T")[0] || ""} onChange={e => handleChange("licenseExpiresAt", e.target.value ? e.target.value + "T00:00:00" : undefined)} />
            </div>
          </div>
          <div className="mt-3 p-3 bg-edu-soft rounded-lg border border-edu-line">
            <div className="font-medium text-edu-strong">
              현재 상태: {form.licenseKind === "full" ? "전체 기능 이용 중" : "대화 기능만 이용 중"}
              {form.licenseExpiresAt && ` (만료: ${new Date(form.licenseExpiresAt).toLocaleDateString()})`}
            </div>
            <div className="text-sm text-edu-sub mt-1">전체 기능: 조직도, 쪽지, 대화, 시간표, 보강, 공지, 감사, 설정 모두 사용 가능</div>
            <div className="text-sm text-edu-sub">대화 전용: 빠른 대화(채팅) 기능만 사용 가능, 조직도/쪽지/시간표 등 제한</div>
          </div>
        </div>

        <div className="border-t border-edu-line pt-4">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">🔧 시스템 정보</h2>
          <div className="anim-list grid grid-cols-2 gap-4 text-sm">
            <div className="anim-card p-3 bg-edu-bg rounded-lg">
              <div className="text-edu-sub">학교 ID</div>
              <div className="font-mono font-bold text-edu-strong">{p.school.id}</div>
            </div>
            <div className="anim-card p-3 bg-edu-bg rounded-lg">
              <div className="text-edu-sub">관리자 ID</div>
              <div className="font-mono font-bold text-edu-strong">{p.school.adminId}</div>
            </div>
            <div className="anim-card p-3 bg-edu-bg rounded-lg">
              <div className="text-edu-sub">생성일</div>
              <div className="font-mono font-bold text-edu-strong">{new Date(p.school.createdAt).toLocaleDateString()}</div>
            </div>
            <div className="anim-card p-3 bg-edu-bg rounded-lg">
              <div className="text-edu-sub">이용권 종류</div>
              <div className="font-bold text-edu-strong capitalize">{p.school.licenseKind}</div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-4 border-t border-edu-line">
          <button className="edu-btn flex-1" onClick={handleSubmit}>저장하기</button>
          <button className="edu-btn flex-1 border border-edu-line bg-white" onClick={() => setForm(p.school || {})}>초기화</button>
        </div>
      </div>
    </div>
  );
}

function SchoolForm({ form, onChange, onSubmit }: { form: Partial<School>; onChange: (field: string, value: any) => void; onSubmit: () => void }) {
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <div><label className="block text-sm font-bold text-edu-sub mb-1">학교명 *</label><input className="edu-input" value={form.name || ""} onChange={e => onChange("name", e.target.value)} placeholder="○○초등학교" /></div>
      <div><label className="block text-sm font-bold text-edu-sub mb-1">학교 코드 *</label><input className="edu-input" value={form.code || ""} onChange={e => onChange("code", e.target.value)} placeholder="SEOUL_001" /></div>
      <div><label className="block text-sm font-bold text-edu-sub mb-1">주소</label><input className="edu-input" value={form.address || ""} onChange={e => onChange("address", e.target.value)} placeholder="서울특별시 강남구 테헤란로 123" /></div>
      <div><label className="block text-sm font-bold text-edu-sub mb-1">전화번호</label><input className="edu-input" value={form.phone || ""} onChange={e => onChange("phone", e.target.value)} placeholder="02-1234-5678" /></div>
      <div><label className="block text-sm font-bold text-edu-sub mb-1">교장명</label><input className="edu-input" value={form.principalName || ""} onChange={e => onChange("principalName", e.target.value)} placeholder="홍길동" /></div>
      <div><label className="block text-sm font-bold text-edu-sub mb-1">이용권 종류</label><select className="edu-input" value={form.licenseKind || "full"} onChange={e => onChange("licenseKind", e.target.value)}><option value="full">전체 기능 (Full)</option><option value="chatOnly">대화 전용 (Chat Only)</option></select></div>
      <div><label className="block text-sm font-bold text-edu-sub mb-1">만료일</label><input type="date" className="edu-input" value={form.licenseExpiresAt?.split("T")[0] || ""} onChange={e => onChange("licenseExpiresAt", e.target.value ? e.target.value + "T00:00:00" : undefined)} /></div>
      <div className="flex gap-2 pt-2">
        <button className="edu-btn flex-1" onClick={onSubmit}>등록 완료</button>
      </div>
    </div>
  );
}