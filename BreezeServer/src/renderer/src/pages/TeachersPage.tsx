import { useState, useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { api } from '../api/client';
import { Teacher } from '@shared/types';

interface TeacherWithDept extends Teacher {
  department_name?: string;
}

export default function TeachersPage() {
  const { addToast } = useUIStore();
  const [teachers, setTeachers] = useState<TeacherWithDept[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherWithDept | null>(null);
  const [formData, setFormData] = useState({
    employeeNumber: '',
    name: '',
    departmentId: '',
    position: '교사',
    grade: '',
    classNo: '',
    role: 'teacher',
    password: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const PAGE_SIZE = 20;

  useEffect(() => {
    loadData();
  }, [currentPage, search, departmentFilter, statusFilter, roleFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [teachersRes, deptsRes] = await Promise.all([
        api.get<{ data: TeacherWithDept[]; pagination: any }>('/teachers', {
          page: currentPage,
          limit: PAGE_SIZE,
          search: search || undefined,
          departmentId: departmentFilter || undefined,
          status: statusFilter || undefined,
          role: roleFilter || undefined,
        }),
        api.get<{ data: any[] }>('/departments'),
      ]);

      setTeachers(teachersRes.data);
      setTotalPages(teachersRes.pagination?.totalPages || 1);
      setTotalCount(teachersRes.pagination?.total || 0);
      setDepartments(deptsRes.data);
    } catch (error) {
      console.error('Load teachers error:', error);
      addToast({ type: 'error', title: '오류', message: '교직원 목록을 불러오지 못했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingTeacher(null);
    setFormData({
      employeeNumber: '',
      name: '',
      departmentId: '',
      position: '교사',
      grade: '',
      classNo: '',
      role: 'teacher',
      password: '',
    });
    setFormErrors({});
    setShowModal(true);
  };

  const openEditModal = (teacher: TeacherWithDept) => {
    setEditingTeacher(teacher);
    setFormData({
      employeeNumber: teacher.employee_number,
      name: teacher.name,
      departmentId: teacher.department_id || '',
      position: teacher.position,
      grade: teacher.grade || '',
      classNo: teacher.class_no || '',
      role: teacher.role,
      password: '',
    });
    setFormErrors({});
    setShowModal(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.employeeNumber.trim()) errors.employeeNumber = '교원번호를 입력해 주세요.';
    if (!formData.name.trim()) errors.name = '이름을 입력해 주세요.';
    if (!editingTeacher && !formData.password.trim()) errors.password = '비밀번호를 입력해 주세요.';
    if (formData.password && formData.password.length < 8) errors.password = '비밀번호는 8자 이상이어야 합니다.';
    if (formData.role !== 'teacher' && formData.role !== 'admin' && formData.role !== 'superadmin') errors.role = '올바른 역할을 선택해 주세요.';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (editingTeacher) {
        await api.patch(`/teachers/${editingTeacher.id}`, {
          name: formData.name,
          departmentId: formData.departmentId || null,
          position: formData.position,
          grade: formData.grade || null,
          classNo: formData.classNo || null,
          role: formData.role,
        });
        addToast({ type: 'success', title: '수정 완료', message: `${formData.name} 교사의 정보가 수정되었습니다.` });
      } else {
        await api.post('/teachers', {
          employeeNumber: formData.employeeNumber,
          name: formData.name,
          departmentId: formData.departmentId || null,
          position: formData.position,
          grade: formData.grade || null,
          classNo: formData.classNo || null,
          role: formData.role,
          password: formData.password,
        });
        addToast({ type: 'success', title: '생성 완료', message: `${formData.name} 교사가 추가되었습니다.` });
      }
      setShowModal(false);
      loadData();
    } catch (error) {
      addToast({ type: 'error', title: '오류', message: error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.' });
    }
  };

  const handleDelete = async (teacher: TeacherWithDept) => {
    if (!window.confirm(`${teacher.name} 교사를 비활성화하시겠습니까? (완전 삭제는 슈퍼어드민만 가능)`)) return;

    try {
      await api.delete(`/teachers/${teacher.id}`);
      addToast({ type: 'success', title: '비활성화 완료', message: `${teacher.name} 교사가 비활성화되었습니다.` });
      loadData();
    } catch (error) {
      addToast({ type: 'error', title: '오류', message: error instanceof Error ? error.message : '비활성화에 실패했습니다.' });
    }
  };

  const handleResetPassword = async (teacher: TeacherWithDept) => {
    const newPassword = prompt(`${teacher.name} 교사의 새 비밀번호를 입력하세요 (8자 이상):`);
    if (!newPassword || newPassword.length < 8) {
      addToast({ type: 'error', title: '오류', message: '비밀번호는 8자 이상이어야 합니다.' });
      return;
    }

    try {
      await api.post(`/teachers/${teacher.id}/reset-password`, { newPassword });
      addToast({ type: 'success', title: '비밀번호 재설정 완료', message: `${teacher.name} 교사의 비밀번호가 재설정되었습니다.` });
    } catch (error) {
      addToast({ type: 'error', title: '오류', message: error instanceof Error ? error.message : '비밀번호 재설정에 실패했습니다.' });
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-green-100 text-green-700',
      inactive: 'bg-slate-100 text-slate-700',
      suspended: 'bg-red-100 text-red-700',
    };
    const labels = { active: '활성', inactive: '비활성', suspended: '정지' };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || 'bg-slate-100 text-slate-700'}`}>{labels[status as keyof typeof labels] || status}</span>;
  };

  const getRoleBadge = (role: string) => {
    const styles = {
      superadmin: 'bg-purple-100 text-purple-700',
      admin: 'bg-blue-100 text-blue-700',
      teacher: 'bg-slate-100 text-slate-700',
    };
    const labels = { superadmin: '슈퍼어드민', admin: '관리자', teacher: '교사' };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[role as keyof typeof styles] || 'bg-slate-100 text-slate-700'}`}>{labels[role as keyof typeof labels] || role}</span>;
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-black text-2xl text-slate-900">교직원 관리</h1>
          <p className="text-slate-500 mt-1">전체 교직원 계정을 관리하고 부서를 배치합니다.</p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold hover:from-blue-700 hover:to-blue-800 transition-all flex items-center gap-2"
        >
          <span>➕</span> 교직원 추가
        </button>
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 relative">
            <input
              type="text"
              placeholder="이름 또는 교원번호로 검색..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all pl-10"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          </div>
          <select
            value={departmentFilter}
            onChange={(e) => { setDepartmentFilter(e.target.value); setCurrentPage(1); }}
            className="px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
          >
            <option value="">전체 부서</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
            className="px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
          >
            <option value="">전체 상태</option>
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
            <option value="suspended">정지</option>
          </select>
          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setCurrentPage(1); }}
            className="px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
          >
            <option value="">전체 역할</option>
            <option value="superadmin">슈퍼어드민</option>
            <option value="admin">관리자</option>
            <option value="teacher">교사</option>
          </select>
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="mt-2 text-slate-500">불러오는 중...</p>
          </div>
        ) : teachers.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="text-2xl mb-2">👥</p>
            <p className="text-lg">등록된 교직원이 없습니다.</p>
            <p className="text-sm mt-1">상단의 '교직원 추가' 버튼으로 첫 교직원을 등록해 보세요.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full" role="table">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">교원번호</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">이름</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">부서</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">직위</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">역할</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상태</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">최근 로그인</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pr-4">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teachers.map((teacher) => (
                    <tr key={teacher.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-mono text-slate-600">{teacher.employee_number}</td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{teacher.name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{teacher.department_name || '미배정'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{teacher.position}</td>
                      <td className="px-4 py-3">{getRoleBadge(teacher.role)}</td>
                      <td className="px-4 py-3">{getStatusBadge(teacher.status)}</td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {teacher.last_login_at ? new Date(teacher.last_login_at).toLocaleString('ko-KR') : '로그인 기록 없음'}
                      </td>
                      <td className="px-4 py-3 text-right pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditModal(teacher)}
                            className="p-2 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                            title="수정"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleResetPassword(teacher)}
                            className="p-2 rounded-lg hover:bg-orange-50 text-orange-600 transition-colors"
                            title="비밀번호 재설정"
                          >
                            🔑
                          </button>
                          {teacher.status === 'active' && (
                            <button
                              onClick={() => handleDelete(teacher)}
                              className="p-2 rounded-lg hover:bg-red-50 text-red-600 transition-colors"
                              title="비활성화"
                            >
                              🚫
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  전체 <span className="font-semibold">{totalCount}</span>명 중 <span className="font-semibold">{(currentPage - 1) * PAGE_SIZE + 1}</span>~<span className="font-semibold">{Math.min(currentPage * PAGE_SIZE, totalCount)}</span>번째
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    이전
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) pageNum = i + 1;
                    else if (currentPage <= 3) pageNum = i + 1;
                    else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else pageNum = currentPage - 2 + i;

                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                          currentPage === pageNum
                            ? 'bg-blue-600 text-white'
                            : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    다음
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 모달 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-bold text-xl text-slate-900">{editingTeacher ? '교직원 수정' : '교직원 추가'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">교원번호 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.employeeNumber}
                  onChange={(e) => setFormData({ ...formData, employeeNumber: e.target.value })}
                  disabled={!!editingTeacher}
                  className={`w-full px-4 py-2.5 rounded-xl border ${formErrors.employeeNumber ? 'border-red-500' : 'border-slate-300'} focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all ${editingTeacher ? 'bg-slate-50' : ''}`}
                  placeholder="예: 20240001"
                />
                {formErrors.employeeNumber && <p className="mt-1 text-sm text-red-500">{formErrors.employeeNumber}</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">이름 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={`w-full px-4 py-2.5 rounded-xl border ${formErrors.name ? 'border-red-500' : 'border-slate-300'} focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all`}
                  placeholder="홍길동"
                />
                {formErrors.name && <p className="mt-1 text-sm text-red-500">{formErrors.name}</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">부서</label>
                <select
                  value={formData.departmentId}
                  onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
                >
                  <option value="">부서 선택</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">직위</label>
                <input
                  type="text"
                  value={formData.position}
                  onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
                  placeholder="담임, 교과교사, 행정실장 등"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">학년</label>
                  <input
                    type="text"
                    value={formData.grade}
                    onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
                    placeholder="예: 2학년"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">반</label>
                  <input
                    type="text"
                    value={formData.classNo}
                    onChange={(e) => setFormData({ ...formData, classNo: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
                    placeholder="예: 1반"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">역할</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
                >
                  <option value="teacher">교사</option>
                  <option value="admin">관리자</option>
                  <option value="superadmin">슈퍼어드민</option>
                </select>
                {formErrors.role && <p className="mt-1 text-sm text-red-500">{formErrors.role}</p>}
              </div>

              {!editingTeacher && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">비밀번호 <span className="text-red-500">*</span></label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className={`w-full px-4 py-2.5 rounded-xl border ${formErrors.password ? 'border-red-500' : 'border-slate-300'} focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all`}
                    placeholder="8자 이상"
                    minLength={8}
                  />
                  {formErrors.password && <p className="mt-1 text-sm text-red-500">{formErrors.password}</p>}
                  <p className="mt-1 text-xs text-slate-400">초기 비밀번호를 설정합니다. 교직원이 첫 로그인 시 변경할 수 있습니다.</p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 font-semibold text-slate-700 transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold hover:from-blue-700 hover:to-blue-800 transition-all"
                >
                  {editingTeacher ? '수정 완료' : '추가 완료'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}