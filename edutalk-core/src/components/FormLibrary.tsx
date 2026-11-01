import { useEffect, useState } from "react";
import { listForms, downloadForm, type FormItem } from "../services/forms";

export default function FormLibrary({ enabled, open: openProp, onClose: onCloseProp }: { enabled: boolean; open?: boolean; onClose?: () => void }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp !== undefined ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (onCloseProp && !v) onCloseProp();
    else if (openProp === undefined) setInternalOpen(v);
  };
  const [forms, setForms] = useState<FormItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setForms(await listForms());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "양식을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const download = async (f: FormItem) => {
    setMsg("");
    try {
      await downloadForm(f.id, f.file_name);
      setMsg(`${f.title} 양식을 열었어요.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "다운로드에 실패했어요.");
    }
  };

  if (!enabled) return null;

  return (
    <>
      {openProp === undefined && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bz-form-fab"
          title="학교 공식 양식함"
          aria-label="학교 공식 양식함 열기"
        >
          📂
        </button>
      )}
      {open && (
        <div className="bz-overlay show" role="dialog" aria-modal="true">
          <div className="bz-modal bz-forms">
            <div className="bz-forms-head">
              <h2>학교 공식 양식함</h2>
              <button type="button" className="bz-close" onClick={() => setOpen(false)} aria-label="닫기">
                ✕
              </button>
            </div>
            <p className="bz-forms-lead">학기 내내 쓰는 서식을 여기서 바로 받아 쓸 수 있어요. 만료되지 않아요.</p>
            {loading && <div className="bz-forms-empty">불러오는 중…</div>}
            {!loading && forms.length === 0 && (
              <div className="bz-forms-empty">등록된 양식이 아직 없어요.</div>
            )}
            <div className="bz-forms-list">
              {forms.map((f) => (
                <div key={f.id} className="bz-form-row">
                  <div className="bz-form-info">
                    <b>{f.title}</b>
                    <small>
                      {f.category} · {f.file_name} · {Math.max(1, Math.round(f.size / 1024))}KB
                    </small>
                  </div>
                  <button type="button" className="bz-btn-soft" onClick={() => void download(f)}>
                    받기
                  </button>
                </div>
              ))}
            </div>
            {msg && <div className="bz-forms-msg">{msg}</div>}
          </div>
        </div>
      )}
    </>
  );
}
