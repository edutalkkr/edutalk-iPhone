import { useEffect, useMemo, useState } from "react";
import type { Memo, MemoComment, Teacher } from "../../types";
import { ME_ID } from "../../mock/initialData";
import { HoldButton, TemplatesBar } from "../ComposerExtras";
import PollBox from "../PollBox";

interface Props {
  memos: Memo[];
  comments: Record<string, MemoComment[]>;
  teachers: Teacher[];
  openId: string | null;
  presetTo?: Teacher | null;
  onOpen: (id: string | null) => void;
  onSend: (title: string, body: string, toIds: string[], hwpName: string, importance: Memo["importance"]) => { ok: boolean; error?: string };
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
  if(/(국어|수학|영어)\s*:\s*\d{1,3}\s*점/.test(text)) return { blocked: false, reason: "성적 표현이 들어있어요.", kind: "SCORE" };
  return { blocked: false, reason: "", kind: null };
}

export default function MemoPane(p: Props) {
  const [tab, setTab] = useState<"received" | "sent" | "write">("received");
  const [q, setQ] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [toIds, setToIds] = useState<string[]>(p.presetTo ? [p.presetTo.id] : []);
  const [hwp, setHwp] = useState("");
  const [imp, setImp] = useState<Memo["importance"]>("normal");
  const [warn, setWarn] = useState("");
  const [warnKey, setWarnKey] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [impFilter, setImpFilter] = useState<"all" | Memo["importance"]>("all");

  // 조직도에서 "쪽지 보내기"로 넘어오면 받는 사람을 갱신한다 (첫 마운트 이후 변경 대응)
  useEffect(() => {
    if (p.presetTo) setToIds((s) => (s.includes(p.presetTo!.id) ? s : [...s, p.presetTo!.id].slice(0, 20)));
  }, [p.presetTo]);

  const received = useMemo(() => p.memos.filter((m) => m.to.some((r) => r.uid === ME_ID)), [p.memos]);
  const sent = useMemo(() => p.memos.filter((m) => m.fromUid === ME_ID), [p.memos]);
  const base = tab === "received" ? received : sent;
  const list = useMemo(() => {
    let arr = base;
    if (impFilter !== "all") arr = arr.filter((m) => m.importance === impFilter);
    const s = q.trim();
    if (!s) return arr;
    return arr.filter((m) => `${m.title} ${m.body} ${m.fromName}`.includes(s));
  }, [base, q, impFilter]);
  const open = p.memos.find((m) => m.id === p.openId) ?? null;
  const openComments = open ? p.comments[open.id] ?? [] : [];

  const toggleTo = (id: string) => {
    if (toIds.includes(id)) {
      setToIds(toIds.filter((x) => x !== id));
      return;
    }
    if (toIds.length >= 20) {
      p.onToast("받는 사람은 최대 20명까지예요.");
      return;
    }
    setToIds([...toIds, id]);
  };

  const doSend = () => {
    if (!title.trim()) return p.onToast("제목을 적어 주세요.");
    if (!body.trim()) return p.onToast("내용을 적어 주세요.");
    if (!toIds.length) return p.onToast("받는 사람을 1명 이상 골라 주세요.");
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
      // 같은 문구에 한해 1회 확인 후 재전송 허용 (문구를 바꾸면 다시 확인)
      if (warnKey !== textKey) {
        setWarn(`주의: ${hit.reason} 그래도 보내려면 다시 보내기를 눌러 주세요.`);
        setWarnKey(textKey);
        return;
      }
    }
    const r = p.onSend(title.trim(), body.trim(), toIds, hwp.trim(), imp);
    if (r.ok) {
      setTitle(""); setBody(""); setToIds([]); setHwp(""); setWarn(""); setWarnKey(""); setTab("sent");
    } else p.onToast(r.error ?? "보내지 못했어요.");
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
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
            <input
              className="edu-input !w-[150px] !py-1.5 !text-[12.5px] ml-auto"
              placeholder="제목·내용 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={30}
            />
          )}
          {p.onGoChat && (
            <button className="px-3 py-1.5 rounded-xl text-[13px] font-bold text-edu-strong hover:bg-edu-chip" onClick={p.onGoChat} title="가벼운 1:1 대화로 이동">
              💬 빠른 대화
            </button>
          )}
        </div>
        {tab !== "write" && (
          <div className="mt-2 flex gap-1.5 flex-wrap">
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
          <div className="mt-3 flex flex-col gap-2">
            <TemplatesBar onInsert={(t) => setBody((s) => (s ? `${s}\n${t}` : t))} />
            <input className="edu-input" placeholder="제목 (예: [가정통신문] 동의서 회수)" value={title} onChange={(e) => { setTitle(e.target.value); setWarnKey(""); }} maxLength={80} />
            <div className="flex gap-1.5 flex-wrap">
              {p.teachers.filter((t) => t.id !== ME_ID).length === 0 && (
                <span className="text-[12px] text-edu-sub">받는 사람이 없어요. 조직도에서 교사를 먼저 등록해 주세요.</span>
              )}
              {p.teachers.filter((t) => t.id !== ME_ID).map((t) => (
                <button
                  key={t.id}
                  onClick={() => toggleTo(t.id)}
                  className={`px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${toIds.includes(t.id) ? "bg-edu-soft border-edu-blueline text-edu-strong" : "border-edu-line text-edu-sub"}`}
                >
                  {toIds.includes(t.id) ? "✓ " : ""}{t.name}{t.subject ? `·${t.subject}` : ""}
                </button>
              ))}
            </div>
            <textarea className="edu-input min-h-[120px]" placeholder="내용" value={body} onChange={(e) => { setBody(e.target.value); setWarnKey(""); }} maxLength={2000} />
            <div className="flex gap-2">
              <input className="edu-input" placeholder="HWP 첨부명 (예: 동의서.hwp, 비우면 없음)" value={hwp} onChange={(e) => setHwp(e.target.value)} />
              <select className="edu-input !w-[130px]" value={imp} onChange={(e) => setImp(e.target.value as Memo["importance"])}>
                <option value="normal">일반</option>
                <option value="urgent">긴급</option>
                <option value="ref">참고</option>
              </select>
            </div>
            {warn && <div className="text-[12.5px] font-bold text-[#B42318] bg-[#FFF0F1] border border-[#F5C6C6] rounded-xl px-3 py-2">{warn}</div>}
            <div className="text-[11.5px] text-edu-sub">받는 사람 {toIds.length}/20명 · 2명 이상이면 단체 쪽지예요. 대량은 1초 꾹 누르기로 보내요.</div>
            {toIds.length >= 5 ? (
              <HoldButton onDone={doSend} label={`1초 꾹 눌러 ${toIds.length}명에게 보내기`} busyLabel="보내는 중…" />
            ) : (
              <button className="edu-btn" onClick={doSend}>보내기</button>
            )}
            <div className="text-[11.5px] text-edu-sub">예약 발송·쉬는시간 발송은 업무/공지 탭의 예약 쪽지함을 써 주세요.</div>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5 max-h-[560px] overflow-y-auto pr-0.5 anim-list">
            {list.length === 0 && <div className="text-center text-edu-sub text-[13px] py-8">쪽지가 없어요.</div>}
            {list.map((m) => {
              const unread = m.to.filter((r) => !r.readAt).length;
              return (
                <button
                  key={m.id}
                  onClick={() => p.onOpen(m.id)}
                  className={`text-left border rounded-edu px-3 py-2.5 ${p.openId === m.id ? "border-edu-blueline bg-edu-soft" : "border-edu-line hover:bg-edu-bg"}`}
                >
                  <div className="flex items-center gap-1.5">
                    {m.importance === "urgent" && <span className="text-[10.5px] font-extrabold bg-[#FDE8E8] text-[#D92D20] border border-[#F5C6C6] rounded-lg px-1.5 py-0.5">긴급</span>}
                    {m.importance === "ref" && <span className="text-[10.5px] font-extrabold bg-[#EEF0F4] text-[#5B6472] border border-[#DDE1E8] rounded-lg px-1.5 py-0.5">참고</span>}
                    <span className="font-bold text-[13.5px] truncate flex-1">{m.title}</span>
                  </div>
                  <div className="text-[12px] text-edu-sub mt-0.5 truncate">{m.fromName} · {m.createdAt}{m.hwpName ? ` · 📎 ${m.hwpName}` : ""}</div>
                  {tab === "sent" && <div className="text-[11.5px] mt-0.5 font-bold text-edu-strong">{unread === 0 ? "전원 확인" : `${unread}명 미확인`}</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="edu-card p-3.5 anim-card h-fit lg:sticky lg:top-0">
        {!open ? (
          <div className="text-[13.5px] text-edu-sub text-center py-10">왼쪽에서 쪽지를 고르면<br />본문·수신확인표·댓글이 나와요.</div>
        ) : (
          <div>
            <div className="flex items-start gap-2">
              <div className="font-extrabold text-[15.5px] flex-1 leading-snug">{open.title}</div>
              <button className="edu-ghost !py-1 !px-2.5 !text-[12px]" onClick={() => p.onOpen(null)}>닫기</button>
            </div>
            <div className="text-[12px] text-edu-sub mt-1">{open.fromName} · {open.createdAt}{open.hwpName ? ` · 📎 ${open.hwpName}` : ""}</div>
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
                <button className="edu-ghost !text-[12.5px]" onClick={() => p.onToast(`${open.hwpName} 미리보기`)}>👁️ 미리보기</button>
                <button className="edu-ghost !text-[12.5px]" onClick={() => p.onAudit("HWP", open.hwpName, false)}>🧾 열람 기록 남기기</button>
              </div>
            )}
            <div className="mt-2 text-[14px] leading-relaxed whitespace-pre-wrap bg-edu-bg border border-edu-line rounded-xl p-3">{open.body}</div>
            <div className="mt-3 font-extrabold text-[13.5px]">수신확인표 ({open.to.filter((r) => r.readAt).length}/{open.to.length})</div>
            <div className="mt-1.5 border border-edu-line rounded-xl overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead className="bg-edu-bg text-edu-sub">
                  <tr><th className="text-left px-2.5 py-1.5 font-bold">받는 사람</th><th className="text-left px-2.5 py-1.5 font-bold">확인 시각</th><th className="px-2.5 py-1.5"></th></tr>
                </thead>
                <tbody>
                  {open.to.map((r) => (
                    <tr key={r.uid} className="border-t border-edu-line">
                      <td className="px-2.5 py-1.5 font-bold">{r.name}</td>
                      <td className="px-2.5 py-1.5 text-edu-sub">{r.readAt ?? "[미확인]"}</td>
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
                  <span className="font-bold">{c.fromName}</span> <span className="text-edu-sub text-[11.5px]">{c.createdAt}</span>
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
    </div>
  );
}
