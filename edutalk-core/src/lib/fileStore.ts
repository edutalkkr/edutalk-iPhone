// 브리즈 파일 저장소 — IndexedDB 기반 (서버 없이도 동작하는 온프레미스 로컬 파일함)
//  · 용도: 브리즈 클라우드 파일, 쪽지/공지/설문 첨부의 바이너리 저장
//  · 메타(폴더·이름·공유범위)는 각 기능 모듈이 localStorage에 두고, 바이너리만 여기 보관한다.
//  · IndexedDB를 못 쓰는 환경(사생활 보호 모드 등)에서는 메모리 폴백으로 조용히 내려간다.

export interface FileBlobRecord {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

const DB_NAME = "breeze-files";
const STORE = "files";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryFallback = new Map<string, FileBlobRecord>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

/** 새 파일 id 생성 */
export function newFileId(prefix = "f"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 파일(Blob) 저장 → id 반환 */
export async function fsPut(id: string, blob: Blob, name: string, type?: string): Promise<string> {
  const rec: FileBlobRecord = {
    id,
    blob,
    name,
    type: type || blob.type || "application/octet-stream",
    size: blob.size,
    createdAt: new Date().toISOString(),
  };
  const ok = await tx("readwrite", (s) => s.put(rec) as unknown as IDBRequest<IDBValidKey>);
  if (ok === null) memoryFallback.set(id, rec);
  return id;
}

/** 파일 조회 */
export async function fsGet(id: string): Promise<FileBlobRecord | null> {
  const rec = await tx<FileBlobRecord>("readonly", (s) => s.get(id) as IDBRequest<FileBlobRecord>);
  if (rec) return rec;
  return memoryFallback.get(id) ?? null;
}

/** 파일 삭제 */
export async function fsDelete(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as unknown as IDBRequest<undefined>);
  memoryFallback.delete(id);
}

/** Blob → 브라우저 다운로드 (설치판·브라우저 공통) */
export function downloadBlob(name: string, blob: Blob): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "breeze-file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {
    /* 다운로드 실패는 조용히 무시 (상위에서 토스트) */
  }
}

/** 저장된 파일을 곧바로 다운로드 */
export async function fsDownload(id: string, name?: string): Promise<boolean> {
  const rec = await fsGet(id);
  if (!rec) return false;
  downloadBlob(name || rec.name, rec.blob);
  return true;
}

/** 파일 선택 대화상자 (브라우저 input 기반 — 설치판 WebView2에서도 동작) */
export function pickFiles(opts: { multiple?: boolean; directory?: boolean; accept?: string } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (opts.multiple) input.multiple = true;
    if (opts.accept) input.accept = opts.accept;
    if (opts.directory) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      resolve(files);
    };
    // 취소 감지(일부 브라우저는 change 없음): 포커스 복귀 시 지연 확인
    window.addEventListener(
      "focus",
      () => {
        window.setTimeout(() => {
          if (document.body.contains(input)) {
            const files = input.files ? Array.from(input.files) : [];
            input.remove();
            resolve(files);
          }
        }, 400);
      },
      { once: true }
    );
    input.click();
  });
}

/** 이미지 파일 → 데이터 URL (미리보기·작은 캡처용, 한도 초과 시 null) */
export function fileToDataUrl(file: Blob, maxBytes = 1.5 * 1024 * 1024): Promise<string | null> {
  return new Promise((resolve) => {
    if (file.size > maxBytes) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** 용량 표기 */
export function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

/** 저장소 사용량 (navigator.storage.estimate → 미지원 시 null) */
export async function storageQuota(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === "number" && typeof est.quota === "number") {
        return { usage: est.usage, quota: est.quota };
      }
    }
  } catch {
    /* 무시 */
  }
  return null;
}
