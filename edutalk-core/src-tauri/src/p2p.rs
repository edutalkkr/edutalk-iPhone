//! 교내망 직접 연결 (서버 없음)
//! - mDNS로 같은 망의 교사 PC를 찾는다.
//! - mDNS가 막힌 망에서는 UDP 방송으로 보완한다.
//! - 쪽지·파일은 TCP로 1:1 직접 보낸다.

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream, UdpSocket};

pub const SERVICE_TYPE: &str = "_edutalk._tcp.local.";
pub const UDP_PORT: u16 = 47801;
pub const TCP_PORT: u16 = 47802;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub node_id: String,
    pub name: String,
    pub address: String,
    pub tcp_port: u16,
    pub grade: String,
    pub room: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectFrame {
    pub kind: String, // memo | comment | quick | read | nudge | substitute(-accept|-reject) | remote-view-*
    pub from: String,
    pub from_name: String,
    pub title: String,
    pub body: String,
    pub ref_id: String,
}

type PeerMap = Arc<Mutex<HashMap<String, (PeerInfo, std::time::Instant)>>>;
type InboxTx = tokio::sync::mpsc::UnboundedSender<DirectFrame>;

/// 한 줄 최대 2MB까지만 읽는다 (망가진 상대가 메모리를 터뜨리지 못하게)
const MAX_LINE_BYTES: u64 = 2 * 1024 * 1024;
/// 60초 못 본 PC는 목록에서 뺀다
const PEER_TTL: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Clone)]
pub struct P2p {
    pub node_id: String,
    pub name: String,
    peers: PeerMap,
    inbox_tx: InboxTx,
}

impl P2p {
    pub fn new(node_id: String, name: String, inbox_tx: InboxTx) -> Self {
        Self {
            node_id,
            name,
            peers: Arc::new(Mutex::new(HashMap::new())),
            inbox_tx,
        }
    }

    pub fn peers(&self) -> Vec<PeerInfo> {
        let mut guard = match self.peers.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        guard.retain(|_, (_, seen)| seen.elapsed() < PEER_TTL);
        guard.values().map(|(p, _)| p.clone()).collect()
    }

    fn note_peer(&self, p: PeerInfo) {
        if p.node_id == self.node_id {
            return;
        }
        if let Ok(mut m) = self.peers.lock() {
            // 목록이 너무 커지지 않게 상한을 둔다
            if m.len() > 500 {
                m.clear();
            }
            m.insert(p.node_id.clone(), (p, std::time::Instant::now()));
        }
    }

    /// 탐색 시작: mDNS 등록·찾기 + UDP 방송 + TCP 수신
    pub fn start(&self) {
        self.start_mdns();
        self.start_udp_beacon();
        self.start_tcp_server();
    }

    fn start_mdns(&self) {
        let node_id = self.node_id.clone();
        let this = self.clone();
        std::thread::spawn(move || {
            let daemon = match ServiceDaemon::new() {
                Ok(d) => d,
                Err(_) => return,
            };
            let host = format!("{node_id}.local.");
            // 이 PC 알리기
            if let Ok(info) = ServiceInfo::new(SERVICE_TYPE, &node_id, &host, "0.0.0.0", TCP_PORT, None) {
                let _ = daemon.register(info);
            }
            // 남 찾기
            let found = match daemon.browse(SERVICE_TYPE) {
                Ok(r) => r,
                Err(_) => return,
            };
            while let Ok(ev) = found.recv() {
                if let ServiceEvent::ServiceResolved(info) = ev {
                    // 이름은 UDP 방송에서 채운다. 여기서는 주소만 확정한다.
                    let id = info.get_fullname().split('.').next().unwrap_or("").to_string();
                    for ip in info.get_addresses() {
                        if ip.is_ipv4() {
                            this.note_peer(PeerInfo {
                                node_id: id.clone(),
                                name: id.clone(),
                                address: ip.to_string(),
                                tcp_port: info.get_port(),
                                grade: String::new(),
                                room: String::new(),
                            });
                            break;
                        }
                    }
                }
            }
        });
    }

    fn start_udp_beacon(&self) {
        let node_id = self.node_id.clone();
        let name = self.name.clone();
        let this = self.clone();
        tokio::spawn(async move {
            let sock = match UdpSocket::bind(("0.0.0.0", UDP_PORT)).await {
                Ok(s) => std::sync::Arc::new(s),
                Err(_) => return,
            };
            let _ = sock.set_broadcast(true);
            // 알리기 (5초마다)
            let hello = sock.clone();
            let hello_id = node_id.clone();
            let hello_name = name.clone();
            tokio::spawn(async move {
                let msg = serde_json::json!({
                    "kind": "edutalk-hello",
                    "node_id": hello_id,
                    "name": hello_name,
                    "tcp_port": TCP_PORT,
                });
                let buf = msg.to_string();
                loop {
                    let _ = hello.send_to(buf.as_bytes(), ("255.255.255.255", UDP_PORT)).await;
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            });
            // 듣기
            let mut buf = [0u8; 2048];
            loop {
                let (n, from) = match sock.recv_from(&mut buf).await {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let v: serde_json::Value = match serde_json::from_slice(&buf[..n]) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if v.get("kind").and_then(|k| k.as_str()) != Some("edutalk-hello") {
                    continue;
                }
                let id = v.get("node_id").and_then(|s| s.as_str()).unwrap_or("").to_string();
                if id.is_empty() {
                    continue;
                }
                this.note_peer(PeerInfo {
                    node_id: id,
                    name: v.get("name").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                    address: from.ip().to_string(),
                    tcp_port: v.get("tcp_port").and_then(|p| p.as_u64()).unwrap_or(TCP_PORT as u64) as u16,
                    grade: String::new(),
                    room: String::new(),
                });
            }
        });
    }

    fn start_tcp_server(&self) {
        let inbox = self.inbox_tx.clone();
        tokio::spawn(async move {
            let listener = match TcpListener::bind(("0.0.0.0", TCP_PORT)).await {
                Ok(l) => l,
                Err(_) => return,
            };
            loop {
                let (stream, _) = match listener.accept().await {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let tx = inbox.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncBufReadExt;
                    let mut reader = tokio::io::BufReader::new(stream);
                    // 줄 단위로 읽고 한 줄 2MB가 넘으면 끊는다
                    // (예전 take()는 스트림 전체를 2MB로 재서 두 번째 그림부터 잘랐다)
                    let mut buf = Vec::new();
                    loop {
                        buf.clear();
                        match reader.read_until(b'\n', &mut buf).await {
                            Ok(0) => break,
                            Ok(_) => {
                                if buf.len() as u64 > MAX_LINE_BYTES {
                                    break;
                                }
                                if let Ok(frame) = serde_json::from_slice::<DirectFrame>(&buf) {
                                    let _ = tx.send(frame);
                                }
                            }
                            Err(_) => break,
                        }
                    }
                });
            }
        });
    }

    /// 1:1 직접 보내기 (줄바꿈 구분 JSON 한 줄, 본문 줄바꿈은 JSON이 감싼다)
    /// 응답 없는 PC에 화면이 멈추지 않게 연결 5초·쓰기 10초 상한을 둔다.
    pub async fn send_direct(&self, peer: &PeerInfo, frame: DirectFrame) -> Result<(), String> {
        let addr = (peer.address.as_str(), peer.tcp_port);
        let mut stream = tokio::time::timeout(std::time::Duration::from_secs(5), TcpStream::connect(addr))
            .await
            .map_err(|_| "상대 PC 응답이 없어요.".to_string())?
            .map_err(|e| e.to_string())?;
        let mut line = serde_json::to_string(&frame).map_err(|e| e.to_string())?;
        line.push('\n');
        tokio::time::timeout(std::time::Duration::from_secs(10), stream.write_all(line.as_bytes()))
            .await
            .map_err(|_| "보내다가 끊겼어요.".to_string())?
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
