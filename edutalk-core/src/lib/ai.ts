// AI 도우미 — 공지 3줄 요약 (로드맵 1-1: AI 호출을 서버로 이전)
//  · AI API 키는 온프레미스 서버(onprem/.env)에서만 관리한다.
//    클라이언트(VITE_*)에는 키를 두지 않아 키 유출 위험을 없앤다.
//  · 서버(/api/ai/summaries)가 같은 공지를 딱 1회만 요약해 DB에 캐싱하고,
//    이후에는 어떤 교사가 열어도 캐시에서 즉시(0.1초) 돌려준다.
//    AI로 보내기 전에 주민등록번호·휴대폰·카드번호를 ***로 마스킹한다 (서버 담당).
//  · 서버가 없거나(브라우저 단독 실행) 실패하면 로컬 문장 추출로 조용히 대체한다.
//  · 결과는 항상 최대 3줄.

import { api } from "../services/api";

export interface SummaryResult {
  lines: string[];
  /** gemini: 서버 AI 요약 · local: 로컬 추출 · error: 서버 실패 후 로컬 */
  source: "gemini" | "local" | "error";
  /** 서버 DB 캐시에서 즉시 온 결과인지 */
  cached?: boolean;
}

/** 불용어(한국어/영어) */
const STOPWORDS = new Set([
  "그리고", "그러나", "하지만", "또한", "또는", "및", "등", "위해", "대한", "통해", "관련", "에서", "으로", "에게", "으로써",
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "by", "is", "are", "was", "were",
]);

/** 문장 다듬기 공통 */
function cleanLine(s: string): string {
  let t = String(s || "")
    .replace(/^[\s>*•·\-–—\d.)\]]+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > 96) t = `${t.slice(0, 95)}…`;
  return t;
}

/** 토큰화 */
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z가-힣0-9]+/g) || []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** 로컬 폴백: TF-IDF 기반 추출 요약 (단순 첫 3문장 대신 핵심 문장 선택) */
export function summarizeLocal(text: string): string[] {
  const plain = text.replace(/\s+/g, " ").trim();
  if (!plain) return [];
  const sentences = plain
    .split(/(?<=[.!?。！？])\s+|[\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  if (!sentences.length) {
    for (let i = 0; i < 3 && i * 90 < plain.length; i++) {
      const line = cleanLine(plain.slice(i * 90, (i + 1) * 90));
      if (line) sentences.push(line);
    }
  }
  if (sentences.length <= 3) {
    return sentences.map(cleanLine).filter(Boolean).slice(0, 3);
  }

  // 단어 빈도
  const freq = new Map<string, number>();
  for (const s of sentences) {
    for (const w of tokenize(s)) freq.set(w, (freq.get(w) || 0) + 1);
  }
  const maxFreq = Math.max(1, ...freq.values());

  // 문장 점수: 단어 빈도 합 / 문장 길이 (정규화) + 위치 가중치
  const scored = sentences.map((s, idx) => {
    const words = tokenize(s);
    const wordScore = words.reduce((acc, w) => acc + (freq.get(w) || 0), 0) / Math.max(1, words.length);
    const norm = 1 / (1 + Math.abs(words.length - 12) * 0.05);
    const positionBoost = idx === 0 ? 0.35 : idx < 3 ? 0.15 : 0;
    const score = (wordScore / maxFreq) * norm + positionBoost;
    return { idx, s, score };
  });

  // 상위 3개 선택 후 원래 순서로 정렬
  const top = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.idx - b.idx);

  const out = top.map((t) => cleanLine(t.s)).filter(Boolean);
  if (!out.length) {
    return sentences.slice(0, 3).map(cleanLine).filter(Boolean);
  }
  return out.slice(0, 3);
}

/** 온디바이스 AI (Chrome Prompt API / Gemini Nano) 시도 — 사용 가능할 때만 */
async function tryOnDeviceSummary(text: string): Promise<string[] | null> {
  try {
    const LM = (window as unknown as { LanguageModel?: { availability?: () => Promise<string>; create?: (opts?: unknown) => Promise<{ prompt: (p: string) => Promise<string>; destroy?: () => void }> } }).LanguageModel;
    if (!LM || typeof LM.create !== "function") return null;
    if (typeof LM.availability === "function") {
      const avail = await LM.availability();
      if (avail !== "available" && avail !== "readily") return null;
    }
    const session = await LM.create({ temperature: 0.2, topK: 3 });
    const prompt = `다음 글을 한국어로 정확히 3줄로 요약해 주세요. 각 줄은 90자 이내, 불필요한 서론 없이 핵심만:\n\n${text.slice(0, 4000)}`;
    const raw = await session.prompt(prompt);
    try { session.destroy?.(); } catch { /* noop */ }
    const lines = String(raw || "")
      .split(/\n+/)
      .map((l) => cleanLine(l))
      .filter(Boolean)
      .slice(0, 3);
    if (lines.length >= 2) return lines;
    return null;
  } catch {
    return null;
  }
}

// 서버 생존 확인 결과를 60초 캐싱한다 — 서버 없는 학교에서 매번 7초를 기다리지 않게.
let serverAlive: { at: number; ok: boolean } | null = null;

async function serverAvailable(): Promise<boolean> {
  const now = Date.now();
  if (serverAlive && now - serverAlive.at < 60000) return serverAlive.ok;
  const ok = await api.healthCheck(); // 3초 안에 응답 없으면 false
  serverAlive = { at: now, ok };
  return ok;
}

/** 서버 상태가 바뀌면(로그인 등) 다음 호출에서 다시 확인하도록 초기화 */
export function resetAiServerCache(): void {
  serverAlive = null;
}

/** 공지/쪽지 → 3줄 요약. 서버 캐시 우선, 실패 시 로컬 추출로 폴백. */
export async function summarize3(text: string): Promise<SummaryResult> {
  const plain = String(text || "").trim();
  if (!plain) return { lines: [], source: "local" };
  const clipped = plain.slice(0, 8000);
  try {
    if (await serverAvailable()) {
      const r = await api.summarizeAi(clipped);
      if (r.ok && r.data?.ok && Array.isArray(r.data.lines) && r.data.lines.length) {
        const lines = r.data.lines.map(cleanLine).filter(Boolean).slice(0, 3);
        if (lines.length) {
          return {
            lines,
            source: r.data.source === "gemini" ? "gemini" : "local",
            cached: r.data.cached === true,
          };
        }
      }
    }
  } catch {
    /* 아래 로컬 폴백으로 */
  }
  // 서버가 없거나 실패한 경우: 온디바이스 AI(지원 런타임) 시도 → 실패 시 개선된 로컬 추출
  const onDevice = await tryOnDeviceSummary(clipped);
  if (onDevice && onDevice.length) {
    return { lines: onDevice, source: "local" };
  }
  return { lines: summarizeLocal(clipped), source: "local" };
}
