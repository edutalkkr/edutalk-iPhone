// 브리즈 클라우드 메타 저장소 — 폴더·파일의 "정보"만 담는다 (zustand persist → localStorage).
//  · 바이너리(Blob)는 lib/fileStore 의 IndexedDB(breeze-files)에 두고, 여기에는 이름·크기·공유범위 같은
//    메타데이터만 두어 서버 없는 온프레미스 구조에서도 목록 로딩이 가볍다.
//  · 공유범위: private(나만) · dept(같은 부서만) · school(전교).
//  · 데모 시드는 store 초기화가 아니라 컴포넌트가 부른 seedIfEmpty()에서만 일어난다
//    (persist 복원이 초기화보다 늦게 적용되므로, 복원된 자료가 있으면 시드하면 안 된다).
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fsDelete, newFileId } from "./fileStore";

export type CloudScope = "private" | "dept" | "school";

export interface CloudFolder {
  id: string;
  name: string;
  parentId: string | null; // null = 최상위(루트)
  scope: CloudScope;
  ownerId: string;
  ownerName: string;
  ownerDept: string;
  createdAt: string; // ISO 문자열 (Date 파싱 없이 문자열 그대로 표시만 한다)
}

export interface CloudFileMeta {
  id: string;
  folderId: string; // "" = 루트에 바로 올린 파일
  name: string;
  size: number; // bytes
  type: string;
  storeId: string; // fileStore(IndexedDB)의 Blob id
  scope: CloudScope;
  ownerId: string;
  ownerName: string;
  ownerDept: string;
  createdAt: string;
}

/** 공유범위 판정 — private: 주인만 / dept: 같은 부서 / school: 전교 모두 */
export function visibleTo(
  meta: { scope: CloudScope; ownerId: string; ownerDept: string },
  me: { id: string; dept: string }
): boolean {
  if (meta.ownerId === me.id) return true;
  if (meta.scope === "private") return false;
  if (meta.scope === "dept") return meta.ownerDept === me.dept;
  return true;
}

interface CloudState {
  folders: CloudFolder[];
  files: CloudFileMeta[];
  /** 데모 시드 1회 완료 표시 — 사용자가 전부 지운 뒤 다시 심는 일이 없게 */
  seeded: boolean;
  /** 처음 한 번만 데모 구조 생성 (이미 자료가 있으면 아무것도 안 함) */
  seedIfEmpty: (me: { id: string; name: string; dept: string }) => void;
  /** 폴더 추가 → 생성된 폴더 반환 */
  addFolder: (f: Omit<CloudFolder, "id" | "createdAt">) => CloudFolder;
  renameFolder: (id: string, name: string) => void;
  /** 폴더 삭제 — 하위 폴더·파일과 저장된 Blob까지 재귀 삭제 */
  removeFolder: (id: string) => Promise<void>;
  setFolderScope: (id: string, scope: CloudScope) => void;
  /** 파일 메타 추가 → 생성된 메타 반환 */
  addFile: (f: Omit<CloudFileMeta, "id" | "createdAt">) => CloudFileMeta;
  renameFile: (id: string, name: string) => void;
  /** 파일 삭제 — Blob(IndexedDB)까지 삭제 */
  removeFile: (id: string) => Promise<void>;
  moveFile: (id: string, folderId: string) => void;
  setFileScope: (id: string, scope: CloudScope) => void;
  /** 학년말 인수인계 (Killer ④) — 전임(from)의 폴더·파일 소유권을 후임에게 넘긴다.
   *  · 지우지 않고 소유자(이름·부서 포함)만 바꾼다 → 공유범위(dept) 판정이 후임 부서 기준으로 동작.
   *  · 넘긴 개수 { folders, files } 를 돌려주어 감사 기록·화면 표시에 쓴다. */
  reassignOwner: (fromId: string, to: { id: string; name: string; dept: string }) => {
    folders: number;
    files: number;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useCloud = create<CloudState>()(
  persist(
    (set, get) => ({
      folders: [],
      files: [],
      seeded: false,

      seedIfEmpty: (me) => {
        const { seeded, folders, files } = get();
        if (seeded || folders.length > 0 || files.length > 0) return;
        const base = {
          parentId: null as string | null,
          ownerId: me.id,
          ownerName: me.name,
          ownerDept: me.dept,
          createdAt: nowIso(),
        };
        set({
          seeded: true,
          folders: [
            { ...base, id: newFileId("cld"), name: "📌 부서 공유함", scope: "dept" },
            { ...base, id: newFileId("cld"), name: "🏫 전교 자료실", scope: "school" },
            { ...base, id: newFileId("cld"), name: "🔒 내 파일함", scope: "private" },
          ],
        });
      },

      addFolder: (f) => {
        const folder: CloudFolder = { ...f, id: newFileId("cld"), createdAt: nowIso() };
        set((s) => ({ folders: [...s.folders, folder] }));
        return folder;
      },

      renameFolder: (id, name) =>
        set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) })),

      removeFolder: async (id) => {
        // 자손 폴더 수집 (잘못된 parentId 순환 대비 깊이 제한)
        const all = get().folders;
        const doomed = new Set<string>([id]);
        for (let depth = 0; depth < 64; depth += 1) {
          let grew = false;
          for (const f of all) {
            if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
              doomed.add(f.id);
              grew = true;
            }
          }
          if (!grew) break;
        }
        // 안에 있던 파일들의 Blob을 먼저 지운다 (실패해도 메타는 정리)
        const inside = get().files.filter((f) => doomed.has(f.folderId));
        await Promise.all(inside.map((f) => fsDelete(f.storeId).catch(() => undefined)));
        set((s) => ({
          folders: s.folders.filter((f) => !doomed.has(f.id)),
          files: s.files.filter((f) => !doomed.has(f.folderId)),
        }));
      },

      setFolderScope: (id, scope) =>
        set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, scope } : f)) })),

      addFile: (f) => {
        const meta: CloudFileMeta = { ...f, id: newFileId("clf"), createdAt: nowIso() };
        set((s) => ({ files: [...s.files, meta] }));
        return meta;
      },

      renameFile: (id, name) =>
        set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, name } : f)) })),

      removeFile: async (id) => {
        const target = get().files.find((f) => f.id === id);
        if (target) await fsDelete(target.storeId).catch(() => undefined);
        set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
      },

      moveFile: (id, folderId) =>
        set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, folderId } : f)) })),

      setFileScope: (id, scope) =>
        set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, scope } : f)) })),

      reassignOwner: (fromId, to) => {
        const { folders, files } = get();
        const moved = {
          folders: folders.filter((f) => f.ownerId === fromId).length,
          files: files.filter((f) => f.ownerId === fromId).length,
        };
        const patch = { ownerId: to.id, ownerName: to.name, ownerDept: to.dept };
        set((s) => ({
          folders: s.folders.map((f) => (f.ownerId === fromId ? { ...f, ...patch } : f)),
          files: s.files.map((f) => (f.ownerId === fromId ? { ...f, ...patch } : f)),
        }));
        return moved;
      },
    }),
    { name: "breeze-cloud" }
  )
);
