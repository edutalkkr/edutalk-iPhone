import { useState, useMemo } from "react";
import type { DeptGroup, Teacher, LicenseKind } from "../../types";
import { AVATAR_COLORS, DEFAULT_DEPTS, ME_ID, type SchoolSetup } from "../../mock/initialData";
import type { SchoolLicense } from "../../lib/schoolSync";

interface Props {
  onDone: (me: Teacher, depts: DeptGroup[], school: SchoolSetup, license: SchoolLicense | null) => void;
  onToast: (t: string) => void;
}

const DEMO_ADMINS: Omit<Teacher, "id" | "avatarColor" | "status" | "statusMessage" | "ip" | "subCount" | "phone">[] = [
  { name: "관리자", dept: "관리부", subject: "", position: "관리자", grade: "", classNo: "" },
];

export default function SetupWizard(p: Props) {
  const [mode, setMode] = useState<"teacher" | "admin" | null>(null);
  const [step, setStep] = useState(0);
  
  // 교사 모드 필드
  const [name, setName] = useState("");
  const [dept, setDept] = useState("2학년부");
  const [subject, setSubject] = useState("");
  const [position, setPosition] = useState("담임");
  const [grade, setGrade] = useState("2학년");
  const [classNo, setClassNo] = useState("1반");
  
  // 관리자 모드 필드
  const [schoolName, setSchoolName] = useState("○○초등학교");
  const [schoolCode, setSchoolCode] = useState("SEOUL_001");
  const [schoolAddress, setSchoolAddress] = useState("");
  const [schoolPhone, setSchoolPhone] = useState("");
  const [principalName, setPrincipalName] = useState("");
  const [licenseKind, setLicenseKind] = useState<LicenseKind>("full");
  
  // 부서 관리
  const [depts, setDepts] = useState<string[]>(DEFAULT_DEPTS.map((d) => d.name));
  const [newDept, setNewDept] = useState("");

  const isAdmin = mode === "admin";

  const teacherDepts = useMemo(() => depts.filter(Boolean), [depts]);
  const adminDepts = useMemo(() => [...depts, "관리부", "행정실"].filter(Boolean), [depts]);

  const createAdmin = (t: typeof DEMO_ADMINS[0], idx: number): Teacher => ({
    ...t,
    id: `adm-${idx}`,
    avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
    status: "online" as const,
    statusMessage: "관리자",
    ip: "이 PC",
    subCount: 0,
    phone: "",
  });

  const finish = () => {
    if (isAdmin) {
      if (!schoolName.trim()) return p.onToast("학교명을 입력해 주세요.");
      if (!schoolCode.trim()) return p.onToast("학교 코드를 입력해 주세요.");
      
      const adminTeacher = createAdmin({ ...DEMO_ADMINS[0], name: name || "관리자" }, 0);
      const groups: DeptGroup[] = adminDepts.map((n, i) => ({
        id: `d-${i}`, name: n, members: n === "관리부" ? [adminTeacher.id] : [],
      }));
      const schoolSetup: SchoolSetup = { schoolId: schoolCode.trim(), schoolName: schoolName.trim() };
      
      const license: SchoolLicense = {
        status: "active",
        expiresText: "-",
        expiresMs: 0,
        type: licenseKind === "full" ? "admin_grant" : "single_chat_1y",
        typeLabel: licenseKind === "full" ? "관리자 직접 부여" : "단일망 소통 전용 1년",
        network: "dual",
        singleNet: "off",
        chatOnly: licenseKind === "chatOnly",
        kind: licenseKind,
        fetchedAt: new Date().toLocaleString("ko-KR"),
      };
      
      p.onDone(adminTeacher, groups, schoolSetup, license);
    } else {
      if (!name.trim()) return p.onToast("이름을 적어 주세요.");
      if (!subject.trim() && position === "담임") return p.onToast("과목을 적어 주세요.");
      
      const color = AVATAR_COLORS[name.trim().length % AVATAR_COLORS.length];
      const me: Teacher = {
        id: ME_ID, name: name.trim(), dept, subject: subject.trim(), position,
        grade: position === "담임" ? grade : "", classNo: position === "담임" ? classNo : "",
        avatarColor: color, status: "online",
        statusMessage: position === "담임" ? `${grade} ${classNo} 담임` : position,
        ip: "이 PC", subCount: 0, phone: "",
      };
      const groups: DeptGroup[] = teacherDepts.map((n, i) => ({
        id: `d-${i}`, name: n, members: n === dept ? [ME_ID] : [],
      }));
      p.onDone(me, groups, { schoolId: "", schoolName: "" }, null);
    }
  };

  const renderStepIndicator = () => (
    <div className="flex items-center gap-1 mb-6">
      {[0, 1, 2].map((i, idx) => (
        <span key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${
          idx <= step ? "bg-edu-blue" : "bg-edu-line"
        }`} />
      ))}
      {isAdmin && step === 2 && <span className="flex-1 h-1.5 rounded-full bg-edu-blue" />}
    </div>
  );

  return (
    <div className="min-h-screen grid place-items-center bg-edu-bg p-4">
      <div className="edu-card w-full max-w-[560px] p-6 anim-card">
        {!mode ? (
          <ModeSelection onSelect={setMode} onToast={p.onToast} />
        ) : (
          <>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-11 h-11 rounded-2xl grid place-items-center text-white font-black text-lg" style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}>B</div>
              <div>
                <div className="font-black text-[17px]">브리즈 처음 실행</div>
                <div className="text-[12.5px] text-edu-sub">
                  {isAdmin ? "교육기관 관리자 설정" : "교사 프로필 설정"} · 자료는 이 PC에만 저장돼요
                </div>
              </div>
            </div>
            
            {renderStepIndicator()}
            
            {step === 0 && (
              <div className="mt-4 flex flex-col gap-3">
                <div className="font-extrabold text-[14px]">{isAdmin ? "관리자 계정" : "내 프로필"}</div>
                
                <input className="edu-input" placeholder={isAdmin ? "관리자 이름 (예: 관리자)" : "이름 (예: 홍길동)"} value={name} onChange={e => setName(e.target.value)} maxLength={20} />
                
                {!isAdmin && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <input className="edu-input" placeholder="부서 (예: 2학년부)" value={dept} onChange={e => setDept(e.target.value)} maxLength={20} />
                      <input className="edu-input" placeholder="과목 (예: 수학)" value={subject} onChange={e => setSubject(e.target.value)} maxLength={20} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <select className="edu-input" value={position} onChange={e => setPosition(e.target.value)}>
                        <option value="담임">담임</option>
                        <option value="교사">교과교사</option>
                        <option value="교감">교감</option>
                        <option value="교장">교장</option>
                        <option value="행정실장">행정실장</option>
                        <option value="행정직">행정직</option>
                      </select>
                      <input className="edu-input" placeholder="학년" value={grade} onChange={e => setGrade(e.target.value)} maxLength={10} disabled={position !== "담임"} />
                      <input className="edu-input" placeholder="반" value={classNo} onChange={e => setClassNo(e.target.value)} maxLength={10} disabled={position !== "담임"} />
                    </div>
                  </>
                )}
                
                {isAdmin && (
                  <div className="grid grid-cols-2 gap-2">
                    <input className="edu-input" placeholder="학교명" value={schoolName} onChange={e => setSchoolName(e.target.value)} maxLength={30} />
                    <input className="edu-input" placeholder="학교 코드" value={schoolCode} onChange={e => setSchoolCode(e.target.value)} maxLength={20} />
                  </div>
                )}
                
                <button className="edu-btn mt-2" onClick={() => { 
                  if (!name.trim()) return p.onToast("이름을 입력해 주세요.");
                  if (!isAdmin && position === "담임" && !subject.trim()) return p.onToast("과목을 입력해 주세요.");
                  if (isAdmin && !schoolName.trim()) return p.onToast("학교명을 입력해 주세요.");
                  if (isAdmin && !schoolCode.trim()) return p.onToast("학교 코드를 입력해 주세요.");
                  setStep(1); 
                }}>
                  다음
                </button>
              </div>
            )}
            
            {step === 1 && (
              <div className="mt-4 flex flex-col gap-3">
                <div className="font-extrabold text-[14px]">부서 틀</div>
                <div className="text-[12.5px] text-edu-sub">우리 학교 부서 이름으로 바꾸거나 지워도 돼요. 나중에 조직도에서 교사를 등록하며 채울 수 있어요.</div>
                {isAdmin ? adminDepts.map((d, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input className="edu-input" value={d} onChange={e => setDepts(s => s.map((x, j) => j === i ? e.target.value : x))} maxLength={20} />
                    <button className="edu-ghost shrink-0" onClick={() => setDepts(s => s.filter((_, j) => j !== i))}>삭제</button>
                  </div>
                )) : teacherDepts.map((d, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input className="edu-input" value={d} onChange={e => setDepts(s => s.map((x, j) => j === i ? e.target.value : x))} maxLength={20} />
                    <button className="edu-ghost shrink-0" onClick={() => setDepts(s => s.filter((_, j) => j !== i))}>삭제</button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <input className="edu-input" placeholder="새 부서 이름" value={newDept} onChange={e => setNewDept(e.target.value)} maxLength={20} />
                  <button className="edu-ghost shrink-0" onClick={() => { if (newDept.trim()) { setDepts(s => [...s, newDept.trim()]); setNewDept(""); } }}>추가</button>
                </div>
                <div className="flex gap-2">
                  <button className="edu-ghost flex-1" onClick={() => setStep(0)}>뒤로</button>
                  <button className="edu-btn flex-1" onClick={finish}>{isAdmin ? "관리자 시작" : "시작하기"}</button>
                </div>
              </div>
            )}
            
            {isAdmin && step === 2 && (
              <div className="mt-4 flex flex-col gap-3">
                <div className="font-extrabold text-[14px]">학교 상세 정보</div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="edu-input" placeholder="학교 주소" value={schoolAddress} onChange={e => setSchoolAddress(e.target.value)} maxLength={100} />
                  <input className="edu-input" placeholder="학교 전화" value={schoolPhone} onChange={e => setSchoolPhone(e.target.value)} maxLength={20} />
                </div>
                <input className="edu-input" placeholder="교장명" value={principalName} onChange={e => setPrincipalName(e.target.value)} maxLength={20} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="full" checked={licenseKind === "full"} onChange={() => setLicenseKind("full")} className="w-4 h-4 text-edu-blue" />
                    <span className="text-sm">전체 기능 (조직도·쪽지·시간표·보강·공지·감사)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="chatOnly" checked={licenseKind === "chatOnly"} onChange={() => setLicenseKind("chatOnly")} className="w-4 h-4 text-edu-blue" />
                    <span className="text-sm">대화 전용 (채팅만 사용)</span>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button className="edu-ghost flex-1" onClick={() => setStep(1)}>뒤로</button>
                  <button className="edu-btn flex-1" onClick={finish}>완료</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ModeSelection({ onSelect, onToast }: { onSelect: (m: "teacher" | "admin") => void; onToast: (t: string) => void }) {
  return (
    <div className="text-center space-y-4">
      <div className="flex items-center gap-2.5 justify-center">
        <div className="w-11 h-11 rounded-2xl grid place-items-center text-white font-black text-lg" style={{ background: "linear-gradient(145deg,#0082C8,#0069A8)" }}>B</div>
        <div>
          <div className="font-black text-[17px]">브리즈</div>
          <div className="text-[12.5px] text-edu-sub">어떤 모드로 시작하시겠어요?</div>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <button 
          className="edu-card p-6 text-left hover:border-edu-blue hover:bg-edu-soft transition-all border-2 border-edu-line"
          onClick={() => onSelect("teacher")}
        >
          <div className="text-3xl mb-2">👩‍🏫</div>
          <div className="font-extrabold text-lg">교사 모드</div>
          <div className="text-sm text-edu-sub mt-1">쪽지·대화·시간표·보강<br/>내 수업·담임 업무 중심</div>
        </button>
        <button 
          className="edu-card p-6 text-left hover:border-edu-blue hover:bg-edu-soft transition-all border-2 border-edu-line"
          onClick={() => onSelect("admin")}
        >
          <div className="text-3xl mb-2">🏫</div>
          <div className="font-extrabold text-lg">관리자 모드</div>
          <div className="text-sm text-edu-sub mt-1">학교 전체 관리<br/>조직·공지·시간표 배포·감사</div>
        </button>
      </div>
      
      <button className="edu-ghost text-sm" onClick={() => onToast("데모 데이터로 빠르게 체험해 보세요!")}>
        💡 바로 데모 체험하기
      </button>
    </div>
  );
}