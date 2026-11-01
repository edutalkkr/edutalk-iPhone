// 긴급 공지 알림음 — 부드러운 2음 차임 (아이폰 알림 느낌, 오프라인·설치판 공통)
//  · WebAudio로 생성 (외부 자산 없음). square/saw 대신 sine + 부드러운 엔벨로프.
//  · 브라우저 자동재생 정책 때문에 사용자 조작 이후에만 실제로 울린다.
//  · 어떤 환경에서도 앱이 죽지 않게 전부 try/catch.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let activeNodes: (OscillatorNode | GainNode)[] = [];
let stopTimer: number | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (ctx) return ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    return ctx;
  } catch {
    ctx = null;
    master = null;
    return null;
  }
}

/** 부드러운 차임 2음 (E5 → C6) */
export function playSiren(seconds = 6): boolean {
  try {
    const c = ensureCtx();
    if (!c || !master) return false;
    void c.resume().catch(() => undefined);
    stopSiren();

    // 2음 차임을 seconds 동안 3회 반복 (간격 1.6초)
    const notes = [659.25, 783.99]; // E5, G5
    const repeat = Math.max(1, Math.floor(seconds / 1.6));
    const now0 = c.currentTime;
    for (let r = 0; r < repeat; r++) {
      const t0 = now0 + r * 1.6;
      notes.forEach((freq, i) => {
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        const g = c.createGain();
        g.gain.value = 0;
        osc.connect(g);
        g.connect(master!);
        const start = t0 + i * 0.18;
        try {
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(0.18, start + 0.04);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
        } catch {
          g.gain.value = 0.12;
        }
        osc.start(start);
        osc.stop(start + 0.45);
        activeNodes.push(osc, g);
      });
    }

    stopTimer = window.setTimeout(() => stopSiren(), (seconds + 0.3) * 1000);
    return true;
  } catch {
    return false;
  }
}

export function stopSiren(): void {
  try {
    if (stopTimer != null) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
    for (const n of activeNodes) {
      try { (n as OscillatorNode).stop?.(); } catch { /* 이미 멈춤 */ }
      try { n.disconnect(); } catch { /* 이미 끊김 */ }
    }
    activeNodes = [];
  } catch {
    /* 다음에 */
  }
}

export function previewSiren(): void {
  playSiren(2.2);
}