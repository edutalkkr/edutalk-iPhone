// 브리즈 클라우드(파일함) 화면 — 교내 서버 없이도 동작하는 온프레미스 파일 관리자.
//  · 바이너리는 lib/fileStore(IndexedDB), 메타(폴더·이름·공유범위)는 lib/cloudStore(zustand persist).
//  · 업로드: 버튼/드래그앤드롭/폴더째 올리기 + FileReader 진행률·속도, 실패 시 재시도.
//  · 다운로드: 파일/폴더(하위 전체, 압축 없이 하나씩). 공유범위: 나만·부서·전교.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { bzConfirm } from "../ui/BzDialog";
import BzTooltip from "../ui/BzTooltip";
import { useContextMenu } from "../ui/BzContextMenu";
import type { BzMenuItem } from "../ui/BzContextMenu";
import {
  IconChevronLeft, IconChevronRight, IconCloudIcon, IconDotMenu, IconDownload, IconEdit,
  IconFile, IconFolder, IconPlus, IconSearch, IconTrash, IconUpload, IconX,
} from "../ui/BzIcons";
import { fileToDataUrl, fsDownload, fsGet, fsPut, humanSize, newFileId, pickFiles, storageQuota } from "../../lib/fileStore";
import { useCloud, visibleTo } from "../../lib/cloudStore";
import type { CloudFileMeta, CloudFolder, CloudScope } from "../../lib/cloudStore";
import { api } from "../../services/api";

interface CloudMe { id: string; name: string; dept: string; role?: "teacher" | "admin" | "superadmin"; }
interface Props { me: CloudMe; onToast: (t: string) => void; }

/** 전송 목록 한 줄 — 업로드/다운로드 공용 */
interface Transfer {
  id: string;
  name: string;
  kind: "upload" | "download";
  progress: number; // 0..100
  status: "running" | "done" | "fail";
  speed: string; // 예: "2.3MB/s" (읽는 동안만)
  note?: string; // 실패 사유·상태 메모
}

const SCOPE_LABEL: Record<CloudScope, string> = { private: "🔒 나만", dept: "📌 부서", school: "🏫 전교" };
const SCOPE_ORDER: CloudScope[] = ["private", "dept", "school"];

/** 파일 이름·MIME으로 종류 글리프 선택 (BzIcons에 파일종류별 아이콘이 없어 문서형 글리프 사용) */
function fileGlyph(name: string, type: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "🖼️";
  if (type.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "📽️";
  if (type.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "🎵";
  if (ext === "pdf") return "📕";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📑";
  if (["doc", "docx", "hwp", "hwpx", "txt", "md", "odt"].includes(ext)) return "📝";
  if (["zip", "7z", "rar", "alz", "egg"].includes(ext)) return "📦";
  return "📄";
}

function isImageFile(name: string, type: string): boolean {
  return type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes((name.split(".").pop() ?? "").toLowerCase());
}

/** FileReader 기반 업로드 읽기 — onprogress로 실제 진행률을 받는다 */
function readWithProgress(file: File, onProgress: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    reader.onload = () => { if (reader.result instanceof ArrayBuffer) resolve(reader.result); else reject(new Error("파일을 읽지 못했어요")); };
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했어요"));
    reader.onabort = () => reject(new Error("읽기가 취소됐어요"));
    reader.readAsArrayBuffer(file);
  });
}

function sortKo<T>(arr: T[], key: (x: T) => string): T[] {
  return [...arr].sort((a, b) => key(a).localeCompare(key(b), "ko"));
}

export default function CloudPane(p: Props) {
  const onToast = p.onToast;
  const openMenu = useContextMenu();

  const folders = useCloud((s) => s.folders);
  const files = useCloud((s) => s.files);
  const seedIfEmpty = useCloud((s) => s.seedIfEmpty);
  const addFolder = useCloud((s) => s.addFolder);
  const renameFolder = useCloud((s) => s.renameFolder);
  const removeFolder = useCloud((s) => s.removeFolder);
  const setFolderScope = useCloud((s) => s.setFolderScope);
  const addFile = useCloud((s) => s.addFile);
  const renameFile = useCloud((s) => s.renameFile);
  const removeFile = useCloud((s) => s.removeFile);
  const setFileScope = useCloud((s) => s.setFileScope);

  const me = useMemo(() => ({ id: p.me.id, name: p.me.name, dept: p.me.dept }), [p.me.id, p.me.name, p.me.dept]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [deep, setDeep] = useState(false); // 검색: 현재 폴더 ↔ 전체 폴더
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [nfName, setNfName] = useState("");
  const [nfScope, setNfScope] = useState<CloudScope>("private");
  const [editing, setEditing] = useState<{ id: string; kind: "file" | "folder"; name: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string; storeId: string } | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [showTransfers, setShowTransfers] = useState(true);
  const [dragOn, setDragOn] = useState(false);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const retryRef = useRef(new Map<string, () => void>());
  const dragDepth = useRef(0);

  /* ---------- 기본 준비: 데모 시드 · 용량 ---------- */
  useEffect(() => { seedIfEmpty(me); }, [seedIfEmpty, me]); // store가 "이미 자료 있으면 무시"를 보장한다
  const refreshQuota = useCallback(() => { void storageQuota().then(setQuota); }, []);
  useEffect(() => { refreshQuota(); }, [refreshQuota]);
  useEffect(() => {
    if (currentId && !folders.some((f) => f.id === currentId)) setCurrentId(null); // 다른 창에서 지운 경우 방어
  }, [currentId, folders]);

  /* ---------- 폴더 경로·보이는 목록 ---------- */
  const folderById = useMemo(() => {
    const m = new Map<string, CloudFolder>();
    for (const f of folders) m.set(f.id, f);
    return m;
  }, [folders]);
  const pathOf = useCallback((id: string | null): CloudFolder[] => {
    const out: CloudFolder[] = [];
    let cur = id ? folderById.get(id) : undefined;
    for (let guard = 0; cur && guard < 64; guard += 1) { out.unshift(cur); cur = cur.parentId ? folderById.get(cur.parentId) : undefined; }
    return out;
  }, [folderById]);
  const path = useMemo(() => pathOf(currentId), [pathOf, currentId]);
  const currentFolder = currentId ? folderById.get(currentId) ?? null : null;
  const visFolders = useMemo(() => folders.filter((f) => visibleTo(f, me)), [folders, me]);
  const visFiles = useMemo(() => files.filter((f) => visibleTo(f, me)), [files, me]);
  const curKey = currentId ?? ""; // 루트 파일은 folderId ""
  const roomFolders = useMemo(() => sortKo(visFolders.filter((f) => f.parentId === currentId), (f) => f.name), [visFolders, currentId]);
  const roomFiles = useMemo(() => sortKo(visFiles.filter((f) => f.folderId === curKey), (f) => f.name), [visFiles, curKey]);

  const sq = q.trim().toLowerCase();
  const deepList = deep && sq.length > 0;
  const listFolders = useMemo(() => (deepList ? [] : roomFolders.filter((f) => !sq || f.name.toLowerCase().includes(sq))), [roomFolders, sq, deepList]);
  const listFiles = useMemo(
    () => sortKo(deepList ? visFiles.filter((f) => f.name.toLowerCase().includes(sq)) : roomFiles.filter((f) => !sq || f.name.toLowerCase().includes(sq)), (f) => f.name),
    [roomFiles, visFiles, sq, deepList]
  );
  const localUsage = useMemo(() => visFiles.reduce((s, f) => s + Math.max(0, f.size), 0), [visFiles]);

  /* ---------- 전송 목록 ---------- */
  const pushTransfer = useCallback((t: Transfer) => { setTransfers((arr) => [t, ...arr].slice(0, 60)); }, []);
  const patchTransfer = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers((arr) => arr.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  /** 업로드 1건 — 읽기 진행률(0~90) → 저장(95~100), 속도는 Bytes/ms→MB/s */
  const uploadOne = useCallback(async (tid: string, file: File, folderId: string | null): Promise<boolean> => {
    const t0 = Date.now();
    const scope: CloudScope = folderId ? useCloud.getState().folders.find((x) => x.id === folderId)?.scope ?? "private" : "private";
    patchTransfer(tid, { status: "running", progress: 0, speed: "", note: "읽는 중" });
    try {
      const buf = await readWithProgress(file, (loaded, total) => {
        const pct = total > 0 ? Math.max(1, Math.min(90, Math.round((loaded / total) * 90))) : 5;
        const mbs = (loaded / Math.max(1, Date.now() - t0)) * 1000 / (1024 * 1024);
        patchTransfer(tid, { progress: pct, speed: `${mbs.toFixed(mbs >= 10 ? 0 : 1)}MB/s` });
      });
      patchTransfer(tid, { progress: 95, note: "저장 중", speed: "" });
      const type = file.type || "application/octet-stream";
      const storeId = await fsPut(newFileId("cf"), new Blob([buf], { type }), file.name, type);
      addFile({ folderId: folderId ?? "", name: file.name, size: file.size, type, storeId, scope, ownerId: me.id, ownerName: me.name, ownerDept: me.dept });
      patchTransfer(tid, { status: "done", progress: 100, note: "", speed: "" });
      void api.logActivity("cloud_upload", { name: file.name, size: file.size, scope });
      return true;
    } catch (err) {
      patchTransfer(tid, { status: "fail", note: err instanceof Error ? err.message : "올리지 못했어요" });
      return false;
    }
  }, [patchTransfer, addFile, me]);

  /** 여러 파일 순차 업로드 (실패분은 전송 목록에서 재시도 가능) */
  const runUploads = useCallback(async (targets: { file: File; folderId: string | null }[], label: string) => {
    if (!targets.length) return;
    setShowTransfers(true);
    let ok = 0;
    for (const t of targets) {
      const tid = newFileId("tr");
      pushTransfer({ id: tid, name: t.file.name, kind: "upload", progress: 0, status: "running", speed: "" });
      retryRef.current.set(tid, () => { void uploadOne(tid, t.file, t.folderId).then((r) => { if (r) refreshQuota(); }); });
      if (await uploadOne(tid, t.file, t.folderId)) ok += 1;
    }
    refreshQuota();
    if (ok === targets.length) onToast(`${label} ${ok}개를 올렸어요.`);
    else onToast(`${label} ${targets.length}개 중 ${ok}개만 올렸어요. 전송 목록에서 재시도할 수 있어요.`);
  }, [pushTransfer, uploadOne, refreshQuota, onToast]);

  /** 폴더 업로드 — webkitRelativePath의 구조를 그대로 만들고(이름+부모 중복 제거) 순차 업로드 */
  const uploadFolderTree = useCallback(async (list: File[], baseId: string | null) => {
    if (!list.length) return;
    const created = new Map<string, string>(); // 상대경로 → 폴더 id
    const baseScope: CloudScope = baseId ? useCloud.getState().folders.find((x) => x.id === baseId)?.scope ?? "private" : "private";
    const targets: { file: File; folderId: string | null }[] = [];
    for (const file of list) {
      const rel = (file.webkitRelativePath && file.webkitRelativePath.length > 0 ? file.webkitRelativePath : file.name).split("/").filter(Boolean);
      rel.pop(); // 마지막 조각은 파일명
      let parentId = baseId;
      let acc = "";
      for (const seg of rel) {
        acc = acc ? `${acc}/${seg}` : seg;
        let id = created.get(acc);
        if (!id) {
          const found = useCloud.getState().folders.find((x) => x.name === seg && x.parentId === parentId && visibleTo(x, me));
          id = found ? found.id : addFolder({ name: seg, parentId, scope: baseScope, ownerId: me.id, ownerName: me.name, ownerDept: me.dept }).id;
          created.set(acc, id);
        }
        parentId = id;
      }
      targets.push({ file, folderId: parentId });
    }
    await runUploads(targets, "폴더 파일");
  }, [addFolder, me, runUploads]);

  /* ---------- 다운로드 ---------- */
  const downloadOne = useCallback(async (storeId: string, name: string, tid: string): Promise<boolean> => {
    patchTransfer(tid, { status: "running", progress: 15, speed: "", note: "내려받는 중" });
    const ok = await fsDownload(storeId, name);
    if (!ok) { patchTransfer(tid, { status: "fail", progress: 100, note: "저장된 파일을 찾지 못했어요" }); return false; }
    patchTransfer(tid, { status: "done", progress: 100, note: "", speed: "" });
    return true;
  }, [patchTransfer]);

  const doDownload = useCallback((f: CloudFileMeta) => {
    const tid = newFileId("tr");
    setShowTransfers(true);
    pushTransfer({ id: tid, name: f.name, kind: "download", progress: 0, status: "running", speed: "" });
    retryRef.current.set(tid, () => { void downloadOne(f.storeId, f.name, tid); });
    void downloadOne(f.storeId, f.name, tid).then((ok) => { if (!ok) onToast(`"${f.name}" 파일을 찾지 못했어요. 저장소에서 지워졌을 수 있어요.`); });
  }, [pushTransfer, downloadOne, onToast]);

  const doDownloadFolder = useCallback(async (folder: CloudFolder) => {
    const ids = new Set<string>([folder.id]);
    for (let depth = 0; depth < 64; depth += 1) {
      let grew = false;
      for (const f of folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
      if (!grew) break;
    }
    const inside = sortKo(files.filter((f) => ids.has(f.folderId) && visibleTo(f, me)), (f) => f.name);
    if (!inside.length) { onToast("내려받을 파일이 없어요."); return; }
    setShowTransfers(true);
    let ok = 0;
    for (const f of inside) {
      const tid = newFileId("tr");
      pushTransfer({ id: tid, name: f.name, kind: "download", progress: 0, status: "running", speed: "" });
      retryRef.current.set(tid, () => { void downloadOne(f.storeId, f.name, tid); });
      if (await downloadOne(f.storeId, f.name, tid)) ok += 1;
    }
    onToast(`"${folder.name}" 안의 파일 ${ok}/${inside.length}개를 내려받았어요.`);
  }, [folders, files, me, pushTransfer, downloadOne, onToast]);

  /* ---------- 열기·미리보기·이름변경·삭제 ---------- */
  const openFolder = useCallback((f: CloudFolder) => { setCurrentId(f.id); setQ(""); setPreview(null); setSelectedId(null); }, []);
  const doPreview = useCallback(async (f: CloudFileMeta) => {
    const rec = await fsGet(f.storeId);
    if (!rec) { onToast("파일을 찾지 못했어요. 저장소에서 지워졌을 수 있어요."); return; }
    const url = await fileToDataUrl(rec.blob, 2 * 1024 * 1024);
    if (!url) { onToast("2MB 이하 그림만 바로 미리 볼 수 있어요. 내려받아 확인해 주세요."); return; }
    setPreview({ name: f.name, url, storeId: f.storeId });
  }, [onToast]);
  const openFile = useCallback((f: CloudFileMeta) => { if (isImageFile(f.name, f.type)) void doPreview(f); else doDownload(f); }, [doPreview, doDownload]);

  const commitRename = useCallback(() => {
    const ed = editing;
    if (!ed) return;
    setEditing(null);
    const name = ed.name.trim();
    if (!name) { onToast("이름을 비워 둘 수 없어요."); return; }
    if (ed.kind === "folder") { if (folderById.get(ed.id)?.name !== name) renameFolder(ed.id, name); }
    else if (files.find((f) => f.id === ed.id)?.name !== name) renameFile(ed.id, name);
  }, [editing, folderById, files, renameFolder, renameFile, onToast]);

  const confirmRemoveFile = useCallback(async (f: CloudFileMeta) => {
    const ok = await bzConfirm({
      title: "파일을 삭제할까요?",
      message: `"${f.name}"을(를) 클라우드 목록과 로컬 저장소에서 완전히 지워요.`,
      confirmText: "삭제", danger: true,
    });
    if (!ok) return;
    await removeFile(f.id);
    refreshQuota();
    if (preview?.storeId === f.storeId) setPreview(null);
    void api.logActivity("cloud_delete_file", { name: f.name });
    onToast("파일을 삭제했어요.");
  }, [removeFile, refreshQuota, preview, onToast]);

  const confirmRemoveFolder = useCallback(async (f: CloudFolder) => {
    const ok = await bzConfirm({ title: "폴더를 삭제할까요?", message: `"${f.name}" 안의 하위 폴더와 파일도 함께 지워져요.`, confirmText: "삭제", danger: true });
    if (!ok) return;
    await removeFolder(f.id);
    refreshQuota();
    onToast("폴더를 삭제했어요.");
  }, [removeFolder, refreshQuota, onToast]);

  const createFolder = useCallback(() => {
    const name = nfName.trim();
    if (!name) { onToast("폴더 이름을 적어 주세요."); return; }
    if (roomFolders.some((f) => f.name === name)) { onToast("같은 이름의 폴더가 이미 있어요."); return; }
    addFolder({ name, parentId: currentId, scope: nfScope, ownerId: me.id, ownerName: me.name, ownerDept: me.dept });
    setNfName("");
    setShowNewFolder(false);
    onToast("폴더를 만들었어요.");
  }, [nfName, roomFolders, addFolder, currentId, nfScope, me, onToast]);

  /* ---------- 우클릭 메뉴 (네이티브 메뉴 대체) ---------- */
  const scopeItems = (cur: CloudScope, apply: (s: CloudScope) => void): BzMenuItem[] =>
    SCOPE_ORDER.map((s) => ({
      id: `scope-${s}`, label: `공유범위 · ${SCOPE_LABEL[s]}`, hint: cur === s ? "현재" : undefined, disabled: cur === s, onSelect: () => apply(s),
    }));

  const folderMenu = (f: CloudFolder): BzMenuItem[] => [
    { id: "open", label: "열기", icon: <IconFolder size={14} />, onSelect: () => openFolder(f) },
    { id: "ren", label: "이름 바꾸기", icon: <IconEdit size={14} />, onSelect: () => setEditing({ id: f.id, kind: "folder", name: f.name }) },
    { id: "dl", label: "폴더 내려받기", icon: <IconDownload size={14} />, hint: "안의 파일 전체", onSelect: () => void doDownloadFolder(f) },
    { id: "sep1", separator: true },
    ...scopeItems(f.scope, (s) => setFolderScope(f.id, s)),
    { id: "sep2", separator: true },
    { id: "del", label: "삭제", icon: <IconTrash size={14} />, danger: true, onSelect: () => void confirmRemoveFolder(f) },
  ];

  const fileMenu = (f: CloudFileMeta): BzMenuItem[] => {
    const img = isImageFile(f.name, f.type);
    const items: BzMenuItem[] = [{ id: "open", label: img ? "미리보기" : "다운로드", icon: img ? <IconFile size={14} /> : <IconDownload size={14} />, onSelect: () => openFile(f) }];
    if (img) items.push({ id: "dl", label: "다운로드", icon: <IconDownload size={14} />, onSelect: () => doDownload(f) });
    if (deepList && sq) items.push({ id: "go", label: "폴더 위치 열기", icon: <IconFolder size={14} />, onSelect: () => { setCurrentId(f.folderId || null); setQ(""); setDeep(false); } });
    items.push(
      { id: "ren", label: "이름 바꾸기", icon: <IconEdit size={14} />, onSelect: () => setEditing({ id: f.id, kind: "file", name: f.name }) },
      { id: "sep1", separator: true },
      ...scopeItems(f.scope, (s) => { setFileScope(f.id, s); onToast(`공유범위를 ${SCOPE_LABEL[s]}(으)로 바꿨어요.`); }),
      { id: "sep2", separator: true },
      { id: "del", label: "삭제", icon: <IconTrash size={14} />, danger: true, onSelect: () => void confirmRemoveFile(f) }
    );
    return items;
  };

  /* ---------- 업로드 트리거·드래그앤드롭·전송 목록 조작 ---------- */
  const onPickFiles = useCallback(async () => {
    const picked = await pickFiles({ multiple: true });
    if (picked.length) await runUploads(picked.map((file) => ({ file, folderId: currentId })), "파일");
  }, [runUploads, currentId]);

  const onPickFolder = useCallback(async () => {
    const picked = await pickFiles({ directory: true, multiple: true });
    if (picked.length) await uploadFolderTree(picked, currentId);
  }, [uploadFolderTree, currentId]);

  const retryTransfer = (id: string) => {
    const fn = retryRef.current.get(id);
    if (!fn) { onToast("재시도 정보가 사라졌어요. 파일을 다시 선택해 주세요."); return; }
    fn();
  };

  const clearDone = () => {
    for (const t of transfers) if (t.status !== "running") retryRef.current.delete(t.id);
    setTransfers(transfers.filter((t) => t.status === "running"));
  };

  /* ---------- 렌더 ---------- */
  const runningCount = transfers.filter((t) => t.status === "running").length;
  const usedPct = quota && quota.quota > 0 ? Math.min(100, Math.round((quota.usage / quota.quota) * 100)) : 0;
  const rowGhost = "w-6 h-6 grid place-items-center rounded-lg text-edu-muted hover:bg-edu-chip shrink-0";
  const castStyle = (width: string): CSSProperties => ({ width });

  return (
    <div
      className="edu-card flex flex-col h-full min-h-[420px] overflow-hidden anim-page"
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setDragOn(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { e.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragOn(false); } }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragOn(false);
        const dropped = Array.from(e.dataTransfer.files);
        if (dropped.length) void runUploads(dropped.map((file) => ({ file, folderId: currentId })), "드롭한 파일");
      }}
    >
      {/* ── 상단: 위치(빵부스러기) + 검색 + 동작 버튼 ── */}
      <div className="px-3 pt-3 pb-2 border-b border-edu-line bg-edu-surface">
        <div className="flex items-center gap-1.5">
          <BzTooltip content={currentId ? "상위 폴더로" : "맨 위예요"}>
            <button className="edu-ghost !px-2 !py-1.5 shrink-0" disabled={!currentId} aria-label="상위 폴더로"
              onClick={() => setCurrentId(currentFolder?.parentId ?? null)}>
              <IconChevronLeft size={14} />
            </button>
          </BzTooltip>
          <nav className="flex items-center gap-1 min-w-0 flex-1 text-[13px] font-bold overflow-hidden">
            <button className={`flex items-center gap-1 shrink-0 ${currentId ? "text-edu-sub hover:text-edu-strong" : "text-edu-strong"}`}
              onClick={() => { setCurrentId(null); setQ(""); }}>
              <IconCloudIcon size={15} /> 클라우드
            </button>
            {path.map((f) => (
              <span key={f.id} className="flex items-center gap-1 min-w-0">
                <IconChevronRight size={12} className="text-edu-muted shrink-0" />
                <button className={`truncate max-w-[130px] ${f.id === currentId ? "text-edu-strong" : "text-edu-sub hover:text-edu-strong"}`}
                  onClick={() => { setCurrentId(f.id); setQ(""); }}>
                  {f.name}
                </button>
              </span>
            ))}
          </nav>
        </div>

        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <div className="relative flex-1 min-w-[150px]">
            <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-edu-muted pointer-events-none" />
            <input className="edu-input !py-2 !pl-8 !pr-7 !text-[12.5px]" placeholder="이름으로 검색" value={q} maxLength={40}
              onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-edu-muted hover:text-edu-ink" aria-label="검색 지우기" onClick={() => setQ("")}>
                <IconX size={14} />
              </button>
            )}
          </div>
          {sq.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <button className={`px-2 py-1 rounded-full text-[11.5px] font-bold border ${!deep ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                onClick={() => setDeep(false)}>이 폴더</button>
              <BzTooltip content="모든 폴더에서 이름으로 찾기">
                <button className={`px-2 py-1 rounded-full text-[11.5px] font-bold border ${deep ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                  onClick={() => setDeep(true)}>전체 폴더</button>
              </BzTooltip>
            </div>
          )}
        </div>

        <div className="mt-2 rounded-lg bg-edu-chip border border-edu-line px-2.5 py-1.5 text-[11px] leading-relaxed text-edu-sub font-semibold">
          💾 저장 위치: <b className="text-edu-strong">이 PC의 브라우저 저장공간(IndexedDB)</b>이에요. 학교 서버나 Firebase를 쓰지 않아서 다른 PC·학생 화면과 자동으로 공유되지 않아요.
        </div>

        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <BzTooltip content="이 위치에 새 폴더 만들기">
            <button className="edu-ghost" onClick={() => setShowNewFolder((v) => !v)}>
              <span className="flex items-center gap-1"><IconPlus size={13} /> 새 폴더</span>
            </button>
          </BzTooltip>
          <BzTooltip content="내 PC에서 파일 올리기 — 이 화면에 끌어다 놓아도 돼요">
            <button className="edu-btn !px-3 !py-2 !text-[12.5px]" onClick={() => void onPickFiles()}>
              <span className="flex items-center gap-1"><IconUpload size={13} /> 파일 업로드</span>
            </button>
          </BzTooltip>
          <BzTooltip content="폴더째 올리기 — 하위 폴더 구조가 그대로 만들어져요">
            <button className="edu-ghost" onClick={() => void onPickFolder()}>
              <span className="flex items-center gap-1"><IconFolder size={13} /> 폴더 업로드</span>
            </button>
          </BzTooltip>
        </div>
      </div>

      {/* ── 그림 미리보기 (2MB 이하) ── */}
      {preview && (
        <div className="m-2 mb-0 p-2 flex items-center gap-2 rounded-xl border border-edu-blueline bg-edu-soft anim-card">
          <img src={preview.url} alt={preview.name} className="w-14 h-14 object-cover rounded-lg border border-edu-line shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-bold truncate">{preview.name}</div>
            <div className="text-[11px] text-edu-sub">그림 미리보기</div>
          </div>
          <BzTooltip content="다운로드">
            <button className="edu-ghost !px-2.5 !py-1.5" aria-label="미리보기 파일 다운로드"
              onClick={() => { const f = files.find((x) => x.storeId === preview.storeId); if (f) doDownload(f); }}>
              <IconDownload size={13} />
            </button>
          </BzTooltip>
          <BzTooltip content="미리보기 닫기">
            <button className="edu-ghost !px-2.5 !py-1.5" aria-label="미리보기 닫기" onClick={() => setPreview(null)}><IconX size={13} /></button>
          </BzTooltip>
        </div>
      )}

      {/* ── 목록 (폴더 → 파일) ── */}
      <div className="relative flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {showNewFolder && !deepList && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 mb-1 rounded-xl border border-edu-blueline bg-edu-soft anim-card flex-wrap">
            <IconFolder size={15} className="text-edu-strong shrink-0" />
            <input autoFocus className="edu-input !py-1.5 !text-[12.5px] flex-1 min-w-[90px]" placeholder="폴더 이름" value={nfName} maxLength={40}
              onChange={(e) => setNfName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setShowNewFolder(false); }} />
            <select className="edu-input !w-[104px] !py-1.5 !text-[12px] shrink-0" value={nfScope} onChange={(e) => setNfScope(e.target.value as CloudScope)}>
              {SCOPE_ORDER.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
            </select>
            <button className="edu-btn !px-2.5 !py-1.5 !text-[12px]" onClick={createFolder}>만들기</button>
            <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px]" onClick={() => setShowNewFolder(false)}>취소</button>
          </div>
        )}

        <div className="flex flex-col anim-list">
          {listFolders.map((f) => (
            <div key={f.id} role="button" tabIndex={0} className="flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-edu-hover cursor-default select-none"
              onClick={() => openFolder(f)} onKeyDown={(e) => { if (e.key === "Enter") openFolder(f); }}
              onContextMenu={(e) => openMenu(e, folderMenu(f), f.name)}>
              <IconFolder size={16} className="text-edu-blue shrink-0" />
              {editing?.id === f.id && editing.kind === "folder" ? (
                <input autoFocus className="edu-input !py-1 !text-[12.5px] flex-1 min-w-0" value={editing.name} maxLength={40}
                  onClick={(e) => e.stopPropagation()} onChange={(e) => setEditing({ id: f.id, kind: "folder", name: e.target.value })}
                  onBlur={commitRename} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(null); }} />
              ) : (
                <span className="flex-1 min-w-0 truncate text-[13px] font-bold">{f.name}</span>
              )}
              <span className="text-[10.5px] text-edu-muted shrink-0 hidden min-[480px]:inline">{SCOPE_LABEL[f.scope]}</span>
              <span className="text-[11px] text-edu-sub shrink-0 hidden min-[580px]:inline max-w-[76px] truncate">{f.ownerName}</span>
              <span className="text-[11px] text-edu-muted shrink-0 hidden min-[700px]:inline tabular-nums">{f.createdAt.slice(0, 10)}</span>
              <button className={rowGhost} aria-label="폴더 메뉴" onClick={(e) => openMenu(e, folderMenu(f), f.name)}><IconDotMenu size={13} /></button>
            </div>
          ))}

          {listFiles.map((f) => (
            <div key={f.id} role="button" tabIndex={0}
              className={`flex items-center gap-2 px-2 py-2 rounded-xl cursor-default select-none ${selectedId === f.id ? "bg-edu-soft" : "hover:bg-edu-hover"}`}
              onClick={() => { setSelectedId(f.id); if (isImageFile(f.name, f.type)) void doPreview(f); }}
              onDoubleClick={() => openFile(f)} onKeyDown={(e) => { if (e.key === "Enter") openFile(f); }}
              onContextMenu={(e) => openMenu(e, fileMenu(f), f.name)}>
              <span className="w-4 text-center shrink-0 text-[14px] leading-none" aria-hidden>{fileGlyph(f.name, f.type)}</span>
              {editing?.id === f.id && editing.kind === "file" ? (
                <input autoFocus className="edu-input !py-1 !text-[12.5px] flex-1 min-w-0" value={editing.name} maxLength={80}
                  onClick={(e) => e.stopPropagation()} onChange={(e) => setEditing({ id: f.id, kind: "file", name: e.target.value })}
                  onBlur={commitRename} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(null); }} />
              ) : (
                <BzTooltip className="flex-1 min-w-0" content={`${f.name}\n${humanSize(f.size)} · ${f.ownerName}${f.scope !== "private" ? ` · ${SCOPE_LABEL[f.scope]}` : ""}`}>
                  <span className="block min-w-0 w-full truncate text-[13px] text-left">{f.name}</span>
                </BzTooltip>
              )}
              {deepList && sq ? (
                <span className="text-[10.5px] text-edu-muted shrink-0 hidden min-[560px]:inline max-w-[150px] truncate">
                  📂 {pathOf(f.folderId || null).map((x) => x.name).join(" / ") || "클라우드"}
                </span>
              ) : null}
              <span className="text-[11px] text-edu-sub shrink-0 tabular-nums w-14 text-right">{humanSize(f.size)}</span>
              <span className="text-[11px] text-edu-sub shrink-0 hidden min-[580px]:inline max-w-[76px] truncate">{f.ownerName}</span>
              <span className="text-[11px] text-edu-muted shrink-0 hidden min-[700px]:inline tabular-nums">{f.createdAt.slice(0, 10)}</span>
              <button className={rowGhost} aria-label="파일 메뉴" onClick={(e) => openMenu(e, fileMenu(f), f.name)}><IconDotMenu size={13} /></button>
            </div>
          ))}
        </div>

        {listFolders.length === 0 && listFiles.length === 0 && (
          <div className="bz-empty">
            <IconFile size={30} className="text-edu-muted" />
            <strong className="mt-2">{sq ? "검색 결과가 없어요" : "이 폴더는 비어 있어요"}</strong>
            <span>{sq ? "다른 이름으로 찾아보거나 ‘전체 폴더’를 켜 보세요." : "첫 파일을 올려 보세요. 폴더째 끌어다 놓아도 돼요."}</span>
            {!sq && (
              <button className="edu-btn mt-3" onClick={() => void onPickFiles()}>
                <span className="flex items-center gap-1"><IconUpload size={14} /> 첫 파일 올리기</span>
              </button>
            )}
          </div>
        )}

        {/* 드래그 오버레이 — 파일을 끌고 오면 점선 테두리로 강조 */}
        {dragOn && (
          <div className="absolute inset-1 z-10 rounded-2xl border-2 border-dashed border-edu-blue bg-edu-soft/80 grid place-items-center pointer-events-none">
            <div className="text-center px-3">
              <IconUpload size={26} className="text-edu-strong" />
              <div className="text-[13px] font-bold text-edu-strong mt-1">
                여기에 놓으면 {currentFolder ? `"${currentFolder.name}"에` : "클라우드에"} 올라가요
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 전송 목록 (접기/펴기) ── */}
      {transfers.length > 0 && (
        <div className="border-t border-edu-line bg-edu-surface">
          <div className="flex items-center gap-1.5 px-3 py-1.5">
            <button className="flex items-center gap-1.5 flex-1 min-w-0 text-[12px] font-bold text-edu-sub text-left" onClick={() => setShowTransfers((v) => !v)}>
              <IconUpload size={12} className={runningCount > 0 ? "text-edu-blue animate-pulse" : ""} />
              전송 목록 {runningCount > 0 ? `· 진행 ${runningCount} · ` : "· "}전체 {transfers.length}
              <IconChevronRight size={11} className={`transition-transform duration-200 ${showTransfers ? "rotate-90" : ""}`} />
            </button>
            {transfers.some((t) => t.status !== "running") && (
              <BzTooltip content="끝난 전송 기록 지우기">
                <button className="edu-ghost !px-2 !py-1 !text-[11px]" onClick={clearDone}>완료 지우기</button>
              </BzTooltip>
            )}
          </div>
          {showTransfers && (
            <div className="px-2 pb-2 max-h-36 overflow-y-auto flex flex-col gap-1">
              {transfers.map((t) => (
                <div key={t.id} className="flex items-center gap-1.5 rounded-lg bg-edu-chip px-2 py-1.5">
                  <span className="text-[11px] shrink-0" aria-hidden>{t.kind === "upload" ? "⬆" : "⬇"}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{t.name}</span>
                  <span className="w-16 shrink-0 h-1.5 rounded-full bg-edu-surface overflow-hidden">
                    <i className={`block h-full rounded-full transition-[width] duration-200 ${t.status === "fail" ? "bg-edu-danger" : t.status === "done" ? "bg-edu-green" : "bg-edu-blue"}`}
                      style={castStyle(`${Math.max(2, Math.min(100, t.progress))}%`)} />
                  </span>
                  <span className="w-8 text-right text-[10.5px] tabular-nums text-edu-sub shrink-0">{t.progress}%</span>
                  {t.status === "fail" ? (
                    <BzTooltip content={t.note || "실패한 전송 다시 시도"}>
                      <button className="edu-ghost !px-2 !py-0.5 !text-[11px] shrink-0" onClick={() => retryTransfer(t.id)}>재시도</button>
                    </BzTooltip>
                  ) : (
                    <span className={`w-14 text-right text-[10.5px] shrink-0 ${t.status === "done" ? "text-edu-green font-bold" : "text-edu-muted"}`}>
                      {t.status === "done" ? "완료" : t.speed || t.note || (t.kind === "upload" ? "올리는 중" : "받는 중")}
                    </span>
                  )}
                </div>
              ))}
              {transfers.some((t) => t.status === "fail") && (
                <div className="text-[10.5px] text-edu-muted px-1">실패한 전송은 [재시도]로 다시 올릴 수 있어요. 다시 고르라고 하면 파일을 새로 선택해 주세요.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 저장공간(용량) 막대 ── */}
      <div className="border-t border-edu-line bg-edu-surface px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-edu-sub">
          <BzTooltip content={quota ? "브라우저 저장공간(IndexedDB) 사용량이에요" : "저장공간을 셀 수 없는 환경이라 클라우드 파일 크기 합계로 보여줘요"}>
            <span className="font-bold shrink-0 tabular-nums">
              {quota ? `사용 ${humanSize(quota.usage)} / ${humanSize(quota.quota)}` : `내 파일함 사용량 ${humanSize(localUsage)}`}
            </span>
          </BzTooltip>
          <span className="flex-1 h-1.5 rounded-full bg-edu-chip overflow-hidden">
            <i className="block h-full rounded-full bg-edu-blue transition-[width] duration-300"
              style={castStyle(`${quota ? usedPct : Math.min(100, Math.max(1, (localUsage / (256 * 1024 * 1024)) * 100))}%`)} />
          </span>
          {quota && <span className="tabular-nums shrink-0">{usedPct}%</span>}
        </div>
      </div>
    </div>
  );
}
