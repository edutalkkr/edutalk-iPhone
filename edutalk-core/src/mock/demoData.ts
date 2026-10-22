// 브리즈 데모 mock 데이터 - 실제 서버 연결 없이 가상 학교 환경 제공
export const DEMO_SCHOOL_NAME = "그린초초등학교";
export const DEMO_PRINCIPAL_NAME = "김교장";

export interface DemoTeacher {
  id: string;
  name: string;
  department: string;
  grade: string;
  classNo: string;
  subject: string;
}

export const DEMO_TEACHERS: DemoTeacher[] = [
  { id: "t-001", name: "이준희", department: "국어과", grade: "1학년", classNo: "1반", subject: "국어" },
  { id: "t-002", name: "박수진", department: "수학과", grade: "1학년", classNo: "1반", subject: "수학" },
  { id: "t-003", name: "송미란", department: "영어과", grade: "2학년", classNo: "2반", subject: "영어" },
  { id: "t-004", name: "최동환", department: "사회과", grade: "2학년", classNo: "2반", subject: "사회" },
  { id: "t-005", name: "한아영", department: "과학과", grade: "3학년", classNo: "3반", subject: "과학" },
];

export interface DemoStudent {
  id: string;
  name: string;
  grade: string;
  classNo: string;
}

export const DEMO_STUDENTS: DemoStudent[] = [
  { id: "s-001", name: "김서울", grade: "1학년", classNo: "1반" },
  { id: "s-002", name: "이강산", grade: "1학년", classNo: "1반" },
  { id: "s-003", name: "박도시", grade: "2학년", classNo: "2반" },
  { id: "s-004", name: "최빛나", grade: "2학년", classNo: "2반" },
  { id: "s-005", name: "정하늘", grade: "3학년", classNo: "3반" },
];

export interface DepartmentNode {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  children?: DepartmentNode[];
}

export const DEPARTMENT_TREE: DepartmentNode[] = [
  {
    id: "d-gyomu",
    name: "교무기획부",
    parentId: null,
    order: 0,
    children: [
      { id: "d-1", name: "1학년부", parentId: "d-gyomu", order: 1 },
      { id: "d-2", name: "2학년부", parentId: "d-gyomu", order: 2 },
      { id: "d-admin", name: "행정실", parentId: "d-gyomu", order: 3 },
    ],
  },
  {
    id: "d-principal",
    name: "총무실",
    parentId: null,
    order: 1,
    children: [],
  },
];

export const DEMO_MESSAGES: {
  id: string;
  senderId: string;
  senderName: string;
  senderDepartment: string;
  content: string;
  createdAt: string;
  messageType: "text" | "file";
}[] = [
  {
    id: "m-001",
    senderId: "t-001",
    senderName: "이준희",
    senderDepartment: "국어과",
    content: "2학년 1반 국어 시험 범위 안내예요. p.50~p.65까지 확인해 주세요.",
    createdAt: "2024-02-15T10:30:00",
    messageType: "text",
  },
  {
    id: "m-002",
    senderId: "t-002",
    senderName: "박수진",
    senderDepartment: "수학과",
    content: "수학시간표 수정이 완료됐어요. 이번 주 목요일 2교시 교실로 이동해 주세요.",
    createdAt: "2024-02-15T09:15:00",
    messageType: "text",
  },
  {
    id: "m-003",
    senderId: "admin",
    senderName: "행정실",
    senderDepartment: "행정실",
    content: "오늘 점심 공지: 방학 후 청소 차량 꼭 지켜해 주세요.",
    createdAt: "2024-02-15T08:00:00",
    messageType: "text",
  },
];

export const DEMO_TIMETABLE = {
  grade: "전체",
  classNo: "전체",
  cells: [
    { id: "t1", weekday: 1, period: 1, grade: "1", classNo: "1", subject: "국어", room: "본관 101", teacherId: "t-001", teacherName: "이준희", isPublished: true },
    { id: "t2", weekday: 1, period: 2, grade: "1", classNo: "1", subject: "수학", room: "본관 101", teacherId: "t-002", teacherName: "박수진", isPublished: true },
    { id: "t3", weekday: 1, period: 3, grade: "2", classNo: "1", subject: "영어", room: "본관 201", teacherId: "t-003", teacherName: "송미란", isPublished: true },
    { id: "t4", weekday: 1, period: 4, grade: "2", classNo: "1", subject: "사회", room: "본관 201", teacherId: "t-004", teacherName: "최동환", isPublished: true },
    { id: "t5", weekday: 1, period: 5, grade: "3", classNo: "1", subject: "과학", room: "본관 301", teacherId: "t-005", teacherName: "한아영", isPublished: true },
  ],
};