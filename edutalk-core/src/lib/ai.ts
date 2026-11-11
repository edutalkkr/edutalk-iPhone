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
    .replace(/^\s*(?:\d{1,3}[.)\]]\s*|[*•·\-–—]\s*)/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > 96) t = `${t.slice(0, 95)}…`;
  return t;
}

/** 토큰화 — 조사/어미를 떼어 같은 단어를 하나로 묶는다 (신청서를 = 신청서는) */
function stemKo(w: string): string {
  const stripped = w.replace(/(으로|에서|에게|까지|부터|보다|처럼|이며|이고|합니다|입니다|했다|한다|하는|하여|하고|으로써|은|는|이|가|을|를|의|에|께|로|와|과|도|만)$/u, "");
  return stripped.length > 1 ? stripped : w;
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z가-힣0-9]+/g) || [])
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stemKo)
    .filter((w) => w.length > 1);
}

/** 안내문에 자주 나오는 핵심 정보 표시 */
const KEY_HINTS = [
  "까지", "마감", "기한", "일시", "날짜", "시간", "장소", "대상",
  "신청", "제출", "참석", "준비물", "변경", "취소", "주의", "필수",
];

/** 줄머리 번호·불릿·인용 부호 제거 (연도 같은 숫자는 건드리지 않는다) */
function cleanSegment(s: string): string {
  return String(s || "")
    .replace(/^\s*(?:\d{1,3}[.)\]]\s*|[*•·\-–—]\s*)/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 인사말·마무리처럼 요약에 필요 없는 줄 */
const FILLER_ONLY = /^(안녕하세요|안녕하십니까|알려드립니다|안내드립니다|공지합니다|감사합니다|고맙습니다|이상입니다|수고하셨습니다)[.!]?$/;

/** 문장을 요약 줄로 다듬는다 — 인사말/마무리 상투어만 걷어내고 의미는 유지 */
function compressLine(s: string): string {
  let t = cleanLine(s)
    .replace(/^(안녕하세요|안녕하십니까|알려드립니다|안내드립니다|공지합니다)[.!]?\s*/, "")
    .replace(/\s*(감사합니다|고맙습니다|부탁드립니다|바랍니다|주시기 바랍니다|해 주시기 바랍니다|해주시기 바랍니다)[.!]?$/, "")
    .replace(/\s*(해 주세요|해주세요|하시기 바랍니다)[.!]?$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > 78) {
    const cut = Math.max(t.lastIndexOf(",", 78), t.lastIndexOf("·", 78), t.lastIndexOf(" ", 62));
    t = `${t.slice(0, cut > 40 ? cut : 77).trim()}…`;
  }
  return t;
}

/** 줄/문장을 요약 단위로 묶는다. 짧은 줄은 앞뒤와 합쳐 문맥을 살린다. */
function toUnits(text: string): string[] {
  const plain = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!plain) return [];
  let segments = plain
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?。！？])\s+/))
    .map(cleanSegment)
    .filter((s) => s.length >= 4 && !FILLER_ONLY.test(s) && !(s.length <= 26 && /(알려|안내|전달)드립니다[.!]?$/.test(s)));

  // 줄바꿈 없이 쉼표로만 이어진 긴 글은 절 단위로 나눈다.
  if (segments.length <= 1 && plain.length > 120) {
    segments = plain
      .split(/[,;]\s*|\s{2,}/)
      .map(cleanSegment)
      .filter((s) => s.length >= 8);
  }

  const units: string[] = [];
  let buf = "";
  for (const seg of segments) {
    if (!buf) buf = seg;
    // 제목·불릿처럼 끝맺음이 없는 짧은 줄만 다음 문장과 합친다.
    else if (buf.length < 42 && !/[.!?。！？]$/.test(buf)) buf = `${buf} ${seg}`;
    else {
      units.push(buf);
      buf = seg;
    }
  }
  if (buf) units.push(buf);
  return units;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 로컬 폴백: 핵심 문장 추출 + 압축 (첫 3줄을 그대로 복사하지 않는다) */
export function summarizeLocal(text: string): string[] {
  const units = toUnits(text);
  if (!units.length) return [];

  const freq = new Map<string, number>();
  for (const u of units) for (const w of tokenize(u)) freq.set(w, (freq.get(w) || 0) + 1);
  const maxFreq = Math.max(1, ...freq.values());

  const scored = units.map((s, idx) => {
    const words = tokenize(s);
    const avgFreq = words.reduce((acc, w) => acc + (freq.get(w) || 0), 0) / Math.max(1, words.length);
    const hintHits = KEY_HINTS.reduce((acc, h) => acc + (s.includes(h) ? 1 : 0), 0);
    const keyBoost = Math.min(0.36, hintHits * 0.12);
    // 위치는 약하게만 반영한다. 예전에는 앞 문장 가중치가 너무 커서 항상 첫 3줄이 뽑혔다.
    const positionBoost = idx === 0 ? 0.1 : idx === 1 ? 0.05 : 0;
    const lengthPenalty = words.length < 4 ? -0.12 : words.length > 45 ? -0.08 : 0;
    const looksLikeTitle = !/[.!?。！？]$/.test(s) && !/(합니다|입니다|됩니다|해요|이며|이고|있습니다|없습니다|하세요|주세요|까지|부터|에서|으로|에게)$/.test(s) && words.length <= 8;
    const titlePenalty = looksLikeTitle ? -0.18 : 0;
    const score = (avgFreq / maxFreq) * 0.6 + keyBoost + positionBoost + lengthPenalty + titlePenalty;
    return { idx, s, words: new Set(words), score };
  });

  const picked: typeof scored = [];
  for (const cand of scored.slice().sort((a, b) => b.score - a.score)) {
    if (picked.length >= 3) break;
    // 거의 같은 문장을 두 번 보여주지 않는다.
    if (picked.some((p) => jaccard(p.words, cand.words) > 0.5)) continue;
    picked.push(cand);
  }
  picked.sort((a, b) => a.idx - b.idx);

  const out = picked.map((p) => compressLine(p.s)).filter(Boolean);
  // 압축 후 중복 제거
  const seen = new Set<string>();
  const unique = out.filter((l) => {
    const k = l.replace(/[\s.,!?~…]/g, "");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.slice(0, 3);
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
