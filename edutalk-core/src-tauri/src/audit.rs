//! 감사 기록: 걸린 것만 종류·시각·점수로 남긴다 (원문 저장 안 함)
//! 보고서: CSV + 인쇄용 HTML (PDF는 인쇄 대화상자에서 저장)

use rusqlite::params;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AuditRow {
    pub id: i64,
    pub created_at: String,
    pub kind: String,
    pub rule_ids: String,
    pub score: f64,
    pub net_mode: String,
}

pub fn log_block(
    conn: &rusqlite::Connection,
    kind: &str,
    rule_ids: &[String],
    score: f32,
    net_mode: &str,
    actor: &str,
) -> Result<(), String> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO audit_logs(created_at,kind,rule_ids,score,net_mode,actor_uid) VALUES(?,?,?,?,?,?)",
        params![now, kind, rule_ids.join(","), score as f64, net_mode, actor],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list(conn: &rusqlite::Connection, limit: i64) -> Result<Vec<AuditRow>, String> {
    let mut st = conn
        .prepare("SELECT id,created_at,kind,rule_ids,score,net_mode FROM audit_logs ORDER BY id DESC LIMIT ?")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([limit], |row| {
            Ok(AuditRow {
                id: row.get(0)?,
                created_at: row.get(1)?,
                kind: row.get(2)?,
                rule_ids: row.get(3)?,
                score: row.get(4)?,
                net_mode: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// 인쇄용 HTML 보고서 (학교명·기간 포함, 원문 없음)
pub fn render_html(rows: &[AuditRow], school: &str, from: &str, to: &str) -> String {
    let mut trs = String::new();
    for r in rows {
        let kind = match r.kind.as_str() {
            "dlp-block" => "차단",
            "dlp-warn" => "경고",
            _ => r.kind.as_str(),
        };
        trs.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{:.2}</td><td>{}</td></tr>",
            esc(&r.created_at),
            esc(kind),
            esc(&r.rule_ids),
            esc(&r.net_mode),
            r.score,
            esc("원문 미보관")
        ));
    }
    format!(
        "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><title>브리즈 유출 차단 감사 보고서</title>\
        <style>body{{font-family:sans-serif;margin:32px}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #999;padding:6px 8px;font-size:13px}}</style></head>\
        <body><h1>브리즈 유출 차단 감사 보고서</h1><p>학교: {} / 기간: {} ~ {} / 총 {}건</p>\
        <table><tr><th>시각</th><th>구분</th><th>규칙</th><th>망</th><th>점수</th><th>비고</th></tr>{}</table></body></html>",
        esc(school),
        esc(from),
        esc(to),
        rows.len(),
        trs
    )
}

pub fn render_csv(rows: &[AuditRow]) -> String {
    let mut out = String::from("시각,구분,규칙,망,점수\n");
    for r in rows {
        out.push_str(&format!(
            "{},{},{},{},{:.2}\n",
            csv_esc(&r.created_at),
            csv_esc(&r.kind),
            csv_esc(&r.rule_ids),
            csv_esc(&r.net_mode),
            r.score
        ));
    }
    out
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn csv_esc(s: &str) -> String {
    if s.contains([',', '"', '\n']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}
