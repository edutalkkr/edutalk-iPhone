//! 시간표 가져오기 + 현재 상태 + 대강 추천
//! 특정 업체 양식에 종속되지 않는다. 열 이름(교시/요일/학년/반/과목/교실/교사 등)을
//! 보고 자동으로 맞추므로, 나이스 양식 CSV를 그대로 넣으면 된다.

use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Slot {
    pub weekday: i64,
    pub period: i64,
    pub grade: String,
    pub class_no: String,
    pub subject: String,
    pub room: String,
    pub teacher: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Candidate {
    pub teacher: String,
    pub sub_count: i64,
    pub reason: String,
}

/// CSV를 읽어 시간표 칸으로 바꾼다. owner가 비면 공용(학급) 시간표다.
/// 한 번에 묶어 저장한다 (중간에 끊겨도 반쪽 시간표가 안 남는다).
pub fn import_csv(conn: &mut Connection, owner_uid: &str, source_name: &str, csv: &str) -> Result<usize, String> {
    let rows = parse_csv(csv)?;
    if rows.is_empty() {
        return Err("읽을 줄이 없어요. CSV 파일을 확인해 주세요.".into());
    }
    let head: Vec<String> = rows[0].iter().map(|s| s.trim().to_string()).collect();
    // 열 찾기 (이름이 달라도 뜻으로 찾는다)
    let find = |keys: &[&str]| -> Option<usize> {
        head.iter().position(|h| {
            let l = h.to_lowercase();
            keys.iter().any(|k| l.contains(k))
        })
    };
    let c_day = find(&["요일", "day", "week"]).ok_or("요일 열을 찾지 못했어요.")?;
    let c_period = find(&["교시", "period", "차시", "시간"]).ok_or("교시 열을 찾지 못했어요.")?;
    let c_grade = find(&["학년", "grade"]);
    let c_class = find(&["반", "class", "분반"]);
    let c_subject = find(&["과목", "subject", "교과", "내용"]);
    let c_room = find(&["교실", "room", "장소", "실"]);
    let c_teacher = find(&["교사", "선생", "teacher", "담당", "이름"]);

    conn.execute(
        "DELETE FROM timetable_slots WHERE owner_uid=?",
        [owner_uid],
    )
    .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut count = 0usize;
    for line in rows.iter().skip(1) {
        let get = |i: Option<usize>| -> String {
            i.and_then(|k| line.get(k)).map(|s| s.trim().to_string()).unwrap_or_default()
        };
        let weekday = parse_weekday(&get(Some(c_day)));
        let period: i64 = get(Some(c_period)).chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
        if !(1..=5).contains(&weekday) || !(1..=10).contains(&period) {
            continue;
        }
        tx.execute(
            "INSERT INTO timetable_slots(owner_uid,weekday,period,grade,class_no,subject,room,teacher) VALUES(?,?,?,?,?,?,?,?)",
            params![
                owner_uid,
                weekday,
                period,
                get(c_grade),
                get(c_class),
                get(c_subject),
                get(c_room),
                get(c_teacher),
            ],
        )
        .map_err(|e| e.to_string())?;
        count += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO timetable_meta(id,source_name,imported_at,slot_count) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET source_name=excluded.source_name,imported_at=excluded.imported_at,slot_count=excluded.slot_count",
        params![source_name, now, count as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(count)
}

/// 아주 작은 CSV 읽기 (따옴표 감싼 칸 1단계 지원)
pub(crate) fn parse_csv_pub(csv: &str) -> Result<Vec<Vec<String>>, String> {
    parse_csv(csv)
}

/// 아주 작은 CSV 읽기 (따옴표 감싼 칸 1단계 지원)
fn parse_csv(csv: &str) -> Result<Vec<Vec<String>>, String> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    for raw in csv.lines() {
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        let mut cells: Vec<String> = Vec::new();
        let mut cur = String::new();
        let mut quoted = false;
        for ch in line.chars() {
            match ch {
                '"' => quoted = !quoted,
                ',' if !quoted => {
                    cells.push(cur.trim().to_string());
                    cur = String::new();
                }
                _ => cur.push(ch),
            }
        }
        cells.push(cur.trim().to_string());
        rows.push(cells);
    }
    Ok(rows)
}

fn parse_weekday(s: &str) -> i64 {
    let t = s.trim();
    if t.contains('월') || t.eq_ignore_ascii_case("mon") { return 1; }
    if t.contains('화') || t.eq_ignore_ascii_case("tue") { return 2; }
    if t.contains('수') || t.eq_ignore_ascii_case("wed") { return 3; }
    if t.contains('목') || t.eq_ignore_ascii_case("thu") { return 4; }
    if t.contains('금') || t.eq_ignore_ascii_case("fri") { return 5; }
    t.parse().unwrap_or(0)
}

/// 지금 시각의 내 수업 상태 (예: 3교시 2학년 3반 수업 중)
pub fn now_status(conn: &Connection, owner_uid: &str, weekday: i64, minutes: i64) -> Result<Option<Slot>, String> {
    // 교시표 (시작 분 기준): 1교시 09:00 … 점심 제외 단순표. 학교마다 다르면 설정에서 바꾼다.
    const BELLS: [(i64, i64); 8] = [
        (540, 585), (595, 640), (650, 695), (705, 750),
        (810, 855), (865, 910), (920, 965), (975, 1020),
    ];
    let mut current: Option<i64> = None;
    for (i, (s, e)) in BELLS.iter().enumerate() {
        if minutes >= *s && minutes < *e {
            current = Some(i as i64 + 1);
            break;
        }
    }
    let period = match current {
        Some(p) => p,
        None => return Ok(None),
    };
    let mut st = conn
        .prepare("SELECT weekday,period,grade,class_no,subject,room,teacher FROM timetable_slots WHERE owner_uid=? AND weekday=? AND period=? LIMIT 1")
        .map_err(|e| e.to_string())?;
    let mut rows = st.query_map(params![owner_uid, weekday, period], |row| {
        Ok(Slot {
            weekday: row.get(0)?,
            period: row.get(1)?,
            grade: row.get(2)?,
            class_no: row.get(3)?,
            subject: row.get(4)?,
            room: row.get(5)?,
            teacher: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;
    Ok(rows.next().transpose().map_err(|e: rusqlite::Error| e.to_string())?)
}

/// 오늘 시간표 (내 것 + 없으면 공용)
pub fn today(conn: &Connection, owner_uid: &str, weekday: i64) -> Result<Vec<Slot>, String> {
    let mut st = conn
        .prepare("SELECT weekday,period,grade,class_no,subject,room,teacher FROM timetable_slots WHERE weekday=? AND (owner_uid=? OR owner_uid='') ORDER BY period")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map(params![weekday, owner_uid], |row| {
            Ok(Slot {
                weekday: row.get(0)?,
                period: row.get(1)?,
                grade: row.get(2)?,
                class_no: row.get(3)?,
                subject: row.get(4)?,
                room: row.get(5)?,
                teacher: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// 대강 후보: 해당 요일·교시에 수업이 없고, 지금까지 맡은 횟수가 적은 순
pub fn substitute_candidates(
    conn: &Connection,
    date: &str,
    weekday: i64,
    period: i64,
    exclude_teacher: &str,
) -> Result<Vec<Candidate>, String> {
    // 공용 시간표에 이름이 있는 교사 전체
    let mut st = conn
        .prepare("SELECT DISTINCT teacher FROM timetable_slots WHERE teacher<>'' AND teacher<>? ORDER BY teacher")
        .map_err(|e| e.to_string())?;
    let teachers: Vec<String> = st
        .query_map([exclude_teacher], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for t in teachers {
        // 그 시간에 수업이 있으면 제외
        let busy: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM timetable_slots WHERE teacher=? AND weekday=? AND period=?",
                params![t, weekday, period],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if busy > 0 {
            continue;
        }
        // 지금까지 맡은 횟수
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM substitutions WHERE to_uid=? OR to_name=?",
                params![t, t],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let _ = date;
        out.push(Candidate {
            teacher: t,
            sub_count: n,
            reason: if n == 0 { "이번 학기 첫 대강".into() } else { format!("지금까지 {n}번") },
        });
    }
    out.sort_by_key(|c| c.sub_count);
    out.truncate(5);
    Ok(out)
}
