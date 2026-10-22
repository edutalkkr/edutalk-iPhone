import { create } from "zustand";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { call } from "./lib/tauri";
import { isTauriDesktop } from "./lib/edition";

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
  /** Focus Mode — 평일 18시 이후·주말 자동 무음 + 상태 "퇴근 후 업무 휴식 중" */
  focus: boolean;
  /** 긴급 공지 사이렌 (기본 켜짐) */
  siren: boolean;
  /** 전체 화면 배율 — 글자·버튼·여백을 한 번에 키우거나 줄인다 (0.85 ~ 1.35) */
  uiScale: number;
  setMotion: (m: MotionMode) => void;
  toggleOffWork: () => void;
  toggleDark: () => void;
  setToastOn: (v: boolean) => void;
  setLayout: (m: LayoutMode) => void;
  setWindowMode: (m: WindowMode) => void;
  setFocus: (v: boolean) => void;
  setSiren: (v: boolean) => void;
  setUiScale: (v: number) => void;
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
    // 기본은 "여러 창": 메뉴(설정·쪽지함·시간표…)를 새 창으로 띄운다. 한 창으로 쓰려면 설정에서 바꾼다.
    if (localStorage.getItem("edutalk-windowmode") === "single") return "single";
  } catch {
    /* 기본값 */
  }
  return "multi";
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

const UI_SCALE_MIN = 0.85;
const UI_SCALE_MAX = 1.35;

export function normalizeUiScale(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(n * 100) / 100));
}

function loadUiScale(): number {
  try {
    return normalizeUiScale(localStorage.getItem("edutalk-uiscale") ?? "1");
  } catch {
    return 1;
  }
}

/** 앱 전체 배율을 적용한다. 설치판은 WebView 자체 줌을, 브라우저 미리보기는 CSS 줌을 쓴다. */
export function applyUiScale(raw: number) {
  const scale = normalizeUiScale(raw);
  try {
    document.documentElement.style.setProperty("--ui-scale", String(scale));
  } catch {
    /* 다음에 */
  }
  if (isTauriDesktop()) {
    // Tauri WebView 줌은 글자·여백·아이콘을 한 번에 키운다. 권한이 없거나 초기화 전이면 조용히 넘어간다.
    getCurrentWebview().setZoom(scale).catch(() => undefined);
    scheduleMainWindowResize(scale);
    return;
  }
  try {
    // 브라우저 미리보기용. width/height 보정은 styles.css의 #root 규칙이 담당한다.
    document.documentElement.dataset.previewZoom = "1";
  } catch {
    /* 다음에 */
  }
}

// 설치판은 WebView 줌으로 CSS 작업 영역이 좁아지지 않도록, 메인 창 크기를 배율만큼 함께 키운다.
// (예: 135% → 540×891) 이렇게 해야 380px 슬림 창에서도 레이아웃이 잘리지 않는다.
const BASE_WINDOW_W = 400;
const BASE_WINDOW_H = 660;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMainWindowResize(scale: number) {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    void resizeMainWindow(scale);
  }, 90);
}
async function resizeMainWindow(scale: number) {
  try {
    const win = getCurrentWindow();
    if (win.label !== "main") return;
    if (await win.isMaximized().catch(() => false)) return;
    const maxW = Math.max(380, Number(window.screen?.availWidth || 1920) - 48);
    const maxH = Math.max(540, Number(window.screen?.availHeight || 1080) - 88);
    const w = Math.min(maxW, Math.max(380, Math.round(BASE_WINDOW_W * scale)));
    const h = Math.min(maxH, Math.max(540, Math.round(BASE_WINDOW_H * scale)));
    await win.setSize(new LogicalSize(w, h)).catch(() => undefined);
  } catch {
    /* 창이 아직 준비되지 않았거나 권한이 없어도 배율 자체는 적용한다. */
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
  focus: loadFlag("edutalk-focus"),
  // 사이렌은 기본 켜짐 — 끄려면 설정에서 "0"
  siren: (() => {
    try {
      return localStorage.getItem("edutalk-siren") !== "0";
    } catch {
      return true;
    }
  })(),
  uiScale: loadUiScale(),
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
    call("layout_apply", { mode: m }).catch(() => undefined);
  },
  setWindowMode: (m: WindowMode) => {
    try {
      localStorage.setItem("edutalk-windowmode", m);
    } catch {
      /* 다음에 */
    }
    set({ windowMode: m });
  },
  setFocus: (v: boolean) => {
    try {
      localStorage.setItem("edutalk-focus", v ? "1" : "0");
    } catch {
      /* 다음에 */
    }
    set({ focus: v });
  },
  setSiren: (v: boolean) => {
    try {
      localStorage.setItem("edutalk-siren", v ? "1" : "0");
    } catch {
      /* 다음에 */
    }
    set({ siren: v });
  },
  setUiScale: (v: number) => {
    const scale = normalizeUiScale(v);
    try {
      localStorage.setItem("edutalk-uiscale", String(scale));
    } catch {
      /* 다음에 */
    }
    applyUiScale(scale);
    set({ uiScale: scale });
  },
}));

// 다른 창(설정 팝업 등)에서 화면 설정이 바뀌었을 때 이 창도 따라 맞춘다.
// 값은 localStorage를 공유하므로 다시 읽어 적용만 하면 된다.
export function syncUiFromStorage() {
  try {
    const motion = loadMotion();
    const dark = loadFlag("edutalk-dark");
    const offWork = loadFlag("edutalk-offwork");
    const toastOn = loadToastOn();
    const layout = loadLayout();
    const windowMode = loadWindowMode();
    const focus = loadFlag("edutalk-focus");
    const uiScale = loadUiScale();
    let siren = true;
    try {
      siren = localStorage.getItem("edutalk-siren") !== "0";
    } catch {
      /* 기본 켜짐 */
    }
    applyMotionAttr(motion);
    applyDarkAttr(dark);
    applyLayoutAttr(layout);
    applyUiScale(uiScale);
    useEdu.setState({ motion, dark, offWork, toastOn, layout, windowMode, focus, siren, uiScale });
  } catch {
    /* 다음에 */
  }
}
