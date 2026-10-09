import { useEdu, type LayoutMode, type MotionMode, type WindowMode } from "../../store";
import { FONT_OPTIONS, type FontKind } from "../../lib/fonts";

interface Props {
  autoStatus: boolean;
  onAutoStatus: (v: boolean) => void;
  netAuto: boolean;
  onNetAuto: (v: boolean) => void;
  font: FontKind;
  onFont: (f: FontKind) => void;
}

// 살아있는 설정 화면: App의 설정 탭에서 열린다.
export default function SettingsPane(p: Props) {
  const { layout, setLayout, windowMode, setWindowMode, toastOn, setToastOn, motion, setMotion, dark, toggleDark, offWork, toggleOffWork } = useEdu();
  return (
    <div className="flex flex-col gap-3 max-w-[560px]">
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">수업 연동 (시간표 합체)</div>
        <div className="text-[12.5px] text-edu-sub mt-0.5">수업 시간이면 자동으로 &lsquo;수업 중&rsquo; + 방해금지로 바뀌어 알림이 조용해져요.</div>
        <label className="mt-3 flex items-center gap-2.5 text-[13.5px] font-bold cursor-pointer">
          <input type="checkbox" checked={p.autoStatus} onChange={(e) => p.onAutoStatus(e.target.checked)} className="w-4 h-4" />
          시간표 연동 자동 상태 전환
        </label>
        <div className="text-[12px] text-edu-sub mt-1">끄면 상태를 직접 골라요.</div>
        <label className="mt-3 flex items-center gap-2.5 text-[13.5px] font-bold cursor-pointer">
          <input type="checkbox" checked={!offWork} onChange={() => { if (offWork) toggleOffWork(); }} className="w-4 h-4" disabled={!offWork} />
          수업 알림 받기
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
          {offWork ? "출근 모드로 바꾸기 (아침 팝업 다시 보기)" : "퇴근 모드로 바꾸기 (알림 최소화)"}
        </button>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">연결 자동 전환 (하이브리드 망)</div>
        <div className="text-[12.5px] text-edu-sub mt-0.5">교내망 PC가 보이면 교내연결(초고속 직송)로, 안 보이면 외부연결(클라우드)로 자동으로 바꿔요.</div>
        <label className="mt-3 flex items-center gap-2.5 text-[13.5px] font-bold cursor-pointer">
          <input type="checkbox" checked={p.netAuto} onChange={(e) => p.onNetAuto(e.target.checked)} className="w-4 h-4" />
          연결 자동 전환 켜기
        </label>
        <div className="text-[12px] text-edu-sub mt-1">연결 버튼을 직접 누르면 자동 전환은 꺼져요.</div>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">화면 모션</div>
        <div className="text-[12.5px] text-edu-sub mt-0.5">기본은 미끄러지듯 부드럽게예요.</div>
        <div className="flex flex-col gap-2 mt-2.5">
          {(["full", "fade", "off"] as MotionMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMotion(m)}
              className={`text-left border rounded-xl px-4 py-3 ${
                motion === m ? "border-edu-blueline bg-edu-soft" : "border-edu-line"
              }`}
            >
              <span className="text-sm font-bold">
                {motion === m ? "● " : "○ "}
                {m === "full" ? "켜기 (부드럽게)" : m === "fade" ? "페이드만" : "끄기"}
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
              className={`text-left border rounded-xl px-4 py-3 ${
                toastOn === v ? "border-edu-blueline bg-edu-soft" : "border-edu-line"
              }`}
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
        <div className="text-[12.5px] text-edu-sub mt-0.5">세로형이 기본이에요. 옆에 띄워두고 쓰기 좋아요.</div>
        <div className="flex flex-col gap-2 mt-2.5">
          {(["classic", "modern"] as LayoutMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setLayout(m)}
              className={`text-left border rounded-xl px-4 py-3 ${
                layout === m ? "border-edu-blueline bg-edu-soft" : "border-edu-line"
              }`}
            >
              <span className="text-sm font-bold">
                {layout === m ? "● " : "○ "}
                {m === "classic" ? "세로형 (카톡식, 기본)" : "가로형 (넓게 · 창 다 차지함)"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">창 작업 방식</div>
        <div className="text-[12.5px] text-edu-sub mt-0.5">여러 창은 준비 중이에요.</div>
        <div className="flex flex-col gap-2 mt-2.5">
          {(["single", "multi"] as WindowMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setWindowMode(m)}
              className={`text-left border rounded-xl px-4 py-3 ${
                windowMode === m ? "border-edu-blueline bg-edu-soft" : "border-edu-line"
              }`}
            >
              <span className="text-sm font-bold">
                {windowMode === m ? "● " : "○ "}
                {m === "single" ? "한 창으로 작업" : "여러 창으로 작업"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="edu-card p-4">
        <div className="font-extrabold text-[15px]">글꼴</div>
        <div className="text-[12.5px] text-edu-sub mt-0.5">이 PC에만 적용돼요.</div>
        <div className="flex flex-col gap-2 mt-2.5">
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              onClick={() => p.onFont(f.id)}
              className={`text-left border rounded-xl px-4 py-2.5 ${
                p.font === f.id ? "border-edu-blueline bg-edu-soft" : "border-edu-line"
              }`}
            >
              <span className="text-sm font-bold" style={{ fontFamily: f.stack }}>
                {p.font === f.id ? "● " : "○ "}
                {f.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
