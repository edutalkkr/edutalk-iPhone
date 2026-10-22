// 교내 간이 전자결재 (2026-10)
//  · 교사가 품의를 올리면 관리자에게 실시간 알림이 가고, 관리자는 전자서명으로 승인한다.
//  · 내가 올린 결재는 내가 승인할 수 없다. (서버에서도 강제)
//  · 서버가 잠시 닿지 않으면 이 PC에 임시 저장해 작성 내용을 잃지 않는다.
//  · 학생 계정은 서버에서 차단된다.

import { useEffect, useMemo, useState } from "react";
import type { ApprovalCategory, ApprovalRequest, ApprovalStatus } from "../../types";
import { api } from "../../services/api";
import { socket } from "../../services/socket";
import { storeGet, storeSet } from "../../lib/localStore";
import { bzConfirm } from "../ui/BzDialog";
import BzTooltip from "../ui/BzTooltip";
import {
  IconCheckCircle,
  IconChevronDown,
  IconClock,
  IconFile,
  IconPlus,
  IconShield,
  IconX,
} from "../ui/BzIcons";

const LOCAL_KEY = "approvals-local";
const CATEGORY_LABEL: Record<ApprovalCategory, string> = {
  supplies: "교구·비품",
  meeting: "회의·협의",
  after_school: "방과후·돌봄",
  event: "행사·체험",
  general: "일반 품의",
};
const STATUS_LABEL: Record<ApprovalStatus, string> = {
  PENDING: "승인 대기",
  APPROVED: "승인 완료",
  REJECTED: "반려",
  CANCELLED: "취소",
};

interface Props {
  meName: string;
  localIsAdmin?: boolean;
  onToast: (t: string) => void;
}

function nowLabel() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function won(n: number) {
  return `${Number(n || 0).toLocaleString("ko-KR")}원`;
}

function statusClass(status: ApprovalStatus) {
  return status === "APPROVED" ? "approved" : status === "REJECTED" ? "rejected" : status === "CANCELLED" ? "cancelled" : "pending";
}

export default function ApprovalPane({ meName, localIsAdmin = false, onToast }: Props) {
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [isAdmin, setIsAdmin] = useState(localIsAdmin);
  const [signerName, setSignerName] = useState(meName);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [formOpen, setFormOpen] = useState(true);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ApprovalCategory>("general");
  const [amount, setAmount] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadLocal = async () => {
    const saved = await storeGet<ApprovalRequest[]>(LOCAL_KEY);
    setApprovals(Array.isArray(saved) ? saved : []);
  };

  const load = async (nextScope: "mine" | "all" = scope) => {
    setLoading(true);
    try {
      const me = await api.getMe();
      if (me.ok && me.data?.user) {
        setIsAdmin(localIsAdmin || String(me.data.user.role || "").toUpperCase() === "ADMIN");
        setSignerName(me.data.user.real_name || meName);
      }
      const res = await api.getApprovals(nextScope);
      if (res.ok && res.data?.approvals) {
        setApprovals(res.data.approvals);
        setOffline(false);
      } else {
        setOffline(true);
        await loadLocal();
      }
    } catch {
      setOffline(true);
      await loadLocal();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load("mine");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 결재가 올라오거나 처리되면 목록을 조용히 새로 고친다.
  useEffect(() => {
    const refresh = () => { void load(scope); };
    const offNew = socket.on("approval:new", refresh);
    const offDecided = socket.on("approval:decided", refresh);
    const offChanged = socket.on("approval:changed", refresh);
    return () => { offNew(); offDecided(); offChanged(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, isAdmin]);

  const visible = useMemo(() => {
    if (scope === "all" && isAdmin) return approvals;
    return approvals.filter((a) => a.isMine || a.requesterName === meName);
  }, [approvals, scope, isAdmin, meName]);

  const pendingMine = visible.filter((a) => a.status === "PENDING" && a.isMine).length;

  const create = async () => {
    if (!title.trim()) return onToast("결재 제목을 적어 주세요.");
    if (!content.trim()) return onToast("결재 내용을 적어 주세요.");
    const amountNum = Math.max(0, Math.round(Number(String(amount).replace(/[^\d.-]/g, "")) || 0));
    setSubmitting(true);
    try {
      const res = await api.createApproval({
        title: title.trim(),
        category,
        amount: amountNum,
        content: content.trim(),
      });
      if (res.ok && res.data?.approval) {
        setApprovals((prev) => [res.data!.approval, ...prev]);
        setOffline(false);
        resetForm();
        onToast("결재를 올렸어요. 관리자에게 알림을 보냈어요.");
      } else {
        await createLocal(amountNum, "서버에 닿지 않아 이 PC에 임시 저장했어요.");
      }
    } catch {
      await createLocal(amountNum, "서버에 닿지 않아 이 PC에 임시 저장했어요.");
    } finally {
      setSubmitting(false);
    }
  };

  const createLocal = async (amountNum: number, message: string) => {
    const local: ApprovalRequest = {
      id: -Date.now(),
      requesterId: 0,
      requesterName: meName,
      title: title.trim(),
      category,
      amount: amountNum,
      content: content.trim(),
      status: "PENDING",
      approverId: null,
      approverName: "",
      signature: "",
      signatureHash: "",
      decisionNote: "",
      decidedAt: "",
      createdAt: nowLabel(),
      updatedAt: nowLabel(),
      isMine: true,
      canDecide: false,
    };
    const next = [local, ...approvals];
    setApprovals(next);
    setOffline(true);
    await storeSet(LOCAL_KEY, next);
    onToast(message);
    resetForm();
  };

  const resetForm = () => {
    setTitle("");
    setCategory("general");
    setAmount("");
    setContent("");
  };

  const decide = async (a: ApprovalRequest, action: "approve" | "reject", note = "") => {
    if (action === "approve") {
      const ok = await bzConfirm({
        title: "전자서명으로 승인할까요?",
        message: `결재자 이름: ${signerName}\n이 이름으로 전자서명이 기록되고, 신청자에게 알림이 가요.`,
        confirmText: "승인 서명",
      });
      if (!ok) return;
    }
    setBusyId(a.id);
    try {
      if (a.id < 0) {
        const next = approvals.map((x) => x.id === a.id ? {
          ...x,
          status: action === "approve" ? "APPROVED" as const : "REJECTED" as const,
          approverName: signerName,
          signature: signerName,
          decisionNote: note,
          decidedAt: nowLabel(),
          canDecide: false,
        } : x);
        setApprovals(next);
        await storeSet(LOCAL_KEY, next);
        setRejectId(null);
        setRejectNote("");
        onToast(action === "approve" ? "이 PC에서 승인 서명을 기록했어요." : "이 PC에서 반려했어요.");
        return;
      }
      const res = await api.decideApproval(a.id, action, signerName, note);
      if (res.ok && res.data?.approval) {
        setApprovals((prev) => prev.map((x) => x.id === a.id ? res.data!.approval : x));
        setRejectId(null);
        setRejectNote("");
        onToast(action === "approve" ? "승인 서명을 기록했어요." : "결재를 반려했어요.");
      } else {
        onToast(res.error || "결재를 처리하지 못했어요.");
      }
    } catch {
      onToast("서버에 닿지 않아 결재를 처리하지 못했어요.");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (a: ApprovalRequest) => {
    const ok = await bzConfirm({
      title: "결재를 취소할까요?",
      message: "대기 중인 결재만 취소할 수 있어요.",
      confirmText: "취소하기",
      danger: true,
    });
    if (!ok) return;
    setBusyId(a.id);
    try {
      if (a.id < 0) {
        const next = approvals.map((x) => x.id === a.id ? { ...x, status: "CANCELLED" as const, decisionNote: "신청자가 취소했어요.", canDecide: false } : x);
        setApprovals(next);
        await storeSet(LOCAL_KEY, next);
        onToast("임시 결재를 취소했어요.");
        return;
      }
      const res = await api.cancelApproval(a.id);
      if (res.ok && res.data?.approval) {
        setApprovals((prev) => prev.map((x) => x.id === a.id ? res.data!.approval : x));
        onToast("결재를 취소했어요.");
      } else {
        onToast(res.error || "결재를 취소하지 못했어요.");
      }
    } catch {
      onToast("서버에 닿지 않아 결재를 취소하지 못했어요.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="edu-card p-3.5 anim-card approval-hero">
        <div className="flex items-start gap-2">
          <div className="approval-hero-icon"><IconCheckCircle size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-[15px]">교내 간이 전자결재</div>
            <div className="text-[12.5px] text-edu-sub mt-0.5">
              품의를 올리고 관리자의 승인 서명을 한 번에 받아요. 결재 이력은 학교 서버에 남아요.
            </div>
          </div>
          {offline && <span className="consult-offline">이 PC 임시 저장</span>}
        </div>
        <div className="approval-stats">
          <span><b>{pendingMine}</b> 내 대기</span>
          <span><b>{visible.filter((a) => a.status === "APPROVED").length}</b> 승인 완료</span>
          <span><b>{visible.filter((a) => a.status === "REJECTED").length}</b> 반려</span>
        </div>
      </div>

      <div className="edu-card p-3.5 anim-card">
        <button
          type="button"
          className="flex items-center gap-1.5 w-full text-left"
          onClick={() => setFormOpen((v) => !v)}
          aria-expanded={formOpen}
        >
          <IconPlus size={15} className="text-edu-strong" />
          <span className="font-extrabold text-[14px]">새 결재 올리기</span>
          <span className="text-[11.5px] text-edu-sub">관리자 승인 후 완료</span>
          <IconChevronDown size={15} className={`ml-auto text-edu-sub transition-transform ${formOpen ? "" : "-rotate-90"}`} />
        </button>
        <div className={`approval-form-wrap ${formOpen ? "is-open" : ""}`}>
          <div className="approval-form-inner">
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px] gap-2 mt-2.5">
              <label className="consult-field">
                <span>제목</span>
                <input className="edu-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="예: 2학년 체험학습 버스 임차" />
              </label>
              <label className="consult-field">
                <span>분류</span>
                <select className="edu-input" value={category} onChange={(e) => setCategory(e.target.value as ApprovalCategory)}>
                  {(Object.keys(CATEGORY_LABEL) as ApprovalCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_180px] gap-2 mt-2">
              <label className="consult-field">
                <span>내용</span>
                <textarea className="edu-input min-h-[120px]" value={content} onChange={(e) => setContent(e.target.value)} maxLength={10000} placeholder="품의 사유와 필요한 내용을 적어 주세요." />
              </label>
              <label className="consult-field">
                <span>금액 (원)</span>
                <input className="edu-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} maxLength={12} placeholder="0" />
                <span className="text-[11.5px] text-edu-sub mt-1 block">금액이 없으면 0으로 두세요.</span>
              </label>
            </div>
            <div className="flex justify-end mt-2">
              <button className="edu-btn" onClick={() => void create()} disabled={submitting || !title.trim() || !content.trim()}>
                {submitting ? "올리는 중…" : "결재 올리기"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="edu-card p-3.5 anim-card">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold text-[14px]">결재함</span>
          {isAdmin && (
            <div className="flex gap-1 ml-auto">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  className={`consult-tab ${scope === s ? "active" : ""}`}
                  onClick={() => { setScope(s); void load(s); }}
                >
                  {s === "mine" ? "내 결재" : "관리자 결재함"}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-[13px] text-edu-sub py-8 text-center">불러오는 중…</div>
        ) : visible.length === 0 ? (
          <div className="text-[13px] text-edu-sub py-8 text-center">
            아직 결재가 없어요.<br />위에서 첫 품의를 올려 보세요.
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2 anim-list">
            {visible.map((a) => {
              const pending = a.status === "PENDING";
              const canDecide = pending && isAdmin && !a.isMine && (a.canDecide || a.id < 0);
              return (
                <div key={a.id} className={`approval-card ${statusClass(a.status)}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`approval-badge ${statusClass(a.status)}`}>{STATUS_LABEL[a.status]}</span>
                        <span className="approval-cat">{CATEGORY_LABEL[a.category] || "일반 품의"}</span>
                        {a.amount > 0 && <span className="approval-amount">{won(a.amount)}</span>}
                      </div>
                      <div className="font-extrabold text-[14px] mt-1 break-words">{a.title}</div>
                      <div className="text-[11.5px] text-edu-sub mt-0.5 inline-flex items-center gap-1 flex-wrap">
                        <span>{a.requesterName || "신청자"}</span>
                        <span>· {a.createdAt.slice(0, 16)}</span>
                        {a.isMine && <span className="approval-mine">내가 올림</span>}
                      </div>
                    </div>
                    {pending && a.isMine && (
                      <button className="consult-icon-btn" onClick={() => void cancel(a)} disabled={busyId === a.id} aria-label="결재 취소">
                        <IconX size={14} />
                      </button>
                    )}
                  </div>
                  <div className="approval-content whitespace-pre-wrap break-words">{a.content}</div>
                  {a.status === "APPROVED" && (
                    <div className="approval-sign">
                      <IconShield size={13} /> {a.approverName || a.signature} 전자서명 · {a.decidedAt?.slice(0, 16)}
                      {a.signatureHash && <span className="approval-hash">#{a.signatureHash.slice(0, 8)}</span>}
                    </div>
                  )}
                  {a.status === "REJECTED" && (
                    <div className="approval-reject">
                      <IconFile size={13} /> 반려 사유: {a.decisionNote || "사유가 기록되지 않았어요."}
                    </div>
                  )}
                  {a.status === "CANCELLED" && (
                    <div className="approval-reject"><IconClock size={13} /> {a.decisionNote || "신청자가 취소했어요."}</div>
                  )}
                  {canDecide && (
                    <div className="mt-2">
                      {rejectId === a.id ? (
                        <div className="approval-reject-box">
                          <textarea className="edu-input min-h-[70px]" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} maxLength={300} placeholder="반려 사유를 적어 주세요. (선택)" />
                          <div className="flex gap-1.5 mt-1.5 justify-end">
                            <button className="edu-ghost !py-1.5" onClick={() => { setRejectId(null); setRejectNote(""); }}>닫기</button>
                            <button className="edu-btn danger !py-1.5" onClick={() => void decide(a, "reject", rejectNote.trim())} disabled={busyId === a.id}>반려 확정</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 flex-wrap">
                          <BzTooltip content="내 계정 이름으로 전자서명해요" position="top">
                            <button className="edu-btn !py-1.5 inline-flex items-center gap-1" onClick={() => void decide(a, "approve")} disabled={busyId === a.id}>
                              <IconCheckCircle size={13} /> 원클릭 승인
                            </button>
                          </BzTooltip>
                          <button className="edu-ghost !py-1.5" onClick={() => { setRejectId(a.id); setRejectNote(""); }} disabled={busyId === a.id}>반려</button>
                        </div>
                      )}
                    </div>
                  )}
                  {pending && !a.isMine && !isAdmin && (
                    <div className="text-[11.5px] text-edu-sub mt-2">관리자 승인을 기다리고 있어요.</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="edu-card p-3 approval-guide">
        <div className="font-extrabold text-[13px] inline-flex items-center gap-1.5"><IconShield size={14} /> 전자서명 안내</div>
        <div className="text-[12px] text-edu-sub mt-1 leading-relaxed">
          승인할 때 관리자 계정 이름과 승인 시각이 함께 기록되고, 위조를 막기 위한 서명 해시가 서버에 남아요.
          내가 올린 결재는 스스로 승인할 수 없어요.
        </div>
      </div>
    </div>
  );
}
