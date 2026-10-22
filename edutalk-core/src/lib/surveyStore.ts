// 브리즈 설문 저장소 — 서버 없이도 동작하는 로컬 상태(zustand persist).
// 설문·응답은 이 PC의 localStorage에 보관하고, 첨부 바이너리는 fileStore(IndexedDB)에 둔다.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SurveyItem, SurveyResponse } from "../types";
import { fsDelete } from "./fileStore";

/** 대상 판정에 필요한 최소 정보 (id=교사 uid, dept=부서명) */
export interface SurveyPerson {
  id: string;
  name: string;
  dept: string;
}

interface SurveyState {
  surveys: SurveyItem[];
  responses: SurveyResponse[];
  addSurvey: (s: SurveyItem) => void;
  updateSurvey: (id: string, patch: Partial<SurveyItem>) => void;
  /** 설문 + 딸린 응답·첨부(IndexedDB)까지 함께 삭제 */
  removeSurvey: (id: string) => void;
  /** 같은 사람이 다시 제출하면 기존 응답을 교체(업서트) */
  submitResponse: (
    surveyId: string,
    respondent: { uid: string; name: string },
    answers: Record<string, string[]>
  ) => void;
  /** 독려 알림 발송 기록 (횟수·시각) */
  nudge: (surveyId: string) => void;
}

function newResponseId(): string {
  return `rs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useSurveys = create<SurveyState>()(
  persist(
    (set, get) => ({
      surveys: [],
      responses: [],

      addSurvey: (s) => set((st) => ({ surveys: [s, ...st.surveys] })),

      updateSurvey: (id, patch) =>
        set((st) => ({ surveys: st.surveys.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),

      removeSurvey: (id) => {
        const target = get().surveys.find((s) => s.id === id);
        if (target) {
          // 첨부 바이너리 정리 — 실패해도 화면 흐름은 막지 않는다
          for (const att of target.attachments) {
            if (att.storeId) void fsDelete(att.storeId);
          }
        }
        set((st) => ({
          surveys: st.surveys.filter((s) => s.id !== id),
          responses: st.responses.filter((r) => r.surveyId !== id),
        }));
      },

      submitResponse: (surveyId, respondent, answers) => {
        set((st) => {
          const prev = st.responses.find((r) => r.surveyId === surveyId && r.respondentUid === respondent.uid);
          const next: SurveyResponse = {
            id: prev?.id ?? newResponseId(),
            surveyId,
            respondentUid: respondent.uid,
            respondentName: respondent.name,
            createdAt: new Date().toISOString(),
            answers,
          };
          return {
            responses: prev ? st.responses.map((r) => (r.id === prev.id ? next : r)) : [...st.responses, next],
          };
        });
      },

      nudge: (surveyId) =>
        set((st) => ({
          surveys: st.surveys.map((s) =>
            s.id === surveyId ? { ...s, nudgeCount: (s.nudgeCount ?? 0) + 1, lastNudgedAt: new Date().toISOString() } : s
          ),
        })),
    }),
    { name: "breeze-surveys" }
  )
);

// ------------------------------------------------------------
// 순수 도우미 — 컴포넌트·다른 모듈에서 그대로 조합해 쓸 수 있게 내보낸다
// ------------------------------------------------------------

/** 이 사람이 설문 대상인가 (전체 / 부서 포함 / 개별 지목) */
export function isTargeted(survey: SurveyItem, person: { id: string; dept: string }): boolean {
  if (survey.targetKind === "all") return true;
  if (survey.targetKind === "dept") return survey.targets.includes(person.dept);
  return survey.targets.includes(person.id);
}

/** 후보 교사 목록에서 이 설문의 대상자만 추려낸다 */
export function targetedCandidates(survey: SurveyItem, candidates: SurveyPerson[]): SurveyPerson[] {
  return candidates.filter((c) => isTargeted(survey, c));
}

/** 설문 응답을 사람별 1건으로 정리 (업서트 전제지만 방어적으로 중복 제거) */
export function surveyRespondents(surveyId: string, responses: SurveyResponse[]): SurveyResponse[] {
  const seen = new Set<string>();
  const out: SurveyResponse[] = [];
  for (const r of responses) {
    if (r.surveyId !== surveyId || seen.has(r.respondentUid)) continue;
    seen.add(r.respondentUid);
    out.push(r);
  }
  return out;
}

/** 아직 응답하지 않은 대상자 명단 */
export function nonRespondents(
  survey: SurveyItem,
  responses: SurveyResponse[],
  candidates: SurveyPerson[]
): SurveyPerson[] {
  const done = new Set(surveyRespondents(survey.id, responses).map((r) => r.respondentUid));
  return targetedCandidates(survey, candidates).filter((c) => !done.has(c.id));
}

/** 나에게 보이는 설문 — 내가 만든 것 + 공개이며 내가 대상인 것 + 내가 이미 응답한 것 */
export function visibleSurveys(
  surveys: SurveyItem[],
  me: { id: string; dept: string },
  responses: SurveyResponse[]
): SurveyItem[] {
  const answered = new Set(responses.filter((r) => r.respondentUid === me.id).map((r) => r.surveyId));
  return surveys.filter(
    (s) => s.createdBy === me.id || (s.visibility === "public" && isTargeted(s, me)) || answered.has(s.id)
  );
}

/** 마감 시각이 지났는가 (마감일이 없으면 항상 열림) */
export function isSurveyClosed(survey: SurveyItem): boolean {
  if (!survey.closesAt) return false;
  const t = new Date(survey.closesAt).getTime();
  return Number.isFinite(t) && t < Date.now();
}
