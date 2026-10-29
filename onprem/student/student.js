/* 브리즈 학생 웹 (온프레미스)
 * - 같은 학교 서버의 /api/notes 를 교사 앱과 공유한다.
 * - 로그인한 학생은 선생님에게만 쪽지를 보낼 수 있고, 교사 앱에는 memo-arrived 로 실시간 알림이 간다.
 * - 외부 CDN/폰트/추적 없이 self-host 만 사용한다.
 */
(() => {
  'use strict';

  const TOKEN_KEY = 'breeze.student.token';
  const $ = (id) => document.getElementById(id);
  const state = {
    token: '',
    user: null,
    school: null,
    teachers: [],
    inbox: [],
    sent: [],
    selectedId: null,
    socket: null,
    pollTimer: null,
    refreshTimer: null,
    toastTimer: null,
    refreshing: false,
    lastAutoRead: 0,
    pendingFile: null,
    uploadedFileId: 0,
    pendingSend: null,
    mediaDays: 30,
  };

  const MEDIA_WARN_KEY = 'breeze.student.mediaWarnHidden';
  const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

  /* ---------- 공통 ---------- */
  const el = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  };

  const statusLabel = (s) => {
    const v = String(s || '').toUpperCase();
    if (v === 'ONLINE') return '온라인';
    if (v === 'IN_CLASS') return '수업 중';
    if (v === 'TRIP') return '외출/출장';
    if (v === 'AWAY') return '자리 비움';
    return '오프라인';
  };
  const statusClass = (s) => String(s || '').toLowerCase().replace(/[^a-z_]/g, '') || 'offline';

  const fmtDate = (s) => {
    try {
      const d = new Date(String(s || '').replace(' ', 'T'));
      if (Number.isNaN(d.getTime())) return String(s || '');
      const p = (n) => String(n).padStart(2, '0');
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      return sameDay
        ? `${p(d.getHours())}:${p(d.getMinutes())}`
        : `${d.getMonth() + 1}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch { return String(s || ''); }
  };

  const toast = (message, kind = '') => {
    const t = $('toast');
    if (!t) return;
    const text = String(message || '');
    const duration = Math.max(3200, Math.min(6500, 2200 + Array.from(text).length * 28));
    // 같은 토스트가 연달아 떠도 진행 막대가 처음부터 다시 줄어들도록 초기화한다.
    t.className = 'toast';
    t.textContent = text;
    t.style.setProperty('--toast-ms', `${duration}ms`);
    void t.offsetWidth;
    t.className = `toast show ${kind}`.trim();
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => { t.className = 'toast'; }, duration);
  };

  const setConn = (on, label) => {
    const n = $('connState');
    if (!n) return;
    n.classList.toggle('on', !!on);
    const span = n.querySelector('span');
    if (span) span.textContent = label || (on ? '연결됨' : '오프라인');
  };

  const showLoginError = (message) => {
    const n = $('loginError');
    if (!n) return;
    if (!message) { n.hidden = true; n.textContent = ''; return; }
    n.textContent = message;
    n.hidden = false;
  };

  const setLoginBusy = (busy) => {
    const btn = $('loginBtn');
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? '로그인 중…' : '로그인';
  };

  const setComposeBusy = (busy) => {
    const btn = $('sendBtn');
    if (btn) {
      btn.disabled = busy;
      btn.textContent = busy ? '보내는 중…' : '보내기';
    }
    const attach = $('attachBtn');
    if (attach) attach.disabled = busy;
  };

  /* ---------- 사진·파일 첨부 ---------- */
  const formatBytes = (n) => {
    const v = Number(n) || 0;
    if (v < 1024) return `${v}B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)}KB`;
    return `${(v / (1024 * 1024)).toFixed(1)}MB`;
  };
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const mediaWarnHiddenToday = () => {
    try { return localStorage.getItem(MEDIA_WARN_KEY) === todayKey(); } catch { return false; }
  };
  const hideMediaWarnToday = () => {
    try { localStorage.setItem(MEDIA_WARN_KEY, todayKey()); } catch { /* 저장소 차단 */ }
  };
  const updateMediaDaysText = () => {
    const days = Math.max(1, Number(state.mediaDays) || 30);
    const a = $('composeMediaDays');
    const b = $('mediaWarnDays');
    const c = $('mediaWarnDaysAgain');
    if (a) a.textContent = String(days);
    if (b) b.textContent = String(days);
    if (c) c.textContent = String(days);
  };

  function renderAttachmentChip() {
    const chip = $('attachChip');
    if (!chip) return;
    const f = state.pendingFile;
    if (!f) { chip.hidden = true; return; }
    chip.hidden = false;
    const name = $('attachName');
    const meta = $('attachMeta');
    if (name) name.textContent = f.name || '파일';
    if (meta) meta.textContent = `${formatBytes(f.size)} · 전송 후 ${state.mediaDays}일 뒤 자동 삭제`;
  }

  function setPendingFile(file) {
    if (!file) {
      state.pendingFile = null;
      state.uploadedFileId = 0;
      renderAttachmentChip();
      return;
    }
    if (file.size > MEDIA_MAX_BYTES) {
      toast('파일은 100MB까지 올릴 수 있어요.', 'error');
      return;
    }
    if (!file.size) {
      toast('빈 파일은 보낼 수 없어요.', 'error');
      return;
    }
    state.pendingFile = file;
    state.uploadedFileId = 0;
    renderAttachmentChip();
  }

  /* XHR을 쓰는 이유: 큰 사진·동영상도 전송 진행률을 보여 주기 위해서. */
  function uploadStudentMedia(file, onProgress) {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/student/media', true);
        xhr.setRequestHeader('Accept', 'application/json');
        if (state.token) xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable || typeof onProgress !== 'function') return;
          onProgress(Math.max(1, Math.min(99, Math.round((e.loaded / e.total) * 100))));
        };
        xhr.onerror = () => resolve({ ok: false, status: 0, data: { ok: false, error: '파일을 올리지 못했어요. 네트워크를 확인해 주세요.' } });
        xhr.onabort = () => resolve({ ok: false, status: 0, data: { ok: false, error: '파일 전송을 취소했어요.' } });
        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* JSON 아님 */ }
          resolve({ ok: xhr.status >= 200 && xhr.status < 300 && data.ok !== false, status: xhr.status, data });
        };
        const form = new FormData();
        form.append('file', file, file.name || '파일');
        xhr.send(form);
      } catch {
        resolve({ ok: false, status: 0, data: { ok: false, error: '파일을 올리지 못했어요.' } });
      }
    });
  }

  function downloadFile(fileId, fileName, btn) {
    if (!fileId) return;
    if (btn) { btn.disabled = true; btn.textContent = '받는 중…'; }
    fetch(`/api/files/${encodeURIComponent(fileId)}`, {
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
      credentials: 'same-origin',
    }).then(async (res) => {
      if (!res.ok) {
        let msg = '파일을 내려받지 못했어요.';
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* 무시 */ }
        toast(msg, 'error');
        return null;
      }
      return res.blob();
    }).then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || '파일';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    }).catch(() => toast('파일을 내려받지 못했어요.', 'error'))
      .finally(() => { if (btn) { btn.disabled = false; btn.textContent = '내려받기'; } });
  }

  /* ---------- API ---------- */
  async function request(path, opts = {}) {
    const method = opts.method || 'GET';
    const headers = { Accept: 'application/json' };
    const init = { method, headers, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    if (opts.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
    let res;
    try {
      res = await fetch(path, init);
    } catch {
      return { ok: false, status: 0, data: { ok: false, error: '서버에 연결할 수 없어요. 학교 네트워크를 확인해 주세요.' } };
    }
    let data = null;
    try { data = await res.json(); } catch { /* JSON 아닌 응답 */ }
    const payload = (data && typeof data === 'object') ? data : {};
    if (res.status === 401 && opts.auth !== false) {
      clearSession('로그인이 만료됐어요. 다시 로그인해 주세요.');
    }
    return { ok: res.ok && payload.ok !== false, status: res.status, data: payload };
  }

  /* ---------- 세션 ---------- */
  function clearSession(message) {
    disconnectSocket();
    if (state.pollTimer) { window.clearInterval(state.pollTimer); state.pollTimer = null; }
    if (state.refreshTimer) { window.clearTimeout(state.refreshTimer); state.refreshTimer = null; }
    state.token = '';
    state.user = null;
    state.teachers = [];
    state.inbox = [];
    state.sent = [];
    state.selectedId = null;
    state.pendingSend = null;
    state.uploadedFileId = 0;
    state.pendingFile = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* 저장소 차단 */ }
    document.title = '브리즈 학생 — 학교 안에서 안전하게';
    $('appView').hidden = true;
    $('loginView').hidden = false;
    $('password').value = '';
    renderAttachmentChip();
    setLoginBusy(false);
    showLoginError(message || '');
  }

  async function doLogout(message) {
    const token = state.token;
    if (token) {
      state.token = token;
      try { await request('/api/logout', { method: 'POST' }); } catch { /* 무시 */ }
    }
    clearSession(message || '');
    toast('로그아웃했어요.');
  }

  /* ---------- 학교 정보 ---------- */
  async function loadPublicInfo() {
    const res = await request('/api/public-info', { auth: false });
    if (!res.ok || !res.data) return;
    state.school = {
      code: String(res.data.schoolCode || '').trim(),
      name: String(res.data.schoolName || res.data.school || '').trim(),
    };
    state.mediaDays = Math.max(1, Number(res.data.studentMediaDays) || 30);
    updateMediaDaysText();
    const input = $('schoolCode');
    if (input && !input.value.trim() && state.school.code) input.value = state.school.code;
    const hint = $('schoolHint');
    const text = $('schoolHintText');
    const foot = $('schoolCodeFoot');
    if (state.school.code) {
      if (hint) hint.hidden = false;
      if (text) {
        text.textContent = state.school.name
          ? `${state.school.name} · 학교 코드 ${state.school.code}`
          : `학교 코드 ${state.school.code}`;
      }
      if (foot) foot.textContent = state.school.code;
      const top = $('topSchool');
      if (top) top.textContent = state.school.name ? `${state.school.name} · ${state.school.code}` : state.school.code;
    }
  }

  /* ---------- 로그인 ---------- */
  async function onLoginSubmit(ev) {
    ev.preventDefault();
    showLoginError('');
    const schoolCode = $('schoolCode').value.trim();
    const username = $('username').value.trim();
    const password = $('password').value;
    if (!schoolCode) return showLoginError('학교 코드를 입력해 주세요.');
    if (!username) return showLoginError('학번을 입력해 주세요.');
    if (!password) return showLoginError('비밀번호를 입력해 주세요.');

    setLoginBusy(true);
    try {
      const res = await request('/api/login', {
        method: 'POST',
        auth: false,
        body: { username, password, schoolCode },
      });
      if (!res.ok) {
        showLoginError(res.data.error || '학번이나 비밀번호를 확인해 주세요.');
        if (res.status === 403 && res.data.schoolMismatch) {
          const hint = $('schoolHintText');
          if (hint && state.school && state.school.code) hint.textContent = `이 서버의 학교 코드는 '${state.school.code}'예요.`;
        }
        return;
      }
      const user = res.data.user || {};
      if (String(user.role || '').toUpperCase() !== 'STUDENT') {
        // 교사/관리자 토큰이 학생 웹에 남지 않도록 즉시 폐기한다.
        const token = res.data.token;
        if (token) {
          try {
            await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          } catch { /* 무시 */ }
        }
        showLoginError('학생 계정이 아니에요. 선생님은 브리즈코어를 사용해 주세요.');
        return;
      }
      state.token = String(res.data.token || '');
      state.user = user;
      if (!state.token) { showLoginError('로그인 응답이 올바르지 않아요. 서버 관리자에게 문의해 주세요.'); return; }
      try { localStorage.setItem(TOKEN_KEY, state.token); } catch { /* 저장소 차단 */ }
      $('password').value = '';
      await enterApp();
    } catch {
      showLoginError('로그인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function enterApp() {
    $('loginView').hidden = true;
    $('appView').hidden = false;
    showLoginError('');
    const meName = $('meName');
    if (meName) meName.textContent = state.user && state.user.real_name ? state.user.real_name : '학생';
    const top = $('topSchool');
    if (top && state.school) {
      top.textContent = state.school.name ? `${state.school.name} · ${state.school.code}` : state.school.code;
    }
    updateNotifyButton();
    connectSocket();
    await refreshData(true);
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = window.setInterval(() => { void refreshData(true); }, 30000);
  }

  /* ---------- 데이터 ---------- */
  async function refreshData(silent) {
    if (!state.token) return;
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      const [tRes, iRes, sRes] = await Promise.all([
        request('/api/student/teachers'),
        request('/api/notes/inbox?limit=50'),
        request('/api/notes/sent?limit=50'),
      ]);
      if (!state.token) return;
      if (tRes.status === 403) {
        await doLogout('학생 계정 권한을 확인하지 못했어요. 다시 로그인해 주세요.');
        return;
      }
      if (tRes.ok && Array.isArray(tRes.data.teachers)) state.teachers = tRes.data.teachers;
      if (iRes.ok && Array.isArray(iRes.data.notes)) state.inbox = iRes.data.notes;
      if (sRes.ok && Array.isArray(sRes.data.notes)) state.sent = sRes.data.notes;

      if (!state.selectedId && state.teachers.length === 1) selectTeacher(state.teachers[0].id);
      renderTeacherList();
      renderThread(false);
      renderUnreadTitle();
      if (!silent && !tRes.ok && tRes.data.error) toast(tRes.data.error, 'error');
    } finally {
      state.refreshing = false;
    }
  }

  function unreadFrom(teacherId) {
    return state.inbox.filter((n) => Number(n.sender_id) === Number(teacherId) && !Number(n.is_read)).length;
  }

  function renderUnreadTitle() {
    const total = state.inbox.filter((n) => !Number(n.is_read)).length;
    document.title = total > 0 ? `(${total}) 브리즈 학생` : '브리즈 학생 — 학교 안에서 안전하게';
    const count = $('teacherCount');
    if (count) count.textContent = state.teachers.length ? `${state.teachers.length}명` : '';
  }

  function renderTeacherList() {
    const list = $('teacherList');
    if (!list) return;
    const q = String($('teacherSearch').value || '').trim().toLowerCase();
    const teachers = state.teachers.filter((t) => {
      if (!q) return true;
      return String(t.real_name || '').toLowerCase().includes(q)
        || String(t.department_name || '').toLowerCase().includes(q);
    });
    list.replaceChildren();
    if (!teachers.length) {
      const empty = el('div', 'thread-empty', q ? '검색 결과가 없어요.' : '등록된 선생님이 없어요. 학교 관리자에게 문의해 주세요.');
      list.appendChild(empty);
      return;
    }
    for (const t of teachers) {
      const id = Number(t.id);
      const btn = el('button', 'teacher-item');
      btn.type = 'button';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(Number(state.selectedId) === id));
      btn.dataset.id = String(id);
      if (Number(state.selectedId) === id) btn.classList.add('selected');
      const unread = unreadFrom(id);
      btn.appendChild(el('span', 'avatar', String(t.real_name || '?').slice(0, 1)));
      const info = el('span', 'teacher-info');
      info.appendChild(el('strong', '', t.real_name || '선생님'));
      const meta = el('span', '');
      meta.appendChild(el('i', `status-dot ${statusClass(t.status)}`));
      meta.appendChild(el('span', '', `${t.department_name || '부서 없음'} · ${statusLabel(t.status)}`));
      info.appendChild(meta);
      btn.appendChild(info);
      if (unread > 0) btn.appendChild(el('span', 'unread', unread > 99 ? '99+' : String(unread)));
      btn.addEventListener('click', () => selectTeacher(id));
      list.appendChild(btn);
    }
  }

  function threadNotes(teacherId) {
    const tid = Number(teacherId);
    const incoming = state.inbox
      .filter((n) => Number(n.sender_id) === tid)
      .map((n) => ({ ...n, _dir: 'in' }));
    const outgoing = state.sent
      .filter((n) => Array.isArray(n.recipients) && n.recipients.some((r) => Number(r.id) === tid))
      .map((n) => ({ ...n, _dir: 'out' }));
    return [...incoming, ...outgoing].sort((a, b) => Number(a.id) - Number(b.id));
  }

  function renderThread(forceScroll) {
    const id = Number(state.selectedId || 0);
    const teacher = state.teachers.find((t) => Number(t.id) === id);
    const empty = $('emptyThread');
    const view = $('threadView');
    if (!teacher) {
      if (empty) empty.hidden = false;
      if (view) view.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (view) view.hidden = false;
    $('threadName').textContent = teacher.real_name || '선생님';
    $('threadMeta').textContent = `${teacher.department_name || '부서 없음'} · ${statusLabel(teacher.status)}`;
    $('threadAvatar').textContent = String(teacher.real_name || '?').slice(0, 1);
    $('composeTo').textContent = teacher.real_name || '선생님';
    const title = $('noteTitle');
    if (title && !title.value.trim()) title.value = '질문';

    const list = $('messageList');
    if (!list) return;
    const messages = threadNotes(id);
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.replaceChildren();
    if (!messages.length) {
      list.appendChild(el('div', 'thread-empty', '아직 주고받은 쪽지가 없어요.\n아래에서 첫 쪽지를 보내 보세요.'));
    } else {
      for (const n of messages) {
        const row = el('article', `msg ${n._dir === 'in' ? 'in' : 'out'}`);
        const card = el('div', 'msg-card');
        const meta = el('div', 'msg-meta');
        meta.appendChild(el('span', 'who', n._dir === 'in' ? `${teacher.real_name || '선생님'} 선생님` : '나'));
        meta.appendChild(el('span', '', '·'));
        meta.appendChild(el('span', '', fmtDate(n.created_at)));
        if (n._dir === 'out') {
          const mine = Array.isArray(n.recipients) ? n.recipients.find((r) => Number(r.id) === id) : null;
          const read = mine && (Number(mine.is_read) || mine.read_at);
          meta.appendChild(el('span', 'read', read ? '읽음' : '전송됨'));
        }
        card.appendChild(meta);
        card.appendChild(el('h3', 'msg-title', n.title || '(제목 없음)'));
        card.appendChild(el('pre', 'msg-body', n.content || ''));
        if (n.file_id) {
          const box = el('div', 'msg-file');
          box.appendChild(el('span', 'file-ico', '📎'));
          const info = el('span', 'file-info');
          info.appendChild(el('b', '', n.file_name || '첨부 파일'));
          const exp = n.file_expires_at ? ` · ${String(n.file_expires_at).slice(0, 10)}까지 보관` : '';
          info.appendChild(el('small', '', `${formatBytes(n.file_size)}${exp}`));
          box.appendChild(info);
          const dl = el('button', '', '내려받기');
          dl.type = 'button';
          dl.addEventListener('click', () => downloadFile(n.file_id, n.file_name, dl));
          box.appendChild(dl);
          card.appendChild(box);
        }
        row.appendChild(card);
        list.appendChild(row);
      }
    }
    if (forceScroll || atBottom) {
      window.requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }
  }

  async function selectTeacher(id) {
    state.selectedId = Number(id);
    renderTeacherList();
    renderThread(true);
    closeSidebar();
    // 이 선생님이 보낸 안 읽은 쪽지를 읽음 처리한다 (교사 앱에 읽음 표시가 간다).
    const unread = state.inbox.filter((n) => Number(n.sender_id) === Number(id) && !Number(n.is_read));
    if (!unread.length) return;
    const results = await Promise.all(unread.map((n) => request(`/api/notes/${n.id}/read`, { method: 'PATCH' })));
    if (!state.token) return;
    let changed = false;
    unread.forEach((n, i) => {
      if (results[i] && results[i].ok) {
        n.is_read = 1;
        n.read_at = results[i].data.readAt || n.read_at;
        changed = true;
      }
    });
    if (changed) {
      renderTeacherList();
      renderUnreadTitle();
    }
  }

  /* ---------- 쪽지 보내기 ---------- */
  function openMediaWarning(payload) {
    state.pendingSend = payload;
    updateMediaDaysText();
    const hide = $('mediaHideToday');
    if (hide) hide.checked = false;
    const dlg = $('mediaWarnDialog');
    if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
    else void sendPendingNote(true);
  }

  async function onComposeSubmit(ev) {
    ev.preventDefault();
    const id = Number(state.selectedId || 0);
    const teacher = state.teachers.find((t) => Number(t.id) === id);
    if (!teacher) return toast('먼저 선생님을 선택해 주세요.', 'error');
    const titleInput = $('noteTitle');
    const bodyInput = $('noteBody');
    const title = String(titleInput.value || '').trim() || '질문';
    const content = String(bodyInput.value || '').trim();
    if (!content && !state.pendingFile) {
      toast('쪽지 내용을 입력하거나 사진·파일을 골라 주세요.', 'error');
      bodyInput.focus();
      return;
    }
    if (title.length > 200) return toast('제목이 너무 길어요.', 'error');
    if (content.length > 20000) return toast('내용이 너무 길어요.', 'error');

    const payload = { teacherId: id, title, content };
    /* 파일을 처음 보내는 학생에게만, 전송 직전 한 번 안내한다. */
    if (state.pendingFile && !mediaWarnHiddenToday()) {
      openMediaWarning(payload);
      return;
    }
    await sendPendingNote(true, payload);
  }

  async function sendPendingNote(skipWarning, preset) {
    const id = Number((preset && preset.teacherId) || state.selectedId || 0);
    const teacher = state.teachers.find((t) => Number(t.id) === id);
    if (!teacher) return toast('먼저 선생님을 선택해 주세요.', 'error');
    const titleInput = $('noteTitle');
    const bodyInput = $('noteBody');
    const title = String((preset && preset.title) || titleInput.value || '').trim() || '질문';
    const content = String((preset && preset.content) || bodyInput.value || '').trim();
    if (!content && !state.pendingFile) return toast('쪽지 내용을 입력하거나 사진·파일을 골라 주세요.', 'error');
    if (!skipWarning && state.pendingFile && !mediaWarnHiddenToday()) {
      openMediaWarning({ teacherId: id, title, content });
      return;
    }

    setComposeBusy(true);
    try {
      let fileId = Number(state.uploadedFileId) || 0;
      if (state.pendingFile && !fileId) {
        const progress = $('attachMeta');
        if (progress) progress.textContent = '올리는 중… 0%';
        const up = await uploadStudentMedia(state.pendingFile, (pct) => {
          if (progress) progress.textContent = `올리는 중… ${pct}%`;
        });
        if (!state.token) return;
        if (!up.ok || !up.data || !up.data.fileId) {
          if (progress) progress.textContent = `${formatBytes(state.pendingFile.size)} · 전송 후 ${state.mediaDays}일 뒤 자동 삭제`;
          toast((up.data && up.data.error) || '파일을 올리지 못했어요.', 'error');
          return;
        }
        fileId = Number(up.data.fileId);
        state.uploadedFileId = fileId;
      }

      const clientNoteId = `stu-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const body = { title, content, recipientIds: [id], clientNoteId };
      if (fileId) body.fileId = fileId;
      const res = await request('/api/notes/send', { method: 'POST', body });
      if (!res.ok) {
        /* 업로드까지 끝난 파일은 다시 올리지 않고, 쪽지만 다시 보낼 수 있게 둔다. */
        toast(res.data.error || '쪽지를 보내지 못했어요.', 'error');
        return;
      }
      titleInput.value = '질문';
      bodyInput.value = '';
      setPendingFile(null);
      toast(`${teacher.real_name || '선생님'} 선생님께 쪽지를 보냈어요.`, 'success');
      const [sRes, iRes] = await Promise.all([
        request('/api/notes/sent?limit=50'),
        request('/api/notes/inbox?limit=50'),
      ]);
      if (sRes.ok && Array.isArray(sRes.data.notes)) state.sent = sRes.data.notes;
      if (iRes.ok && Array.isArray(iRes.data.notes)) state.inbox = iRes.data.notes;
      renderTeacherList();
      renderThread(true);
      renderUnreadTitle();
    } finally {
      setComposeBusy(false);
    }
  }

  /* ---------- 실시간 ---------- */
  function disconnectSocket() {
    if (state.socket) {
      try { state.socket.disconnect(); } catch { /* 무시 */ }
      state.socket = null;
    }
    setConn(false, '오프라인');
  }

  function connectSocket() {
    disconnectSocket();
    if (typeof window.io !== 'function' || !state.token) {
      setConn(false, '실시간 꺼짐');
      return;
    }
    try {
      const socket = window.io({ auth: { token: state.token }, reconnection: true });
      state.socket = socket;
      socket.on('connect', () => setConn(true, '연결됨'));
      socket.on('disconnect', () => setConn(false, '오프라인'));
      socket.on('connect_error', (err) => {
        const msg = String(err && err.message || '');
        setConn(false, msg.includes('unauthorized') ? '로그인 만료' : '오프라인');
      });
      socket.on('memo-arrived', (ev) => {
        if (!ev || ev.from_role === 'STUDENT') return;
        if (Number(ev.from) === Number(state.user && state.user.id)) return;
        playChime();
        toast(`${ev.from_name || '선생님'} 선생님의 새 쪽지가 도착했어요.`);
        notifyBrowser(ev);
        void refreshData(true).then(() => {
          if (state.selectedId && Number(state.selectedId) === Number(ev.from)) {
            renderThread(true);
            // 화면을 보고 있으면 바로 읽음 처리
            const n = state.inbox.find((x) => String(x.id) === String(ev.id));
            if (n && !Number(n.is_read) && !document.hidden) void selectTeacher(Number(ev.from));
          }
        });
      });
      socket.on('user:status_updated', (p) => {
        if (!p) return;
        const t = state.teachers.find((x) => Number(x.id) === Number(p.userId));
        if (!t) return;
        t.status = p.status;
        t.status_message = p.statusMessage || '';
        renderTeacherList();
        if (Number(state.selectedId) === Number(t.id)) renderThread(false);
      });
    } catch {
      setConn(false, '오프라인');
    }
  }

  /* ---------- 알림 ---------- */
  function updateNotifyButton() {
    const btn = $('notifyBtn');
    if (!btn) return;
    if (!('Notification' in window) || Notification.permission === 'granted') {
      btn.hidden = true;
    } else if (Notification.permission === 'denied') {
      btn.hidden = true;
    } else {
      btn.hidden = false;
    }
  }

  async function askNotify() {
    if (!('Notification' in window)) return;
    try {
      const p = await Notification.requestPermission();
      updateNotifyButton();
      if (p === 'granted') toast('새 쪽지 알림을 켰어요.', 'success');
    } catch { /* 무시 */ }
  }

  function notifyBrowser(ev) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (!document.hidden) return; // 화면을 보고 있으면 토스트로 충분
      const n = new Notification('브리즈 · 새 쪽지', {
        body: `${ev.from_name || '선생님'} 선생님: ${ev.title || '새 쪽지'}`,
        tag: `breeze-${ev.id || Date.now()}`,
        silent: true,
      });
      n.onclick = () => { try { window.focus(); n.close(); } catch { /* 무시 */ } };
    } catch { /* 알림 미지원 */ }
  }

  let audioCtx = null;
  function playChime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') void audioCtx.resume();
      const now = audioCtx.currentTime;
      const master = audioCtx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      master.connect(audioCtx.destination);
      [[784, 0], [1046.5, 0.11]].forEach(([freq, at]) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + at);
        g.gain.setValueAtTime(0.0001, now + at);
        g.gain.exponentialRampToValueAtTime(0.85, now + at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.24);
        osc.connect(g);
        g.connect(master);
        osc.start(now + at);
        osc.stop(now + at + 0.27);
      });
    } catch { /* 무음 */ }
  }

  /* ---------- 모바일 목록 ---------- */
  function openSidebar() {
    $('sidebar').classList.add('open');
    $('scrim').hidden = false;
    $('menuBtn').setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('scrim').hidden = true;
    $('menuBtn').setAttribute('aria-expanded', 'false');
  }

  /* ---------- 비밀번호 변경 ---------- */
  function showPwError(message) {
    const n = $('pwError');
    if (!n) return;
    if (!message) { n.hidden = true; n.textContent = ''; return; }
    n.textContent = message;
    n.hidden = false;
  }

  async function onChangePassword(ev) {
    ev.preventDefault();
    showPwError('');
    const cur = $('pwCurrent').value;
    const next = $('pwNext').value;
    const confirm = $('pwConfirm').value;
    if (!cur) return showPwError('현재 비밀번호를 입력해 주세요.');
    if (next.length < 8) return showPwError('새 비밀번호는 8자 이상으로 정해 주세요.');
    if (next !== confirm) return showPwError('새 비밀번호 확인이 서로 달라요.');
    if (next === cur) return showPwError('이전과 다른 비밀번호를 써 주세요.');
    const btn = $('pwSave');
    btn.disabled = true;
    btn.textContent = '변경 중…';
    try {
      const res = await request('/api/me/password', {
        method: 'POST',
        body: { currentPassword: cur, newPassword: next },
      });
      if (!res.ok) {
        showPwError(res.data.error || '비밀번호를 바꾸지 못했어요.');
        return;
      }
      $('pwDialog').close();
      $('pwForm').reset();
      toast('비밀번호를 바꿨어요. 다음부터 새 비밀번호로 로그인하세요.', 'success');
    } finally {
      btn.disabled = false;
      btn.textContent = '변경';
    }
  }

  /* ---------- 이벤트 ---------- */
  function bind() {
    $('loginForm').addEventListener('submit', onLoginSubmit);
    $('composeForm').addEventListener('submit', onComposeSubmit);
    $('attachBtn').addEventListener('click', () => $('mediaInput').click());
    $('mediaInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) setPendingFile(file);
    });
    $('attachRemove').addEventListener('click', () => setPendingFile(null));
    const dropzone = $('composeForm');
    ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    }));
    ['dragleave', 'dragend'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      if (e.target !== dropzone) return;
      dropzone.classList.remove('dragover');
    }));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) setPendingFile(file);
    });
    $('mediaCancel').addEventListener('click', () => {
      state.pendingSend = null;
      $('mediaWarnDialog').close();
    });
    $('mediaSend').addEventListener('click', () => {
      const hide = $('mediaHideToday');
      if (hide && hide.checked) hideMediaWarnToday();
      const payload = state.pendingSend;
      state.pendingSend = null;
      $('mediaWarnDialog').close();
      void sendPendingNote(true, payload);
    });
    $('mediaWarnDialog').addEventListener('cancel', () => { state.pendingSend = null; });
    $('logoutBtn').addEventListener('click', () => { void doLogout(); });
    $('notifyBtn').addEventListener('click', () => { void askNotify(); });
    $('refreshBtn').addEventListener('click', () => { void refreshData(false).then(() => renderThread(true)); });
    $('teacherSearch').addEventListener('input', renderTeacherList);
    $('pwChangeBtn').addEventListener('click', () => {
      showPwError('');
      $('pwForm').reset();
      $('pwDialog').showModal();
    });
    $('pwCancel').addEventListener('click', () => $('pwDialog').close());
    $('pwForm').addEventListener('submit', onChangePassword);
    $('menuBtn').addEventListener('click', openSidebar);
    $('closeSidebar').addEventListener('click', closeSidebar);
    $('scrim').addEventListener('click', closeSidebar);
    $('pwToggle').addEventListener('click', () => {
      const input = $('password');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('pwToggle').textContent = show ? '가리기' : '보기';
      $('pwToggle').setAttribute('aria-label', show ? '비밀번호 가리기' : '비밀번호 보기');
    });
    // 제목 입력에서 Enter는 줄바꿈이 아니라 본문으로 이동 (실수 발송 방지)
    $('noteTitle').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('noteBody').focus();
      }
    });
    window.addEventListener('online', () => { void refreshData(true); connectSocket(); });
    window.addEventListener('offline', () => setConn(false, '오프라인'));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.token) void refreshData(true);
    });
  }

  /* ---------- 부트 ---------- */
  async function init() {
    bind();
    await loadPublicInfo();
    let token = '';
    try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* 저장소 차단 */ }
    if (!token) return;
    state.token = token;
    const me = await request('/api/me');
    if (!state.token) return; // 401 → clearSession
    if (!me.ok || !me.data || !me.data.user) {
      clearSession('세션이 만료됐어요. 다시 로그인해 주세요.');
      return;
    }
    if (String(me.data.user.role || '').toUpperCase() !== 'STUDENT') {
      clearSession('학생 계정으로 다시 로그인해 주세요.');
      return;
    }
    state.user = me.data.user;
    await enterApp();
  }

  document.addEventListener('DOMContentLoaded', () => { void init(); });
})();
