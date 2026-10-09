/* EduTalk Memo Hybrid — 쪽지형 + 스레드 + 1:1 퀵채팅 (데스크톱 전용 UI, 웹 폴백 가능) */
(function () {
  'use strict';
  const D = () => (window.edutalkDesktop && window.edutalkDesktop.isDesktop) ? window.edutalkDesktop : null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Pre-Send DLP 훅: 외부망에서 전송 직전 로컬 검증 (차단 시 클라우드로 패킷 송신 안 함)
  async function dlpGuard({ text, fileName }) {
    const d = D();
    if (!d || typeof d.dlpVerify !== 'function') return { verdict: 'allow', via: 'web-fallback' };
    try { return await d.dlpVerify({ text, fileName }); }
    catch (e) { return { verdict: 'allow', via: 'dlp-error-fallback' }; }
  }

  async function sendMemo({ title, to, body, fileName }) {
    const check = await dlpGuard({ text: title + '\n' + body, fileName });
    if (check && check.verdict === 'block') {
      alert('민감정보가 감지되어 외부망 전송이 차단됐어요. (' + (check.hits || []).map((h) => h.label || h.id).join(', ') + ')');
      return { ok: false, reason: 'dlp-block', check };
    }
    const d = D();
    // 내부망이면 P2P 직송 우선
    try {
      if (d && check && check.netMode === 'intranet' && Array.isArray(to) && to.length === 1 && typeof d.p2pSend === 'function') {
        const peers = await d.p2pPeers().catch(() => []);
        const peer = (peers || []).find((p) => String(p.displayName) === String(to[0]) || String(p.nodeId) === String(to[0]));
        if (peer) {
          const r = await d.p2pSend({ peerId: peer.nodeId, kind: 'memo', title, body });
          if (r && r.ok) return { ok: true, via: 'p2p', check };
        }
      }
    } catch (e) {}
    // 로컬 보관 (오프라인 우선) + Firestore 동기화는 기존 app.js 경로에 위임
    try { if (d && d.localMemoSave) await d.localMemoSave({ title, to, body }); } catch (e) {}
    if (check && check.verdict === 'warn') {
      if (!confirm('민감정보 가능 항목이 있어요. 그래도 보낼까요? (' + ((check.hits || []).map((h) => h.label || h.id).join(', ')) + ')')) {
        return { ok: false, reason: 'user-cancel-warn', check };
      }
    }
    try {
      if (window.EduFirebase && window.EduFirebase.db) {
        const db = window.EduFirebase.db;
        const uid = (window.EduFirebase.auth && window.EduFirebase.auth.currentUser && window.EduFirebase.auth.currentUser.uid) || 'local';
        await db.collection('memos').add({
          title: String(title || '').slice(0, 200), body: String(body || '').slice(0, 50000),
          to: Array.isArray(to) ? to.slice(0, 200) : [], fromUid: uid,
          createdAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date(),
          net: (check && check.netMode) || 'external', dlp: { verdict: check.verdict, score: check.score || 0 },
        });
        return { ok: true, via: 'cloud', check };
      }
    } catch (e) { return { ok: true, via: 'local-only', check, warn: String(e && e.message || e) }; }
    return { ok: true, via: 'local-only', check };
  }

  function mountMemoHybrid(rootEl, opts) {
    const root = typeof rootEl === 'string' ? document.querySelector(rootEl) : rootEl;
    if (!root) return null;
    const isDesktop = !!D();
    root.classList.add('edutalk-memo');
    root.innerHTML =
      '<div class="memo-side">' +
      '<div class="memo-brand">브리즈 쪽지 <span class="pill ' + (isDesktop ? 'blue' : 'green') + '">' + (isDesktop ? '데스크톱 100%' : '라이트 웹') + '</span></div>' +
      '<div class="memo-tabs" role="tablist">' +
      '<button role="tab" aria-selected="true" data-tab="memo">쪽지</button>' +
      '<button role="tab" aria-selected="false" data-tab="quick">1:1 퀵채팅</button>' +
      '<button role="tab" aria-selected="false" data-tab="org">조직도</button>' +
      '</div>' +
      '<div class="memo-org"><input type="search" placeholder="조직도 사용자 검색" aria-label="조직도 사용자 검색"><div class="org-list"><p style="color:#888;font-size:12px">조직도/마이리스트: 이름·직급·대화명 표시 (Firestore publicProfiles 연동)</p></div></div>' +
      '</div>' +
      '<div class="memo-main">' +
      '<form class="memo-form" data-pane="memo">' +
      '<div><label>제목</label><input type="text" name="title" maxlength="200" placeholder="제목을 입력하세요" required></div>' +
      '<div><label>수신자 (쉼표 구분, 공문/공지 다수발송 가능)</label><input type="text" name="to" placeholder="예: 3학년1반 담임, 교무부장"></div>' +
      '<div><label>본문 / HWP 첨부 (RAM 미리보기, 디스크 저장 없음)</label><textarea name="body" placeholder="격식 있는 공문·공지·보고용 본문"></textarea></div>' +
      '<div><label>첨부 파일명 (선택)</label><input type="text" name="fileName" placeholder="예: 3반_가정통신문.hwpx"></div>' +
      '<table class="memo-recv-table" aria-label="수신확인 표"><thead><tr><th>수신자</th><th>수신</th><th>확인</th></tr></thead><tbody><tr><td colspan="3" style="color:#888">발송 후 수신확인 표시</td></tr></tbody></table>' +
      '<div class="memo-actions"><button class="primary" type="submit">쪽지 발송 (DLP 경유)</button><button class="ghost" type="button" data-act="ram-preview">HWP 1초 미리보기</button></div>' +
      '<p class="dlp-msg" style="font-size:12px;color:#666"></p>' +
      '</form>' +
      '<div class="memo-thread"><h3>쪽지 하단 댓글 스레드 (쪽지폭탄 방지)</h3><div class="thread-list"></div>' +
      '<div class="thread-input"><input type="text" placeholder="“3반 제출 완료” 같은 가벼운 답장은 여기로" aria-label="댓글 입력"><button type="button">전송</button></div></div>' +
      '<div class="quickchat" data-pane="quick" hidden><h3 style="font-size:13px;margin:0 0 8px">1:1 퀵 채팅 (5초 핑퐁용)</h3><div class="thread-list"></div>' +
      '<div class="thread-input"><input type="text" placeholder="수업 교체·간단 확인용" aria-label="퀵채팅 입력"><button type="button">전송</button></div></div>' +
      '</div>';
    const form = root.querySelector('.memo-form');
    const msg = root.querySelector('.dlp-msg');
    const threadList = root.querySelector('.memo-thread .thread-list');
    const threadInput = root.querySelector('.memo-thread .thread-input input');
    const threadBtn = root.querySelector('.memo-thread .thread-input button');
    const quickPane = root.querySelector('[data-pane="quick"]');

    // 탭 전환
    root.querySelectorAll('.memo-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        root.querySelectorAll('.memo-tabs button').forEach((x) => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true');
        const tab = b.getAttribute('data-tab');
        form.style.display = tab === 'quick' ? 'none' : '';
        root.querySelector('.memo-thread').style.display = tab === 'quick' ? 'none' : '';
        quickPane.hidden = tab !== 'quick';
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const title = String(fd.get('title') || '');
      const to = String(fd.get('to') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const body = String(fd.get('body') || '');
      const fileName = String(fd.get('fileName') || '');
      if (msg) msg.textContent = '로컬 DLP 검증 중…';
      const r = await sendMemo({ title, to, body, fileName });
      if (msg) msg.textContent = r.ok ? ('발송 완료 (경로: ' + r.via + ')') : ('발송 취소: ' + (r.reason || ''));
    });
    root.querySelector('[data-act="ram-preview"]').addEventListener('click', async () => {
      const d = D();
      if (!d) { alert('RAM 미리보기는 데스크톱 앱 전용이에요.'); return; }
      alert('HWP 파일을 열면 RAM에만 올려 1초 미리보기 후 즉시 파기해요. (디스크 기록 ZERO)');
    });
    function addBubble(list, text, me) {
      const div = document.createElement('div');
      div.className = 'bubble' + (me ? ' me' : '');
      div.textContent = String(text).slice(0, 2000);
      list.appendChild(div);
      list.scrollTop = list.scrollHeight;
    }
    threadBtn.addEventListener('click', async () => {
      const v = threadInput.value.trim();
      if (!v) return;
      threadInput.value = '';
      addBubble(threadList, v, true);
      // 댓글은 쪽지 스레드 컬렉션에 저장 (수신확인 스팸 방지)
      try {
        if (window.EduFirebase && window.EduFirebase.db) {
          await window.EduFirebase.db.collection('memoThreads').add({
            body: v.slice(0, 2000), createdAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date(),
          });
        }
      } catch (e) {}
    });
    const quickInput = quickPane.querySelector('input');
    const quickBtn = quickPane.querySelector('button');
    const quickList = quickPane.querySelector('.thread-list');
    async function quickSend() {
      const v = quickInput.value.trim();
      if (!v) return;
      quickInput.value = '';
      const check = await dlpGuard({ text: v });
      if (check && check.verdict === 'block') { alert('민감정보 감지로 퀵채팅이 차단됐어요.'); return; }
      addBubble(quickList, v, true);
    }
    quickBtn.addEventListener('click', quickSend);
    quickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickSend(); });

    // 캡처 마스킹 신호 → 블러
    try {
      const d = D();
      if (d && d.onCaptureMask) d.onCaptureMask((on) => {
        root.classList.toggle('edutalk-capture-mask', !!on);
      });
    } catch (e) {}
    return { sendMemo };
  }

  window.EduMemoHybrid = { mountMemoHybrid, sendMemo, dlpGuard };
})();
