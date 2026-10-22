import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useUIStore } from './store/uiStore';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TeachersPage from './pages/TeachersPage';
import DepartmentsPage from './pages/DepartmentsPage';
import UpdatesPage from './pages/UpdatesPage';
import AuditPage from './pages/AuditPage';
import SettingsPage from './pages/SettingsPage';
import StatusPage from './pages/StatusPage';

function App() {
  const { token, teacher, checkAuth, logout } = useAuthStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const [initialized, setInitialized] = useState(false);

  // 앱 초기화 시 인증 확인
  useEffect(() => {
    const init = async () => {
      await checkAuth();
      setInitialized(true);
    };
    init();
  }, [checkAuth]);

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
            <span className="text-white text-2xl font-black">B</span>
          </div>
          <p className="text-slate-600">브리즈서버 로딩 중...</p>
          <div className="w-48 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="w-full h-full bg-gradient-to-r from-blue-600 to-blue-400 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50" data-theme={useUIStore.getState().darkMode ? 'dark' : 'light'}>
        {token && teacher ? (
          <Layout>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/teachers" element={<TeachersPage />} />
              <Route path="/departments" element={<DepartmentsPage />} />
              <Route path="/updates" element={<UpdatesPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Layout>
        ) : (
          <LoginPage />
        )}
      </div>
    </BrowserRouter>
  );
}

export default App;