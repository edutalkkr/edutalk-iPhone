//! 브리즈 코어 MVP 진입점: 화면에서 부르는 명령을 등록한다.
//! 무거운 일(P2P·검사·시간표·정리)은 각 모듈이 하고, 여기는 다리만 놓는다.

mod audit;
mod db;
mod dlp;
mod p2p;
mod purge;
mod remote;
mod secret;
mod timetable;

use db::Db;
use p2p::{DirectFrame, PeerInfo, P2p};
use purge::RamStore;
use serde::Deserialize;
use std::sync::Mutex;
use chrono::{Datelike, Timelike};
use tauri::{AppHandle, Emitter, Manager, State};

struct Core {
    db: Db,
    p2p: P2p,
    ram: RamStore,
    me_uid: Mutex<String>,
    me_name: Mutex<String>,
    net_mode: Mutex<String>, // intranet | external
    device: String,          // 이 PC 번호 (비밀 기록장 열쇠 재료)
    usb_last: Mutex<Vec<String>>,
}

// ---------- 그물 모드 ----------

#[tauri::command]
fn net_set_mode(core: State<'_, Core>, mode: String) -> String {
    let m = if mode == "external" { "external" } else { "intranet" }.to_string();
    if let Ok(mut g) = core.net_mode.lock() {
        *g = m.clone();
    }
    m
}

/// 현재 망 모드와 이웃 PC 수 (화면 점검·표시용)
#[tauri::command]
fn net_status(core: State<'_, Core>) -> serde_json::Value {
    let mode = core.net_mode.lock().map(|m| m.clone()).unwrap_or("intranet".into());
    serde_json::json!({ "mode": mode, "peers": core.p2p.peers().len() })
}

#[tauri::command]
fn me_set(core: State<'_, Core>, uid: String, name: String) {
    if let Ok(mut g) = core.me_uid.lock() {
        *g = uid;
    }
    if let Ok(mut g) = core.me_name.lock() {
        *g = name;
    }
}

/// 내 PC 번호·표시 이름 (댓글·수신확인에서 내가 쓴 것 구분용)
#[tauri::command]
fn me_get(core: State<'_, Core>) -> (String, String) {
    (
        core.me_uid.lock().map(|s| s.clone()).unwrap_or_default(),
        core.me_name.lock().map(|s| s.clone()).unwrap_or_default(),
    )
}

// ---------- 유출 검사 (보내기 전 무조건 거침) ----------

#[tauri::command]
fn dlp_scan(text: String, file_name: String) -> dlp::DlpResult {
    dlp::scan_sync(&text, &file_name)
}

// ---------- 쪽지 ----------

#[derive(Debug, Deserialize)]
struct NewMemo {
    // 화면에서 정한 ID를 그대로 쓰면 P2P·SQLite·읽음영수증이 같은 ID로 돈다.
    // 없으면(예전 화면) Rust가 만든다.
    #[serde(default)]
    id: Option<String>,
    title: String,
    body: String,
    to: Vec<db::Recipient>,
    file_name: String,
}

#[tauri::command]
async fn memo_send(app: AppHandle, core: State<'_, Core>, memo: NewMemo) -> Result<serde_json::Value, String> {
    // 1) 보내기 전 검사 (외부망이면 차단을 더 엄격히 본다)
    let mode = core.net_mode.lock().map(|m| m.clone()).unwrap_or("intranet".into());
    let text = format!("{}\n{}", memo.title, memo.body);
    let checked = dlp::scan_sync(&text, &memo.file_name);
    if checked.verdict == "block" {
        // 감사 기록 (원문 없이 종류만)
        let conn_guard = core.db_conn()?;
        audit::log_block(
            &conn_guard,
            "dlp-block",
            &checked.hits.iter().map(|h| h.id.clone()).collect::<Vec<_>>(),
            checked.score,
            &mode,
            &core.me_uid.lock().map(|s| s.clone()).unwrap_or_default(),
        )?;
        return Ok(serde_json::json!({ "ok": false, "blocked": true, "hits": checked.hits, "score": checked.score }));
    }
    // 2) 저장 (INSERT OR REPLACE라 같은 ID 재전송도 안전하다)
    let id = memo
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("m-{}", rand_id()));
    let (me_uid, me_name) = (
        core.me_uid.lock().map(|s| s.clone()).unwrap_or_default(),
        core.me_name.lock().map(|s| s.clone()).unwrap_or_default(),
    );
    let via = if mode == "intranet" { "p2p" } else { "cloud" }.to_string();
    core.db.save_memo(&id, &memo.title, &memo.body, &me_uid, &me_name, &via, &memo.to)?;
    let _ = core.db.fts_index("memo", &id, &memo.title, &memo.body);
    // 3) 교내망이면 직접 쏘기 (못 만나면 저장만 하고 끝)
    if mode == "intranet" {
        for r in &memo.to {
            if let Some(p) = core.p2p.peers().into_iter().find(|p| p.node_id == r.uid || p.name == r.name) {
                let frame = DirectFrame {
                    kind: "memo".into(),
                    from: me_uid.clone(),
                    from_name: me_name.clone(),
                    title: memo.title.clone(),
                    body: memo.body.clone(),
                    ref_id: id.clone(),
                };
                let _ = core.p2p.send_direct(&p, frame).await;
            }
        }
        // 받은 쪽 수신 확인은 P2P read 프레임으로 돌아온다
        let _ = app.emit("memo-sent", &id);
    }
    Ok(serde_json::json!({ "ok": true, "id": id, "via": via, "warn": checked.verdict == "warn", "hits": checked.hits }))
}

#[tauri::command]
fn memo_list(core: State<'_, Core>) -> Result<Vec<db::MemoRow>, String> {
    core.db.list_memos(200)
}

#[tauri::command]
fn memo_read(core: State<'_, Core>, memo_id: String) -> Result<(), String> {
    let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
    core.db.mark_read(&memo_id, &me)
}

#[tauri::command]
async fn memo_nudge(app: AppHandle, core: State<'_, Core>, memo_id: String, uid: String) -> Result<(), String> {
    core.db.mark_nudged(&memo_id, &uid)?;
    // 재촉은 P2P로 가볍게 (못 만나면 다음에)
    if let Some(p) = core.p2p.peers().into_iter().find(|p| p.node_id == uid) {
        let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
        let me_name = core.me_name.lock().map(|s| s.clone()).unwrap_or_default();
        let _ = core
            .p2p
            .send_direct(&p, DirectFrame {
                kind: "nudge".into(),
                from: me,
                from_name: me_name,
                title: "재촉".into(),
                body: "쪽지를 확인해 주세요.".into(),
                ref_id: memo_id,
            })
            .await;
    }
    let _ = app;
    Ok(())
}

// ---------- 댓글·빠른 대화 ----------

#[tauri::command]
fn comment_add(core: State<'_, Core>, memo_id: String, body: String) -> Result<String, String> {
    let checked = dlp::scan_sync(&body, "");
    if checked.verdict == "block" {
        return Err(format!(
            "보안 경고: 개인정보/성적 유출 감지 ({})",
            checked.hits.iter().map(|h| h.label.clone()).collect::<Vec<_>>().join(", ")
        ));
    }
    let id = format!("c-{}", rand_id());
    let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
    let me_name = core.me_name.lock().map(|s| s.clone()).unwrap_or_default();
    core.db.add_comment(&id, &memo_id, &body, &me, &me_name)?;
    let _ = core.db.fts_index("comment", &memo_id, "", &body);
    Ok(id)
}

#[tauri::command]
fn comment_list(core: State<'_, Core>, memo_id: String) -> Result<Vec<db::CommentRow>, String> {
    core.db.list_comments(&memo_id)
}

#[tauri::command]
fn quick_send(core: State<'_, Core>, peer_uid: String, peer_name: String, body: String) -> Result<String, String> {
    let checked = dlp::scan_sync(&body, "");
    if checked.verdict == "block" {
        return Err("보안 경고: 개인정보/성적 유출 감지".into());
    }
    let id = format!("q-{}", rand_id());
    core.db.add_quick(&id, &peer_uid, &peer_name, &body, true)?;
    Ok(id)
}

#[tauri::command]
fn quick_list(core: State<'_, Core>, peer_uid: String) -> Result<Vec<db::QuickRow>, String> {
    core.db.list_quick(&peer_uid)
}

// ---------- 동료 PC ----------

#[tauri::command]
fn peer_list(core: State<'_, Core>) -> Result<Vec<PeerInfo>, String> {
    Ok(core.p2p.peers())
}

// ---------- 시간표·대강 ----------

#[tauri::command]
fn timetable_import(core: State<'_, Core>, source_name: String, csv: String) -> Result<usize, String> {
    let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
    let mut conn = core.db_conn()?;
    timetable::import_csv(&mut *conn, &me, &source_name, &csv)
}

#[tauri::command]
fn timetable_today(core: State<'_, Core>) -> Result<Vec<timetable::Slot>, String> {
    let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
    let wd = chrono::Local::now().weekday().number_from_monday();
    let conn = core.db_conn()?;
    timetable::today(&conn, &me, wd as i64)
}

#[tauri::command]
fn timetable_now(core: State<'_, Core>) -> Result<Option<timetable::Slot>, String> {
    let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
    let now = chrono::Local::now();
    let wd = now.weekday().number_from_monday() as i64;
    let minutes = now.hour() as i64 * 60 + now.minute() as i64;
    let conn = core.db_conn()?;
    timetable::now_status(&conn, &me, wd, minutes)
}

#[tauri::command]
fn substitute_candidates(
    core: State<'_, Core>,
    date: String,
    weekday: i64,
    period: i64,
) -> Result<Vec<timetable::Candidate>, String> {
    let me_name = core.me_name.lock().map(|s| s.clone()).unwrap_or_default();
    let conn = core.db_conn()?;
    timetable::substitute_candidates(&conn, &date, weekday, period, &me_name)
}

#[derive(Debug, Deserialize)]
struct SubRequest {
    date: String,
    weekday: i64,
    period: i64,
    grade: String,
    class_no: String,
    subject: String,
    to_uid: String,
    to_name: String,
}

#[tauri::command]
async fn substitute_request(core: State<'_, Core>, req: SubRequest) -> Result<String, String> {
    let id = format!("s-{}", rand_id());
    let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
    let me_name = core.me_name.lock().map(|s| s.clone()).unwrap_or_default();
    // DB 자물쇠는 await 전에 반드시 놓는다 (비동기 Send 규칙)
    {
        let conn = core.db_conn()?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO substitutions(id,date,weekday,period,grade,class_no,subject,from_uid,from_name,to_uid,to_name,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'open',?)",
            rusqlite::params![id, req.date, req.weekday, req.period, req.grade, req.class_no, req.subject, me, me_name, req.to_uid, req.to_name, now],
        )
        .map_err(|e| e.to_string())?;
    }
    // 교내망이면 P2P로 1클릭 수락 요청 전송 (받는 쪽이 시간표에 바로 꽂도록 세부 포함)
    if let Some(p) = core.p2p.peers().into_iter().find(|p| p.node_id == req.to_uid || p.name == req.to_name) {
        let payload = serde_json::json!({
            "date": req.date, "weekday": req.weekday, "period": req.period,
            "grade": req.grade, "class_no": req.class_no, "subject": req.subject,
        })
        .to_string();
        let _ = core
            .p2p
            .send_direct(&p, DirectFrame {
                kind: "substitute".into(),
                from: me,
                from_name: me_name,
                title: format!("보강 요청: {}교시 {} {} {}", req.period, req.grade, req.class_no, req.subject),
                body: payload,
                ref_id: id.clone(),
            })
            .await;
    }
    Ok(id)
}

#[tauri::command]
fn substitute_accept(core: State<'_, Core>, id: String, accept: bool) -> Result<(), String> {
    let conn = core.db_conn()?;
    let me_name = core.me_name.lock().map(|s| s.clone()).unwrap_or_default();
    conn.execute(
        "UPDATE substitutions SET status=?, to_name=? WHERE id=?",
        rusqlite::params![if accept { "accepted" } else { "declined" }, me_name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn substitute_list(core: State<'_, Core>) -> Result<Vec<serde_json::Value>, String> {
    let conn = core.db_conn()?;
    let mut st = conn
        .prepare("SELECT id,date,weekday,period,grade,class_no,subject,from_name,to_name,status,created_at FROM substitutions ORDER BY created_at DESC LIMIT 100")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "date": row.get::<_, String>(1)?,
                "weekday": row.get::<_, i64>(2)?,
                "period": row.get::<_, i64>(3)?,
                "grade": row.get::<_, String>(4)?,
                "class_no": row.get::<_, String>(5)?,
                "subject": row.get::<_, String>(6)?,
                "from_name": row.get::<_, String>(7)?,
                "to_name": row.get::<_, String>(8)?,
                "status": row.get::<_, String>(9)?,
                "created_at": row.get::<_, String>(10)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------- 감사 ----------

#[tauri::command]
fn audit_list(core: State<'_, Core>) -> Result<Vec<audit::AuditRow>, String> {
    let conn = core.db_conn()?;
    audit::list(&conn, 300)
}

#[tauri::command]
fn audit_export(core: State<'_, Core>, school: String, from: String, to: String, dir: String) -> Result<serde_json::Value, String> {
    let conn = core.db_conn()?;
    let rows = audit::list(&conn, 5000)?;
    let html = audit::render_html(&rows, &school, &from, &to);
    let csv = audit::render_csv(&rows);
    let base = std::path::Path::new(&dir);
    std::fs::create_dir_all(base).map_err(|e| e.to_string())?;
    let html_path = base.join("브리즈_감사보고서.html");
    let csv_path = base.join("브리즈_감사기록.csv");
    std::fs::write(&html_path, html).map_err(|e| e.to_string())?;
    std::fs::write(&csv_path, csv).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "html": html_path.to_string_lossy(), "csv": csv_path.to_string_lossy(), "count": rows.len() }))
}

// ---------- 메모리 미리보기·정리 ----------

#[tauri::command]
fn ram_put(core: State<'_, Core>, id: String, data: Vec<u8>) -> Result<usize, String> {
    core.ram.put(id, data)
}

#[tauri::command]
fn ram_get(core: State<'_, Core>, id: String) -> Result<Vec<u8>, String> {
    core.ram.get(&id).ok_or_else(|| "만료됐어요. 다시 열어 주세요.".into())
}

#[tauri::command]
fn ram_free(core: State<'_, Core>, id: String) -> bool {
    core.ram.free(&id)
}

#[tauri::command]
fn purge_run(app: AppHandle) -> Result<purge::PurgeResult, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("recv-tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    purge::purge_dir(&dir)
}

// ---------- 원격 화면 보기 (교내망 P2P 전용, 상대방 수락 후 1장씩) ----------

fn remote_mode_ok(core: &State<'_, Core>, firebase_cloud: Option<bool>) -> Result<String, String> {
    if firebase_cloud.unwrap_or(false) {
        return Err("Firebase 클라우드(외부망 고정) 이용권 학교에서는 원격 지원을 쓸 수 없어요.".into());
    }
    let mode = core.net_mode.lock().map(|m| m.clone()).unwrap_or("intranet".into());
    if mode != "intranet" {
        return Err("외부망(클라우드 중계)에서는 원격 지원을 쓸 수 없어요. 교내망에서 이용해 주세요.".into());
    }
    Ok(mode)
}

fn remote_peer(core: &State<'_, Core>, node_id: &str) -> Result<p2p::PeerInfo, String> {
    core.p2p
        .peers()
        .into_iter()
        .find(|p| p.node_id == node_id)
        .ok_or("상대 PC를 찾지 못했어요. 같은 망인지 확인해 주세요.".into())
}

fn remote_me(core: &State<'_, Core>) -> (String, String) {
    (
        core.me_uid.lock().map(|s| s.clone()).unwrap_or_default(),
        core.me_name.lock().map(|s| s.clone()).unwrap_or_default(),
    )
}

#[tauri::command]
async fn remote_view_request(core: State<'_, Core>, node_id: String, firebase_cloud: Option<bool>) -> Result<serde_json::Value, String> {
    remote_mode_ok(&core, firebase_cloud)?;
    let peer = remote_peer(&core, &node_id)?;
    let (me, me_name) = remote_me(&core);
    let request_id = format!("rv-{}", rand_id());
    core.p2p
        .send_direct(&peer, DirectFrame {
            kind: "remote-view-request".into(),
            from: me,
            from_name: me_name,
            title: "원격 화면 보기 요청".into(),
            body: "수락하면 화면 1장을 보내요.".into(),
            ref_id: request_id.clone(),
        })
        .await?;
    Ok(serde_json::json!({ "request_id": request_id }))
}

#[tauri::command]
async fn remote_view_respond(core: State<'_, Core>, node_id: String, request_id: String, accept: bool) -> Result<(), String> {
    let mode = remote_mode_ok(&core, Some(false))?;
    let peer = remote_peer(&core, &node_id)?;
    let (me, me_name) = remote_me(&core);
    if accept {
        // 수락 기록 (원문 없이 상대·시각만)
        {
            let conn_guard = core.db_conn()?;
            audit::log_block(&conn_guard, "remote-view", &[request_id.clone()], 0.0, &mode, &me)?;
        }
    }
    let kind = if accept { "remote-view-accept" } else { "remote-view-decline" };
    core.p2p
        .send_direct(&peer, DirectFrame {
            kind: kind.into(),
            from: me,
            from_name: me_name,
            title: if accept { "원격 화면 보기 수락".into() } else { "원격 화면 보기 거절".into() },
            body: String::new(),
            ref_id: request_id,
        })
        .await?;
    Ok(())
}

#[tauri::command]
fn remote_snapshot() -> Result<serde_json::Value, String> {
    let s = remote::capture_snapshot()?;
    Ok(serde_json::json!({ "data_url": s.data_url, "width": s.width, "height": s.height, "bytes": s.bytes }))
}

#[tauri::command]
async fn remote_view_frame(core: State<'_, Core>, node_id: String, request_id: String, image_b64: String) -> Result<serde_json::Value, String> {
    remote_mode_ok(&core, Some(false))?;
    if image_b64.len() > 1_400_000 {
        return Err("화면이 너무 커서 못 보내요. 다시 시도해 주세요.".into());
    }
    let peer = remote_peer(&core, &node_id)?;
    let (me, me_name) = remote_me(&core);
    let bytes = image_b64.len();
    core.p2p
        .send_direct(&peer, DirectFrame {
            kind: "remote-view-frame".into(),
            from: me,
            from_name: me_name,
            title: "원격 화면 1장".into(),
            body: image_b64,
            ref_id: request_id,
        })
        .await?;
    Ok(serde_json::json!({ "bytes": bytes }))
}

// ---------- P2P 직접 전송 (쪽지·대화·댓글·영수증 공용 길) ----------
// 내용은 화면에서 보내기 전 검사를 이미 마치므로, 여기서는 차단급만 한 번 더 거른다.
// 외부망(클라우드 중계)에서는 직접 전송 상대가 없으므로 DB 저장만 마친 것으로 보고 Ok로 둔다.

#[tauri::command]
async fn p2p_send(
    core: State<'_, Core>,
    node_id: String,
    kind: String,
    title: String,
    body: String,
    ref_id: String,
    firebase_cloud: Option<bool>,
) -> Result<(), String> {
    let allowed = ["memo", "quick", "comment", "read", "nudge"];
    if !allowed.contains(&kind.as_str()) {
        return Err("보낼 수 있는 종류가 아니에요.".into());
    }
    if node_id.trim().is_empty() {
        return Err("받는 PC를 찾지 못했어요.".into());
    }
    if body.len() > 1_400_000 {
        return Err("내용이 너무 커서 못 보내요.".into());
    }
    let text = format!("{title}\n{body}");
    let checked = dlp::scan_sync(&text, "");
    if checked.verdict == "block" {
        return Err("보안 경고: 개인정보 유출 감지로 전송이 멈췄어요.".into());
    }
    // 교내망이 아니면 직접 전송을 시도하지 않는다 (외부망은 이 PC 저장으로 끝)
    let mode = core.net_mode.lock().map(|m| m.clone()).unwrap_or("intranet".into());
    if mode != "intranet" || firebase_cloud.unwrap_or(false) {
        return Ok(());
    }
    let peer = remote_peer(&core, &node_id)?;
    let (me, me_name) = remote_me(&core);
    core.p2p
        .send_direct(&peer, DirectFrame {
            kind,
            from: me,
            from_name: me_name,
            title,
            body,
            ref_id,
        })
        .await?;
    Ok(())
}

#[tauri::command]
async fn remote_view_bye(core: State<'_, Core>, node_id: String, request_id: String) -> Result<(), String> {    let peer = remote_peer(&core, &node_id).unwrap_or(p2p::PeerInfo {
        node_id: node_id.clone(),
        name: String::new(),
        address: String::new(),
        tcp_port: 0,
        grade: String::new(),
        room: String::new(),
    });
    if peer.address.is_empty() {
        return Ok(());
    }
    let (me, me_name) = remote_me(&core);
    let _ = core.p2p
        .send_direct(&peer, DirectFrame {
            kind: "remote-view-bye".into(),
            from: me,
            from_name: me_name,
            title: "원격 화면 보기 종료".into(),
            body: String::new(),
            ref_id: request_id,
        })
        .await;
    Ok(())
}

// ---------- 중요도·찾기 ----------

#[tauri::command]
fn memo_list_filtered(core: State<'_, Core>, importance: String) -> Result<Vec<db::MemoRow>, String> {
    core.db.list_memos_filtered(&importance, 200)
}

#[tauri::command]
fn memo_set_importance(core: State<'_, Core>, memo_id: String, importance: String) -> Result<(), String> {
    core.db.set_importance(&memo_id, &importance)
}

#[tauri::command]
fn search(core: State<'_, Core>, query: String) -> Result<Vec<db::SearchHit>, String> {
    core.db.search(&query)
}

// ---------- 쪽지 안 투표 ----------

#[tauri::command]
fn poll_create(core: State<'_, Core>, memo_id: String, question: String, options: Vec<String>) -> Result<String, String> {
    let id = format!("p-{}", rand_id());
    core.db.create_poll(&id, &memo_id, &question, &options)?;
    Ok(id)
}

#[tauri::command]
fn poll_list(core: State<'_, Core>, memo_id: String) -> Result<Vec<db::PollRow>, String> {
    let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
    let mut polls = core.db.list_polls(&memo_id)?;
    for p in polls.iter_mut() {
        p.mine = core.db.poll_my_choice(&p.id, &me).unwrap_or(-1);
    }
    Ok(polls)
}

#[tauri::command]
fn poll_vote(core: State<'_, Core>, poll_id: String, choice: i64) -> Result<(), String> {
    let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
    core.db.vote_poll(&poll_id, &me, choice)
}

#[tauri::command]
fn poll_close(core: State<'_, Core>, poll_id: String) -> Result<(), String> {
    core.db.close_poll(&poll_id)
}

// ---------- 자주 쓰는 문구 ----------

#[tauri::command]
fn template_list(core: State<'_, Core>) -> Result<Vec<db::TemplateRow>, String> {
    core.db.list_templates()
}

#[tauri::command]
fn template_add(core: State<'_, Core>, title: String, body: String) -> Result<String, String> {
    let id = format!("tpl-{}", rand_id());
    core.db.add_template(&id, &title, &body)?;
    Ok(id)
}

#[tauri::command]
fn template_delete(core: State<'_, Core>, id: String) -> Result<(), String> {
    core.db.delete_template(&id)
}

// ---------- 예약 발송 ----------

#[tauri::command]
fn scheduled_add(core: State<'_, Core>, title: String, body: String, to: Vec<db::Recipient>, run_at: String) -> Result<String, String> {
    let id = format!("sch-{}", rand_id());
    let to_json = serde_json::to_string(&to).map_err(|e| e.to_string())?;
    core.db.add_scheduled(&id, &title, &body, &to_json, &run_at)?;
    Ok(id)
}

#[tauri::command]
fn scheduled_list(core: State<'_, Core>) -> Result<Vec<db::ScheduledRow>, String> {
    core.db.list_scheduled()
}

#[tauri::command]
fn scheduled_mark(core: State<'_, Core>, id: String, status: String) -> Result<(), String> {
    core.db.mark_scheduled(&id, &status)
}

#[tauri::command]
fn scheduled_due(core: State<'_, Core>) -> Result<Vec<db::ScheduledRow>, String> {
    let now = chrono::Local::now().to_rfc3339();
    core.db.due_scheduled(&now)
}

// ---------- 학사일정 D-Day ----------

#[tauri::command]
fn event_add(core: State<'_, Core>, title: String, date: String) -> Result<String, String> {
    let id = format!("e-{}", rand_id());
    core.db.add_event(&id, &title, &date)?;
    Ok(id)
}

#[tauri::command]
fn event_list(core: State<'_, Core>) -> Result<Vec<db::EventRow>, String> {
    core.db.list_events()
}

#[tauri::command]
fn event_delete(core: State<'_, Core>, id: String) -> Result<(), String> {
    core.db.delete_event(&id)
}

// ---------- 담임 비밀 기록장 ----------

#[tauri::command]
fn secret_save(core: State<'_, Core>, password: String, body: String) -> Result<(), String> {
    let cipher = secret::seal(&core.device, &password, &body)?;
    core.db.save_secret(cipher)
}

#[tauri::command]
fn secret_load(core: State<'_, Core>, password: String) -> Result<String, String> {
    match core.db.load_secret()? {
        Some(blob) => secret::open(&core.device, &password, &blob),
        None => Ok(String::new()),
    }
}

// ---------- 조직도 ----------

#[tauri::command]
fn org_import(core: State<'_, Core>, csv: String) -> Result<usize, String> {
    let rows = timetable::parse_csv_pub(&csv)?;
    if rows.is_empty() {
        return Err("읽을 줄이 없어요.".into());
    }
    let head: Vec<String> = rows[0].iter().map(|s| s.trim().to_string()).collect();
    let find = |keys: &[&str]| -> Option<usize> {
        head.iter().position(|h| {
            let l = h.to_lowercase();
            keys.iter().any(|k| l.contains(k))
        })
    };
    let c_dept = find(&["부서", "소속", "dept", "부"]);
    let c_grade = find(&["학년", "grade"]);
    let c_name = find(&["이름", "성명", "name", "교사"]).ok_or("이름 열을 찾지 못했어요.")?;
    let c_role = find(&["직책", "보직", "role", "담당"]);
    let get = |line: &[String], i: Option<usize>| -> String {
        i.and_then(|k| line.get(k)).map(|s| s.trim().to_string()).unwrap_or_default()
    };
    let mut nodes = Vec::new();
    for (n, line) in rows.iter().skip(1).enumerate() {
        let name = get(line, Some(c_name));
        if name.is_empty() {
            continue;
        }
        nodes.push(db::OrgNode {
            id: format!("org-{n}"),
            dept: get(line, c_dept),
            grade: get(line, c_grade),
            name,
            role: get(line, c_role),
        });
    }
    if nodes.is_empty() {
        return Err("넣을 사람이 없어요. 열 이름을 확인해주세요.".into());
    }
    let count = nodes.len();
    core.db.replace_org(&nodes)?;
    Ok(count)
}

#[tauri::command]
fn org_list(core: State<'_, Core>) -> Result<Vec<db::OrgNode>, String> {
    core.db.list_org()
}

// ---------- 임시 PIN ----------

#[tauri::command]
fn guest_add(core: State<'_, Core>, name: String, days: i64) -> Result<serde_json::Value, String> {
    use rand::Rng;
    let exp = (chrono::Local::now() + chrono::Duration::days(days.max(1).min(30))).to_rfc3339();
    for _ in 0..20 {
        let pin: String = format!("{:06}", rand::thread_rng().gen_range(0..1000000));
        if core.db.add_guest(&pin, &name, &exp).is_ok() {
            return Ok(serde_json::json!({ "pin": pin, "expires_at": exp }));
        }
    }
    Err("다시 시도해주세요.".into())
}

#[tauri::command]
fn guest_list(core: State<'_, Core>) -> Result<Vec<db::GuestRow>, String> {
    core.db.list_guests()
}

#[tauri::command]
fn guest_revoke(core: State<'_, Core>, pin: String) -> Result<(), String> {
    core.db.revoke_guest(&pin)
}

// ---------- 인수인계·공용함·서식·낙서장 ----------

#[tauri::command]
fn handover_tags(core: State<'_, Core>) -> Result<Vec<String>, String> {
    core.db.handover_tags()
}

#[tauri::command]
fn handover_list(core: State<'_, Core>, tag: String) -> Result<Vec<db::HandoverRow>, String> {
    core.db.list_handover(&tag)
}

#[tauri::command]
fn handover_add(core: State<'_, Core>, tag: String, body: String) -> Result<String, String> {
    let id = format!("h-{}", rand_id());
    let me_name = core.me_name.lock().map(|s| s.clone()).unwrap_or_default();
    core.db.add_handover(&id, &tag, &body, &me_name)?;
    Ok(id)
}

#[tauri::command]
fn inbox_list(core: State<'_, Core>, dept: String) -> Result<Vec<db::InboxRow>, String> {
    core.db.list_inbox(&dept)
}

#[tauri::command]
fn inbox_add(core: State<'_, Core>, dept: String, title: String, body: String) -> Result<String, String> {
    let id = format!("ib-{}", rand_id());
    let me_name = core.me_name.lock().map(|s| s.clone()).unwrap_or_default();
    core.db.add_inbox(&id, &dept, &title, &body, &me_name)?;
    Ok(id)
}

#[tauri::command]
fn inbox_set_state(core: State<'_, Core>, id: String, state: String) -> Result<(), String> {
    core.db.set_inbox_state(&id, &state)
}

#[tauri::command]
fn hwptpl_list(core: State<'_, Core>) -> Result<Vec<db::HwptplRow>, String> {
    core.db.list_hwptpl()
}

#[tauri::command]
fn hwptpl_add(core: State<'_, Core>, title: String, note: String) -> Result<String, String> {
    let id = format!("hw-{}", rand_id());
    core.db.add_hwptpl(&id, &title, &note)?;
    Ok(id)
}

#[tauri::command]
fn hwptpl_delete(core: State<'_, Core>, id: String) -> Result<(), String> {
    core.db.delete_hwptpl(&id)
}

#[tauri::command]
fn scratch_get(core: State<'_, Core>, id: String) -> Result<db::ScratchRow, String> {
    core.db.get_scratch(&id)
}

#[tauri::command]
fn scratch_save(core: State<'_, Core>, id: String, body: String) -> Result<String, String> {
    core.db.save_scratch(&id, &body)
}

// ---------- USB 감시·캡처 가림 ----------

#[tauri::command]
fn usb_check(core: State<'_, Core>) -> Result<serde_json::Value, String> {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let mut drives = Vec::new();
    for d in disks.list() {
        if d.is_removable() {
            drives.push(serde_json::json!({
                "name": d.name().to_string_lossy(),
                "mount": d.mount_point().to_string_lossy(),
            }));
        }
    }
    let mounts: Vec<String> = drives.iter().map(|d| d["mount"].as_str().unwrap_or("").to_string()).collect();
    let mut last = core.usb_last.lock().map_err(|e| e.to_string())?;
    let added: Vec<String> = mounts.iter().filter(|m| !last.contains(m)).cloned().collect();
    *last = mounts;
    drop(last);
    // 새로 꽂힌 USB는 감사 기록에 남긴다
    if !added.is_empty() {
        let conn = core.db_conn()?;
        let mode = core.net_mode.lock().map(|m| m.clone()).unwrap_or_default();
        let me = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
        audit::log_block(&conn, "usb", &added, 0.0, &mode, &me)?;
    }
    Ok(serde_json::json!({ "drives": drives, "added": added }))
}

#[tauri::command]
fn capture_set(window: tauri::Window, on: bool) -> Result<(), String> {
    window.set_content_protected(on).map_err(|e| e.to_string())
}

// ---------- 방화벽 자동 예외 (교내망 P2P 수신용) ----------
/// 교내망의 다른 PC가 이 PC로 접속하려면 인바운드 규칙이 필요하다.
/// 최초 실행 때 관리자 권한으로 47802/TCP·47801/UDP 규칙을 한 번 등록한다 (UAC 1회).
/// 이미 있거나 권한이 없으면 조용히 넘어간다 (프로그램은 그대로 동작).
fn install_firewall_rule() -> Result<(), String> {
    #[cfg(windows)]
    {
        // 이미 등록돼 있으면 UAC를 다시 띄우지 않는다
        let exists = std::process::Command::new("netsh")
            .args(["advfirewall", "firewall", "show", "rule", "name=BreezeCore_TCP_47802"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if exists {
            return Ok(());
        }
        // 한 번의 권한 상승으로 규칙 2개를 등록 (창은 숨김)
        let ps = "Start-Process -Verb RunAs -WindowStyle Hidden -FilePath cmd.exe -ArgumentList '/c netsh advfirewall firewall add rule name=BreezeCore_TCP_47802 dir=in action=allow protocol=TCP localport=47802 & netsh advfirewall firewall add rule name=BreezeCore_UDP_47801 dir=in action=allow protocol=UDP localport=47801'";
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", ps])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[tauri::command]
fn firewall_register() -> Result<(), String> {
    install_firewall_rule()
}

// ---------- 창 모양 (모던 넓게 / 세로형 좁게) ----------

#[tauri::command]
fn layout_apply(window: tauri::Window, mode: String) -> Result<(), String> {
    // 세로형이 기본: 카톡식 세로 메신저처럼 좁고 길게 (옆에 띄워두고 씀).
    // 가로형은 넓은 화면 임시 확인용으로만 둔다.
    let (w, h) = if mode == "classic" { (400.0, 860.0) } else { (1180.0, 800.0) };
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width: w, height: h }))
        .map_err(|e| e.to_string())?;
    window
        .set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
            width: if mode == "classic" { 360.0 } else { 900.0 },
            height: 600.0,
        })))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 내부: DB 연결 꺼내기 ----------
impl Core {
    fn db_conn(&self) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
        self.db.lock()
    }
}

fn rand_id() -> String {
    use rand::RngCore;
    let mut b = [0u8; 6];
    rand::thread_rng().fill_bytes(&mut b);
    hex::encode(b)
}

fn main() {
    // P2P 수신함: 받은 프레임은 DB에 넣고 화면에 알린다.
    let (inbox_tx, mut inbox_rx) = tokio::sync::mpsc::unbounded_channel::<DirectFrame>();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let dir = app.path().app_data_dir().expect("app dir");
            let db = Db::open(&dir.join("edutalk.db")).expect("db open");
            // 내 PC 정보 (처음 실행 때 만든다)
            let node_id = {
                let f = dir.join("node-id.txt");
                if let Ok(s) = std::fs::read_to_string(&f) {
                    s.trim().to_string()
                } else {
                    let id = format!("pc-{}", rand_id());
                    let _ = std::fs::write(&f, &id);
                    id
                }
            };
            let p2p = P2p::new(node_id.clone(), "교사PC".into(), inbox_tx.clone());
            // P2P 그물은 비동기 실행기 안에서 시작한다 (setup 직접 호출 시 패닉 방지)
            let p2p_bg = p2p.clone();
            tauri::async_runtime::spawn(async move {
                p2p_bg.start();
            });
            app.manage(Core {
                db,
                p2p,
                ram: RamStore::new(),
                me_uid: Mutex::new(node_id.clone()),
                me_name: Mutex::new("교사".into()),
                net_mode: Mutex::new("intranet".into()),
                device: node_id,
                usb_last: Mutex::new(Vec::new()),
            });
            // 받은 프레임 처리
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(frame) = inbox_rx.recv().await {
                    handle_p2p_frame(&handle, frame).await;
                }
            });
            // 최초 실행 때 한 번 방화벽 예외를 등록한다 (같은 망의 PC가 접속하려면 필요)
            let fw_dir = app.path().app_data_dir().ok();
            std::thread::spawn(move || {
                if let Some(d) = fw_dir {
                    let marker = d.join("firewall-ok.txt");
                    if !marker.exists() && install_firewall_rule().is_ok() {
                        let _ = std::fs::write(&marker, "1");
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            net_status,
            net_set_mode,
            me_set,
            me_get,
            dlp_scan,
            memo_send,
            memo_list,
            memo_read,
            memo_nudge,
            comment_add,
            comment_list,
            quick_send,
            quick_list,
            peer_list,
            timetable_import,
            timetable_today,
            timetable_now,
            substitute_candidates,
            substitute_request,
            substitute_accept,
            substitute_list,
            audit_list,
            audit_export,
            ram_put,
            ram_get,
            ram_free,
            purge_run,
            p2p_send,
            firewall_register,
            remote_view_request,
            remote_view_respond,
            remote_snapshot,
            remote_view_frame,
            remote_view_bye,
            memo_list_filtered,
            memo_set_importance,
            search,
            poll_create,
            poll_list,
            poll_vote,
            poll_close,
            template_list,
            template_add,
            template_delete,
            scheduled_add,
            scheduled_list,
            scheduled_mark,
            scheduled_due,
            event_add,
            event_list,
            event_delete,
            secret_save,
            secret_load,
            org_import,
            org_list,
            guest_add,
            guest_list,
            guest_revoke,
            handover_tags,
            handover_list,
            handover_add,
            inbox_list,
            inbox_add,
            inbox_set_state,
            hwptpl_list,
            hwptpl_add,
            hwptpl_delete,
            scratch_get,
            scratch_save,
            usb_check,
            capture_set,
            layout_apply,
        ])
        .run(tauri::generate_context!())
        .expect("브리즈 실행 실패");
}

async fn handle_p2p_frame(app: &AppHandle, frame: DirectFrame) {
    let core: State<'_, Core> = app.state();
    match frame.kind.as_str() {
        "memo" => {
            // 보낸 쪽 ID를 그대로 쓴다. 양쪽에서 같은 ID로 댓글·읽음·재촉을 주고받기 위해서다.
            let id = if frame.ref_id.is_empty() {
                format!("m-{}", rand_id())
            } else {
                frame.ref_id.clone()
            };
            // 받은 쪽지는 나를 수신자로 넣어 저장한다.
            // (수신자 표가 비면 재부팅 복구 때 받은함에 안 보인다)
            let me_now = core.me_uid.lock().map(|s| s.clone()).unwrap_or_default();
            let me_name_now = core.me_name.lock().map(|s| s.clone()).unwrap_or_default();
            let to_me = [db::Recipient { uid: me_now, name: me_name_now }];
            let _ = core.db.save_memo(&id, &frame.title, &frame.body, &frame.from, &frame.from_name, "p2p", &to_me);
            let _ = core.db.fts_index("memo", &id, &frame.title, &frame.body);
            let _ = app.emit("memo-arrived", serde_json::json!({
                "id": id,
                "title": frame.title,
                "body": frame.body,
                "from": frame.from,
                "from_name": frame.from_name,
            }));
        }
        "comment" | "quick" => {
            let id = if frame.kind == "comment" || frame.ref_id.is_empty() {
                format!("c-{}", rand_id())
            } else {
                frame.ref_id.clone()
            };
            if frame.kind == "comment" {
                let _ = core.db.add_comment(&id, &frame.ref_id, &frame.body, &frame.from, &frame.from_name);
                let _ = core.db.fts_index("comment", &frame.ref_id, "", &frame.body);
            } else {
                let _ = core.db.add_quick(&id, &frame.from, &frame.from_name, &frame.body, false);
            }
            let _ = app.emit("chat-arrived", serde_json::json!({
                "kind": frame.kind,
                "id": id,
                "ref_id": frame.ref_id,
                "body": frame.body,
                "from": frame.from,
                "from_name": frame.from_name,
            }));
        }
        "read" => {
            let _ = app.emit("peer-read", serde_json::json!({
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
            }));
        }
        "nudge" => {
            let _ = app.emit("nudge-arrived", serde_json::json!({
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
                "body": frame.body,
            }));
        }
        "remote-view-request" => {
            let _ = app.emit("remote-view-arrived", serde_json::json!({
                "event": "request",
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
            }));
        }
        "remote-view-accept" => {
            let _ = app.emit("remote-view-arrived", serde_json::json!({
                "event": "accept",
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
            }));
        }
        "remote-view-decline" => {
            let _ = app.emit("remote-view-arrived", serde_json::json!({
                "event": "decline",
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
            }));
        }
        "remote-view-frame" => {
            let _ = app.emit("remote-view-arrived", serde_json::json!({
                "event": "frame",
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
                "image_b64": frame.body,
            }));
        }
        "remote-view-bye" => {
            let _ = app.emit("remote-view-arrived", serde_json::json!({
                "event": "bye",
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
            }));
        }
        "substitute" => {
            let _ = app.emit("substitute-arrived", serde_json::json!({
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
                "title": frame.title,
                "body": frame.body,
            }));
        }
        "substitute-accept" => {
            let _ = app.emit("substitute-accepted", serde_json::json!({
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
            }));
        }
        "substitute-reject" => {
            let _ = app.emit("substitute-rejected", serde_json::json!({
                "ref_id": frame.ref_id,
                "from": frame.from,
                "from_name": frame.from_name,
            }));
        }
        _ => {}
    }
}
