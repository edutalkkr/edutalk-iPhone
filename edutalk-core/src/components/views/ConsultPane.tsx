// AI 상담 일지 (2026-10)
//  · 상담 원문은 학교 서버 SQLite에만 저장하고, AI에는 서버가 민감정보를 가린 뒤 보낸다.
//  · 서버 AI 키가 없으면 로컬 문장 분류로 조용히 대체한다.
//  · 서버가 잠시 닿지 않아도 이 PC에 임시 저장해 작업이 사라지지 않게 한다.
//  · 작성자와 관리자만 열람한다. (학생 계정은 서버에서 차단)

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConsultationLog, ConsultSummary } from "../../types";
import { api } from "../../services/api";
import { storeGet, storeSet } from "../../lib/localStore";
import { summarizeLocal } from "../../lib/ai";
import { bzConfirm } from "../ui/BzDialog";
import BzTooltip from "../ui/BzTooltip";
import { usePresence } from "../../lib/usePresence";
import {
  IconChevronDown,
  IconClock,
  IconSparkles,
  IconTrash,
  IconUsers,
  IconX,
} from "../ui/BzIcons";

const LOCAL_KEY = "consult-logs-local";
const CONTACT_LABEL: Record<ConsultationLog["contactType"], string> = {
  student: "학생",
  parent: "학부모",
  guardian: "보호자",
  other: "기타",
};
const EMPTY_SUMMARY: ConsultSummary = { concerns: [], observations: [], actions: [] };

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

function localSummary(text: string): ConsultSummary {
  const lines = summarizeLocal(text);
  const concerns = lines[0] ? [lines[0]] : [];
  const observations = lines[1] ? [lines[1]] : [];
  const actions = lines[2] ? [lines[2]] : [];
  if (!actions.length && concerns.length) actions.push("다음 상담에서 변화를 함께 확인해요.");
  return { concerns, observations, actions };
}

function summaryCount(s: ConsultSummary) {
  return s.concerns.length + s.observations.length + s.actions.length;
}

function SummaryBlock({ summary }: { summary: ConsultSummary }) {
  const groups: { key: keyof ConsultSummary; title: string; tone: string }[] = [
    { key: "concerns", title: "핵심 고민", tone: "consult-tone-concern" },
    { key: "observations", title: "관찰한 점", tone: "consult-tone-observe" },
    { key: "actions", title: "후속 조치", tone: "consult-tone-action" },
  ];
  if (!summaryCount(summary)) {
    return <div className="text-[12.5px] text-edu-sub">아직 정리된 내용이 없어요. [AI로 정리하기]를 눌러 보세요.</div>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {groups.map((g) => (
        <div key={g.key} className={`consult-summary ${g.tone}`}>
          <div className="consult-summary-title">{g.title}</div>
          {summary[g.key].length ? (
            <ul className="list-disc pl-4 leading-relaxed">
              {summary[g.key].map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          ) : (
            <div className="text-[12px] opacity-70">해당 없음</div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ConsultPane({ meName, localIsAdmin = false, onToast }: Props) {
  const [studentName, setStudentName] = useState("");
  const [contactType, setContactType] = useState<ConsultationLog["contactType"]>("student");
  const [topic, setTopic] = useState("");
  const [rawText, setRawText] = useState("");
  const [summary, setSummary] = useState<ConsultSummary>(EMPTY_SUMMARY);
  const [source, setSource] = useState<"gemini" | "local" | "error">("local");
  const [maskedCount, setMaskedCount] = useState(0);
  const [logs, setLogs] = useState<ConsultationLog[]>([]);
  const [selected, setSelected] = useState<ConsultationLog | null>(null);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [isAdmin, setIsAdmin] = useState(localIsAdmin);
  const [loading, setLoading] = useState(true);
  const [summarizing, setSummarizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);
  const [formOpen, setFormOpen] = useState(true);
  const lastSelected = useRef<ConsultationLog | null>(null);
  const detailPresence = usePresence(Boolean(selected), 160);

  const loadLocal = async () => {
    const saved = await storeGet<ConsultationLog[]>(LOCAL_KEY);
    setLogs(Array.isArray(saved) ? saved : []);
  };

  const load = async (nextScope: "mine" | "all" = scope) => {
    setLoading(true);
    try {
      const me = await api.getMe();
      if (me.ok && me.data?.user) {
        const role = String(me.data.user.role || "").toUpperCase();
        setIsAdmin(localIsAdmin || role === "ADMIN");
      }
      const res = await api.getConsultations(nextScope);
      if (res.ok && res.data?.logs) {
        setLogs(res.data.logs);
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

  const canSeeAll = isAdmin;
  const visibleLogs = useMemo(() => logs, [logs]);

  const runSummary = async () => {
    if (!rawText.trim()) return onToast("상담 내용을 먼저 적어 주세요.");
    setSummarizing(true);
    try {
      const res = await api.summarizeConsultation(rawText);
      if (res.ok && res.data?.summary) {
        setSummary(res.data.summary);
        setSource(res.data.source || "local");
        setMaskedCount(Number(res.data.privacy?.masked) || 0);
        setOffline(false);
        onToast(res.data.source === "gemini" ? "AI가 상담 내용을 세 묶음으로 정리했어요." : "서버 AI 대신 로컬 정리로 요약했어요.");
      } else {
        setSummary(localSummary(rawText));
        setSource("local");
        setMaskedCount(0);
        onToast("AI 서버에 닿지 않아 이 PC에서 간단히 정리했어요.");
      }
    } catch {
      setSummary(localSummary(rawText));
      setSource("local");
      setMaskedCount(0);
      onToast("AI 서버에 닿지 않아 이 PC에서 간단히 정리했어요.");
    } finally {
      setSummarizing(false);
    }
  };

  const save = async () => {
    if (!studentName.trim()) return onToast("학생 이름을 적어 주세요.");
    if (!rawText.trim()) return onToast("상담 내용을 적어 주세요.");
    setSaving(true);
    const payload = {
      studentName: studentName.trim(),
      contactType,
      topic: topic.trim(),
      rawText: rawText.trim(),
      summary,
      source,
      maskedCount,
    };
    try {
      const res = await api.saveConsultation(payload);
      if (res.ok && res.data?.log) {
        setLogs((prev) => [res.data!.log, ...prev]);
        setSelected(res.data.log);
        setOffline(false);
        onToast("상담 일지를 학교 서버에 저장했어요.");
      } else {
        await saveLocal(payload, "서버에 저장하지 못해 이 PC에 임시 저장했어요.");
      }
    } catch {
      await saveLocal(payload, "서버에 닿지 않아 이 PC에 임시 저장했어요.");
    } finally {
      setSaving(false);
    }
  };

  const saveLocal = async (payload: Omit<ConsultationLog, "id" | "authorId" | "authorName" | "createdAt">, message: string) => {
    const local: ConsultationLog = {
      ...payload,
      id: -Date.now(),
      authorId: 0,
      authorName: meName,
      createdAt: nowLabel(),
    } as ConsultationLog;
    const next = [local, ...logs];
    setLogs(next);
    setSelected(local);
    setOffline(true);
    await storeSet(LOCAL_KEY, next);
    onToast(message);
  };

  const remove = async (log: ConsultationLog) => {
    const ok = await bzConfirm({
      title: "상담 일지를 지울까요?",
      message: "지운 일지는 되돌릴 수 없어요.",
      confirmText: "지우기",
      danger: true,
    });
    if (!ok) return;
    if (log.id < 0) {
      const next = logs.filter((l) => l.id !== log.id);
      setLogs(next);
      await storeSet(LOCAL_KEY, next);
      if (selected?.id === log.id) setSelected(null);
      onToast("이 PC에 임시 저장한 일지를 지웠어요.");
      return;
    }
    const res = await api.deleteConsultation(log.id);
    if (res.ok) {
      const next = logs.filter((l) => l.id !== log.id);
      setLogs(next);
      if (selected?.id === log.id) setSelected(null);
      onToast("상담 일지를 지웠어요.");
    } else {
      onToast(res.error || "상담 일지를 지우지 못했어요.");
    }
  };

  const resetForm = () => {
    setStudentName("");
    setContactType("student");
    setTopic("");
    setRawText("");
    setSummary(EMPTY_SUMMARY);
    setSource("local");
    setMaskedCount(0);
  };

  if (selected) lastSelected.current = selected;
  const detail = selected ?? lastSelected.current;
  const showDetail = detailPresence.mounted && detail;

  return (
    <div className="flex flex-col gap-3">
      <div className="edu-card p-3.5 anim-card consult-hero">
        <div className="flex items-start gap-2">
          <div className="consult-hero-icon"><IconSparkles size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-[15px]">AI 상담 일지</div>
            <div className="text-[12.5px] text-edu-sub mt-0.5">
              상담 내용을 세 묶음으로 정리하고 학교 서버에 안전하게 보관해요. 민감정보는 AI에 보내기 전에 가려요.
            </div>
          </div>
          {offline && <span className="consult-offline">이 PC 임시 저장</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)] gap-3">
        <div className="edu-card p-3.5 anim-card">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left"
            onClick={() => setFormOpen((v) => !v)}
            aria-expanded={formOpen}
          >
            <span className="font-extrabold text-[14px]">새 상담 기록</span>
            <span className="text-[11.5px] text-edu-sub">작성자·관리자만 열람</span>
            <IconChevronDown size={15} className={`ml-auto text-edu-sub transition-transform ${formOpen ? "" : "-rotate-90"}`} />
          </button>

          <div className={`consult-form-wrap ${formOpen ? "is-open" : ""}`}>
            <div className="consult-form-inner">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
                <label className="consult-field">
                  <span>학생 이름</span>
                  <input className="edu-input" value={studentName} onChange={(e) => setStudentName(e.target.value)} maxLength={80} placeholder="예: 김하늘" />
                </label>
                <label className="consult-field">
                  <span>상담 대상</span>
                  <select className="edu-input" value={contactType} onChange={(e) => setContactType(e.target.value as ConsultationLog["contactType"])}>
                    <option value="student">학생</option>
                    <option value="parent">학부모</option>
                    <option value="guardian">보호자</option>
                    <option value="other">기타</option>
                  </select>
                </label>
              </div>
              <label className="consult-field mt-2">
                <span>상담 주제</span>
                <input className="edu-input" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} placeholder="예: 교우 관계, 수업 적응" />
              </label>
              <label className="consult-field mt-2">
                <span>상담 내용</span>
                <textarea
                  className="edu-input min-h-[160px]"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  maxLength={12000}
                  placeholder="상담한 내용을 편하게 적어 주세요. Enter는 줄바꿈이에요."
                />
              </label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <button className="edu-btn inline-flex items-center gap-1.5" onClick={() => void runSummary()} disabled={summarizing || !rawText.trim()}>
                  <IconSparkles size={14} /> {summarizing ? "AI가 정리 중…" : "AI로 정리하기"}
                </button>
                <button className="edu-ghost" onClick={resetForm} disabled={saving}>비우기</button>
                <button className="edu-btn ml-auto" onClick={() => void save()} disabled={saving || !studentName.trim() || !rawText.trim()}>
                  {saving ? "저장 중…" : "상담 일지 저장"}
                </button>
              </div>
              <div className="text-[11.5px] text-edu-sub mt-1.5">
                {source === "gemini" ? "AI가 정리했어요." : "로컬 정리로 요약했어요."}
                {maskedCount > 0 ? ` 민감정보 ${maskedCount}건을 가렸어요.` : " 민감정보가 발견되면 자동으로 가려요."}
              </div>
            </div>
          </div>

          <div className="mt-3">
            <div className="font-extrabold text-[13.5px] mb-1.5">정리 결과</div>
            <SummaryBlock summary={summary} />
          </div>
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          <div className="edu-card p-3.5 anim-card">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold text-[14px]">상담 일지 목록</span>
              {canSeeAll && (
                <div className="flex gap-1 ml-auto">
                  {(["mine", "all"] as const).map((s) => (
                    <button
                      key={s}
                      className={`consult-tab ${scope === s ? "active" : ""}`}
                      onClick={() => { setScope(s); void load(s); }}
                    >
                      {s === "mine" ? "내 일지" : "전체 보기"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {loading ? (
              <div className="text-[13px] text-edu-sub py-8 text-center">불러오는 중…</div>
            ) : visibleLogs.length === 0 ? (
              <div className="text-[13px] text-edu-sub py-8 text-center">
                아직 저장한 상담 일지가 없어요.<br />첫 상담을 기록해 보세요.
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-1.5 max-h-[360px] overflow-y-auto anim-list">
                {visibleLogs.map((log) => (
                  <button
                    key={log.id}
                    className={`consult-log ${selected?.id === log.id ? "active" : ""}`}
                    onClick={() => setSelected(log)}
                  >
                    <span className="consult-log-avatar">{(log.studentName || "?").slice(0, 1)}</span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block font-extrabold text-[13px] truncate">{log.studentName} · {log.topic || "상담"}</span>
                      <span className="block text-[11.5px] text-edu-sub truncate">
                        {CONTACT_LABEL[log.contactType] || "상담"} · {log.createdAt.slice(0, 16)} {log.authorName ? `· ${log.authorName}` : ""}
                      </span>
                    </span>
                    <span className={`consult-source ${log.source === "gemini" ? "gemini" : ""}`}>{log.source === "gemini" ? "AI" : "로컬"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {showDetail && (
            <div className={`edu-card p-3.5 anim-pop ${detailPresence.closing ? "is-closing" : ""}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold text-[14px]">{detail.studentName} · {detail.topic || "상담 일지"}</div>
                  <div className="text-[11.5px] text-edu-sub mt-0.5 inline-flex items-center gap-1 flex-wrap">
                    <IconClock size={11} /> {detail.createdAt}
                    <span>· {CONTACT_LABEL[detail.contactType] || "상담"}</span>
                    {detail.authorName && <span>· {detail.authorName}</span>}
                  </div>
                </div>
                <BzTooltip content="이 일지 지우기" position="left">
                  <button className="consult-icon-btn danger" onClick={() => void remove(detail)} aria-label="상담 일지 지우기">
                    <IconTrash size={14} />
                  </button>
                </BzTooltip>
                <button className="consult-icon-btn" onClick={() => setSelected(null)} aria-label="상세 닫기">
                  <IconX size={14} />
                </button>
              </div>
              <div className="mt-2">
                <SummaryBlock summary={detail.summary || EMPTY_SUMMARY} />
              </div>
              <details className="consult-raw mt-2">
                <summary className="cursor-pointer text-[12.5px] font-bold text-edu-sub">상담 원문 보기</summary>
                <div className="whitespace-pre-wrap break-words text-[12.5px] mt-1.5 leading-relaxed">{detail.rawText}</div>
              </details>
            </div>
          )}

          <div className="edu-card p-3 consult-guide">
            <div className="font-extrabold text-[13px] inline-flex items-center gap-1.5"><IconUsers size={14} /> 함께 쓰는 기록이에요</div>
            <div className="text-[12px] text-edu-sub mt-1 leading-relaxed">
              상담 일지는 작성한 선생님과 학교 관리자만 볼 수 있어요. 학생 이름·연락처는 꼭 필요한 만큼만 적어 주세요.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
