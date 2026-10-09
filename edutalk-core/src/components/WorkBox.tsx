import { useEffect, useState } from "react";
import {
  call,
  EventRow,
  GuestRow,
  HandoverRow,
  HwptplRow,
  InboxRow,
  OrgNode,
  ScratchRow,
  SearchHit,
  TemplateRow,
} from "../lib/tauri";
import { readCsvText } from "../lib/csv";

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="anim-card edu-card p-4">
      <h3 className="font-bold text-sm">{title}</h3>
      <p className="text-xs text-edu-sub mb-3">{desc}</p>
      {children}
    </section>
  );
}

// 기기 안 검색 (제목·본문·댓글)
function SearchBox() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  async function run() {
    if (q.trim().length < 2) return;
    try {
      setHits(await call<SearchHit[]>("search", { query: q.trim() }));
    } catch {
      /* 다음에 */
    }
  }
  return (
    <Section title="기기 안 검색" desc="쪽지·댓글을 이 PC 안에서 바로 찾아요.">
      <div className="flex gap-2 mb-2">
        <input className="edu-input" value={q} maxLength={30} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()} placeholder="두 글자 이상" />
        <button className="edu-btn whitespace-nowrap" onClick={run}>찾기</button>
      </div>
      {hits.map((h, i) => (
        <div key={i} className="text-xs border-b border-edu-line py-1.5 last:border-0">
          <b>{h.kind === "memo" ? "쪽지" : "댓글"}</b> {h.title}
          <span className="block text-edu-sub">{stripTags(h.snippet)}</span>
        </div>
      ))}
      {hits.length === 0 && <p className="text-xs text-edu-sub">결과가 여기에 나와요.</p>}
    </Section>
  );
}

// 검색 스니펫은 서버(Rust)가 <mark> 하이라이트를 섞어 보낼 수 있어서,
// 태그는 전부 걷어내고 텍스트로만 그린다 (XSS 차단).
function stripTags(html: string): string {
  return String(html ?? "").replace(/<[^>]*>/g, "");
}

// 학사일정 D-Day
function EventsBox() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  async function load() {
    try {
      setRows(await call<EventRow[]>("event_list"));
    } catch { /* 다음에 */ }
  }
  useEffect(() => { load(); }, []);
  function dday(d: string): string {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const diff = Math.round((new Date(d + "T00:00:00").getTime() - t.getTime()) / 86400000);
    if (diff === 0) return "오늘";
    return diff > 0 ? `D-${diff}` : `D+${-diff}`;
  }
  async function add() {
    if (!title.trim() || !date) return;
    try {
      await call<string>("event_add", { title: title.trim(), date });
      setTitle("");
      setDate("");
      await load();
    } catch { /* 다음에 */ }
  }
  return (
    <Section title="학사일정 D-Day" desc="시험·방학·행사 날짜를 적어두면 며칠 남았는지 보여요.">
      <div className="flex gap-2 mb-2 flex-wrap">
        <input className="edu-input !w-40" value={title} maxLength={30} onChange={(e) => setTitle(e.target.value)} placeholder="예: 기말고사" />
        <input type="date" className="edu-input !w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="edu-btn !py-2" onClick={add}>추가</button>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-sm border-b border-edu-line py-1.5 last:border-0">
          <b className="text-edu-blue">{dday(r.date)}</b>
          <span className="flex-1">{r.title} <span className="text-xs text-edu-sub">{r.date}</span></span>
          <button className="text-xs text-edu-sub underline" onClick={async () => { await call("event_delete", { id: r.id }); load(); }}>
            지우기
          </button>
        </div>
      ))}
    </Section>
  );
}

// 담임 비밀 기록장 (비밀번호로 열고닫기)
function SecretBox() {
  const [pw, setPw] = useState("");
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState("");
  async function unlock() {
    setMsg("");
    try {
      const t = await call<string>("secret_load", { password: pw });
      setBody(t);
      setOpen(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "열지 못했어요.");
    }
  }
  async function save() {
    try {
      await call("secret_save", { password: pw, body });
      setMsg("잠가서 저장했어요.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "저장하지 못했어요.");
    }
  }
  function lock() {
    setOpen(false);
    setBody("");
    setPw("");
  }
  return (
    <Section title="담임 비밀 기록장" desc="비밀번호로 잠그는 학급 특이사항 장부예요. 밖으로 나갈 수 없어요.">
      {!open ? (
        <div className="flex gap-2">
          <input type="password" className="edu-input" value={pw} onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()} placeholder="비밀번호 4자리 이상" />
          <button className="edu-btn whitespace-nowrap" onClick={unlock}>열기</button>
        </div>
      ) : (
        <>
          <textarea className="edu-input min-h-[120px] mb-2" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-2">
            <button className="edu-btn" onClick={save}>잠가서 저장</button>
            <button className="edu-ghost" onClick={lock}>닫기</button>
          </div>
        </>
      )}
      {msg && <p className="text-xs text-edu-sub mt-2">{msg}</p>}
    </Section>
  );
}

// 조직도 (3열: 부서·학년·이름) + 엑셀(CSV) 한 번에 넣기
function OrgBox() {
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [msg, setMsg] = useState("");
  async function load() {
    try {
      setNodes(await call<OrgNode[]>("org_list"));
    } catch { /* 다음에 */ }
  }
  useEffect(() => { load(); }, []);
  async function importFile(f: File | undefined) {
    if (!f) return;
    const csv = await readCsvText(f);
    try {
      const n = await call<number>("org_import", { csv });
      setMsg(`${n}명을 넣었어요.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "읽지 못했어요.");
    }
  }
  const byDept = new Map<string, OrgNode[]>();
  nodes.forEach((n) => {
    const k = n.dept || "미지정";
    if (!byDept.has(k)) byDept.set(k, []);
    byDept.get(k)!.push(n);
  });
  return (
    <Section title="조직도" desc="부서·학년·이름 3열로 보여요. 엑셀을 CSV로 저장해 한 번에 넣을 수 있어요.">
      <label className="edu-ghost !py-1 !px-2 !text-xs cursor-pointer inline-block mb-2">
        조직도 CSV 넣기
        <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
      </label>
      {msg && <p className="text-xs text-edu-sub mb-2">{msg}</p>}
      {[...byDept.entries()].map(([dept, list]) => (
        <details key={dept} className="border-b border-edu-line py-1.5 last:border-0">
          <summary className="text-sm font-bold cursor-pointer">{dept} ({list.length}명)</summary>
          {list.map((n) => (
            <div key={n.id} className="text-xs text-edu-sub pl-4 py-0.5">
              {n.grade ? `${n.grade} ` : ""}{n.name}{n.role ? ` · ${n.role}` : ""}
            </div>
          ))}
        </details>
      ))}
      {nodes.length === 0 && <p className="text-xs text-edu-sub">아직 비어 있어요.</p>}
    </Section>
  );
}

// 임시 PIN (대체 강사·실습생용)
function GuestBox() {
  const [rows, setRows] = useState<GuestRow[]>([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState("7");
  const [made, setMade] = useState("");
  async function load() {
    try {
      setRows(await call<GuestRow[]>("guest_list"));
    } catch { /* 다음에 */ }
  }
  useEffect(() => { load(); }, []);
  async function make() {
    if (!name.trim()) return;
    try {
      const r = await call<{ pin: string; expires_at: string }>("guest_add", { name: name.trim(), days: Number(days) || 7 });
      setMade(`번호 ${r.pin} (${r.expires_at.slice(0, 10)}까지)`);
      setName("");
      await load();
    } catch (e) {
      setMade(e instanceof Error ? e.message : "만들지 못했어요.");
    }
  }
  return (
    <Section title="임시 출입 번호" desc="대체 강사·실습생용 숫자 6자리예요. 기한이 지나면 저절로 무효예요.">
      <div className="flex gap-2 mb-2 flex-wrap">
        <input className="edu-input !w-36" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="이름" />
        <input className="edu-input !w-24" value={days} inputMode="numeric" onChange={(e) => setDays(e.target.value)} placeholder="며칠" />
        <button className="edu-btn !py-2" onClick={make}>만들기</button>
      </div>
      {made && <p className="text-sm font-bold text-edu-blue mb-2">{made}</p>}
      {rows.map((g) => (
        <div key={g.pin} className="flex items-center gap-2 text-sm border-b border-edu-line py-1.5 last:border-0">
          <b className="tracking-widest">{g.pin}</b>
          <span className="flex-1 text-xs text-edu-sub">{g.name} · ~{g.expires_at.slice(0, 10)}{g.used ? " · 사용됨" : ""}</span>
          <button className="text-xs text-edu-sub underline" onClick={async () => { await call("guest_revoke", { pin: g.pin }); load(); }}>
            폐기
          </button>
        </div>
      ))}
    </Section>
  );
}

// 보직 인수인계함
function HandoverBox() {
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [newTag, setNewTag] = useState("");
  const [rows, setRows] = useState<HandoverRow[]>([]);
  const [body, setBody] = useState("");
  async function loadTags() {
    try {
      const t = await call<string[]>("handover_tags");
      setTags(t);
      if (!tag && t.length > 0) setTag(t[0]);
    } catch { /* 다음에 */ }
  }
  async function loadRows(t: string) {
    if (!t) return;
    try {
      setRows(await call<HandoverRow[]>("handover_list", { tag: t }));
    } catch { /* 다음에 */ }
  }
  useEffect(() => { loadTags(); }, []);
  useEffect(() => { loadRows(tag); }, [tag]);
  async function add() {
    const tg = (newTag.trim() || tag).trim();
    if (!tg || !body.trim()) return;
    try {
      await call<string>("handover_add", { tag: tg, body: body.trim() });
      setBody("");
      setNewTag("");
      await loadTags();
      setTag(tg);
      await loadRows(tg);
    } catch (e) {
      alert(e instanceof Error ? e.message : "남기지 못했어요.");
    }
  }
  return (
    <Section title="보직 인수인계함" desc="사람이 아니라 보직(예: 2026_과학부장) 기준으로 넘겨요.">
      <div className="flex gap-2 mb-2 flex-wrap">
        <select className="edu-input !w-44" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">보직 고르기</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="edu-input !w-44" value={newTag} maxLength={30} onChange={(e) => setNewTag(e.target.value)} placeholder="새 보직 (예: 2026_과학부장)" />
      </div>
      <div className="flex gap-2 mb-2">
        <input className="edu-input" value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} placeholder="넘길 말을 적어 주세요" />
        <button className="edu-btn whitespace-nowrap" onClick={add}>남기기</button>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="text-xs border-b border-edu-line py-1.5 last:border-0">
          {r.body}
          <span className="block text-edu-sub">{r.from_name} · {r.created_at.slice(0, 16).replace("T", " ")}</span>
        </div>
      ))}
    </Section>
  );
}

// 부서 공용 수신함
const DEPTS = ["교무부", "행정실", "보건실", "급식실", "방과후부"];

function InboxBox() {
  const [dept, setDept] = useState(DEPTS[0]);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  async function load(d: string) {
    try {
      setRows(await call<InboxRow[]>("inbox_list", { dept: d }));
    } catch { /* 다음에 */ }
  }
  useEffect(() => { load(dept); }, [dept]);
  async function add() {
    if (!title.trim()) return;
    try {
      await call<string>("inbox_add", { dept, title: title.trim(), body: body.trim() });
      setTitle("");
      setBody("");
      await load(dept);
    } catch { /* 다음에 */ }
  }
  async function state(id: string, s: string) {
    try {
      await call("inbox_set_state", { id, state: s });
      await load(dept);
    } catch { /* 다음에 */ }
  }
  const label = (s: string) => (s === "done" ? "처리됨" : s === "doing" ? "처리 중" : "새 쪽지");
  return (
    <Section title="부서 공용 수신함" desc="부서 앞으로 온 쪽지를 모으고 누가 처리 중인지 표시해요.">
      <div className="flex gap-1 mb-2 flex-wrap">
        {DEPTS.map((d) => (
          <button key={d} onClick={() => setDept(d)}
            className={`text-xs px-3 py-1.5 rounded-full border ${dept === d ? "bg-edu-blue text-white border-edu-blue font-bold" : "border-edu-line"}`}>
            {d}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mb-2">
        <input className="edu-input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder={`${dept}에 남길 제목`} />
        <button className="edu-btn whitespace-nowrap" onClick={add}>남기기</button>
      </div>
      <input className="edu-input mb-2" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder="내용 (짧게)" />
      {rows.map((r) => (
        <div key={r.id} className="text-xs border-b border-edu-line py-1.5 last:border-0">
          <b>{r.title}</b> <span className="text-edu-blue font-bold">[{label(r.state)}]</span>
          <span className="block text-edu-sub">{r.body} · {r.from_name}</span>
          <span className="flex gap-2 mt-1">
            <button className="underline text-edu-sub" onClick={() => state(r.id, "doing")}>처리 중</button>
            <button className="underline text-edu-sub" onClick={() => state(r.id, "done")}>처리됨</button>
          </span>
        </div>
      ))}
      {rows.length === 0 && <p className="text-xs text-edu-sub">비어 있어요.</p>}
    </Section>
  );
}

// 공용 HWP 서식함
function HwplBox() {
  const [rows, setRows] = useState<HwptplRow[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  async function load() {
    try {
      setRows(await call<HwptplRow[]>("hwptpl_list"));
    } catch { /* 다음에 */ }
  }
  useEffect(() => { load(); }, []);
  async function add() {
    if (!title.trim()) return;
    try {
      await call<string>("hwptpl_add", { title: title.trim(), note: note.trim() });
      setTitle("");
      setNote("");
      await load();
    } catch { /* 다음에 */ }
  }
  return (
    <Section title="공용 서식함" desc="학교에서 같이 쓰는 행정 서식 이름표예요. 실물은 담당자에게 받아주세요.">
      <div className="flex gap-2 mb-2 flex-wrap">
        <input className="edu-input !w-44" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="서식 이름" />
        <input className="edu-input flex-1" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="어디에 있는지 한 줄" />
        <button className="edu-btn !py-2" onClick={add}>넣기</button>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-sm border-b border-edu-line py-1.5 last:border-0">
          <span className="flex-1"><b>{r.title}</b> <span className="text-xs text-edu-sub">{r.note}</span></span>
          <button className="text-xs text-edu-sub underline" onClick={async () => { await call("hwptpl_delete", { id: r.id }); load(); }}>
            지우기
          </button>
        </div>
      ))}
    </Section>
  );
}

// 동시 메모장 (마지막 저장 우선)
function ScratchBox() {
  const [id, setId] = useState("우리반-공유장");
  const [body, setBody] = useState("");
  const [at, setAt] = useState("");
  async function load(v: string) {
    try {
      const r = await call<{ body: string; updated_at: string }>("scratch_get", { id: v });
      setBody(r.body);
      setAt(r.updated_at);
    } catch { /* 다음에 */ }
  }
  useEffect(() => { load(id); }, [id]);
  async function save() {
    try {
      const t = await call<string>("scratch_save", { id, body });
      setAt(t);
    } catch { /* 다음에 */ }
  }
  return (
    <Section title="동시 메모장" desc="같은 이름으로 열면 같이 써요. 늦게 저장한 게 남으니 중요한 건 쪽지로 보내주세요.">
      <input className="edu-input mb-2" value={id} maxLength={40} onChange={(e) => setId(e.target.value)} placeholder="방 이름 (예: 2학년-수학)" />
      <textarea className="edu-input min-h-[120px] mb-2" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex items-center gap-2">
        <button className="edu-btn" onClick={save}>저장</button>
        <button className="edu-ghost !py-2" onClick={() => load(id)}>다시 읽기</button>
        {at && <span className="text-xs text-edu-sub">마지막 저장 {at.slice(0, 16).replace("T", " ")}</span>}
      </div>
    </Section>
  );
}

// 문구함 관리 (넣기·지우기)
function TemplateBox({ onToast }: { onToast: (t: string) => void }) {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  async function load() {
    try {
      setRows(await call<TemplateRow[]>("template_list"));
    } catch { /* 다음에 */ }
  }
  useEffect(() => { load(); }, []);
  async function add() {
    if (!title.trim() || !body.trim()) {
      onToast("제목과 내용을 적어 주세요.");
      return;
    }
    try {
      await call<string>("template_add", { title: title.trim(), body: body.trim() });
      setTitle("");
      setBody("");
      await load();
    } catch { /* 다음에 */ }
  }
  return (
    <Section title="문구함" desc="쪽지 쓸 때 꺼내 쓰는 표준 문구예요.">
      <div className="flex gap-2 mb-2 flex-wrap">
        <input className="edu-input !w-36" value={title} maxLength={30} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
        <input className="edu-input flex-1" value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} placeholder="내용" />
        <button className="edu-btn !py-2" onClick={add}>넣기</button>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-sm border-b border-edu-line py-1.5 last:border-0">
          <span className="flex-1"><b>{r.title}</b> <span className="text-xs text-edu-sub">{r.body.slice(0, 50)}</span></span>
          <button className="text-xs text-edu-sub underline" onClick={async () => { await call("template_delete", { id: r.id }); load(); }}>
            지우기
          </button>
        </div>
      ))}
    </Section>
  );
}

export default function WorkBox({ onToast }: { onToast: (t: string) => void }) {
  return (
    <div className="work-grid grid grid-cols-1 lg:grid-cols-2 gap-4">
      <SearchBox />
      <EventsBox />
      <TemplateBox onToast={onToast} />
      <SecretBox />
      <OrgBox />
      <GuestBox />
      <HandoverBox />
      <InboxBox />
      <HwplBox />
      <ScratchBox />
    </div>
  );
}
