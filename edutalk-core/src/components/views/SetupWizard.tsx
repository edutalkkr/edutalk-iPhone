import { useState, useMemo } from "react";
import type { DeptGroup, Teacher, UserRole, School, SchoolSettings, LicenseKind } from "../../types";
import { AVATAR_COLORS, DEFAULT_DEPTS, ME_ID, type SchoolSetup } from "../../mock/initialData";
import type { SchoolLicense } from "../../lib/schoolSync";
import { nextAvatar } from "./OrgTreePane";

interface Props {
  onDone: (me: Teacher, depts: DeptGroup[], school: SchoolSetup, license: SchoolLicense | null) => void;
  onToast: (t: string) => void;
}

const DEMO_TEACHERS: Omit<Teacher, "id" | "avatarColor" | "status" | "statusMessage" | "ip" | "subCount" | "phone">[] = [
  { name: "김교장", dept: "관리부", subject: "", position: "교장", grade: "", classNo: "" },
  { name: "이교감", dept: "관리부", subject: "", position: "교감", grade: "", classNo: "" },
  { name: "박행정", dept: "행정실", subject: "", position: "행정실장", grade: "", classNo: "" },
  { name: "정수학", dept: "1학년부", subject: "수학", position: "담임", grade: "1학년", classNo: "1반" },
  { name: "최영어", dept: "1학년부", subject: "영어", position: "담임", grade: "1학년", classNo: "2반" },
  { name: "강국어", dept: "2학년부", subject: "국어", position: "담임", grade: "2학년", classNo: "1반" },
  { name: "윤과학", dept: "2학년부", subject: "과학", position: "담임", grade: "2학년", classNo: "2반" },
  { name: "임사회", dept: "3학년부", subject: "사회", position: "담임", grade: "3학년", classNo: "1반" },
  { name: "한음악", dept: "예체능부", subject: "음악", position: "교사", grade: "", classNo: "" },
  { name: "오미술", dept: "예체능부", subject: "미술", position: "교사", grade: "", classNo: "" },
];

const DEMO_ADMINS: Omit<Teacher, "id" | "avatarColor" | "status" | "statusMessage" | "ip" | "subCount" | "phone">[] = [
  { name: "관리자", dept: "관리부", subject: "", position: "관리자", grade: "", classNo: "" },
];

export default function SetupWizard(p: Props) {
  const [mode, setMode] = useState<"teacher" | "admin" | null>(null);
  const [step, setStep] = useState(0);
  const [seedDemo, setSeedDemo] = useState(false);
  
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
  const maxStep = isAdmin ? 3 : 2;

  const teacherDepts = useMemo(() => depts.filter(Boolean), [depts]);
  const adminDepts = useMemo(() => [...depts, "관리부", "행정실"].filter(Boolean), [depts]);

  const createTeacher = (t: typeof DEMO_TEACHERS[0], idx: number): Teacher => ({
    ...t,
    id: `t-${idx}`,
    avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
    status: "online" as const,
    statusMessage: t.grade && t.classNo ? `${t.grade} ${t.classNo} 담임` : t.position,
    ip: "이 PC",
    subCount: 0,
    phone: "",
  });

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

  const seedDemoData = () => {
    const now = new Date().toISOString();
    const day = new Date().getDay();
    const weekday = day === 0 ? 7 : day; // 일요일=7
    
    if (isAdmin) {
      const adminTeacher = createAdmin({ ...DEMO_ADMINS[0], name: "관리자" }, 0);
      const demoTeachers = DEMO_TEACHERS.map(createTeacher);
      const allTeachers = [adminTeacher, ...demoTeachers];
      
      const groups: DeptGroup[] = adminDepts.map((n, i) => ({
        id: `d-${i}`, name: n, members: allTeachers.filter(t => t.dept === n).map(t => t.id),
      }));
      
      const schoolSetup: SchoolSetup = { schoolId: schoolCode.trim(), schoolName: schoolName.trim() };
      const license: SchoolLicense = {
        status: "active", expiresText: "-", expiresMs: 0,
        type: licenseKind === "full" ? "admin_grant" : "single_chat_1y",
        typeLabel: licenseKind === "full" ? "관리자 직접 부여" : "단일망 소통 전용 1년",
        network: "dual", singleNet: "off", chatOnly: licenseKind === "chatOnly",
        kind: licenseKind, fetchedAt: new Date().toLocaleString("ko-KR"),
      };
      
      // 관리자 데모 데이터 생성
      const adminUsers = allTeachers.filter(t => t.position === "교장" || t.position === "교감" || t.position === "관리자" || t.position === "행정실장")
        .map((t, i) => ({
          id: t.id, name: t.name, email: `${t.name}@school.kr`,
          role: t.position === "교장" ? "superadmin" : "admin" as const,
          schoolId: schoolCode.trim(), dept: t.dept, avatarColor: t.avatarColor,
          createdAt: now, lastLoginAt: now,
        }));
      
      // 데모 공지사항
      const adminNotices = [
        { id: "an-1", title: "2학기 개학 안내", body: "2024년 9월 2일(월) 정상 등교합니다.", level: "urgent" as const, scope: "all" as const, targetDept: "", targetGrade: "", targetClass: "", fromAdminId: adminTeacher.id, fromAdminName: "관리자", createdAt: now, publishedAt: now, expiresAt: undefined, readCount: 0, totalCount: allTeachers.length, attachments: [] },
        { id: "an-2", title: "교직원 연수 일정", body: "9월 10일(화) 15:00~17:00 본관 3층 강당", level: "normal" as const, scope: "all" as const, targetDept: "", targetGrade: "", targetClass: "", fromAdminId: adminTeacher.id, fromAdminName: "관리자", createdAt: now, publishedAt: now, expiresAt: undefined, readCount: 0, totalCount: allTeachers.length, attachments: [] },
        { id: "an-3", title: "1학년부 회의 안내", body: "이번 주 수요일 16:00 1학년부 회의실", level: "normal" as const, scope: "dept" as const, targetDept: "1학년부", targetGrade: "", targetClass: "", fromAdminId: adminTeacher.id, fromAdminName: "관리자", createdAt: now, publishedAt: now, expiresAt: undefined, readCount: 0, totalCount: allTeachers.filter(t => t.dept === "1학년부").length, attachments: [] },
      ];
      
      // 데모 시간표 템플릿
      const templates: { id: string; name: string; schoolId: string; grade: string; classNo: string; cells: { weekday: number; period: number; grade: string; classNo: string; subject: string; room: string; teacher: string }[]; createdBy: string; createdAt: string; updatedAt: string; isPublished: boolean; publishedAt: string }[] = [];
      const grades = ["1학년", "2학년", "3학년"];
      const subjects = ["국어", "수학", "영어", "과학", "사회", "도덕", "체육", "음악", "미술", "실과"];
      grades.forEach((grade, gi) => {
        for (let c = 1; c <= 2; c++) {
          const cells = [];
          for (let wd = 1; wd <= 5; wd++) {
            for (let pd = 1; pd <= 7; pd++) {
              const subj = subjects[(wd * 7 + pd + gi * 2 + c) % subjects.length];
              const teacher = allTeachers.find(t => t.grade === grade && t.classNo === `${c}반`)?.name || allTeachers[gi * 2 + c - 1]?.name || "교사";
              cells.push({ weekday: wd, period: pd, grade, classNo: `${c}반`, subject: subj, room: `${grade} ${c}반 교실`, teacher });
            }
          }
          templates.push({ id: `tpl-${grade}-${c}`, name: `${grade} ${c}반 시간표`, schoolId: schoolCode.trim(), grade, classNo: `${c}반`, cells, createdBy: adminTeacher.id, createdAt: now, updatedAt: now, isPublished: true, publishedAt: now });
        }
      });
      
      // 데모 학급 정보
      const gradeClasses = grades.flatMap(grade => [1, 2].map(c => ({
        grade, classNo: `${c}반`, homeroomTeacherId: allTeachers.find(t => t.grade === grade && t.classNo === `${c}반`)?.id, homeroomTeacherName: allTeachers.find(t => t.grade === grade && t.classNo === `${c}반`)?.name, studentCount: Math.floor(Math.random() * 8) + 25,
      })));
      
      // 데모 학교 정보
      const schoolInfo = {
        id: schoolCode.trim(), name: schoolName.trim(), code: schoolCode.trim(),
        address: schoolAddress || "서울특별시 강남구 테헤란로 123",
        phone: schoolPhone || "02-1234-5678", principalName: principalName || "김교장",
        adminId: adminTeacher.id, licenseKind, licenseExpiresAt: undefined,
        createdAt: now, settings: {
          allowExternalNetwork: true, autoBackup: true, retentionDays: 365,
          dlpEnabled: true, dlpRules: [], notificationDefaultScope: "all" as const,
        },
      };
      
      // 데모 감사 로그
      const adminAudits = [
        { id: "aud-1", createdAt: now, adminId: adminTeacher.id, adminName: "관리자", action: "user_manage" as const, targetType: "user" as const, targetId: adminTeacher.id, targetName: "관리자", detail: "초기 관리자 계정 생성", blocked: false, ip: "127.0.0.1", userAgent: "Breeze Desktop" },
        { id: "aud-2", createdAt: now, adminId: adminTeacher.id, adminName: "관리자", action: "timetable_publish" as const, targetType: "timetable" as const, targetId: "tpl-1학년-1반", targetName: "1학년 1반 시간표", detail: "시간표 템플릿 배포", blocked: false },
      ];
      
      // localStorage에 저장
      try {
        localStorage.setItem("edutalk-adminUsers", JSON.stringify(adminUsers));
        localStorage.setItem("edutalk-adminNotices", JSON.stringify(adminNotices));
        localStorage.setItem("edutalk-templates", JSON.stringify(templates));
        localStorage.setItem("edutalk-gradeClasses", JSON.stringify(gradeClasses));
        localStorage.setItem("edutalk-schoolInfo", JSON.stringify(schoolInfo));
        localStorage.setItem("edutalk-schoolSettings", JSON.stringify(schoolInfo.settings));
        localStorage.setItem("edutalk-adminAudits", JSON.stringify(adminAudits));
      } catch {}
      
      p.onDone(adminTeacher, groups, schoolSetup, license);
    } else {
      const me = createTeacher({ ...DEMO_TEACHERS[3], name: "데모교사" }, 0);
      const demoTeachers = DEMO_TEACHERS.slice(1, 6).map((t, i) => createTeacher(t, i + 1));
      const allTeachers = [me, ...demoTeachers];
      
      const groups: DeptGroup[] = teacherDepts.map((n, i) => ({
        id: `d-${i}`, name: n, members: allTeachers.filter(t => t.dept === n).map(t => t.id),
      }));
      
      // 교사 모드용 간단 데모 데이터
      const memos = [
        { id: "m-1", title: "환영합니다!", body: "브리즈에 오신 것을 환영합니다. 쪽지함을 확인해 보세요.", fromUid: "system", fromName: "시스템", to: [{ uid: me.id, name: me.name, readAt: null, nudgedAt: null }], importance: "normal" as const, hwpName: "", hwpSize: 0, createdAt: now },
      ];
      const notices = [
        { id: "n-1", title: "2학기 개학 안내", body: "9월 2일(월) 정상 등교합니다.", level: "urgent" as const, scope: "all" as const, dept: "", fromName: "교장", createdAt: now, popup: true },
      ];
      
      try {
        localStorage.setItem("edutalk-memos", JSON.stringify(memos));
        localStorage.setItem("edutalk-notices", JSON.stringify(notices));
        localStorage.setItem("edutalk-profile-done", "true");
      } catch {}
      
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
                <div className="flex gap-2 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                    <input type="checkbox" checked={seedDemo} onChange={e => setSeedDemo(e.target.checked)} className="w-4 h-4 text-edu-blue" />
                    <span className="text-sm">데모 데이터로 채우기 (교사 10명, 시간표, 공지 예시)</span>
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