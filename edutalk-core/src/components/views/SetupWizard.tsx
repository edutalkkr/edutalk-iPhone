import { useState } from "react";
import type { DeptGroup, Teacher } from "../../types";
import { AVATAR_COLORS, DEFAULT_DEPTS, ME_ID, type SchoolSetup } from "../../mock/initialData";
import type { SchoolLicense } from "../../lib/schoolSync";

interface Props {
  onDone: (me: Teacher, depts: DeptGroup[], school: SchoolSetup, license: SchoolLicense | null) => void;
  onToast: (t: string) => void;
}

// 처음 실행 설정 — 딱 2단계(내 프로필 → 부서 틀). 학교ID·이용권 단계는 없앴다.
export default function SetupWizard(p: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("2학년부");
  const [subject, setSubject] = useState("");
  const [position, setPosition] = useState("담임");
  const [grade, setGrade] = useState("2학년");
  const [classNo, setClassNo] = useState("1반");
  const [depts, setDepts] = useState<string[]>(DEFAULT_DEPTS.map((d) => d.name));
  const [newDept, setNewDept] = useState("");

  const finish = () => {
    if (!name.trim()) return p.onToast("이름을 적어 주세요.");
    if (!subject.trim()) return p.onToast("과목을 적어 주세요.");
    const color = AVATAR_COLORS[name.trim().length % AVATAR_COLORS.length];
    const me: Teacher = {
      id: ME_ID, name: name.trim(), dept, subject: subject.trim(), position,
      grade, classNo, avatarColor: color, status: "online",
      statusMessage: `${grade} ${classNo} 담임`, ip: "이 PC", subCount: 0, phone: "",
    };
    const groups: DeptGroup[] = depts.filter(Boolean).map((n, i) => ({
      id: `d-${i}`, name: n, members: n === dept ? [ME_ID] : [],
    }));
    p.onDone(me, groups, { schoolId: "", schoolName: "" }, null);
  };

  return (
    <div className="min-h-screen grid place-items-center bg-edu-bg p-4">
      <div className="edu-card w-full max-w-[520px] p-6 anim-card">
        <div className="flex items-center gap-2.5">
          <div className="w-11 h-11 rounded-2xl grid place-items-center text-white font-black text-lg" style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}>B</div>
          <div>
            <div className="font-black text-[17px]">브리즈 처음 실행</div>
            <div className="text-[12.5px] text-edu-sub">교사 전용 · 자료는 이 PC에만 저장돼요 ({step + 1}/2)</div>
          </div>
        </div>
        {step === 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="font-extrabold text-[14px]">내 프로필</div>
            <input className="edu-input" placeholder="이름 (예: 홍길동)" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
            <div className="grid grid-cols-2 gap-2">
              <input className="edu-input" placeholder="부서 (예: 2학년부)" value={dept} onChange={(e) => setDept(e.target.value)} maxLength={20} />
              <input className="edu-input" placeholder="과목 (예: 수학)" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={20} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input className="edu-input" placeholder="직책" value={position} onChange={(e) => setPosition(e.target.value)} maxLength={20} />
              <input className="edu-input" placeholder="학년" value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={10} />
              <input className="edu-input" placeholder="반" value={classNo} onChange={(e) => setClassNo(e.target.value)} maxLength={10} />
            </div>
            <button className="edu-btn mt-1" onClick={() => { if (!name.trim() || !subject.trim()) return p.onToast("이름·과목을 적어 주세요."); setStep(1); }}>다음</button>
          </div>
        )}
        {step === 1 && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="font-extrabold text-[14px]">부서 틀</div>
            <div className="text-[12.5px] text-edu-sub">우리 학교 부서 이름으로 바꾸거나 지워도 돼요. 나중에 조직도에서 교사를 등록하며 채울 수 있어요.</div>
            {depts.map((d, i) => (
              <div key={i} className="flex gap-1.5">
                <input className="edu-input" value={d} onChange={(e) => setDepts((s) => s.map((x, j) => (j === i ? e.target.value : x)))} maxLength={20} />
                <button className="edu-ghost shrink-0" onClick={() => setDepts((s) => s.filter((_, j) => j !== i))}>삭제</button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <input className="edu-input" placeholder="새 부서 이름" value={newDept} onChange={(e) => setNewDept(e.target.value)} maxLength={20} />
              <button className="edu-ghost shrink-0" onClick={() => { if (newDept.trim()) { setDepts((s) => [...s, newDept.trim()]); setNewDept(""); } }}>추가</button>
            </div>
            <div className="flex gap-2 mt-1">
              <button className="edu-ghost flex-1" onClick={() => setStep(0)}>뒤로</button>
              <button className="edu-btn flex-1" onClick={finish}>시작하기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
