import { useMemo } from "react";
import type { Teacher, AdminNotice, AdminAuditLog, TimetableTemplate, GradeClass, School } from "../../types";
import { isPresentStatus } from "../../lib/status";

interface Props {
  teachers: Teacher[];
  notices: AdminNotice[];
  audits: AdminAuditLog[];
  templates: TimetableTemplate[];
  gradeClasses: GradeClass[];
  school: School | null;
  onToast: (t: string) => void;
}

export default function AdminDashboard(p: Props) {
  const stats = useMemo(() => {
    const totalTeachers = p.teachers.length;
    const onlineTeachers = p.teachers.filter(t => isPresentStatus(t.status)).length;
    const totalNotices = p.notices.length;
    const publishedNotices = p.notices.filter(n => n.publishedAt).length;
    const pendingNotices = totalNotices - publishedNotices;
    const totalTemplates = p.templates.length;
    const publishedTemplates = p.templates.filter(t => t.isPublished).length;
    const totalClasses = p.gradeClasses.length;
    const classesWithHomeroom = p.gradeClasses.filter(c => c.homeroomTeacherId).length;

    return {
      totalTeachers,
      onlineTeachers,
      totalNotices,
      publishedNotices,
      pendingNotices,
      totalTemplates,
      publishedTemplates,
      totalClasses,
      classesWithHomeroom,
    };
  }, [p.teachers, p.notices, p.templates, p.gradeClasses]);

  const recentNotices = useMemo(() => 
    [...p.notices].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5),
    [p.notices]
  );

  const recentAudits = useMemo(() =>
    [...p.audits].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5),
    [p.audits]
  );

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth()+1}.${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  return (
    <div className="anim-page space-y-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-edu-strong">관리자 대시보드</h1>
        <span className="text-sm text-edu-sub">{p.school?.name || "학교 미설정"}</span>
      </div>

      <div className="anim-list grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="전체 교사" value={stats.totalTeachers} subtitle={`${stats.onlineTeachers}명 온라인`} icon="👥" color="#0082C8" />
        <StatCard title="공지사항" value={stats.totalNotices} subtitle={`${stats.publishedNotices}개 게시 / ${stats.pendingNotices}개 대기`} icon="📢" color="#16A34A" />
        <StatCard title="시간표 템플릿" value={stats.totalTemplates} subtitle={`${stats.publishedTemplates}개 배포됨`} icon="📚" color="#F59E0B" />
        <StatCard title="학급 현황" value={stats.totalClasses} subtitle={`${stats.classesWithHomeroom}개 담임 배정`} icon="🏫" color="#8B5CF6" />
      </div>

      <div className="anim-list grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="anim-card edu-card p-4">
          <h2 className="font-bold text-lg mb-3 flex items-center gap-2">📋 최근 공지사항</h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {recentNotices.length === 0 ? (
              <p className="text-edu-sub text-sm text-center py-4">등록된 공지사항이 없어요.</p>
            ) : (
              recentNotices.map(n => (
                <div key={n.id} className="anim-card edu-chip p-3 rounded-lg border border-edu-line hover:bg-edu-soft transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm truncate">{n.title}</div>
                      <div className="text-xs text-edu-sub mt-0.5">{n.body.slice(0, 60)}...</div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-edu-muted">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          n.level === "urgent" ? "bg-[#FFF0F1] text-[#B42318]" :
                          n.level === "info" ? "bg-[#E8F4FB] text-[#0069A8]" :
                          "bg-[#F0F4F8] text-[#475467]"
                        }`}>
                          {n.level === "urgent" ? "긴급" : n.level === "info" ? "알림" : "일반"}
                        </span>
                        <span>{n.publishedAt ? "게시됨" : "대기중"}</span>
                        <span>{formatDate(n.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="anim-card edu-card p-4">
          <h2 className="font-bold text-lg mb-3 flex items-center gap-2">🛡️ 최근 감사 로그</h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {recentAudits.length === 0 ? (
              <p className="text-edu-sub text-sm text-center py-4">감사 로그가 없어요.</p>
            ) : (
              recentAudits.map(a => (
                <div key={a.id} className="anim-card edu-chip p-3 rounded-lg border border-edu-line hover:bg-edu-soft transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm truncate">{a.action} · {a.targetType}</div>
                      <div className="text-xs text-edu-sub mt-0.5">{a.detail.slice(0, 60)}...</div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-edu-muted">
                        <span>{a.adminName}</span>
                        <span>{formatDate(a.createdAt)}</span>
                        {a.blocked && <span className="text-[#E5484D] font-bold">차단됨</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="anim-card edu-card p-4">
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2">⚡ 빠른 작업</h2>
        <div className="anim-list grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickActionBtn icon="➕" title="공지 작성" desc="새 공지사항 만들기" onClick={() => p.onToast("공지 작성 페이지로 이동")} />
          <QuickActionBtn icon="👥" title="교사 초대" desc="새 교사 계정 생성" onClick={() => p.onToast("교사 관리 페이지로 이동")} />
          <QuickActionBtn icon="📚" title="시간표 배포" desc="템플릿 선택 후 배포" onClick={() => p.onToast("시간표 관리 페이지로 이동")} />
          <QuickActionBtn icon="📊" title="통계 보기" desc="사용 현황 리포트" onClick={() => p.onToast("통계 페이지로 이동")} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, color }: { title: string; value: number; subtitle: string; icon: string; color: string }) {
  return (
    <div className="anim-card edu-card p-4 border-l-4" style={{ borderColor: color }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-edu-sub text-sm">{title}</div>
          <div className="mt-1 text-3xl font-extrabold text-edu-strong">{value}</div>
          <div className="mt-0.5 text-xs text-edu-muted">{subtitle}</div>
        </div>
        <div className="text-3xl">{icon}</div>
      </div>
    </div>
  );
}

function QuickActionBtn({ icon, title, desc, onClick }: { icon: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="anim-card edu-card p-4 text-left hover:bg-edu-soft border border-edu-line transition-colors group">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="font-bold text-sm text-edu-strong">{title}</div>
      <div className="text-xs text-edu-sub mt-0.5">{desc}</div>
    </button>
  );
}