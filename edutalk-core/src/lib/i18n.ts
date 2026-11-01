import { useEffect, useState } from "react";
//  · "번역기 돌린 듯한" 직역이 아니라, 영어권 사용자에게 자연스러운 문장으로 작성한다.
//  · 새 문자열은 ko/en 양쪽에 함께 추가한다. 누락 시 한국어로 폴백한다.

export type Lang = "ko" | "en";

const STORAGE_KEY = "breeze-lang";

let current: Lang = "ko";
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "ko" || saved === "en") current = saved;
} catch {
  /* 저장소가 막혀 있으면 기본값 사용 */
}

const dict: Record<string, { ko: string; en: string }> = {
  // 공통
  "common.close": { ko: "닫기", en: "Close" },
  "common.cancel": { ko: "취소", en: "Cancel" },
  "common.save": { ko: "저장", en: "Save" },
  "common.delete": { ko: "삭제", en: "Delete" },
  "common.edit": { ko: "수정", en: "Edit" },
  "common.add": { ko: "추가", en: "Add" },
  "common.search": { ko: "검색", en: "Search" },
  "common.loading": { ko: "불러오는 중…", en: "Loading…" },

  // 좌측 메뉴 탭
  "tab.org": { ko: "조직도", en: "Org Chart" },
  "tab.memo": { ko: "쪽지함", en: "Notes" },
  "tab.student-inbox": { ko: "학생 문의", en: "Student Inbox" },
  "tab.chat": { ko: "빠른 대화", en: "Quick Chat" },
  "tab.timetable": { ko: "시간표·대강", en: "Timetable" },
  "tab.work": { ko: "업무/공지", en: "Work & Notices" },
  "tab.consult": { ko: "AI 상담 일지", en: "AI Consult Log" },
  "tab.approval": { ko: "전자결재", en: "E-Approval" },
  "tab.whiteboard": { ko: "협업 보드", en: "Whiteboard" },
  "tab.cloud": { ko: "브리즈 클라우드", en: "Breeze Cloud" },
  "tab.print": { ko: "보안 인쇄", en: "Secure Print" },
  "tab.survey": { ko: "설문조사", en: "Survey" },
  "tab.audit": { ko: "보안·감사", en: "Security & Audit" },
  "tab.settings": { ko: "설정", en: "Settings" },
  "tab.admin-dashboard": { ko: "대시보드", en: "Dashboard" },
  "tab.admin-users": { ko: "사용자 관리", en: "Users" },
  "tab.admin-notices": { ko: "공지 관리", en: "Notices" },
  "tab.admin-timetable": { ko: "시간표 관리", en: "Timetable Mgmt" },
  "tab.admin-audit": { ko: "감사 로그", en: "Audit Log" },
  "tab.admin-settings": { ko: "학교 설정", en: "School Settings" },
  "tab.admin-school": { ko: "학교 정보", en: "School Info" },

  // 상태
  "status.online": { ko: "온라인", en: "Online" },
  "status.away": { ko: "자리 비움", en: "Away" },
  "status.busy": { ko: "바쁨", en: "Busy" },
  "status.in_class": { ko: "수업 중", en: "In Class" },
  "status.lunch": { ko: "점심시간", en: "Lunch" },
  "status.leave": { ko: "연차", en: "On Leave" },
  "status.sick": { ko: "병가", en: "Sick Leave" },
  "status.offline": { ko: "오프라인", en: "Offline" },

  // 퀵 메모
  "quick.title": { ko: "퀵 메모", en: "Quick Notes" },
  "quick.empty": { ko: "아직 메모가 없어요. 새 메모를 눌러 바로 적어 보세요.", en: "No notes yet. Tap “New note” to start writing." },
  "quick.new": { ko: "새 메모", en: "New note" },
  "quick.send": { ko: "쪽지로 전달", en: "Send as note" },

  // 토스트
  "toast.update.available": { ko: "새 버전이 있어요.", en: "A new version is available." },
};

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  // 같은 탭 내 다른 컴포넌트에 알림
  window.dispatchEvent(new CustomEvent("breeze-lang-change", { detail: lang }));
}

export function t(key: string): string {
  const entry = dict[key];
  if (!entry) return key;
  return entry[current] ?? entry.ko;
}

export function useLang(): Lang {
  const [lang, setLocal] = useState<Lang>(current);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Lang;
      setLocal(detail);
    };
    window.addEventListener("breeze-lang-change", handler);
    return () => window.removeEventListener("breeze-lang-change", handler);
  }, []);
  return lang;
}