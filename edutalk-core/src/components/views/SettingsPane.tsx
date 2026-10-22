import { useEffect, useState } from "react";
import { useEdu, type LayoutMode, type MotionMode, type WindowMode } from "../../store";
import { FONT_OPTIONS, type FontKind } from "../../lib/fonts";
import { call } from "../../lib/tauri";
import { api, normalizeServerUrl, setApiBaseUrl } from "../../services/api";
import { storeSet } from "../../lib/localStore";
import { APP_VERSION, EDITION_LABEL } from "../../lib/version";
import { bzConfirm } from "../ui/BzDialog";
import { previewSiren } from "../../lib/siren";
import { focusWindowText } from "../../lib/focus";

interface Props {
  autoStatus: boolean;
  onAutoStatus: (v: boolean) => void;
  netAuto: boolean;
  onNetAuto: (v: boolean) => void;
  font: FontKind;
  onFont: (f: FontKind) => void;
  /** 로그아웃 (프로필을 닫고 로그인 화면으로) */
  onLogout?: () => void;
  /** 내 차량 4자리 (이중주차 알림 — Killer ②) */
  car?: string;
  onCar?: (v: string) => void;
  /** 인수인계 마법사 (Killer ④) — 목록이 있으면 카드가 나타난다 */
  handoverTeachers?: { id: string; name: string; dept: string }[];
  /** 지금 로그인한 교사 ID — 본인 계정만 전임으로 고를 수 있게 한다. */
  currentTeacherId?: string;
  /** 학교 관리자(교장·교감·관리자)만 다른 교사의 자료를 대신 이관할 수 있다. */
  canHandoverAll?: boolean;
  onHandover?: (fromId: string, toId: string) => Promise<{ folders: number; files: number; notices: number } | { error: string }>;
}

type SrvUser = { username?: string; real_name?: string; role?: string };

// 살아있는 설정 화면: App의 설정 탭에서 열린다.
export default function SettingsPane(p: Props) {
  const { layout, setLayout, windowMode, setWindowMode, toastOn, setToastOn, motion, setMotion, dark, toggleDark, offWork, toggleOffWork, focus, setFocus, siren, setSiren, uiScale, setUiScale } = useEdu();

  // 🚗 내 차량 4자리 (이중주차 — Killer ②)
  const [carDraft, setCarDraft] = useState(p.car ?? "");
  const [carMsg, setCarMsg] = useState("");
  useEffect(() => {
    setCarDraft(p.car ?? "");
  }, [p.car]);

  // 🎓 학년말 인수인계 마법사 (Killer ④)
  const [hoFrom, setHoFrom] = useState("");
  const [hoTo, setHoTo] = useState("");
  const [hoBusy, setHoBusy] = useState(false);
  const [hoMsg, setHoMsg] = useState("");
  const handoverFroms = p.canHandoverAll
    ? (p.handoverTeachers ?? [])
    : (p.handoverTeachers ?? []).filter((t) => t.id === p.currentTeacherId);
  useEffect(() => {
    if (!p.canHandoverAll && p.currentTeacherId) setHoFrom(p.currentTeacherId);
  }, [p.canHandoverAll, p.currentTeacherId]);

  // 학교 서버(onprem) 연결
  const [srvBase, setSrvBase] = useState("");
  const [srvId, setSrvId] = useState("");
  const [srvPw, setSrvPw] = useState("");
  const [srvMsg, setSrvMsg] = useState("");
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [srvOn, setSrvOn] = useState(false);
  const [srvName, setSrvName] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const st = await call<{ connected: boolean; base: string; user: SrvUser | null }>("srv_status");
        if (st) {
          setSrvBase(st.base || "");
          setSrvOn(!!st.connected);
          setSrvName(st.user?.real_name || st.user?.username || "");
        }
      } catch {
        /* 미리보기 */
      }
    })();
  }, []);

  const srvLogin = async () => {
    setSrvMsg("");
    try {
      const r = await call<{ user?: SrvUser }>("srv_login", { base: srvBase, username: srvId, password: srvPw });
      setSrvOn(true);
      setSrvName(r?.user?.real_name || r?.user?.username || srvId);
      // 설정에서 새로 연결한 경우에도 비밀번호 변경 API가 쓸 토큰을 준비한다.
      const base = normalizeServerUrl(srvBase);
      setApiBaseUrl(base);
      await storeSet("server-base", base);
      try {
        const res = await api.login(srvId, srvPw);
        const token = res.data?.token || "";
        if (res.ok && token) {
          api.setAuthToken(token);
          await storeSet("server-token", token);
        }
      } catch { /* 실시간 연동은 로그인 화면에서 다시 시도할 수 있어요. */ }
      setSrvMsg("연결됐어요.");
      setSrvPw("");
    } catch (e) {
      setSrvOn(false);
      setSrvMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const srvLogout = async () => {
    try {
      await call("srv_logout", {});
    } catch {
      /* 무시 */
    }
    api.setAuthToken(null);
    await storeSet("server-token", "");
    setSrvOn(false);
    setSrvName("");
    setSrvMsg("연결을 끊었어요.");
  };

  const changePassword = async () => {
    setPwMsg("");
    if (!pwCur) { setPwMsg("현재 비밀번호를 입력해 주세요."); return; }
    if (pwNew.length < 8) { setPwMsg("새 비밀번호는 8자 이상으로 정해 주세요."); return; }
    setPwBusy(true);
    try {
      const res = await api.changeMyPassword(pwCur, pwNew);
      if (!res.ok) { setPwMsg(res.error || "비밀번호를 바꾸지 못했어요."); return; }
      setPwCur(""); setPwNew("");
      setPwMsg("✅ 비밀번호를 바꿨어요. 다른 기기에서는 다시 로그인해야 합니다.");
    } catch {
      setPwMsg("서버 연결을 확인해 주세요.");
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 max-w-[560px]">
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">학교 서버 연결</div>
        {srvOn ? (
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[13.5px] font-bold text-edu-strong">● 연결됨 · {srvName}</span>
            <button className="edu-ghost !py-1 !px-2.5 !text-[12px] ml-auto" onClick={srvLogout}>끊기</button>
          </div>
        ) : (
          <div className="mt-2.5 flex flex-col gap-2">
            <input className="edu-input" placeholder="서버 주소 (예: http://192.168.0.10:3000)" value={srvBase} onChange={(e) => setSrvBase(e.target.value)} />
            <div className="flex gap-2">
              <input className="edu-input" placeholder="사번(학번)" value={srvId} onChange={(e) => setSrvId(e.target.value)} />
              <input className="edu-input" type="password" placeholder="비밀번호" value={srvPw} onChange={(e) => setSrvPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void srvLogin(); }} />
            </div>
            <button className="edu-btn" onClick={() => void srvLogin()}>연결</button>
          </div>
        )}
        {srvMsg && <div className="text-[12.5px] mt-1.5 font-bold text-edu-sub">{srvMsg}</div>}
      </div>
      {srvOn && (
        <div className="edu-card p-4">
          <div className="font-extrabold text-[15px]">비밀번호 변경</div>
          <div className="text-[12.5px] text-edu-sub mt-1">처음 받은 임시 비밀번호를 내 비밀번호로 바꿔 주세요. 다른 기기의 로그인은 자동으로 끊깁니다.</div>
          <div className="mt-2.5 flex flex-col gap-2">
            <input className="edu-input" type="password" autoComplete="current-password" placeholder="현재 비밀번호" value={pwCur} onChange={(e) => setPwCur(e.target.value)} />
            <input className="edu-input" type="password" autoComplete="new-password" placeholder="새 비밀번호 (8자 이상)" value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
            <button className="edu-btn" onClick={() => void changePassword()} disabled={pwBusy}>
              {pwBusy ? "변경 중…" : "비밀번호 변경"}
            </button>
          </div>
          {pwMsg && <div className="text-[12.5px] mt-1.5 font-bold text-edu-sub">{pwMsg}</div>}
        </div>
      )}
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">수업 연동</div>
        <label className="mt-2.5 flex items-center gap-2.5 text-[13.5px] font-bold cursor-pointer">
          <input type="checkbox" checked={p.autoStatus} onChange={(e) => p.onAutoStatus(e.target.checked)} className="w-4 h-4" />
          시간표 연동 자동 상태 전환
        </label>
        <button
          className="edu-ghost w-full mt-2"
          onClick={() => {
            try {
              sessionStorage.removeItem("edutalk-morning");
            } catch {
              /* 무시 */
            }
            toggleOffWork();
          }}
        >
          {offWork ? "출근 모드" : "퇴근 모드"}
        </button>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">🌙 Focus Mode (퇴근 후 업무 휴식)</div>
        <div className="text-[12.5px] text-edu-sub mt-1">{focusWindowText()} 에 자동으로 켜져요. 켜져 있는 동안 내 상태는 &quot;자리 비움 · 퇴근 후 업무 휴식 중&quot;으로 보이고, 쪽지·대화 알림 팝업이 조용해져요. 긴급 공지(사이렌)는 항상 표시돼요.</div>
        <label className="mt-2.5 flex items-center gap-2.5 text-[13.5px] font-bold cursor-pointer">
          <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} className="w-4 h-4" />
          Focus Mode 자동 켜기 (평일 18:00~08:00 · 주말 종일)
        </label>
        <label className="mt-2 flex items-center gap-2.5 text-[13.5px] font-bold cursor-pointer">
          <input type="checkbox" checked={siren} onChange={(e) => setSiren(e.target.checked)} className="w-4 h-4" />
          긴급 공지 사이렌 울리기
        </label>
        <button className="edu-ghost w-full mt-2" onClick={() => previewSiren()}>
          🔔 사이렌 미리 듣기 (2초)
        </button>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">연결 자동 전환</div>
        <label className="mt-2.5 flex items-center gap-2.5 text-[13.5px] font-bold cursor-pointer">
          <input type="checkbox" checked={p.netAuto} onChange={(e) => p.onNetAuto(e.target.checked)} className="w-4 h-4" />
          교내망이 감지되면 자동으로 교내연결
        </label>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">화면 모션</div>
        <div className="flex flex-col gap-2 mt-2.5">
          {(["full", "fade", "off"] as MotionMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMotion(m)}
              className={`text-left border rounded-xl px-4 py-3 ${motion === m ? "border-edu-blueline bg-edu-soft" : "border-edu-line"}`}
            >
              <span className="text-sm font-bold">
                {motion === m ? "● " : "○ "}
                {m === "full" ? "부드럽게 (기본)" : m === "fade" ? "페이드" : "끄기"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">야간 모드</div>
        <div className="flex flex-col gap-2 mt-2.5">
          <button
            onClick={() => toggleDark()}
            className={`text-left border rounded-xl px-4 py-3 ${dark ? "border-edu-blueline bg-edu-soft" : "border-edu-line"}`}
          >
            <span className="text-sm font-bold">{dark ? "● 켜기" : "○ 끄기"}</span>
          </button>
        </div>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">알림 팝업</div>
        <div className="flex flex-col gap-2 mt-2.5">
          {([true, false] as const).map((v) => (
            <button
              key={v ? "on" : "off"}
              onClick={() => setToastOn(v)}
              className={`text-left border rounded-xl px-4 py-3 ${toastOn === v ? "border-edu-blueline bg-edu-soft" : "border-edu-line"}`}
            >
              <span className="text-sm font-bold">
                {toastOn === v ? "● " : "○ "}
                {v ? "켜기" : "끄기"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">창 모양</div>
        <div className="flex flex-col gap-2 mt-2.5">
          {(["classic", "modern"] as LayoutMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setLayout(m)}
              className={`text-left border rounded-xl px-4 py-3 ${layout === m ? "border-edu-blueline bg-edu-soft" : "border-edu-line"}`}
            >
              <span className="text-sm font-bold">
                {layout === m ? "● " : "○ "}
                {m === "classic" ? "세로형 (기본)" : "가로형"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">창 작업 방식</div>
        <div className="flex flex-col gap-2 mt-2.5">
          {(["single", "multi"] as WindowMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setWindowMode(m)}
              className={`text-left border rounded-xl px-4 py-3 ${windowMode === m ? "border-edu-blueline bg-edu-soft" : "border-edu-line"}`}
            >
              <span className="text-sm font-bold">
                {windowMode === m ? "● " : "○ "}
                {m === "single" ? "한 창에서 작업" : "메뉴마다 새 창 (기본)"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="edu-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-extrabold text-[15px]">화면 크기</div>
          <span className="text-[13px] font-extrabold text-edu-blue">{Math.round(uiScale * 100)}%</span>
        </div>
        <div className="text-sm text-edu-sub mt-1">
          글자·버튼·여백을 한 번에 키우거나 줄여요. 설치판에서는 창 크기도 함께 맞춰져요.
        </div>
        <div className="flex items-center gap-2.5 mt-3">
          <button
            type="button"
            className="edu-chip !px-3 !py-1.5 text-[13px] font-extrabold"
            onClick={() => setUiScale(uiScale - 0.05)}
            aria-label="화면 크기 줄이기"
          >
            가−
          </button>
          <input
            type="range"
            min={0.85}
            max={1.35}
            step={0.05}
            value={uiScale}
            onChange={(e) => setUiScale(Number(e.target.value))}
            className="flex-1 accent-[#0082C8]"
            aria-label="화면 크기"
          />
          <button
            type="button"
            className="edu-chip !px-3 !py-1.5 text-[13px] font-extrabold"
            onClick={() => setUiScale(uiScale + 0.05)}
            aria-label="화면 크기 키우기"
          >
            가+
          </button>
          <button
            type="button"
            className="edu-chip !px-3 !py-1.5 text-[12px] font-bold"
            onClick={() => setUiScale(1)}
          >
            기본
          </button>
        </div>
        <div className="flex justify-between text-[10.5px] text-edu-muted mt-1 px-10">
          <span>85%</span><span>100%</span><span>135%</span>
        </div>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">글꼴</div>
        <div className="flex flex-col gap-2 mt-2.5">
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              onClick={() => p.onFont(f.id)}
              className={`text-left border rounded-xl px-4 py-2.5 ${p.font === f.id ? "border-edu-blueline bg-edu-soft" : "border-edu-line"}`}
            >
              <span className="text-sm font-bold" style={{ fontFamily: f.stack }}>
                {p.font === f.id ? "● " : "○ "}
                {f.label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">🚗 내 차량 4자리</div>
        <div className="text-sm text-edu-sub mt-1">
          조직도 검색창에 <b>내 차량 번호</b>를 치면 동료가 찾아 [차량 이동 요청]을 보낼 수 있어요. 전화번호는 노출되지 않아요.
        </div>
        <div className="flex items-center gap-2 mt-2.5">
          <input
            className="edu-input !py-2 w-28 text-center tracking-widest"
            inputMode="numeric"
            maxLength={4}
            placeholder="1234"
            value={carDraft}
            onChange={(e) => setCarDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          <button
            className="edu-btn !py-2"
            onClick={() => {
              const v = carDraft.replace(/\D/g, "");
              if (v.length > 0 && v.length !== 4) {
                setCarMsg("차량 번호 4자리를 정확히 넣어 주세요.");
                return;
              }
              p.onCar?.(v);
              setCarMsg(v ? "저장했어요. 동료가 차량 번호로 찾을 수 있어요." : "차량 번호를 지웠어요.");
            }}
          >
            저장
          </button>
        </div>
        {carMsg && <div className="text-[12px] text-edu-sub mt-2">{carMsg}</div>}
      </div>
      {p.onHandover && p.handoverTeachers && p.handoverTeachers.length >= 2 && (
        <div className="edu-card p-4 border-l-4 border-[#0082C8]">
          <div className="font-extrabold text-[15px]">🎓 학년말 인수인계 마법사</div>
          <div className="text-sm text-edu-sub mt-1">
            전임 선생님의 <b>브리즈 클라우드 자료(폴더·파일)</b>와 <b>공지 작성자</b>를 후임에게 한 번에 넘겨요.
            자료는 지워지지 않아요 — 관리 권한(소유자)만 이동합니다.
          </div>
          <div className="text-[12px] text-edu-sub mt-1.5">
            {p.canHandoverAll
              ? "학교 관리자는 어떤 교사의 자료든 대신 이관할 수 있어요."
              : "내 계정의 자료만 이관할 수 있어요. 다른 교사 자료는 본인 또는 학교 관리자만 이관할 수 있어요."}
          </div>
          <div className="flex items-center gap-1.5 mt-2.5">
            <select
              className="edu-input !py-2 flex-1"
              value={hoFrom}
              onChange={(e) => { setHoFrom(e.target.value); setHoMsg(""); }}
              disabled={!p.canHandoverAll}
              title={!p.canHandoverAll ? "본인 계정으로 고정돼 있어요" : undefined}
            >
              {p.canHandoverAll && <option value="">전임 교사 (떠나는 분)</option>}
              {handoverFroms.map((t) => (
                <option key={t.id} value={t.id}>{t.name} · {t.dept}</option>
              ))}
            </select>
            <span aria-hidden className="text-edu-sub">→</span>
            <select
              className="edu-input !py-2 flex-1"
              value={hoTo}
              onChange={(e) => { setHoTo(e.target.value); setHoMsg(""); }}
            >
              <option value="">후임 교사 (이어받는 분)</option>
              {p.handoverTeachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name} · {t.dept}</option>
              ))}
            </select>
          </div>
          <button
            className="edu-btn w-full mt-2.5"
            disabled={hoBusy || !hoFrom || !hoTo || hoFrom === hoTo}
            onClick={async () => {
              const from = p.handoverTeachers?.find((t) => t.id === hoFrom);
              const to = p.handoverTeachers?.find((t) => t.id === hoTo);
              if (!from || !to) return;
              const ok = await bzConfirm({
                title: "인수인계를 실행할까요?",
                message: `${from.name} → ${to.name}\n클라우드 자료 소유권과 공지 작성자가 한 번에 넘어가요. 되돌리려면 반대 방향으로 다시 실행하면 돼요.`,
                confirmText: "이관 실행",
              });
              if (!ok || !p.onHandover) return;
              setHoBusy(true);
              setHoMsg("");
              try {
                const r = await p.onHandover(from.id, to.id);
                if ("error" in r) setHoMsg(r.error);
                else setHoMsg(`✅ 이관 완료 — 폴더 ${r.folders}개 · 파일 ${r.files}개 · 공지 ${r.notices}건을 ${to.name} 선생님께 넘겼어요.`);
              } catch {
                setHoMsg("이관에 실패했어요. 잠시 뒤 다시 시도해 주세요.");
              } finally {
                setHoBusy(false);
              }
            }}
          >
            {hoBusy ? "이관하는 중…" : "이관 실행"}
          </button>
          {hoMsg && <div className="text-[12px] text-edu-sub mt-2 whitespace-pre-line">{hoMsg}</div>}
        </div>
      )}
      <div className="text-[11.5px] font-bold text-edu-muted text-center py-1">브리즈코어 v{APP_VERSION} · {EDITION_LABEL}</div>
      {p.onLogout && (
        <div className="edu-card p-4">
          <div className="font-extrabold text-[15px]">로그아웃</div>
          <div className="text-sm text-edu-sub mt-1">이 PC에 남은 로그인 정보를 지우고 로그인 화면으로 돌아갑니다. 쪽지·자료는 그대로 남아 있어요.</div>
          <button
            className="edu-btn w-full mt-3"
            onClick={async () => {
              const ok = await bzConfirm({
                title: "로그아웃할까요?",
                message: "다시 쓰려면 로그인 화면에서 프로필을 골라 주세요.",
                confirmText: "로그아웃",
              });
              if (ok) p.onLogout?.();
            }}
          >
            로그아웃
          </button>
        </div>
      )}
      <div className="edu-card p-4 border-l-4 border-[#E5484D]">
        <div className="font-extrabold text-[15px] text-[#E5484D]">⚠️ 데이터 초기화</div>
        <div className="text-sm text-edu-sub mt-1">모든 로컬 데이터(프로필, 교사, 부서, 쪽지, 시간표, 공지, 설정)를 삭제하고 처음 설정 화면으로 돌아갑니다.</div>
        <button 
          className="edu-btn mt-3 w-full bg-[#FFF0F1] text-[#B42318] hover:bg-[#FECACA]"
          onClick={async () => {
            const ok = await bzConfirm({
              title: "정말 모든 데이터를 삭제할까요?",
              message: "프로필·쪽지·시간표·공지·설정이 모두 지워지고 처음 설정 화면으로 돌아갑니다. 되돌릴 수 없어요.",
              confirmText: "전체 삭제",
              danger: true,
            });
            if (!ok) return;
            try {
                // localStorage 키 모두 삭제
                const keysToRemove = [
                  "edutalk-profile-done",
                  "edutalk-net", "edutalk-status", "edutalk-autostatus",
                  "edutalk-font", "edutalk-school", "edutalk-teachers",
                  "edutalk-depts", "edutalk-memos", "edutalk-comments",
                  "edutalk-chats", "edutalk-tt", "edutalk-swaps",
                  "edutalk-notices", "edutalk-audits", "edutalk-cache",
                  "edutalk-purge", "edutalk-netauto", "edutalk-motion",
                  "edutalk-offwork", "edutalk-dark", "edutalk-toast",
                  "edutalk-layout", "edutalk-windowmode",
                  "edutalk-focus", "edutalk-siren",
                  "edutalk-adminUsers", "edutalk-adminNotices",
                  "edutalk-adminAudits", "edutalk-templates",
                  "edutalk-gradeClasses", "edutalk-schoolInfo",
                  "edutalk-schoolSettings",
                  "breeze-quick-notes", "breeze-cloud", "breeze-surveys",
                ];
                keysToRemove.forEach(k => localStorage.removeItem(k));
                sessionStorage.clear();
                // 파일 저장소(IndexedDB)도 함께 비운다
                if (typeof indexedDB !== "undefined") {
                  indexedDB.deleteDatabase("breeze-files");
                }
              } catch { /* 저장소가 막혀 있어도 계속 진행 */ }
              location.reload();
          }}
        >
          🗑️ 전체 데이터 삭제하고 처음부터 시작
        </button>
      </div>
    </div>
  );
}
