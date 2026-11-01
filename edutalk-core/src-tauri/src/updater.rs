//! 서버 주도 자동 업데이트(OTA).
//! - 전산실이 학교 서버(onprem)의 updates/ 폴더에 새 설치본과 latest.json 을 올린다.
//! - 교사 PC는 주기적으로 확인 → 새 버전이면 토스트 → 내려받기(진행률) → 조용히 설치 → 자동 재시작.
//! - 확인·내려받기가 실패해도 앱은 평소대로 동작한다 (트레이 앱이므로 조용히 넘어간다).
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

/// 공개 업데이트 피드 — 인터넷이 되는 PC가 여기서 새 버전을 확인한다.
const DEFAULT_FEED_URL: &str = "https://edutalk.cloud/breeze/latest.json";
const MAX_UPDATE_BYTES: u64 = 220 * 1024 * 1024;

fn feed_url() -> String {
    std::env::var("BREEZE_UPDATE_FEED")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_FEED_URL.to_string())
}

fn client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

/// 매니페스트 조회: {base}/api/updates/latest
/// 서버가 "올린 업데이트 없음(404)"이면 update: null 로 정상 반환한다.
pub async fn check(base: &str) -> Result<serde_json::Value, String> {
    let base = super::srv::norm_base(base);
    if base.is_empty() {
        return Err("학교 서버 주소가 없어요.".into());
    }
    let res = client(8)?
        .get(format!("{base}/api/updates/latest"))
        .send()
        .await
        .map_err(|_| "업데이트 서버에 연결하지 못했어요.".to_string())?;
    let status = res.status();
    if status.as_u16() == 404 {
        return Ok(serde_json::json!({ "ok": true, "update": null }));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() || body.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let msg = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("업데이트 정보를 받지 못했어요.");
        return Err(msg.to_string());
    }
    Ok(body)
}

fn safe_update_name(name: &str) -> Result<String, String> {
    let n = name.rsplit(['/', '\\']).next().unwrap_or("").trim().to_string();
    if n.is_empty() || n.contains("..") || !n.to_lowercase().ends_with(".exe") {
        return Err("업데이트 파일 이름이 올바르지 않아요.".into());
    }
    Ok(n)
}

fn valid_sha256(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// 공개 피드 확인 (인터넷 필요): https://edutalk.cloud/breeze/latest.json
/// 새 버전이 없거나 피드가 비어 있으면 update: null 로 정상 반환한다.
pub async fn feed_check() -> Result<serde_json::Value, String> {
    let url = feed_url();
    let base = reqwest::Url::parse(&url).map_err(|_| "업데이트 피드 주소가 올바르지 않아요.".to_string())?;
    let res = client(10)?
        .get(base.clone())
        .header("cache-control", "no-cache")
        .send()
        .await
        .map_err(|_| "인터넷에 연결하지 못했어요.".to_string())?;
    let status = res.status();
    if status.as_u16() == 404 {
        return Ok(serde_json::json!({ "ok": true, "update": null }));
    }
    let mut feed: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err("업데이트 정보를 받지 못했어요.".into());
    }
    let version = feed.get("version").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if version.is_empty() || !version.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        return Err("업데이트 버전 정보가 올바르지 않아요.".into());
    }
    let file = feed.get("file").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let file = safe_update_name(&file)?;
    let sha = feed.get("sha256").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if !valid_sha256(&sha) {
        return Err("업데이트 검사값이 올바르지 않아요.".into());
    }
    let raw_url = feed
        .get("url")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or(&file)
        .to_string();
    let abs = base
        .join(raw_url.trim())
        .map_err(|_| "업데이트 파일 주소가 올바르지 않아요.".to_string())?;
    if abs.scheme() != "https" {
        return Err("업데이트 파일은 https 주소에서만 받을 수 있어요.".into());
    }
    feed["url"] = serde_json::Value::String(abs.to_string());
    feed["file"] = serde_json::Value::String(file);
    Ok(serde_json::json!({ "ok": true, "update": feed }))
}

/// 인터넷에서 설치본을 받아 학교 서버로 중계한다 (Bearer 토큰은 Rust 안에서만 쓴다).
/// 진행 상황은 "relay-progress" 이벤트({phase,received,total,done})로 알린다.
pub async fn relay(
    app: &AppHandle,
    state: &super::srv::SrvState,
    feed: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (base, token) = super::srv::parts(state)?;
    if token.is_empty() {
        return Err("학교 서버에 먼저 로그인해 주세요.".into());
    }
    let url = feed.get("url").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let file = safe_update_name(feed.get("file").and_then(|v| v.as_str()).unwrap_or(""))?;
    let version = feed.get("version").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let sha_expected = feed.get("sha256").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if url.is_empty() || version.is_empty() || !valid_sha256(&sha_expected) {
        return Err("업데이트 정보가 올바르지 않아요.".into());
    }
    if !url.starts_with("https://") {
        return Err("업데이트 파일은 https 주소에서만 받을 수 있어요.".into());
    }

    let dir: PathBuf = std::env::temp_dir().join("breeze-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let full = dir.join(&file);

    let _ = app.emit(
        "relay-progress",
        serde_json::json!({ "phase": "download", "received": 0, "total": 0, "done": false }),
    );
    let mut res = client(600)?
        .get(&url)
        .send()
        .await
        .map_err(|_| "인터넷에서 업데이트를 내려받지 못했어요.".to_string())?;
    if !res.status().is_success() {
        return Err("인터넷에서 업데이트 파일을 찾지 못했어요.".into());
    }
    let total = res.content_length().unwrap_or(0);
    if total > MAX_UPDATE_BYTES {
        return Err("업데이트 파일이 너무 커요.".into());
    }

    use tokio::io::AsyncWriteExt;
    let mut out = tokio::fs::File::create(&full).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut got: u64 = 0;
    let mut last_emit: u64 = 0;
    let step = (total / 100).max(256 * 1024);
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        got += chunk.len() as u64;
        if got > MAX_UPDATE_BYTES {
            drop(out);
            let _ = std::fs::remove_file(&full);
            return Err("업데이트 파일이 너무 커요.".into());
        }
        hasher.update(&chunk);
        out.write_all(&chunk).await.map_err(|e| e.to_string())?;
        if got - last_emit >= step {
            last_emit = got;
            let _ = app.emit(
                "relay-progress",
                serde_json::json!({ "phase": "download", "received": got, "total": total, "done": false }),
            );
        }
    }
    out.flush().await.map_err(|e| e.to_string())?;
    drop(out);

    let digest = hex::encode(hasher.finalize());
    if !digest.eq_ignore_ascii_case(&sha_expected) {
        let _ = std::fs::remove_file(&full);
        return Err("내려받은 파일이 손상됐어요 (검사값 불일치).".into());
    }
    let _ = app.emit(
        "relay-progress",
        serde_json::json!({ "phase": "download", "received": got, "total": got, "done": true }),
    );

    let bytes = tokio::fs::read(&full).await.map_err(|e| e.to_string())?;
    let manifest = serde_json::json!({
        "version": version,
        "file": file,
        "size": bytes.len(),
        "sha256": digest,
        "notes": feed.get("notes").and_then(|v| v.as_str()).unwrap_or(""),
        "mandatory": feed.get("mandatory").and_then(|v| v.as_bool()).unwrap_or(false),
        "security": feed.get("security").and_then(|v| v.as_bool()).unwrap_or(false),
        "pub_date": feed.get("pub_date").and_then(|v| v.as_str()).unwrap_or(""),
    });
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let header = B64.encode(serde_json::to_vec(&manifest).map_err(|e| e.to_string())?);

    let _ = app.emit(
        "relay-progress",
        serde_json::json!({ "phase": "upload", "received": 0, "total": bytes.len(), "done": false }),
    );
    let res = client(300)?
        .post(format!("{base}/api/updates/relay"))
        .bearer_auth(&token)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .header("x-breeze-manifest", header)
        .body(bytes)
        .send()
        .await
        .map_err(|_| "학교 서버로 업데이트를 보내지 못했어요.".to_string())?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() || body.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let msg = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("학교 서버가 업데이트를 받지 못했어요.");
        return Err(msg.to_string());
    }
    let _ = app.emit(
        "relay-progress",
        serde_json::json!({ "phase": "done", "received": got, "total": got, "done": true }),
    );
    Ok(serde_json::json!({
        "ok": true,
        "installer": full.to_string_lossy().to_string(),
        "update": body.get("update").cloned().unwrap_or(serde_json::Value::Null),
    }))
}

/// 설치본 내려받기: {base}/api/updates/download/{file} → 임시 폴더 저장 + 검사값(SHA-256) 확인.
/// 진행률은 "update-progress" 이벤트({received,total,done})로 알린다.
pub async fn download(
    app: &AppHandle,
    base: &str,
    file: &str,
    sha256_expected: &str,
) -> Result<String, String> {
    let base = super::srv::norm_base(base);
    if base.is_empty() {
        return Err("학교 서버 주소가 없어요.".into());
    }
    // 서버가 준 이름 중 파일명만 쓴다 (경로 섞기 차단).
    let name = file
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() || !name.to_lowercase().ends_with(".exe") || name.contains("..") {
        return Err("업데이트 파일 이름이 올바르지 않아요.".into());
    }

    let dir: PathBuf = std::env::temp_dir().join("breeze-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let full = dir.join(&name);

    let mut res = client(600)?
        .get(format!("{base}/api/updates/download/{name}"))
        .send()
        .await
        .map_err(|_| "업데이트 내려받기를 시작하지 못했어요.".to_string())?;
    if !res.status().is_success() {
        return Err("업데이트 파일을 찾지 못했어요.".into());
    }
    let total = res.content_length().unwrap_or(0);

    use tokio::io::AsyncWriteExt;
    let mut out = tokio::fs::File::create(&full).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut got: u64 = 0;
    let mut last_emit: u64 = 0;
    // 1% 또는 256KB 단위로만 알린다 (이벤트 폭주 방지)
    let step = (total / 100).max(256 * 1024);
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        hasher.update(&chunk);
        out.write_all(&chunk).await.map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        if got - last_emit >= step {
            last_emit = got;
            let _ = app.emit(
                "update-progress",
                serde_json::json!({ "received": got, "total": total, "done": false }),
            );
        }
    }
    out.flush().await.map_err(|e| e.to_string())?;
    drop(out);

    let digest = hex::encode(hasher.finalize());
    if !sha256_expected.is_empty() && !digest.eq_ignore_ascii_case(sha256_expected) {
        let _ = std::fs::remove_file(&full);
        return Err("내려받은 파일이 손상됐어요 (검사값 불일치).".into());
    }
    let _ = app.emit(
        "update-progress",
        serde_json::json!({ "received": got, "total": got, "done": true }),
    );
    Ok(full.to_string_lossy().to_string())
}

/// 설치: 앱을 끝낸 뒤 NSIS 설치본을 조용히(/S) 실행하고, 끝나면 다시 열어 준다.
/// 앱이 살아 있으면 설치본이 exe 를 덮어쓸 수 없어서, 2초 뒤에 시작한다.
pub fn install(app: &AppHandle, installer: &str) -> Result<(), String> {
    let exe = installer.trim().to_string();
    if !exe.to_lowercase().ends_with(".exe") {
        return Err("설치 파일이 아니에요.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let me = std::env::current_exe().map_err(|e| e.to_string())?;
        let me_s = me.to_string_lossy().replace('\'', "''");
        let exe_s = exe.replace('\'', "''");
        // -Wait 로 설치가 끝날 때까지 기다린 뒤, 이미 설치본이 앱을 띄우지 않았으면 우리가 띄운다.
        let ps = format!(
            "Start-Sleep -Seconds 2; \
             Start-Process -FilePath '{exe_s}' -ArgumentList '/S' -Wait; \
             Start-Sleep -Seconds 1; \
             if (-not (Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension('{me_s}')) -ErrorAction SilentlyContinue)) \
             {{ Start-Process -FilePath '{me_s}' }}"
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("설치를 시작하지 못했어요: {e}"))?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("업데이트 설치는 윈도우에서만 동작해요.".into())
    }
}
