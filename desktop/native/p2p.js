'use strict';
/**
 * EduTalk Desktop Native — Serverless P2P (방송실 물리서버 0대)
 *  - 교내 랜선 연결 시 mDNS/UDP 브로드캐스트로 피어 탐색
 *  - 1:1 직통 TCP 소켓 형성 (파일/쪽지는 P2P 우선, 실패 시 클라우드 폴백)
 *  - 데스크톱 전용 (웹/Lite는 사용 불가)
 */

const dgram = require('dgram');
const net = require('net');
const os = require('os');
const crypto = require('crypto');

const P2P_UDP_PORT = Number(process.env.EDUTALK_P2P_PORT || 47777);
const P2P_TCP_PORT = Number(process.env.EDUTALK_P2P_TCP || 47778);
const PEER_TTL_MS = 45000;

function lanIPs() {
  const out = [];
  try {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const ni of ifs[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal && !String(ni.address).startsWith('169.254.')) {
          out.push({ iface: name, address: ni.address });
        }
      }
    }
  } catch (e) {}
  return out;
}

class P2PMesh {
  constructor({ nodeId, displayName, onPeer, onMessage }) {
    this.nodeId = nodeId || ('pc-' + crypto.randomBytes(4).toString('hex'));
    this.displayName = displayName || this.nodeId;
    this.onPeer = typeof onPeer === 'function' ? onPeer : null;
    this.onMessage = typeof onMessage === 'function' ? onMessage : null;
    this.peers = new Map(); // nodeId -> {nodeId, displayName, address, tcpPort, seenAt}
    this.udp = null;
    this.tcp = null;
    this.helloTimer = null;
    this.sweepTimer = null;
  }

  start() {
    try {
      this.udp = dgram.createSocket('udp4');
      this.udp.on('error', () => {});
      this.udp.on('message', (buf, rinfo) => {
        try {
          const msg = JSON.parse(buf.toString('utf8'));
          if (!msg || msg.kind !== 'edutalk-hello' || !msg.nodeId || msg.nodeId === this.nodeId) return;
          this.peers.set(msg.nodeId, {
            nodeId: msg.nodeId, displayName: String(msg.displayName || msg.nodeId).slice(0, 40),
            address: rinfo.address, tcpPort: Number(msg.tcpPort || P2P_TCP_PORT),
            seenAt: Date.now(),
          });
          if (this.onPeer) { try { this.onPeer(this.list()); } catch (e) {} }
        } catch (e) {}
      });
      this.udp.bind(P2P_UDP_PORT, () => {
        try { this.udp.setBroadcast(true); } catch (e) {}
      });
    } catch (e) { this.udp = null; }

    try {
      this.tcp = net.createServer((socket) => {
        let acc = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
          acc += chunk;
          if (acc.length > 2 * 1024 * 1024) { try { socket.destroy(); } catch (e) {} return; }
          // NDJSON 1줄 = 1프레임
          let idx;
          while ((idx = acc.indexOf('\n')) >= 0) {
            const line = acc.slice(0, idx); acc = acc.slice(idx + 1);
            if (!line.trim()) continue;
            try {
              const frame = JSON.parse(line);
              if (this.onMessage) { try { this.onMessage(frame, socket); } catch (e) {} }
            } catch (e) {}
          }
        });
      });
      this.tcp.on('error', () => {});
      this.tcp.listen(P2P_TCP_PORT, '0.0.0.0');
    } catch (e) { this.tcp = null; }

    const hello = () => {
      if (!this.udp) return;
      try {
        const payload = Buffer.from(JSON.stringify({
          kind: 'edutalk-hello', nodeId: this.nodeId,
          displayName: this.displayName, tcpPort: P2P_TCP_PORT, v: 1,
        }), 'utf8');
        this.udp.setBroadcast(true);
        this.udp.send(payload, P2P_UDP_PORT, '255.255.255.255', () => {});
        for (const ip of lanIPs()) {
          try {
            const base = ip.address.split('.').slice(0, 3).join('.');
            this.udp.send(payload, P2P_UDP_PORT, base + '.255', () => {});
          } catch (e) {}
        }
      } catch (e) {}
    };
    hello();
    this.helloTimer = setInterval(hello, 5000);
    if (this.helloTimer && this.helloTimer.unref) this.helloTimer.unref();
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [k, v] of this.peers) {
        if (now - v.seenAt > PEER_TTL_MS) { this.peers.delete(k); changed = true; }
      }
      if (changed && this.onPeer) { try { this.onPeer(this.list()); } catch (e) {} }
    }, 10000);
    if (this.sweepTimer && this.sweepTimer.unref) this.sweepTimer.unref();
  }

  list() { return Array.from(this.peers.values()); }

  // 1:1 직송 (실패 시 throw → 호출자가 클라우드 폴백)
  sendDirect(peerNodeId, frame, timeoutMs) {
    const peer = this.peers.get(peerNodeId);
    if (!peer) return Promise.reject(new Error('peer-not-found'));
    return new Promise((resolve, reject) => {
      const s = net.connect({ host: peer.address, port: peer.tcpPort, timeout: timeoutMs || 4000 }, () => {
        try {
          s.write(JSON.stringify({ from: this.nodeId, ...frame }) + '\n', 'utf8', () => {
            try { s.end(); } catch (e) {}
            resolve(true);
          });
        } catch (e) { try { s.destroy(); } catch (_) {} reject(e); }
      });
      s.on('timeout', () => { try { s.destroy(new Error('timeout')); } catch (e) {} reject(new Error('timeout')); });
      s.on('error', reject);
    });
  }

  stop() {
    try { clearInterval(this.helloTimer); } catch (e) {}
    try { clearInterval(this.sweepTimer); } catch (e) {}
    try { if (this.udp) this.udp.close(); } catch (e) {}
    try { if (this.tcp) this.tcp.close(); } catch (e) {}
    this.udp = null; this.tcp = null;
  }
}

module.exports = { P2P_UDP_PORT, P2P_TCP_PORT, lanIPs, P2PMesh };
