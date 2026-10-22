import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';
import { api, initializeSocket, disconnectSocket, startHeartbeat, stopHeartbeat } from '../api/client';
import { Teacher } from '@shared/types';

const menuItems = [
  { path: '/dashboard', label: '대시보드', icon: '📊' },
  { path: '/teachers', label: '교직원 관리', icon: '👥' },
  { path: '/departments', label: '부서 관리', icon: '🏢' },
  { path: '/updates', label: 'OTA 업데이트', icon: '🚀' },
  { path: '/audit', label: '감사 로그', icon: '📋' },
  { path: '/settings', label: '학교 설정', icon: '⚙️' },
  { path: '/status', label: '서버 상태', icon: '📈' },
];

export default function Layout() {
  const { teacher, logout } = useAuthStore();
  const { sidebarOpen, toggleSidebar, toasts, removeToast, darkMode, toggleDarkMode } = useUIStore();
  const location = useLocation();
  const [serverStatus, setServerStatus] = useState<'running' | 'stopped' | 'maintenance'>('running');
  const [connectedCount, setConnectedCount] = useState(0);

  // 소켓 초기화
  useEffect(() => {
    initializeSocket(
      (notification) => {
        // OTA 알림 수신 시 토스트 표시
        useUIStore.getState().addToast({
          type: notification.mandatory ? 'warning' : 'info',
          title: '업데이트 알림',
          message: `브리즈 v${notification.version} 업데이트가 있습니다. ${notification.mandatory ? '(필수)' : '(선택)'}`,
          duration: 10000,
        });
      },
      (clients) => {
        setConnectedCount(clients.filter(c => c.status === 'online').length);
      }
    );
    startHeartbeat();

    // 서버 상태 주기적 확인
    const statusInterval = setInterval(async () => {
      try {
        const response = await api.get<{ data: any }>('/settings/status');
        setServerStatus(response.data.status);
      } catch (error) {
        setServerStatus('stopped');
      }
    }, 30000);

    // 초기 상태 확인
    api.get<{ data: any }>('/settings/status').then(r => setServerStatus(r.data.status)).catch(() => setServerStatus('stopped'));

    return () => {
      disconnectSocket();
      stopHeartbeat();
      clearInterval(statusInterval);
    };
  }, []);

  // 토스트 렌더링
  const renderToasts = () => toasts.map((toast) => (
    <div
      key={toast.id}
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border animate-slide-in min-w-[300px] max-w-md ${
        toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
        toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
        toast.type === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' :
        'bg-blue-50 border-blue-200 text-blue-800'
      }`}
    >
      <div className="flex-1">
        <p className="font-semibold">{toast.title}</p>
        {toast.message && <p className="text-sm opacity-80">{toast.message}</p>}
      </div>
      <button
        onClick={() => removeToast(toast.id)}
        className="p-1 rounded hover:bg-black/10 transition-colors"
        aria-label="닫기"
      >
        ✕
      </button>
    </div>
  ));

  const handleLogout = async () => {
    await logout();
    disconnectSocket();
    stopHeartbeat();
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* 사이드바 */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 transition-all duration-300 flex flex-col ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="메인 네비게이션"
      >
        {/* 로고 */}
        <div className="h-16 flex items-center justify-center px-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
              <span className="text-white text-xl font-black">B</span>
            </div>
            <div>
              <h1 className="font-black text-lg text-slate-900">브리즈서버</h1>
              <p className="text-xs text-slate-500">관리자 패널</p>
            </div>
          </div>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto" role="navigation" aria-label="메인 메뉴">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                ${isActive
                  ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }
              `}
              title={item.label}
            >
              <span className="text-lg" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* 하단: 서버 상태 & 사용자 정보 */}
        <div className="p-4 border-t border-slate-200 space-y-3">
          {/* 서버 상태 */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50">
            <div className={`w-2.5 h-2.5 rounded-full ${serverStatus === 'running' ? 'bg-green-500' : serverStatus === 'maintenance' ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-sm font-medium text-slate-700">
              {serverStatus === 'running' ? '정상 동작' : serverStatus === 'maintenance' ? '점검 중' : '중지됨'}
            </span>
          </div>

          {/* 접속자 수 */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50">
            <span className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 text-sm" aria-hidden="true">👥</span>
            <div>
              <p className="text-sm font-medium text-slate-700">접속 중</p>
              <p className="text-2xl font-black text-blue-600">{connectedCount}명</p>
            </div>
          </div>

          {/* 사용자 정보 */}
          <div className="pt-2 border-t border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-white font-black">
                {teacher?.name?.charAt(0) || '관'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-900 truncate">{teacher?.name}</p>
                <p className="text-xs text-slate-500">{teacher?.departmentName || teacher?.departmentId || '부서 없음'}</p>
              </div>
            </div>
          </div>

          {/* 로그아웃 버튼 */}
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <span aria-hidden="true">🚪</span>
            로그아웃
          </button>
        </div>
      </aside>

      {/* 사이드바 오버레이 (모바일) */}
      {!sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      {/* 메인 콘텐츠 */}
      <div className={`flex-1 flex flex-col lg:ml-0 ${sidebarOpen ? 'lg:ml-64' : ''} transition-all duration-300`}>
        {/* 상단 헤더 */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleSidebar}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label="메뉴 열기"
            >
              ☰
            </button>
            <h2 className="font-black text-xl text-slate-900 hidden sm:block">
              {menuItems.find(m => m.path === location.pathname)?.label || '대시보드'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* 다크 모드 토글 */}
            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label={darkMode ? '라이트 모드' : '다크 모드'}
              title={darkMode ? '라이트 모드' : '다크 모드'}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>

            {/* 창 제어 버튼 (Electron 환경에서만) */}
            {window.breezeAPI && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => window.breezeAPI!.window.minimize()}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center"
                  title="최소화"
                >
                  ─
                </button>
                <button
                  onClick={() => window.breezeAPI!.window.maximize()}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center"
                  title="최대화/복원"
                >
                  ▢
                </button>
                <button
                  onClick={() => window.breezeAPI!.window.close()}
                  className="w-8 h-8 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors flex items-center justify-center text-red-500"
                  title="닫기 (트레이로 최소화)"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </header>

        {/* 페이지 콘텐츠 */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* 토스트 컨테이너 */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 lg:hidden">
        {renderToasts()}
      </div>
      <div className="hidden lg:fixed lg:bottom-6 lg:right-6 lg:z-50 lg:flex lg:flex-col lg:gap-2">
        {renderToasts()}
      </div>
    </div>
  );
}