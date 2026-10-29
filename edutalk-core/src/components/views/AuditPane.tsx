import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditLog } from "../../types";
import { storageClearTemp, storageStats, storageVacuum } from "../../lib/repo";
import type { StorageStats } from "../../lib/tauri";

function loadFeedback(): { body: string; at: string }[] {
  try {
    const raw = localStorage.getItem("edutalk-feedback");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.body === "string") : [];
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

interface Props {
  logs: AuditLog[];
  onReport: () => void;
  onToast: (t: string) => void;
}

export default function AuditPane(p: Props) {
  const [filter, setFilter] = useState<"all" | AuditLog["kind"]>("all");
  const [showFb, setShowFb] = useState(false);
  const feedbacks = useMemo(loadFeedback, [showFb]);
  const rows = p.logs.filter((l) => (filter === "all" ? true : l.kind === filter));

  const [stats, setStats] = useState<StorageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "clear" | "vacuum">("");

  const refreshStats = useCallback(async () => {
    setStatsLoading(true);
    const next = await storageStats();
    setStats(next);
    setStatsLoading(false);
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const clearTemp = async () => {
    if (busy) return;
    setBusy("clear");
    const r = await storageClearTemp();
    setBusy("");
    if (!r) {
      p.onToast("설치판에서만 임시 파일을 비울 수 있어요.");
      return;
    }
    setStats(r.stats);
    p.onToast(
      r.freedBytes > 0
        ? `임시 파일을 비웠어요. ${formatBytes(r.freedBytes)}를 줄였어요.`
        : "비울 임시 파일이 없어요."
    );
  };

  const vacuumDb = async () => {
    if (busy) return;
    setBusy("vacuum");
    const r = await storageVacuum();
    setBusy("");
    if (!r) {
      p.onToast("설치판에서만 DB를 정리할 수 있어요.");
      return;
    }
    setStats(r.stats);
    p.onToast(
      r.freed_bytes > 0
        ? `DB 정리를 마쳤어요. ${formatBytes(r.freed_bytes)}를 줄였어요.`
        : "DB 정리를 마쳤어요. 줄일 빈 공간이 없었어요."
    );
  };

  const diskPct = stats && stats.disk_total_bytes > 0
    ? Math.min(100, Math.round((stats.disk_used_bytes / stats.disk_total_bytes) * 100))
    : 0;
  const cachePct = stats && stats.cache_quota_bytes > 0
    ? Math.min(100, Math.round((stats.cache_bytes / stats.cache_quota_bytes) * 100))
    : 0;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <div className="edu-card p-3.5 anim-card">
        <div className="font-extrabold text-[15px]">보안·감사 로그 ({rows.length})</div>
        <div className="text-[12.5px] text-edu-sub">보내기 전 기기 내 DLP가 주민번호·전화번호·성적표현을 잡아내요.</div>
        <div className="edu-filterbar mt-2 flex gap-1.5 flex-wrap">
          {(["all", "RRN", "PHONE", "SCORE", "HWP"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold ${filter === f ? "bg-edu-soft text-edu-strong" : "bg-edu-chip text-edu-sub"}`}
            >
              {f === "all" ? "전체" : f}
            </button>
          ))}
          <button className="edu-ghost !py-1.5 !text-[12px] ml-auto" onClick={p.onReport}>📄 준수 리포트 생성</button>
        </div>
        <div className="mt-2 flex flex-col gap-1.5 max-h-[440px] overflow-y-auto">
          {rows.map((l) => (
            <div key={l.id} className="border border-edu-line rounded-xl px-2.5 py-2 text-[12.5px]">
              <div className="flex items-center gap-1.5">
                <span className={`font-extrabold px-1.5 py-0.5 rounded-lg text-[11px] ${l.blocked ? "bg-[#FDE8E8] text-[#D92D20]" : "bg-edu-chip text-edu-sub"}`}>
                  {l.kind} {l.blocked ? "차단" : "경고"}
                </span>
                <span className="text-edu-sub ml-auto">{l.createdAt}</span>
              </div>
              <div className="mt-1 font-medium">{l.text}</div>
              <div className="text-[11.5px] text-edu-muted mt-0.5">규칙 {l.ruleId} · 점수 {l.score.toFixed(2)}</div>
            </div>
          ))}
          {rows.length === 0 && <div className="text-center text-edu-sub text-[13px] py-8">기록이 없어요.</div>}
        </div>
      </div>
      <div className="edu-card p-3.5 anim-card h-fit">
        <div className="flex items-center gap-2">
          <div className="font-extrabold text-[15px]">저장소 정리</div>
          <button className="ml-auto text-[11.5px] font-bold text-edu-strong hover:underline" onClick={() => void refreshStats()} disabled={statsLoading}>
            {statsLoading ? "확인 중…" : "새로고침"}
          </button>
        </div>
        <div className="mt-1 text-[12.5px] text-edu-sub">이 PC에 실제로 저장된 크기예요.</div>

        {stats ? (
          <>
            <div className="mt-3 flex items-end justify-between gap-2">
              <div>
                <div className="text-[12.5px] font-bold">로컬 DB</div>
                <div className="text-[11px] text-edu-muted">breeze.db · WAL {formatBytes(stats.wal_bytes)}</div>
              </div>
              <div className="text-[14px] font-extrabold text-edu-ink">{formatBytes(stats.db_total_bytes)}</div>
            </div>

            <div className="mt-3">
              <div className="flex justify-between text-[11.5px] text-edu-sub">
                <span className="font-bold">디스크 사용</span>
                <span>{formatBytes(stats.disk_used_bytes)} / {formatBytes(stats.disk_total_bytes)}</span>
              </div>
              <div className="mt-1 h-2.5 rounded-full bg-edu-chip overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${diskPct}%`, background: "linear-gradient(90deg,#0082C8,#0069A8)" }} />
              </div>
            </div>

            <div className="mt-2.5">
              <div className="flex justify-between text-[11.5px] text-edu-sub">
                <span className="font-bold">임시 파일</span>
                <span>{formatBytes(stats.cache_bytes)} / {formatBytes(stats.cache_quota_bytes)}</span>
              </div>
              <div className="mt-1 h-2.5 rounded-full bg-edu-chip overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${cachePct}%`, background: "linear-gradient(90deg,#0EA5E9,#0082C8)" }} />
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <button className="edu-ghost flex-1 !py-2 !text-[12px]" onClick={() => void clearTemp()} disabled={busy !== ""}>
                {busy === "clear" ? "비우는 중…" : "임시 파일 비우기"}
              </button>
              <button className="edu-btn flex-1 !py-2 !text-[12px]" onClick={() => void vacuumDb()} disabled={busy !== ""}>
                {busy === "vacuum" ? "정리 중…" : "수동 VACUUM 실행"}
              </button>
            </div>
          </>
        ) : (
          <div className="mt-3 rounded-xl border border-edu-line bg-edu-chip/60 px-3 py-3 text-[12px] leading-relaxed text-edu-sub">
            {statsLoading ? "저장소 정보를 불러오는 중…" : "설치판에서 실제 저장소 크기를 확인할 수 있어요."}
          </div>
        )}
      </div>
      <div className="edu-card p-3.5 anim-card h-fit">
        <div className="font-extrabold text-[15px]">✋ 10월 베타 의견 ({feedbacks.length})</div>
        <div className="text-[12.5px] text-edu-sub">이 PC에 저장된 교사 의견을 모아서 보여줘요.</div>
        <button className="edu-ghost w-full mt-2" onClick={() => setShowFb((v) => !v)}>
          {showFb ? "접기" : "의견 보기"}
        </button>
        {showFb && (
          <div className="mt-2 flex flex-col gap-1.5 max-h-[300px] overflow-y-auto">
            {feedbacks.length === 0 && <div className="text-center text-edu-sub text-[13px] py-4">아직 의견이 없어요.</div>}
            {feedbacks.map((f, i) => (
              <div key={i} className="border border-edu-line rounded-xl px-2.5 py-2 text-[12.5px]">
                <div className="font-medium whitespace-pre-wrap break-words">{f.body}</div>
                <div className="text-[11.5px] text-edu-muted mt-0.5">{f.at}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
