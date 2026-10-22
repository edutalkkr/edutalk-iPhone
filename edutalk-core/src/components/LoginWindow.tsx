import { useState, useEffect } from "react";
import { call } from "../lib/tauri";
import { storeGet, storeSet } from "../lib/localStore";
import { api, normalizeServerUrl, setApiBaseUrl } from "../services/api";
import { connectNotesRealtime } from "../services/notes";
import BzTooltip from "./ui/BzTooltip";
import { APP_VERSION } from "../lib/version";

export interface LoginCredentials {
  serverIp: string;
  schoolCode: string;
  teacherId: string;
  password: string;
  autoLogin: boolean;
}

interface Props {
  onLogin: (credentials: LoginCredentials) => Promise<void>;
  onDemo: () => Promise<void> | void;
  onError: (message: string) => void;
  onSuccess: () => void;
}

/** 서버 주소 형식 검사 — IP·도메인·포트, 또는 http(s):// 주소 */
const SERVER_RE = /^([a-zA-Z0-9.\-[\]:]+|https?:\/\/[^\s]+)$/;
/** 학교 코드: 공백 없는 2~20자 (영문·숫자·-·_ 권장) */
const SCHOOL_CODE_RE = /^[^\s]{2,20}$/;

export default function LoginWindow({ onLogin, onDemo, onError, onSuccess }: Props) {
  const [serverIp, setServerIp] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [password, setPassword] = useState("");
  const [rememberId, setRememberId] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [remembered, setRemembered] = useState(false);

  useEffect(() => {
    const loadSaved = async () => {
      const saved = await storeGet<Partial<LoginCredentials>>("login-credentials");
      if (!saved) return;
      setServerIp(saved.serverIp || "");
      setSchoolCode(saved.schoolCode || "");
      if (saved.teacherId) {
        setTeacherId(saved.teacherId);
        setRememberId(true);
      }
      setRemembered(Boolean(saved.serverIp || saved.teacherId));
      // 보안: 예전 버전이 남긴 평문 비밀번호는 즉시 지운다 (다시는 저장하지 않음)
      if (saved.password) {
        await storeSet("login-credentials", { ...saved, password: "", autoLogin: false });
      }
    };
    void loadSaved();
  }, []);

  /** 입력 검증 — 서버에 보내기 전에 형식 오류를 먼저 잡는다 */
  const validate = (): string => {
    const ip = serverIp.trim();
    if (!ip) return "브리즈 서버 IP를 입력해 주세요.";
    if (ip.length > 120) return "서버 주소가 너무 길어요.";
    if (!SERVER_RE.test(ip)) return "서버 주소 형식이 올바르지 않아요. 예: 192.168.1.100";
    if (!schoolCode.trim()) return "학교 코드를 입력해 주세요.";
    if (!SCHOOL_CODE_RE.test(schoolCode.trim())) return "학교 코드는 공백 없이 2~20자로 입력해 주세요.";
    if (!teacherId.trim()) return "교원 ID를 입력해 주세요.";
    if (!password) return "비밀번호를 입력해 주세요.";
    return "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    setError("");
    setOkMsg("");
    try {
      const credentials: LoginCredentials = {
        serverIp: serverIp.trim(),
        schoolCode: schoolCode.trim(),
        teacherId: teacherId.trim(),
        password,
        autoLogin: false,
      };
      // 로그인 전에 서버의 학교 코드와 대조한다. (주소만 맞고 다른 학교 서버에 붙는 사고 방지)
      const base = normalizeServerUrl(credentials.serverIp);
      setApiBaseUrl(base);
      await storeSet("server-base", base);
      try {
        const info = await api.getPublicInfo();
        const serverCode = info.ok ? String(info.data?.schoolCode || "").trim() : "";
        if (serverCode && serverCode.toUpperCase() !== credentials.schoolCode.toUpperCase()) {
          throw new Error(`학교 코드가 서버와 맞지 않아요. 이 서버의 코드는 '${serverCode}'예요.`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("학교 코드가")) throw err;
        /* 공개 정보를 못 받아도 로그인 자체는 시도한다 (구버전/일시 지연) */
      }
      await onLogin(credentials);

      // 쪽지 실시간 연동 시드 (베스트 에포트 — 실패해도 로그인 흐름은 계속)
      try {
        const res = await api.login(credentials.teacherId, credentials.password);
        if (res.ok) {
          // 토큰은 비밀번호가 아니다. 앱을 다시 켰을 때 학생 문의 실시간 수신을 이어가기 위해 보관한다.
          await storeSet("server-token", res.data?.token || "");
          await connectNotesRealtime({ url: base, token: res.data?.token });
        }
      } catch {
        /* 서버 미지원/오프라인이어도 로그인은 성공 처리 */
      }

      // 서버 주소·학교 코드는 항상 기억하고, 교원 ID는 [아이디 저장]일 때만.
      //  · 비밀번호는 어떤 경우에도 저장하지 않는다 (로컬 저장소 평문 노출 방지).
      await storeSet("login-credentials", {
        serverIp: credentials.serverIp,
        schoolCode: credentials.schoolCode,
        teacherId: rememberId ? credentials.teacherId : "",
        password: "",
        autoLogin: false,
      });
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "로그인하지 못했어요.";
      setError(msg);
      onError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    setError("");
    try {
      await onDemo();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "데모 로그인에 실패했어요.";
      setError(msg);
      onError(msg);
      setLoading(false);
    }
  };

  /** 서버 연결 테스트 — 입력한 주소로 실제 상태 확인(공개 정보)을 요청한다 */
  const handleTestConnection = async () => {
    const ip = serverIp.trim();
    if (!ip) {
      setError("서버 IP를 입력해 주세요.");
      return;
    }
    if (!SERVER_RE.test(ip)) {
      setError("서버 주소 형식이 올바르지 않아요. 예: 192.168.1.100");
      return;
    }
    setLoading(true);
    setError("");
    setOkMsg("");
    try {
      await call("srv_status");
    } catch {
      /* Tauri 밖(웹 미리보기)에서는 아래 fetch 검사만으로 확인한다 */
    }
    try {
      const base = normalizeServerUrl(ip);
      setApiBaseUrl(base);
      const ok = await api.healthCheck();
      if (!ok) throw new Error("서버에 연결할 수 없어요. IP·포트·방화벽을 확인해 주세요.");
      // 서버가 알고 있는 학교 코드를 자동으로 채워 교사 앱 ↔ 학생 웹을 같은 학교로 묶는다.
      let schoolLabel = "";
      try {
        const info = await api.getPublicInfo();
        if (info.ok && info.data) {
          if (info.data.schoolCode) {
            setSchoolCode(info.data.schoolCode);
            schoolLabel = info.data.schoolName
              ? ` · ${info.data.schoolName}`
              : "";
          }
        }
      } catch { /* 구버전 서버는 학교 코드를 제공하지 않을 수 있다 */ }
      setOkMsg(`${base} 연결 확인됨${schoolLabel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "서버에 연결할 수 없어요.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full w-full flex items-center justify-center bg-edu-bg relative overflow-hidden">
      {/* 배경: 은은한 브랜드 그라데이션 + 도트 패턴 (전문 도구 느낌) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(620px 320px at 12% 6%, rgba(0,130,200,0.13), transparent 62%)," +
            "radial-gradient(560px 300px at 92% 96%, rgba(124,92,255,0.09), transparent 60%)," +
            "radial-gradient(rgba(15,23,42,0.055) 1px, transparent 1px)",
          backgroundSize: "auto, auto, 22px 22px",
        }}
      />

      <div className="relative z-10 w-full max-w-[392px] px-4 py-6">
        <div className="anim-page bg-edu-surface/95 backdrop-blur-xl border border-edu-line rounded-[22px] shadow-[0_28px_70px_-28px_rgba(8,47,73,0.38)] p-5">
          {/* 로고 · 타이틀 */}
          <div className="text-center mb-5">
            <div className="relative w-[52px] h-[52px] mx-auto mb-3 rounded-2xl grid place-items-center text-white font-black text-[23px] shadow-[0_10px_24px_-10px_rgba(0,105,168,0.75)]"
              style={{ background: "linear-gradient(145deg,#0A8FD8 0%,#0069A8 100%)" }}
            >
              B
              <span className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/25" aria-hidden />
            </div>
            <h1 className="font-black text-[21px] tracking-[-0.4px] text-edu-ink">브리즈</h1>
            <p className="text-[12px] text-edu-sub mt-1">학교 교직원 전용 업무 메신저</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {/* 학교 서버: IP(가변) + 학교 코드(고정폭) — grid 로 비율 고정 */}
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[11.5px] font-bold text-edu-sub">학교 서버</span>
                <span className="text-[10.5px] text-edu-muted">전산실에서 받은 주소</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_108px] gap-2">
                <div className="min-w-0">
                  <input
                    type="text"
                    className="edu-input !py-2.5 !text-[13px]"
                    placeholder="192.168.1.100"
                    value={serverIp}
                    onChange={(e) => { setServerIp(e.target.value); setOkMsg(""); }}
                    disabled={loading}
                    maxLength={120}
                    autoFocus
                    aria-label="브리즈 서버 IP"
                  />
                </div>
                <div className="min-w-0">
                  <input
                    type="text"
                    className="edu-input !py-2.5 !text-[13px] text-center tracking-[0.06em]"
                    placeholder="학교코드"
                    value={schoolCode}
                    onChange={(e) => setSchoolCode(e.target.value.replace(/\s/g, "").slice(0, 20))}
                    disabled={loading}
                    maxLength={20}
                    aria-label="학교 코드"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11.5px] font-bold text-edu-sub" htmlFor="login-id">교원 ID</label>
              <input
                id="login-id"
                type="text"
                className="edu-input !py-2.5 !text-[13px]"
                placeholder="교원 번호 또는 아이디"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                disabled={loading}
                maxLength={40}
                autoComplete="username"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11.5px] font-bold text-edu-sub" htmlFor="login-pw">비밀번호</label>
              <div className="relative">
                <input
                  id="login-pw"
                  type={showPw ? "text" : "password"}
                  className="edu-input !py-2.5 !pr-11 !text-[13px]"
                  placeholder="비밀번호"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  maxLength={128}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "비밀번호 가리기" : "비밀번호 보기"}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 px-2 rounded-lg text-[11px] font-bold text-edu-sub hover:text-edu-ink hover:bg-edu-chip transition-colors"
                >
                  {showPw ? "가리기" : "보기"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-edu-line accent-[#0082C8] focus:ring-2 focus:ring-[#0082C8]/30"
                  checked={rememberId}
                  onChange={(e) => setRememberId(e.target.checked)}
                  disabled={loading}
                />
                <span className="text-[12px] text-edu-sub">교원 ID 저장</span>
              </label>
              {remembered && (
                <span className="text-[10.5px] text-edu-muted">저장된 서버 정보 있음</span>
              )}
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-[#FDE8E8] border border-[#FBC5C5] text-[12px] text-[#D92D20] font-medium animate-shake" role="alert">
                ⚠️ {error}
              </div>
            )}
            {okMsg && !error && (
              <div className="p-2.5 rounded-xl bg-[#E7F6EC] border border-[#B7E4C7] text-[12px] text-[#17663A] font-bold" role="status">
                ✓ {okMsg}
              </div>
            )}

            <button
              type="submit"
              className="edu-btn w-full !py-2.5 !text-[14px] font-extrabold !mt-1"
              disabled={loading}
            >
              {loading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="edu-spinner" aria-hidden />
                  로그인 중…
                </span>
              ) : (
                "로그인"
              )}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                className="edu-btn-secondary flex-1 !py-2 !text-[12px]"
                disabled={loading}
              >
                서버 연결 테스트
              </button>
              <BzTooltip content="실제 서버 없이 가상 학교(그린초등학교) 자료로 체험합니다" position="top" className="flex-1">
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  className="edu-btn-secondary w-full !py-2 !text-[12px] !text-edu-blue !border-[#BFE3F5] !bg-[#F3FAFE]"
                  disabled={loading}
                >
                  {loading ? "여는 중…" : "데모 로그인"}
                </button>
              </BzTooltip>
            </div>
            <p className="text-[10.5px] text-edu-muted text-center leading-relaxed">
              데모 로그인은 실제 서버 없이 샘플 조직도·쪽지·시간표로 체험해요.
            </p>
          </form>

          <div className="mt-4 pt-3 border-t border-edu-line flex items-center justify-between gap-2">
            <p className="text-[10.5px] text-edu-muted">브리즈 v{APP_VERSION}</p>
            <p className="text-[10.5px] text-edu-muted">교내망 P2P · 개인정보 마스킹</p>
          </div>
        </div>
      </div>
    </div>
  );
}
