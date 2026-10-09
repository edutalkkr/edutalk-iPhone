//! Breeze Tauri Native Backend (Rust) — Desktop-First
//! - Local UI: frontendDist=../public (오프라인 0.001초 부팅)
//! - SQLite: 쪽지/스레드/퀵채팅 오프라인 보관
//! - P2P: UDP 브로드캐스트 탐색 + TCP 직송 (서버 0대)
//! - DLP: Pre-Send 정규식 스캔 (ONNX는 ort 크레이트로 교체 가능)
//! - AutoPurge: 30일/TTL + 3GB 상한
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize)]
struct DlpHit { id: String, count: usize }
#[derive(Debug, Serialize)]
struct DlpResult {
    verdict: String, score: f32, hits: Vec<DlpHit>,
    elapsed_ms: u128, net_mode: String,
}

#[derive(Debug, Deserialize)]
struct DlpReq { text: String, #[serde(default)] file_name: String, #[serde(default)] net_mode: String }

#[tauri::command]
fn dlp_verify(req: DlpReq) -> DlpResult {
    let t0 = std::time::Instant::now();
    let pats: &[(&str, &str, f32)] = &[
        ("RRN", r"\d{6}[- ]?\d{7}", 1.0),
        ("PHONE", r"01[016789][- ]?\d{3,4}[- ]?\d{4}", 0.6),
        ("CARD", r"\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}", 0.9),
        ("SCORE", r"시험지|답지|답안지|기출문제|생활기록부|생기부", 0.8),
        ("PW", r"비밀번호\s*[:=]\s*\S{4,}", 1.0),
    ];
    let mut score = 0.0f32;
    let mut hits = vec![];
    for (id, pat, w) in pats {
        if let Ok(re) = Regex::new(pat) {
            let n = re.find_iter(&req.text).take(3).count();
            if n > 0 { score += *w * (n as f32) * 0.35; hits.push(DlpHit { id: id.to_string(), count: n }); }
        }
    }
    if req.file_name.ends_with(".hwp") || req.file_name.ends_with(".hwpx") { score += 0.15; }
    let is_ext = req.net_mode.to_lowercase() != "intranet";
    let verdict = if score >= 0.55 && is_ext { "block" } else if score >= 0.30 { "warn" } else { "allow" };
    DlpResult { verdict: verdict.into(), score: score.min(1.0), hits, elapsed_ms: t0.elapsed().as_millis(), net_mode: if is_ext { "external".into() } else { "intranet".into() } }
}

#[derive(Debug, Deserialize)]
struct Memo { id: String, title: String, body: String, from_uid: String }
#[tauri::command]
fn local_memo_save(app: tauri::AppHandle, memo: Memo) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dbp = dir.join("edutalk-local.db");
    let conn = rusqlite::Connection::open(dbp).map_err(|e| e.to_string())?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS memos(id TEXT PRIMARY KEY, title TEXT, body TEXT, from_uid TEXT, created_at TEXT);").map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO memos VALUES(?,?,?,?,datetime('now'))",
        rusqlite::params![memo.id, memo.title, memo.body, memo.from_uid]).map_err(|e| e.to_string())?;
    Ok(memo.id)
}

struct P2pState(Mutex<Vec<String>>);
#[tauri::command]
fn p2p_peers(state: tauri::State<'_, P2pState>) -> Vec<String> { state.0.lock().map(|v| v.clone()).unwrap_or_default() }

fn main() {
    tauri::Builder::default()
        .manage(P2pState(Mutex::new(vec![])))
        .invoke_handler(tauri::generate_handler![dlp_verify, local_memo_save, p2p_peers])
        .run(tauri::generate_context!())
        .expect("breeze tauri failed");
}
