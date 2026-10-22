import { useState, useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { api } from '../api/client';
import { Department } from '@shared/types';

export default function DepartmentsPage() {
  const { addToast } = useUIStore();
  const [departments, setDepartments] = useState<(Department & { teacher_count: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [formData, setFormData] = useState({ name: '', code: '', sortOrder: 0 });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadDepartments();
  }, []);

  const loadDepartments = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: (Department & { teacher_count: number })[] }>('/departments');
      setDepartments(res.data);
    } catch (error) {
      addToast({ type: 'error', title: '오류', message: '부서 목록을 불러오지 못했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingDept(null);
    setFormData({ name: '', code: '', sortOrder: departments.length });
    setFormErrors({});
    setShowModal(true);
  };

  const openEditModal = (dept: Department) => {
    setEditingDept(dept);
    setFormData({ name: dept.name, code: dept.code, sortOrder: dept.sort_order });
    setFormErrors({});
    setShowModal(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = '부서명을 입력해 주세요.';
    if (!formData.code.trim()) errors.code = '부서 코드를 입력해 주세요.';
    else if (!/^[a-z0-9_]+$/.test(formData.code)) errors.code = '코드는 영소문자, 숫자, 언더스코어만 사용 가능합니다.';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (editingDept) {
        await api.patch(`/departments/${editingDept.id}`, {
          name: formData.name,
          code: formData.code,
          sortOrder: formData.sortOrder,
        });
        addToast({ type: 'success', title: '수정 완료', message: `${formData.name} 부서가 수정되었습니다.` });
      } else {
        await api.post('/departments', {
          name: formData.name,
          code: formData.code,
          sortOrder: formData.sortOrder,
        });
        addToast({ type: 'success', title: '생성 완료', message: `${formData.name} 부서가 추가되었습니다.` });
      }
      setShowModal(false);
      loadDepartments();
    } catch (error) {
      addToast({ type: 'error', title: '오류', message: error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.' });
    }
  };

  const handleDelete = async (dept: Department) => {
    if (!window.confirm(`${dept.name} 부서를 삭제하시겠습니까? (소속 교직원이 있으면 삭제할 수 없습니다.)`)) return;

    try {
      await api.delete(`/departments/${dept.id}`);
      addToast({ type: 'success', title: '삭제 완료', message: `${dept.name} 부서가 삭제되었습니다.` });
      loadDepartments();
    } catch (error) {
      addToast({ type: 'error', title: '오류', message: error instanceof Error ? error.message : '삭제에 실패했습니다.' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-black text-2xl text-slate-900">부서 관리</h1>
          <p className="text-slate-500 mt-1">학교 조직의 부서를 관리합니다.</p>
        </div>
        <button onClick={openCreateModal} className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold hover:from-purple-700 hover:to-purple-800 transition-all flex items-center gap-2">
          <span>➕</span> 부서 추가
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center"><div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" role="table">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">순서</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">부서명</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">코드</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">소속 인원</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pr-4">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departments.map((dept, index) => (
                  <tr key={dept.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-slate-600">{dept.sort_order}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{dept.name}</td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-600">{dept.code}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{dept.teacher_count}명</td>
                    <td className="px-4 py-3 text-right pr-4">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEditModal(dept)} className="p-2 rounded-lg hover:bg-purple-50 text-purple-600 transition-colors" title="수정">✏️</button>
                        <button onClick={() => handleDelete(dept)} className="p-2 rounded-lg hover:bg-red-50 text-red-600 transition-colors" title="삭제">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-bold text-xl text-slate-900">{editingDept ? '부서 수정' : '부서 추가'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">부서명 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={`w-full px-4 py-2.5 rounded-xl border ${formErrors.name ? 'border-red-500' : 'border-slate-300'} focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all`}
                  placeholder="예: 교무실"
                />
                {formErrors.name && <p className="mt-1 text-sm text-red-500">{formErrors.name}</p>}
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">부서 코드 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  disabled={!!editingDept}
                  className={`w-full px-4 py-2.5 rounded-xl border ${formErrors.code ? 'border-red-500' : 'border-slate-300'} focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all ${editingDept ? 'bg-slate-50' : ''}`}
                  placeholder="예: academic"
                />
                {formErrors.code && <p className="mt-1 text-sm text-red-500">{formErrors.code}</p>}
                <p className="mt-1 text-xs text-slate-400">영소문자, 숫자, 언더스코어만 사용 가능</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">정렬 순서</label>
                <input
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
                  min={0}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 font-semibold text-slate-700 transition-colors">취소</button>
                <button type="submit" className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold hover:from-purple-700 hover:to-purple-800 transition-all">{editingDept ? '수정 완료' : '추가 완료'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}