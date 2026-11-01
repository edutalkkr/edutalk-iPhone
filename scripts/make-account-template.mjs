/* 학교 배포용 계정 명단 엑셀 양식을 만든다.
 * 실행: node scripts/make-account-template.mjs
 * 결과: onprem/deploy-kit/계정_명단_양식.xlsx */
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require(path.join(process.cwd(), "onprem", "node_modules", "xlsx"));

const headers = ["username", "real_name", "password", "department", "role", "is_paid_dual_network"];
const rows = [
  { username: "20250101", real_name: "김하늘", password: "", department: "교무부>1학년부", role: "TEACHER", is_paid_dual_network: 0 },
  { username: "20250102", real_name: "이준호", password: "", department: "교무부>2학년부", role: "TEACHER", is_paid_dual_network: 0 },
  { username: "20250103", real_name: "박서연", password: "", department: "행정실", role: "STAFF", is_paid_dual_network: 0 },
  { username: "30101", real_name: "최민준", password: "", department: "3학년>1반", role: "STUDENT", is_paid_dual_network: 0 },
  { username: "30102", real_name: "정다은", password: "", department: "3학년>1반", role: "STUDENT", is_paid_dual_network: 0 },
];

const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
ws["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 20 }];

const guide = XLSX.utils.aoa_to_sheet([
  ["브리즈 계정 명단 작성 안내"],
  [""],
  ["1. 첫 번째 시트의 2번째 줄부터 한 사람씩 적어 주세요. (예시 줄은 지우고 사용하세요.)"],
  ["2. username(사번/학번)과 real_name(이름)은 꼭 필요해요."],
  ["3. password를 비우면 서버가 안전한 임시 비밀번호를 만들어요. 업로드 결과 화면에서 딱 한 번 보여 주니 바로 전달해 주세요."],
  ["4. department는 '>'로 하위 부서를 이어요. 예: 교무부>1학년부, 3학년>1반"],
  ["5. role: TEACHER(교사) / STAFF(행정직) / STUDENT(학생) / ADMIN(관리자)"],
  ["6. 학생은 role을 STUDENT로 적어야 학생 웹(/student/)에서 로그인할 수 있어요."],
  ["7. is_paid_dual_network: 유료 듀얼 네트워크 사용자는 1, 아니면 0"],
  ["8. 한 번에 최대 5,000명까지 올릴 수 있어요."],
  [""],
  ["※ 이 파일은 브리즈 서버 관리 페이지의 [엑셀 올리기]에서 사용해요."],
]);
guide["!cols"] = [{ wch: 110 }];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "교직원·학생 명단");
XLSX.utils.book_append_sheet(wb, guide, "작성 안내");

const out = path.join(process.cwd(), "onprem", "deploy-kit", "계정_명단_양식.xlsx");
XLSX.writeFile(wb, out);
console.log("✓ " + out);
