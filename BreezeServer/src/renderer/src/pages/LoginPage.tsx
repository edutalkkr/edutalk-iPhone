import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';
import { api } from '../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth, checkAuth } = useAuthStore();
  const { addToast, darkMode, toggleDarkMode } = useUIStore();

  const [schoolCode, setSchoolCode] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post<{
        success: boolean;
        teacher: any;
        token: string;
        requiresUpdate?: boolean;
        latestVersion?: string;
      }>('/auth/login', {
        schoolCode,
        employeeNumber,
        password,
        clientVersion: '1.0.0',
        platform: 'win32',
      });

      if (response.success && response.teacher && response.token) {
        setAuth(response.token, response.teacher);
        addToast({
          type: 'success',
          title: '로그인 성공',
          message: `${response.teacher.name}님 환영합니다.`,
        });
        navigate('/dashboard');
      } else {
        setError(response.message || '로그인에 실패했습니다.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg">
            <span className="text-white text-3xl font-black">B</span>
          </div>
          <h1 className="font-black text-2xl text-slate-900">브리즈서버</h1>
          <p className="text-slate-500 mt-1">학교 내부망 메신저 백엔드 관리자 패널</p>
        </div>

        {/* 로그인 폼 */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center gap-2" role="alert">
              <span aria-hidden="true">⚠️</span>
              <span className="text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="schoolCode" className="block text-sm font-semibold text-slate-700 mb-1.5">
                학교 코드
              </label>
              <input
                id="schoolCode"
                type="text"
                value={schoolCode}
                onChange={(e) => setSchoolCode(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all text-base"
                placeholder="예: SEOUL_001"
                required
                disabled={loading}
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="employeeNumber" className="block text-sm font-semibold text-slate-700 mb-1.5">
                교원번호
              </label>
              <input
                id="employeeNumber"
                type="text"
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all text-base"
                placeholder="교원번호 입력"
                required
                disabled={loading}
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-1.5">
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all text-base"
                placeholder="비밀번호 입력"
                required
                disabled={loading}
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold text-base hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500/50 focus:outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  로그인 중...
                </span>
              ) : (
                '로그인'
              )}
            </button>
          </form>

          {/* 다크 모드 토글 */}
          <div className="mt-6 pt-6 border-t border-slate-200 flex items-center justify-center gap-2">
            <button
              onClick={toggleDarkMode}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
            >
              {darkMode ? '☀️' : '🌙'}
              <span>{darkMode ? '라이트 모드' : '다크 모드'}</span>
            </button>
          </div>
        </div>

        {/* 하단 정보 */}
        <div className="mt-6 text-center text-sm text-slate-500">
          <p>브리즈서버 v1.0.0</p>
          <p className="mt-1">학교 내부망 전용 · 독립 구동형 백엔드</p>
        </div>
      </div>
    </div>
  );
}