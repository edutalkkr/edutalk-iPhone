// 브리즈 오프라인 보관함 — IndexedDB 기반 (네트워크 단선 대비 · Offline Sync)
//  · 작성 중인 쪽지 초안(kind="draft")과, 오프라인에서 보낸 쪽지·대화(kind="memo"|"chat")를
//    이 PC(IndexedDB)에 임시 저장해 두어 네트워크가 끊겨도 글이 날아가지 않는다.
//  · 연결이 돌아오면 App 이 보관함을 비우며 P2P 전송을 자동으로 다시 시도한다 (자동 백업·전송).
//  · IndexedDB를 못 쓰는 환경(사생활 보호 모드 등)에서는 메모리 폴백으로 조용히 내려간다.
//    (fileStore와 같은 전략 — 앱이 멈추지 않게)

export type OutboxKind = "memo" | "chat" | "draft";

export interface OutboxMemoPayload {
  title: string;
  body: string;
  /** 수신자 uid 목록 — 전송 시점에 peer(교내 PC) 여부를 다시 확인한다 */
  toIds: string[];
}

export interface OutboxChatPayload {
  peerId: string;
  peerName: string;
  body: string;
}

export interface DraftPayload {
  title: string;
  body: string;
  toIds: string[];
  ccIds: string[];
  bccIds: string[];
  toSelf: boolean;
}

export interface OutboxItem {
  /** 쪽지 id / 대화 메시지 id / 초안은 "draft-memo" 고정 */
  id: string;
  kind: OutboxKind;
  createdAt: string;
  updatedAt: string;
  /** 전송 재시도 횟수 */
  tries: number;
  memo?: OutboxMemoPayload;
  chat?: OutboxChatPayload;
  draft?: DraftPayload;
}

const DB_NAME = "breeze-outbox";
const STORE = "items";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryFallback = new Map<string, OutboxItem>();

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

/** 새 보관 항목 만들기 (createdAt/updatedAt/tries 기본값 채움) */
export function newOutboxItem(
  init: Pick<OutboxItem, "id" | "kind"> & Partial<Omit<OutboxItem, "id" | "kind">>
): OutboxItem {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now, tries: 0, ...init };
}

/** 저장(덮어쓰기) */
export async function obPut(item: OutboxItem): Promise<void> {
  const rec: OutboxItem = { ...item, updatedAt: new Date().toISOString() };
  const ok = await tx("readwrite", (s) => s.put(rec) as unknown as IDBRequest<IDBValidKey>);
  if (ok === null) memoryFallback.set(rec.id, rec);
}

/** 단건 조회 */
export async function obGet(id: string): Promise<OutboxItem | null> {
  const rec = await tx<OutboxItem>("readonly", (s) => s.get(id) as IDBRequest<OutboxItem>);
  return rec ?? memoryFallback.get(id) ?? null;
}

/** 목록 (kinds 생략 시 전부) — 오래된 순 */
export async function obAll(kinds?: OutboxKind[]): Promise<OutboxItem[]> {
  const all = await tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
  const list = all ?? Array.from(memoryFallback.values());
  const filtered = kinds && kinds.length ? list.filter((x) => kinds.includes(x.kind)) : list;
  return filtered.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 삭제 */
export async function obDelete(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as unknown as IDBRequest<undefined>);
  memoryFallback.delete(id);
}

/** 개수 (kinds 생략 시 전부) */
export async function obCount(kinds?: OutboxKind[]): Promise<number> {
  return (await obAll(kinds)).length;
}
