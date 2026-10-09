//! 담임 비밀 기록장 암호화 (AES-256-GCM)
//! 열쇠는 이 기기 번호+비밀번호에서 뽑는다.
//! 비밀번호가 맞는지 앞 4바이트 "EDU1"로 확인한다 (틀리면 절대 안 열린다).

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use rand::RngCore;

const MAGIC: &[u8] = b"EDU1";

fn key_for(device: &str, password: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    // 전용 KDF 없이 단발 해시만 쓰면 무차별 대입에 약하다.
    // 10만 회 반복으로 최소 방어를 한다 (예전 1회분은 open에서 호환으로 읽는다).
    let mut h = Sha256::new();
    h.update(b"edutalk-secret-v1");
    h.update(device.as_bytes());
    h.update(password.as_bytes());
    let mut out: [u8; 32] = h.finalize().into();
    for _ in 0..100_000 {
        let mut h2 = Sha256::new();
        h2.update(out);
        h2.update(b"edutalk-secret-v1");
        out = h2.finalize().into();
    }
    out
}

/// 예전(1회 해시) 열쇠 — 이미 잠근 기록장을 계속 열어주기 위해서만 둔다.
fn key_for_legacy(device: &str, password: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"edutalk-secret-v1");
    h.update(device.as_bytes());
    h.update(password.as_bytes());
    h.finalize().into()
}

pub fn seal(device: &str, password: &str, plain: &str) -> Result<Vec<u8>, String> {
    if password.chars().count() < 4 {
        return Err("비밀번호는 4자리 이상으로 해주세요.".into());
    }
    let raw_key = key_for(device, password);
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&raw_key);
    let cipher = Aes256Gcm::new(key);
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let mut data = MAGIC.to_vec();
    data.extend_from_slice(plain.as_bytes());
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), data.as_slice())
        .map_err(|e| e.to_string())?;
    let mut out = nonce_bytes.to_vec();
    out.extend(ct);
    Ok(out)
}

pub fn open(device: &str, password: &str, blob: &[u8]) -> Result<String, String> {
    if blob.len() < 12 {
        return Err("기록이 없어요.".into());
    }
    // 새 열쇠 먼저, 안 열리면 예전 열쇠로 한 번 더 (호환 읽기)
    if let Ok(s) = open_with(&key_for(device, password), blob) {
        return Ok(s);
    }
    open_with(&key_for_legacy(device, password), blob)
}

fn open_with(raw_key: &[u8; 32], blob: &[u8]) -> Result<String, String> {
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(raw_key);
    let cipher = Aes256Gcm::new(key);
    let pt = cipher
        .decrypt(Nonce::from_slice(&blob[..12]), &blob[12..])
        .map_err(|_| "비밀번호가 달라요.".to_string())?;
    if !pt.starts_with(MAGIC) {
        return Err("비밀번호가 달라요.".into());
    }
    String::from_utf8(pt[MAGIC.len()..].to_vec()).map_err(|_| "풀지 못했어요.".into())
}
