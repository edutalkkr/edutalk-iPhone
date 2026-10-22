// 설문조사 화면 — 설문 등록, 대상자 응답, 문항별 결과 리포트, 엑셀(.xlsx) 내보내기까지 담당.
// 서버 없이(데모 모드) 로컬 저장소만으로 완결된다. 목록 행 동작은 우클릭 메뉴로 통일했다.
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { MemoAttachment, SurveyItem, SurveyQuestion, SurveyResponse } from "../../types";
import { bzConfirm } from "../ui/BzDialog";
import { useContextMenu, type BzMenuItem } from "../ui/BzContextMenu";
import BzTooltip from "../ui/BzTooltip";
import {
  IconBarChart, IconBell, IconCalendar, IconCheck, IconChevronLeft, IconDownload, IconEdit, IconEye, IconFile,
  IconPaperclip, IconPlus, IconTrash, IconUsers, IconX,
} from "../ui/BzIcons";
import { downloadBlob, fsDelete, fsDownload, fsPut, humanSize, newFileId, pickFiles } from "../../lib/fileStore";
import { isSurveyClosed, isTargeted, nonRespondents, surveyRespondents, targetedCandidates, useSurveys, visibleSurveys } from "../../lib/surveyStore";

interface SurveyMe { id: string; name: string; dept: string; }
interface Props {
  me: SurveyMe;
  teachers: { id: string; name: string; dept: string }[];
  /** 등록/독려 알림 발송 요청 — App이 쪽지/토스트로 전달한다 */
  onNotifySubjects?: (title: string, body: string, targetIds: string[]) => void;
  onToast: (t: string) => void;
}
type TeacherLite = Props["teachers"][number];
type MenuEvent = { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void };

// ---------- 작은 도우미 ----------
let idSeq = 0;
/** 화면 안에서만 쓰는 짧은 id (설문·질문·보기 구분용) */
function newId(prefix: string): string { idSeq += 1; return `${prefix}-${Date.now().toString(36)}-${idSeq}`; }

/** ISO/로컬 문자열 → "YYYY-MM-DD HH:mm" (실패하면 원문 유지) */
function fmtWhen(v?: string | null): string {
  if (!v) return "-";
  const d = new Date(v.includes("T") ? v : v.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function pct(n: number, m: number): number { return m > 0 ? Math.min(100, Math.round((n / m) * 100)) : 0; }
/** 파일명에 쓸 수 없는 문자 제거 */
function cleanFileName(t: string): string { return t.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "설문"; }
/** 목록·리포트 공용 대상 표기 */
function targetText(sv: SurveyItem): string {
  if (sv.targetKind === "all") return "전체";
  if (sv.targetKind === "dept") return sv.targets.length ? sv.targets.join(", ") : "부서 없음";
  return `선택 ${sv.targets.length}명`;
}
/** 내가 고른 답(또는 한 응답의 문항 답)을 사람이 읽는 문장으로 */
function answerText(q: SurveyQuestion, r: SurveyResponse | null): string {
  const arr = r?.answers[q.id] ?? [];
  if (q.kind === "text") return arr.join(" ").trim() || "(응답 없음)";
  const labels = arr.map((id) => q.options.find((o) => o.id === id)?.label ?? "").filter(Boolean);
  return labels.length ? labels.join(", ") : "(응답 없음)";
}
/** 첨부 내려받기 — IndexedDB(storeId) 우선, 없으면 dataUrl 폴백 */
async function downloadAttachment(att: MemoAttachment, onToast: (t: string) => void): Promise<void> {
  if (att.storeId) {
    if (!(await fsDownload(att.storeId, att.name))) onToast("첨부 파일을 찾지 못했어요.");
    return;
  }
  if (att.dataUrl) {
    try { downloadBlob(att.name, await (await fetch(att.dataUrl)).blob()); return; } catch { /* 아래 공통 안내로 */ }
  }
  onToast("이 첨부는 내려받을 수 없어요.");
}
const chipOn = "text-[10.5px] font-extrabold rounded-lg px-1.5 py-0.5 border shrink-0";
const chipSoft = "bg-edu-soft text-edu-strong border-edu-blueline";
const chipMuted = "bg-edu-chip text-edu-sub border-edu-line";
const pillOn = "px-2.5 py-1.5 rounded-full text-[12px] font-bold border";
/** 목록용 미니 응답률 바 */
function MiniBar({ n, m }: { n: number; m: number }) {
  return (
    <div className="h-1.5 rounded-full bg-edu-chip overflow-hidden">
      <div className="h-full rounded-full bg-edu-blue transition-all" style={{ width: `${pct(n, m)}%` }} />
    </div>
  );
}
/** 알약형 선택 토글 (공개 범위·대상 방식) */
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`px-2.5 py-1.5 rounded-xl text-[12.5px] font-bold border ${value === o.value ? "bg-edu-soft text-edu-strong border-edu-blueline" : "text-edu-sub border-edu-line hover:bg-edu-chip"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
/** 알약형 다중 선택 (부서·교사 목록) */
function Pick({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${pillOn} ${on ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}>
      {on ? "✓ " : ""}{label}
    </button>
  );
}
/** 첨부 목록 행 — 작성 폼(onDelete 있음)과 상세(다운로드만)에서 함께 쓴다 */
function AttachRows({ list, onToast, onDelete }: { list: MemoAttachment[]; onToast: (t: string) => void; onDelete?: (a: MemoAttachment) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {list.map((a) => (
        <div key={a.id} className="flex items-center gap-1.5 text-[12.5px] bg-edu-bg border border-edu-line rounded-xl px-2.5 py-1.5">
          <IconFile size={13} className="text-edu-muted shrink-0" />
          <span className="truncate flex-1">{a.name}</span>
          <span className="text-edu-muted text-[11px] shrink-0">{humanSize(a.size)}</span>
          <BzTooltip content="내려받기" position="left">
            <button type="button" className="text-edu-strong shrink-0" onClick={() => void downloadAttachment(a, onToast)}><IconDownload size={13} /></button>
          </BzTooltip>
          {onDelete && (
            <BzTooltip content="첨부 삭제" position="left">
              <button type="button" className="text-edu-strong shrink-0" onClick={() => onDelete(a)}><IconX size={13} /></button>
            </BzTooltip>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- 메인 화면 ----------
export default function SurveyPane({ me, teachers, onNotifySubjects, onToast }: Props) {
  const surveys = useSurveys((s) => s.surveys);
  const responses = useSurveys((s) => s.responses);
  const removeSurvey = useSurveys((s) => s.removeSurvey);
  const nudge = useSurveys((s) => s.nudge);
  const openMenu = useContextMenu();
  const [tab, setTab] = useState<"list" | "write">("list");
  const [editing, setEditing] = useState<SurveyItem | null>(null);
  const [formSeq, setFormSeq] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [q, setQ] = useState("");

  const visible = useMemo(
    () => visibleSurveys(surveys, me, responses).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [surveys, responses, me]
  );
  const shown = useMemo(() => {
    const s = q.trim();
    return s ? visible.filter((sv) => `${sv.title} ${sv.description} ${sv.createdByName}`.includes(s)) : visible;
  }, [visible, q]);
  const detail = detailId ? visible.find((sv) => sv.id === detailId) ?? null : null;
  const canViewResults = (sv: SurveyItem) => sv.createdBy === me.id || sv.visibility === "public";
  const goList = () => { setEditing(null); setDetailId(null); setShowResults(false); setTab("list"); };
  const startNew = () => { setEditing(null); setFormSeq((n) => n + 1); setDetailId(null); setShowResults(false); setTab("write"); };
  const startEdit = (sv: SurveyItem) => { setEditing(sv); setDetailId(null); setShowResults(false); setTab("write"); };
  const openDetail = (id: string) => { setTab("list"); setDetailId(id); setShowResults(false); };

  // 독려: 아직 응답하지 않은 대상자에게 알림 + nudgeCount 기록
  const doNudge = (sv: SurveyItem) => {
    const rest = nonRespondents(sv, responses, teachers);
    if (!rest.length) return onToast("이미 모두 응답했어요. 독려할 사람이 없어요.");
    const round = (sv.nudgeCount ?? 0) + 1;
    nudge(sv.id);
    onNotifySubjects?.(`[설문] ${sv.title}`, `아직 응답하지 않았어요. (${round}번째 독려) 참여해 주세요.`, rest.map((c) => c.id));
    onToast(`${rest.length}명에게 ${round}번째 독려 알림을 보냈어요.`);
  };
  const doRemove = async (sv: SurveyItem) => {
    const ok = await bzConfirm({ title: "설문을 삭제할까요?", message: `"${sv.title}"\n모은 응답과 첨부 파일도 함께 지워져요.`, confirmText: "삭제", danger: true });
    if (!ok) return;
    removeSurvey(sv.id);
    if (detailId === sv.id) { setDetailId(null); setShowResults(false); }
    onToast("설문을 삭제했어요.");
  };
  // 목록 행 우클릭 메뉴 — 결과/독려/수정/삭제 (수정·삭제·독려는 작성자만)
  const menuFor = (sv: SurveyItem, e: MenuEvent) => {
    const items: BzMenuItem[] = [
      { id: "result", label: "결과 보기", icon: <IconBarChart size={14} />, disabled: !canViewResults(sv), onSelect: () => { openDetail(sv.id); setShowResults(true); } },
    ];
    if (sv.createdBy === me.id) {
      items.push(
        { id: "nudge", label: "설문 독려", icon: <IconBell size={14} />, onSelect: () => doNudge(sv) },
        { id: "sep", separator: true },
        { id: "edit", label: "수정", icon: <IconEdit size={14} />, onSelect: () => startEdit(sv) },
        { id: "del", label: "삭제", icon: <IconTrash size={14} />, danger: true, onSelect: () => void doRemove(sv) }
      );
    }
    openMenu(e, items, sv.title);
  };

  return (
    <div className="flex flex-col gap-2 anim-page">
      <div className="edu-filterbar flex items-center gap-1.5 flex-wrap">
        <button onClick={goList} className={`px-3 py-1.5 rounded-xl text-[13px] font-bold ${tab === "list" ? "bg-edu-soft text-edu-strong" : "text-edu-sub hover:bg-edu-chip"}`}>
          설문 목록 ({visible.length})
        </button>
        <button onClick={startNew} className={`px-3 py-1.5 rounded-xl text-[13px] font-bold inline-flex items-center gap-1 ${tab === "write" ? "bg-edu-soft text-edu-strong" : "text-edu-sub hover:bg-edu-chip"}`}>
          <IconPlus size={13} /> 새 설문
        </button>
        {tab === "list" && !detail && (
          <input className="edu-input !w-[180px] !py-1.5 !text-[12.5px] ml-auto" placeholder="설문 검색" value={q} onChange={(e) => setQ(e.target.value)} maxLength={30} />
        )}
      </div>

      {tab === "write" ? (
        <SurveyForm key={editing ? `edit-${editing.id}` : `new-${formSeq}`} me={me} teachers={teachers} initial={editing}
          onNotifySubjects={onNotifySubjects} onToast={onToast} onClose={goList} />
      ) : showResults && detail ? (
        <ResultReport key={`r-${detail.id}`} me={me} sv={detail} teachers={teachers} responses={responses}
          onBack={() => setShowResults(false)} onNudge={doNudge} onToast={onToast} />
      ) : detail ? (
        <SurveyDetail key={`d-${detail.id}`} me={me} sv={detail} responses={responses} onBack={goList}
          onResults={canViewResults(detail) ? () => setShowResults(true) : undefined} onToast={onToast} />
      ) : (
        <div className="flex flex-col gap-1.5 anim-list">
          {shown.length === 0 && (
            <div className="edu-card py-10 text-center text-[13px] text-edu-sub">
              {visible.length === 0 ? <>아직 설문이 없어요.<br />[＋ 새 설문]에서 첫 설문을 만들어 보세요.</> : "검색 결과가 없어요."}
            </div>
          )}
          {shown.map((sv) => {
            const cands = targetedCandidates(sv, teachers);
            const rc = surveyRespondents(sv.id, responses).length;
            const closed = isSurveyClosed(sv);
            return (
              <button key={sv.id} type="button" onClick={() => openDetail(sv.id)} onContextMenu={(e) => menuFor(sv, e)}
                className="edu-card w-full text-left px-3 py-2.5 hover:bg-edu-hover anim-card">
                <div className="flex items-center gap-1.5">
                  {sv.visibility === "private" && <span className={`${chipOn} ${chipMuted}`}>미공개</span>}
                  <span className="font-bold text-[13.5px] truncate flex-1">{sv.title}</span>
                  <span className={`${chipOn} ${closed ? chipMuted : chipSoft}`}>{closed ? "마감" : "진행중"}</span>
                </div>
                <div className="text-[11.5px] text-edu-sub mt-0.5 truncate">
                  {sv.createdByName} · {targetText(sv)} · 문항 {sv.questions.length}개 · 마감 {sv.closesAt ? fmtWhen(sv.closesAt) : "없음"}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1"><MiniBar n={rc} m={cands.length} /></div>
                  <span className="text-[11px] font-bold text-edu-strong shrink-0">
                    응답 {rc}/{cands.length}{cands.length ? ` · ${pct(rc, cands.length)}%` : ""}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- 작성(수정) 폼 ----------
function SurveyForm({ me, teachers, initial, onNotifySubjects, onToast, onClose }: {
  me: SurveyMe; teachers: TeacherLite[]; initial: SurveyItem | null;
  onNotifySubjects?: Props["onNotifySubjects"]; onToast: (t: string) => void; onClose: () => void;
}) {
  const addSurvey = useSurveys((s) => s.addSurvey);
  const updateSurvey = useSurveys((s) => s.updateSurvey);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [vis, setVis] = useState<SurveyItem["visibility"]>(initial?.visibility ?? "public");
  const [tk, setTk] = useState<SurveyItem["targetKind"]>(initial?.targetKind ?? "all");
  const [deptSel, setDeptSel] = useState<string[]>(initial?.targetKind === "dept" ? [...initial.targets] : []);
  const [uidSel, setUidSel] = useState<string[]>(initial?.targetKind === "selected" ? [...initial.targets] : []);
  const [closes, setCloses] = useState(initial?.closesAt ? initial.closesAt.slice(0, 16) : "");
  const [atts, setAtts] = useState<MemoAttachment[]>(initial ? initial.attachments.map((a) => ({ ...a })) : []);
  const [tq, setTq] = useState("");
  const [qs, setQs] = useState<SurveyQuestion[]>(() =>
    initial ? initial.questions.map((qq) => ({ ...qq, options: qq.options.map((o) => ({ ...o })) })) : []
  );
  const depts = useMemo(() => Array.from(new Set(teachers.map((t) => t.dept).filter(Boolean))), [teachers]);
  const pickedTeachers = useMemo(() => {
    const s = tq.trim();
    return s ? teachers.filter((t) => t.name.includes(s) || t.dept.includes(s)) : teachers;
  }, [teachers, tq]);
  const toggleIn = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // --- 질문 편집 ---
  const addQ = (kind: SurveyQuestion["kind"]) =>
    setQs((l) => [...l, { id: newId("q"), title: "", kind, options: kind === "text" ? [] : [{ id: newId("o"), label: "" }, { id: newId("o"), label: "" }] }]);
  const patchQ = (qid: string, patch: Partial<SurveyQuestion>) => setQs((l) => l.map((qq) => (qq.id === qid ? { ...qq, ...patch } : qq)));
  const removeQ = (qid: string) => setQs((l) => l.filter((qq) => qq.id !== qid));
  const addOpt = (qid: string) => setQs((l) => l.map((qq) => (qq.id === qid ? { ...qq, options: [...qq.options, { id: newId("o"), label: "" }] } : qq)));
  const patchOpt = (qid: string, oid: string, label: string) =>
    setQs((l) => l.map((qq) => (qq.id === qid ? { ...qq, options: qq.options.map((o) => (o.id === oid ? { ...o, label } : o)) } : qq)));
  const removeOpt = (qid: string, oid: string) => {
    const qq = qs.find((x) => x.id === qid);
    if (!qq) return;
    if (qq.options.length <= 2) return onToast("보기는 2개 이상 필요해요."); // 최소 2개 유지
    patchQ(qid, { options: qq.options.filter((o) => o.id !== oid) });
  };

  // --- 첨부 ---
  const addFiles = async () => {
    try {
      const files = await pickFiles({ multiple: true });
      if (!files.length) return;
      const added: MemoAttachment[] = [];
      for (const f of files) {
        const id = newFileId("sur");
        await fsPut(id, f, f.name);
        added.push({ id, name: f.name, size: f.size, type: f.type || "application/octet-stream", storeId: id });
      }
      setAtts((l) => [...l, ...added]);
    } catch { onToast("파일을 붙이지 못했어요."); }
  };
  const dropAtt = async (att: MemoAttachment) => {
    if (att.storeId) await fsDelete(att.storeId);
    setAtts((l) => l.filter((a) => a.id !== att.id));
  };

  // --- 저장(등록/수정) ---
  const save = () => {
    const t = title.trim();
    if (!t) return onToast("설문 제목을 적어 주세요.");
    if (!qs.length) return onToast("질문을 1개 이상 추가해 주세요.");
    const questions: SurveyQuestion[] = [];
    for (const qq of qs) {
      const qt = qq.title.trim();
      if (!qt) return onToast("질문 제목을 모두 적어 주세요.");
      const options = qq.kind === "text" ? [] : qq.options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
      if (qq.kind !== "text" && options.length < 2) return onToast(`"${qt}" 보기를 2개 이상 적어 주세요.`);
      questions.push({ ...qq, title: qt, options });
    }
    let targets: string[] = [];
    if (tk === "dept") {
      if (!deptSel.length) return onToast("대상 부서를 1개 이상 골라 주세요.");
      targets = [...deptSel];
    } else if (tk === "selected") {
      if (!uidSel.length) return onToast("대상 교사를 1명 이상 골라 주세요.");
      targets = [...uidSel];
    }
    const base: SurveyItem = {
      id: initial?.id ?? newId("sv"), title: t, description: desc.trim(), visibility: vis, targetKind: tk, targets,
      questions, attachments: atts, createdBy: initial?.createdBy ?? me.id, createdByName: initial?.createdByName ?? me.name,
      createdAt: initial?.createdAt ?? new Date().toISOString(), closesAt: closes || null,
      nudgeCount: initial?.nudgeCount ?? 0, lastNudgedAt: initial?.lastNudgedAt ?? null,
    };
    if (initial) {
      updateSurvey(initial.id, base);
      onToast("설문을 수정했어요.");
    } else {
      addSurvey(base);
      const ids = targetedCandidates(base, teachers).map((c) => c.id).filter((id) => id !== me.id);
      onNotifySubjects?.(`[설문] ${t}`, "설문이 도착했어요. 참여해 주세요.", ids);
      onToast("설문을 등록하고 대상자에게 알렸어요.");
    }
    onClose();
  };

  return (
    <div className="edu-card p-3.5 anim-card flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-extrabold text-[15px]">{initial ? "설문 수정" : "새 설문"}</span>
        <span className="text-[11.5px] text-edu-sub">{initial ? "응답·독려 기록은 그대로 유지돼요." : "등록하면 대상자에게 [설문] 알림이 가요."}</span>
        <button type="button" className="edu-ghost !text-[12.5px] ml-auto" onClick={onClose}>취소</button>
      </div>

      <div>
        <div className="text-[12px] font-bold text-edu-sub mb-1">제목</div>
        <input className="edu-input !py-2" placeholder="예: 2학기 현장체험학습 희망 조사" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      </div>
      <div>
        <div className="text-[12px] font-bold text-edu-sub mb-1">설명</div>
        <textarea className="edu-input min-h-[70px]" placeholder="설문 안내 문구 (선택)" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[12px] font-bold text-edu-sub">공개 범위</div>
        <Seg value={vis} onChange={setVis} options={[{ value: "public" as const, label: "공개" }, { value: "private" as const, label: "미공개" }]} />
        <span className="text-[11.5px] text-edu-sub">공개=대상자 전원이 응답 · 미공개=작성자만 확인</span>
      </div>

      <div>
        <div className="text-[12px] font-bold text-edu-sub mb-1">대상</div>
        <Seg value={tk} onChange={setTk} options={[{ value: "all" as const, label: "전체" }, { value: "dept" as const, label: "부서별" }, { value: "selected" as const, label: "선택" }]} />
        {tk === "dept" && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {depts.length === 0 && <span className="text-[12px] text-edu-sub">등록된 부서가 없어요.</span>}
            {depts.map((d) => <Pick key={d} label={d} on={deptSel.includes(d)} onClick={() => toggleIn(deptSel, d, setDeptSel)} />)}
          </div>
        )}
        {tk === "selected" && (
          <div className="mt-1.5">
            <div className="flex items-center gap-1.5">
              <input className="edu-input !py-1.5 !text-[12.5px]" placeholder="교사 이름·부서 검색" value={tq} onChange={(e) => setTq(e.target.value)} maxLength={20} />
              <span className="text-[11.5px] font-bold text-edu-strong shrink-0">선택 {uidSel.length}명</span>
            </div>
            <div className="mt-1.5 max-h-[150px] overflow-y-auto flex flex-wrap gap-1.5 border border-edu-line rounded-xl p-2">
              {pickedTeachers.length === 0 && <span className="text-[12px] text-edu-sub">찾은 교사가 없어요.</span>}
              {pickedTeachers.map((t) => (
                <Pick key={t.id} label={`${t.name}${t.dept ? `·${t.dept}` : ""}`} on={uidSel.includes(t.id)} onClick={() => toggleIn(uidSel, t.id, setUidSel)} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <IconCalendar size={14} className="text-edu-sub" />
        <div className="text-[12px] font-bold text-edu-sub">마감일</div>
        <input type="datetime-local" className="edu-input !w-[210px] !py-1.5 !text-[12.5px]" value={closes} onChange={(e) => setCloses(e.target.value)} />
        {closes && <button type="button" className="text-[11.5px] font-bold text-edu-sub" onClick={() => setCloses("")}>비우기</button>}
        <span className="text-[11.5px] text-edu-sub">비우면 마감 없음</span>
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <div className="text-[12px] font-bold text-edu-sub">첨부 파일</div>
          <BzTooltip content="설문과 함께 배포할 파일을 붙여요">
            <button type="button" className="edu-ghost !py-1 !px-2 !text-[12px] inline-flex items-center gap-1" onClick={() => void addFiles()}>
              <IconPaperclip size={12} /> 첨부
            </button>
          </BzTooltip>
          <span className="text-[11.5px] text-edu-sub">{atts.length}개</span>
        </div>
        <AttachRows list={atts} onToast={onToast} onDelete={(a) => void dropAtt(a)} />
      </div>

      <div>
        <div className="text-[12px] font-bold text-edu-sub mb-1">질문 ({qs.length})</div>
        <div className="flex flex-col gap-2">
          {qs.map((qq, qi) => (
            <div key={qq.id} className="border border-edu-line rounded-xl p-2.5 bg-edu-bg">
              <div className="flex items-center gap-1.5">
                <span className={`${chipOn} ${chipSoft}`}>{qi + 1} · {qq.kind === "single" ? "단일 선택" : qq.kind === "multi" ? "복수 선택" : "주관식"}</span>
                <input className="edu-input !py-1.5 !text-[12.5px] flex-1 min-w-[100px]" placeholder="질문 제목" value={qq.title}
                  onChange={(e) => patchQ(qq.id, { title: e.target.value })} maxLength={120} />
                <BzTooltip content="질문 삭제" position="left">
                  <button type="button" className="text-edu-sub hover:text-edu-strong shrink-0" onClick={() => removeQ(qq.id)}><IconTrash size={14} /></button>
                </BzTooltip>
              </div>
              {qq.kind !== "text" && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {qq.options.map((o) => (
                    <div key={o.id} className="flex items-center gap-1.5">
                      <span className="text-edu-muted text-[12px] w-3 text-center shrink-0">{qq.kind === "single" ? "○" : "□"}</span>
                      <input className="edu-input !py-1.5 !text-[12.5px] flex-1" placeholder="보기 내용" value={o.label}
                        onChange={(e) => patchOpt(qq.id, o.id, e.target.value)} maxLength={80} />
                      <BzTooltip content={qq.options.length <= 2 ? "보기는 최소 2개" : "보기 삭제"} position="left">
                        <button type="button" className="text-edu-sub hover:text-edu-strong shrink-0" onClick={() => removeOpt(qq.id, o.id)}><IconX size={13} /></button>
                      </BzTooltip>
                    </div>
                  ))}
                  <button type="button" className="text-[12px] font-bold text-edu-strong self-start" onClick={() => addOpt(qq.id)}>＋ 보기 추가</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button type="button" className="edu-ghost !text-[12.5px] inline-flex items-center gap-1" onClick={() => addQ("single")}><IconPlus size={12} /> 단일 선택</button>
          <button type="button" className="edu-ghost !text-[12.5px] inline-flex items-center gap-1" onClick={() => addQ("multi")}><IconPlus size={12} /> 복수 선택</button>
          <button type="button" className="edu-ghost !text-[12.5px] inline-flex items-center gap-1" onClick={() => addQ("text")}><IconPlus size={12} /> 주관식</button>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[11.5px] text-edu-sub">
          질문 {qs.length}개 · 대상 {tk === "all" ? "전체" : tk === "dept" ? `${deptSel.length}개 부서` : `${uidSel.length}명`}
        </span>
        <button type="button" className="edu-btn ml-auto" onClick={save}>{initial ? "수정 저장" : "등록"}</button>
      </div>
    </div>
  );
}

// ---------- 상세/응답 화면 ----------
function SurveyDetail({ me, sv, responses, onBack, onResults, onToast }: {
  me: SurveyMe; sv: SurveyItem; responses: SurveyResponse[];
  onBack: () => void; onResults?: () => void; onToast: (t: string) => void;
}) {
  const submitResponse = useSurveys((s) => s.submitResponse);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const mine = useMemo(() => responses.find((r) => r.surveyId === sv.id && r.respondentUid === me.id) ?? null, [responses, sv.id, me.id]);
  const targeted = useMemo(() => isTargeted(sv, me), [sv, me]);
  const closed = isSurveyClosed(sv);
  const pickSingle = (qid: string, oid: string) => setDraft((d) => ({ ...d, [qid]: [oid] }));
  const pickMulti = (qid: string, oid: string) =>
    setDraft((d) => {
      const cur = d[qid] ?? [];
      return { ...d, [qid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid] };
    });
  const typeText = (qid: string, v: string) => setDraft((d) => ({ ...d, [qid]: v ? [v] : [] }));
  const submit = () => {
    const answers: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(draft)) {
      const clean = v.map((x) => x.trim()).filter(Boolean);
      if (clean.length) answers[k] = clean;
    }
    if (!Object.keys(answers).length) return onToast("한 문항 이상 답해 주세요.");
    submitResponse(sv.id, { uid: me.id, name: me.name }, answers);
    onToast("응답을 제출했어요. 참여해 주셔서 고마워요.");
  };

  return (
    <div className="edu-card p-3.5 anim-card">
      <div className="flex items-start gap-2">
        <BzTooltip content="목록으로">
          <button type="button" className="edu-ghost !p-2 shrink-0" onClick={onBack}><IconChevronLeft size={15} /></button>
        </BzTooltip>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {sv.visibility === "private" && <span className={`${chipOn} ${chipMuted}`}>미공개</span>}
            <span className="font-extrabold text-[15.5px]">{sv.title}</span>
            <span className={`${chipOn} ${closed ? chipMuted : chipSoft}`}>{closed ? "마감" : "진행중"}</span>
          </div>
          <div className="text-[12px] text-edu-sub mt-0.5">
            {sv.createdByName} · {fmtWhen(sv.createdAt)} · 대상 {targetText(sv)} · 마감 {sv.closesAt ? fmtWhen(sv.closesAt) : "없음"}
          </div>
        </div>
        {onResults && (
          <BzTooltip content="문항별 응답 결과 보기" position="left">
            <button type="button" className="edu-ghost !text-[12.5px] inline-flex items-center gap-1 shrink-0" onClick={onResults}>
              <IconBarChart size={13} /> 결과 보기
            </button>
          </BzTooltip>
        )}
      </div>

      {sv.description && (
        <div className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap bg-edu-bg border border-edu-line rounded-xl p-2.5">{sv.description}</div>
      )}
      {sv.attachments.length > 0 && <div className="mt-2"><AttachRows list={sv.attachments} onToast={onToast} /></div>}

      <div className="mt-3 flex flex-col gap-3">
        {sv.questions.map((qq, i) => (
          <div key={qq.id}>
            <div className="font-bold text-[13.5px]">
              {i + 1}. {qq.title}
              {qq.kind === "multi" && <span className="ml-1 text-[11px] font-normal text-edu-muted">(복수 선택)</span>}
            </div>
            {mine ? (
              <div className="mt-1 text-[13px] text-edu-sub">{answerText(qq, mine)}</div>
            ) : qq.kind === "text" ? (
              <textarea className="edu-input min-h-[70px] mt-1.5" placeholder="답변을 적어 주세요" value={draft[qq.id]?.[0] ?? ""}
                onChange={(e) => typeText(qq.id, e.target.value)} maxLength={1000} disabled={!targeted || closed} />
            ) : (
              <div className="mt-1.5 flex flex-col gap-1">
                {qq.options.map((o) => {
                  const sel = (draft[qq.id] ?? []).includes(o.id);
                  return (
                    <button key={o.id} type="button" disabled={!targeted || closed}
                      onClick={() => (qq.kind === "single" ? pickSingle(qq.id, o.id) : pickMulti(qq.id, o.id))}
                      className={`w-full text-left px-2.5 py-1.5 rounded-xl border text-[13px] flex items-center gap-2 disabled:opacity-60 ${sel ? "border-edu-blueline bg-edu-soft text-edu-strong font-bold" : "border-edu-line hover:bg-edu-chip text-edu-ink"}`}>
                      <span className={`w-4 h-4 shrink-0 grid place-items-center ${qq.kind === "single" ? "rounded-full" : "rounded"} border ${sel ? "border-edu-blue" : "border-edu-line"}`}>
                        {sel && <IconCheck size={11} className="text-edu-blue" />}
                      </span>
                      <span className="truncate">{o.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {mine ? (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-bold text-edu-strong">✓ {fmtWhen(mine.createdAt)}에 응답했어요.</span>
          {onResults && <button type="button" className="edu-ghost !text-[12.5px] ml-auto" onClick={onResults}>결과 보기</button>}
        </div>
      ) : closed ? (
        <div className="mt-3 text-[12.5px] font-bold text-edu-sub text-center py-3 bg-edu-bg border border-edu-line rounded-xl">
          마감된 설문이에요.{onResults ? " 결과 보기에서 응답 내용을 확인할 수 있어요." : ""}
        </div>
      ) : !targeted ? (
        <div className="mt-3 text-[12.5px] text-edu-sub text-center py-3 bg-edu-bg border border-edu-line rounded-xl">
          이 설문의 대상자가 아니어서 응답에는 참여할 수 없어요.
        </div>
      ) : (
        <button type="button" className="edu-btn mt-3 w-full" onClick={submit}>응답 제출</button>
      )}
    </div>
  );
}

// ---------- 결과 리포트 ----------
function ResultReport({ me, sv, teachers, responses, onBack, onNudge, onToast }: {
  me: SurveyMe; sv: SurveyItem; teachers: TeacherLite[]; responses: SurveyResponse[];
  onBack: () => void; onNudge: (sv: SurveyItem) => void; onToast: (t: string) => void;
}) {
  const [showNon, setShowNon] = useState(false);
  const cands = useMemo(() => targetedCandidates(sv, teachers), [sv, teachers]);
  const respList = useMemo(() => surveyRespondents(sv.id, responses), [sv.id, responses]);
  const nrs = useMemo(() => nonRespondents(sv, responses, teachers), [sv, responses, teachers]);
  const isAuthor = sv.createdBy === me.id;
  const rate = pct(respList.length, cands.length);

  // 엑셀 내보내기 — 요약 시트 + 응답 시트(행=응답자, 열=문항)
  const exportXlsx = () => {
    try {
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet([
        ["설문 제목", sv.title], ["작성자", sv.createdByName], ["대상", targetText(sv)],
        ["공개 범위", sv.visibility === "public" ? "공개" : "미공개"],
        ["응답률", `${respList.length} / ${cands.length}명 (${rate}%)`],
        ["마감일", sv.closesAt ? fmtWhen(sv.closesAt) : "없음"], ["등록일", fmtWhen(sv.createdAt)],
        ["독려 횟수", sv.nudgeCount ?? 0],
      ]);
      XLSX.utils.book_append_sheet(wb, ws1, "요약");
      const depts = respList.map((r) => teachers.find((t) => t.id === r.respondentUid)?.dept ?? "");
      const withDept = depts.some(Boolean); // 부서를 알 수 있을 때만 열 추가
      const head = ["응답자", ...(withDept ? ["부서"] : []), "제출 시각", ...sv.questions.map((qq) => qq.title)];
      const rows = respList.map((r, i) => [
        r.respondentName, ...(withDept ? [depts[i]] : []), fmtWhen(r.createdAt),
        ...sv.questions.map((qq) => { const s = answerText(qq, r); return s === "(응답 없음)" ? "" : s; }),
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), "응답");
      XLSX.writeFile(wb, `${cleanFileName(sv.title)}_결과.xlsx`);
      onToast("엑셀 파일을 내려받았어요.");
    } catch { onToast("엑셀 파일을 만들지 못했어요."); }
  };

  return (
    <div className="edu-card p-3.5 anim-card">
      <div className="flex items-center gap-1.5 flex-wrap">
        <BzTooltip content="설문으로 돌아가기">
          <button type="button" className="edu-ghost !p-2 shrink-0" onClick={onBack}><IconChevronLeft size={15} /></button>
        </BzTooltip>
        <span className="font-extrabold text-[15px] inline-flex items-center gap-1.5 min-w-0">
          <IconBarChart size={15} className="text-edu-strong shrink-0" />
          <span className="truncate">결과 · {sv.title}</span>
        </span>
        <span className="ml-auto text-[12px] font-bold text-edu-strong shrink-0">응답 {respList.length}/{cands.length}명 · {rate}%</span>
      </div>
      <div className="text-[11.5px] text-edu-sub mt-0.5">
        {targetText(sv)} · {sv.visibility === "public" ? "공개" : "미공개"} · 마감 {sv.closesAt ? fmtWhen(sv.closesAt) : "없음"}
        {sv.nudgeCount ? ` · 독려 ${sv.nudgeCount}회` : ""}
      </div>

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <button type="button" className="edu-ghost !text-[12.5px] inline-flex items-center gap-1" onClick={() => setShowNon((v) => !v)}>
          <IconEye size={13} /> 미투표자 보기 ({nrs.length})
        </button>
        {isAuthor && (
          <BzTooltip content="아직 응답하지 않은 교사에게 다시 알려요">
            <button type="button" className="edu-ghost !text-[12.5px] inline-flex items-center gap-1" disabled={!nrs.length} onClick={() => onNudge(sv)}>
              <IconBell size={13} /> 설문 독려 알림
            </button>
          </BzTooltip>
        )}
        <BzTooltip content="문항별 응답을 엑셀 파일로 내려받아요" position="left">
          <button type="button" className="edu-ghost !text-[12.5px] inline-flex items-center gap-1 ml-auto" onClick={exportXlsx}>
            <IconDownload size={13} /> 엑셀(.xlsx) 다운로드
          </button>
        </BzTooltip>
      </div>

      {showNon && (
        <div className="mt-2 border border-edu-line rounded-xl overflow-hidden">
          <div className="bg-edu-bg px-2.5 py-1.5 text-[12px] font-bold text-edu-sub">
            미투표자 {nrs.length}명
            {sv.nudgeCount ? ` · 독려 ${sv.nudgeCount}회${sv.lastNudgedAt ? ` (최근 ${fmtWhen(sv.lastNudgedAt)})` : ""}` : ""}
          </div>
          <div className="max-h-[220px] overflow-y-auto divide-y divide-edu-line anim-list">
            {nrs.length === 0 && <div className="px-2.5 py-2 text-[12.5px] text-edu-sub">모두 응답했어요. 🎉</div>}
            {nrs.map((c) => (
              <div key={c.id} className="px-2.5 py-1.5 text-[12.5px] flex items-center gap-1.5">
                <IconUsers size={13} className="text-edu-muted shrink-0" />
                <span className="font-bold">{c.name}</span>
                <span className="text-edu-sub truncate">{c.dept}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {sv.questions.map((qq, i) => {
          const answered = respList.filter((r) => (r.answers[qq.id]?.length ?? 0) > 0);
          return (
            <div key={qq.id} className="border border-edu-line rounded-xl p-2.5">
              <div className="font-bold text-[13px]">
                {i + 1}. {qq.title}
                {qq.kind === "multi" && <span className="ml-1 text-[11px] font-normal text-edu-muted">(복수 선택)</span>}
              </div>
              {qq.kind === "text" ? (
                <div className="mt-1.5 flex flex-col gap-1">
                  {answered.length === 0 && <div className="text-[12px] text-edu-sub">아직 응답이 없어요.</div>}
                  {answered.map((r) => (
                    <div key={r.id} className="text-[12.5px] bg-edu-bg border border-edu-line rounded-lg px-2.5 py-1.5">
                      <span className="font-bold">{r.respondentName}</span> <span className="text-edu-sub">{r.answers[qq.id]?.[0] ?? ""}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {qq.options.map((o) => {
                    const cnt = respList.filter((r) => r.answers[qq.id]?.includes(o.id)).length;
                    const p = pct(cnt, answered.length);
                    return (
                      <div key={o.id}>
                        <div className="flex items-center justify-between text-[12.5px]">
                          <span className="truncate">{o.label}</span>
                          <span className="text-edu-sub shrink-0 ml-2">{cnt}명 · {p}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-edu-chip overflow-hidden mt-0.5">
                          <div className="h-full rounded-full bg-edu-blue" style={{ width: `${p}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  <div className="text-[11px] text-edu-muted">응답 {answered.length}명 기준</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}