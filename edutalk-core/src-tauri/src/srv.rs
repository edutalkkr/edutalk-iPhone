//! 학교 온프레미스 서버(onprem) 연동 클라이언트.
//! - 로그인 토큰은 Rust 안에만 보관한다 (화면·CSP 밖 → 토큰이 웹뷰로 새지 않는다).
//! - 계정·방·메시지는 학교 서버(SQLite)에만 있고, 이 PC는 받아서 표시만 한다.
//! - 경로는 `/api/...` 만 허용해 임의 요청을 막는다.
use std::sync::Mutex;

#[derive(Default)]
pub struct SrvState {
    base: Mutex<String>,
    token: Mutex<String>,
    user: Mutex<Option<serde_json::Value>>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())
}

/// 주소 정규화: 스킴이 없으면 http:// 를 붙이고 끝 슬래시를 뗀다.
pub(crate) fn norm_base(base: &str) -> String {
    let b = base.trim().trim_end_matches('/').to_string();
    if b.is_empty() {
        b
    } else if b.starts_with("http://") || b.starts_with("https://") {
        b
    } else {
        format!("http://{b}")
    }
}

fn safe_path(path: &str) -> Result<String, String> {
    let p = path.trim();
    if !p.starts_with("/api/") || p.contains("..") {
        return Err("허용되지 않은 경로예요.".into());
    }
    Ok(p.to_string())
}

pub async fn login(
    state: &SrvState,
    base: &str,
    username: &str,
    password: &str,
) -> Result<serde_json::Value, String> {
    let base = norm_base(base);
    if base.is_empty() {
        return Err("학교 서버 주소를 입력해 주세요.".into());
    }
    let res = client()?
        .post(format!("{base}/api/login"))
        .json(&serde_json::json!({ "username": username, "password": password }))
        .send()
        .await
        .map_err(|_| "학교 서버에 연결하지 못했어요. 주소와 교내망 연결을 확인해 주세요.".to_string())?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() || body.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let msg = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("사번(학번)이나 비밀번호를 확인해 주세요.");
        return Err(msg.to_string());
    }
    let token = body.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let user = body.get("user").cloned().unwrap_or(serde_json::json!({}));
    if let Ok(mut b) = state.base.lock() {
        *b = base;
    }
    if let Ok(mut t) = state.token.lock() {
        *t = token;
    }
    if let Ok(mut u) = state.user.lock() {
        *u = Some(user.clone());
    }
    Ok(serde_json::json!({ "ok": true, "user": user }))
}

pub async fn logout(state: &SrvState) -> Result<(), String> {
    let base = state.base.lock().map(|b| b.clone()).unwrap_or_default();
    let token = state.token.lock().map(|t| t.clone()).unwrap_or_default();
    if !base.is_empty() && !token.is_empty() {
        if let Ok(c) = client() {
            let _ = c
                .post(format!("{base}/api/logout"))
                .bearer_auth(&token)
                .send()
                .await;
        }
    }
    if let Ok(mut t) = state.token.lock() {
        t.clear();
    }
    if let Ok(mut u) = state.user.lock() {
        *u = None;
    }
    Ok(())
}

fn parts(state: &SrvState) -> Result<(String, String), String> {
    let base = state.base.lock().map(|b| b.clone()).unwrap_or_default();
    let token = state.token.lock().map(|t| t.clone()).unwrap_or_default();
    if base.is_empty() {
        return Err("학교 서버에 먼저 로그인해 주세요.".into());
    }
    Ok((base, token))
}

pub async fn get(state: &SrvState, path: &str) -> Result<serde_json::Value, String> {
    let p = safe_path(path)?;
    let (base, token) = parts(state)?;
    let res = client()?
        .get(format!("{base}{p}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|_| "학교 서버에 연결하지 못했어요.".to_string())?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if status.as_u16() == 401 {
        return Err("로그인이 만료됐어요. 다시 로그인해 주세요.".into());
    }
    if !status.is_success() {
        return Err(body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("서버 요청에 실패했어요.")
            .to_string());
    }
    Ok(body)
}

pub async fn post(
    state: &SrvState,
    path: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let p = safe_path(path)?;
    let (base, token) = parts(state)?;
    let res = client()?
        .post(format!("{base}{p}"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|_| "학교 서버에 연결하지 못했어요.".to_string())?;
    let status = res.status();
    let out: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if status.as_u16() == 401 {
        return Err("로그인이 만료됐어요. 다시 로그인해 주세요.".into());
    }
    if !status.is_success() || out.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        return Err(out
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("서버 요청에 실패했어요.")
            .to_string());
    }
    Ok(out)
}

pub fn status(state: &SrvState) -> serde_json::Value {
    let base = state.base.lock().map(|b| b.clone()).unwrap_or_default();
    let token = state.token.lock().map(|t| t.clone()).unwrap_or_default();
    let user = state.user.lock().ok().and_then(|u| u.clone());
    serde_json::json!({
        "connected": !base.is_empty() && !token.is_empty(),
        "base": base,
        "user": user,
    })
}
