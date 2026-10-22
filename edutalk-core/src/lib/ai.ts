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

/** 로컬 폴백: 문장을 골라 최대 3줄 */
export function summarizeLocal(text: string): string[] {
  const plain = text.replace(/\s+/g, " ").trim();
  if (!plain) return [];
  const parts = plain
    .split(/(?<=[.!?。！？])\s+|[\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  const out: string[] = [];
  for (const p of parts) {
    const line = cleanLine(p);
    if (line && !out.includes(line)) out.push(line);
    if (out.length >= 3) break;
  }
  if (!out.length) {
    // 문장 구분이 없으면 길이 기준으로 잘라 3줄
    for (let i = 0; i < 3 && i * 90 < plain.length; i++) {
      out.push(cleanLine(plain.slice(i * 90, (i + 1) * 90)));
    }
  }
  return out.slice(0, 3);
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
  return { lines: summarizeLocal(clipped), source: "local" };
}
