// 긴급 공지 사이렌 — WebAudio 2음 사이렌 (오프라인·설치판 공통, 외부 자산 없음)
//  · 브라우저 자동재생 정책 때문에 사용자 조작(로그인/클릭) 이후에만 실제로 울린다.
//  · 어떤 환경에서도 앱이 죽지 않게 전부 try/catch + 종료 시 자동 정리.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let osc: OscillatorNode | null = null;
let lfo: OscillatorNode | null = null;
let lfoGain: GainNode | null = null;
let stopTimer: number | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (ctx) return ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  } catch {
    ctx = null;
    master = null;
    return null;
  }
}

/** 사이렌 시작 (기본 6초). 켤 수 없는 환경이면 조용히 false */
export function playSiren(seconds = 6): boolean {
  try {
    const c = ensureCtx();
    if (!c || !master) return false;
    void c.resume().catch(() => undefined);
    stopSirenInternal(false);

    osc = c.createOscillator();
    osc.type = "square";
    osc.frequency.value = 740;

    // 0.45초 주기로 660↔940Hz 를 오가는 경찰차 사이렌 (LFO로 주파수 변조)
    lfo = c.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 1 / 0.45;
    lfoGain = c.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const g = c.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(master);

    const now = c.currentTime;
    try {
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.12, now + 0.05);
      g.gain.setValueAtTime(0.12, now + Math.max(0.4, seconds - 0.25));
      g.gain.linearRampToValueAtTime(0, now + seconds);
    } catch {
      g.gain.value = 0.1;
    }

    osc.start();
    lfo.start();
    stopTimer = window.setTimeout(() => stopSiren(), (seconds + 0.2) * 1000);
    return true;
  } catch {
    return false;
  }
}

function stopSirenInternal(ramp: boolean): void {
  try {
    if (stopTimer != null) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
    if (osc) {
      if (ramp && ctx && master) {
        try {
          const g = ctx.createGain();
          g.gain.value = 1;
          osc.disconnect();
          osc.connect(g);
          g.connect(master);
          g.gain.setValueAtTime(1, ctx.currentTime);
          g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
        } catch {
          /* 즉시 정지로 대체 */
        }
        const oscToStop = osc;
        window.setTimeout(() => { try { oscToStop.stop(); } catch { /* 이미 멈춤 */ } }, 160);
      } else {
        try {
          osc.stop();
        } catch {
          /* 이미 멈춤 */
        }
      }
      osc = null;
    }
    if (lfo) {
      try {
        lfo.stop();
      } catch {
        /* 이미 멈춤 */
      }
      lfo = null;
    }
    lfoGain = null;
  } catch {
    /* 다음에 */
  }
}

/** 사이렌 즉시 정지 */
export function stopSiren(): void {
  stopSirenInternal(true);
}

/** 테스트/설정 미리듣기용 짧은 사이렌 */
export function previewSiren(): void {
  playSiren(2.2);
}
