// 업무/공지 (2026-10 개편)
//  · 공지 타겟팅: 전체 / 부서 / 직급 / 개별 교사 선택
//  · 게시기간(시작·종료) — 기간이 지나면 "게시 종료"로 흐려지고 팝업에서 빠진다
//  · 첨부파일 (IndexedDB 저장, 다운로드)
//  · AI 3줄 요약 (서버 AI · 키 없으면 로컬 요약 폴백) — 작성 미리보기 + 올라온 공지별 요약
//  · 관리자(교장·교감·관리자)는 다른 사람 공지도 강제 삭제할 수 있다
//  · 긴급 공지는 전 교사 화면 중앙 팝업 + 사이렌 (App이 담당)

import { useMemo, useState } from "react";
import type { MemoAttachment, NoticeItem, Teacher } from "../../types";
import WorkBox from "../WorkBox";
import ScheduledBox from "../ScheduledBox";
import BzTooltip from "../ui/BzTooltip";
import { bzConfirm } from "../ui/BzDialog";
import { summarize3, type SummaryResult } from "../../lib/ai";
import { fsDownload, fsPut, humanSize, newFileId, pickFiles } from "../../lib/fileStore";
import { IconPaperclip, IconSparkles, IconTrash, IconX, IconEye } from "../ui/BzIcons";

export interface NoticeDraft {
  title: string;
  body: string;
  urgent: boolean;
  scope: "all" | "dept";
  dept: string;
  targetKind: "all" | "dept" | "position" | "selected";
  targets: string[];
  startAt: string | null;
  expiresAt: string | null;
  attachments: MemoAttachment[];
}

interface Props {
  notices: NoticeItem[];
  teachers: Teacher[];
  meName: string;
  isAdmin?: boolean;
  onPublish: (d: NoticeDraft) => void;
  onTogglePopup: (id: string) => void;
  onDelete?: (id: string) => void;
  onToast: (t: string) => void;
}

function timeLabel(iso: string | null | undefined): string {
  return (iso ?? "").slice(0, 16).replace("T", " ");
}

function targetLabel(n: NoticeItem): string {
  if (n.targetKind === "dept") return `부서${n.targets?.length ? ` · ${n.targets.join(", ")}` : n.dept ? `·${n.dept}` : ""}`;
  if (n.targetKind === "position") return `직급 · ${(n.targets ?? []).join(", ")}`;
  if (n.targetKind === "selected") return `선택 ${n.targets?.length ?? 0}명`;
  return (n.scope ?? "all") === "dept" ? `부서${n.dept ? `·${n.dept}` : ""}` : "전체";
}

export default function WorkPane(p: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [targetKind, setTargetKind] = useState<NoticeDraft["targetKind"]>("all");
  const [deptPick, setDeptPick] = useState("");
  const [posPicks, setPosPicks] = useState<string[]>([]);
  const [teacherPicks, setTeacherPicks] = useState<string[]>([]);
  const [startAt, setStartAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [atts, setAtts] = useState<MemoAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [preview, setPreview] = useState<SummaryResult | null>(null);
  const [summaries, setSummaries] = useState<Record<string, SummaryResult>>({});
  const [summing, setSumming] = useState<string | null>(null);
  const [tab, setTab] = useState<"notice" | "box" | "reserved">("notice");

  const deptNames = useMemo(() => Array.from(new Set(p.teachers.map((t) => t.dept).filter(Boolean))), [p.teachers]);
  const positions = useMemo(() => Array.from(new Set(p.teachers.map((t) => t.position).filter(Boolean))), [p.teachers]);
  const others = p.teachers;

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
        const storeId = newFileId("na");
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

  const togglePick = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const doPublish = () => {
    if (!title.trim() || !body.trim()) return p.onToast("제목·내용을 적어 주세요.");
    if (targetKind === "dept" && !deptPick) return p.onToast("부서를 골라 주세요.");
    if (targetKind === "position" && !posPicks.length) return p.onToast("직급을 1개 이상 골라 주세요.");
    if (targetKind === "selected" && !teacherPicks.length) return p.onToast("공지를 받을 교사를 1명 이상 골라 주세요.");
    p.onPublish({
      title: title.trim(),
      body: body.trim(),
      urgent,
      scope: targetKind === "dept" ? "dept" : "all",
      dept: targetKind === "dept" ? deptPick : "",
      targetKind,
      targets: targetKind === "dept" ? [deptPick] : targetKind === "position" ? posPicks : targetKind === "selected" ? teacherPicks : [],
      startAt: startAt ? new Date(startAt).toISOString() : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      attachments: atts,
    });
    setTitle(""); setBody(""); setUrgent(false); setTargetKind("all"); setDeptPick(""); setPosPicks([]); setTeacherPicks([]); setStartAt(""); setExpiresAt(""); setAtts([]); setPreview(null);
  };

  const runSummary = async (id: string, text: string) => {
    setSumming(id);
    const r = await summarize3(text);
    setSummaries((s) => ({ ...s, [id]: r }));
    setSumming(null);
  };

  const readAttachment = (a: MemoAttachment) => {
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
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {(["notice", "box", "reserved"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-xl text-[13px] font-bold ${tab === t ? "bg-edu-soft text-edu-strong" : "text-edu-sub hover:bg-edu-chip"}`}
          >
            {t === "notice" ? "📢 공지" : t === "box" ? "🧰 업무함 (검색·일정·인수인계·수신함)" : "⏰ 예약 쪽지"}
          </button>
        ))}
      </div>
      {tab === "box" && <WorkBox onToast={p.onToast} />}
      {tab === "reserved" && <ScheduledBox onToast={p.onToast} />}
      {tab === "notice" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="edu-card p-3.5 anim-card">
            <div className="font-extrabold text-[15px]">공지 올리기</div>
            <div className="text-[12.5px] text-edu-sub">긴급으로 올리면 전 교사 화면에 중앙 팝업 + 사이렌이 울려요.</div>
            <div className="mt-2.5 flex flex-col gap-2">
              <input className="edu-input" placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
              <textarea className="edu-input min-h-[110px]" placeholder="내용 (Enter는 줄바꿈 — 올리기는 아래 버튼으로만)" value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} />
              <div className="flex items-center gap-1.5 flex-wrap">
                <BzTooltip content="파일 첨부 (최대 10개 · 개당 25MB)" position="bottom">
                  <button className="edu-ghost !px-2.5 !py-1.5 !text-[12px] inline-flex items-center gap-1" onClick={() => void attachFiles()} disabled={attaching}>
                    <IconPaperclip size={13} /> {attaching ? "첨부 중…" : `첨부 ${atts.length || ""}`}
                  </button>
                </BzTooltip>
                <BzTooltip content="AI가 공지를 3줄로 요약해 줘요 (서버 캐시 · 같은 공지는 즉시 표시)" position="bottom">
                  <button
                    className="edu-ghost !px-2.5 !py-1.5 !text-[12px] inline-flex items-center gap-1"
                    disabled={!body.trim() || summing === "preview"}
                    onClick={async () => {
                      setSumming("preview");
                      setPreview(await summarize3(`${title}\n${body}`));
                      setSumming(null);
                    }}
                  >
                    <IconSparkles size={13} /> {summing === "preview" ? "요약 중…" : "AI 3줄 요약"}
                  </button>
                </BzTooltip>
              </div>
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
              {preview && (
                <div className="text-[12.5px] bg-edu-soft border border-edu-blueline rounded-xl px-3 py-2">
                  <div className="font-extrabold text-edu-strong mb-0.5 inline-flex items-center gap-1">
                    <IconSparkles size={12} /> AI 3줄 요약 {preview.source === "gemini" ? (preview.cached ? "(서버 캐시)" : "(AI)") : "(로컬 요약)"}
                  </div>
                  <ul className="list-disc pl-4 leading-relaxed">
                    {preview.lines.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </div>
              )}
              <div className="text-[11.5px] font-bold text-edu-sub">공지 대상</div>
              <div className="flex gap-1.5 flex-wrap">
                {(["all", "dept", "position", "selected"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTargetKind(k)}
                    className={`px-3 py-1.5 rounded-full text-[12.5px] font-bold border ${targetKind === k ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                  >
                    {k === "all" ? "전체" : k === "dept" ? "부서" : k === "position" ? "직급" : "개별 선택"}
                  </button>
                ))}
              </div>
              {targetKind === "dept" && (
                <select className="edu-input" value={deptPick} onChange={(e) => setDeptPick(e.target.value)}>
                  <option value="">부서를 고르세요</option>
                  {deptNames.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              )}
              {targetKind === "position" && (
                <div className="flex gap-1.5 flex-wrap">
                  {positions.length === 0 && <span className="text-[12px] text-edu-sub">등록된 직급이 없어요.</span>}
                  {positions.map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => togglePick(posPicks, setPosPicks, pos)}
                      className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${posPicks.includes(pos) ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                    >
                      {posPicks.includes(pos) ? "✓ " : ""}{pos}
                    </button>
                  ))}
                </div>
              )}
              {targetKind === "selected" && (
                <div className="flex gap-1.5 flex-wrap max-h-[160px] overflow-y-auto">
                  {others.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => togglePick(teacherPicks, setTeacherPicks, t.id)}
                      className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${teacherPicks.includes(t.id) ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                    >
                      {teacherPicks.includes(t.id) ? "✓ " : ""}{t.name}{t.dept ? `·${t.dept}` : ""}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11.5px] font-bold text-edu-sub">게시 시작</span>
                <input type="datetime-local" className="edu-input !w-[200px] !py-1.5 !text-[12.5px]" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                <span className="text-[11.5px] font-bold text-edu-sub">게시 종료</span>
                <input type="datetime-local" className="edu-input !w-[200px] !py-1.5 !text-[12.5px]" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-[13px] font-bold">
                <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="w-4 h-4" />
                긴급 공지 (중앙 팝업 + 사이렌 강제 표시)
              </label>
              <button className="edu-btn" onClick={doPublish}>올리기</button>
            </div>
          </div>
          <div className="edu-card p-3.5 anim-card">
            <div className="font-extrabold text-[15px]">올라온 공지 ({p.notices.length})</div>
            <div className="mt-2 flex flex-col gap-1.5 max-h-[440px] md:max-h-[calc(100vh-250px)] overflow-y-auto">
              {p.notices.map((n) => {
                const now = new Date().toISOString();
                const expired = !!n.expiresAt && n.expiresAt < now;
                const upcoming = !!n.startAt && n.startAt > now;
                const sum = summaries[n.id];
                return (
                  <div
                    key={n.id}
                    className={`border rounded-edu px-3 py-2.5 ${n.level === "urgent" ? "border-[#F5C6C6]" : "border-edu-line"} ${expired ? "opacity-55" : ""}`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {n.level === "urgent" && <span className="text-[10.5px] font-extrabold bg-[#D92D20] text-white rounded-lg px-1.5 py-0.5">긴급</span>}
                      <span className="text-[10.5px] font-extrabold bg-edu-chip text-edu-sub rounded-lg px-1.5 py-0.5">{targetLabel(n)}</span>
                      {upcoming && <span className="text-[10.5px] font-extrabold bg-edu-soft text-edu-strong rounded-lg px-1.5 py-0.5">게시 예정</span>}
                      {expired && <span className="text-[10.5px] font-extrabold bg-edu-chip text-edu-sub rounded-lg px-1.5 py-0.5">게시 종료</span>}
                      <span className="font-bold text-[13.5px] flex-1">{n.title}</span>
                      {p.isAdmin && p.onDelete && (
                        <BzTooltip content="관리자 강제 삭제" position="left">
                          <button
                            className="w-6 h-6 grid place-items-center rounded-lg text-edu-sub hover:bg-[#FDECEC] hover:text-[#D92D20]"
                            aria-label="공지 강제 삭제"
                            onClick={async () => {
                              const ok = await bzConfirm({
                                title: "공지를 강제 삭제할까요?",
                                message: `"${n.title}" 공지를 모든 화면에서 즉시 내립니다.`,
                                confirmText: "삭제",
                                danger: true,
                              });
                              if (ok) p.onDelete?.(n.id);
                            }}
                          >
                            <IconTrash size={13} />
                          </button>
                        </BzTooltip>
                      )}
                    </div>
                    <div className="text-[13px] mt-1 whitespace-pre-wrap line-clamp-4">{n.body}</div>
                    {!!n.attachments?.length && (
                      <div className="mt-1.5 flex flex-col gap-1">
                        {n.attachments.map((a) => (
                          <button key={a.id} className="flex items-center gap-1.5 text-[12px] bg-edu-bg border border-edu-line rounded-lg px-2 py-1 hover:bg-edu-chip text-left" onClick={() => readAttachment(a)}>
                            <IconPaperclip size={12} className="text-edu-muted shrink-0" />
                            <span className="truncate flex-1 font-bold">{a.name}</span>
                            <span className="text-edu-muted text-[11px]">{humanSize(a.size)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {sum && (
                      <div className="mt-1.5 text-[12px] bg-edu-soft border border-edu-blueline rounded-xl px-2.5 py-1.5">
                        <span className="font-extrabold text-edu-strong inline-flex items-center gap-1">
                          <IconSparkles size={11} /> AI 요약 {sum.source === "gemini" ? (sum.cached ? "(서버 캐시)" : "(AI)") : "(로컬)"}
                        </span>
                        <ul className="list-disc pl-4 leading-relaxed mt-0.5">
                          {sum.lines.map((l, i) => <li key={i}>{l}</li>)}
                        </ul>
                      </div>
                    )}
                    <div className="text-[11.5px] text-edu-sub mt-1">
                      {n.fromName} · {timeLabel(n.createdAt)}
                      {n.startAt ? ` · 게시 ${timeLabel(n.startAt)}` : ""}
                      {n.expiresAt ? ` ~ ${timeLabel(n.expiresAt)}` : ""}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <button className="text-[12px] font-bold text-edu-strong" onClick={() => p.onTogglePopup(n.id)}>
                        {n.popup ? "팝업 끄기" : "팝업 켜기"}
                      </button>
                      <button
                        className="text-[12px] font-bold text-edu-strong inline-flex items-center gap-1"
                        disabled={summing === n.id}
                        onClick={() => void runSummary(n.id, `${n.title}\n${n.body}`)}
                      >
                        <IconSparkles size={12} /> {summing === n.id ? "요약 중…" : sum ? "다시 요약" : "AI 3줄 요약"}
                      </button>
                      <button className="text-[12px] font-bold text-edu-sub inline-flex items-center gap-1" onClick={() => p.onToast(n.body)}>
                        <IconEye size={12} /> 전체 보기
                      </button>
                    </div>
                  </div>
                );
              })}
              {p.notices.length === 0 && <div className="text-center text-edu-sub text-[13px] py-8">올라온 공지가 없어요.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
