// CSV 읽기 (시간표·조직도·교사 명단 공용)
// - 엑셀 한글판은 EUC-KR(CP949)로 저장하는 경우가 많아 UTF-8로 먼저 읽고,
//   깨짐(�)이 보이면 EUC-KR로 다시 읽는다.
// - 앞쪽 BOM(\uFEFF)은 미리 뗀다 (첫 줄 판정이 어긋나 가짜 행이 생기는 것을 방지).

export async function readCsvText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^\uFEFF/, "");
  try {
    return new TextDecoder("euc-kr").decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return utf8.replace(/^\uFEFF/, "");
  }
}

export function splitCsvLines(csv: string): string[] {
  return csv
    .replace(/^\uFEFF/, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
