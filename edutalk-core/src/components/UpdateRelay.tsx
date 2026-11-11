// 교내 업데이트 중계 — 인터넷이 되는 PC 한 대가 새 설치본을 받아 학교 서버에 올리고,
// 인터넷이 없는 PC도 교내망으로 업데이트를 받을 수 있게 한다.
// 여러 PC가 동시에 동의 팝업을 띄우지 않도록 서버에서 10분짜리 임차권을 먼저 받는다.
import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../lib/version";
import {
  checkUpdate,
  checkUpdateFeed,
  claimUpdateRelay,
  compareVersions,
  installUpdate,
  releaseUpdateRelay,
  relayUpdate,
} from "../services/update";
import type { FeedInfo, UpdateInfo } from "../services/update";

type Phase = "idle" | "consent" | "working" | "done" | "error";
type Step = "download" | "upload" | "install";

const FEED_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_DELAY_MS = 15 * 1000;

export default function UpdateRelay({
  enabled,
  base,
  onRelayed,
}: {
  enabled: boolean;
  base: string | null;
  onRelayed?: (info: UpdateInfo) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [feed, setFeed] = useState<FeedInfo | null>(null);
  const [step, setStep] = useState<Step>("download");
  const [pct, setPct] = useState(0);
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [relayed, setRelayed] = useState(false);
  const [closing, setClosing] = useState(false);

  const phaseRef = useRef<Phase>("idle");
  const busyRef = useRef(false);
  phaseRef.current = phase;

  // 인터넷이 되는 PC만 공개 피드를 확인한다. 서버에 이미 같은 버전이 있으면 조용히 넘어간다.
  useEffect(() => {
    if (!enabled || !base) return;
    let stop = false;
    const run = async () => {
      if (stop || busyRef.current || phaseRef.current !== "idle") return;
      try {
        const found = await checkUpdateFeed();
        if (stop || !found) return;
        if (compareVersions(found.version, APP_VERSION) < 0) return;
        const onServer = await checkUpdate(base);
        if (stop) return;
        if (onServer && compareVersions(onServer.version, found.version) >= 0) return;
        const claimed = await claimUpdateRelay(found.version);
        if (stop || !claimed) return;
        setFeed(found);
        setExpanded(false);
        setMessage("");
        setRelayed(false);
        setPhase("consent");
      } catch {
        /* 인터넷이 없거나 서버가 잠시 응답하지 않음 — 다음 주기에 다시 확인한다 */
      }
    };
    const first = setTimeout(run, FIRST_DELAY_MS);
    const timer = setInterval(run, FEED_INTERVAL_MS);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, base]);

  const needsSelfInstall = !!feed && compareVersions(feed.version, APP_VERSION) > 0;

  const start = async () => {
    if (!feed || busyRef.current) return;
    busyRef.current = true;
    setPhase("working");
    setStep("download");
    setPct(0);
    setMessage("");
    try {
      const res = await relayUpdate(feed, (p) => {
        if (p.phase === "download") {
          setStep("download");
          if (p.total > 0) setPct(Math.min(99, Math.round((p.received / p.total) * 100)));
        } else if (p.phase === "upload") {
          setStep("upload");
          setPct(-1);
        }
      });
      setRelayed(true);
      setPct(100);
      onRelayed?.(res.update);
      if (!needsSelfInstall) {
        setPhase("done");
        return;
      }
      setStep("install");
      setPct(-1);
      await new Promise((r) => setTimeout(r, 1200));
      await installUpdate(res.installer);
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "업데이트를 마치지 못했어요.");
    } finally {
      busyRef.current = false;
    }
  };

  const close = async () => {
    if (closing) return;
    setClosing(true);
    if (feed && !relayed) await releaseUpdateRelay(feed.version);
    window.setTimeout(() => {
      setPhase("idle");
      setFeed(null);
      setExpanded(false);
      setMessage("");
      setClosing(false);
    }, 170);
  };

  if (phase === "idle" || !feed) return null;

  return (
    <div className={`bz-overlay show${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-hidden={closing || undefined} aria-labelledby="bzRelayTitle">
      <div className="bz-modal bz-relay">
        {phase === "consent" && (
          <>
            <div className="bz-relay-kicker">
              <span className={`bz-relay-badge${feed.security ? " sec" : ""}`}>
                {feed.security ? "긴급 보안 업데이트" : "새 업데이트"}
              </span>
              <span className="bz-relay-ver">v{feed.version}</span>
            </div>
            <h2 id="bzRelayTitle" className="bz-relay-title">
              이 컴퓨터의 인터넷으로
              <br />
              학교 전체를 업데이트할까요?
            </h2>
            <p className="bz-relay-lead">
              이 컴퓨터의 인터넷을 활용하여 학교 브리즈 전체를 업데이트하려고 해요. 업데이트를
              해도 될까요?
            </p>

            <div className="bz-relay-flow" aria-hidden="true">
              <div className="bz-relay-node">
                <span className="ico">💻</span>
                <b>이 컴퓨터</b>
                <small>인터넷으로 받기</small>
              </div>
              <span className="bz-relay-arrow">→</span>
              <div className="bz-relay-node">
                <span className="ico">🏫</span>
                <b>학교 서버</b>
                <small>교내망에 배포</small>
              </div>
              <span className="bz-relay-arrow">→</span>
              <div className="bz-relay-node">
                <span className="ico">👩‍🏫</span>
                <b>모든 PC</b>
                <small>각자 설치</small>
              </div>
            </div>

            <div className="bz-relay-warn">
              <b>데이터를 사용 중이라면 요금이 부과될 수 있어요.</b>
              <span>Wi-Fi를 쓰신다면 보통 추가 요금은 없어요.</span>
            </div>

            <button
              type="button"
              className={`bz-relay-more${expanded ? " open" : ""}`}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              이게 무슨 말인가요?
              <span className="chev">⌄</span>
            </button>
            {expanded && (
              <div className="bz-relay-explain">
                이 컴퓨터를 통해 교내 서버 PC와 다른 사용자들의 PC도 함께 업데이트를 시키는
                거예요. 다른 사용자들이 인터넷에 연결되어 있지 않더라도 선생님의 PC 인터넷을
                빌려서 업데이트를 할 수 있어요.
                <br />
                <br />
                긴급 보안 업데이트이기에 최대한 빠른 업데이트가 중요해서 이러한 방식으로라도
                업데이트를 진행시키고 있어요. 양해를 부탁드려요.
              </div>
            )}

            <div className="bz-relay-actions">
              <button type="button" className="bz-btn-ghost" onClick={() => void close()}>
                거절
              </button>
              <button type="button" className="bz-btn" onClick={() => void start()}>
                확인
              </button>
            </div>
            <p className="bz-relay-foot">확인을 누르면 바로 시작해요. 잠시만 기다려 주세요.</p>
          </>
        )}

        {phase === "working" && (
          <>
            <div className="bz-relay-kicker">
              <span className={`bz-relay-badge${feed.security ? " sec" : ""}`}>
                {feed.security ? "긴급 보안 업데이트" : "새 업데이트"}
              </span>
              <span className="bz-relay-ver">v{feed.version}</span>
            </div>
            <h2 id="bzRelayTitle" className="bz-relay-title">
              새 업데이트를 학교에
              <br />
              나눠 주고 있어요
            </h2>
            <p className="bz-relay-lead">창을 닫지 말고 잠시만 기다려 주세요.</p>

            <ol className="bz-relay-steps">
              <li className={step === "download" ? "now" : "done"}>
                <span className="dot">{step === "download" ? "●" : "✓"}</span>
                <div>
                  <b>새 업데이트를 내려받는 중…</b>
                  <small>인터넷에서 설치 파일을 받아요.</small>
                </div>
                {step === "download" && pct >= 0 && <span className="pct">{pct}%</span>}
              </li>
              <li className={step === "upload" ? "now" : step === "install" ? "done" : ""}>
                <span className="dot">{step === "upload" ? "●" : step === "install" ? "✓" : "○"}</span>
                <div>
                  <b>새 업데이트를 교내에 배포하는 중…</b>
                  <small>학교 안 모든 PC가 받을 수 있게 서버에 올려요.</small>
                </div>
              </li>
              <li className={step === "install" ? "now" : ""}>
                <span className="dot">{step === "install" ? "●" : "○"}</span>
                <div>
                  <b>새 업데이트를 이 PC에 설치하는 중…</b>
                  <small>설치가 끝나면 브리즈가 스스로 다시 열려요.</small>
                </div>
              </li>
            </ol>

            <div className={`bz-relay-bar${pct < 0 ? " indet" : ""}`}>
              <i style={pct >= 0 ? { width: `${Math.max(3, pct)}%` } : undefined} />
            </div>
            <p className="bz-relay-foot">
              {step === "download" && "인터넷에서 새 업데이트를 받고 있어요."}
              {step === "upload" && "학교 서버로 보내는 중이에요. 잠시만 기다려 주세요."}
              {step === "install" && "설치를 시작해요. 브리즈가 잠시 뒤 다시 열려요."}
            </p>
          </>
        )}

        {phase === "done" && (
          <>
            <div className="bz-relay-done-ico">✓</div>
            <h2 id="bzRelayTitle" className="bz-relay-title">
              학교 전체에 업데이트를
              <br />
              준비했어요
            </h2>
            <p className="bz-relay-lead">
              이 PC는 이미 최신 버전이에요. 다른 선생님 PC에도 새 업데이트 안내가 표시돼요.
            </p>
            <div className="bz-relay-actions">
              <button type="button" className="bz-btn" onClick={() => void close()}>
                확인
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="bz-relay-done-ico err">!</div>
            <h2 id="bzRelayTitle" className="bz-relay-title">
              업데이트를 마치지
              <br />
              못했어요
            </h2>
            <p className="bz-relay-lead">{message}</p>
            <div className="bz-relay-explain">
              인터넷 연결을 확인한 뒤 다시 시도해 주세요. 이미 배포가 끝났다면 다른 PC는 교내망으로
              업데이트를 받을 수 있어요.
            </div>
            <div className="bz-relay-actions">
              <button type="button" className="bz-btn-ghost" onClick={() => void close()}>
                닫기
              </button>
              <button type="button" className="bz-btn" onClick={() => void start()}>
                다시 시도
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
