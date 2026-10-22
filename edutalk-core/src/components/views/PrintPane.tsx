import { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api";
import type { PrintJobData } from "../../types/api";
import { openPrintWindow, printServerReachable, resetPrintServerCache, usePrintLocal } from "../../lib/printQueue";
import BzTooltip from "../ui/BzTooltip";
import { bzConfirm } from "../ui/BzDialog";

interface Props {
  /** 이 PC를 쓰는 교사 이름 (대기열에 소유자로 표시) */
  meName: string;
  onToast: (t: string) => void;
}

const CONTENT_MAX = 200 * 1024;

// 보안 인쇄 — 문서는 바로 종이로 나가지 않고 대기열에 보관된다.
//  인쇄실/공용 PC에서 [출력]을 눌러야 실제 인쇄가 시작된다 (시험지·성적표 유출 차단).
export default function PrintPane(p: Props) {
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PrintJobData[]>([]);
  const [recent, setRecent] = useState<PrintJobData[]>([]);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const localJobs = usePrintLocal((s) => s.jobs);
  const addLocal = usePrintLocal((s) => s.add);
  const markLocal = usePrintLocal((s) => s.mark);
  const clearDone = usePrintLocal((s) => s.clearDone);

  const localPending = localJobs.filter((j) => j.status === "PENDING");
  const localDone = localJobs.filter((j) => j.status !== "PENDING").slice(-5).reverse();

  const refresh = useCallback(async () => {
    const ok = await printServerReachable();
    setServerOk(ok);
    if (!ok) return;
    try {
      const r = await api.listPrintJobs();
      if (r.ok && r.data?.ok) {
        setPending(r.data.pending);
        setRecent(r.data.recent);
      }
    } catch {
      /* 목록 실패는 다음 새로고침에서 */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (!content.trim()) {
      p.onToast("인쇄할 내용을 적어 주세요.");
      return;
    }
    if (new Blob([content]).size > CONTENT_MAX) {
      p.onToast("한 번에 보낼 수 있는 양(200KB)을 넘었어요. 문서를 나눠 보내 주세요.");
      return;
    }
    setBusy(true);
    try {
      if (serverOk) {
        const r = await api.submitPrintJob(title, content);
        if (!r.ok || !r.data?.ok) throw new Error(r.error || "대기열에 넣지 못했어요.");
        p.onToast("🖨️ 대기열에 넣었어요. 공용 PC에서 [출력]을 눌러야 인쇄돼요.");
        await refresh();
      } else {
        addLocal(title, content, p.meName);
        p.onToast("🖨️ 이 PC 대기열에 넣었어요. [출력]을 누르면 인쇄돼요.");
      }
      setTitle("");
      setContent("");
    } catch (e) {
      p.onToast(e instanceof Error ? e.message : "인쇄 요청에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const release = async (job: PrintJobData) => {
    setBusy(true);
    try {
      const r = await api.releasePrintJob(job.id);
      if (!r.ok || !r.data?.ok || !r.data.job) throw new Error(r.error || "출력 처리에 실패했어요.");
      const ok = openPrintWindow(r.data.job.title, r.data.job.content || "");
      p.onToast(ok ? `🖨️ ${r.data.job.title} 인쇄를 시작했어요.` : "인쇄 창을 열지 못했어요. 다시 시도해 주세요.");
      await refresh();
    } catch (e) {
      p.onToast(e instanceof Error ? e.message : "출력에 실패했어요.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (job: PrintJobData) => {
    const ok = await bzConfirm({
      title: "인쇄를 취소할까요?",
      message: `"${job.title}" 인쇄물을 대기열에서 지워요.`,
      confirmText: "취소하기",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.cancelPrintJob(job.id);
      if (!r.ok || !r.data?.ok) throw new Error(r.error || "취소하지 못했어요.");
      p.onToast("대기열에서 취소했어요.");
      await refresh();
    } catch (e) {
      p.onToast(e instanceof Error ? e.message : "취소에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const releaseLocal = (id: number, jobTitle: string, body: string) => {
    const ok = openPrintWindow(jobTitle, body);
    markLocal(id, "RELEASED", p.meName);
    p.onToast(ok ? `🖨️ ${jobTitle} 인쇄를 시작했어요.` : "인쇄 창을 열지 못했어요.");
  };

  const relLogout = () => {
    resetPrintServerCache();
    void refresh();
    p.onToast("연결 상태를 다시 확인했어요.");
  };

  return (
    <div className="flex flex-col gap-2 anim-list">
      <div className="edu-card p-3 flex items-start gap-2">
        <span className="text-[18px]" aria-hidden>🖨️</span>
        <div className="flex-1 min-w-0 text-[12.5px] text-edu-sub">
          <b className="text-edu-main">보안 인쇄 대기열</b> — 시험지·성적표 같은 문서는 누르자마자 종이로 나가지 않아요.
          대기열에 보관됐다가, 인쇄실·공용 PC의 브리즈 앱에서 <b>[출력]</b>을 누른 순간에만 인쇄돼요.
          <div className="mt-1 text-[11.5px]">
            {serverOk === null && "연결 확인 중…"}
            {serverOk === true && "🏫 학교 서버 연결됨 — 교내 어느 PC에서든 같은 대기열을 보고 출력할 수 있어요."}
            {serverOk === false && "📴 서버 미연결 — 이 PC 안의 대기열로 동작해요 (데모/단독 환경)."}
            {serverOk === false && (
              <button className="ml-1 underline" onClick={relLogout}>다시 확인</button>
            )}
          </div>
        </div>
      </div>

      <div className="edu-card p-3 flex flex-col gap-1.5">
        <div className="text-[12.5px] font-bold">인쇄 보내기</div>
        <input
          className="edu-input !py-2 !text-[13px]"
          placeholder="문서 제목 (예: 2학기 지필평가 시험지)"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="edu-input min-h-[150px] !text-[13px]"
          placeholder={"인쇄할 내용을 붙여넣으세요. (일반 텍스트 · 최대 200KB)\n개인정보가 들어 있으면 대기열에서 승인된 PC로만 출력돼요."}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <button className="edu-btn !py-2" disabled={busy} onClick={() => void submit()}>대기열에 넣기</button>
          <button className="edu-ghost !py-2" disabled={busy} onClick={() => { setTitle(""); setContent(""); }}>비우기</button>
          <span className="ml-auto text-[11px] text-edu-muted">{new Blob([content]).size > 0 ? `${(new Blob([content]).size / 1024).toFixed(1)}KB` : ""}</span>
        </div>
      </div>

      <div className="edu-card overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-edu-bg font-bold text-[13px]">
          <span>대기열 {serverOk === null ? "…" : serverOk ? pending.length : localPending.length}건</span>
          <span className="ml-auto flex items-center gap-1">
            <BzTooltip content="대기열 새로고침" position="bottom">
              <button className="edu-ghost !py-1 !px-2 !text-[12px]" disabled={busy} onClick={() => void refresh()}>↻ 새로고침</button>
            </BzTooltip>
            {serverOk === false && localDone.length > 0 && (
              <button className="edu-ghost !py-1 !px-2 !text-[12px]" onClick={clearDone}>완료 정리</button>
            )}
          </span>
        </div>
        <div className="bg-white divide-y divide-edu-line">
          {serverOk === null && (
            <div className="px-3 py-4 space-y-2" aria-label="대기열 확인 중">
              <div className="skeleton h-4 w-2/5" />
              <div className="skeleton h-3 w-3/5" />
            </div>
          )}
          {serverOk && pending.length === 0 && (
            <div className="text-[12.5px] text-edu-sub px-3 py-6 text-center">대기 중인 인쇄물이 없어요. 이 PC가 공용 PC라면 지금 바로 승인할 수 있어요.</div>
          )}
          {serverOk && pending.map((j) => (
            <div key={j.id} className="flex items-center gap-2 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">📄 {j.title}</div>
                <div className="text-[11.5px] text-edu-sub">
                  {j.ownerName || "교사"} · {j.createdAt} · {(j.bytes / 1024).toFixed(1)}KB
                </div>
              </div>
              <button className="edu-btn !py-1.5 !px-3 !text-[12px] shrink-0" disabled={busy} onClick={() => void release(j)}>🖨️ 출력</button>
              <button className="edu-ghost !py-1.5 !px-2.5 !text-[12px] shrink-0" disabled={busy} onClick={() => void cancel(j)}>취소</button>
            </div>
          ))}
          {serverOk === false && localPending.length === 0 && (
            <div className="text-[12.5px] text-edu-sub px-3 py-6 text-center">대기 중인 인쇄물이 없어요.</div>
          )}
          {serverOk === false && localPending.map((j) => (
            <div key={j.id} className="flex items-center gap-2 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">📄 {j.title}</div>
                <div className="text-[11.5px] text-edu-sub">
                  {j.ownerName} · {j.createdAt.slice(0, 16).replace("T", " ")} · {(new Blob([j.content]).size / 1024).toFixed(1)}KB
                </div>
              </div>
              <button className="edu-btn !py-1.5 !px-3 !text-[12px] shrink-0" onClick={() => releaseLocal(j.id, j.title, j.content)}>🖨️ 출력</button>
              <button className="edu-ghost !py-1.5 !px-2.5 !text-[12px] shrink-0" onClick={() => markLocal(j.id, "CANCELLED", p.meName)}>취소</button>
            </div>
          ))}
        </div>
      </div>

      {serverOk && recent.length > 0 && (
        <div className="edu-card p-3">
          <div className="text-[12px] font-bold text-edu-sub mb-1">최근 처리 (누가 언제 승인했는지 남아요)</div>
          <div className="flex flex-col gap-0.5">
            {recent.slice(0, 5).map((j) => (
              <div key={j.id} className="text-[11.5px] text-edu-sub flex items-center gap-1.5">
                <span>{j.status === "RELEASED" ? "✅" : "🚫"}</span>
                <span className="truncate flex-1">{j.title}</span>
                <span>{j.releasedBy || "-"} · {j.releasedAt || ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
