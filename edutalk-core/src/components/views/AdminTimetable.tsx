import { useMemo, useState } from "react";
import type { TimetableTemplate, TimetableCell, Teacher, GradeClass } from "../../types";
import { bzConfirm } from "../ui/BzDialog";

interface Props {
  templates: TimetableTemplate[];
  teachers: Teacher[];
  gradeClasses: GradeClass[];
  onAdd: (t: Omit<TimetableTemplate, "id" | "createdAt" | "updatedAt" | "isPublished" | "publishedAt">) => void;
  onUpdate: (id: string, patch: Partial<TimetableTemplate>) => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
  onToast: (t: string) => void;
}

const WEEKDAYS = ["", "월", "화", "수", "목", "금"];
const PERIODS = 7;

export default function AdminTimetable(p: Props) {
  const [view, setView] = useState<"list" | "editor">("list");
  const [editing, setEditing] = useState<TimetableTemplate | null>(null);
  const [grid, setGrid] = useState<TimetableCell[]>([]);
  const [selectedGrade, setSelectedGrade] = useState("");
  const [selectedClass, setSelectedClass] = useState("");

  const classes = useMemo(() => {
    const map = new Map<string, GradeClass[]>();
    p.gradeClasses.forEach(c => {
      if (!map.has(c.grade)) map.set(c.grade, []);
      map.get(c.grade)!.push(c);
    });
    return map;
  }, [p.gradeClasses]);

  const grades = Array.from(classes.keys()).sort();

  const classOptions = useMemo(() => {
    const cls = classes.get(selectedGrade) || [];
    return cls.map(c => c.classNo).sort();
  }, [classes, selectedGrade]);

  const handleNewTemplate = () => {
    const emptyGrid: TimetableCell[] = [];
    for (let wd = 1; wd <= 5; wd++) {
      for (let pd = 1; pd <= PERIODS; pd++) {
        emptyGrid.push({ weekday: wd, period: pd, grade: selectedGrade || "1", classNo: selectedClass || "1", subject: "", room: "", teacher: "" });
      }
    }
    setGrid(emptyGrid);
    setEditing({ 
      id: "", name: "", schoolId: "", grade: selectedGrade || "1", classNo: selectedClass || "1", 
      cells: emptyGrid, createdBy: "", createdAt: "", updatedAt: "", isPublished: false 
    });
    setView("editor");
  };

  const handleEditTemplate = (t: TimetableTemplate) => {
    setGrid(t.cells);
    setEditing(t);
    setSelectedGrade(t.grade);
    setSelectedClass(t.classNo);
    setView("editor");
  };

  const handleCellChange = (weekday: number, period: number, field: "subject" | "room" | "teacher", value: string) => {
    setGrid(g => g.map(c => c.weekday === weekday && c.period === period ? { ...c, [field]: value } : c));
  };

  const handleSave = () => {
    if (!editing) return;
    const data = {
      name: editing.name || `${selectedGrade}학년 ${selectedClass}반 시간표`,
      schoolId: "school_001",
      grade: selectedGrade,
      classNo: selectedClass,
      cells: grid,
      createdBy: "admin_001",
    };
    if (editing.id) {
      p.onUpdate(editing.id, { ...data, updatedAt: new Date().toISOString() });
      p.onToast("시간표를 수정했어요.");
    } else {
      p.onAdd(data);
      p.onToast("시간표 템플릿을 만들었어요.");
    }
    setEditing(null);
    setView("list");
  };

  const handlePublish = (id: string) => {
    p.onPublish(id);
    p.onToast("시간표를 배포했어요.");
  };

  if (view === "editor") {
    return (
      <div className="anim-page space-y-4 p-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-edu-strong">시간표 편집기</h1>
          <div className="flex gap-2">
            <button className="edu-btn border border-edu-line bg-white" onClick={() => { setView("list"); setEditing(null); }}>취소</button>
            <button className="edu-btn" onClick={handleSave}>저장</button>
          </div>
        </div>

        <div className="anim-card edu-card p-4 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div><label className="block text-sm font-bold text-edu-sub mb-1">템플릿 이름</label><input className="edu-input" value={editing?.name || ""} onChange={e => setEditing(prev => prev ? { ...prev, name: e.target.value } : null)} placeholder="1학년 1반 시간표" /></div>
            <div><label className="block text-sm font-bold text-edu-sub mb-1">학년</label><select className="edu-input" value={selectedGrade} onChange={e => { setSelectedGrade(e.target.value); setSelectedClass(""); }}>{grades.map(g => <option key={g} value={g}>{g}학년</option>)}</select></div>
            <div><label className="block text-sm font-bold text-edu-sub mb-1">반</label><select className="edu-input" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>{classOptions.map(c => <option key={c} value={c}>{c}반</option>)}</select></div>
            <div><label className="block text-sm font-bold text-edu-sub mb-1">담당 교사</label><input className="edu-input" placeholder="자동 배정 또는 직접 입력" /></div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-edu-line">
              <thead>
                <tr className="bg-edu-bg">
                  <th className="p-2 border border-edu-line font-bold w-20">교시</th>
                  {WEEKDAYS.slice(1).map(wd => <th key={wd} className="p-2 border border-edu-line font-bold text-center">{wd}요일</th>)}
                </tr>
              </thead>
              <tbody>
                {[...Array(PERIODS)].map((_, pi) => (
                  <tr key={pi + 1}>
                    <td className="p-2 border border-edu-line font-bold text-center bg-edu-bg">{pi + 1}교시</td>
                    {WEEKDAYS.slice(1).map((_, wi) => {
                      const cell = grid.find(c => c.weekday === wi + 1 && c.period === pi + 1);
                      return (
                        <td key={wi} className="p-1 border border-edu-line min-h-[80px] bg-white">
                          <input className="w-full h-8 p-1 text-xs border border-edu-line rounded focus:border-edu-blue focus:outline-none" 
                            value={cell?.subject || ""} 
                            onChange={e => handleCellChange(wi + 1, pi + 1, "subject", e.target.value)} 
                            placeholder="과목" />
                          <input className="w-full h-8 p-1 text-xs border border-edu-line rounded focus:border-edu-blue focus:outline-none mt-1" 
                            value={cell?.room || ""} 
                            onChange={e => handleCellChange(wi + 1, pi + 1, "room", e.target.value)} 
                            placeholder="교실" />
                          <input className="w-full h-8 p-1 text-xs border border-edu-line rounded focus:border-edu-blue focus:outline-none mt-1" 
                            value={cell?.teacher || ""} 
                            onChange={e => handleCellChange(wi + 1, pi + 1, "teacher", e.target.value)} 
                            placeholder="교사" />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-page space-y-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-extrabold text-edu-strong">시간표 관리</h1>
        <div className="flex gap-2">
          <div className="grid grid-cols-2 gap-2 items-end">
            <div><label className="block text-sm font-bold text-edu-sub mb-1">학년</label><select className="edu-input" value={selectedGrade} onChange={e => { setSelectedGrade(e.target.value); setSelectedClass(""); }}><option value="">전체</option>{grades.map(g => <option key={g} value={g}>{g}학년</option>)}</select></div>
            <div><label className="block text-sm font-bold text-edu-sub mb-1">반</label><select className="edu-input" value={selectedClass} onChange={e => setSelectedClass(e.target.value)}><option value="">전체</option>{classOptions.map(c => <option key={c} value={c}>{c}반</option>)}</select></div>
          </div>
          <button className="edu-btn self-end" onClick={handleNewTemplate}>➕ 새 템플릿</button>
        </div>
      </div>

      <div className="anim-card edu-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-edu-bg border-b border-edu-line">
              <tr>
                <th className="p-3 text-left font-bold text-edu-sub">템플릿명</th>
                <th className="p-3 text-left font-bold text-edu-sub">학년/반</th>
                <th className="p-3 text-left font-bold text-edu-sub">작성자</th>
                <th className="p-3 text-left font-bold text-edu-sub">수정일</th>
                <th className="p-3 text-left font-bold text-edu-sub">상태</th>
                <th className="p-3 text-left font-bold text-edu-sub">관리</th>
              </tr>
            </thead>
            <tbody className="anim-list divide-y divide-edu-line">
              {p.templates.filter(t => (!selectedGrade || t.grade === selectedGrade) && (!selectedClass || t.classNo === selectedClass)).map(t => (
                <tr key={t.id} className="anim-card hover:bg-edu-chip">
                  <td className="p-3 font-bold">{t.name}</td>
                  <td className="p-3 text-edu-sub">{t.grade}학년 {t.classNo}반</td>
                  <td className="p-3 text-edu-sub">{t.createdBy}</td>
                  <td className="p-3 text-edu-sub text-xs">{new Date(t.updatedAt).toLocaleDateString()}</td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${t.isPublished ? "bg-[#ECFDF5] text-[#027A48]" : "bg-[#FFF0F1] text-[#B42318]"}`}>
                      {t.isPublished ? "배포됨" : "미배포"}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <button className="edu-btn !py-1 !px-2 !text-xs" onClick={() => handleEditTemplate(t)}>편집</button>
                      {!t.isPublished && <button className="edu-btn !py-1 !px-2 !text-xs bg-[#E8F4FB] text-[#0069A8] hover:bg-[#D6EFFF]" onClick={() => handlePublish(t.id)}>배포</button>}
                      <button className="edu-btn !py-1 !px-2 !text-xs bg-[#FFF0F1] text-[#B42318] hover:bg-[#FECACA]" onClick={async () => { const ok = await bzConfirm({ title: "정말 삭제하시겠습니까?", message: `"${t.name}" 템플릿을 삭제해요.`, confirmText: "삭제", danger: true }); if (ok) p.onDelete(t.id); }}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
              {p.templates.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-edu-sub">등록된 시간표 템플릿이 없어요.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}