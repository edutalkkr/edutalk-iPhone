import type { ReactNode } from "react";
import type { Memo, Teacher } from "../../types";
import { PresenceDot } from "./LeftSidebar";

// 브리즈코어 우측 패널 (아크릴 유리): 자리배치도 · 학내 파일함 · 쪽지/결재 메모
interface Props {
  teachers: Teacher[];
  memos: Memo[];
  meId: string;
  onOpenMemo: (id: string) => void;
  onGoWork: () => void;
  onToast: (t: string) => void;
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="rp-section">
      <div className="rp-head">
        <span>{title}</span>
        {typeof count === "number" && <span className="rp-count">{count}</span>}
      </div>
      {children}
    </section>
  );
}

export default function RightPanel(p: Props) {
  const seated = p.teachers.filter((t) => t.id !== p.meId);
  const depts = [...new Set(seated.map((t) => t.dept || "미지정"))];
  const files = p.memos.filter((m) => m.hwpName).slice(0, 6);
  const recents = [...p.memos].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8);

  return (
    <aside className="rp" aria-label="자리배치·파일·쪽지">
      <Section title="🧑‍🏫 교직원 자리배치도" count={seated.length}>
        <div className="rp-seat-wrap">
          {depts.length === 0 && <div className="rp-empty">교사를 등록하면 자리배치가 나와요.</div>}
          {depts.map((d) => (
            <div key={d} className="rp-seat-group">
              <div className="rp-seat-dept">{d}</div>
              <div className="rp-seat-grid">
                {seated.filter((t) => (t.dept || "미지정") === d).map((t) => (
                  <button
                    key={t.id}
                    className="rp-seat"
                    title={`${t.name} · ${t.statusMessage} · ${t.ip || "주소 없음"}`}
                    onClick={() => p.onToast(`${t.name} · ${t.statusMessage} · ${t.ip || "주소 없음"}`)}
                  >
                    <span className="rp-seat-av" style={{ background: t.avatarColor }}>{(t.name || "?")[0]}</span>
                    <span className="rp-seat-info">
                      <span className="rp-seat-name">
                        <PresenceDot status={t.status} /> {t.name}
                      </span>
                      <span className="rp-seat-sub">{t.statusMessage}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="📎 학내 파일 보관함" count={files.length}>
        <div className="rp-list">
          {files.length === 0 && <div className="rp-empty">첨부된 파일이 없어요.</div>}
          {files.map((m) => (
            <button key={m.id} className="rp-row" onClick={() => p.onOpenMemo(m.id)} title={m.title}>
              <span className="rp-file-ico">📄</span>
              <span className="rp-row-main">
                <span className="rp-row-title">{m.hwpName}</span>
                <span className="rp-row-sub">{m.fromName} · {m.createdAt.slice(0, 10)}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="✉️ 쪽지·결재 메모" count={p.memos.length}>
        <div className="rp-list">
          {recents.length === 0 && <div className="rp-empty">주고받은 쪽지가 없어요.</div>}
          {recents.map((m) => (
            <button key={m.id} className="rp-row" onClick={() => p.onOpenMemo(m.id)} title={m.title}>
              {m.importance === "urgent" && <span className="rp-tag urgent">긴급</span>}
              {m.importance === "ref" && <span className="rp-tag ref">참고</span>}
              <span className="rp-row-main">
                <span className="rp-row-title">{m.title}</span>
                <span className="rp-row-sub">{m.fromName} · {m.createdAt.slice(5, 16)}</span>
              </span>
            </button>
          ))}
        </div>
        <button className="edu-ghost w-full mt-2 !text-[12.5px]" onClick={p.onGoWork}>쪽지함 전체 열기</button>
      </Section>
    </aside>
  );
}
