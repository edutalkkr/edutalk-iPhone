import { create } from "zustand";

// 화면 모션: full(부드럽게·기본) | fade(나타나기·사라지기만) | off(뚝뚝 끊김)
export type MotionMode = "full" | "fade" | "off";

// 창 모양: classic(세로로 좁게·기본) | modern(넓게)
export type LayoutMode = "modern" | "classic";

// 창 작업 방식: single(한 창에서 작업·기본) | multi(여러 창으로 작업)
export type WindowMode = "single" | "multi";

// 이 저장소는 전역 화면 설정만 둔다. 쪽지·시간표·조직도 상태는 App의 useState가 들고,
// Rust 호출은 각 lib/repo.ts를 통한다 (과거 netMode/memos/peers 이원화는 2026-10 정리에서 제거).
interface EduState {
  motion: MotionMode;
  offWork: boolean;
  dark: boolean;
  toastOn: boolean;
  layout: LayoutMode;
  windowMode: WindowMode;
  setMotion: (m: MotionMode) => void;
  toggleOffWork: () => void;
  toggleDark: () => void;
  setToastOn: (v: boolean) => void;
  setLayout: (m: LayoutMode) => void;
  setWindowMode: (m: WindowMode) => void;
}

function loadMotion(): MotionMode {
  try {
    const v = localStorage.getItem("edutalk-motion");
    if (v === "fade" || v === "off" || v === "full") return v;
    // 정한 적 없으면 운영체제 설정을 따른다 (줄이기면 페이드만)
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return "fade";
    }
  } catch {
    /* 그대로 기본값 */
  }
  return "full";
}

export function applyLayoutAttr(m: LayoutMode) {
  try {
    document.documentElement.dataset.layout = m;
  } catch {
    /* 다음에 */
  }
}

export function applyMotionAttr(m: MotionMode) {
  try {
    document.documentElement.dataset.motion = m;
  } catch {
    /* 다음에 */
  }
}

function loadLayout(): LayoutMode {
  try {
    if (localStorage.getItem("edutalk-layout") === "modern") return "modern";
  } catch {
    /* 기본값 */
  }
  return "classic";
}

function loadWindowMode(): WindowMode {
  try {
    if (localStorage.getItem("edutalk-windowmode") === "multi") return "multi";
  } catch {
    /* 기본값 */
  }
  return "single";
}

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function loadToastOn(): boolean {
  try {
    return localStorage.getItem("edutalk-toast") !== "0";
  } catch {
    return true;
  }
}

export function applyDarkAttr(on: boolean) {
  try {
    if (on) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
  } catch {
    /* 다음에 */
  }
}

export const useEdu = create<EduState>((set, get) => ({
  motion: loadMotion(),
  offWork: loadFlag("edutalk-offwork"),
  dark: loadFlag("edutalk-dark"),
  toastOn: loadToastOn(),
  layout: loadLayout(),
  windowMode: loadWindowMode(),
  setMotion: (m: MotionMode) => {
    try {
      localStorage.setItem("edutalk-motion", m);
    } catch {
      /* 다음에 */
    }
    applyMotionAttr(m);
    set({ motion: m });
  },
  toggleOffWork: () => {
    const v = !get().offWork;
    try {
      localStorage.setItem("edutalk-offwork", v ? "1" : "0");
    } catch {
      /* 다음에 */
    }
    set({ offWork: v });
  },
  toggleDark: () => {
    const v = !get().dark;
    try {
      localStorage.setItem("edutalk-dark", v ? "1" : "0");
    } catch {
      /* 다음에 */
    }
    applyDarkAttr(v);
    set({ dark: v });
  },
  setToastOn: (v: boolean) => {
    try {
      localStorage.setItem("edutalk-toast", v ? "1" : "0");
    } catch {
      /* 다음에 */
    }
    set({ toastOn: v });
  },
  setLayout: (m: LayoutMode) => {
    try {
      localStorage.setItem("edutalk-layout", m);
    } catch {
      /* 다음에 */
    }
    applyLayoutAttr(m);
    set({ layout: m });
    // 실제 창 크기도 바꾼다 (화면 확인 모드에서는 무시)
    import("./lib/tauri").then(({ call }) => {
      call("layout_apply", { mode: m }).catch(() => undefined);
    });
  },
  setWindowMode: (m: WindowMode) => {
    try {
      localStorage.setItem("edutalk-windowmode", m);
    } catch {
      /* 다음에 */
    }
    set({ windowMode: m });
  },
}));
