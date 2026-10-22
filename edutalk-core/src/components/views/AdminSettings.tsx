import { useState } from "react";
import type { SchoolSettings, DlpRule } from "../../types";
import { bzConfirm } from "../ui/BzDialog";

interface Props {
  settings: SchoolSettings;
  onUpdate: (s: Partial<SchoolSettings>) => void;
  onToast: (t: string) => void;
}

export default function AdminSettings(p: Props) {
  const [dlpRules, setDlpRules] = useState<DlpRule[]>(p.settings.dlpRules || []);
  const [editingRule, setEditingRule] = useState<DlpRule | null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);

  const handleDlpSubmit = (rule: Omit<DlpRule, "id"> & { id?: string }) => {
    if (editingRule) {
      setDlpRules(r => r.map(x => x.id === editingRule.id ? { ...rule, id: editingRule.id } : x));
    } else {
      setDlpRules(r => [...r, { ...rule, id: `dlp_${Date.now()}` }]);
    }
    p.onUpdate({ dlpRules: dlpRules.map(r => editingRule && r.id === editingRule.id ? { ...rule, id: editingRule.id } : r) });
    setEditingRule(null);
    setShowRuleForm(false);
    p.onToast("DLP 규칙을 저장했어요.");
  };

  const deleteRule = async (id: string) => {
    const ok = await bzConfirm({
      title: "정말 삭제하시겠습니까?",
      message: "이 DLP(개인정보 유출 방지) 규칙을 삭제해요.",
      confirmText: "삭제",
      danger: true,
    });
    if (!ok) return;
    setDlpRules(r => r.filter(x => x.id !== id));
    p.onUpdate({ dlpRules: dlpRules.filter(x => x.id !== id) });
    p.onToast("DLP 규칙을 삭제했어요.");
  };

  return (
    <div className="anim-page space-y-6 p-4 overflow-y-auto max-w-4xl">
      <h1 className="text-2xl font-extrabold text-edu-strong">학교 설정</h1>

      <div className="anim-card edu-card p-6 space-y-6">
        <section>
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">🌐 네트워크 설정</h2>
          <div className="anim-list space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-5 h-5 rounded border-edu-line text-edu-blue focus:ring-edu-blue" 
                checked={p.settings.allowExternalNetwork} 
                onChange={e => p.onUpdate({ allowExternalNetwork: e.target.checked })} />
              <span className="font-medium">외부망 접속 허용</span>
              <span className="text-sm text-edu-sub ml-auto">체크 시 교외에서도 앱 사용 가능</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-5 h-5 rounded border-edu-line text-edu-blue focus:ring-edu-blue" 
                checked={p.settings.autoBackup} 
                onChange={e => p.onUpdate({ autoBackup: e.target.checked })} />
              <span className="font-medium">자동 백업</span>
              <span className="text-sm text-edu-sub ml-auto">일일 새벽 3시 자동 백업 실행</span>
            </label>
          </div>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">🗄️ 데이터 보관</h2>
          <div className="anim-list grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-edu-sub mb-1">보관 기간 (일)</label>
              <input type="number" className="edu-input" min="30" max="3650" 
                value={p.settings.retentionDays} 
                onChange={e => p.onUpdate({ retentionDays: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className="block text-sm font-bold text-edu-sub mb-1">알림 기본 범위</label>
              <select className="edu-input" value={p.settings.notificationDefaultScope} onChange={e => p.onUpdate({ notificationDefaultScope: e.target.value as any })}>
                <option value="all">전체</option>
                <option value="dept">부서별</option>
              </select>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">🛡️ DLP (개인정보 보호) 설정</h2>
          <label className="flex items-center gap-3 cursor-pointer mb-4">
            <input type="checkbox" className="w-5 h-5 rounded border-edu-line text-edu-blue focus:ring-edu-blue" 
              checked={p.settings.dlpEnabled} 
              onChange={e => p.onUpdate({ dlpEnabled: e.target.checked })} />
            <span className="font-medium">DLP 기능 활성화</span>
            <span className="text-sm text-edu-sub ml-auto">쪽지/대화에서 개인정보 패턴 감지 시 차단/경고</span>
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-edu-bg rounded-lg">
              <span className="font-medium">기본 제공 규칙</span>
              <span className="text-sm text-edu-sub">주민등록번호, 전화번호, 신용카드, 계좌번호, 비밀번호 패턴 내장</span>
            </div>
            
            <div className="border-t border-edu-line pt-3">
              <h3 className="font-bold text-sm mb-3">사용자 정의 규칙 ({dlpRules.length}개)</h3>
              {dlpRules.length === 0 ? (
                <p className="text-edu-sub text-sm text-center py-4">사용자 정의 규칙이 없어요. 규칙을 추가해 보세요.</p>
              ) : (
                <div className="anim-list space-y-2">
                  {dlpRules.map(rule => (
                    <div key={rule.id} className="anim-card edu-card p-3 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{rule.name}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            rule.action === "block" ? "bg-[#FFF0F1] text-[#B42318]" :
                            rule.action === "warn" ? "bg-[#FFFAEB] text-[#B45309]" :
                            "bg-[#F0F4F8] text-[#475467]"
                          }`}>
                            {rule.action === "block" ? "차단" : rule.action === "warn" ? "경고" : "로그"}
                          </span>
                          {!rule.enabled && <span className="text-xs text-edu-muted">비활성화</span>}
                        </div>
                        <div className="text-xs text-edu-sub font-mono mt-1 truncate">{rule.pattern}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button className="edu-btn !py-1 !px-2 !text-xs" onClick={() => { setEditingRule(rule); setShowRuleForm(true); }}>수정</button>
                        <button className="edu-btn !py-1 !px-2 !text-xs bg-[#FFF0F1] text-[#B42318] hover:bg-[#FECACA]" onClick={() => deleteRule(rule.id)}>삭제</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button className="edu-btn mt-3" onClick={() => { setEditingRule(null); setShowRuleForm(true); }}>➕ 규칙 추가</button>
            </div>
          </div>
        </section>
      </div>

      {showRuleForm && (
        <DlpRuleFormModal
          initial={editingRule}
          onSubmit={handleDlpSubmit}
          onClose={() => { setEditingRule(null); setShowRuleForm(false); }}
        />
      )}
    </div>
  );
}

function DlpRuleFormModal({ initial, onSubmit, onClose }: { initial: DlpRule | null; onSubmit: (rule: any) => void; onClose: () => void }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(initial || { name: "", pattern: "", action: "warn" as DlpRule["action"], enabled: true });

  return (
    <div className="edu-overlay" onClick={onClose}>
      <div className="edu-modal w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-edu-line flex items-center justify-between">
          <h2 className="font-extrabold text-lg">{isEdit ? "DLP 규칙 수정" : "DLP 규칙 추가"}</h2>
          <button className="text-edu-muted hover:text-edu-strong text-xl" onClick={onClose}>×</button>
        </div>
        <div className="p-4 space-y-3">
          <div><label className="block text-sm font-bold text-edu-sub mb-1">규칙 이름 *</label><input className="edu-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="예: 학생 성적 패턴" /></div>
          <div><label className="block text-sm font-bold text-edu-sub mb-1">정규식 패턴 *</label><input className="edu-input font-mono text-sm" value={form.pattern} onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))} placeholder="예: \\d{2}[-/]\\d{2}[-/]\\d{4}" /></div>
          <div><label className="block text-sm font-bold text-edu-sub mb-1">액션</label><select className="edu-input" value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value as any }))}><option value="block">차단 (전송 불가)</option><option value="warn">경고 (확인 후 전송)</option><option value="log">로그만 기록</option></select></div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded border-edu-line text-edu-blue focus:ring-edu-blue" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            <span className="text-sm">활성화</span>
          </label>
          <div className="flex gap-2 pt-2">
            <button className="edu-btn flex-1" onClick={() => onSubmit(form)}>{isEdit ? "수정 완료" : "추가 완료"}</button>
            <button className="edu-btn flex-1 border border-edu-line bg-white" onClick={onClose}>취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}