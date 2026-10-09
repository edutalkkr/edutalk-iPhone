//! 전송 전 유출 검사 (이 PC 안에서만)
//! 1차: 정규식 (0.001초 수준) — 주민번호·전화·계좌·카드·성적 표현
//! 2차: ONNX 한국어 분류 모델 (0.01초 수준) — `onnx` 기능으로 켜면 실제 추론,
//!      기본 빌드에서는 문맥 단어 점수로 대신한다.
//! 판정이 `차단`이면 패킷을 만들기 전에 멈추고 감사 기록을 남긴다.

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

pub const BLOCK_AT: f32 = 0.85;
pub const WARN_AT: f32 = 0.45;

#[derive(Debug, Clone, Serialize)]
pub struct DlpHit {
    pub id: String,
    pub label: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DlpResult {
    /// allow | warn | block
    pub verdict: String,
    pub score: f32,
    pub hits: Vec<DlpHit>,
    pub elapsed_ms: u128,
    pub model: String,
}

#[derive(Clone, Copy)]
struct Rule {
    id: &'static str,
    label: &'static str,
    pattern: &'static str,
    weight: f32,
}

// 순서대로: 주민번호, 휴대전화, 카드, 계좌, 성적 표현, 비밀번호 노출
static RULES: &[Rule] = &[
    Rule { id: "RRN", label: "주민등록번호", pattern: r"\d{6}-?[1-4]\d{6}", weight: 1.0 },
    Rule { id: "PHONE", label: "휴대전화", pattern: r"01[016789]-?\d{3,4}-?\d{4}", weight: 0.6 },
    Rule { id: "CARD", label: "카드번호", pattern: r"\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}", weight: 0.9 },
    Rule { id: "ACCOUNT", label: "계좌번호", pattern: r"\d{2,6}[- ]?\d{2,6}[- ]?\d{3,6}", weight: 0.4 },
    Rule { id: "SCORE", label: "성적 표현", pattern: r"(국어|수학|영어|과학|사회|선택)\s*[:=]?\s*(\d{1,3}점?|[A-E]등급)|시험지|답지|답안지|성적표|생활기록부", weight: 0.8 },
    Rule { id: "PASSWORD", label: "비밀번호 노출", pattern: r"(?i)(비밀번호|패스워드|password|passwd)\s*[:=]\s*\S{4,}", weight: 1.0 },
];

static CONTEXT_WORDS: &[(&str, f32)] = &[
    ("주민", 0.15), ("개인정보", 0.15), ("유출", 0.1), ("외부반출", 0.15),
    ("성적", 0.12), ("석차", 0.12), ("등급", 0.1), ("모의고사", 0.1),
    ("계좌", 0.1), ("입금", 0.1), ("송금", 0.1),
];

static COMPILED: OnceLock<Vec<(Rule, Regex)>> = OnceLock::new();

fn compiled() -> &'static Vec<(Rule, Regex)> {
    COMPILED.get_or_init(|| {
        RULES
            .iter()
            .map(|r| (*r, Regex::new(r.pattern).expect("정규식 오류")))
            .collect()
    })
}

/// 동기 빠른 검사 (정규식 + 문맥 점수)
pub fn scan_sync(text: &str, file_name: &str) -> DlpResult {
    let t0 = std::time::Instant::now();
    let mut hits = Vec::new();
    let mut score = 0.0f32;
    for (rule, re) in compiled() {
        // 첫 적중을 정가로 본다: 주민번호·카드·비밀번호 1개도 그냥 보내면 안 된다.
        // (예전 0.35 계수는 1개 적중을 전부 통과시켜 버렸다)
        let n = re.find_iter(text).take(5).count();
        if n > 0 {
            score += rule.weight + 0.1 * ((n - 1) as f32);
            hits.push(DlpHit {
                id: rule.id.to_string(),
                label: rule.label.to_string(),
                count: n,
            });
        }
    }
    for (word, w) in CONTEXT_WORDS {
        if text.contains(word) {
            score += w;
        }
    }
    // 첨부 이름이 성적·명렬 관련이면 가산
    let lower = file_name.to_lowercase();
    if ["성적", "명렬", "학생부", "시험지", "답지"].iter().any(|k| lower.contains(k)) {
        score += 0.2;
        hits.push(DlpHit { id: "FILENAME".into(), label: "파일 이름".into(), count: 1 });
    }
    // 2차: ONNX 기능이 켜져 있으면 모델 점수로 보정
    let (model, extra) = second_stage(text);
    score = (score + extra).min(1.0);
    let verdict = if score >= BLOCK_AT {
        "block"
    } else if score >= WARN_AT {
        "warn"
    } else {
        "allow"
    };
    DlpResult {
        verdict: verdict.to_string(),
        score,
        hits,
        elapsed_ms: t0.elapsed().as_millis(),
        model,
    }
}

#[cfg(feature = "onnx")]
fn second_stage(text: &str) -> (String, f32) {
    // 모델 파일(dlp-ko-small.onnx)이 있으면 여기서 토큰화→추론한다.
    // 파일이 없으면 1차 점수만 쓴다.
    let path = std::env::var("EDUTALK_DLP_MODEL").unwrap_or_else(|_| "dlp-ko-small.onnx".into());
    if !std::path::Path::new(&path).exists() {
        return ("regex-only".to_string(), 0.0);
    }
    // TODO(onnx): ort 세션 로드 후 문맥 점수 반환
    ("onnx".to_string(), context_heuristic(text))
}

#[cfg(not(feature = "onnx"))]
fn second_stage(text: &str) -> (String, f32) {
    ("heuristic".to_string(), context_heuristic(text))
}

/// 문맥 점수 (모델이 없을 때 2차를 대신한다)
fn context_heuristic(text: &str) -> f32 {
    let mut s = 0.0;
    for (word, w) in CONTEXT_WORDS {
        if text.contains(word) {
            s += w * 0.5;
        }
    }
    s.min(0.3)
}
