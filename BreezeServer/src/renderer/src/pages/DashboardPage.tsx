import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';
import { api } from '../api/client';

interface DashboardStats {
  totalTeachers: number;
  activeTeachers: number;
  totalDepartments: number;
  onlineClients: number;
  pendingUpdates: number;
  auditLogsToday: number;
}

interface RecentActivity {
  id: string;
  action: string;
  targetName: string;
  adminName: string;
  createdAt: string;
  riskLevel: string;
}

export default function DashboardPage() {
  const { teacher } = useAuthStore();
  const { addToast } = useUIStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 60000); // 1분마다 갱신
    return () => clearInterval(interval);
  }, []);

  const loadDashboardData = async () => {
    try {
      const [statsRes, activitiesRes] = await Promise.all([
        api.get<{ data: DashboardStats }>('/settings/status').then(r => ({ data: r.data })).catch(() => ({ data: null })),
        api.get<{ data: RecentActivity[] }>('/audit?limit=10&riskLevel=high,critical').then(r => r.data).catch(() => []),
      ]);

      // 통계 데이터 구성
      const teachersRes = await api.get<{ data: any[] }>('/teachers?limit=1').catch(() => ({ data: [] }));
      const deptsRes = await api.get<{ data: any[] }>('/departments').catch(() => ({ data: [] }));

      setStats({
        totalTeachers: teachersRes.data?.length || 0,
        activeTeachers: teachersRes.data?.filter(t => t.status === 'active').length || 0,
        totalDepartments: deptsRes.data?.length || 0,
        onlineClients: 0, // 소켓에서 업데이트
        pendingUpdates: 0,
        auditLogsToday: activitiesRes.length,
      });

      setRecentActivities(activitiesRes);
    } catch (error) {
      console.error('Dashboard load error:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { label: '전체 교직원', value: stats?.totalTeachers || 0, icon: '👥', color: 'blue', change: '+2 이번 달' },
    { label: '활성 계정', value: stats?.activeTeachers || 0, icon: '✅', color: 'green', change: '98.5% 활성' },
    { label: '부서 수', value: stats?.totalDepartments || 0, icon: '🏢', color: 'purple', change: '교무실, 행정실 등' },
    { label: '실시간 접속', value: stats?.onlineClients || 0, icon: '🟢', color: 'orange', change: '현재 온라인' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600">대시보드 로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-black text-2xl text-slate-900">대시보드</h1>
          <p className="text-slate-500 mt-1">브리즈서버 관리 현황을 한눈에 확인하세요.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
            서버 정상 동작 중
          </span>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{card.label}</p>
                <p className="mt-2 font-black text-3xl text-slate-900">{card.value}</p>
                <p className="mt-1 text-xs text-slate-400">{card.change}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl bg-${card.color}-100 flex items-center justify-center text-2xl`} aria-hidden="true">
                {card.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 최근 활동 & 빠른 메뉴 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 최근 중요 감사 로그 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-bold text-lg text-slate-900">최근 중요 활동 (감사 로그)</h2>
            <a href="/audit" className="text-sm text-blue-600 hover:text-blue-700 font-medium">전체 보기</a>
          </div>
          <div className="divide-y divide-slate-100">
            {recentActivities.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <p className="text-lg">📋</p>
                <p className="mt-2">최근 중요 활동이 없습니다.</p>
              </div>
            ) : (
              recentActivities.map((activity) => (
                <div key={activity.id} className="p-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                      activity.riskLevel === 'critical' ? 'bg-red-100 text-red-600' :
                      activity.riskLevel === 'high' ? 'bg-orange-100 text-orange-600' :
                      'bg-yellow-100 text-yellow-600'
                    }`}>
                      {activity.riskLevel === 'critical' ? '🔴' : activity.riskLevel === 'high' ? '🟠' : '🟡'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900">{activity.action.replace(/_/g, ' ')}</p>
                      <p className="text-sm text-slate-500">{activity.targetName} · {activity.adminName}</p>
                      <p className="text-xs text-slate-400 mt-1">{new Date(activity.createdAt).toLocaleString('ko-KR')}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      activity.riskLevel === 'critical' ? 'bg-red-100 text-red-700' :
                      activity.riskLevel === 'high' ? 'bg-orange-100 text-orange-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {activity.riskLevel}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 빠른 메뉴 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h2 className="font-bold text-lg text-slate-900 mb-4">빠른 메뉴</h2>
          <div className="space-y-2">
            <button
              onClick={() => window.location.href = '/teachers'}
              className="w-full p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all text-left flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-lg">👥</div>
              <div>
                <p className="font-semibold text-slate-900">교직원 관리</p>
                <p className="text-sm text-slate-500">계정 생성, 수정, 부서 배치</p>
              </div>
            </button>
            <button
              onClick={() => window.location.href = '/departments'}
              className="w-full p-4 rounded-xl border border-slate-200 hover:border-purple-300 hover:bg-purple-50 transition-all text-left flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center text-lg">🏢</div>
              <div>
                <p className="font-semibold text-slate-900">부서 관리</p>
                <p className="text-sm text-slate-500">부서 생성, 수정, 정렬</p>
              </div>
            </button>
            <button
              onClick={() => window.location.href = '/updates'}
              className="w-full p-4 rounded-xl border border-slate-200 hover:border-orange-300 hover:bg-orange-50 transition-all text-left flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center text-lg">🚀</div>
              <div>
                <p className="font-semibold text-slate-900">OTA 업데이트 배포</p>
                <p className="text-sm text-slate-500">클라이언트 업데이트 푸시</p>
              </div>
            </button>
            <button
              onClick={() => window.location.href = '/audit'}
              className="w-full p-4 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50 transition-all text-left flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center text-lg">📋</div>
              <div>
                <p className="font-semibold text-slate-900">감사 로그 조회</p>
                <p className="text-sm text-slate-500">관리자 작업 이력 확인</p>
              </div>
            </button>
            <button
              onClick={() => window.location.href = '/settings'}
              className="w-full p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all text-left flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-lg">⚙️</div>
              <div>
                <p className="font-semibold text-slate-900">학교 설정</p>
                <p className="text-sm text-slate-500">학교 정보, 업데이트 설정</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* 시스템 정보 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="font-bold text-lg text-slate-900 mb-4">시스템 정보</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div className="p-3 rounded-xl bg-slate-50">
            <p className="text-slate-500">Node.js 버전</p>
            <p className="font-semibold text-slate-900">{process.versions.node}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50">
            <p className="text-slate-500">Electron 버전</p>
            <p className="font-semibold text-slate-900">{process.versions.electron}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50">
            <p className="text-slate-500">Chrome 버전</p>
            <p className="font-semibold text-slate-900">{process.versions.chrome}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50">
            <p className="text-slate-500">업타임</p>
            <p className="font-semibold text-slate-900">{Math.floor(process.uptime() / 3600)}시간 {Math.floor((process.uptime() % 3600) / 60)}분</p>
          </div>
        </div>
      </div>
    </div>
  );
}