// 서버 주도 자동 업데이트 안내 — 새 설치본이 올라오면 화면 아래에서 조용히 알린다.
// [지금 업데이트] → 내려받기(진행률) → 조용히 설치 → 앱이 스스로 다시 열린다.
import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../lib/version";
import { storeGet, storeSet } from "../lib/localStore";
import { checkUpdate, compareVersions, downloadUpdate, installUpdate } from "../services/update";
import type { UpdateInfo } from "../services/update";

type Phase = "idle" | "available" | "downloading" | "ready" | "error";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;

export default function UpdateToast({ enabled, base }: { enabled: boolean; base: string | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled || !base) return;
    let stop = false;
    const run = async () => {
      if (busy.current || stop) return;
      try {
        const found = await checkUpdate(base);
        if (stop || !found) return;
        if (compareVersions(found.version, APP_VERSION) <= 0) return;
        const dismissed = await storeGet<string>("update-dismissed");
        if (!found.mandatory && dismissed === found.version) return;
        setInfo(found);
        setPhase((p) => (p === "idle" ? "available" : p));
      } catch {
        /* 서버 미지원/오프라인 — 조용히 지나간다 */
      }
    };
    const first = setTimeout(run, 5000);
    const timer = setInterval(run, CHECK_INTERVAL_MS);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, base]);

  const startUpdate = async () => {
    if (!info || !base || busy.current) return;
    busy.current = true;
    setPhase("downloading");
    setProgress(0);
    try {
      const path = await downloadUpdate(base, info, (r) => setProgress(r));
      setPhase("ready");
      setMessage("설치를 시작해요. 잠시 뒤 브리즈가 스스로 다시 열려요.");
      setTimeout(() => {
        void installUpdate(path).catch((e) => {
          busy.current = false;
          setPhase("error");
          setMessage(e instanceof Error ? e.message : "설치를 시작하지 못했어요.");
        });
      }, 1400);
    } catch (e) {
      busy.current = false;
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "업데이트에 실패했어요.");
    }
  };

  const dismiss = async () => {
    if (info && !info.mandatory) await storeSet("update-dismissed", info.version);
    setPhase("idle");
  };

  if (phase === "idle" || !info) return null;

  const pct = progress >= 0 ? Math.round(progress * 100) : -1;

  return (
    <div className="bz-update" role="status">
      <div className="bz-update-head">
        <span>새 버전 v{info.version}</span>
        {info.mandatory ? (
          <span className="bz-update-badge must">필수 업데이트</span>
        ) : (
          <span className="bz-update-badge">업데이트 있음</span>
        )}
        <span className="bz-grow" />
        {phase === "downloading" && pct >= 0 && <span className="bz-update-pct">{pct}%</span>}
      </div>
      {info.notes && <div className="bz-update-notes">{info.notes}</div>}
      {phase === "downloading" && (
        <>
          <div className="bz-update-bar">
            <i style={{ width: pct >= 0 ? `${pct}%` : "35%" }} />
          </div>
          <div className="bz-update-notes">설치 파일을 내려받는 중이에요…</div>
        </>
      )}
      {(phase === "ready" || (phase === "error" && message)) && (
        <div className={phase === "error" ? "bz-update-notes err" : "bz-update-notes"}>
          {message}
        </div>
      )}
      <div className="bz-update-actions">
        {phase === "available" && (
          <>
            {!info.mandatory && (
              <button className="bz-btn-soft" onClick={() => void dismiss()}>
                나중에
              </button>
            )}
            <button className="bz-btn" onClick={() => void startUpdate()}>
              지금 업데이트
            </button>
          </>
        )}
        {phase === "downloading" && <button className="bz-btn-soft" disabled>내려받는 중…</button>}
        {phase === "error" && (
          <>
            <button className="bz-btn-soft" onClick={() => void dismiss()}>
              닫기
            </button>
            <button className="bz-btn" onClick={() => void startUpdate()}>
              다시 시도
            </button>
          </>
        )}
      </div>
    </div>
  );
}
