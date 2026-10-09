//! 원격 화면 보기: 주 모니터 스냅샷(JPEG) 1장씩만 교내망 P2P로 보낸다.
//! - 파일로 저장하지 않고 RAM에서 만들어 바로 base64로 돌린다.
//! - P2P 한 줄 상한(2MB) 안에 들게 960px·품질 60으로 줄이고, 그래도 크면 720px·품질 45로 한 번 더 줄인다.
//! - 상대방 수락 없이는 절대 찍어서 보내지 않는다 (호출하는 쪽에서 수락을 먼저 받는다).

use base64::{engine::general_purpose::STANDARD as B64, Engine};

/// base64 글자 수 상한 (P2P 한 줄 2MB보다 여유 있게)
const MAX_B64_CHARS: usize = 1_400_000;

pub struct Snapshot {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
}

fn encode_at(img: &image::RgbaImage, width: u32, quality: u8) -> Result<Snapshot, String> {
    let (w0, h0) = (img.width(), img.height());
    let nw = width.min(w0);
    let nh = ((h0 as u64 * nw as u64) / w0.max(1) as u64).max(1) as u32;
    let small = image::imageops::resize(img, nw, nh, image::imageops::FilterType::Triangle);
    let mut buf = Vec::new();
    {
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
        enc.encode(small.as_raw(), nw, nh, image::ExtendedColorType::Rgba8)
            .map_err(|e| e.to_string())?;
    }
    let b64 = B64.encode(&buf);
    Ok(Snapshot {
        data_url: format!("data:image/jpeg;base64,{b64}"),
        width: nw,
        height: nh,
        bytes: buf.len(),
    })
}

pub fn capture_snapshot() -> Result<Snapshot, String> {
    let mons = xcap::Monitor::all().map_err(|e| e.to_string())?;
    if mons.is_empty() {
        return Err("주 모니터를 찾지 못했어요.".to_string());
    }
    let idx = mons
        .iter()
        .position(|m| m.is_primary().unwrap_or(false))
        .unwrap_or(0);
    let img = mons[idx].capture_image().map_err(|e| e.to_string())?;
    let first = encode_at(&img, 960, 60)?;
    if first.data_url.len() <= MAX_B64_CHARS {
        return Ok(first);
    }
    let second = encode_at(&img, 720, 45)?;
    if second.data_url.len() <= MAX_B64_CHARS {
        return Ok(second);
    }
    Err("화면이 너무 커서 못 보내요. 해상도를 낮추고 다시 시도해 주세요.".to_string())
}
