//! 자리 차지 없애기: 메모리 미리보기 + 임시 파일 자동 정리
//! 첨부는 내려받기 폴더에 두지 않고 메모리에서만 열어 보고 바로 지운다.
//! 30일 지난 임시 파일·3GB 초과분은 뒤에서 조용히 지운다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub const MAX_RAM_BYTES: usize = 64 * 1024 * 1024;
pub const QUOTA_BYTES: u64 = 3 * 1024 * 1024 * 1024;
pub const TTL_SECS: u64 = 30 * 24 * 3600;

#[derive(Clone)]
pub struct RamStore {
    inner: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    used: Arc<Mutex<usize>>,
}

impl RamStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            used: Arc::new(Mutex::new(0)),
        }
    }

    pub fn put(&self, id: String, data: Vec<u8>) -> Result<usize, String> {
        if data.len() > MAX_RAM_BYTES {
            return Err("너무 커서 메모리로 볼 수 없어요.".into());
        }
        let mut used = self.used.lock().map_err(|e| e.to_string())?;
        let mut map = self.inner.lock().map_err(|e| e.to_string())?;
        // 같은 자리를 덮어쓰면 옛 크기를 먼저 뺀다 (계수기 누수 방지)
        if let Some(old) = map.get(&id) {
            *used = used.saturating_sub(old.len());
        }
        if *used + data.len() > MAX_RAM_BYTES {
            map.clear();
            *used = 0;
        }
        *used += data.len();
        let n = data.len();
        map.insert(id, data);
        Ok(n)
    }

    pub fn get(&self, id: &str) -> Option<Vec<u8>> {
        self.inner.lock().ok()?.get(id).cloned()
    }

    pub fn free(&self, id: &str) -> bool {
        let mut map = match self.inner.lock() {
            Ok(m) => m,
            Err(_) => return false,
        };
        if let Some(v) = map.remove(id) {
            if let Ok(mut used) = self.used.lock() {
                *used = used.saturating_sub(v.len());
            }
            // 0으로 덮어 메모리 흔적을 지운다
            let mut v = v;
            v.fill(0);
            true
        } else {
            false
        }
    }
}

/// 임시 폴더 정리: 30일 지난 것 먼저, 그래도 3GB 넘으면 오래된 순
pub fn purge_dir(dir: &std::path::Path) -> Result<PurgeResult, String> {
    let mut files: Vec<(std::path::PathBuf, u64, u64)> = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for e in entries.flatten() {
        let p = e.path();
        let meta = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        files.push((p, meta.len(), mtime));
    }
    let now_old = TTL_SECS;
    let mut deleted_expired = 0usize;
    let mut freed = 0u64;
    let mut rest: Vec<(std::path::PathBuf, u64, u64)> = Vec::new();
    for (p, size, age) in files {
        if age > now_old {
            if std::fs::remove_file(&p).is_ok() {
                deleted_expired += 1;
                freed += size;
                continue;
            }
        }
        rest.push((p, size, age));
    }
    let mut total: u64 = rest.iter().map(|(_, s, _)| s).sum();
    // 오래된 것부터 지운다 (pop이 끝에서 꺼내므로 오름차순)
    rest.sort_by_key(|(_, _, age)| *age);
    let mut deleted_quota = 0usize;
    while total > QUOTA_BYTES {
        if let Some((p, size, _)) = rest.pop() {
            if std::fs::remove_file(&p).is_ok() {
                deleted_quota += 1;
                freed += size;
                total = total.saturating_sub(size);
            }
        } else {
            break;
        }
    }
    Ok(PurgeResult {
        deleted_expired,
        deleted_quota,
        freed_bytes: freed,
        total_bytes: total,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PurgeResult {
    pub deleted_expired: usize,
    pub deleted_quota: usize,
    pub freed_bytes: u64,
    pub total_bytes: u64,
}
