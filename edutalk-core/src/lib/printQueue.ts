// 보안 인쇄 대기열 (Killer ①) — 클라이언트 쪽 도우미.
//  · 학교 서버(onprem)가 닿으면 "교내 대기열"로 동작한다: 제출물은 서버에 보관되고,
//    인쇄실/공용 PC의 브리즈 앱에서 [출력]을 눌러야 실제로 종이에 나온다 (원격 승인).
//  · 서버가 없는 데모/단독 환경에서는 같은 UI로 "이 PC 대기열"(브라우저 저장소)로 동작한다.
//  · 실제 인쇄는 숨은 iframe 으로 안전하게(텍스트만) 그려 브라우저 인쇄 대화상자를 띄운다.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "../services/api";

export interface LocalPrintJob {
  id: number;
  title: string;
  content: string;
  ownerName: string;
  createdAt: string;
  status: "PENDING" | "RELEASED" | "CANCELLED";
  releasedBy: string;
  releasedAt: string | null;
}

interface PrintLocalState {
  seq: number;
  jobs: LocalPrintJob[];
  /** 이 PC 대기열에 넣기 → 만든 항목 반환 */
  add: (title: string, content: string, ownerName: string) => LocalPrintJob;
  /** 상태 바꾸기 (출력/취소) */
  mark: (id: number, status: LocalPrintJob["status"], by: string) => void;
  /** 처리된(출력/취소) 항목 정리 */
  clearDone: () => void;
}

export const usePrintLocal = create<PrintLocalState>()(
  persist(
    (set) => ({
      seq: 1,
      jobs: [],
      add: (title, content, ownerName) => {
        let made: LocalPrintJob | null = null;
        set((s) => {
          made = {
            id: s.seq,
            title: title.trim() || "(제목 없음)",
            content,
            ownerName,
            createdAt: new Date().toISOString(),
            status: "PENDING",
            releasedBy: "",
            releasedAt: null,
          };
          return { seq: s.seq + 1, jobs: [...s.jobs, made].slice(-200) };
        });
        // set 은 동기이므로 made 는 채워져 있다
        return made as unknown as LocalPrintJob;
      },
      mark: (id, status, by) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  status,
                  releasedBy: by,
                  releasedAt: new Date().toISOString(),
                  // 보안: 출력/취소된 문서의 원문은 즉시 파기한다 (기기 저장소에 남기지 않음)
                  content: status === "PENDING" ? j.content : "",
                }
              : j
          ),
        })),
      clearDone: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status === "PENDING") })),
    }),
    { name: "breeze-print" }
  )
);

// 서버 생존 확인은 60초 캐시 — 서버 없는 학교에서 매번 5초를 기다리지 않게.
let reach: { at: number; ok: boolean } | null = null;

export async function printServerReachable(): Promise<boolean> {
  const now = Date.now();
  if (reach && now - reach.at < 60000) return reach.ok;
  const ok = await api.healthCheck();
  reach = { at: now, ok };
  return ok;
}

/** 서버 상태가 바뀌면(로그인 등) 다음 확인 때 다시 물어보게 한다 */
export function resetPrintServerCache(): void {
  reach = null;
}

/**
 * 인쇄 문서를 숨은 iframe 에 그려 브라우저 인쇄 대화상자를 띄운다.
 *  · 본문은 반드시 textContent 로만 넣는다 (공지 본문에 섞인 태그로 인한 XSS 방지).
 *  · 인쇄 대화상자가 열려 있는 동안 iframe 을 유지하고, 잠시 뒤 정리한다.
 */
export function openPrintWindow(title: string, content: string): boolean {
  try {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) {
      frame.remove();
      return false;
    }
    const style = doc.createElement("style");
    style.textContent =
      "@font-face{font-family:'Breeze Print';font-weight:45 920;font-display:block;src:url('/fonts/PretendardVariable.woff2') format('woff2')}" +
      "body{font-family:'Breeze Print','Pretendard Variable',Pretendard,system-ui,sans-serif;margin:24px;color:#111}" +
      "h1{font-size:18px;margin:0 0 4px}" +
      ".meta{font-size:11px;color:#555;margin:0 0 16px;padding-bottom:8px;border-bottom:1px solid #ddd}" +
      "pre{font-family:inherit;font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;margin:0}";
    doc.head.appendChild(style);

    const cover = doc.createElement("div");
    const h1 = doc.createElement("h1");
    h1.textContent = title || "(제목 없음)";
    const meta = doc.createElement("p");
    meta.className = "meta";
    meta.textContent = `브리즈 보안 인쇄 · ${new Date().toLocaleString("ko-KR")} · 승인 출력본`;
    const pre = doc.createElement("pre");
    pre.textContent = content;
    cover.appendChild(h1);
    cover.appendChild(meta);
    cover.appendChild(pre);
    doc.body.appendChild(cover);

    const printNow = () => {
      try {
        win.focus();
        win.print();
      } catch { /* 인쇄 창이 닫힌 경우 */ }
    };
    // 번들 글꼴이 준비된 뒤 인쇄해야 미리보기에서도 같은 글꼴로 나온다.
    if (doc.fonts && typeof doc.fonts.ready?.then === "function") {
      void doc.fonts.ready.then(printNow).catch(printNow);
    } else {
      printNow();
    }
    window.setTimeout(() => {
      try { frame.remove(); } catch { /* 이미 정리됨 */ }
    }, 60000);
    return true;
  } catch {
    return false;
  }
}
