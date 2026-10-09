// 로컬 저장소 — 설치형(Tauri)에선 SQLite(scratch 명령), 브라우저 개발 중에선 localStorage.
// 같은 키이므로 실행 환경이 바뀌어도 자료가 이어진다.
import { call } from "./tauri";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function lsKey(key: string): string {
  return `edu-core-${key}`;
}

export async function storeGet<T>(key: string): Promise<T | null> {
  if (isTauri()) {
    try {
      const r = await call<{ id: string; body: string; updated_at: string }>("scratch_get", { id: `edu-core-${key}` });
      if (r && r.body) return JSON.parse(r.body) as T;
      return null;
    } catch {
      return null;
    }
  }
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* 처음 실행 */
  }
  return null;
}

export async function storeSet(key: string, value: unknown): Promise<void> {
  if (isTauri()) {
    try {
      await call("scratch_save", { id: `edu-core-${key}`, body: JSON.stringify(value) });
      return;
    } catch {
      /* 아래 폴백 */
    }
  }
  try {
    localStorage.setItem(lsKey(key), JSON.stringify(value));
  } catch {
    /* 용량 초과 시 무시 */
  }
}

export async function storeGetMany<T>(entries: [string, T][]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, fallback] of entries) {
    const v = await storeGet(key);
    out[key] = v == null ? fallback : v;
  }
  return out;
}
