// 쪽지함 (관리함) — 2026-10 개편
//  · 관리함 필터: 전체 / 중요(★) / 안읽음 + 중요도 칩 + 통합 검색
//  · 이메일형 쓰기: TO / CC(참조) / BCC(숨은참조) · 첨부 · 나에게 보내기 · 예약 발송
//  · Enter는 줄바꿈만 — 발송은 [보내기] 버튼 클릭으로만 (AGENTS.md 핵심 규칙)
//  · 7초 발송 취소(Undo Send) 플로팅 바
//  · 상세: 회신 / 전체회신 / 전달 / 퀵 메모 저장 / 별표 / 읽기 전 회수 / 수신확인표 / 댓글

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Memo, MemoAttachment, MemoComment, Teacher } from "../../types";
import { ME_ID } from "../../mock/initialData";
import { HoldButton, TemplatesBar } from "../ComposerExtras";
import PollBox from "../PollBox";
import BzTooltip from "../ui/BzTooltip";
import { useContextMenu } from "../ui/BzContextMenu";
import { bzConfirm } from "../ui/BzDialog";
import { fsDownload, humanSize, newFileId, pickFiles, fsPut } from "../../lib/fileStore";
import { newOutboxItem, obDelete, obGet, obPut } from "../../lib/outbox";
import {
  IconCamera,
  IconEye,
  IconForward,
  IconPaperclip,
  IconReply,
  IconSearch,
  IconSend,
  IconStar,
  IconStickyNote,
  IconUndo,
  IconX,
} from "../ui/BzIcons";

const UNDO_SECONDS = 7;

export interface MemoSendExtras {
  attachments?: MemoAttachment[];
  ccIds?: string[];
  bccIds?: string[];
  toSelf?: boolean;
  reservedAt?: string | null;
  undo?: boolean;
}

interface Props {
  memos: Memo[];
  comments: Record<string, MemoComment[]>;
  teachers: Teacher[];
  openId: string | null;
  presetTo?: Teacher | null;
  /** 퀵 메모 등에서 넘어온 쪽지 초안 */
  draft?: { title?: string; body: string } | null;
  onDraftConsumed?: () => void;
  onOpen: (id: string | null) => void;
  onSend: (
    title: string,
    body: string,
    toIds: string[],
    hwpName: string,
    importance: Memo["importance"],
    extras?: MemoSendExtras
  ) => { ok: boolean; error?: string; memoId?: string };
  onUndoSend?: (memoId: string) => void;
  onRecall?: (memoId: string) => void;
  onStar?: (memoId: string, starred: boolean) => void;
  onQuickSave?: (memo: Memo) => void;
  onNudge: (memoId: string, uid: string) => void;
  onComment: (memoId: string, body: string) => void;
  onImportance: (memoId: string, imp: Memo["importance"]) => void;
  onToast: (t: string) => void;
  onGoChat?: () => void;
  onAudit: (kind: "RRN" | "PHONE" | "SCORE" | "CARD" | "PASSWORD" | "HWP", text: string, blocked: boolean) => void;
}

export function scanDlp(text: string): { blocked: boolean; reason: string; kind: "RRN" | "PHONE" | "SCORE" | "CARD" | "PASSWORD" | null } {
  if (/\d{6}[- ]?\d{7}/.test(text)) return { blocked: true, reason: "주민등록번호로 보이는 번호가 들어있어요.", kind: "RRN" };
  if (/\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/.test(text)) return { blocked: true, reason: "카드번호로 보이는 번호가 들어있어요.", kind: "CARD" };
  if (/(비밀번호|패스워드|password|passwd)\s*[:=]\s*\S{4,}/i.test(text)) return { blocked: true, reason: "비밀번호로 보이는 문구가 들어있어요.", kind: "PASSWORD" };
  if (/01[016789]-?\d{3,4}-?\d{4}/.test(text)) return { blocked: false, reason: "휴대폰 번호로 보이는 번호가 들어있어요.", kind: "PHONE" };
  if (/(국어|수학|영어)\s*:\s*\d{1,3}\s*점/.test(text)) return { blocked: false, reason: "성적 표현이 들어있어요.", kind: "SCORE" };
  return { blocked: false, reason: "", kind: null };
}

function timeLabel(iso: string | null | undefined): string {
  return (iso ?? "").slice(5, 16).replace("T", " ");
}

// ── 리치 텍스트(서식) ─────────────────────────────────────────────
// 본문에 **굵게** / *기울임* / __밑줄__ / • 목록 마커를 쓰면 읽기 화면에서 서식으로 보인다.
// HTML을 그대로 렌더하지 않으므로 스크립트 삽입(XSS) 위험이 없다.
function parseInline(line: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const t = m[0];
    const key = `${keyBase}-${k++}`;
    if (t.startsWith("**")) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("__")) out.push(<u key={key}>{t.slice(2, -2)}</u>);
    else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function renderRich(text: string): ReactNode {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={`ln-${i}`}>
          {line.startsWith("• ") ? <span className="text-edu-blue">• </span> : null}
          {parseInline(line.startsWith("• ") ? line.slice(2) : line, `i-${i}`)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  );
}

export default function MemoPane(p: Props) {
  // "이 사람에게 쪽지"로 열리면 바로 쓰기 탭으로 시작한다 (팝업 창 대응)
  const [tab, setTab] = useState<"received" | "sent" | "write">(() => (p.presetTo || p.draft ? "write" : "received"));
  const [q, setQ] = useState("");
  const [manage, setManage] = useState<"all" | "star" | "unread">("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [toIds, setToIds] = useState<string[]>(p.presetTo ? [p.presetTo.id] : []);
  const [ccIds, setCcIds] = useState<string[]>([]);
  const [bccIds, setBccIds] = useState<string[]>([]);
  const [ccOpen, setCcOpen] = useState(false);
  const [bccOpen, setBccOpen] = useState(false);
  const [toSelf, setToSelf] = useState(false);
  const [reservedAt, setReservedAt] = useState("");
  const [atts, setAtts] = useState<MemoAttachment[]>([]);
  const [hwp, setHwp] = useState("");
  const [imp, setImp] = useState<Memo["importance"]>("normal");
  const [warn, setWarn] = useState("");
  const [warnKey, setWarnKey] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [impFilter, setImpFilter] = useState<"all" | Memo["importance"]>("all");
  const [undoState, setUndoState] = useState<{ memoId: string; remaining: number } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const openMenu = useContextMenu();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // 선택한 글자를 서식 마커로 감싼다 (없으면 "텍스트" 자리표시)
  const wrapSel = (marker: string) => {
    const el = bodyRef.current;
    const s = el?.selectionStart ?? body.length;
    const e = el?.selectionEnd ?? body.length;
    const sel = body.slice(s, e) || "텍스트";
    const next = body.slice(0, s) + marker + sel + marker + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      try {
        el?.setSelectionRange(s + marker.length, s + marker.length + sel.length);
      } catch {
        /* 선택 위치가 사라져도 계속 진행 */
      }
    });
  };

  // 현재 줄 맨 앞에 목록 기호(•)를 넣는다
  const addBullet = () => {
    const el = bodyRef.current;
    const pos = el?.selectionStart ?? body.length;
    const lineStart = body.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
    setBody(body.slice(0, lineStart) + "• " + body.slice(lineStart));
    requestAnimationFrame(() => el?.focus());
  };

  // 조직도에서 "쪽지 보내기"로 넘어오면 받는 사람을 갱신한다 (첫 마운트 이후 변경 대응)
  useEffect(() => {
    if (p.presetTo) {
      setToIds((s) => (s.includes(p.presetTo!.id) ? s : [...s, p.presetTo!.id].slice(0, 20)));
      setTab("write");
    }
  }, [p.presetTo]);

  // 퀵 메모 → 쪽지 초안 반영
  useEffect(() => {
    if (!p.draft) return;
    setTitle(p.draft.title ?? "");
    setBody(p.draft.body);
    setTab("write");
    p.onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.draft]);

  // ── 오프라인 초안 자동 저장 (IndexedDB) ─────────────────────────────
  //  · 작성 중인 쪽지를 0.8초 디바운스로 이 PC에 저장한다 — 네트워크가 끊기거나 앱이 닫혀도 글이 날아가지 않는다.
  //  · 다시 열면 초안을 복원하고 안내 배너를 띄운다. 보내거나 [비우기]를 누르면 지운다.
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    let alive = true;
    void obGet("draft-memo").then((rec) => {
      if (!alive) return;
      if (rec && rec.kind === "draft" && rec.draft) {
        const d = rec.draft;
        if (d.title.trim() || d.body.trim()) {
          setTitle((s) => (s ? s : d.title));
          setBody((s) => (s ? s : d.body));
          setToIds((s) => (s.length ? s : d.toIds));
          setCcIds((s) => (s.length ? s : d.ccIds));
          setBccIds((s) => (s.length ? s : d.bccIds));
          if (d.toSelf) setToSelf(true);
          setDraftRestored(true);
          setTab("write");
        }
      }
      setDraftReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const hasContent = !!(title.trim() || body.trim() || toIds.length || ccIds.length || bccIds.length || toSelf);
    const t = window.setTimeout(() => {
      if (!hasContent) {
        void obDelete("draft-memo");
        return;
      }
      void obPut(
        newOutboxItem({
          id: "draft-memo",
          kind: "draft",
          draft: { title, body, toIds, ccIds, bccIds, toSelf },
        })
      );
    }, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReady, title, body, toIds, ccIds, bccIds, toSelf]);

  // 7초 Undo 카운트다운
  useEffect(() => {
    if (!undoState) return;
    const t = window.setInterval(() => {
      setUndoState((u) => {
        if (!u) return null;
        if (u.remaining <= 1) return null;
        return { ...u, remaining: u.remaining - 1 };
      });
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoState?.memoId]);

  // 회수된 쪽지는 어느 목록에도 보이지 않는다
  const active = useMemo(() => p.memos.filter((m) => !m.recalledAt), [p.memos]);
  const received = useMemo(() => active.filter((m) => m.to.some((r) => r.uid === ME_ID)), [active]);
  const sent = useMemo(() => active.filter((m) => m.fromUid === ME_ID), [active]);
  const base = tab === "received" ? received : sent;

  const isUnread = (m: Memo): boolean => {
    if (tab === "received") return m.to.some((r) => r.uid === ME_ID && !r.readAt);
    return m.to.some((r) => r.uid !== ME_ID && !r.readAt);
  };

  const list = useMemo(() => {
    let arr = base;
    if (manage === "star") arr = arr.filter((m) => m.starred);
    if (manage === "unread") arr = arr.filter(isUnread);
    if (impFilter !== "all") arr = arr.filter((m) => m.importance === impFilter);
    const s = q.trim();
    if (!s) return arr;
    return arr.filter((m) =>
      `${m.title} ${m.body} ${m.fromName} ${m.to.map((r) => r.name).join(" ")}`.includes(s)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, q, impFilter, manage, tab]);

  const open = p.memos.find((m) => m.id === p.openId && !m.recalledAt) ?? null;
  const openComments = open ? p.comments[open.id] ?? [] : [];
  const openHasUnread = open ? open.to.some((r) => !r.readAt) : false;
  const canRecall = !!open && open.fromUid === ME_ID && !open.sentAt ? openHasUnread : false;

  const others = p.teachers.filter((t) => t.id !== ME_ID);

  const toggleId = (list: string[], setList: (v: string[]) => void, id: string, limit = 20) => {
    if (list.includes(id)) {
      setList(list.filter((x) => x !== id));
      return;
    }
    if (list.length >= limit) {
      p.onToast(`최대 ${limit}명까지 고를 수 있어요.`);
      return;
    }
    setList([...list, id]);
  };

  const pickRecipient = (list: string[], setList: (v: string[]) => void, id: string, limit = 20) => {
    // 같은 사람이 TO/CC/BCC에 중복되지 않게 조정한다 (이메일 규칙)
    setToIds((s) => s.filter((x) => x !== id));
    setCcIds((s) => s.filter((x) => x !== id));
    setBccIds((s) => s.filter((x) => x !== id));
    toggleId(list, setList, id, limit);
  };

  const attachFiles = async () => {
    if (attaching) return;
    setAttaching(true);
    try {
      const files = await pickFiles({ multiple: true });
      if (!files.length) return;
      const out: MemoAttachment[] = [];
      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) {
          p.onToast(`${f.name}은(는) 25MB를 넘어 첨부하지 않았어요.`);
          continue;
        }
        const storeId = newFileId("ma");
        await fsPut(storeId, f, f.name, f.type);
        out.push({ id: storeId, name: f.name, size: f.size, type: f.type, storeId });
      }
      if (out.length) {
        setAtts((s) => [...s, ...out].slice(0, 10));
        p.onToast(`파일 ${out.length}개를 첨부했어요.`);
      }
    } finally {
      setAttaching(false);
    }
  };

  // 화면 캡처 — 브라우저 화면 공유로 한 장을 찍어 첨부한다 (Tauri WebView2에서는 안 될 수 있어 안내로 대체)
  const captureScreen = async () => {
    try {
      const md = navigator.mediaDevices;
      if (!md?.getDisplayMedia) {
        p.onToast("이 환경에서는 화면 캡처를 쓸 수 없어요. 파일 첨부를 이용해 주세요.");
        return;
      }
      const stream = await md.getDisplayMedia({ video: true });
      try {
        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        await video.play().catch(() => undefined);
        await new Promise((r) => setTimeout(r, 350));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, video.videoWidth);
        canvas.height = Math.max(1, video.videoHeight);
        const g = canvas.getContext("2d");
        if (!g) {
          p.onToast("화면 캡처를 만들지 못했어요.");
          return;
        }
        g.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const att: MemoAttachment = {
          id: newFileId("cap"),
          name: `화면캡처_${stamp}.png`,
          size: Math.round(dataUrl.length * 0.75),
          type: "image/png",
          dataUrl,
        };
        setAtts((s) => (s.length >= 10 ? s : [...s, att]));
        p.onToast("화면을 캡처해 첨부했어요.");
      } finally {
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      p.onToast("화면 캡처가 취소됐어요.");
    }
  };

  const resetDraft = () => {
    setTitle("");
    setBody("");
    setToIds([]);
    setCcIds([]);
    setBccIds([]);
    setToSelf(false);
    setReservedAt("");
    setAtts([]);
    setHwp("");
    setWarn("");
    setWarnKey("");
    // 이 PC에 저장된 초안도 함께 지운다 (보냈거나 비우기를 눌렀을 때)
    setDraftRestored(false);
    void obDelete("draft-memo");
  };

  const doSend = () => {
    const recipients = toSelf ? [ME_ID] : toIds;
    if (!title.trim()) return p.onToast("제목을 적어 주세요.");
    if (!body.trim() && !atts.length) return p.onToast("내용을 적어 주세요.");
    if (!recipients.length && !ccIds.length && !bccIds.length) return p.onToast("받는 사람을 1명 이상 골라 주세요.");
    const textKey = `${title.trim()}\n${body.trim()}`;
    const hit = scanDlp(textKey);
    if (hit.blocked) {
      p.onAudit(hit.kind ?? "RRN", `${title.trim()} :: ${body.trim().slice(0, 60)}`, true);
      setWarn(`보안 경고: 개인정보 유출 감지 (${hit.reason}) 전송이 멈췄어요. 감사로그에 기록했어요.`);
      setWarnKey("");
      return;
    }
    if (hit.kind) {
      p.onAudit(hit.kind, `${title.trim()} :: ${body.trim().slice(0, 60)}`, false);
      if (warnKey !== textKey) {
        setWarn(`주의: ${hit.reason} 그래도 보내려면 다시 보내기를 눌러 주세요.`);
        setWarnKey(textKey);
        return;
      }
    }
    const r = p.onSend(title.trim(), body.trim(), recipients, hwp.trim(), imp, {
      attachments: atts,
      ccIds: toSelf ? [] : ccIds,
      bccIds: toSelf ? [] : bccIds,
      toSelf,
      reservedAt: reservedAt ? new Date(reservedAt).toISOString() : null,
      undo: true,
    });
    if (r.ok) {
      resetDraft();
      setTab("sent");
      if (r.memoId && !reservedAt) setUndoState({ memoId: r.memoId, remaining: UNDO_SECONDS });
    } else p.onToast(r.error ?? "보내지 못했어요.");
  };

  const startReply = (m: Memo, all: boolean) => {
    const targets = all
      ? [m.fromUid, ...m.to.filter((r) => !r.cc && !r.bcc).map((r) => r.uid)]
      : [m.fromUid];
    const uniq = Array.from(new Set(targets.filter((id) => id !== ME_ID))).slice(0, 20);
    setTitle(m.title.startsWith("RE:") ? m.title : `RE: ${m.title}`);
    setBody(`\n\n───── 원문 (${m.fromName} · ${timeLabel(m.createdAt)}) ─────\n${m.body}`);
    setToIds(uniq);
    setCcIds([]);
    setBccIds([]);
    setToSelf(false);
    setAtts([]);
    setTab("write");
    p.onToast(all ? "전체 회신 초안을 만들었어요." : "회신 초안을 만들었어요.");
  };

  const startForward = (m: Memo) => {
    setTitle(m.title.startsWith("FWD:") ? m.title : `FWD: ${m.title}`);
    setBody(`\n\n───── 전달된 쪽지 (${m.fromName} · ${timeLabel(m.createdAt)}) ─────\n${m.body}`);
    setToIds([]);
    setCcIds([]);
    setBccIds([]);
    setToSelf(false);
    if (m.attachments?.length) setAtts(m.attachments);
    setTab("write");
    p.onToast("전달 초안을 만들었어요.");
  };

  const rowMenu = (m: Memo) => [
    { id: "open", label: "열기", onSelect: () => p.onOpen(m.id) },
    {
      id: "star",
      label: m.starred ? "중요 해제" : "중요 표시 (★)",
      icon: <IconStar size={14} filled={!!m.starred} />,
      onSelect: () => p.onStar?.(m.id, !m.starred),
    },
    { id: "sep1", separator: true },
    { id: "reply", label: "회신", icon: <IconReply size={14} />, onSelect: () => startReply(m, false) },
    { id: "replyAll", label: "전체 회신", icon: <IconReply size={14} />, onSelect: () => startReply(m, true) },
    { id: "fwd", label: "전달", icon: <IconForward size={14} />, onSelect: () => startForward(m) },
    {
      id: "quick",
      label: "퀵 메모로 저장",
      icon: <IconStickyNote size={14} />,
      onSelect: () => p.onQuickSave?.(m),
    },
    { id: "sep2", separator: true },
    {
      id: "recall",
      label: "읽기 전 회수",
      icon: <IconUndo size={14} />,
      danger: true,
      disabled: !(m.fromUid === ME_ID && !m.sentAt && m.to.some((r) => !r.readAt)),
      onSelect: async () => {
        const ok = await bzConfirm({
          title: "쪽지를 회수할까요?",
          message: "아직 아무도 읽지 않아 회수할 수 있어요. 상대의 쪽지함에서도 사라져요.",
          confirmText: "회수",
          danger: true,
        });
        if (ok) p.onRecall?.(m.id);
      },
    },
  ];

  const closeUndo = () => {
    if (undoState) p.onUndoSend?.(undoState.memoId);
    setUndoState(null);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="edu-card p-3.5 anim-card">
        <div className="edu-filterbar flex items-center gap-1.5 flex-wrap">
          {(["received", "sent", "write"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-xl text-[13px] font-bold ${tab === t ? "bg-edu-soft text-edu-strong" : "text-edu-sub hover:bg-edu-chip"}`}
            >
              {t === "received" ? `받은 쪽지 (${received.length})` : t === "sent" ? `보낸 쪽지 (${sent.length})` : "✏️ 쓰기"}
            </button>
          ))}
          {tab !== "write" && (
            <div className="relative ml-auto">
              <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-edu-muted" />
              <input
                className="edu-input !w-[170px] !py-1.5 !text-[12.5px] !pl-7"
                placeholder="통합 검색 (제목·내용·이름)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={40}
              />
            </div>
          )}
          {p.onGoChat && (
            <BzTooltip content="가벼운 1:1 대화로 이동" position="bottom">
              <button className="px-3 py-1.5 rounded-xl text-[13px] font-bold text-edu-strong hover:bg-edu-chip" onClick={p.onGoChat}>
                💬 빠른 대화
              </button>
            </BzTooltip>
          )}
        </div>
        {tab !== "write" && (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {(["all", "star", "unread"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setManage(f)}
                className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold inline-flex items-center gap-1 ${manage === f ? "bg-edu-soft text-edu-strong ring-1 ring-edu-blueline" : "bg-edu-chip text-edu-sub"}`}
              >
                {f === "star" ? <IconStar size={12} filled={manage === f} /> : null}
                {f === "all" ? "전체" : f === "star" ? "중요" : "안읽음"}
              </button>
            ))}
            <span className="w-px bg-edu-line mx-1" aria-hidden />
            {(["all", "urgent", "normal", "ref"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setImpFilter(f)}
                className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold ${impFilter === f ? "bg-edu-soft text-edu-strong" : "bg-edu-chip text-edu-sub"}`}
              >
                {f === "all" ? "전체" : f === "urgent" ? "긴급" : f === "normal" ? "일반" : "참고"}
              </button>
            ))}
          </div>
        )}
        {tab === "write" ? (
          <div className="mt-3 flex flex-col gap-2" ref={toolbarRef}>
            {draftRestored && (
              <div className="flex items-center gap-2 text-[12px] bg-edu-soft border border-edu-blueline rounded-xl px-3 py-1.5">
                <span className="flex-1">📝 작성 중이던 초안을 불러왔어요 (이 PC에 자동 저장된 내용)</span>
                <button className="text-edu-strong font-bold" onClick={() => { resetDraft(); p.onToast("초안을 비웠어요."); }}>
                  비우기
                </button>
              </div>
            )}
            <TemplatesBar
              onInsert={(t) => setBody((s) => (s ? `${s}\n${t}` : t))}
              getCurrent={() => ({ title, body })}
              onToast={p.onToast}
            />
            <input className="edu-input" placeholder="제목 (예: [가정통신문] 동의서 회수)" value={title} onChange={(e) => { setTitle(e.target.value); setWarnKey(""); }} maxLength={80} />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setToSelf((v) => !v)}
                className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${toSelf ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
              >
                {toSelf ? "✓ " : ""}나에게 보내기
              </button>
              <button
                onClick={() => setCcOpen((v) => !v)}
                className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${ccOpen || ccIds.length ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
              >
                참조 {ccIds.length ? `(${ccIds.length})` : ""}
              </button>
              <button
                onClick={() => setBccOpen((v) => !v)}
                className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${bccOpen || bccIds.length ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
              >
                숨은참조 {bccIds.length ? `(${bccIds.length})` : ""}
              </button>
              <BzTooltip content="파일 첨부 (최대 10개 · 개당 25MB)" position="bottom">
                <button className="ml-auto edu-ghost !px-2.5 !py-1.5 !text-[12px] inline-flex items-center gap-1" onClick={() => void attachFiles()} disabled={attaching}>
                  <IconPaperclip size={13} /> {attaching ? "첨부 중…" : `첨부 ${atts.length || ""}`}
                </button>
              </BzTooltip>
              <BzTooltip content="화면 캡처를 찍어 바로 첨부" position="bottom">
                <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px] inline-flex items-center gap-1" onClick={() => void captureScreen()}>
                  <IconCamera size={13} /> 캡처
                </button>
              </BzTooltip>
            </div>
            {!toSelf && (
              <div>
                <div className="text-[11.5px] font-bold text-edu-sub mb-1">받는 사람 (TO)</div>
                <div className="flex gap-1.5 flex-wrap">
                  {others.length === 0 && (
                    <span className="text-[12px] text-edu-sub">받는 사람이 없어요. 조직도에서 교사를 먼저 등록해 주세요.</span>
                  )}
                  {others.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => pickRecipient(toIds, setToIds, t.id)}
                      className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${toIds.includes(t.id) ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                    >
                      {toIds.includes(t.id) ? "✓ " : ""}{t.name}{t.subject ? `·${t.subject}` : ""}
                    </button>
                  ))}
                </div>
                {ccOpen && (
                  <>
                    <div className="text-[11.5px] font-bold text-edu-sub mb-1 mt-2">참조 (CC)</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {others.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => pickRecipient(ccIds, setCcIds, t.id)}
                          className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${ccIds.includes(t.id) ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                        >
                          {ccIds.includes(t.id) ? "✓ " : ""}{t.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {bccOpen && (
                  <>
                    <div className="text-[11.5px] font-bold text-edu-sub mb-1 mt-2">숨은참조 (BCC) — 다른 수신자에게 보이지 않아요</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {others.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => pickRecipient(bccIds, setBccIds, t.id)}
                          className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${bccIds.includes(t.id) ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                        >
                          {bccIds.includes(t.id) ? "✓ " : ""}{t.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11.5px] font-bold text-edu-sub">서식</span>
              <BzTooltip content="선택한 글자를 굵게 (**텍스트**)" position="bottom">
                <button type="button" className="w-7 h-7 grid place-items-center rounded-lg border border-edu-line text-[13px] font-black hover:bg-edu-chip" onClick={() => wrapSel("**")}>
                  B
                </button>
              </BzTooltip>
              <BzTooltip content="선택한 글자를 기울임 (*텍스트*)" position="bottom">
                <button type="button" className="w-7 h-7 grid place-items-center rounded-lg border border-edu-line text-[13px] italic hover:bg-edu-chip" onClick={() => wrapSel("*")}>
                  I
                </button>
              </BzTooltip>
              <BzTooltip content="선택한 글자에 밑줄 (__텍스트__)" position="bottom">
                <button type="button" className="w-7 h-7 grid place-items-center rounded-lg border border-edu-line text-[13px] underline hover:bg-edu-chip" onClick={() => wrapSel("__")}>
                  U
                </button>
              </BzTooltip>
              <BzTooltip content="현재 줄을 목록(•)으로" position="bottom">
                <button type="button" className="h-7 px-2 grid place-items-center rounded-lg border border-edu-line text-[13px] font-bold hover:bg-edu-chip" onClick={addBullet}>
                  • 목록
                </button>
              </BzTooltip>
            </div>
            <textarea
              ref={bodyRef}
              className="edu-input min-h-[130px]"
              placeholder="내용 (Enter는 줄바꿈 — 보내기는 오른쪽 아래 [보내기] 버튼으로만)"
              value={body}
              onChange={(e) => { setBody(e.target.value); setWarnKey(""); }}
              maxLength={2000}
            />
            {atts.length > 0 && (
              <div className="flex flex-col gap-1">
                {atts.map((a) => (
                  <div key={a.id} className="flex items-center gap-1.5 text-[12px] bg-edu-bg border border-edu-line rounded-lg px-2 py-1">
                    <IconPaperclip size={12} className="text-edu-muted" />
                    <span className="truncate flex-1">{a.name}</span>
                    <span className="text-edu-muted shrink-0">{humanSize(a.size)}</span>
                    <button className="text-edu-sub hover:text-[#D92D20] px-1" onClick={() => setAtts((s) => s.filter((x) => x.id !== a.id))} aria-label="첨부 제거">
                      <IconX size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input className="edu-input" placeholder="HWP 첨부명 (선택 · 예: 동의서.hwp)" value={hwp} onChange={(e) => setHwp(e.target.value)} />
              <select className="edu-input !w-[110px]" value={imp} onChange={(e) => setImp(e.target.value as Memo["importance"])}>
                <option value="normal">일반</option>
                <option value="urgent">긴급</option>
                <option value="ref">참고</option>
              </select>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11.5px] font-bold text-edu-sub">예약 발송</span>
              <input
                type="datetime-local"
                className="edu-input !w-[210px] !py-1.5 !text-[12.5px]"
                value={reservedAt}
                onChange={(e) => setReservedAt(e.target.value)}
              />
              {reservedAt && (
                <button className="text-[11.5px] font-bold text-edu-strong" onClick={() => setReservedAt("")}>예약 취소</button>
              )}
              <span className="text-[11.5px] text-edu-sub">예약하면 시간이 될 때 자동으로 나가요 (업무/공지 탭 예약 쪽지함에서 확인)</span>
            </div>
            {warn && <div className="text-[12.5px] font-bold text-[#B42318] bg-[#FFF0F1] border border-[#F5C6C6] rounded-xl px-3 py-2">{warn}</div>}
            <div className="text-[11.5px] text-edu-sub">
              받는 사람 {toSelf ? "나 자신" : `${toIds.length}/20명`}{ccIds.length ? ` · 참조 ${ccIds.length}명` : ""}{bccIds.length ? ` · 숨은참조 ${bccIds.length}명` : ""} · 2명 이상이면 단체 쪽지예요.
            </div>
            {!toSelf && toIds.length >= 5 ? (
              <HoldButton onDone={doSend} label={`1초 꾹 눌러 ${toIds.length}명에게 보내기`} busyLabel="보내는 중…" />
            ) : (
              <button className="edu-btn inline-flex items-center justify-center gap-1.5" onClick={doSend}>
                <IconSend size={14} /> {toSelf ? "나에게 보내기" : "보내기"}
              </button>
            )}
            <div className="text-[11.5px] text-edu-sub">발송 후 7초 동안 취소할 수 있어요 (Undo Send).</div>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5 max-h-[560px] md:max-h-[calc(100vh-250px)] overflow-y-auto pr-0.5 anim-list">
            {list.length === 0 && <div className="text-center text-edu-sub text-[13px] py-8">조건에 맞는 쪽지가 없어요.</div>}
            {list.map((m) => {
              const unread = m.to.filter((r) => !r.readAt).length;
              const mineUnread = m.to.some((r) => r.uid === ME_ID && !r.readAt);
              const reserved = !!m.reservedAt && !m.sentAt;
              return (
                <button
                  key={m.id}
                  onClick={() => p.onOpen(m.id)}
                  onContextMenu={(e) => openMenu(e, rowMenu(m), m.title)}
                  className={`text-left border rounded-edu px-3 py-2.5 ${p.openId === m.id ? "border-edu-blueline bg-edu-soft" : "border-edu-line hover:bg-edu-bg"}`}
                >
                  <div className="flex items-center gap-1.5">
                    {m.starred && <IconStar size={13} filled className="text-[#E9A100] shrink-0" />}
                    {m.importance === "urgent" && <span className="text-[10.5px] font-extrabold bg-[#FDE8E8] text-[#D92D20] border border-[#F5C6C6] rounded-lg px-1.5 py-0.5">긴급</span>}
                    {m.importance === "ref" && <span className="text-[10.5px] font-extrabold bg-[#EEF0F4] text-[#5B6472] border border-[#DDE1E8] rounded-lg px-1.5 py-0.5">참고</span>}
                    {reserved && <span className="text-[10.5px] font-extrabold bg-edu-soft text-edu-strong border border-edu-blueline rounded-lg px-1.5 py-0.5">예약</span>}
                    {m.toSelf && <span className="text-[10.5px] font-extrabold bg-edu-chip text-edu-sub rounded-lg px-1.5 py-0.5">나에게</span>}
                    <span className={`font-bold text-[13.5px] truncate flex-1 ${mineUnread ? "text-edu-strong" : ""}`}>{m.title}</span>
                    {mineUnread && <span className="w-2 h-2 rounded-full bg-edu-blue shrink-0" aria-label="안 읽음" />}
                  </div>
                  <div className="text-[12px] text-edu-sub mt-0.5 truncate">
                    {m.fromName} · {timeLabel(m.createdAt)}
                    {m.attachments?.length ? ` · 📎 ${m.attachments.length}` : m.hwpName ? ` · 📎 ${m.hwpName}` : ""}
                    {m.to.length > 1 ? ` · ${m.to.length}명` : ""}
                  </div>
                  {tab === "sent" && !reserved && (
                    <div className="text-[11.5px] mt-0.5 font-bold text-edu-strong">
                      {unread === 0 ? "전원 확인 ✓" : `${unread}명 미확인`}
                    </div>
                  )}
                  {reserved && (
                    <div className="text-[11.5px] mt-0.5 font-bold text-edu-sub">
                      {timeLabel(m.reservedAt)} 예약 — 아직 발송 전
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="edu-card p-3.5 anim-card h-fit md:sticky md:top-0">
        {!open ? (
          <div className="text-[13.5px] text-edu-sub text-center py-10">왼쪽에서 쪽지를 고르면<br />본문·수신확인표·댓글이 나와요.</div>
        ) : (
          <div>
            <div className="flex items-start gap-2">
              <div className="font-extrabold text-[15.5px] flex-1 leading-snug">{open.title}</div>
              <BzTooltip content={open.starred ? "중요 해제" : "중요 표시"} position="bottom">
                <button
                  className="edu-ghost !py-1 !px-2"
                  onClick={() => p.onStar?.(open.id, !open.starred)}
                  aria-label="중요 표시"
                >
                  <IconStar size={14} filled={!!open.starred} className={open.starred ? "text-[#E9A100]" : "text-edu-sub"} />
                </button>
              </BzTooltip>
              <button className="edu-ghost !py-1 !px-2.5 !text-[12px]" onClick={() => p.onOpen(null)}>닫기</button>
            </div>
            <div className="text-[12px] text-edu-sub mt-1">
              {open.fromName} · {timeLabel(open.createdAt)}
              {open.hwpName ? ` · 📎 ${open.hwpName}` : ""}
              {open.toSelf ? " · 나에게 보낸 쪽지" : ""}
            </div>
            {/* 이메일형 작업 줄: 회신/전체회신/전달/퀵메모/회수 */}
            <div className="mt-2 flex gap-1.5 flex-wrap">
              <BzTooltip content="보낸 사람에게 회신" position="bottom">
                <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px] inline-flex items-center gap-1" onClick={() => startReply(open, false)}>
                  <IconReply size={13} /> 회신
                </button>
              </BzTooltip>
              <BzTooltip content="보낸 사람 + 받는 사람 전원에게 회신" position="bottom">
                <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px] inline-flex items-center gap-1" onClick={() => startReply(open, true)}>
                  <IconReply size={13} /> 전체 회신
                </button>
              </BzTooltip>
              <BzTooltip content="다른 사람에게 전달" position="bottom">
                <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px] inline-flex items-center gap-1" onClick={() => startForward(open)}>
                  <IconForward size={13} /> 전달
                </button>
              </BzTooltip>
              <BzTooltip content="퀵 메모(포스트잇)로 저장" position="bottom">
                <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px] inline-flex items-center gap-1" onClick={() => p.onQuickSave?.(open)}>
                  <IconStickyNote size={13} /> 퀵 메모
                </button>
              </BzTooltip>
              {canRecall && (
                <BzTooltip content="모두 읽기 전일 때만 회수할 수 있어요" position="bottom">
                  <button
                    className="edu-ghost !px-2.5 !py-1.5 !text-[12px] inline-flex items-center gap-1 !text-[#D92D20]"
                    onClick={async () => {
                      const ok = await bzConfirm({
                        title: "쪽지를 회수할까요?",
                        message: "아직 아무도 읽지 않아 회수할 수 있어요. 상대의 쪽지함에서도 사라져요.",
                        confirmText: "회수",
                        danger: true,
                      });
                      if (ok) p.onRecall?.(open.id);
                    }}
                  >
                    <IconUndo size={13} /> 읽기 전 회수
                  </button>
                </BzTooltip>
              )}
            </div>
            <div className="mt-2 flex gap-1.5 flex-wrap items-center">
              <span className="text-[11.5px] font-bold text-edu-sub">중요도</span>
              {(["normal", "urgent", "ref"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => p.onImportance(open.id, v)}
                  className={`px-2.5 py-1 rounded-full text-[11.5px] font-bold border ${open.importance === v ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                >
                  {v === "urgent" ? "긴급" : v === "ref" ? "참고" : "일반"}
                </button>
              ))}
            </div>
            {open.hwpName && (
              <div className="mt-2 flex gap-2">
                <button className="edu-ghost !text-[12.5px]" onClick={() => p.onToast(`${open.hwpName} 미리보기`)}>
                  <span className="inline-flex items-center gap-1"><IconEye size={13} /> 미리보기</span>
                </button>
                <button className="edu-ghost !text-[12.5px]" onClick={() => p.onAudit("HWP", open.hwpName, false)}>🧾 열람 기록 남기기</button>
              </div>
            )}
            {!!open.attachments?.length && (
              <div className="mt-2 flex flex-col gap-1">
                {open.attachments.map((a) => (
                  <button
                    key={a.id}
                    className="flex items-center gap-2 text-[12.5px] bg-edu-bg border border-edu-line rounded-lg px-2.5 py-1.5 hover:bg-edu-chip text-left"
                    onClick={() => {
                      if (a.storeId) {
                        void fsDownload(a.storeId, a.name).then((ok) => {
                          if (!ok) p.onToast("첨부 파일을 찾을 수 없어요 (이 PC에 저장된 적이 없어요).");
                        });
                      } else if (a.dataUrl) {
                        const link = document.createElement("a");
                        link.href = a.dataUrl;
                        link.download = a.name;
                        link.click();
                      } else p.onToast("이 첨부는 다른 PC에서 올린 파일이라 여기엔 없어요.");
                    }}
                  >
                    <IconPaperclip size={13} className="text-edu-muted shrink-0" />
                    <span className="truncate flex-1 font-bold">{a.name}</span>
                    <span className="text-edu-muted shrink-0 text-[11.5px]">{humanSize(a.size)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 text-[14px] leading-relaxed bg-edu-bg border border-edu-line rounded-xl p-3">{renderRich(open.body)}</div>
            <div className="mt-3 font-extrabold text-[13.5px]">
              수신확인표 ({open.to.filter((r) => r.readAt).length}/{open.to.length})
              {canRecall && <span className="ml-2 text-[11.5px] font-bold text-edu-sub">· 아직 아무도 읽지 않아 회수할 수 있어요</span>}
            </div>
            <div className="mt-1.5 border border-edu-line rounded-xl overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead className="bg-edu-bg text-edu-sub">
                  <tr><th className="text-left px-2.5 py-1.5 font-bold">받는 사람</th><th className="text-left px-2.5 py-1.5 font-bold">확인 시각</th><th className="px-2.5 py-1.5"></th></tr>
                </thead>
                <tbody>
                  {open.to
                    .filter((r) => !r.bcc || open.fromUid === ME_ID || r.uid === ME_ID)
                    .map((r) => (
                      <tr key={r.uid} className="border-t border-edu-line">
                        <td className="px-2.5 py-1.5 font-bold">
                          {r.name}
                          {r.cc && <span className="ml-1 text-[10.5px] font-extrabold text-edu-sub bg-edu-chip rounded px-1 py-0.5">참조</span>}
                          {r.bcc && open.fromUid === ME_ID && <span className="ml-1 text-[10.5px] font-extrabold text-edu-sub bg-edu-chip rounded px-1 py-0.5">숨은참조</span>}
                        </td>
                        <td className="px-2.5 py-1.5 text-edu-sub">{r.readAt ? timeLabel(r.readAt) : "[미확인]"}</td>
                        <td className="px-2.5 py-1.5 text-right">
                          {!r.readAt && open.fromUid === ME_ID && (
                            <button className="text-edu-strong font-bold text-[12px]" onClick={() => p.onNudge(open.id, r.uid)}>1클릭 재촉하기</button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 font-extrabold text-[13.5px]">댓글 ({openComments.length})</div>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {openComments.map((c) => (
                <div key={c.id} className="bg-edu-bg border border-edu-line rounded-xl px-2.5 py-1.5 text-[13px]">
                  <span className="font-bold">{c.fromName}</span> <span className="text-edu-sub text-[11.5px]">{timeLabel(c.createdAt)}</span>
                  <div className="mt-0.5">{c.body}</div>
                </div>
              ))}
              <div className="flex gap-1.5">
                <input
                  className="edu-input !py-2"
                  placeholder="댓글 달기 (예: 3반 제출 완료)"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  maxLength={200}
                />
                <button
                  className="edu-ghost shrink-0"
                  onClick={() => { if (commentDraft.trim()) { p.onComment(open.id, commentDraft.trim()); setCommentDraft(""); } }}
                >
                  등록
                </button>
              </div>
            </div>
            <PollBox memoId={open.id} onToast={p.onToast} />
          </div>
        )}
      </div>

      {/* 7초 발송 취소(Undo Send) 플로팅 바 */}
      {undoState && (
        <div
          className="fixed left-1/2 bottom-5 -translate-x-1/2 z-[1200] flex items-center gap-3 bg-[#101828] text-white rounded-2xl pl-4 pr-2.5 py-2.5 shadow-[0_18px_50px_rgba(8,12,20,0.5)]"
          role="status"
        >
          <span className="text-[12.5px] font-bold whitespace-nowrap">쪽지를 보냈어요</span>
          <div className="w-20 h-1.5 bg-white/25 rounded-full overflow-hidden" aria-hidden>
            <div className="h-full bg-white transition-[width] duration-1000 ease-linear" style={{ width: `${(undoState.remaining / UNDO_SECONDS) * 100}%` }} />
          </div>
          <span className="text-[12px] font-bold tabular-nums w-8 text-center">{undoState.remaining}초</span>
          <button className="bz-btn !h-8 !px-3 !text-[12.5px] inline-flex items-center gap-1" onClick={closeUndo}>
            <IconUndo size={13} /> 발송 취소
          </button>
        </div>
      )}
    </div>
  );
}
