// 서버 주도 OTA(자동 업데이트) — 5단계-3
// 학교 서버(onprem)에 새 설치본이 올라오면 확인 → 내려받기 → 조용히 설치한다.
// 실제 확인·내려받기·설치는 Rust(updater.rs)가 담당한다 (파일·검사값이 웹뷰 밖에서 움직이게).
import { call, listenEvent } from "../lib/tauri";

export type UpdateInfo = {
  version: string;
  file: string;
  size: number;
  sha256: string;
  notes?: string;
  mandatory?: boolean;
  security?: boolean;
  pub_date?: string;
};

export type FeedInfo = UpdateInfo & { url?: string };

export type RelayPhase = "download" | "upload" | "done";

export type RelayProgress = {
  phase: RelayPhase;
  received: number;
  total: number;
  done: boolean;
};

/** 새 버전 확인. 서버에 올라온 업데이트가 없으면 null. */
export async function checkUpdate(base: string): Promise<UpdateInfo | null> {
  const res = await call<{ ok?: boolean; update?: UpdateInfo | null } | null>("update_check", {
    base,
  });
  return res?.update ?? null;
}

/** 내려받기 → 저장된 설치 파일 경로 반환. onProgress(0~1, 총 용량을 모르면 -1). */
export async function downloadUpdate(
  base: string,
  info: UpdateInfo,
  onProgress?: (ratio: number) => void
): Promise<string> {
  let off: (() => void) | undefined;
  if (onProgress) {
    off = listenEvent("update-progress", (p) => {
      const d = p as { received?: number; total?: number; done?: boolean } | null;
      const total = d?.total || 0;
      if (d?.done) onProgress(1);
      else if (total > 0) onProgress(Math.min(0.99, (d?.received || 0) / total));
      else onProgress(-1);
    });
  }
  try {
    return await call<string>("update_download", {
      base,
      file: info.file,
      sha256: info.sha256,
    });
  } finally {
    if (off) off();
  }
}

/** 조용히 설치하고 앱을 다시 시작한다 (성공하면 창이 닫히고 새 버전으로 다시 열린다). */
export async function installUpdate(installer: string): Promise<void> {
  await call<void>("update_install", { installer });
}

/** 인터넷 공개 피드 확인 (인터넷이 되는 PC만). 새 버전이 없으면 null. */
export async function checkUpdateFeed(): Promise<FeedInfo | null> {
  const res = await call<{ ok?: boolean; update?: FeedInfo | null } | null>("update_feed_check");
  return res?.update ?? null;
}

/** 인터넷에서 받은 설치본을 학교 서버로 중계한다. 진행 단계는 onProgress 로 알린다. */
export async function relayUpdate(
  feed: FeedInfo,
  onProgress?: (p: RelayProgress) => void
): Promise<{ installer: string; update: UpdateInfo }> {
  let off: (() => void) | undefined;
  if (onProgress) {
    off = listenEvent("relay-progress", (p) => {
      const d = p as RelayProgress | null;
      if (d && d.phase) onProgress(d);
    });
  }
  try {
    return await call<{ installer: string; update: UpdateInfo }>("update_relay", { feed });
  } finally {
    if (off) off();
  }
}

/** 학교 전체 중계를 이 PC가 맡아도 되는지 서버에 10분 임차권을 요청한다. */
export async function claimUpdateRelay(version: string): Promise<boolean> {
  const res = await call<{ ok?: boolean; claim?: boolean } | null>("srv_post", {
    path: "/api/updates/claim",
    body: { version },
  });
  return res?.claim === true;
}

/** 동의를 거절했을 때 임차권을 돌려준다 (다른 PC가 이어서 시도할 수 있게). */
export async function releaseUpdateRelay(version: string): Promise<void> {
  try {
    await call("srv_post", { path: "/api/updates/release", body: { version } });
  } catch {
    /* 임차권은 10분 뒤 자동으로 풀린다 */
  }
}

/** 버전 비교: a > b 면 양수 ("0.2.2" > "0.2.1") */
export function compareVersions(a: string, b: string): number {
  const pa = String(a)
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(Number);
  const pb = String(b)
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
