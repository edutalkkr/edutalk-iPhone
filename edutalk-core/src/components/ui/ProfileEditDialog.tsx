// 내 프로필 편집 — 이름·부서·과목·직책을 바꾼다.
//  · 저장하면 조직도·쪽지·시간표에 보이는 내 정보가 바로 갱신된다.
//  · 모든 안내 문구는 해요체를 쓴다.

import { useEffect, useState } from "react";
import type { Teacher } from "../../types";

const POSITIONS = ["담임", "교과교사", "부장", "교감", "교장", "행정실장", "행정직", "관리자"];

interface Props {
  open: boolean;
  me: Teacher;
  onClose: () => void;
  onSave: (patch: Partial<Teacher>) => void;
  onToast: (message: string) => void;
}

export default function ProfileEditDialog({ open, me, onClose, onSave, onToast }: Props) {
  const [name, setName] = useState(me.name);
  const [dept, setDept] = useState(me.dept);
  const [subject, setSubject] = useState(me.subject);
  const [position, setPosition] = useState(me.position || "교과교사");
  const [grade, setGrade] = useState(me.grade ?? "");
  const [classNo, setClassNo] = useState(me.classNo ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [car, setCar] = useState(me.carNumber ?? "");

  // 열릴 때마다 현재 프로필로 새로 채운다.
  useEffect(() => {
    if (!open) return;
    setName(me.name);
    setDept(me.dept);
    setSubject(me.subject);
    setPosition(me.position || "교과교사");
    setGrade(me.grade ?? "");
    setClassNo(me.classNo ?? "");
    setPhone(me.phone ?? "");
    setCar(me.carNumber ?? "");
  }, [open, me]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isHomeroom = position === "담임";

  const save = () => {
    if (!name.trim()) return onToast("이름을 적어 주세요.");
    if (!dept.trim()) return onToast("부서를 적어 주세요.");
    if (isHomeroom && !subject.trim()) return onToast("담임은 과목을 함께 적어 주세요.");
    const cleanGrade = isHomeroom ? grade.trim() : "";
    const cleanClass = isHomeroom ? classNo.trim() : "";
    onSave({
      name: name.trim(),
      dept: dept.trim(),
      subject: subject.trim(),
      position,
      grade: cleanGrade,
      classNo: cleanClass,
      phone: phone.trim(),
      carNumber: car.trim() || undefined,
      statusMessage: cleanGrade && cleanClass ? `${cleanGrade} ${cleanClass} 담임` : position,
    });
    onToast("프로필을 저장했어요.");
    onClose();
  };

  return (
    <div
      className="bz-overlay show"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-edit-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bz-modal" style={{ width: "min(460px, calc(100vw - 28px))", padding: 0 }}>
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-edu-line">
          <div
            className="w-12 h-12 rounded-2xl grid place-items-center text-white font-black text-lg shrink-0 select-none"
            style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}
            aria-hidden
          >
            {(name || me.name || "B").slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="profile-edit-title" className="text-[17px] font-extrabold text-edu-ink">내 프로필 편집</h2>
            <p className="mt-0.5 text-[12px] text-edu-sub">조직도와 쪽지에 보이는 내 정보를 바꿔요.</p>
          </div>
          <button type="button" className="bz-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3 max-h-[calc(100dvh-220px)] overflow-y-auto">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold text-edu-sub">이름</span>
            <input
              className="edu-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="이름 (예: 홍길동)"
              autoFocus
            />
          </label>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-edu-sub">부서</span>
              <input
                className="edu-input"
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                maxLength={20}
                placeholder="예: 2학년부"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-edu-sub">과목</span>
              <input
                className="edu-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={20}
                placeholder="예: 수학"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-edu-sub">직책</span>
              <select className="edu-input" value={position} onChange={(e) => setPosition(e.target.value)}>
                {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-edu-sub">연락처</span>
              <input
                className="edu-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={20}
                placeholder="예: 010-1234-5678"
              />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-edu-sub">학년</span>
              <input
                className="edu-input"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                maxLength={10}
                placeholder="예: 2학년"
                disabled={!isHomeroom}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-edu-sub">반</span>
              <input
                className="edu-input"
                value={classNo}
                onChange={(e) => setClassNo(e.target.value)}
                maxLength={10}
                placeholder="예: 1반"
                disabled={!isHomeroom}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-edu-sub">차량 4자리</span>
              <input
                className="edu-input"
                value={car}
                onChange={(e) => setCar(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                inputMode="numeric"
                placeholder="선택"
              />
            </label>
          </div>
          <p className="text-[11px] text-edu-muted leading-relaxed">
            담임 선생님만 학년·반을 적을 수 있어요. 차량 번호는 이중주차 알림에만 쓰여요.
          </p>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-edu-line">
          <button type="button" className="edu-ghost flex-1" onClick={onClose}>취소</button>
          <button type="button" className="edu-btn flex-1" onClick={save}>저장하기</button>
        </div>
      </div>
    </div>
  );
}
