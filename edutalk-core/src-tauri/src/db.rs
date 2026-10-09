//! 로컬 저장소 (SQLite)
//! 표 정의는 상위 schema.sql과 같다. 서버로 올리는 표는 하나도 없다.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const SCHEMA: &str = include_str!("../../schema.sql");

pub struct Db {
    inner: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &std::path::Path) -> Result<Self, String> {        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| e.to_string())?;
        // 배포 빌드에서는 여기서 `PRAGMA key = '기기별 키';` 로 파일 암호화를 켠다.
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        // 예전 DB에도 새 열을 붙인다 (없을 때만)
        Self::ensure_column(&conn, "memos", "importance", "TEXT NOT NULL DEFAULT 'normal'")?;
        Ok(Self {
            inner: Mutex::new(conn),
        })
    }

    fn ensure_column(conn: &Connection, table: &str, column: &str, ddl: &str) -> Result<(), String> {
        let mut st = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|e| e.to_string())?;
        let names: Vec<String> = st
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if !names.iter().any(|n| n == column) {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// 짧은 질의용 연결 빌림 (명령 핸들러에서 사용)
    pub fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.inner.lock().map_err(|e| e.to_string())
    }

    pub fn save_memo(
        &self,
        id: &str,
        title: &str,
        body: &str,
        from_uid: &str,
        from_name: &str,
        via: &str,
        to: &[Recipient],
    ) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO memos(id,title,body,from_uid,from_name,via,created_at) VALUES(?,?,?,?,?,?,?)",
            params![id, title, body, from_uid, from_name, via, now],
        )
        .map_err(|e| e.to_string())?;
        for r in to {
            // OR IGNORE: 다시 받으면 읽음·재촉 시각을 살린다
            conn.execute(
                "INSERT OR IGNORE INTO memo_recipients(memo_id,uid,name,read_at,nudged_at) VALUES(?,?,?,NULL,NULL)",
                params![id, r.uid, r.name],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_memos(&self, limit: i64) -> Result<Vec<MemoRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT id,title,body,from_uid,from_name,via,created_at,COALESCE(importance,'normal') FROM memos ORDER BY created_at DESC LIMIT ?")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([limit], |row| {
                Ok(MemoRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    body: row.get(2)?,
                    from_uid: row.get(3)?,
                    from_name: row.get(4)?,
                    via: row.get(5)?,
                    created_at: row.get(6)?,
                    importance: row.get(7)?,
                    recipients: vec![],
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            let mut m = r.map_err(|e| e.to_string())?;
            let mut rs = conn
                .prepare("SELECT uid,name,read_at,nudged_at FROM memo_recipients WHERE memo_id=?")
                .map_err(|e| e.to_string())?;
            let recs = rs
                .query_map([m.id.clone()], |row| {
                    Ok(RecipientRow {
                        uid: row.get(0)?,
                        name: row.get(1)?,
                        read_at: row.get(2).unwrap_or(None),
                        nudged_at: row.get(3).unwrap_or(None),
                    })
                })
                .map_err(|e| e.to_string())?;
            for rec in recs {
                m.recipients.push(rec.map_err(|e| e.to_string())?);
            }
            out.push(m);
        }
        Ok(out)
    }

    pub fn mark_read(&self, memo_id: &str, uid: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "UPDATE memo_recipients SET read_at=? WHERE memo_id=? AND uid=?",
            params![now, memo_id, uid],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_nudged(&self, memo_id: &str, uid: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "UPDATE memo_recipients SET nudged_at=? WHERE memo_id=? AND uid=?",
            params![now, memo_id, uid],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_comment(
        &self,
        id: &str,
        memo_id: &str,
        body: &str,
        from_uid: &str,
        from_name: &str,
    ) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO comments(id,memo_id,body,from_uid,from_name,created_at) VALUES(?,?,?,?,?,?)",
            params![id, memo_id, body, from_uid, from_name, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_comments(&self, memo_id: &str) -> Result<Vec<CommentRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT id,body,from_uid,from_name,created_at FROM comments WHERE memo_id=? ORDER BY created_at ASC LIMIT 500")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([memo_id], |row| {
                Ok(CommentRow {
                    id: row.get(0)?,
                    body: row.get(1)?,
                    from_uid: row.get(2)?,
                    from_name: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn add_quick(
        &self,
        id: &str,
        peer_uid: &str,
        peer_name: &str,
        body: &str,
        mine: bool,
    ) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO quick_messages(id,peer_uid,peer_name,body,mine,created_at) VALUES(?,?,?,?,?,?)",
            params![id, peer_uid, peer_name, body, mine as i32, now],
        )
        .map_err(|e| e.to_string())?;
        // 7일 지난 빠른 대화는 정리 (문자열 비교가 통하도록 같은 RFC3339로 잘라낸다)
        let cutoff = (chrono::Local::now() - chrono::Duration::days(7)).to_rfc3339();
        conn.execute(
            "DELETE FROM quick_messages WHERE created_at < ?",
            [cutoff],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_quick(&self, peer_uid: &str) -> Result<Vec<QuickRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT id,body,mine,created_at FROM quick_messages WHERE peer_uid=? ORDER BY created_at ASC LIMIT 300")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([peer_uid], |row| {
                let mine: i32 = row.get(2)?;
                Ok(QuickRow {
                    id: row.get(0)?,
                    body: row.get(1)?,
                    mine: mine == 1,
                    created_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    // 동료 목록의 DB 보관은 다음 단계에서 쓴다 (지금은 메모리 목록 사용)
    #[allow(dead_code)]
    pub fn upsert_peer(&self, p: &PeerRow) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO peers(node_id,name,address,tcp_port,grade,room,last_seen) VALUES(?,?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET name=excluded.name,address=excluded.address,tcp_port=excluded.tcp_port,grade=excluded.grade,room=excluded.room,last_seen=excluded.last_seen",
            params![p.node_id, p.name, p.address, p.tcp_port, p.grade, p.room, p.last_seen],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn list_peers(&self) -> Result<Vec<PeerRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT node_id,name,address,tcp_port,grade,room,last_seen FROM peers WHERE last_seen > datetime('now','-60 seconds') ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |row| {
                Ok(PeerRow {
                    node_id: row.get(0)?,
                    name: row.get(1)?,
                    address: row.get(2)?,
                    tcp_port: row.get(3)?,
                    grade: row.get(4)?,
                    room: row.get(5)?,
                    last_seen: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    // ===== 업무함·행정 =====

    /// 역색인에 한 줄 넣는다 (쪽지·댓글 저장 때 함께 호출)
    /// 같은 쪽지를 다시 저장하면 옛 줄을 먼저 지운다 (검색 중복 방지)
    pub fn fts_index(&self, kind: &str, ref_id: &str, title: &str, body: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM search_fts WHERE ref_kind=? AND ref_id=?",
            params![kind, ref_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO search_fts(ref_kind,ref_id,title,body) VALUES(?,?,?,?)",
            params![kind, ref_id, title, body],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 기기 안 전체 검색 (쪽지 제목·본문·댓글)
    pub fn search(&self, query: &str) -> Result<Vec<SearchHit>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        // 따옴표 등 특수문자는 빼고 단어만 잇는다 (FTS 문법 깨짐 방지)
        let words: Vec<String> = query
            .split(|c: char| c.is_whitespace() || ",.!?;:()[]\"'".contains(c))
            .map(|w| w.trim().to_string())
            .filter(|w| w.chars().count() >= 2)
            .take(5)
            .collect();
        if words.is_empty() {
            return Ok(vec![]);
        }
        let q = words.iter().map(|w| format!("\"{w}\"")).collect::<Vec<_>>().join(" OR ");
        let mut st = conn
            .prepare("SELECT ref_kind,ref_id,title,snippet(search_fts,3,'<b>','</b>','…',24) FROM search_fts WHERE search_fts MATCH ? ORDER BY rank LIMIT 50")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([q], |row| {
                Ok(SearchHit {
                    kind: row.get(0)?,
                    ref_id: row.get(1)?,
                    title: row.get(2)?,
                    snippet: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn set_importance(&self, memo_id: &str, importance: &str) -> Result<(), String> {
        let v = match importance {
            "urgent" | "ref" => importance,
            _ => "normal",
        };
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE memos SET importance=? WHERE id=?", params![v, memo_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_memos_filtered(&self, importance: &str, limit: i64) -> Result<Vec<MemoRow>, String> {
        // 중요도 거르기: urgent(긴급) · normal(일반) · ref(참고) · all(전체)
        if importance == "all" {
            return self.list_memos(limit);
        }
        // list_memos를 쓰고 골라낸다 (목록이 길지 않아 충분)
        Ok(self.list_memos(500)?.into_iter().filter(|m| m.importance == importance).take(limit as usize).collect())
    }

    pub fn create_poll(&self, id: &str, memo_id: &str, question: &str, options: &[String]) -> Result<(), String> {
        if options.len() < 2 || options.len() > 6 {
            return Err("보기는 2~6개로 해주세요.".into());
        }
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO polls(id,memo_id,question,options,closed,created_at) VALUES(?,?,?,?,0,?)",
            params![id, memo_id, question, serde_json::to_string(options).unwrap_or("[]".into()), now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_polls(&self, memo_id: &str) -> Result<Vec<PollRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT id,question,options,closed FROM polls WHERE memo_id=? ORDER BY created_at")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([memo_id], |row| {
                let opts: String = row.get(2)?;
                Ok(PollRow {
                    id: row.get(0)?,
                    question: row.get(1)?,
                    options: serde_json::from_str(&opts).unwrap_or_default(),
                    closed: row.get::<_, i64>(3)? == 1,
                    counts: vec![],
                    mine: -1,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out: Vec<PollRow> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        for p in out.iter_mut() {
            let mut vs = conn
                .prepare("SELECT choice,COUNT(*) FROM poll_votes WHERE poll_id=? GROUP BY choice")
                .map_err(|e| e.to_string())?;
            let counts = vs
                .query_map([p.id.clone()], |row| {
                    let c: i64 = row.get(0)?;
                    let n: i64 = row.get(1)?;
                    Ok((c, n))
                })
                .map_err(|e| e.to_string())?;
            let mut arr = vec![0i64; p.options.len()];
            for r in counts {
                let (c, n) = r.map_err(|e: rusqlite::Error| e.to_string())?;
                if c >= 0 && (c as usize) < arr.len() {
                    arr[c as usize] = n;
                }
            }
            p.counts = arr;
        }
        Ok(out)
    }

    pub fn vote_poll(&self, poll_id: &str, uid: &str, choice: i64) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let closed: i64 = conn
            .query_row("SELECT closed FROM polls WHERE id=?", [poll_id], |row| row.get(0))
            .map_err(|_| "마감된 투표예요.".to_string())?;
        if closed == 1 {
            return Err("마감된 투표예요.".into());
        }
        conn.execute(
            "INSERT INTO poll_votes(poll_id,uid,choice) VALUES(?,?,?) ON CONFLICT(poll_id,uid) DO UPDATE SET choice=excluded.choice",
            params![poll_id, uid, choice],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn close_poll(&self, poll_id: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE polls SET closed=1 WHERE id=?", [poll_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn poll_my_choice(&self, poll_id: &str, uid: &str) -> Result<i64, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let v: Result<i64, _> = conn.query_row(
            "SELECT choice FROM poll_votes WHERE poll_id=? AND uid=?",
            params![poll_id, uid],
            |row| row.get(0),
        );
        Ok(v.unwrap_or(-1))
    }

    pub fn seed_templates(&self) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM templates", [], |r| r.get(0)).unwrap_or(0);
        if n > 0 {
            return Ok(());
        }
        let base = [
            ("가정통신문", "학부모님께 안내드립니다.\n\n내용:\n\n- 일시:\n- 장소:\n\n협조 부탁드립니다."),
            ("연가 신청", "연가 신청합니다.\n\n- 일자:\n- 사유:\n\n결재 부탁드립니다."),
            ("공지 확인 요청", "공지 쪽지를 보냈습니다. 확인 후 댓글로 \"확인\"을 남겨주세요."),
            ("출장 보고", "출장 다녀왔습니다.\n\n- 기간:\n- 장소:\n- 내용:"),
        ];
        for (i, (t, b)) in base.iter().enumerate() {
            conn.execute(
                "INSERT INTO templates(id,title,body) VALUES(?,?,?)",
                params![format!("tpl-{i}"), t, b],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_templates(&self) -> Result<Vec<TemplateRow>, String> {
        self.seed_templates()?;
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn.prepare("SELECT id,title,body FROM templates ORDER BY rowid").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |row| Ok(TemplateRow { id: row.get(0)?, title: row.get(1)?, body: row.get(2)? }))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn add_template(&self, id: &str, title: &str, body: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO templates(id,title,body) VALUES(?,?,?)", params![id, title, body])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_template(&self, id: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM templates WHERE id=?", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_scheduled(&self, id: &str, title: &str, body: &str, to_json: &str, run_at: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO scheduled_sends(id,title,body,to_json,run_at,status,created_at) VALUES(?,?,?,?,?,'waiting',?)",
            params![id, title, body, to_json, run_at, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn due_scheduled(&self, now_iso: &str) -> Result<Vec<ScheduledRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT id,title,body,to_json,run_at FROM scheduled_sends WHERE status='waiting' AND run_at<=? ORDER BY run_at LIMIT 20")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([now_iso], |row| {
                Ok(ScheduledRow {
                    id: row.get(0)?, title: row.get(1)?, body: row.get(2)?,
                    to_json: row.get(3)?, run_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn mark_scheduled(&self, id: &str, status: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE scheduled_sends SET status=? WHERE id=?", params![status, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_scheduled(&self) -> Result<Vec<ScheduledRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT id,title,body,to_json,run_at FROM scheduled_sends WHERE status='waiting' ORDER BY run_at LIMIT 50")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |row| {
                Ok(ScheduledRow {
                    id: row.get(0)?, title: row.get(1)?, body: row.get(2)?,
                    to_json: row.get(3)?, run_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn add_event(&self, id: &str, title: &str, date: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO school_events(id,title,date) VALUES(?,?,?)", params![id, title, date])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_events(&self) -> Result<Vec<EventRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn.prepare("SELECT id,title,date FROM school_events ORDER BY date LIMIT 100").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |row| Ok(EventRow { id: row.get(0)?, title: row.get(1)?, date: row.get(2)? }))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn delete_event(&self, id: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM school_events WHERE id=?", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_secret(&self, cipher: Vec<u8>) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO secret_memos(id,cipher,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET cipher=excluded.cipher,updated_at=excluded.updated_at",
            params![cipher, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_secret(&self) -> Result<Option<Vec<u8>>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn.prepare("SELECT cipher FROM secret_memos WHERE id=1").map_err(|e| e.to_string())?;
        let mut rows = st.query_map([], |row| row.get::<_, Vec<u8>>(0)).map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(v)) if !v.is_empty() => Ok(Some(v)),
            _ => Ok(None),
        }
    }

    pub fn replace_org(&self, nodes: &[OrgNode]) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM org_nodes", []).map_err(|e| e.to_string())?;
        for n in nodes {
            conn.execute(
                "INSERT INTO org_nodes(id,dept,grade,name,role) VALUES(?,?,?,?,?)",
                params![n.id, n.dept, n.grade, n.name, n.role],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_org(&self) -> Result<Vec<OrgNode>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn.prepare("SELECT id,dept,grade,name,role FROM org_nodes ORDER BY dept,grade,name LIMIT 2000").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |row| {
                Ok(OrgNode { id: row.get(0)?, dept: row.get(1)?, grade: row.get(2)?, name: row.get(3)?, role: row.get(4)? })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn add_guest(&self, pin: &str, name: &str, expires_at: &str) -> Result<(), String> {
        if pin.len() != 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err("PIN은 숫자 6자리로 해주세요.".into());
        }
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO guest_pins(pin,name,expires_at,used) VALUES(?,?,?,0)",
            params![pin, name, expires_at],
        )
        .map_err(|_| "이미 있는 번호예요. 다시 만들어주세요.".to_string())?;
        Ok(())
    }

    pub fn list_guests(&self) -> Result<Vec<GuestRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn.prepare("SELECT pin,name,expires_at,used FROM guest_pins ORDER BY expires_at").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |row| {
                Ok(GuestRow { pin: row.get(0)?, name: row.get(1)?, expires_at: row.get(2)?, used: row.get::<_, i64>(3)? == 1 })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    // 게스트 PIN 검증 — 다음 단계(외부 손님 초대)에서 연결 예정. 지금은 호출 없음.
    #[allow(dead_code)]
    pub fn verify_guest(&self, pin: &str, now_iso: &str) -> Result<String, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let row: Result<(String, String, i64), _> = conn.query_row(
            "SELECT name,expires_at,used FROM guest_pins WHERE pin=?",
            [pin],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        );
        match row {
            Ok((name, exp, _)) if exp.as_str() > now_iso => {
                conn.execute("UPDATE guest_pins SET used=1 WHERE pin=?", [pin]).map_err(|e| e.to_string())?;
                Ok(name)
            }
            Ok(_) => Err("기한이 지난 번호예요.".into()),
            Err(_) => Err("없는 번호예요.".into()),
        }
    }

    pub fn revoke_guest(&self, pin: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM guest_pins WHERE pin=?", [pin]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_handover(&self, id: &str, job_tag: &str, body: &str, from_name: &str) -> Result<(), String> {
        if job_tag.trim().is_empty() {
            return Err("보직 태그를 적어주세요. (예: 2026_과학부장)".into());
        }
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO handover_notes(id,job_tag,body,from_name,created_at) VALUES(?,?,?,?,?)",
            params![id, job_tag.trim(), body, from_name, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn handover_tags(&self) -> Result<Vec<String>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn.prepare("SELECT DISTINCT job_tag FROM handover_notes ORDER BY job_tag").map_err(|e| e.to_string())?;
        let rows = st.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_handover(&self, job_tag: &str) -> Result<Vec<HandoverRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT id,body,from_name,created_at FROM handover_notes WHERE job_tag=? ORDER BY created_at DESC LIMIT 200")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([job_tag], |row| {
                Ok(HandoverRow { id: row.get(0)?, body: row.get(1)?, from_name: row.get(2)?, created_at: row.get(3)? })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn add_inbox(&self, id: &str, dept: &str, title: &str, body: &str, from_name: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO dept_inbox(id,dept,title,body,from_name,state,created_at) VALUES(?,?,?,?,?,'new',?)",
            params![id, dept, title, body, from_name, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_inbox(&self, dept: &str) -> Result<Vec<InboxRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT id,title,body,from_name,state,created_at FROM dept_inbox WHERE dept=? ORDER BY created_at DESC LIMIT 200")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([dept], |row| {
                Ok(InboxRow {
                    id: row.get(0)?, title: row.get(1)?, body: row.get(2)?,
                    from_name: row.get(3)?, state: row.get(4)?, created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn set_inbox_state(&self, id: &str, state: &str) -> Result<(), String> {
        let v = match state {
            "doing" | "done" => state,
            _ => "new",
        };
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE dept_inbox SET state=? WHERE id=?", params![v, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_hwptpl(&self, id: &str, title: &str, note: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO hwp_templates(id,title,note) VALUES(?,?,?)", params![id, title, note])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_hwptpl(&self) -> Result<Vec<HwptplRow>, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let mut st = conn.prepare("SELECT id,title,note FROM hwp_templates ORDER BY title LIMIT 200").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |row| Ok(HwptplRow { id: row.get(0)?, title: row.get(1)?, note: row.get(2)? }))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn delete_hwptpl(&self, id: &str) -> Result<(), String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM hwp_templates WHERE id=?", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_scratch(&self, id: &str) -> Result<ScratchRow, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let row: Result<(String, String), _> = conn.query_row(
            "SELECT body,updated_at FROM scratchpads WHERE id=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        );
        match row {
            Ok((body, updated_at)) => Ok(ScratchRow { id: id.into(), body, updated_at }),
            Err(_) => Ok(ScratchRow { id: id.into(), body: String::new(), updated_at: String::new() }),
        }
    }

    pub fn save_scratch(&self, id: &str, body: &str) -> Result<String, String> {
        let conn = self.inner.lock().map_err(|e| e.to_string())?;
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO scratchpads(id,body,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
            params![id, body, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(now)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recipient {
    pub uid: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecipientRow {
    pub uid: String,
    pub name: String,
    pub read_at: Option<String>,
    pub nudged_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoRow {
    pub id: String,
    pub title: String,
    pub body: String,
    pub from_uid: String,
    pub from_name: String,
    pub via: String,
    pub created_at: String,
    pub importance: String,
    pub recipients: Vec<RecipientRow>,
}

#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub struct PeerRow {
    pub node_id: String,
    pub name: String,
    pub address: String,
    pub tcp_port: i64,
    pub grade: String,
    pub room: String,
    pub last_seen: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub kind: String,
    pub ref_id: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PollRow {
    pub id: String,
    pub question: String,
    pub options: Vec<String>,
    pub closed: bool,
    pub counts: Vec<i64>,
    pub mine: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TemplateRow {
    pub id: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScheduledRow {
    pub id: String,
    pub title: String,
    pub body: String,
    pub to_json: String,
    pub run_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventRow {
    pub id: String,
    pub title: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrgNode {
    pub id: String,
    pub dept: String,
    pub grade: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestRow {
    pub pin: String,
    pub name: String,
    pub expires_at: String,
    pub used: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct HandoverRow {
    pub id: String,
    pub body: String,
    pub from_name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InboxRow {
    pub id: String,
    pub title: String,
    pub body: String,
    pub from_name: String,
    pub state: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HwptplRow {
    pub id: String,
    pub title: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScratchRow {
    pub id: String,
    pub body: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommentRow {
    pub id: String,
    pub body: String,
    pub from_uid: String,
    pub from_name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuickRow {
    pub id: String,
    pub body: String,
    pub mine: bool,
    pub created_at: String,
}
