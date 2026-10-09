import { useEffect, useState } from "react";
import { call, EventRow } from "../lib/tauri";

// 출근 팝업: 오늘 일정 + 수락 대기 보강을 카드로 한 번 보여준다
export default function MorningPopup() {
  const [show, setShow] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [subs, setSubs] = useState(0);

  useEffect(() => {
    if (sessionStorage.getItem("edutalk-morning") === "1") return;
    (async () => {
      try {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        const evs = await call<EventRow[]>("event_list");
        const mine = evs.filter((e) => e.date === today);
        const all = await call<{ status: string }[]>("substitute_list");
        const open = all.filter((s) => s.status === "open").length;
        if (mine.length > 0 || open > 0) {
          setEvents(mine);
          setSubs(open);
          setShow(true);
          sessionStorage.setItem("edutalk-morning", "1");
        }
      } catch {
        /* 다음에 */
      }
    })();
  }, []);

  if (!show) return null;
  return (
    <div className="edu-overlay"
      onClick={() => setShow(false)}>
      <div className="edu-modal" style={{ maxWidth: 448 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-[17px] mb-2">오늘 아침 한 장</h2>
        {events.map((e) => (
          <div key={e.id} className="text-sm border-b border-edu-line py-1.5 last:border-0">
            <b className="text-edu-blue">오늘</b> {e.title}
          </div>
        ))}
        {subs > 0 && <p className="text-sm mt-1">수락 대기 보강 {subs}건이 있어요.</p>}
        {events.length === 0 && subs === 0 && <p className="text-sm text-edu-sub">특별한 일정이 없어요.</p>}
        <button className="edu-btn w-full mt-4" onClick={() => setShow(false)}>
          확인
        </button>
      </div>
    </div>
  );
}
