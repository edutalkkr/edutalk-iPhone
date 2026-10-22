// 학생 메시지 도착 알림음 — 외부 음원 없이 Web Audio로 짧은 2음 차임을 만든다.
// 브라우저 자동재생 정책 때문에 로그인 등 사용자 조작 이후에만 소리가 난다.
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 부드러운 '딩-동' 알림 (약 0.35초). 실패해도 조용히 무시. */
export function playStudentChime(): void {
  const c = getCtx();
  if (!c) return;
  try {
    const now = c.currentTime;
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    master.connect(c.destination);

    const notes = [
      { freq: 784, at: 0, dur: 0.16 },   // G5
      { freq: 1046.5, at: 0.11, dur: 0.24 }, // C6
    ];
    for (const n of notes) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq, now + n.at);
      g.gain.setValueAtTime(0.0001, now + n.at);
      g.gain.exponentialRampToValueAtTime(0.9, now + n.at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.dur);
      osc.connect(g);
      g.connect(master);
      osc.start(now + n.at);
      osc.stop(now + n.at + n.dur + 0.02);
    }
  } catch {
    /* 오디오 장치가 없는 환경에서는 무음 */
  }
}
