// 긴급 공지 알림음 — 빠른 차임 (ding-dong ding-dong …, 아이폰 알림 느낌)
//  · WebAudio로 생성 (외부 자산 없음). sine + 부드러운 엔벨로프.
//  · 브라우저 자동재생 정책 때문에 사용자 조작 이후에만 실제로 울린다.

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
    master.gain.value = 0.25;
    master.connect(ctx.destination);
    return ctx;
  } catch {
    ctx = null;
    master = null;
    return null;
  }
}

/** 빠른 차임: 0.28초 간격으로 ding-dong 반복 */
export function playSiren(seconds = 6): boolean {
  try {
    const c = ensureCtx();
    if (!c || !master) return false;
    void c.resume().catch(() => undefined);
    stopSiren();

    const pairs = [[659.25, 523.25], [659.25, 523.25]]; // ding-dong
    const interval = 0.28;
    const count = Math.max(1, Math.floor(seconds / interval));
    const now0 = c.currentTime;
    for (let i = 0; i < count; i++) {
      const t0 = now0 + i * interval;
      const hi = pairs[i % pairs.length][0];
      const lo = pairs[i % pairs.length][1];
      [hi, lo].forEach((freq, j) => {
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        const g = c.createGain();
        g.gain.value = 0;
        osc.connect(g);
        g.connect(master!);
        const start = t0 + j * 0.12;
        try {
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(0.2, start + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
        } catch {
          g.gain.value = 0.15;
        }
        osc.start(start);
        osc.stop(start + 0.24);
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