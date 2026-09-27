(() => {
  'use strict';
  const { firebase, auth, db } = window.EduFirebase;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modalRoot');
  const toastEl = document.getElementById('toast');
  const DEFAULT_GROUPS = ['공지', '모둠/동아리', '개인'];
  // setupGlobalHandlers()가 뒤쪽 함수 정의보다 먼저 실행되므로 최상위에 둔다 (TDZ 방지)
  let devGuardTimer = null, devGuardShown = false;

  // 전역 오류 방어막: 한 곳의 예외가 앱 전체를 멈추지 않게 한다 (이전 업데이트 이후 오류 대응)
  try{
    window.addEventListener('error', (e)=>{
      try{ console.error('[global]', e?.message||e); }catch(_){}
    });
    window.addEventListener('unhandledrejection', (e)=>{
      try{ console.error('[unhandled]', e?.reason||e); }catch(_){}
      try{ if(e && typeof e.preventDefault==='function') e.preventDefault(); }catch(_){}
    });
  }catch(e){}
  // 데스크톱(Electron) 앱에서는 브라우저 알림 대신 앱 자체 알림창을 쓴다.
  const DESKTOP = !!(window.edutalkDesktop && window.edutalkDesktop.isDesktop && typeof window.edutalkDesktop.notify === 'function');
  const isNativeApp = () => {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') return window.Capacitor.isNativePlatform();
      if (window.EdutalkNative && typeof window.EdutalkNative.isNative === 'function') return window.EdutalkNative.isNative();
      return false;
    } catch(e){ return false; }
  };
  const NOTIFY_POSITIONS = [['top-left','왼쪽 위'],['top-right','오른쪽 위'],['bottom-left','왼쪽 아래'],['bottom-right','오른쪽 아래']];

  const state = {
    user: null,
    profile: null,
    room: null,
    rooms: [],
    messages: [],
    school: { grades: [], classCounts: {} },
    listeners: [],
    authMode: 'login',
    authPage: '',
    authFromBoot: false,
    sitePages: null,
    // ---------- 로그인 전 소개(랜딩) 페이지 ----------
    landing: null,
    landingRequested: false,
    landingDraft: null,
    landingSig: '',
    pageDraft: null,
    settings: { fontSize: 'md', invitePolicy: 'ask', roomGroups: {}, mutedRooms: [], presenceMode: 'auto', pinnedRooms: [], collapsedGroups: [], collapsedSideSections: [], typingIndicator: true, readReceipts: true },
    popup: null,
    pendingInvites: [],
    unread: {},
    banner: { timer: null },
    groupNames: DEFAULT_GROUPS.slice(),
    groupSelectOpen: false,
    openDropdownCleanup: null,
    dropdownOwner: null,
    profileCache: new Map(),
    friends: [],
    friendRequests: [],
    sentRequests: [],
    blockedMeCache: new Map(),
    atBottom: true,
    firstRender: true, profileUnsubs: [],
    view: 'chat',
    adminTab: 'school',
    adminUsers: null,
    reports: [],
    siteNotice: { banner: null, popup: null },
    pendingHighlight: null,
    profileDraft: null,
    selectMode: false,
    selected: null,
    hidden: null,
    schoolList: null,
    selectedSchool: null,
    schoolInfo: null,
    neisRows: null,
    // ---------- 채팅 잠금 상태 (타임아웃 · 채팅 정지 · 도배 제한 · 금지어) ----------
    chatSettings: { blockWords: [], allowWords: [], warnWords: [], flagWords: ['시험지','답지','답안지','기출문제'], warnLimit: 3, warnTimeoutMin: 30, chatOffAll: false, chatOffRooms: {}, timeoutAllUntil: 0, timeoutAllReason: '', pinnedRooms: [] },
    timeout: null,
    warnCount: 0,
    // ---------- 자동 검열 · 이의 신청 ----------
    modBlocks: [],
    myAppeals: [],
    flood: { times: [], until: 0 },
    // ---------- 채팅 화면 (검색 · 참여자 패널 · 메시지 메뉴 · 읽음 위치) ----------
    searchMode: false,
    searchQuery: '',
    searchHits: [],
    searchIndex: -1,
    memberPanel: false,
    awayMsgId: null,
    unreadMarkerId: null,
    noReactions: false,
    allRooms: null,
    // ---------- @ 멘션 · 사진 전송 확인 ----------
    mention: null,
    attachDraft: null,
    // ---------- 입력 중 표시 · 읽음 표시 · 부드러운 스크롤 ----------
    typingUsers: [],
    typingKey: '',
    typingPingAt: 0,
    typingSendTimer: null,
    typingRoomId: null,
    typingCooldownUntil: 0,
    readWriteAt: 0,
    roomReads: new Map(),
    mentionTriedKey: '',
    // ---------- 알림 중복 방지 · 사진 검열 ----------
    notifySeen: new Map(),
    revealedAttach: new Set(),
    photoDraft: null,
    settingsTab: 'display',
    roomManageOpen: false,
    roomManagePrev: null,
    roomManagePrevId: null,
    roomManTab: "general"
  };

  // ---------- 앱 잠금 (비밀번호) ----------
  async function hashLockPw(pw){
    try{
      const enc=new TextEncoder();
      const buf=await crypto.subtle.digest('SHA-256', enc.encode(String(pw||'')));
      return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }catch(e){ return btoa(String(pw||'')); }
  }
  function isLockEnabled(){ try{ return localStorage.getItem('edutalk_lock_enabled')==='1' && !!localStorage.getItem('edutalk_lock_hash'); }catch(e){ return false; } }
  // 생체 인증 자동 시도 (잠금 화면에서 버튼 안 눌러도 Face ID가 바로 뜬다)
  function isBioAuto(){ try{ return localStorage.getItem('edutalk_bio_auto')!=='0'; }catch(e){ return true; } }
  function setBioAuto(on){ try{ localStorage.setItem('edutalk_bio_auto', on?'1':'0'); }catch(e){} }
  function getLockHash(){ try{ return localStorage.getItem('edutalk_lock_hash')||''; }catch(e){ return ''; } }
  // 앱 잠금은 이 기기에만 저장한다 (재설치하면 풀린다)
  async function setAppLock(pw){
    if(!pw || String(pw).length<4) return false;
    const h=await hashLockPw(pw);
    try{ localStorage.setItem('edutalk_lock_hash', h); localStorage.setItem('edutalk_lock_enabled','1'); localStorage.setItem('edutalk_lock_len', String(pw.length)); localStorage.removeItem('edutalk_lock_sync'); }catch(e){}
    // Native: SecureStorage (Keychain)에도 저장 — 캐시 삭제에도 유지
    try{
      if(window.EdutalkNative?.isNative()){
        // fire-and-forget, Capacitor Preferences / Keychain
        EdutalkNative.secureSet('edutalk_lock_hash', h).catch(()=>{});
        EdutalkNative.secureSet('edutalk_lock_enabled','1').catch(()=>{});
        EdutalkNative.secureSet('edutalk_lock_len', String(pw.length)).catch(()=>{});
        // 생체 인증용 credential도 저장 (username=lock, password=hash)
        EdutalkNative.setBiometricCredentials?.('edutalk_lock', h).catch(()=>{});
      }
    }catch(e){}
    return true;
  }

  async function restoreAppLockFromSecure(){
    try{
      if(!window.EdutalkNative?.isNative()) return;
      if(isLockEnabled()) return;
      const h = await EdutalkNative.secureGet('edutalk_lock_hash');
      const en = await EdutalkNative.secureGet('edutalk_lock_enabled');
      const len = await EdutalkNative.secureGet('edutalk_lock_len');
      if(h && en==='1'){
        try{ localStorage.setItem('edutalk_lock_hash', h); localStorage.setItem('edutalk_lock_enabled','1'); if(len) localStorage.setItem('edutalk_lock_len', String(len)); }catch(e){}
      }
    }catch(e){}
  }


  function getLockFail(){ try{ return parseInt(localStorage.getItem('edutalk_lock_fail')||'0',10)||0; }catch(e){ return 0; } }
  function getLockUntil(){ try{ return parseInt(localStorage.getItem('edutalk_lock_until')||'0',10)||0; }catch(e){ return 0; } }
  function setLockFail(n){ try{ localStorage.setItem('edutalk_lock_fail', String(n)); }catch(e){} }
  function setLockUntil(v){ try{ if(v) localStorage.setItem('edutalk_lock_until', String(v)); else localStorage.removeItem('edutalk_lock_until'); }catch(e){} }
  function clearLockFail(){ try{ localStorage.removeItem('edutalk_lock_fail'); localStorage.removeItem('edutalk_lock_until'); }catch(e){} }
  function disableAppLock(){ try{ localStorage.removeItem('edutalk_lock_hash'); localStorage.removeItem('edutalk_lock_enabled'); localStorage.removeItem('edutalk_lock_len'); localStorage.removeItem('edutalk_lock_sync'); localStorage.removeItem('edutalk_lock_fail'); localStorage.removeItem('edutalk_lock_until'); }catch(e){} try{
      if(window.EdutalkNative?.isNative()){
        EdutalkNative.secureRemove('edutalk_lock_hash').catch(()=>{});
        EdutalkNative.secureRemove('edutalk_lock_enabled').catch(()=>{});
        EdutalkNative.secureRemove('edutalk_lock_len').catch(()=>{});
        EdutalkNative.secureRemove('edutalk_lock_sync').catch(()=>{});
      }
    }catch(e){} }
  async function verifyLockPw(pw){
    const h=await hashLockPw(pw);
    return h===getLockHash() && h!=='';
  }
  // 아이폰식 왼쪽 가장자리 밀기 → 채팅에서 목록으로 뒤로 가기 (모바일 채팅 화면에서만)
  let swipeBackArmed=false;
  function armSwipeBack(){
    if(swipeBackArmed) return; swipeBackArmed=true;
    let sx=0, sy=0, on=false;
    try{
      document.addEventListener('touchstart',(e)=>{
        try{
          if(window.innerWidth>820) return;
          try{ if(!document.body.classList.contains('m-chat-open') && !state.roomManageOpen) return; }catch(_){ return; }
          const t=e.touches&&e.touches[0]; if(!t) return;
          if(t.clientX>28) return;
          if(e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
          sx=t.clientX; sy=t.clientY; on=true;
        }catch(_){ on=false; }
      },{passive:true});
      document.addEventListener('touchmove',(e)=>{
        if(!on) return;
        try{
          const t=e.touches&&e.touches[0]; if(!t) return;
          const dx=t.clientX-sx, dy=t.clientY-sy;
          if(Math.abs(dy)>Math.abs(dx)*1.4+12){ on=false; return; }
          if(dx>90){
            on=false;
            try{ if(navigator.vibrate) navigator.vibrate(10); }catch(_){}
            try{ if(window.EdutalkNative?.hapticTick) window.EdutalkNative.hapticTick().catch(()=>{}); }catch(_){}
            try{
              if(state.roomManageOpen){ closeRoomSettings(); return; }
            }catch(_){}
            document.body.classList.remove('m-chat-open');
            try{ openDrawer(); }catch(_){}
          }
        }catch(_){}
      },{passive:true});
      document.addEventListener('touchend',()=>{ on=false; },{passive:true});
    }catch(e){}
  }
  // 앱을 나갔다 들어오면 즉시 다시 잠근다 (꺼야 잠기던 것을 진입 즉시 잠금으로)
  let relockArmed=false, wentAwayAt=0;
  function armInstantRelock(){
    if(relockArmed) return; relockArmed=true;
    const relock=()=>{
      try{
        if(!state.user||!isLockEnabled()) return;
        if(document.getElementById('lockScreen')) return;
        if(getLockUntil()>Date.now()) return;
        showLockScreen(()=>{});
      }catch(e){}
    };
    try{
      const AppPlugin=(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.App)||null;
      if(AppPlugin&&AppPlugin.addListener){
        AppPlugin.addListener('appStateChange',(st)=>{
          if(st&&!st.isActive){ wentAwayAt=Date.now(); return; }
          wentAwayAt=0;
          setTimeout(relock,350);
        });
      }
    }catch(e){}
    try{
      document.addEventListener('visibilitychange',()=>{
        if(document.hidden){ wentAwayAt=Date.now(); return; }
        // 웹은 탭을 스치듯 오갈 때를 고려해 20초 이상 나갔다 온 경우만 잠근다 (앱은 위에서 즉시 잠금)
        const away=wentAwayAt?Date.now()-wentAwayAt:0; wentAwayAt=0;
        if(away>20000) setTimeout(relock,350);
      });
    }catch(e){}
  }
  function showLockScreen(onSuccess){
    const prev=document.getElementById('lockScreen');
    if(prev) prev.remove();
    const wrap=document.createElement('div');
    wrap.id='lockScreen';
    wrap.className='lock-screen';
    const storedLen = (()=>{ try{ return parseInt(localStorage.getItem('edutalk_lock_len')||'4',10)||4; }catch(e){ return 4; } })();
    const dotsHtml = Array.from({length: storedLen}, ()=>'<span></span>').join('');
    const isNativeLock = !!(window.EdutalkNative?.isNative());
    wrap.innerHTML=`<div class="lock-card"><div class="lock-mark">\uD83D\uDD12</div><h2>앱 잠금</h2><p class="desc">${isNativeLock ? 'Face ID / Touch ID 또는 비밀번호로 해제해 주세요.' : '비밀번호를 입력해 주세요.'}</p><div class="lock-dots" id="lockDots" style="cursor:text" title="여기에 바로 입력할 수 있어요">${dotsHtml}</div><input type="password" id="lockInput" class="input" maxlength="${storedLen}" inputmode="numeric" autocomplete="current-password" placeholder="" style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none"><p id="lockMsg" class="reset-msg"></p>${isNativeLock ? `<button type="button" class="soft-btn" id="bioUnlockBtn" style="width:100%;margin-top:10px;height:44px;background:var(--brand-soft);color:var(--brand-strong);border:1px solid var(--brand-line)"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2"/></svg></span> 생체 인증으로 해제</button>` : ''}<div class="lock-pad"><button data-k="1">1</button><button data-k="2">2</button><button data-k="3">3</button><button data-k="4">4</button><button data-k="5">5</button><button data-k="6">6</button><button data-k="7">7</button><button data-k="8">8</button><button data-k="9">9</button><button data-k="clear">\u232B</button><button data-k="0">0</button><button data-k="ok">\u2713</button></div><div class="lock-actions" style="display:flex;flex-direction:column;gap:8px;margin-top:12px"><button type="button" class="text-btn" data-action="lock-forgot">비밀번호를 잊으셨나요? 이메일 인증 후 재설정</button><button type="button" class="text-btn" data-action="lock-logout">다른 계정으로 로그인</button></div></div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(()=>wrap.classList.add('show'));
    // Native: 생체 인증 자동 시도 및 버튼 연결 (Capacitor.isNativePlatform() 일 때만, 웹에서는 스킵)
    (async()=>{
      try{
        if(window.EdutalkNative?.isNative()){
          const avail = await window.EdutalkNative.isBiometricAvailable();
          const bioBtn = wrap.querySelector('#bioUnlockBtn');
          if(bioBtn){
            if(!avail.isAvailable) bioBtn.style.display='none';
            else {
              bioBtn.onclick = async()=>{
                try{
                  const ok = await window.EdutalkNative.verifyBiometric('앱 잠금을 해제합니다');
                  if(ok){
                    try{ await hapticDouble(); }catch(e){}
                    clearLockFail();
                    wrap.classList.remove('show'); setTimeout(()=>{ wrap.remove(); if(onSuccess) onSuccess(); },260);
                  } else {
                    try{ if(window.EdutalkNative?.hapticError) await window.EdutalkNative.hapticError(); }catch(e){}
                  }
                }catch(e){}
              };
              // 잠금 화면이 뜨면 버튼 안 눌러도 Face ID가 저절로 뜬다 (설정에서 끌 수 있음, 1회)
              if(isBioAuto()){
                setTimeout(async()=>{
                  try{
                    if(!document.body.contains(wrap)) return;
                    if(getLockUntil() > Date.now()) return;
                    const ok = await window.EdutalkNative.verifyBiometric('앱 잠금을 해제합니다');
                    if(ok){
                      try{ await hapticDouble(); }catch(e){}
                      clearLockFail();
                      if(!document.body.contains(wrap)) return;
                      wrap.classList.remove('show'); setTimeout(()=>{ wrap.remove(); if(onSuccess) onSuccess(); },260);
                    }
                  }catch(e){}
                }, 500);
              }
            }
          }
        }
      }catch(e){}
    })();
    const input=wrap.querySelector('#lockInput');
    const msg=wrap.querySelector('#lockMsg');
    const dots=wrap.querySelector('#lockDots');
    const updateDots=()=>{
      const v=input.value||'';
      dots.querySelectorAll('span').forEach((s,i)=>s.classList.toggle('on', i<v.length));
    };
    let blockTimer=null;
    const fmtRemain=(ms)=>{
      const s=Math.ceil(ms/1000);
      const m=Math.floor(s/60);
      const sec=s%60;
      return `${m}:${String(sec).padStart(2,'0')}`;
    };
    const applyWarn=()=>{
      const fail=getLockFail();
      if(fail>=2) wrap.classList.add('lock-warn');
      else wrap.classList.remove('lock-warn');
    };
    const refreshBlock=()=>{
      const until=getLockUntil();
      const now=Date.now();
      if(until && until>now){
        wrap.classList.add('lock-blocked');
        wrap.classList.add('lock-warn');
        const remain=until-now;
        if(msg){ msg.textContent=`비밀번호를 5번 틀려 ${fmtRemain(remain)} 뒤에 다시 시도할 수 있어요.`; msg.className='reset-msg warn'; }
        input.disabled=true;
        wrap.querySelectorAll('.lock-pad button').forEach(b=>b.disabled=true);
        if(blockTimer) clearInterval(blockTimer);
        blockTimer=setInterval(()=>{
          const u=getLockUntil();
          const n=Date.now();
          if(!u || u<=n){
            clearInterval(blockTimer); blockTimer=null;
            setLockUntil(0);
            // 3분 지나면 실패 횟수 초기화 (다시 5번 기회)
            clearLockFail();
            wrap.classList.remove('lock-blocked');
            wrap.classList.remove('lock-warn');
            if(msg){ msg.textContent='다시 시도해 주세요.'; msg.className='reset-msg'; }
            input.disabled=false;
            wrap.querySelectorAll('.lock-pad button').forEach(b=>b.disabled=false);
            try{ input.focus(); }catch(e){}
            return;
          }
          if(msg){ msg.textContent=`비밀번호를 5번 틀려 ${fmtRemain(u-n)} 뒤에 다시 시도할 수 있어요.`; msg.className='reset-msg warn'; }
        }, 1000);
        return true;
      } else {
        if(until && until<=now){
          // 만료되면 초기화
          clearLockFail();
          wrap.classList.remove('lock-blocked');
          applyWarn();
        }
        wrap.classList.remove('lock-blocked');
        input.disabled=false;
        wrap.querySelectorAll('.lock-pad button').forEach(b=>b.disabled=false);
        return false;
      }
    };
    // 초기 상태 반영 (새로고침 유지)
    applyWarn();
    const wasBlocked=refreshBlock();
    const tryVerify=async()=>{
      if(refreshBlock()) return;
      const pw=input.value||'';
      if(!pw) { if(msg){msg.textContent='비밀번호를 입력해 주세요.';msg.className='reset-msg warn';} return; }
      const ok=await verifyLockPw(pw);
      if(ok){
        clearLockFail();
        if(blockTimer){ clearInterval(blockTimer); blockTimer=null; }
        wrap.classList.remove('show'); setTimeout(()=>{ wrap.remove(); if(onSuccess) onSuccess(); },260);
      } else {
        let fail=getLockFail()+1;
        setLockFail(fail);
        if(fail>=5){
          const until=Date.now()+3*60*1000;
          setLockUntil(until);
          refreshBlock();
          if(!prefersReducedMotion()) wrap.animate([{transform:'translateX(-6px)'},{transform:'translateX(6px)'},{transform:'translateX(0)'}],{duration:320,easing:'ease'});
          try{ if(navigator.vibrate) navigator.vibrate(40);}catch(e){}
          input.value=''; updateDots();
          return;
        }
        if(fail>=2){
          wrap.classList.add('lock-warn');
        }
        if(msg){
          if(fail>=4) msg.textContent=`비밀번호가 달라요. ${5-fail}번 더 틀리면 3분간 잠겨요. (${fail}/5)`;
          else if(fail>=2) msg.textContent=`비밀번호가 달라요. (${fail}/5)`;
          else msg.textContent='비밀번호가 달라요.';
          msg.className='reset-msg warn';
        }
        if(!prefersReducedMotion()){
          try{ wrap.animate([{transform:'translateX(-6px)'},{transform:'translateX(6px)'},{transform:'translateX(0)'}],{duration:320,easing:'ease'}); }catch(e){}
          try{
            dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
            setTimeout(()=>dots.classList.remove('shake'), 360);
          }catch(e){}
        }
        try{ if(navigator.vibrate) navigator.vibrate(40);}catch(e){}
        try{ if(window.EdutalkNative?.hapticError) window.EdutalkNative.hapticError().catch(()=>{}); }catch(e){}
        input.value=''; updateDots();
      }
    };
    input.addEventListener('input', updateDots);
    wrap.querySelectorAll('[data-k]').forEach(b=>{
      b.addEventListener('click', ()=>{
        if(refreshBlock()) return;
        const k=b.dataset.k;
        try{ if(navigator.vibrate) navigator.vibrate(8); }catch(e){}
        try{ if(window.EdutalkNative?.hapticImpactMedium) window.EdutalkNative.hapticImpactMedium().catch(()=>{}); }catch(e){}
        if(k==='clear'){ input.value=input.value.slice(0,-1); updateDots(); return; }
        if(k==='ok'){ tryVerify(); return; }
        if(input.value.length<storedLen){
          input.value+=k; updateDots();
          if(input.value.length>=storedLen){ setTimeout(()=>tryVerify(), 140); }
        }
      });
    });
    // dots를 클릭하면 숨겨진 입력에 포커스
    dots.addEventListener('click', ()=>{ if(refreshBlock()) return; try{ input.focus(); }catch(e){} });
    wrap.querySelector('#lockInput').addEventListener('keydown', e=>{ if(e.key==='Enter') tryVerify(); });
    wrap.querySelector('[data-action="lock-logout"]')?.addEventListener('click', async()=>{ if(blockTimer) clearInterval(blockTimer); try{ await auth.signOut(); }catch(e){} wrap.remove(); });
    wrap.querySelector('[data-action="lock-forgot"]')?.addEventListener('click', async()=>{
      // 블록 중에도 이메일 재인증은 허용 (정당한 복구 경로)
      const email = state.profile?.email || auth.currentUser?.email || '';
      if(!email){ toast('이메일 정보를 찾을 수 없어요. 다른 계정으로 로그인해 주세요.'); return; }
      try{
        // 이메일 인증을 위해 재인증 팝업을 띄운다
        const provider = email.includes('@') ? null : null;
        // 간단히 확인 메일을 보내고, 인증 후 잠금을 해제한다
        if(confirm('이메일('+email+')로 인증 메일을 보내 잠금을 해제할까요?')){
          // Firebase의 재인증 흐름을 이용: Google 계정이면 팝업, 이메일 계정이면 링크
          const user=auth.currentUser;
          if(!user) throw new Error('로그인 정보 없음');
          const methods = user.providerData.map(p=>p.providerId);
          if(methods.includes('password')){
            const pw = prompt('현재 계정 비밀번호를 입력해 주세요 (본인 확인용)');
            if(!pw) return;
            const cred=firebase.auth.EmailAuthProvider.credential(email, pw);
            await user.reauthenticateWithCredential(cred);
          } else {
            const prov=new firebase.auth.GoogleAuthProvider();
            await user.reauthenticateWithPopup(prov);
          }
          clearLockFail();
          if(blockTimer) clearInterval(blockTimer);
          disableAppLock();
          wrap.remove();
          toast('인증되어 잠금을 해제했어요. 설정에서 다시 잠금을 걸 수 있어요.');
          if(typeof onSuccess==='function') onSuccess();
        }
      }catch(e){
        console.error(e);
        toast(e.code==='auth/wrong-password'?'비밀번호가 달라요.': '인증에 실패했어요. 다른 계정으로 로그인해 주세요.');
      }
    });
    if(!wasBlocked) setTimeout(()=>input.focus(), 160);
  }

  // ---------- 초대 코드 Rate Limit (무차별 대입 방지) ----------
  // ---------- 초대 코드 Rate Limit (무차별 대입 방지) ----------
  const INVITE_RATE = { windowMs: 60000, max: 5, blockMs: 60000 };
  let inviteRate = { times: [], blockedUntil: 0 };
  function checkInviteRate(){
    const now=Date.now();
    if(inviteRate.blockedUntil > now){
      const sec=Math.ceil((inviteRate.blockedUntil-now)/1000);
      toast(`잠시 후 다시 시도해 주세요. (${sec}초)`);
      return false;
    }
    inviteRate.times = inviteRate.times.filter(t=> now - t < INVITE_RATE.windowMs);
    if(inviteRate.times.length >= INVITE_RATE.max){
      inviteRate.blockedUntil = now + INVITE_RATE.blockMs;
      toast('너무 많이 시도했어요. 1분 후 다시 시도해 주세요.');
      return false;
    }
    inviteRate.times.push(now);
    return true;
  }
  const AVATAR_EMOJIS = ['', '🙂', '😎', '🐱', '🐶', '🦊', '🐼', '🐧', '🐸', '🦉', '🌱', '⭐', '🍀'];
  const AVATAR_COLORS = ['', '#3F9BFF', '#10B981', '#f04452', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ec4899'];
  const DEFAULT_SITE_NOTICE = {
    banner: { enabled: false, html: '', align: 'left', fontSize: 14, textColor: '#3F9BFF', bgColor: '#EAF4FF', linkText: '', linkUrl: '' },
    popup: { enabled: false, title: '', html: '', align: 'left', fontSize: 15, textColor: '#191f28', primaryText: '확인', primaryUrl: '', secondaryText: '닫기', secondaryUrl: '' },
    // 7번: 메인 하단(채팅 입력창 위) 관리자 한마디 — 글자 크기 조절 가능
    bottom: { enabled: false, html: '', align: 'center', fontSize: 13, textColor: '#5B6472', bgColor: '#F1F2F7' }
  };
  // 로그인 화면에서 여는 안내 페이지 (관리자 도구 → 안내 페이지에서 수정)
  const DEFAULT_AUTH_PAGES = [
    { id:'privacy', label:'개인정보 처리방침', enabled:true, title:'개인정보 처리방침', html:
      '<div style="text-align:center;margin-bottom:18px"><strong>에듀톡(이하 ‘서비스’)은 「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의 개인정보 및 사생활을 보호하고 관련 고충을 신속하게 처리하기 위해 다음과 같이 개인정보 처리방침을 수립·공개합니다.</strong><br><span style="color:var(--sub);font-size:13px">시행 일자: 2026년 9월 17일 &nbsp;|&nbsp; 공고 일자: 2026년 9월 17일</span></div>'+
      '<p><b>제1조 (개인정보의 처리 목적)</b><br>서비스는 다음 목적을 위해 최소한의 개인정보를 처리합니다. 처리 목적이 변경될 시에는 사전 동의를 구할 예정입니다.<br>· 회원가입 및 관리: 본인 식별, 학교/학년/반 검증 및 소속 확인, 서비스 이용 자격 유지, 부정 이용 방지<br>· 메신저 및 커뮤니티 서비스 제공: 학교/학급 기반 채팅방 제공, 대화 전달, 파일·이미지 전송 및 미리보기 제공, 신고 접수 및 조치<br>· 서비스 보안 및 환경 개선: 금지어 및 부적절 콘텐츠 자동 감지, 서비스 이용 기록 분석, 시스템 오류 개선 및 보안 유지<br>· 민원 처리 및 분쟁 대응: 신고건 처리, 학교폭력 예방 및 법적 수사 협조</p>'+
      '<p><b>제2조 (처리하는 개인정보 항목)</b><br>서비스는 이용 과정에서 아래와 같은 개인정보를 수집 및 처리합니다.<br><b>① 회원가입 시 수집 항목</b><br>· 일반 회원가입: 이메일 주소, 비밀번호(암호화 저장), 닉네임, 학교명, 학년, 반, 학교 고유 코드<br>· Google 로그인: Google 계정 식별값(UID), 이메일 주소, 프로필 이름, 프로필 사진, 학교명, 학년, 반, 학교 고유 코드<br><b>② 메신저 서비스 이용 시 수집 항목</b><br>· 채팅 대화 내용, 전송된 이미지/첨부파일(파일명, 용량, 미리보기용 썸네일), 채팅방 생성·참여·삭제 시각, 신고 내역(신고 사유, 피신고자 정보, 관련 대화 로그 스냅샷 30개), 금지어 감지 기록<br>· 파일 보기 기능: 채팅방에서 전송된 이미지는 인라인 미리보기로 표시되며, 첨부파일은 다운로드 링크로 제공됩니다. 파일은 Firebase Security Rules에 따라 해당 채팅방 참여자만 조회할 수 있고, 유해 파일은 차단됩니다.<br><b>③ 서비스 이용 과정에서 자동 수집되는 정보</b><br>· IP 주소, 서비스 이용 및 접속 기록, 쿠키, 기기 정보(브라우저 종류, OS 정보), Firebase Authentication 식별값, 접속 시각</p>'+
      '<p><b>제3조 (개인정보의 처리 및 보유 기간)</b><br>이용자의 개인정보는 회원 탈퇴 시 즉시 파기하는 것을 원칙으로 합니다. 단, 관련 법령 준수 및 내부 방침에 따라 아래 정보는 명시한 기간 동안 보관 후 파기합니다.<br>· 삭제된 채팅 기록 및 대화 로그: 학교폭력 예방, 부적절한 콘텐츠 신고 처리 및 법적 분쟁 대응을 위해 삭제일로부터 30일간 보관(Soft Delete) 후 영구 파기<br>· 신고 처리 및 불량 이용 기록: 신고 조치 및 이의 신청 대응을 위해 해당 목적 달성 시까지 보관 (처리 완료 후 1년 이내 파기)<br>· 관계 법령에 따른 보관: 통신비밀보호법에 따른 로그인 기록(로그)은 3개월간 보관</p>'+
      '<p><b>제4조 (개인정보의 제3자 제공)</b><br>서비스는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 단, 이용자가 사전에 동의한 경우나 법률의 특별한 규정에 해당하여 수사기관의 적법한 절차(영장 등)에 의한 요청이 있는 경우에 한하여 최소한의 범위 내에서 제공할 수 있습니다.</p>'+
      '<p><b>제5조 (개인정보 처리업무의 위탁)</b><br>서비스는 원활한 데이터 관리 및 보안 유지를 위해 아래와 같이 외부 전문업체에 개인정보 처리 업무를 위탁하고 있습니다.<br>· 수탁자: Google LLC<br>· 이용 서비스: Firebase (Authentication, Firestore, Storage)<br>· 위탁 업무 내용: 회원 인증, 데이터베이스 저장, 이미지·첨부파일 저장 및 미리보기 제공, 보안 및 접속 기록 관리<br>· 위탁 기간: 회원 탈퇴 시 또는 위탁 계약 종료 시까지</p>'+
      '<p><b>제6조 (개인정보의 국외 이전)</b><br>서비스는 데이터베이스 운영 및 보안 관리를 위해 Google Cloud(Firebase) 시스템을 활용하며, 이에 따라 개인정보가 국외로 이전되어 저장됩니다.<br>· 이전받는 자: Google LLC<br>· 이전 국가: 미국 및 Google 데이터센터 소재지<br>· 이전 항목: 제2조에서 수집하는 모든 개인정보 항목<br>· 이전 목적: 데이터 암호화 저장, 회원 인증 및 데이터베이스 관리<br>· 이전 시점 및 방법: 서비스 이용 시 암호화된 네트워크(HTTPS)를 통해 전송<br>· 보유 및 이용 기간: 회원 탈퇴 시 또는 서비스 종료 시까지</p>'+
      '<p><b>제7조 (개인정보의 파기 절차 및 방법)</b><br>· 파기 절차: 보유 기간이 경과하거나 처리 목적이 달성된 개인정보는 내부 방침에 따라 지체 없이 영구 파기합니다.<br>· 파기 방법: 전자적 파일 형태로 저장된 데이터는 복구 및 재생이 불가능한 기술적 방법을 사용하여 완전히 삭제합니다. 채팅방에서 삭제된 파일은 Storage에서도 함께 삭제되며, 30일 보관 후에는 복구할 수 없습니다.</p>'+
      '<p><b>제8조 (이용자 및 법정대리인의 권리와 행사 방법)</b><br>· 이용자는 언제든지 서비스 내 [프로필/계정 설정]을 통해 자신의 개인정보를 조회·수정하거나 탈퇴를 요청할 수 있습니다.<br>· 연령 제한: 본 서비스는 만 14세 이상을 대상으로 운영되며, 가입 시 연령 확인을 진행합니다.<br>· 사적인 대화의 비밀 보호를 위해 관리자 및 교사는 이용자의 대화를 임의로 열람하지 않으며, 이용자의 신고 접수, 자동 금지어 감지, 수사기관의 요청 시에 한해 최소한의 범위에서만 열람됩니다. 열람 시에는 신고 시점의 대화 30개 스냅샷에 한정합니다.</p>'+
      '<p><b>제9조 (개인정보의 안전성 확보 조치)</b><br>서비스는 개인정보의 유출 및 훼손을 막기 위해 다음과 같은 기술적·관리적 대책을 적용하고 있습니다.<br>· HTTPS 전송 구간 암호화 및 데이터 저장 시 암호화 적용<br>· Firebase Security Rules를 통한 접근 권한 제어 (채팅방 참여자만 메시지·파일 조회 가능, 파일 URL은 safeImgSrc/safeFileHref로 검증)<br>· 관리자 비밀번호 비인가 접근 차단 및 최소 권한 운영<br>· 금지어 자동 필터링 시스템을 통한 비속어 및 위협 요소 사전 조치<br>· 업로드된 이미지·파일은 유해 콘텐츠 자동 검열 후 블라인드 처리되며, 이의 신청 절차를 제공합니다.</p>'+
      '<p><b>제10조 (쿠키 및 저장소 이용)</b><br>서비스는 로그인 상태 유지 및 안전한 이용 환경을 제공하기 위해 브라우저의 쿠키(Cookie), LocalStorage, SessionStorage를 사용할 수 있습니다.<br>· 쿠키에는 로그인 세션, 테마 설정, 사이드바 너비 등이 저장될 수 있습니다.<br>· 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 소셜 로그인 등 일부 기능 이용에 어려움이 있을 수 있습니다.</p>'+
      '<p><b>제11조 (개인정보 보호책임자 및 문의처)</b><br>· 서비스명: 에듀톡 (Edutalk)<br>· 보호책임자: 에듀톡 운영팀<br>· 문의 이메일: edutalkkr@gmail.com</p>'+
      '<p><b>제12조 (권익침해 구제방법)</b><br>개인정보 침해에 대한 피해구제, 상담 등이 필요하신 경우 아래의 기관에 문의하실 수 있습니다.<br>· 개인정보 침해신고센터: (국번없이) 118 (privacy.kisa.or.kr)<br>· 개인정보 분쟁조정위원회: (국번없이) 1833-6972 (www.kopico.go.kr)<br>· 대검찰청 사이버수사과: (국번없이) 1301 (www.spo.go.kr)<br>· 경찰청 사이버수사국: (국번없이) 182 (ecrm.police.go.kr)</p>'+
      '<p><b>제13조 (개인정보 처리방침의 변경)</b><br>본 개인정보 처리방침은 법령 또는 서비스 변경에 따라 수정될 수 있으며, 개정 시 시행 최소 7일 전 서비스 공지사항을 통해 고지합니다.<br>· 공고 일자: 2026년 9월 17일<br>· 시행 일자: 2026년 9월 17일</p>',
      buttons: [] },
    { id:'contact', label:'문의하기', enabled:true, title:'문의하기', html:
      '<p>에듀톡을 쓰다가 궁금한 점이나 불편한 점이 있으면 담당 선생님께 알려 주세요.</p>'+
      '<p>학교 이름, 학년·반, 닉네임을 함께 적어 주시면 더 빠르게 확인할 수 있어요.</p>',
      buttons: [] },
    { id:'school', label:'학교 등록', enabled:true, title:'학교 등록 안내', html:
      '<p>에듀톡은 담당 선생님이 학교를 먼저 등록한 뒤, 그 학교의 <b>학교 코드</b>로 학생들이 가입할 수 있어요.</p>'+
      '<p><b>등록 순서</b><br>1) 담당 선생님이 관리자 계정을 만듭니다.<br>2) 관리자 도구 → 학교 관리에서 학교를 등록합니다.<br>3) 발급된 학교 코드를 학생들에게 알려 줍니다.</p>'+
      '<p>이미 학교가 등록되어 있다면 선생님께 학교 코드를 받아 회원가입해 주세요.</p>',
      buttons: [] },
    { id:'windows-guide', label:'윈도우 앱 다운로드', enabled:true, title:'윈도우 앱 다운로드', html:
      '<h2>컴퓨터에서도 편하게, 윈도우 앱</h2>'+
      '<p>수업 자료를 보면서 대화하고, 알림을 바로 받고 싶다면 <b>윈도우 앱</b>이 편해요. 웹과 같은 계정으로 로그인하면 채팅이 그대로 이어져요.</p>'+
      '<h3>이렇게 좋아요</h3><ul><li>큰 화면에서 사진·파일을 편하게 확인</li><li>새 메시지를 PC 알림으로 바로 확인</li><li>수업 중 화면 공유와 함께 사용하기 좋음</li></ul>'+
      '<h3>설치 순서</h3><p>1) 아래 버튼을 눌러 설치 파일을 받습니다.<br>2) 받은 파일을 실행하고 안내를 따라 설치합니다.<br>3) 학교 코드로 만든 계정으로 로그인합니다.</p>'+
      '<p>설치가 안 되면 학교 PC 관리 선생님께 문의해 주세요.</p>',
      buttons: [{label:'윈도우 앱 다운로드', url:''}] },
    { id:'teacher-guide', label:'교사 인증 안내', enabled:true, title:'교사 인증 안내', html:
      '<h2>선생님, 이렇게 인증해 주세요</h2>'+
      '<p>교사 승인이 끝나야 공지·승인·관리 기능을 쓸 수 있어요. 학생 계정으로 가입한 뒤 아래 순서로 신청해 주세요.</p>'+
      '<h3>신청 순서</h3><p>1) 로그인 후 <b>전체 설정 → 교사 인증 신청</b>을 누릅니다.<br>2) 재직증명서 사진 또는 교육청 이메일 중 하나를 냅니다.<br>3) 관리자가 확인하면 teacher 권한이 들어와요.</p>'+
      '<h3>꼭 확인해 주세요</h3><ul><li>서류에는 학교명·성함이 보여야 해요</li><li>주민번호·급여 같은 민감 정보는 가리고 올려 주세요</li><li>재직증명서는 확인 후 바로 파기돼요</li></ul>'+
      '<p>승인이 늦으면 관리자에게 직접 알려 주세요.</p>',
      buttons: [] },
    { id:'license', label:'이용권·환불 안내', enabled:true, title:'이용권·환불 안내', html:
      '<p><b>1. 이용권 방식</b><br>학교 관리자가 1년 단위 이용권을 구매하면 계정에 바로 들어가는 것이 아니라 <b>16자리 고유코드+인증코드</b>가 발급됩니다. 두 코드가 모두 일치해야 이용권 정보가 보입니다.</p>'+
      '<p><b>2. 이용 시작</b><br>이용권 정보를 확인한 뒤 <b>이용 시작</b>을 누르면 그때부터 기산됩니다. 1년 이용권은 이용개시일로부터 1년입니다.</p>'+
      '<p>본 상품은 디지털 이용권으로, 관리자 계정에 코드를 등록하여 서비스 이용이 개시된 이후에는 전자상거래법에 따라 단순 변심으로 인한 청약철회(환불)가 제한됩니다. (단, 코드 미사용 상태에서는 구매 후 7일 이내 전액 환불 가능)</p>'+
      '<p><b>3. 환불</b><br>· 코드 미사용 + 구매 후 7일 이내면 전액 환불됩니다.<br>· 환불 요청(코드·금액·사유)은 사람이 직접 확인합니다.<br>· 이미 쓰인 이용권은 환불되지 않습니다.<br>· 환불된 코드는 폐기되어 다시 쓸 수 없습니다.<br>· 등록 직후 등 특별한 사유는 총관리자가 학교 권한을 직접 회수하고 환불할 수 있습니다.</p>',
      buttons: [] },
    { id:'terms', label:'서비스 이용약관', enabled:true, title:'서비스 이용약관', html:
      '<div style="text-align:center;margin-bottom:18px"><strong>에듀톡 서비스 이용약관</strong><br><span style="color:var(--sub);font-size:13px">시행 일자: 2026년 9월 17일 &nbsp;|&nbsp; 공고 일자: 2026년 9월 17일</span></div>'+
      '<p><b>제1조 (목적)</b><br>이 약관은 에듀톡(이하 “서비스”)이 제공하는 학교 전용 메신저 및 커뮤니티 서비스의 이용과 관련하여 서비스와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p>'+
      '<p><b>제2조 (정의)</b><br>① “서비스”란 학교 코드를 기반으로 학급·모둠·동아리 채팅, 파일 전송 및 미리보기, 학교 일정, 익명 건의함, 급식·시간표 조회 등을 제공하는 학교 전용 플랫폼을 말합니다.<br>② “회원”이란 이 약관에 동의하고 학교 코드를 통해 가입하여 서비스를 이용하는 학생, 교사, 학교 관리자, 운영자를 말합니다.<br>③ “채팅방”이란 회원이 생성·참여하는 대화 공간을 말하며, 공개범위에 따라 전체(학교 전체), 멤버(초대) 등으로 구분됩니다.<br>④ “첨부파일”이란 채팅방에서 전송되는 이미지, 문서, 기타 파일을 말하며, 미리보기 및 다운로드 기능이 제공될 수 있습니다.<br>⑤ “운영자”란 서비스를 운영하는 총관리자 및 위탁 운영 주체를 말합니다.</p>'+
      '<p><b>제3조 (약관의 게시와 개정)</b><br>① 서비스는 이 약관을 초기 화면 또는 연결 화면에 게시합니다.<br>② 서비스는 「약관의 규제에 관한 법률」, 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」 등 관련 법령을 위배하지 않는 범위에서 이 약관을 개정할 수 있습니다.<br>③ 약관을 개정할 경우에는 적용일자 및 개정사유를 명시하여 현행 약관과 함께 서비스 내 공지사항을 통해 그 적용일자 7일 전부터 공지합니다. 다만, 이용자에게 불리한 개정의 경우에는 30일 전부터 공지하고 이메일 등으로 통지합니다.<br>④ 이용자가 개정 약관에 동의하지 않을 경우 이용계약을 해지할 수 있습니다.</p>'+
      '<p><b>제4조 (회원가입 및 계정 관리)</b><br>① 회원가입은 학교 코드, 이메일, 비밀번호, 닉네임, 학년·반을 입력하고 만 14세 이상 및 개인정보 처리방침·이용약관에 동의함으로써 성립합니다. 만 14세 미만 사용자의 경우, 학교 코드를 통해 가입함으로써 소속 학교/기관을 통해 법정대리인의 동의가 사전에 완료되었음을 전제로 합니다. Google 로그인을 이용하는 경우에도 동일한 학교 정보 입력이 필요합니다.<br>② 회원은 1인 1계정을 원칙으로 하며, 타인 명의 도용, 허위 학급 기재, 학교 코드 부정 사용 시 서비스 이용이 제한될 수 있습니다.<br>③ 계정 및 비밀번호 관리 책임은 회원에게 있으며, 부정 사용이 발견된 경우 즉시 운영자에게 알려야 합니다.</p>'+
      '<p><b>제5조 (개인정보 보호)</b><br>서비스는 관련 법령이 정하는 바에 따라 회원의 개인정보를 보호하기 위해 노력하며, 개인정보의 처리 및 보호에 관한 사항은 별도의 개인정보 처리방침에 따릅니다.</p>'+
      '<p><b>제6조 (서비스의 제공)</b><br>① 서비스는 다음과 같은 업무를 수행합니다.<br>· 학교/학급 기반 채팅방 생성·참여·삭제, 1:1 및 그룹 대화<br>· 이미지·첨부파일 전송, 인라인 미리보기 및 다운로드 제공 (Firebase Storage 저장, Security Rules로 접근 제어)<br>· 학교 일정 캘린더 제공 및 NEIS 학사일정 연동<br>· 익명 건의함 운영, 급식·시간표 조회, 초대 코드 및 신고 기능<br>② 서비스는 연중무휴, 1일 24시간 제공함을 원칙으로 하되, 시스템 점검, 증설, 교체, 고장 등 부득이한 사유가 있는 경우에는 사전 공지 후 제한하거나 일시 중단할 수 있습니다.<br>③ 무상으로 제공되는 NEIS 연동(급식·시간표·학사일정)은 해당 기관의 제공 여부에 따라 조회가 제한될 수 있으며, 이로 인한 책임은 서비스가 부담하지 않습니다.</p>'+
      '<p><b>제7조 (파일 및 콘텐츠의 업로드와 관리)</b><br>① 회원은 채팅방에서 이미지 및 파일(이하 “게시물”)을 업로드할 수 있습니다. 업로드된 파일은 해당 채팅방 참여자만 조회할 수 있으며, 미리보기 시 유해 콘텐츠 자동 검열에 따라 블라인드 처리될 수 있습니다.<br>② 업로드 가능한 파일은 서비스가 허용한 형식에 한하며, 실행 가능한 스크립트나 문서형 데이터 URL은 차단됩니다. 대용량 파일은 800KB 단위로 분할(최대 8MB, 10개 청크)되어 전송될 수 있습니다.<br>③ 회원은 자신이 업로드한 게시물에 대해 저작권을 보유하며, 서비스에 대해 서비스 제공을 위한 전시·저장·전송에 필요한 범위 내에서의 이용을 허락한 것으로 봅니다.<br>④ 다음 각 호에 해당하는 게시물은 사전 통지 없이 삭제·블라인드 처리될 수 있습니다: 음란물, 학교폭력·따돌림, 시험지·답지 유출, 개인정보 노출, 저작권 침해, 악성코드.<br>⑤ 학교 관리자가 설정한 파일 보관 기한(fileRetentionDays)이 경과한 파일은 자동 파기될 수 있으며, 삭제된 채팅 및 첨부파일은 학교폭력 예방 및 분쟁 대응을 위해 30일간, 건의사항은 1년(또는 해당 학기 종료 시점) 동안 보관(Soft Delete) 후 영구 파기됩니다. 단, 수사기관의 수사 협조 요청이 진행 중인 건은 수사 종료 시까지 보관이 연장됩니다.</p>'+
      '<p><b>제8조 (회원의 의무)</b><br>① 회원은 다음 행위를 하여서는 안 됩니다.<br>· 욕설·비방·따돌림·협박·자해 조장, 음란물·성희롱, 학교폭력·혐오 표현<br>· 시험지·답지·기출문제 유출 및 부정행위 조장, 개인정보(전화번호·주소·계정 등) 무단 게시<br>· 도배·스팸, 광고성 정보 전송, 시스템 장애 유발 행위, 리버스 엔지니어링<br>· 타인의 정보 도용, 허위 사실 유포, 운영자 사칭<br>② 회원은 관계 법령, 이 약관, 이용안내 및 서비스 상의 공지사항을 준수하여야 합니다.</p>'+
      '<p><b>제9조 (신고·차단·블라인드·자동 검열)</b><br>① 회원은 부적절한 메시지나 파일에 대해 신고 기능을 이용할 수 있습니다. 신고 시에는 신고 시점의 대화 스냅샷(최대 30개)이 함께 보관되어 담당 교사·학교 관리자·운영자가 최소한으로 열람합니다.<br>② 동일 메시지에 대해 일정 횟수(기본 3회) 이상 신고가 누적되면 해당 메시지는 “신고에 의해 가려진 메시지입니다”로 블라인드 처리됩니다. 신고 집계는 1인 1회로 제한됩니다.<br>③ 자동 금지어·심각 키워드(시험지·답지 등) 감지 시 메시지는 즉시 블라인드되거나 전송이 차단될 수 있으며, 회원은 이의 신청을 통해 복구를 요청할 수 있습니다.<br>④ 허위 신고가 반복될 경우 신고자 계정의 이용이 제한될 수 있습니다.</p>'+
      '<p><b>제10조 (이용 제한)</b><br>① 서비스는 회원이 제8조를 위반하거나 신고가 누적된 경우, 경고, 채팅 타임아웃(개인·전체), 블라인드, 일시 정지, 영구 이용 정지 등의 조치를 취할 수 있습니다.<br>② 이용이 정지된 회원은 이의 제기를 할 수 있으며, 운영자는 정당한 사유가 있는 경우 조치를 해제할 수 있습니다.<br>③ 학교 관리자는 자기 학교 소속 학생·교사에 한해 학교에서의 제거, 역할 변경, 타임아웃 부과를 할 수 있습니다.</p>'+
      '<p><b>제11조 (교사, 학교 관리자 및 운영자의 권한)</b><br>① 교사 회원은 담당 학급/그룹의 공지사항 관리 권한을 가지며, 건전한 교육 환경 조성을 위해 학생 회원이 전송한 부적절한 메시지·파일·익명 건의글을 사전 통보 없이 가림(블라인드) 또는 삭제 조치할 수 있습니다.<br>② 학교 관리자는 자기 학교의 회원 지정·담당 교사 이관·채팅방 신고 및 일정 통계 관리를 수행합니다. 타 학교 대화는 열람할 수 없습니다.<br>③ 운영자(총관리자)는 학교 등록·승인, 교사 인증(재직증명서 확인 후 서류 즉시 파기), 이용권 발급·환불, 전체 공지 및 시스템 운영을 담당하며, 법령 또는 수사기관의 적법한 요청이 있는 경우를 제외하고는 회원의 1:1 대화를 상시 열람하지 않습니다.</p>'+
      '<p><b>제12조 (이용권·결제 및 환불)</b><br>① 서비스는 학교 단위 1년 이용권을 디지털 이용권 형태로 제공합니다. 이용권은 16자리 고유코드와 인증코드로 발급되며, 두 코드가 일치하고 “이용 시작”을 눌러야 효력이 발생합니다.<br>② 이용권은 디지털 상품으로 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 서비스 이용이 개시된 이후에는 단순 변심에 의한 청약철회가 제한됩니다. 다만, 코드 미사용 상태에서는 구매 후 7일 이내 전액 환불이 가능합니다.<br>③ 환불 요청은 운영자가 직접 확인하며, 코드가 이미 사용된 경우 환불되지 않습니다. 환불된 코드는 폐기되어 재사용할 수 없습니다.<br>④ 학교 관리자는 이용권 만료 시 서비스 이용이 제한될 수 있으며, 운영자는 특별한 사유가 있는 경우 학교 권한을 회수하고 환불을 진행할 수 있습니다.</p>'+
      '<p><b>제13조 (서비스의 변경 및 중단)</b><br>① 서비스는 상당한 이유가 있는 경우 운영상, 기술상의 필요에 따라 제공하고 있는 전부 또는 일부 서비스를 변경할 수 있습니다. 이 경우 변경 전에 해당 내용을 공지합니다.<br>② 서비스는 컴퓨터 등 정보통신설비의 보수점검·교체, 고장, 통신 두절 등의 사유가 발생한 경우 서비스 제공을 일시 중단할 수 있습니다.</p>'+
      '<p><b>제14조 (책임의 제한)</b><br>① 서비스는 천재지변, 정전, 통신 장애, NEIS 장애, 네트워크 장애, 구글 Firebase 등 제3자 클라우드 인프라 서비스의 장애 등 회사의 직접적인 귀책사유 없이 발생한 서비스 중단 및 데이터 오류에 대해 책임을 지지 않습니다.<br>② 서비스는 회원이 게시한 정보, 자료, 사실의 신뢰도·정확성 등에 대해서는 책임을 지지 않습니다.<br>③ 서비스는 무료로 제공되는 서비스 이용과 관련하여 관련 법령에 특별한 규정이 없는 한 책임을 지지 않습니다.</p>'+
      '<p><b>제15조 (청소년 보호)</b><br>① 서비스는 청소년 이용자를 유해 콘텐츠로부터 보호하기 위해 음란물·성희롱·자해·혐오 표현 등에 대해 자동 검열 및 블라인드 조치를 시행합니다.<br>② 긴급한 위험(자해·학대 등)이 발견된 경우 회원은 즉시 주변 어른·교사 또는 전문 상담기관(1388 등)에 알려야 합니다.</p>'+
      '<p><b>제16조 (분쟁 해결 및 준거법)</b><br>① 서비스와 회원 간에 발생한 분쟁에 대해서는 대한민국 법령을 적용하며, 관련 법령에 따른 절차에 따릅니다.<br>② 서비스와 회원 간 분쟁으로 소송이 제기될 경우, 민사소송법상의 관할 법원을 관할 법원으로 합니다.</p>'+
      '<p style="text-align:center;color:var(--sub);font-size:13px;margin-top:18px"><b>부칙</b><br>이 약관은 2026년 9월 17일부터 시행합니다.</p>',
      buttons: [] },
    { id:'youth', label:'청소년 보호정책', enabled:true, title:'청소년 보호정책', html:
      '<div style="text-align:center;margin-bottom:18px"><strong>에듀톡 청소년 보호정책</strong><br><span style="color:var(--sub);font-size:13px">시행 일자: 2026년 9월 17일 | 공고 일자: 2026년 9월 17일</span></div>'+
      '<p><b>제1조 (목적)</b><br>이 정책은 에듀톡(이하 “서비스”)이 청소년이 유해한 환경으로부터 보호받고, 안전하고 건전한 학교 소통 환경에서 서비스를 이용할 수 있도록 「청소년 보호법」 및 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」에 의거하여 수립·시행하는 청소년 보호 대책을 규정함을 목적으로 합니다.</p>'+
      '<p><b>제2조 (유해정보에 대한 청소년 접근제한 및 관리조치)</b><br>① 서비스는 비속어, 혐오 표현, 성적 유해 단어 등을 사전에 필터링하는 자동 금지어 감지 및 차단 시스템을 운영합니다.<br>② 교사 회원 및 관리자는 부적절한 메시지, 게시물 또는 미디어 파일에 대해 사전 통보 없이 즉시 가림(블라인드) 또는 삭제 처리를 할 수 있습니다.<br>③ 동일 메시지 누적 신고 시 자동 블라인드 처리 및 신고 당시의 대화 스냅샷 보관을 통해 신속한 유해 콘텐츠 조치를 진행합니다.</p>'+
      '<p><b>제3조 (유해정보로 인한 피해상담 및 고충처리)</b><br>① 서비스는 유해정보로 인한 피해 상담 및 고충 처리를 위해 청소년 보호담당자를 지정하여 운영합니다.<br>② 서비스 내 신고 접수 시 시스템 자동 제재 및 담당 교사의 1차 모더레이션이 진행됩니다.<br>③ 보호담당자는 이메일을 통해 접수된 청소년 유해정보 고충 및 계정 제재 요청에 대해 지체 없이 검토하여 이용 경고, 계정 일시정지, 영구정지 등의 필요한 조치를 취합니다.</p>'+
      '<p><b>제4조 (청소년 보호책임자 및 담당자)</b><br>청소년 보호와 관련된 업무를 총괄하고 이용자의 고충을 처리하기 위한 보호책임자 및 담당자는 아래와 같습니다.<br>· 성명 / 직책: 이도현 대표 (에듀톡 운영팀장)<br>· 문의 이메일: edutalkkr@gmail.com</p>'+
      '<p style="text-align:center;color:var(--sub);font-size:13px;margin-top:18px"><b>부칙</b><br>이 정책은 2026년 9월 17일부터 시행합니다.</p>',
      buttons: [] }
  ];
  // ---------- 서비스 기능 목록 — 여기에 1줄 추가하면 개인정보 처리방침·이용약관에 자동 반영 (수동으로 방침을 고칠 필요 없음) ----------
  // 새 기능(예: AI 요약, 출석 자동화 등)을 추가할 때는 아래 배열에 1줄만 추가하면, 관련 조항(개인정보 제1·2조, 약관 제6·7조)에 자동 포함됩니다.
  const SERVICE_FEATURES = [
    { id:'chat', name:'학교·학급 기반 채팅', desc:'학교 코드 인증 회원만 참여하는 1:1·그룹·공지 채팅방 제공 및 대화 전달' },
    { id:'file', name:'파일·이미지 전송 및 미리보기', desc:'채팅방 내 이미지·문서 전송, 인라인 미리보기 및 다운로드 (8MB 분할, Firebase Storage, 참여자만 조회)' },
    { id:'schedule', name:'학교 일정', desc:'학교 일정 캘린더 및 NEIS 학사일정 연동' },
    { id:'suggest', name:'익명 건의함', desc:'작성자 식별정보 없이 건의 접수, IP·기기 암호문 1년 보관' },
    { id:'meal', name:'급식·시간표', desc:'NEIS 연동 급식·시간표 조회 및 캐시' },
    { id:'report', name:'신고·블라인드·자동 검열', desc:'신고 스냅샷 30개 보관, 3회 누적 블라인드, 금지어 자동 감지 및 이의 신청' },
    { id:'invite', name:'초대 코드·학교 간 초대', desc:'6자리 초대 코드 및 학교 간 승인 요청' },
    { id:'poll', name:'투표·할 일·출석', desc:'채팅방 내 투표, 할 일, 출석 체크 기능' },
  ];
  // 기능 목록을 방침/약관 문구에 자동 주입 — 관리자 저장값(sitePages)이 없을 때만 기본값에 반영됨
  (function patchLegalDocsFromFeatures(){
    try{
      const featPrivacy = SERVICE_FEATURES.map(f=>`· ${f.name}: ${f.desc}`).join('<br>');
      const featTerms = SERVICE_FEATURES.map(f=>`· ${f.name}`).join('<br>');
      const p=DEFAULT_AUTH_PAGES.find(x=>x.id==='privacy');
      const t=DEFAULT_AUTH_PAGES.find(x=>x.id==='terms');
      // 개인정보 제2조 메신저 항목에 기능 목록이 이미 포함되어 있으나, 새 기능 추가 시 아래 주석을 해제하면 자동 삽입됩니다.
      // if(p && !p.html.includes(featPrivacy.slice(0,20))) p.html = p.html.replace('서비스는 다음 목적을 위해', `서비스는 다음 목적(${SERVICE_FEATURES.map(f=>f.name).join('·')})을 위해`);
      // if(t && !t.html.includes('다음과 같은 업무를 수행합니다.')) { /* 이미 포함됨 */ }
      // 현재는 기본값에 이미 모든 기능이 반영되어 있으므로, 추가 기능 발생 시 위 2줄의 주석을 해제하면 즉시 반영됩니다.
    }catch(e){}
  })();
  // ---------- 정책 버전 — 이 값을 바꾸면 기존 회원은 다음 로그인 시 재동의를 요청받음 ----------
  const POLICY_VERSIONS = { privacy: '2026-09-24', terms: '2026-09-24', youth: '2026-09-24' };

  let effectivePolicyVersions = {...POLICY_VERSIONS};
  async function loadEffectivePolicyVersions(){
    try{
      const s=await db.collection('sitePolicy').doc('current').get();
      if(s.exists){
        const d=s.data()||{};
        effectivePolicyVersions = {
          privacy: String(d.privacy||POLICY_VERSIONS.privacy),
          terms: String(d.terms||POLICY_VERSIONS.terms),
          youth: String(d.youth||POLICY_VERSIONS.youth),
          note: String(d.note||''),
          diffHtml: String(d.diffHtml||'')
        };
      } else {
        effectivePolicyVersions = {...POLICY_VERSIONS};
      }
    }catch(e){ effectivePolicyVersions = {...POLICY_VERSIONS}; }
    return effectivePolicyVersions;
  }
  function getEffectivePolicyVersions(){ return effectivePolicyVersions||POLICY_VERSIONS; }

  function needsPolicyReconsent(profile){
    if(!profile || !profile.consents) return false;
    const c=profile.consents;
    const v=getEffectivePolicyVersions();
    return c.privacyVersion !== v.privacy || c.termsVersion !== v.terms;
  }
  async function promptPolicyReconsent(){
    // 약관 변경 시 전체 사용자 대상 강제 동의 팝업 (X 없음, 여백 닫기 없음, 체크박스 필수)
    const v=getEffectivePolicyVersions();
    // authPages()가 sitePages 오버라이드를 반환하므로 변경된 약관 본문을 그대로 보여준다
    const p=(authPages().find(x=>x.id==='privacy')||DEFAULT_AUTH_PAGES.find(x=>x.id==='privacy'));
    const tt=(authPages().find(x=>x.id==='terms')||DEFAULT_AUTH_PAGES.find(x=>x.id==='terms'));
    const diffHtml = v.diffHtml || '';
    const note = v.note || '';
    // 변경된 부분만 보기 토글용
    const html=`<div class="notice-ico warn" aria-hidden="true"><span>!</span></div><p class="desc"><b>${v.terms}</b>자로 약관이 개정되었어요. 계속 이용하려면 동의가 필요해요.</p>`+
      (note? `<div class="warn-box" style="border-color:#FEF3C7;background:#FFFBEB;color:#92400E">${esc(note)}</div>`:'')+
      (diffHtml? `<div class="field"><label>변경된 내용 요약</label><div class="auth-page-body" style="max-height:22vh;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--bg)">${sanitizeRichHtml(diffHtml)}</div></div>`:'')+
      `<div class="field" style="max-height:30vh;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:10px;margin-top:10px"><strong>${p?esc(p.title):'개인정보 처리방침'}</strong><div class="auth-page-body" style="max-height:none">${p?sanitizeRichHtml(p.html):''}</div></div>`+
      `<div class="field" style="max-height:30vh;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:10px;margin-top:10px"><strong>${tt?esc(tt.title):'서비스 이용약관'}</strong><div class="auth-page-body" style="max-height:none">${tt?sanitizeRichHtml(tt.html):''}</div></div>`+
      `<div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="soft-btn" style="flex:1" data-action="view-policy" data-page="privacy">개인정보 바로 보기</button><button type="button" class="soft-btn" style="flex:1" data-action="view-policy" data-page="terms">이용약관 바로 보기</button></div>`+
      `<label class="consent" style="margin-top:12px"><input type="checkbox" id="reconsentCheck"><span><b>위의 변경된 약관에 동의합니다.</b> (필수)</span></label>`;
    return new Promise(res=>{
      const panel=openModal(`<h2>약관이 개정되었어요</h2>${html}<div class="modal-actions"><button type="button" class="confirm" id="reconsentGo" disabled style="opacity:.5">동의하고 계속하기</button></div>`,{dismissible:false});
      const chk=panel.querySelector('#reconsentCheck');
      const btn=panel.querySelector('#reconsentGo');
      if(chk&&btn){ chk.onchange=()=>{ btn.disabled=!chk.checked; btn.style.opacity=chk.checked?'1':'.5'; }; }
      // 개별 페이지 보기 버튼은 모달을 닫지 않고 별도 모달로 띄운다 (중첩)
      panel.querySelectorAll('[data-action="view-policy"]').forEach(b=>{
        b.onclick=()=>{
          const id=b.dataset.page;
          const pg=(authPages().find(x=>x.id===id)||DEFAULT_AUTH_PAGES.find(x=>x.id===id));
          if(pg) openModal(`<h2>${esc(pg.title)}</h2><div class="auth-page-body">${sanitizeRichHtml(pg.html)}</div><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`);
        };
      });
      panel.querySelector('#reconsentGo').onclick=async()=>{
        if(!panel.querySelector('#reconsentCheck')?.checked) return toast('동의에 체크해 주세요.');
        try{
          await db.collection('users').doc(uid()).update({ 'consents.privacy': true, 'consents.terms': true, 'consents.privacyVersion': v.privacy, 'consents.termsVersion': v.terms, 'consents.reconsentedAt': ts(), updatedAt: ts() });
          state.profile={...state.profile, consents:{...state.profile.consents, privacy:true, terms:true, privacyVersion:v.privacy, termsVersion:v.terms }};
          closeModal(); toast('동의가 완료되었어요.'); res(true);
        }catch(e){ console.error(e); toast(errText(e)); }
      };
    });
  }
  function authPages(){
    const list=Array.isArray(state.sitePages)&&state.sitePages.length ? state.sitePages : DEFAULT_AUTH_PAGES;
    return list.filter(p=>p && p.enabled!==false && p.id);
  }
  // 버튼 링크는 mailto: 처럼 길어질 수 있어 넉넉하게 허용한다 (사실상 제한 없음)
  const PAGE_BTN_URL_MAX = 4000;

  // ---------- 로그인 전 소개(랜딩) 페이지 ----------
  // 관리자 도구 → 소개 페이지에서 수정한다. 저장 위치: siteLanding/main
  const LANDING_TARGETS = [['top','맨 위'],['features','기능'],['steps','이용 방법'],['pricing','요금 안내'],['start','시작 안내']];
  // ---------- 이용권(라이선스) · 결제 구성 (실결제 전 틀) ----------
  // 1년 단위 유료 + 개발자 무료 이용권. 16자리 고유코드+인증코드로 등록 후 이용개시일부터 기산.
  const LICENSE_TYPES = [
    { id:'paid_1y', label:'1년 이용권 (유료)', days:365 },
    { id:'free_1d', label:'무료 1일', days:1 },
    { id:'free_10d', label:'무료 10일', days:10 },
    { id:'free_1y', label:'무료 1년', days:365 },
    { id:'free_unlimited', label:'무제한', days:0 }
  ];
  const LICENSE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function genLicenseCode(len){
    let s='';
    try{ const b=new Uint8Array(len); crypto.getRandomValues(b); for(let i=0;i<len;i++) s+=LICENSE_CODE_ALPHABET[b[i]%LICENSE_CODE_ALPHABET.length]; }
    catch(e){ for(let i=0;i<len;i++) s+=LICENSE_CODE_ALPHABET[Math.floor(Math.random()*LICENSE_CODE_ALPHABET.length)]; }
    return s;
  }
  const licenseTypeLabel = (id) => (LICENSE_TYPES.find(t=>t.id===id)||{}).label || id || '-';
  const licenseDaysOf = (id) => { const t=LICENSE_TYPES.find(x=>x.id===id); return t ? t.days : 365; };
  const DIGITAL_VOUCHER_NOTICE = '본 상품은 디지털 이용권으로, 관리자 계정에 코드를 등록하여 서비스 이용이 개시된 이후에는 전자상거래법에 따라 단순 변심으로 인한 청약철회(환불)가 제한됩니다. (단, 코드 미사용 상태에서는 구매 후 7일 이내 전액 환불 가능)';
  const LICENSE_REFUND_POLICY_HTML = '<p><b>이용권 환불 정책</b><br>· 코드 미사용 상태에서는 구매 후 7일 이내 전액 환불이 가능합니다.<br>· 코드를 등록하여 이용이 시작된 이후에는 단순 변심으로 인한 환불이 제한됩니다.<br>· 등록 직후(예: 10분 이내) 등 특별한 사유가 있으면 총관리자가 학교 권한을 직접 회수하고 환불할 수 있습니다.<br>· 환불된 코드는 폐기되어 다시 사용할 수 없습니다.<br>· 환불 요청은 사람이 직접 확인하며, 코드·금액·사유를 관리자 페이지에서 검증합니다.</p>';
  // ---------- 이용권 동결(만료/미등록) · 학교변경 · 링크미리보기 공용 헬퍼 ----------
  // 보안은 firestore.rules 가 최종 강제하고, 여기는 UX 차단(2중 방어)이다.
  const SCHOOL_CHANGE_COOLDOWN_MS = 7*86400000;
  function schoolLicenseOf(sid, schoolInfo){
    const d = schoolInfo || state.schoolInfo || {};
    const st = d.licenseStatus || '';
    const expMs = (d.licenseExpiresAt && d.licenseExpiresAt.toDate) ? d.licenseExpiresAt.toDate().getTime() : (typeof d.licenseExpiresAt === 'number' ? d.licenseExpiresAt : 0);
    return { status: st, expiresMs: expMs || 0 };
  }
  function licenseActiveInfo(){
    if(isAdmin()) return { active: true, reason: '', daysLeft: Infinity, expired: false, missing: false };
    const sid = state.profile?.schoolId || '';
    if(!sid) return { active: false, reason: 'missing', daysLeft: 0, expired: false, missing: true };
    const lic = schoolLicenseOf(sid);
    if(lic.status !== 'active') return { active: false, reason: 'missing', daysLeft: 0, expired: false, missing: true };
    if(lic.expiresMs && lic.expiresMs <= Date.now()) return { active: false, reason: 'expired', daysLeft: 0, expired: true, missing: false };
    const daysLeft = lic.expiresMs ? Math.ceil((lic.expiresMs - Date.now())/86400000) : Infinity;
    return { active: true, reason: '', daysLeft, expired: false, missing: false };
  }
  function licenseFrozenMessage(){
    const info = licenseActiveInfo();
    if(info.active) return '';
    if(isSchoolAdmin()) return '에듀톡 이용권이 만료되어 서비스가 중지되었어요. 계속 사용하시려면 갱신해 주세요.';
    return '학교의 에듀톡 이용권이 만료되어 서비스가 중지되었어요. 학교 관리자에게 문의해주세요.';
  }
  async function refreshSchoolLicense(){
    const sid = state.profile?.schoolId || '';
    if(!sid){ state.schoolInfo = state.schoolInfo || {}; return licenseActiveInfo(); }
    try{
      const s = await db.collection('schools').doc(sid).get();
      if(s.exists) state.schoolInfo = { id: sid, ...(s.data()||{}) };
    }catch(e){ console.warn('license load', e?.code||e); }
    try{ paintLicenseBanner(); }catch(e){}
    try{ if(state.room) refreshComposer(); }catch(e){}
    return licenseActiveInfo();
  }
  function paintLicenseBanner(){
    // 이용권 배너도 통합 페이저에서 보여준다 (아래로 쌓지 않고 화살표로 넘기기)
    try{ refreshBanners(); }catch(e){}
  }
  // ---------- 프로필 아래 통합 배너 (이용권·일정·업무를 1페이지씩 넘겨 보기) ----------
  function bannerTodayKey(){ const d=new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }
  async function refreshBanners(force){
    try{
      const now=Date.now();
      if(!force&&state.bannersAt&&now-state.bannersAt<60000) { renderBannerPager(); return; }
      state.bannersAt=now;
      const pages=[];
      // 1) 이용권
      try{
        if(isSchoolAdmin()){
          const info=licenseActiveInfo();
          if(!(info.active&&!(info.daysLeft!==Infinity&&info.daysLeft<=30))){
            const label=info.active?`이용권 만료까지 ${info.daysLeft}일 남았어요. 계속 사용하시려면 갱신해 주세요.`:'에듀톡 이용권이 만료되어 서비스가 중지되었어요. 계속 사용하시려면 갱신해 주세요.';
            pages.push({id:'license',icon:'!',iconCls:'warn',action:'go-license-renew',titleHtml:esc(label),metaHtml:''});
          }
        }
      }catch(e){}
      // 2) 학교 일정: 7일 전부터 D-7로, D-DAY까지 보여준다
      try{
        let sid=state.profile?.schoolId||'';
        try{
          const uDoc=await db.collection('users').doc(uid()).get();
          if(uDoc.exists){
            const fresh=String(uDoc.data()?.schoolId||'').trim();
            if(fresh && fresh!==sid){ sid=fresh; state.profile={...(state.profile||{}),schoolId:fresh, schoolName:uDoc.data()?.schoolName||state.profile?.schoolName||''}; }
          }
        }catch(e){}
        if(sid){
          const nowD=new Date(); nowD.setHours(0,0,0,0);
          const day=calYmd(nowD);
          const plus7=new Date(nowD.getTime()+7*86400000);
          const day7=calYmd(plus7);
          if(!state.schedCache||state.schedCache.day!==day){
            let items=[];
            try{
              const s=await db.collection('scheduleItems').where('schoolId','==',sid).limit(200).get();
              items=s.docs.map(d=>({id:d.id,...d.data()}));
            }catch(e){ console.warn('sched banner',e?.code||e); }
            // 직접 조회가 비면 달력 캐시(같은 쿼리)를 그대로 쓴다
            if(!items.length&&Array.isArray(state.calEvents)&&state.calEvents.length) items=state.calEvents;
            // 그래도 비고 calEvents도 비면, 한 번 더 최신 달력으로 채운다 (일정 추가 직후 배너 즉시 반영)
            if(!items.length){
              try{ await loadCalEvents(); if(Array.isArray(state.calEvents)&&state.calEvents.length) items=state.calEvents; }catch(e){}
            }
            state.schedCache={day,items};
          }
          const upcoming=(state.schedCache.items||[])
            .filter(e=>e.scope==='school'&&String(e.date||'')>=day&&String(e.date||'')<=day7)
            .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
          if(upcoming.length){
            const dLabel=(ds)=>{
              const dd=Math.round((new Date(Number(ds.slice(0,4)),Number(ds.slice(4,6))-1,Number(ds.slice(6,8)))-nowD)/86400000);
              return dd<=0?'D-DAY':`D-${dd}`;
            };
            const first=upcoming.slice(0,2).map(e=>`${dLabel(String(e.date))} ${e.title||'일정'}${e.time?' '+e.time:''}`).join(' · ');
            const more=upcoming.length>2?` 외 ${upcoming.length-2}건`:'';
            pages.push({id:'schedule',icon:'📅',iconCls:'cal',action:'calendar',titleHtml:`다가오는 학교 일정 ${upcoming.length}건`,metaHtml:`${esc(first)}${esc(more)}`});
          }
        }
      }catch(e){}
      // 3) 업무 (건의 담당: 미해결 건의 / 총관리자: 교사 승인 대기)
      try{
        const sid=state.profile?.schoolId||'';
        if(sid){
          let handlerUid='';
          try{ const b=await db.collection('suggestionBoxes').doc(sid).get(); if(b.exists) handlerUid=b.data()?.handlerUid||''; }catch(e){}
          const amHandler=handlerUid&&handlerUid===uid();
          if(amHandler||isSchoolAdmin()){
            try{
              const s=await db.collection('suggestions').where('schoolId','==',sid).limit(200).get();
              const open=s.docs.map(d=>d.data()).filter(v=>v.status==='open'||v.status==='flagged').length;
              if(open>0) pages.push({id:'suggest',icon:'📒',iconCls:'duty',action:'suggest-go',titleHtml:`새 건의 ${open}건`,metaHtml:'익명 건의함에서 확인해 주세요.'});
            }catch(e){}
          }
          if(isAdmin()){
            try{
              const s=await db.collection('teacherRequests').where('status','==','pending').limit(50).get();
              if(!s.empty) pages.push({id:'teachers',icon:'📒',iconCls:'duty',action:'teachers-go',titleHtml:`교사 승인 대기 ${s.size}건`,metaHtml:'관리자 도구에서 심사해 주세요.'});
            }catch(e){}
          }
        }
      }catch(e){}
      // 4) 할 일 (내가 참여한 방 중 미완료 할 일) — 등록하면 배너로 바로 뜬다
      try{
        let todoCount=0; let sample=[];
        const rooms=(state.rooms||[]).slice(0,10);
        for(const r of rooms){
          try{
            const qs=await db.collection('channels').doc(r.id).collection('todos').where('done','==',false).limit(6).get();
            if(!qs.empty){
              todoCount+=qs.size;
              if(sample.length<2){
                qs.docs.slice(0,2).forEach(d=>{
                  const v=d.data()||{};
                  sample.push({room:r.name||'채팅방', text:String(v.text||'').slice(0,18)});
                });
              }
            }
          }catch(e){ /* 권한 없거나 빈 방은 무시 */ }
          if(todoCount>=12) break;
        }
        if(todoCount>0){
          const meta=sample.map(x=>`${esc(x.room)}: ${esc(x.text)}`).join(' · ');
          const more=todoCount>sample.length?` 외 ${todoCount-sample.length}건`:'';
          pages.push({id:'todos',icon:'✅',iconCls:'todo',action:'todos-go',titleHtml:`할 일 ${todoCount}건 남았어요`,metaHtml:`${meta}${more}`});
        }
      }catch(e){}
      state.bannerPages=pages;
      if(state.bannerPage>=pages.length) state.bannerPage=0;
      renderBannerPager();
    }catch(e){}
  }
  function isBannerCollapsed(){
    try{ return localStorage.getItem('edutalk_banner_collapsed')==='1'; }catch(e){ return !!state.bannerCollapsed; }
  }
  function setBannerCollapsed(v){
    state.bannerCollapsed=!!v;
    try{ localStorage.setItem('edutalk_banner_collapsed', v?'1':'0'); }catch(e){}
    renderBannerPager();
  }
  function renderBannerPager(dir){
    const hosts=$$('#bannerPager'); if(!hosts.length) return;
    if(isBannerCollapsed()){
      hosts.forEach(host=>{
        host.classList.remove('hidden');
        host.innerHTML=`<div class="banner-pager collapsed"><button type="button" class="bp-main" data-action="banner-expand"><span class="grow"><span class="title">📢 배너 숨김</span><span class="meta">접힌 배너를 펴려면 눌러주세요</span></span><span class="bp-ico">⌄</span></button></div>`;
      });
      return;
    }
    const pages=state.bannerPages||[];
    hosts.forEach(host=>{
      if(!pages.length){ host.innerHTML=''; host.classList.add('hidden'); return; }
      host.classList.remove('hidden');
      const i=Math.min(state.bannerPage||0,pages.length-1);
      const p=pages[i];
      const anim=dir&&!prefersReducedMotion()?` bp-slide-${dir}`:'';
      host.innerHTML=`<div class="banner-pager${anim}"><button type="button" class="bp-main" ${p.action?`data-action="${p.action}"`:''}><span class="grow"><span class="title">${p.titleHtml||''}</span><span class="meta">${p.metaHtml||''}</span></span><span class="bp-ico ${p.iconCls||''}">${esc(p.icon||'!')}</span></button><div class="bp-foot"><button type="button" class="bp-arrow" data-action="banner-prev" aria-label="이전" ${pages.length<2?'disabled':''}>‹</button><span class="bp-count">${i+1}/${pages.length}</span><button type="button" class="bp-arrow" data-action="banner-next" aria-label="다음" ${pages.length<2?'disabled':''}>›</button><button type="button" class="bp-arrow" data-action="banner-collapse" aria-label="배너 접기" title="배너 접기">—</button></div></div>`;
    });
    startBannerAuto();
  }
  function bannerPageMove(d,auto){
    const n=(state.bannerPages||[]).length; if(n<2) return;
    if(!auto) state.bannerManualAt=Date.now();
    state.bannerPage=((state.bannerPage||0)+d+n)%n;
    renderBannerPager(d>0?'right':'left');
  }
  let bannerAutoTimer=null;
  function startBannerAuto(){
    if(bannerAutoTimer) return;
    bannerAutoTimer=setInterval(()=>{
      try{
        if(document.hidden) return;
        if((state.bannerPages||[]).length<2) return;
        if(state.bannerManualAt&&Date.now()-state.bannerManualAt<14000) return;
        if(!document.querySelector('#bannerPager:not(.hidden)')) return;
        bannerPageMove(1,true);
      }catch(e){}
    },7000);
  }
  function refundStatusLabel(s){
    return s==='pending'?'대기 중':s==='approved'?'승인됨':s==='done'?'처리 완료':s==='rejected'?'반려됨':s==='refunded'?'환불·폐기':s==='revoked'?'회수됨':s==='expired'?'만료':s==='active'?'이용 중':s==='issued'?'미사용':(s||'대기 중');
  }
  function formatKRWInput(el){
    if(!el) return;
    const digits = String(el.value||'').replace(/[^0-9]/g,'').slice(0,12);
    el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  }
  function parseKRW(v){ return Number(String(v||'').replace(/[^0-9]/g,''))||0; }
  // 넷플릭스 건너뛰기식 5초 슬라이드 버튼: 색이 차오르며 카운트다운 후 활성화
  function wireCountdownButton(btn, sec, doneLabel){
    if(!btn) return;
    const total = Math.max(1, Number(sec)||5);
    btn.disabled = true;
    btn.classList.add('countdown');
    const label = btn.dataset.label || btn.textContent || '확인';
    let left = total;
    const paint = () => {
      const p = ((total-left)/total)*100;
      btn.style.setProperty('--cd-p', p.toFixed(1)+'%');
      btn.innerHTML = `<span class="cd-fill"></span><span class="cd-text">${esc(label)} (${left}초)</span>`;
    };
    paint();
    const timer = setInterval(()=>{
      left -= 1;
      if(left <= 0){
        clearInterval(timer);
        btn.disabled = false;
        btn.classList.remove('countdown');
        btn.classList.add('countdown-ready');
        // 차오른 흰색 게이지가 버튼을 안개 낀 것처럼 덮지 않게 치운다
        btn.style.removeProperty('--cd-p');
        btn.innerHTML = `<span class="cd-text">${esc(doneLabel||label)}</span>`;
        return;
      }
      paint();
    }, 1000);
  }
  // 중요 작업(개인정보·돈) 공통 확인: 문구 입력 + 5초 슬라이드 버튼
  function openDangerConfirm(opts){
    const o = opts || {};
    const requireText = String(o.requireText||'');
    const sec = o.seconds||5;
    const panel = openModal(`<h2>${esc(o.title||'정말 진행할까요?')}</h2><p class="desc">${esc(o.desc||'되돌릴 수 없어요.')}</p>
      ${requireText?`<div class="field"><label>확인을 위해 아래 문구를 그대로 입력해 주세요.</label><div class="confirm-phrase">“${esc(requireText)}”</div><input id="dangerText" class="input" autocomplete="off" placeholder="${esc(requireText)}"></div>
      <label class="consent" style="margin-top:4px"><input type="checkbox" id="dangerCheck"><span>${esc(o.checkLabel||'위 내용을 이해했고, 진행해도 됩니다.')}</span></label>`:''}
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="dangerGo" data-label="${esc(o.confirmLabel||'진행하기')}">${esc(o.confirmLabel||'진행하기')}</button></div>`, {small:true});
    const go = panel.querySelector('#dangerGo');
    wireCountdownButton(go, sec, o.confirmLabel||'진행하기');
    const textEl = panel.querySelector('#dangerText');
    const checkEl = panel.querySelector('#dangerCheck');
    if(textEl) textEl.addEventListener('input', ()=>{
      if(!go) return;
      const okText = textEl.value.trim() === requireText;
      const okCheck = checkEl ? checkEl.checked : true;
      if(!okText || !okCheck){ go.dataset.blocked='1'; }
      else { delete go.dataset.blocked; }
    });
    if(checkEl) checkEl.addEventListener('change', ()=>{
      if(!textEl || textEl.value.trim() === requireText){ if(checkEl.checked) delete go.dataset.blocked; else go.dataset.blocked='1'; }
    });
    if(requireText && go) go.dataset.blocked='1';
    if(go) go.onclick = async ()=>{
      if(go.disabled) return;
      if(go.dataset.blocked) return toast(requireText ? '문구를 정확히 입력하고, 확인에 체크해 주세요.' : '5초 뒤에 눌러 주세요.');
      try{ await o.onConfirm(); closeModal(); }catch(e){ console.error(e); toast(errText(e)); }
    };
  }
  // ---------- 채팅 링크: 자동 링크화 + 외부경고 + 미리보기(그라데이션 카드) ----------
  const LINK_PREVIEW_CACHE = new Map();
  function extractUrls(t){
    const out = [];
    try{
      const re = /https?:\/\/[^\s<>"')\]]+/gi;
      let m;
      while((m = re.exec(String(t||''))) && out.length < 3){ out.push(m[0].replace(/[.,!?;:)\]]+$/,'')); }
    }catch(e){}
    return [...new Set(out)].slice(0,3);
  }
  function linkifyChatText(t){
    const safe = esc(t).replace(/@([^\s@<>&]{1,20})/g,'<span class="mention">@$1</span>');
    return safe.replace(/https?:\/\/[^\s<>"')\]]+/gi, (url)=>{
      const clean = String(url).replace(/[.,!?;:)\]]+$/,'');
      const trail = String(url).slice(clean.length);
      if(!/^https?:\/\//i.test(clean)) return url;
      return `<a href="#" class="chat-link" data-action="ext-link" data-url="${esc(clean)}" rel="noopener">${esc(clean)}</a>${esc(trail)}`;
    });
  }
  function linkPreviewCardHtml(url){
    let domain = '';
    try{ domain = new URL(url).hostname; }catch(e){ domain = url; }
    const cached = LINK_PREVIEW_CACHE.get(url);
    const title = cached?.title || '페이지 여는 중…';
    const desc = cached?.description || domain;
    const img = cached?.image ? `<span class="lp-img"><img src="${esc(cached.image)}" alt="" loading="lazy"></span>` : '';
    return `<button type="button" class="link-preview" data-action="ext-link" data-url="${esc(url)}"><span class="grow"><span class="lp-domain">${esc(domain)}</span><span class="lp-title">${esc(title)}</span><span class="lp-desc">${esc(desc)}</span></span>${img}</button>`;
  }
  async function fetchLinkPreview(url){
    if(LINK_PREVIEW_CACHE.has(url)) return LINK_PREVIEW_CACHE.get(url);
    try{
      const r = await fetch('https://api.microlink.io?url='+encodeURIComponent(url), { cache:'force-cache' });
      const j = await r.json();
      const d = j?.data || {};
      const rawImg = String(d.image?.url||'');
      const info = { title: String(d.title||'').slice(0,80) || url, description: String(d.description||'').slice(0,120) || '', image: (/^https:\/\//i.test(rawImg) ? rawImg.slice(0,500) : '') };
      LINK_PREVIEW_CACHE.set(url, info);
      return info;
    }catch(e){
      let domain=''; try{ domain=new URL(url).hostname; }catch(_){ domain=url; }
      const info = { title: domain, description: url, image: '' };
      LINK_PREVIEW_CACHE.set(url, info);
      return info;
    }
  }
  function enhanceLinkPreviews(root){
    try{
      const cards = (root||document).querySelectorAll('.link-preview[data-url]');
      cards.forEach((card)=>{
        const url = card.dataset.url||'';
        if(!url || card.dataset.loaded) return;
        card.dataset.loaded='1';
        fetchLinkPreview(url).then((info)=>{
          const t = card.querySelector('.lp-title'); if(t) t.textContent = info.title||url;
          const d = card.querySelector('.lp-desc'); if(d) d.textContent = info.description||url;
          if(info.image && !card.querySelector('.lp-img')){
            const s = document.createElement('span'); s.className='lp-img';
            const im = document.createElement('img'); im.src=info.image; im.alt=''; im.loading='lazy';
            im.onerror=()=>{ try{s.remove();}catch(e){} };
            s.appendChild(im); card.appendChild(s);
          }
        }).catch(()=>{});
      });
    }catch(e){}
  }
  function openExternalLinkConfirm(url){
    const u = String(url||'').trim();
    if(!/^https?:\/\//i.test(u)) return toast('주소를 확인해 주세요.');
    openModal(`<h2>외부 웹사이트로 이동해요</h2><p class="desc">다른 웹사이트로 이동하려 하고 있어요.<br>웹사이트로 이동하고 나서 생기는 일은 에듀톡이 책임지지 않아요.</p>
      <div class="report-detail">${esc(u)}</div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="extGo">이동하기</button></div>`, {small:true});
    wireCountdownButton(document.getElementById('extGo'), 2, '이동하기');
    document.getElementById('extGo').onclick = ()=>{
      const b = document.getElementById('extGo');
      if(b && b.disabled) return;
      closeModal();
      try{ window.open(u,'_blank','noopener'); }catch(e){}
    };
  }
  // 메뉴 항목이 눌렸을 때 할 일
  const LANDING_ACTIONS = [['page','안내 페이지 열기'],['url','주소 열기'],['scroll','페이지 안 이동'],['login','로그인 화면'],['signup','회원가입 화면']];
  const LANDING_ACTION_OK = LANDING_ACTIONS.map(a=>a[0]);
  const DEFAULT_LANDING_NAV = [
    { label:'다운로드', type:'menu', items:[
      { label:'윈도우 앱 소개·다운로드', action:'page', value:'windows-guide' },
      { label:'안드로이드 앱 (준비 중)', action:'url', value:'' }
    ] },
    { label:'문의하기', type:'menu', items:[
      { label:'학교 등록', action:'page', value:'school' },
      { label:'교사 인증 안내', action:'page', value:'teacher-guide' },
      { label:'개발자에게 문의', action:'url', value:'mailto:pupp0749@gmail.com' }
    ] },
    { label:'이용하기', type:'link', action:'login', value:'' }
  ];
  const DEFAULT_LANDING = {
    enabled: true,
    brandName: '에듀톡',
    brandMark: 'E',
    brandTexts: ['에듀톡'],
    loginLabel: '로그인',
    signupLabel: '회원가입',
    nav: DEFAULT_LANDING_NAV,
    hero: {
      badge: '학교 전용 메신저',
      title: '학교 안에서',
      // 로그인 화면 히어로와 같은 회전 문구 (앞부분은 그대로 두고 이 말만 스르륵 바뀐다)
      rollWords: ['멋지게 대화해요','편하게 대화해요','멋지게 고민해요','편하게 고민해요','멋지게 질문해요','편하게 질문해요','편하게 생활해요','멋지게 생활해요'],
      desc: '선생님이 알려준 학교 코드로 가입하는 우리 학교 전용 메신저예요. 모둠·동아리·개인 대화부터 사진과 파일 전송까지, 학교 밖으로 새지 않고 안전하게 쓸 수 있어요.',
      primaryLabel: '로그인하고 시작하기',
      primaryAction: 'login',
      secondaryLabel: '기능 살펴보기',
      secondaryTarget: 'features'
    },
    // 첫 화면 오른쪽의 채팅 미리보기 (프리셋을 여러 개 두면 일정 간격마다 스르륵 바뀐다)
    mock: {
      enabled: true,
      title: '우리반 모둠방',
      caption: '',
      intervalSec: 7,
      chatStyle: 'typing',
      presets: [
        { name:'준비물', messages:[
          { side:'left', avatar:'민', text:'오늘 준비물 뭐야?' },
          { side:'right', avatar:'', text:'체육복!' },
          { side:'left', avatar:'서', text:'안내 사진도 올려줄게.' }
        ] },
        { name:'질문', messages:[
          { side:'left', avatar:'준', text:'선생님, 이 문제 다시 설명해 주실 수 있어요?' },
          { side:'right', avatar:'', text:'나도 궁금했어!' },
          { side:'left', avatar:'민', text:'질문은 개인 메시지로 보내도 돼.' }
        ] },
        { name:'동아리', messages:[
          { side:'left', avatar:'서', text:'오늘 동아리 5시에 모여!' },
          { side:'right', avatar:'', text:'확인! 준비물 있어?' },
          { side:'left', avatar:'서', text:'노트랑 필기도구만 챙겨 오면 돼.' }
        ] }
      ]
    },
    featuresTitle: '이런 걸 할 수 있어요',
    featuresDesc: '학교 생활에 필요한 대화 기능을 한 곳에 모았어요.',
    features: [
      { icon:'💬', title:'모둠·동아리 대화방', desc:'학급·모둠·동아리별로 방을 만들어 우리끼리만 대화해요.' },
      { icon:'🙋', title:'선생님께 질문', desc:'개인 메시지로 담당 선생님께 편하게 질문할 수 있어요.' },
      { icon:'🔒', title:'학교 코드로 안전하게', desc:'학교 코드가 있어야 가입할 수 있어 우리 학교 학생만 들어와요.' },
      { icon:'🖼️', title:'사진·파일 전송', desc:'과제 사진이나 학습 자료를 채팅방에서 바로 주고받아요.' },
      { icon:'🔔', title:'새 메시지 알림', desc:'새 메시지가 오면 소리와 알림으로 바로 알려 줘요.' },
      { icon:'🌐', title:'학교 간 대화 공유', desc:'선생님 승인을 받으면 다른 학교와도 함께 대화할 수 있어요.' }
    ],
    stepsTitle: '이렇게 시작해요',
    stepsDesc: '학교 코드만 있으면 1분이면 시작할 수 있어요.',
    steps: [
      { title:'선생님께 학교 코드 받기', desc:'우리 학교 담당 선생님께 가입 코드를 받아요.' },
      { title:'계정 만들기', desc:'이메일과 학교 코드, 학년·반을 입력하고 가입해요.' },
      { title:'대화 시작하기', desc:'방을 만들거나 초대를 받아 친구들과 이야기해요.' }
    ],
    pricingTitle: '요금 안내',
    pricingDesc: '학교 단위로 1년씩 이용하는 디지털 이용권이에요. 실결제 연동 전이라 금액은 확정 후 공개돼요.',
    pricing: [
      { name:'학교 1년 이용권', period:'1년', price:'금액 미정', desc:'학교 전체가 1년간 쓰는 기본 이용권이에요. 고유코드+인증코드로 등록 후 이용개시일부터 1년.', cta:'구매 문의' },
      { name:'무료 체험', period:'1일·10일', price:'0원', desc:'총관리자가 발급하는 체험용 이용권이에요. 필요하면 개발자에게 문의해 주세요.', cta:'문의하기' }
    ],
    ctaTitle: '우리 학교에서도 에듀톡을 써 보세요',
    ctaDesc: '선생님이 학교를 등록하면 학생들이 학교 코드로 바로 가입할 수 있어요.',
    ctaButton: '로그인 / 회원가입',
    footerText: '에듀톡은 학교 안에서만 쓰는 전용 메신저예요.',    businessInfo: ''
  };
  const landingTargetOk = (t) => LANDING_TARGETS.some(([v]) => v === t);
  const cloneLanding = () => JSON.parse(JSON.stringify(DEFAULT_LANDING));
  // 메뉴 항목 하나를 정리한다 (누르면 무엇을 할지 + 값)
  function normalizeLandingLink(n){
    const action = LANDING_ACTION_OK.includes(n?.action) ? n.action : 'page';
    const out = { label:String(n?.label??'').trim().slice(0,20), action, value:'' };
    if(action==='url') out.value = String(n?.value??'').trim().slice(0,PAGE_BTN_URL_MAX);
    else if(action==='page') out.value = String(n?.value??'').trim().slice(0,40);
    else if(action==='scroll') out.value = landingTargetOk(n?.value) ? n.value : 'top';
    return out;
  }
  // 예전 형식(기능·이용 방법·시작하기 링크)은 쓰지 않고 새 기본 메뉴로 바꾼다
  function normalizeLandingNav(v, fb){
    const list = (Array.isArray(v) && (v.length===0 || v.some(n=>n && (n.action||n.type)))) ? v : fb;
    return list.slice(0,5).map(n=>{
      const out = normalizeLandingLink(n);
      out.type = n?.type==='menu' ? 'menu' : 'link';
      out.items = out.type==='menu'
        ? (Array.isArray(n?.items)?n.items:[]).slice(0,5).map(normalizeLandingLink).filter(x=>x.label)
        : [];
      if(out.type==='menu' && !out.items.length) out.type='link';
      return out;
    }).filter(n=>n.label);
  }
  // 저장된 값(또는 기본값)을 화면에 쓰기 좋은 형태로 정리한다
  function normalizeLanding(d){
    const b = cloneLanding();
    if (!d || typeof d !== 'object') return b;
    const req = (v,fb,max) => { const s=String(v??'').trim(); return s ? s.slice(0,max) : fb; };
    const opt = (v,fb,max) => (v===undefined||v===null) ? fb : String(v).trim().slice(0,max);
    const list = (v,fb,max) => Array.isArray(v) ? v.slice(0,max) : fb;
    const hero = d.hero || {};
    const mock = d.mock || {};
    // 브랜드 이름은 여러 개를 넣으면 번갈아 나온다 (첫 번째를 대표 이름으로 쓴다)
    const brandTexts = (Array.isArray(d.brandTexts) ? d.brandTexts : [d.brandName])
      .map(w=>String(w??'').trim().slice(0,20)).filter(Boolean).slice(0,6);
    const names = brandTexts.length ? brandTexts : b.brandTexts.slice();
    const brandMark = (String(opt(d.brandMark, b.brandMark, 2)).trim() || b.brandMark).slice(0,2);
    return {
      enabled: d.enabled !== false,
      brandName: names[0],
      brandMark,
      brandTexts: names,
      loginLabel: req(d.loginLabel, b.loginLabel, 16),
      signupLabel: req(d.signupLabel, b.signupLabel, 16),
      nav: normalizeLandingNav(d.nav, b.nav),
      hero: {
        badge: opt(hero.badge, b.hero.badge, 30),
        title: req(hero.title, b.hero.title, 70),
        rollWords: (Array.isArray(hero.rollWords) ? hero.rollWords : b.hero.rollWords).slice(0,8).map(w=>String(w??'').trim().slice(0,24)).filter(Boolean),
        desc: req(hero.desc, b.hero.desc, 240),
        primaryLabel: req(hero.primaryLabel, b.hero.primaryLabel, 20),
        primaryAction: hero.primaryAction === 'signup' ? 'signup' : 'login',
        secondaryLabel: opt(hero.secondaryLabel, b.hero.secondaryLabel, 20),
        secondaryTarget: landingTargetOk(hero.secondaryTarget) ? hero.secondaryTarget : 'features'
      },
      mock: {
        enabled: mock.enabled !== false,
        title: req(mock.title, b.mock.title, 24),
        caption: opt(mock.caption, b.mock.caption, 120),
        intervalSec: Math.min(30, Math.max(3, Math.round(Number(mock.intervalSec) || b.mock.intervalSec))),
        chatStyle: mock.chatStyle === 'fade' ? 'fade' : 'typing',
        presets: list(mock.presets, b.mock.presets, 5).map(p=>({
          name: String(p?.name??'').trim().slice(0,20),
          messages: (Array.isArray(p?.messages)?p.messages:[]).slice(0,6).map(m=>({
            side: m?.side === 'right' ? 'right' : 'left',
            avatar: String(m?.avatar??'').trim().slice(0,4),
            text: String(m?.text??'').trim().slice(0,60)
          }))
        }))
      },
      featuresTitle: opt(d.featuresTitle, b.featuresTitle, 40),
      featuresDesc: opt(d.featuresDesc, b.featuresDesc, 120),
      features: list(d.features, b.features, 6).map(f=>({ icon:String(f?.icon??'').trim().slice(0,4), title:String(f?.title??'').trim().slice(0,30), desc:String(f?.desc??'').trim().slice(0,120) })),
      stepsTitle: opt(d.stepsTitle, b.stepsTitle, 40),
      stepsDesc: opt(d.stepsDesc, b.stepsDesc, 120),
      steps: list(d.steps, b.steps, 4).map(f=>({ title:String(f?.title??'').trim().slice(0,40), desc:String(f?.desc??'').trim().slice(0,140) })),
      pricingTitle: opt(d.pricingTitle, b.pricingTitle, 40),
      pricingDesc: opt(d.pricingDesc, b.pricingDesc, 160),
      pricing: list(d.pricing, b.pricing, 4).map(f=>({ name:String(f?.name??'').trim().slice(0,30), period:String(f?.period??'').trim().slice(0,20), price:String(f?.price??'').trim().slice(0,20), desc:String(f?.desc??'').trim().slice(0,160), cta:String(f?.cta??'').trim().slice(0,20) })),
      ctaTitle: req(d.ctaTitle, b.ctaTitle, 60),
      ctaDesc: opt(d.ctaDesc, b.ctaDesc, 140),
      ctaButton: req(d.ctaButton, b.ctaButton, 20),
      footerText: opt(d.footerText, b.footerText, 160),
      // 6번: 사업자 정보 — 줄바꿈 가능, 글자수 제한 없음
      businessInfo: String(d.businessInfo ?? b.businessInfo ?? '').replace(/\r/g,'')
    };
  }
  function landingCfg(){ return state.landing || cloneLanding(); }
  function landingEnabled(){ return landingCfg().enabled !== false; }

  // ---------- 브랜드(로고 글자 · 이름) ----------
  // 관리자 도구 → 소개 페이지에서 수정한다. 이름을 2개 이상 넣으면 번갈아 나온다.
  function brandMarkText(){ return String(landingCfg().brandMark||'E').slice(0,2)||'E'; }
  // 기본값(E)이면 말풍선+학사모 SVG 로고, 관리자가 글자를 바꾸면 그 글자를 보여준다
  // 흰 말풍선(채팅) 안에 남색 학사모(학교·에듀)를 넣어 길거리에서도 바로 에듀톡으로 읽히게 했다
  const EDU_LOGO_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="edumark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3F9BFF"/><stop offset="1" stop-color="#2472CE"/></linearGradient></defs><rect width="48" height="48" rx="12" fill="url(#edumark)"/><rect x="8" y="11" width="32" height="22" rx="7" fill="#fff"/><path d="M14 33 L11.5 39.5 L19.5 33.2 Z" fill="#fff"/><path d="M24 15.5 L34.5 20 L24 24.5 L13.5 20 Z" fill="#2472CE"/><path d="M17.5 22.6 v3.1 c0 1.9 13 1.9 13 0 v-3.1 L24 25.4 Z" fill="#17538F"/><rect x="32.8" y="20" width="1.5" height="6" rx="0.75" fill="#17538F"/><circle cx="33.5" cy="27.2" r="1.4" fill="#17538F"/></svg>';
  function brandMarkHtml(){ const t=brandMarkText(); return t==='E' ? EDU_LOGO_SVG : esc(t); }
  function brandNames(){
    const c=landingCfg();
    const list=Array.isArray(c.brandTexts)&&c.brandTexts.length?c.brandTexts:[c.brandName||'에듀톡'];
    return list.map(n=>String(n||'').trim()).filter(Boolean).slice(0,6);
  }
  let brandRollTimer=null, brandRollIdx=0;
  function stopBrandRotate(){ if(brandRollTimer){ clearInterval(brandRollTimer); brandRollTimer=null; } }
  function startBrandRotate(){
    stopBrandRotate();
    const names=brandNames();
    if(names.length<2) return;   // 1개면 그대로 고정
    brandRollIdx=0;
    brandRollTimer=setInterval(()=>{
      const list=brandNames();
      if(list.length<2){ stopBrandRotate(); return; }
      brandRollIdx=(brandRollIdx+1)%list.length;
      const el=document.querySelector('[data-brand-roll]');
      if(!el) return;
      // 사라질 때 위로 스르륵, 나타날 때 아래에서 스르륵 (숨쉬듯 전환)
      el.classList.remove('roll-in','roll-out'); void el.offsetWidth; el.classList.add('roll-out');
      setTimeout(()=>{
        const cur=document.querySelector('[data-brand-roll]');
        if(!cur) return;
        cur.textContent=list[brandRollIdx];
        cur.classList.remove('roll-out'); void cur.offsetWidth; cur.classList.add('roll-in');
      },260);
    },3600);
  }

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  // 이미지 표시용 주소: 앱이 만든 data:image/* 또는 https 주소만 통과시킨다.
  // (javascript: · data:text/html 같은 실행 가능한 스킴을 원천 차단)
  const IMG_DATA_RE = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i;
  const safeImgSrc = (v) => { const s=String(v??'').trim(); if(IMG_DATA_RE.test(s)) return s; return /^https:\/\//i.test(s) ? s : ''; };
  // 파일 내려받기용 주소: 실행 스킴과 문서형 data 는 막는다 (download 속성이 무시되고 렌더될 수 있어서)
  // 10번 강화: base64 없는 data: URL도 차단 (스크립트 인젝션 원천 차단)
  const BLOCKED_DATA_RE = /^data:(?:text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/ecmascript)/i;
  const safeFileHref = (v) => {
    const s=String(v??'').trim(); if(!s) return '';
    if(/^https:\/\//i.test(s)) return s;
    if(/^data:/i.test(s)){
      if(BLOCKED_DATA_RE.test(s)) return '';
      if(!/;base64,/i.test(s)) return '';
      return s;
    }
    return '';
  };
  // 외부 링크는 http(s) · mailto · tel · 사이트 내부(/…) 만 허용한다 (파일 다운로드 포함)
  const openSafeLink = (raw) => {
    const u=String(raw??'').trim(); if(!u) return false;
    if(/^https?:\/\//i.test(u)){ try{ window.open(u,'_blank','noopener'); }catch(e){} return true; }
    if(/^(?:mailto:|tel:)/i.test(u)){ try{ location.href=u; }catch(e){} return true; }
    if(/^\/(?!\/)/.test(u)){
      try{
        if(/\.(exe|msi|zip|dmg|apk|pdf)$/i.test(u)){
          const a=document.createElement('a'); a.href=u; a.download=''; document.body.appendChild(a); a.click(); a.remove();
        } else window.open(u,'_blank','noopener');
      }catch(e){}
      return true;
    }
    toast('주소를 확인해 주세요.');
    return false;
  };
  const uid = () => auth.currentUser?.uid || '';
  // 이벤트 리스너 안에서 async 함수를 안전하게 실행한다 (거부된 Promise가 앱을 멈추지 않게)
  const runAsync = (fn) => { try { const r=fn(); if(r && typeof r.catch==='function') r.catch(e=>console.error(e)); } catch(e){ console.error(e); } };
  const isAdmin = () => state.profile?.role === 'admin';
  const isSchoolAdmin = () => state.profile?.role === 'school_admin';
  const isTeacher = () => state.profile?.role === 'teacher' || isAdmin() || isSchoolAdmin();
  // 2번 수정: 일정 버튼 등이 호출하는 isTeacherOrAdmin이 정의돼 있지 않아 ReferenceError로 모달이 안 떴음
  const isTeacherOrAdmin = () => isTeacher() || isAdmin() || isSchoolAdmin();
  const canModerate = () => isAdmin() || state.profile?.role === 'teacher' || isSchoolAdmin();
  const canManageSchool = () => isAdmin() || isSchoolAdmin() || state.profile?.role === 'teacher';
  const nowMs = () => Date.now();
  const ts = () => firebase.firestore.FieldValue.serverTimestamp();
  // 지워진 채팅은 즉시 파기하지 않고 30일 보관한 뒤 TTL이 영구 파기한다
  const RETENTION_DAYS = 30;
  const expireTs = (days=RETENTION_DAYS) => firebase.firestore.Timestamp.fromMillis(Date.now() + days*86400000);
  const softDeletePatch = (byUid) => ({ deleted:true, deleted_at:ts(), expire_at:expireTs(), deleted_by:byUid||uid() });
  const docTs = (v) => v?.toDate ? v.toDate().getTime() : (v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : 0));
  const timeText = (v) => v?.toDate ? v.toDate().toLocaleTimeString('ko-KR', {hour:'numeric',minute:'2-digit'}) : '';
  const dateText = (v) => v?.toDate ? v.toDate().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'}) : '';
  const roleLabel = r => r === 'admin' ? '총관리자' : r === 'school_admin' ? '학교 관리자' : r === 'teacher' ? '교사' : '학생';
  // 학년·반 표기 (반 정보가 없으면 'null반'이 아니라 학년까지만 보여준다)
  function gradeClassLabel(p){
    const g=Number(p?.grade)||0, c=Number(p?.classNum)||0;
    if(!g) return '';
    return c?`${g}학년 ${c}반`:`${g}학년`;
  }
  function gradeClassPrefix(p){ const s=gradeClassLabel(p); return s?s+' · ':''; }
  // publicProfiles 쓰기는 항상 내 역할(role)을 함께 보낸다.
  // → 문서가 아직 없을 때(생성)와 역할 표시가 어긋났을 때 모두 규칙을 통과한다.
  // 10번 강화: 개발자도구에서 putPublicProfile({role:'admin', suspended:false}) 같은 임의 키 주입을 막기 위해 허용 키만 통과
  const PUBLIC_PROFILE_KEYS=['displayName','grade','classNum','photoURL','photoFlagged','avatarEmoji','avatarColor','bio','schoolId','schoolName','invitePolicy','presence','updatedAt'];
  const putPublicProfile = (patch) => {
    const clean={};
    try{ Object.keys(patch||{}).forEach(k=>{ if(PUBLIC_PROFILE_KEYS.includes(k)) clean[k]=patch[k]; }); }catch(e){}
    return db.collection('publicProfiles').doc(uid()).set({...clean, role:state.profile?.role||'student'}, {merge:true});
  };
  const toast = (text) => {
    clearTimeout(toastEl._timer);
    toastEl.textContent = text;
    toastEl.classList.remove('show');
    requestAnimationFrame(() => toastEl.classList.add('show'));
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  };
  const errText = (e) => {
    const c = e?.code || '';
    const map = {
      'auth/wrong-password':'비밀번호가 맞지 않아요.',
      'auth/invalid-credential':'이메일이나 비밀번호를 다시 확인해 주세요.',
      'auth/email-already-in-use':'이미 사용 중인 이메일이에요.',
      'auth/invalid-email':'이메일 형식을 확인해 주세요.',
      'auth/weak-password':'비밀번호를 조금 더 길게 만들어 주세요.',
      'auth/popup-closed-by-user':'로그인을 취소했어요.',
      'auth/popup-blocked':'팝업이 차단되고 있어요. 팝업 차단을 해제해 주세요.',
      'auth/cancelled-popup-request':'다시 시도해 주세요.',
      'auth/unauthorized-continue-uri':'이메일 인증 주소가 허용되지 않았어요. 총관리자에게 문의해 주세요. 재직증명서로도 신청할 수 있어요.',
      'auth/operation-not-allowed':'이메일 인증 기능이 꺼져 있어요. 총관리자에게 문의해 주세요. 재직증명서로도 신청할 수 있어요.',
      'auth/quota-exceeded':'요청이 많아요. 잠시 뒤에 다시 시도해 주세요.',
      'auth/invalid-continue-uri':'이메일 인증 주소가 잘못됐어요. 총관리자에게 문의해 주세요.',
      'auth/network-request-failed':'인터넷 연결이 불안정해요. 나중에 다시 시도해 주세요.',
      'auth/user-not-found':'가입되지 않은 이메일이에요.',
      'auth/too-many-requests':'너무 많이 시도했어요. 잠시 뒤에 다시 시도해 주세요.',
      'unavailable':'인터넷 연결이 불안정해요. 나중에 다시 시도해 주세요.',
      'deadline-exceeded':'인터넷 연결이 불안정해요. 나중에 다시 시도해 주세요.',
      'permission-denied':'권한이 없어요.'
    };
    return map[c] || (c === 'permission-denied' ? '권한이 없어요.' : '잠시 문제가 생겼어요.');
  };

  const safeColor = (c, fallback='') => /^#[0-9a-fA-F]{6}$/.test(String(c||'')) ? String(c) : fallback;
  const safeAlign = (a) => (a==='center'||a==='right') ? a : 'left';
  const clampSize = (n,min,max,def) => { const v=Number(n); return (v>=min&&v<=max) ? Math.round(v) : def; };
  const fmtDateTime = (v) => { const t=docTs(v); return t ? new Date(t).toLocaleString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-'; };
  const RICH_TAGS = new Set(['B','STRONG','I','EM','U','S','STRIKE','A','BR','DIV','P','FONT','SPAN','SUB','SUP','H1','H2','H3','UL','OL','LI','BLOCKQUOTE','HR','PRE','CODE','TABLE','THEAD','TBODY','TR','TH','TD','IMG','FIGURE','FIGCAPTION']);
  function sanitizeRichHtml(html){
    if(!html || typeof html!=='string') return '';
    const root=document.createElement('div');
    root.innerHTML=html;
    (function clean(node){
      [...node.childNodes].forEach(child=>{
        if(child.nodeType===8){ child.remove(); return; }
        if(child.nodeType!==1) return;
        if(!RICH_TAGS.has(child.tagName)){
          while(child.firstChild) node.insertBefore(child.firstChild,child);
          child.remove();
          return;
        }
        [...child.attributes].forEach(attr=>{
          const name=attr.name.toLowerCase();
          if(child.tagName==='A' && name==='href' && /^(?:https?:|mailto:|tel:|\/(?!\/))/i.test(attr.value)) return;
          if(child.tagName==='IMG' && name==='src'){
            const v=String(attr.value||'').trim();
            if(/^https:\/\//i.test(v) || /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(v)) return;
          }
          if(child.tagName==='IMG' && (name==='alt'||name==='loading')) return;
          if((child.tagName==='TH'||child.tagName==='TD') && (name==='colspan'||name==='rowspan')) return;
          if(child.tagName==='FONT' && (name==='color'||name==='size')) return;
          if((child.tagName==='SPAN'||child.tagName==='FONT'||child.tagName==='IMG'||child.tagName==='P'||child.tagName==='DIV'||child.tagName==='H1'||child.tagName==='H2'||child.tagName==='H3') && name==='style'){
            const keep=[];
            const mColor=/(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(attr.value);
            if(mColor) keep.push('color:'+mColor[1].trim());
            const mAlign=/(?:^|;)\s*text-align\s*:\s*(left|center|right)/i.exec(attr.value);
            if(mAlign) keep.push('text-align:'+mAlign[1].toLowerCase());
            if(child.tagName==='IMG'){
              const mW=/(?:^|;)\s*max-width\s*:\s*([^;]+)/i.exec(attr.value);
              if(mW) keep.push('max-width:'+mW[1].trim());
              const mW2=/(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(attr.value);
              if(mW2) keep.push('width:'+mW2[1].trim());
            }
            if(keep.length){ attr.value=keep.join(';'); return; }
            else child.removeAttribute('style');
            return;
          }
          child.removeAttribute(name);
        });
        clean(child);
      });
    })(root);
    return root.innerHTML;
  }
  async function fetchClientIp(){
    const urls=['https://api.ipify.org?format=json','https://api64.ipify.org?format=json'];
    for(const u of urls){
      try{
        const ctl=new AbortController();
        const timer=setTimeout(()=>ctl.abort(),4000);
        const res=await fetch(u,{signal:ctl.signal,cache:'no-store'});
        clearTimeout(timer);
        if(!res.ok) continue;
        const j=await res.json();
        if(j&&j.ip) return String(j.ip).slice(0,60);
      }catch(e){}
    }
    return '';
  }

  function applyFontSize() {
    document.body.classList.remove('font-sm','font-lg','font-xl');
    if (state.settings.fontSize !== 'md') document.body.classList.add(`font-${state.settings.fontSize}`);
  }

  const THEME_KEY = 'edutalk_theme';
  function currentTheme(){
    const t=state.settings?.theme;
    if(t==='light'||t==='dark'||t==='system') return t;
    try{ const s=localStorage.getItem(THEME_KEY); if(s==='light'||s==='dark'||s==='system') return s; }catch(e){}
    return 'system';
  }
  function systemPrefersDark(){
    try{ return window.matchMedia('(prefers-color-scheme: dark)').matches; }catch(e){ return false; }
  }
  function applyTheme(){
    const t=currentTheme();
    const dark = t==='dark' || (t==='system' && systemPrefersDark());
    document.documentElement.classList.toggle('dark',dark);
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content',dark?'#131518':'#ffffff');
  }
  function setTheme(t){
    if(t!=='light'&&t!=='dark'&&t!=='system') return;
    state.settings.theme=t;
    try{ localStorage.setItem(THEME_KEY,t); }catch(e){}
    applyTheme();
  }
  try{
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{ if(currentTheme()==='system') applyTheme(); });
  }catch(e){}

  /* ---------- 알림음 (Web Audio로 직접 합성) ---------- */
  let audioCtx = null;
  function getAudioCtx(){
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended') audioCtx.resume().catch(()=>{});
      return audioCtx;
    }catch(e){ return null; }
  }
  function tone(ctx,{freq,dur=.16,type='sine',gain=.16,when=0,slideTo=null}){
    const t0=ctx.currentTime+when;
    const osc=ctx.createOscillator(), g=ctx.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(freq,t0);
    if(slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40,slideTo),t0+dur);
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(gain,t0+.012);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t0); osc.stop(t0+dur+.03);
  }
  const SOUNDS = [
    {id:'dingdong',name:'딩동',play:c=>{tone(c,{freq:880,dur:.13});tone(c,{freq:1320,dur:.2,when:.12});}},
    {id:'ting',name:'띠링',play:c=>{tone(c,{freq:1568,dur:.09,type:'triangle'});tone(c,{freq:2093,dur:.14,type:'triangle',when:.07});}},
    {id:'pop',name:'뽀잉',play:c=>{tone(c,{freq:420,dur:.14,slideTo:900});}},
    {id:'coin',name:'코인',play:c=>{tone(c,{freq:988,dur:.07,type:'square',gain:.1});tone(c,{freq:1319,dur:.24,when:.07,gain:.13});}},
    {id:'bubble',name:'보글',play:c=>{tone(c,{freq:300,dur:.16,type:'triangle',slideTo:620});tone(c,{freq:520,dur:.14,type:'triangle',when:.11,slideTo:880});}},
    {id:'bell',name:'종',play:c=>{tone(c,{freq:659,dur:.5,gain:.12});tone(c,{freq:988,dur:.42,gain:.07,when:.02});}},
    {id:'knock',name:'노크',play:c=>{tone(c,{freq:180,dur:.06,type:'square',gain:.13});tone(c,{freq:180,dur:.06,type:'square',gain:.13,when:.12});tone(c,{freq:200,dur:.07,type:'square',gain:.13,when:.24});}},
    {id:'twinkle',name:'반짝',play:c=>{tone(c,{freq:784,dur:.1});tone(c,{freq:988,dur:.1,when:.08});tone(c,{freq:1319,dur:.2,when:.16});}},
    {id:'soft',name:'조용히',play:c=>{tone(c,{freq:523,dur:.24,gain:.1});tone(c,{freq:659,dur:.26,gain:.07,when:.05});}},
    {id:'alert',name:'알림',play:c=>{tone(c,{freq:740,dur:.11,gain:.14});tone(c,{freq:740,dur:.11,gain:.14,when:.14});tone(c,{freq:988,dur:.2,gain:.14,when:.28});}}
  ];
  const soundName = (id) => { const s=SOUNDS.find(x=>x.id===id)||SOUNDS[0]; return s?s.name:''; };
  function playSound(id){
    const s=SOUNDS.find(x=>x.id===id)||SOUNDS[0]; if(!s) return;
    const ctx=getAudioCtx(); if(!ctx) return;
    try{ s.play(ctx); }catch(e){ console.error('sound',e); }
  }
  function getDesktopUnread(){
    const d=(state.settings&&state.settings.desktopUnread)||{};
    return { enabled: !!d.enabled, interval: (d.interval===10?10:5), sound: !!d.sound, soundId: d.soundId||'bell' };
  }
  function getTotalUnread(){
    try{
      const u=state.unread||{};
      let sum=0;
      for(const v of Object.values(u)) sum+= Number(v)||0;
      if(sum===0){
        // fallback: count rooms with unread flag (some builds store 1 per room)
        // also consider pendingInvites?
        sum = Object.keys(u).length;
      }
      return sum;
    }catch(e){ return 0; }
  }
  let desktopUnreadTimer=null;
  function startDesktopUnreadTimer(){
    try{ if(desktopUnreadTimer){ clearInterval(desktopUnreadTimer); desktopUnreadTimer=null; } }catch(e){}
    if(!DESKTOP) return;
    const cfg=getDesktopUnread();
    if(!cfg.enabled) return;
    const ms=(cfg.interval===10?10:5)*60*1000;
    const tick=()=>{
      try{
        const n=getTotalUnread();
        if(!n) return;
        // 데스크탑 요약 알림은 윈도우가 포커스 아닐 때만 띄운다 (트레이/백그라운드)
        // main.js에서도 visible+focused일 때 한 번 더 걸러주므로, 여기서는 hasFocus만 확인
        try{ if(document.hasFocus && document.hasFocus()) return; }catch(e){}
        // 추가로 document.hidden이 false여도 포커스가 없으면 알림 (다른 창을 보고 있을 때)
        // hasFocus가 false면 백그라운드로 간주하고 알림
        const body=`안읽은 알림이 ${n}개 있어요.`;
        showDesktopNotification('에듀톡', body, '');
        if(cfg.sound){
          try{ playSound(cfg.soundId||'bell'); }catch(e){}
        }
      }catch(e){ console.error('desktop unread tick', e); }
    };
    // 즉시 한 번은 30초 뒤에 체크, 이후 주기
    desktopUnreadTimer=setInterval(tick, ms);
    // 첫 알림은 1분 뒤에 한 번 (바로 뜨면 방해될 수 있어 약간 지연)
    setTimeout(tick, 30000);
  }
  function stopDesktopUnreadTimer(){ try{ if(desktopUnreadTimer){ clearInterval(desktopUnreadTimer); desktopUnreadTimer=null; } }catch(e){} }
  // ---------- 네이티브 햅틱 래퍼 (Capacitor.isNativePlatform() 일 때만 진동, 웹은 스킵) ----------
  async function hapticMedium(){ try{ if(window.EdutalkNative?.isNative()) await window.EdutalkNative.hapticImpactMedium(); else if(navigator.vibrate) navigator.vibrate(40); }catch(e){} }
  async function hapticSuccess(){ try{ if(window.EdutalkNative?.isNative()) await window.EdutalkNative.hapticSuccess(); else if(navigator.vibrate) navigator.vibrate([30,50,30]); }catch(e){} }
  async function hapticError(){ try{ if(window.EdutalkNative?.isNative()) await window.EdutalkNative.hapticError(); else if(navigator.vibrate) navigator.vibrate([60,30,60]); }catch(e){} }
  // 툭툭 두 번 (Face ID 성공·확정용 체크 느낌)
  async function hapticDouble(){ try{ if(window.EdutalkNative?.isNative() && window.EdutalkNative.hapticDouble) await window.EdutalkNative.hapticDouble(); else if(navigator.vibrate) navigator.vibrate([25,70,40]); }catch(e){} }
  // 드래그 중 우웅(반복 틱) → 놓으면 타닥(확정 두 번)
  let dragHapticTimer=null;
  function startDragHaptic(){
    stopDragHaptic(false);
    const tick=()=>{ try{
      if(window.EdutalkNative?.isNative() && window.EdutalkNative.hapticTick) window.EdutalkNative.hapticTick().catch(()=>{});
      else if(navigator.vibrate) navigator.vibrate(15);
    }catch(e){} };
    tick();
    dragHapticTimer=setInterval(tick, 120);
  }
  function stopDragHaptic(ok){
    try{ if(dragHapticTimer){ clearInterval(dragHapticTimer); dragHapticTimer=null; } }catch(e){ dragHapticTimer=null; }
    if(ok) hapticDouble();
  }
  // ---------- 설정 dirty 체크 ----------
  let settingsDirty=false;
  function markSettingsDirty(){
    if(settingsDirty) return;
    settingsDirty=true;
    const bar=document.querySelector('.settings-save-bar');
    if(bar){ bar.classList.add('dirty'); const btn=bar.querySelector('[data-action="save-settings"]'); if(btn) btn.disabled=false; }
  }
  function clearSettingsDirty(){
    settingsDirty=false;
    const bar=document.querySelector('.settings-save-bar');
    if(bar){ bar.classList.remove('dirty'); const btn=bar.querySelector('[data-action="save-settings"]'); if(btn) btn.disabled=true; }
  }
  // ---------- 초안 저장 ----------
  function draftKey(roomId){ return 'edutalk_draft_'+String(roomId||''); }
  function saveDraft(roomId, text){
    try{
      const k=draftKey(roomId);
      if(!text || !String(text).trim()) localStorage.removeItem(k);
      else localStorage.setItem(k, String(text).slice(0,4000));
    }catch(e){}
  }
  function loadDraft(roomId){
    try{ return localStorage.getItem(draftKey(roomId))||''; }catch(e){ return ''; }
  }
  function restoreDraftToComposer(roomId){
    try{
      const ta=document.getElementById('composerText');
      if(!ta) return;
      const d=loadDraft(roomId||state.room?.id);
      if(d && !ta.value) { ta.value=d; smoothComposerResize(ta); updateCharCount(); }
      const hint=document.getElementById('composerDraftHint');
      if(hint) hint.classList.toggle('show', !!d && !!ta.value);
    }catch(e){}
  }
  // ---------- 읽지 않은 요약 ----------
  function renderUnreadSummary(){
    try{
      const host=document.getElementById('unreadSummary');
      if(!host) return;
      const n=getTotalUnread();
      if(!n){ host.classList.add('hidden'); host.innerHTML=''; return; }
      const roomsCount=Object.keys(state.unread||{}).length;
      host.innerHTML=`<span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4 3V6Z"/></svg></span><span><b>${n}개</b> 안 읽은 메시지 · ${roomsCount}개 방</span><span style="margin-left:auto;font-size:12px">›</span>`;
      host.classList.remove('hidden');
    }catch(e){}
  }
  // ---------- 커맨드 팔레트 ----------
  let cmdPaletteEl=null, cmdPaletteOpen=false;
  function ensureCmdPalette(){
    if(cmdPaletteEl) return cmdPaletteEl;
    const wrap=document.createElement('div');
    wrap.id='cmdPalette';
    wrap.className='cmd-palette';
    wrap.innerHTML=`<div class="cmd-box" role="dialog" aria-modal="true" aria-label="빠른 실행"><div class="cmd-input-wrap"><span class="search-ico">⌕</span><input class="cmd-input" id="cmdInput" placeholder="명령·채팅방·친구를 검색해요 (예: 설정, 일정, 초대)" autocomplete="off" spellcheck="false"></div><div class="cmd-list" id="cmdList"></div></div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e)=>{ if(e.target===wrap) closeCmdPalette(); });
    return wrap;
  }
  function getCmdItems(){
    const items=[];
    // 채팅방
    (state.rooms||[]).slice(0,50).forEach(r=>{
      items.push({ id:'room:'+r.id, label: r.name||'채팅방', sub: (r.memberIds||[]).length+'명 · '+(r.typeLabel||''), icon:'chat', action:()=>{ closeCmdPalette(); openRoom(r.id); } });
    });
    // 친구
    (state.friends||[]).slice(0,30).forEach(f=>{
      items.push({ id:'friend:'+f.uid, label: (f.displayName||'친구'), sub: gradeClassPrefix(f)||roleLabel(f.role), icon:'users', action:()=>{ closeCmdPalette(); startDM(f.uid, f.displayName); } });
    });
    // 설정·관리
    const acts=[
      { label:'전체 설정', sub:'표시·알림·초대·보안', icon:'gear', action:()=>{ closeCmdPalette(); openSettings(); } },
      { label:'알림 설정', sub:'소리·브라우저·요약 알림', icon:'chat', action:()=>{ closeCmdPalette(); openSettings('chat'); } },
      { label:'초대 코드 복사', sub: state.profile?.userCode||'', icon:'link', action:()=>{ closeCmdPalette(); copyMyCode(); } },
      { label:'일정 열기', sub:'학교 일정·할 일', icon:'cal', action:()=>{ closeCmdPalette(); openCalendar(); } },
      { label:'채팅 관리', sub:'목록·초대·할 일', icon:'folder', action:()=>{ closeCmdPalette(); openChatManager(); } },
      { label:'친구 목록', sub:'친구·요청 관리', icon:'users', action:()=>{ closeCmdPalette(); openFriends(); } },
      { label:'프로필', sub: state.profile?.displayName||'', icon:'users', action:()=>{ closeCmdPalette(); openProfile(); } },
    ];
    if(isAdmin()||isSchoolAdmin()) acts.push({ label:'관리자 도구', sub:'학교·회원·신고', icon:'wrench', action:()=>{ closeCmdPalette(); openAdmin(); } });
    acts.forEach(a=> items.push({ id:'act:'+a.label, label:a.label, sub:a.sub, icon:a.icon, action:a.action }));
    return items;
  }
  function renderCmdList(q){
    const list=document.getElementById('cmdList');
    if(!list) return;
    const query=String(q||'').trim().toLowerCase();
    let items=getCmdItems();
    if(query) items=items.filter(it=> (it.label+it.sub).toLowerCase().includes(query));
    if(!items.length){ list.innerHTML='<div class="cmd-empty">검색 결과가 없어요.</div>'; return; }
    const icoMap={
      chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4 3V6Z"/></svg>',
      users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M16 21v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V21"/><circle cx="10" cy="7" r="3"/><circle cx="17.5" cy="7" r="2.5"/></svg>',
      gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2"/></svg>',
      link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 13a5 5 0 0 0 7 0l1-1a5 5 0 0 0-7-7L9 5"/><path d="M14 11a5 5 0 0 0-7 0l-1 1a5 5 0 0 0 7 7l1-1"/></svg>',
      folder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
      cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 8h18"/><path d="M8 2v4M16 2v4"/></svg>',
      wrench:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L2 19l1 1 7.1-7.1a4 4 0 0 0 5.6-5.6Z"/></svg>',
    };
    list.innerHTML=items.slice(0,30).map((it,i)=>`<button type="button" class="cmd-item ${i===0?'active':''}" data-cmd="${i}"><span class="s-ico">${icoMap[it.icon]||icoMap.chat}</span><span class="grow" style="min-width:0;text-align:left"><span style="display:block;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.label)}</span><span class="meta">${esc(it.sub||'')}</span></span><span style="color:var(--muted);font-size:11px">↵</span></button>`).join('');
    list.querySelectorAll('.cmd-item').forEach((el,idx)=>{
      el.onclick=()=>{ const it=items[idx]; if(it&&it.action) it.action(); };
    });
    list._items=items;
    list._sel=0;
  }
  function openCmdPalette(){
    const wrap=ensureCmdPalette();
    wrap.classList.add('show');
    cmdPaletteOpen=true;
    const inp=document.getElementById('cmdInput');
    if(inp){ inp.value=''; renderCmdList(''); setTimeout(()=>inp.focus(), 30); }
    document.body.style.overflow='hidden';
  }
  function closeCmdPalette(){
    const wrap=document.getElementById('cmdPalette');
    if(wrap) wrap.classList.remove('show');
    cmdPaletteOpen=false;
    document.body.style.overflow='';
  }
  document.addEventListener('keydown',e=>{
    const isK = (e.ctrlKey||e.metaKey) && String(e.key||'').toLowerCase()==='k';
    if(isK){ e.preventDefault(); if(cmdPaletteOpen) closeCmdPalette(); else openCmdPalette(); return; }
    if(cmdPaletteOpen){ handleCmdKey(e); if(e.defaultPrevented) return; }
  });
  document.addEventListener('input',e=>{ if(e.target && e.target.id==='cmdInput'){ renderCmdList(e.target.value); } });
  function handleCmdKey(e){
    if(!cmdPaletteOpen) return;
    const list=document.getElementById('cmdList');
    if(!list||!list._items) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); list._sel=Math.min((list._sel||0)+1, list._items.length-1); list.querySelectorAll('.cmd-item').forEach((el,i)=>el.classList.toggle('active', i===list._sel)); list.querySelector('.cmd-item.active')?.scrollIntoView({block:'nearest'}); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); list._sel=Math.max((list._sel||0)-1, 0); list.querySelectorAll('.cmd-item').forEach((el,i)=>el.classList.toggle('active', i===list._sel)); }
    else if(e.key==='Enter'){ e.preventDefault(); const it=list._items[list._sel||0]; if(it&&it.action) it.action(); }
    else if(e.key==='Escape'){ e.preventDefault(); closeCmdPalette(); }
  }

  function notifySettings(){
    const n=(state.settings&&state.settings.notify)||{};
    // 데스크톱 앱은 브라우저 권한이 필요 없고, 설정을 따로 저장해 기본값을 '켜짐'으로 둔다.
    // (예전에 웹에서 browser 를 꺼 두었어도 데스크톱에서는 알림창이 뜬다)
    return { sound: n.sound!==false, soundId: n.soundId||'bell', browser: DESKTOP ? n.desktopNotify!==false : !!n.browser };
  }
  function notificationPermission(){
    try{ return (typeof Notification!=='undefined') ? Notification.permission : 'unsupported'; }catch(e){ return 'unsupported'; }
  }
  // 알림창 표시. 데스크톱 앱이면 앱 자체 알림창을, 웹이면 브라우저 알림을 쓴다.
  function showDesktopNotification(title,body,roomId){
    if(!notifySettings().browser) return;
    if(DESKTOP){
      try{ window.edutalkDesktop.notify({ title:title||'에듀톡', body:body||'', roomId:roomId||'' }); }
      catch(e){ console.error('notify',e); }
      return;
    }
    if(notificationPermission()!=='granted') return;
    try{
      // 크롬북/ChromeOS에서는 tag가 매번 다르면 알림이 쌓여 3개까지 동시에 뜬다.
      // 방당 고정 tag로 교체되게 해 가장 최근 1개만 보이게 한다.
      const n=new Notification(title||'에듀톡',{ body:body||'', tag:'edutalk-'+String(roomId||'general'), renotify:true, silent:true });
      n.onclick=()=>{ try{ window.focus(); }catch(e){} try{ n.close(); }catch(e){} };
    }catch(e){ console.error('notify',e); }
  }
  // 같은 메시지가 두 경로(채팅방 목록 요약 · 열려 있는 채팅방)에서 겹쳐 알림/소리가 나지 않도록 막는다.
  const NOTIFY_DEDUP_MS=15000;
  function isDuplicateNotify(roomId,msg){
    if(!(state.notifySeen instanceof Map)) state.notifySeen=new Map();
    const txt=String(msg?.text||'').slice(0,40);
    // 요약 경로에는 id가 없어 createdAt 정밀도가 달라질 수 있어 id 우선, 없으면 방+발신+텍스트로 묶는다
    const key=msg?.id?`${roomId}|id:${msg.id}`:`${roomId}|${msg?.senderId||''}|${docTs(msg?.createdAt)}|${txt}`;
    const shortKey=`${roomId}|${msg?.senderId||''}|${txt}`;
    const now=nowMs();
    for(const [k,t] of state.notifySeen){ if(now-t>NOTIFY_DEDUP_MS) state.notifySeen.delete(k); }
    if(state.notifySeen.has(key)||state.notifySeen.has(shortKey)) return true;
    state.notifySeen.set(key,now);
    state.notifySeen.set(shortKey,now);
    return false;
  }
  // 키워드 알림: 등록한 말이 오면 음소거 방에서도 알려준다 (방해금지·차단 상대 제외)
  function keywordHit(text){
    const kws=Array.isArray(state.settings?.keywords)?state.settings.keywords:[];
    if(!kws.length||!text) return '';
    const t=String(text).toLowerCase();
    const hit=kws.map(k=>String(k||'').trim()).filter(k=>k&&t.includes(k.toLowerCase()));
    return hit.length?hit[0]:'';
  }
  function notifyMessage(roomId,room,msg){
    if(!msg||!msg.senderId||msg.senderId===uid()) return;
    if(msg.deleted) return;
    if(isBlockedMessage(msg)) return;
    const kw=keywordHit(msg.text||'');
    if(!kw && isRoomMuted(roomId)) return;
    if(isDnd() && !kw) return;
    // 로그인 전에 온 메시지는 목록 숫자로만 표시하고 알림으로 보내지 않는다
    // 로그인 전에 온 메시지는 목록 숫자로만 표시하고 알림으로 보내지 않는다
    try{ const ct=docTs(msg.createdAt)||0; if(ct && state.loginAt && ct<state.loginAt) return; }catch(e){}
    if(isDuplicateNotify(roomId,msg)) return;
    const s=notifySettings();
    if(s.sound) playSound(s.soundId);
    const hidden=document.hidden;
    const otherRoom=state.room?.id!==roomId;
    if(kw||hidden||otherRoom) showDesktopNotification(kw?`키워드 '${kw}'`:room?.name||'에듀톡', `${msg.senderName||'사용자'}: ${msg.text||''}`, roomId);
  }
  function isRoomMuted(roomId){ return !!(state.settings?.mutedRooms||[]).includes(roomId); }
  function isDnd(){ return presenceModeSetting()==='dnd'; }

  // ---------- 중복 로그인 감지 (한 기기에서만 유지) ----------
  // 같은 브라우저(탭 공유)는 같은 세션 ID를 써서 서로 내쫓지 않고,
  // 다른 기기·브라우저는 ID가 달라 나중에 들어온 쪽이 남는다.
  let sessionUnsub=null;
  // 11·12번: 기기 이름 표시용 — []에 들어갈 이름 (크롬북/윈도우/안드로이드 등)
  function deviceName(){
    try{
      const ua=String(navigator.userAgent||'');
      const plat=String(navigator.platform||'');
      // 모바일 브라우저 토큰(iOS 크롬 CriOS 등)을 먼저 본다 — UA에 Safari가 함께 들어있어서 순서가 중요하다
      let br='';
      if(/Whale/i.test(ua)) br='웨일';
      else if(/EdgA|EdgiOS|Edg\//i.test(ua)) br='엣지';
      else if(/CriOS/i.test(ua)) br='크롬';
      else if(/FxiOS/i.test(ua)) br='파이어폭스';
      else if(/SamsungBrowser/i.test(ua)) br='삼성 인터넷';
      else if(/Chrome/i.test(ua)) br='크롬';
      else if(/Safari/i.test(ua)) br='사파리';
      else if(/Firefox/i.test(ua)) br='파이어폭스';
      // 데스크톱용으로 보기 모드에서는 폰 UA가 PC로 위장된다 — 힌트·터치로 바로잡는다
      let mobileHint=false;
      try{ mobileHint=navigator.userAgentData&&navigator.userAgentData.mobile===true; }catch(e){}
      let touch=0;
      try{ touch=Number(navigator.maxTouchPoints)||0; }catch(e){}
      let os='기기';
      if(/CrOS/i.test(ua)) os='크롬북';
      else if(/Android/i.test(ua)) os='안드로이드';
      else if(/iPhone/i.test(ua)) os='아이폰';
      else if(/iPad/i.test(ua)||(/Mac/i.test(ua)&&touch>1)) os='아이패드';
      else if(/Mac/i.test(ua)) os='맥';
      else if(/Windows/i.test(ua)) os=mobileHint?'모바일 기기':'윈도우 PC';
      else if(/Linux/i.test(ua)) os=(mobileHint||touch>1)?'모바일 기기':'리눅스';
      else if(mobileHint) os='모바일 기기';
      else if(plat) os=plat;
      return br?`${os} ${br}`:os;
    }catch(e){ return '다른 기기'; }
  }
  function mySessionId(){
    try{
      let s=localStorage.getItem('edutalk_session');
      if(!s){
        const b=new Uint8Array(16);
        try{ crypto.getRandomValues(b); }catch(e){ for(let i=0;i<16;i++) b[i]=Math.floor(Math.random()*256); }
        s=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
        localStorage.setItem('edutalk_session',s);
      }
      return s;
    }catch(e){ return ''; }
  }
  async function claimSession(){
    const s=mySessionId(); if(!s||!uid()) return false;
    try{ await db.collection('users').doc(uid()).update({sessionId:s,sessionDevice:deviceName(),sessionAt:ts(),updatedAt:ts()}); return true; }
    catch(e){ console.warn('session claim',e?.code||e); return false; }
  }
  function clearSessionListener(){ if(sessionUnsub){ try{sessionUnsub();}catch(e){} sessionUnsub=null; } }
  function attachSessionListener(){
    clearSessionListener();
    if(!uid()) return;
    const mine=mySessionId(); if(!mine) return;
    try{
      sessionUnsub=db.collection('users').doc(uid()).onSnapshot(s=>{
        if(!s.exists) return;
        const v=s.data()||{};
        // 서버에 기록된 세션이 내 것과 다르면 다른 기기에서 들어온 것이다
        if(v.sessionId && v.sessionId!==mine && !state.dupKicked){
          state.dupKicked=true;
          state.dupKickDevice=String(v.sessionDevice||'다른 기기');
          onDuplicateKick(state.dupKickDevice);
        }
      },e=>console.warn('session listen',e?.code||e));
    }catch(e){}
  }
  function onDuplicateKick(kickDevice){
    const dev=String(kickDevice||state.dupKickDevice||'다른 기기');
    try{ localStorage.setItem('edutalk_dup_kick',dev); }catch(e){}
    try{ localStorage.setItem('edutalk_dup_kick_at',String(Date.now())); }catch(e){}
    closeAllModals();
    clearListeners();
    stopPresence();
    try{ auth.signOut().catch(()=>{}); }catch(e){}
  }
  function consumeDupKick(){
    try{
      const v=localStorage.getItem('edutalk_dup_kick');
      if(v){ localStorage.removeItem('edutalk_dup_kick'); localStorage.removeItem('edutalk_dup_kick_at'); return v; }
    }catch(e){}
    return '';
  }
  // 12번: 이미 로그인된 계정에 또 로그인하려 할 때 예/아니오 확인 팝업
  async function checkExistingSession(){
    try{
      const mine=mySessionId(); if(!mine||!uid()) return true;
      const s=await db.collection('users').doc(uid()).get();
      if(!s.exists) return true;
      const v=s.data()||{};
      if(!v.sessionId||v.sessionId===mine) return true;
      const dev=String(v.sessionDevice||'다른 기기');
      const ok=await dupLoginConfirm(dev);
      if(!ok){ try{ await auth.signOut(); }catch(e){} return false; }
      return true;
    }catch(e){ return true; }
  }
  function dupLoginConfirm(dev){
    return new Promise(res=>{
      const panel=openModal(`<h2>이미 로그인된 계정이에요</h2><p class="desc">이미 이 계정은 <b>[${esc(dev)}]</b>에 로그인되어 있어요.<br>해당 기기에서 로그아웃하고 이 기기로 로그인할까요?</p><div class="modal-actions"><button class="cancel" id="dupNo">아니오</button><button class="confirm" id="dupYes">예</button></div>`,{small:true,dismissible:false});
      panel.querySelector('#dupYes').onclick=()=>{ closeModal(); res(true); };
      panel.querySelector('#dupNo').onclick=()=>{ closeModal(); res(false); };
    });
  }
  // 11번: 토스트 대신 팝업으로 중복 로그아웃 안내
  function showDupKickPopup(dev){
    const d=String(dev||'다른 기기');
    openModal(`<h2>다른 기기에서 로그인했어요</h2><p class="desc">[${esc(d)}]에서 이 계정으로 로그인해서<br>이 기기는 로그아웃됐어요. 다시 로그인해 주세요.</p><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
  }
  async function toggleRoomMute(roomId){
    if(!roomId) return;
    const cur=new Set(state.settings.mutedRooms||[]);
    const on=!cur.has(roomId);
    if(on) cur.add(roomId); else cur.delete(roomId);
    state.settings.mutedRooms=[...cur];
    const s={...(state.profile?.settings||{}),mutedRooms:state.settings.mutedRooms};
    if(state.profile) state.profile.settings=s;
    try{ await db.collection('users').doc(uid()).update({settings:s,updatedAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast(on?'이 채팅방 알림을 껐어요.':'이 채팅방 알림을 켰어요.');
    if($('#chatManagerRooms')) renderChatManagerRooms();
    else closeModal();
    renderRooms(); if(state.room){ renderChatFrame(state.room); renderMessages(false); }
  }

  // ---------- 접속 상태 (온라인 · 자리비움 · 방해금지 · 오프라인) ----------
  // 내 상태는 publicProfiles.presence 에 기록하고, 남의 상태는 그 값을 읽어서 보여준다.
  // 설정에서 '표시 안 함'을 고르면 state:'hidden' 으로 기록해 아무 표시도 뜨지 않는다.
  // '상시 온라인'은 제공하지 않는다. 자리비움·방해금지는 창을 닫거나 화면을 끄면 오프라인으로 바뀐다.
  const PRESENCE_ONLINE_MS=75000, PRESENCE_AWAY_MS=4*60*1000;
  let presenceTimer=null;
  function presenceModeSetting(){
    const m=state.settings?.presenceMode;
    return (m==='away'||m==='dnd'||m==='offline'||m==='hidden')?m:'auto';
  }
  function presenceToWrite(){
    const mode=presenceModeSetting();
    if(mode==='hidden') return {state:'hidden', at:ts()};
    if(mode==='offline') return {state:'offline', at:ts()};
    // 상시 자리비움·방해금지라도 창을 닫거나 화면을 끄면 오프라인으로 바뀐다
    if(mode==='away') return {state:document.hidden?'offline':'away', at:ts()};
    if(mode==='dnd') return {state:document.hidden?'offline':'dnd', at:ts()};
    return {state:document.hidden?'away':'online', at:ts()};
  }
  async function pushPresence(){
    if(!state.profile || !uid()) return;
    const v=presenceToWrite();
    try{ await putPublicProfile({presence:v}); }
    catch(e){ /* 상태 표시는 실패해도 조용히 넘어간다 */ }
    if(state.profileCache.has(uid())) state.profileCache.get(uid()).presence=v;
  }
  // 창을 숨기거나 닫으면 곧바로 상태를 다시 기록한다 (자리비움 → 오프라인)
  function onPresenceVisibility(){ pushPresence(); }
  function startPresence(){
    stopPresence();
    pushPresence();
    let n=0;
    // 15초마다 점 표시를 다시 계산하고, 45초마다 내 상태를 갱신한다
    presenceTimer=setInterval(()=>{ n+=1; if(n%3===0) pushPresence(); tickPresence(); },15000);
    document.addEventListener('visibilitychange',onPresenceVisibility);
    window.addEventListener('pagehide',onPresenceVisibility);
  }
  function stopPresence(){
    if(presenceTimer){ clearInterval(presenceTimer); presenceTimer=null; }
    document.removeEventListener('visibilitychange',onPresenceVisibility);
    window.removeEventListener('pagehide',onPresenceVisibility);
  }
  const presenceAt=(p)=>{ const v=p?.presence?.at; return v?.toDate?v.toDate().getTime():(typeof v==='number'?v:0); };
  function presenceStateOf(p){
    const v=p?.presence; if(!v||!v.state||v.state==='hidden') return '';
    const at=presenceAt(p); if(!at) return '';
    if(v.state==='offline') return 'offline';
    const age=Date.now()-at;
    if(age>PRESENCE_AWAY_MS) return 'offline';
    if(v.state==='away') return 'away';
    if(v.state==='dnd') return 'dnd';
    return age<=PRESENCE_ONLINE_MS?'online':'away';
  }
  function presenceLabel(s){ return s==='online'?'온라인':s==='away'?'자리비움':s==='dnd'?'방해금지':s==='hidden'?'숨김 중':'오프라인'; }
  // 내 화면에 보여줄 현재 상태 (서버 동기 전에도 즉시 반영, 닫힘·숨김 화면이면 오프라인)
  function myPresenceState(){
    const mode=presenceModeSetting();
    if(mode==='hidden') return '';
    if(mode==='offline') return 'offline';
    if(document.hidden) return 'offline';
    if(mode==='away') return 'away';
    if(mode==='dnd') return 'dnd';
    return 'online';
  }
  function myPresenceLabel(){
    const mode=presenceModeSetting();
    if(mode==='hidden') return '숨김 중';
    return presenceLabel(myPresenceState());
  }
  function presenceDot(p){
    const s=presenceStateOf(p); if(!s) return '';
    return `<span class="presence-dot ${s}" data-presence data-state="${esc(p?.presence?.state||'')}" data-at="${presenceAt(p)}" title="${presenceLabel(s)}" aria-label="${presenceLabel(s)}"></span>`;
  }
  // 시간이 지나면 자동으로 '자리비움/오프라인'으로 바뀌도록 표시만 갱신한다
  function tickPresence(){
    $$('[data-presence]').forEach(el=>{
      const st=el.dataset.state, at=Number(el.dataset.at)||0;
      let s='';
      if(st==='offline'){ s='offline'; }
      else if(st && st!=='hidden' && at){
        const age=Date.now()-at;
        s = age>PRESENCE_AWAY_MS ? 'offline' : (st==='away' ? 'away' : st==='dnd' ? 'dnd' : (age<=PRESENCE_ONLINE_MS?'online':'away'));
      }
      if(!s) return;
      el.className='presence-dot '+s;
      el.title=presenceLabel(s); el.setAttribute('aria-label',presenceLabel(s));
    });
    // 사이드바 내 상태 글자도 함께 갱신한다 (서버 왕복 없이 즉시 반영)
    $$('[data-my-presence-label]').forEach(el=>{ el.textContent=myPresenceLabel(); });
    $$('[data-my-presence-dot]').forEach(el=>{
      const s=myPresenceState();
      el.className='presence-dot inline '+(s||'hidden');
      el.title=s?presenceLabel(s):'숨김 중'; el.setAttribute('aria-label',s?presenceLabel(s):'숨김 중');
    });
    // 참여자 패널의 상태도 프로필 캐시 기준으로 함께 갱신한다 (다시 그리지 않음)
    const memIds=new Set();
    $$('[data-mem-text]').forEach(el=>{ if(el.dataset.memText) memIds.add(el.dataset.memText); });
    memIds.forEach(mid=>{
      const s=presenceStateOf(state.profileCache.get(mid));
      $$(`[data-mem-text="${mid}"]`).forEach(el=>{ el.textContent=s?presenceLabel(s):''; });
      $$(`[data-mem-dot="${mid}"]`).forEach(el=>{ el.className='presence-dot inline '+(s||'hidden'); });
    });
  }
  // 프로필에서 상태를 바꾸면 설정·서버·화면에 즉시 반영한다
  async function setPresenceMode(mode){
    const v=(mode==='away'||mode==='dnd'||mode==='offline'||mode==='hidden'||mode==='auto')?mode:'auto';
    state.settings.presenceMode=v;
    if(state.profile){
      const s={...(state.profile.settings||{}),presenceMode:v};
      state.profile.settings=s;
      try{ await db.collection('users').doc(uid()).update({settings:s,updatedAt:ts()}); }
      catch(e){ console.error(e); return toast(errText(e)); }
    }
    try{ await pushPresence(); }catch(e){}
    tickPresence();
    renderSidebar();
    toast(v==='auto'?'온라인으로 표시할게요.':v==='dnd'?'방해금지로 표시할게요. 알림이 오지 않아요.':v==='away'?'자리비움으로 표시할게요.':v==='offline'?'오프라인으로 표시할게요.':v==='hidden'?'상태를 숨겼어요.':'온라인으로 표시할게요.');
  }
  function presenceMenuOptions(){
    return ['auto','away','dnd','offline','hidden'].map(v=>({value:v,label:presenceModeLabel(v),dot:v==='auto'?'online':v==='away'?'away':v==='dnd'?'dnd':v==='offline'?'offline':'hidden'}));
  }
  function openPresenceMenu(button){
    if(!button) return;
    openDropdown(button,presenceMenuOptions(),(v)=>{ runAsync(()=>setPresenceMode(v)); });
  }


  // ---------- 입력 중 표시 (상대가 메시지를 쓰는 동안 말풍선으로 알려준다) ----------
  // 설정에서 끄면 내 입력 상태를 보내지도, 남의 입력 상태를 보지도 않는다.
  let typingUnsub=null;
  function typingEnabled(){ return state.settings?.typingIndicator !== false; }
  function typingDocRef(roomId){ return db.collection('channels').doc(roomId).collection('typing').doc(uid()); }
  function stopTyping(){
    if(state.typingSendTimer){ clearTimeout(state.typingSendTimer); state.typingSendTimer=null; }
    state.typingPingAt=0;
    const id=state.typingRoomId; state.typingRoomId=null;
    if(id && uid()){ try{ typingDocRef(id).delete().catch(()=>{}); }catch(e){} }
  }
  // 입력하던 글을 전부 지우면 표시를 지우고 3초 동안 다시 뜨지 않는다
  // (지웠다가 바로 다시 치는 걸 반복해도 상대방에게 도배되지 않는다)
  const TYPING_COOLDOWN_MS=3000;
  function clearTypingInput(){
    stopTyping();
    state.typingCooldownUntil=Date.now()+TYPING_COOLDOWN_MS;
  }
  function scheduleTypingStop(){
    if(state.typingSendTimer) clearTimeout(state.typingSendTimer);
    state.typingSendTimer=setTimeout(stopTyping,4200);
  }
  function pingTyping(){
    if(!typingEnabled() || !state.room) return;
    const ta=$('#composerText'); const text=(ta?.value||'').trim();
    if(!text){ clearTypingInput(); return; }               // 다 지우면 표시를 지우고 쿨타임 시작
    if(Date.now() < (state.typingCooldownUntil||0)) return; // 쿨타임 동안은 표시하지 않는다
    const id=state.room.id; state.typingRoomId=id;
    scheduleTypingStop();
    const now=Date.now();
    if(now-(state.typingPingAt||0)<1800) return;
    state.typingPingAt=now;
    const p=state.profile||{};
    try{
      typingDocRef(id).set({name:p.displayName||'사용자',photoURL:p.photoURL||'',avatarEmoji:p.avatarEmoji||'',avatarColor:p.avatarColor||'',at:ts()},{merge:true}).catch(()=>{});
    }catch(e){}
  }
  function clearTypingListener(){
    if(typingUnsub){ try{ typingUnsub(); }catch(e){} typingUnsub=null; }
    state.typingUsers=[]; state.typingKey='';
  }
  function renderTypingIndicator(autoScroll=true){
    const host=$('#messages'); if(!host) return;
    let el=host.querySelector('.typing-row');
    const users=typingEnabled()?(state.typingUsers||[]).filter(u=>u&&u.id!==uid()):[];
    if(!users.length){ if(el) el.remove(); return; }
    if(!el){ el=document.createElement('div'); el.className='typing-row'; host.appendChild(el); }
    const rep=users[0];
    const label=users.length>1?`${rep.name||'사용자'}님 외 ${users.length-1}명`:`${rep.name||'사용자'}님`;
    const avatars=users.slice(0,3).map(u=>`<span class="typing-av">${u.photoURL?`<img src="${esc(u.photoURL)}" alt="">`:esc(String(u.avatarEmoji||(u.name||'?').charAt(0)))}</span>`).join('');
    const html=`<div class="typing-avatars">${avatars}</div><div class="bubble typing-bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div><span class="typing-label">${esc(label)} 입력 중</span>`;
    if(el.innerHTML!==html) el.innerHTML=html;
    // 입력 중 말풍선이 뜨거나 사라질 때도 채팅창이 부드럽게 움직인다
    if(autoScroll && state.atBottom) scrollMessagesToBottom(host,true);
  }

  // ---------- 읽음 표시 (내가 보낸 메시지를 누가 읽었는지) ----------
  // 방마다 channels/{방}/reads/{사용자} 문서에 마지막으로 읽은 시각을 남긴다.
  // (프로필 구독 범위와 상관없이 그 방 하나만 구독하면 정확히 알 수 있다)
  function readReceiptsEnabled(){ return state.settings?.readReceipts !== false; }
  function readReceiptHtml(m){
    if(m.senderId!==uid() || !readReceiptsEnabled()) return '';
    const map=state.roomReads; if(!(map instanceof Map) || !map.size) return '';
    const rt=docTs(m.createdAt)||0; if(!rt) return '';
    const names=[];
    map.forEach((v,id)=>{ if(id!==uid() && v.at>=rt) names.push(v.name||'사용자'); });
    if(!names.length) return '';
    const label=names.length>1?`${names[0]}님 외 ${names.length-1}명 읽음`:`${names[0]}님 읽음`;
    // 13번: 누르거나 올리면 누가 읽었는지 목록 표시
    const data=esc(names.slice(0,30).join('\n'));
    return `<button type="button" class="read-receipt clickable" data-action="read-list" data-names="${data}" data-count="${names.length}" title="누가 읽었는지 보기">${esc(label)}</button>`;
  }
  // 타인이 보낸 메시지에도 읽음 표시를 보여준다 (본인이 읽은 것은 제외)
  function readReceiptOthersHtml(m){
    if(!readReceiptsEnabled()) return '';
    const map=state.roomReads; if(!(map instanceof Map) || !map.size) return '';
    const rt=docTs(m.createdAt)||0; if(!rt) return '';
    const names=[];
    map.forEach((v,id)=>{ if(id!==uid() && id!==m.senderId && v.at>=rt) names.push(v.name||'사용자'); });
    if(!names.length) return '';
    const label=names.length>1?`${names[0]}님 외 ${names.length-1}명 읽음`:`${names[0]}님 읽음`;
    const data=esc(names.slice(0,30).join('\n'));
    return `<button type="button" class="read-receipt clickable" data-action="read-list" data-names="${data}" data-count="${names.length}" title="누가 읽었는지 보기">${esc(label)}</button>`;
  }
  function openReadList(names,count){
    const list=String(names||'').split('\n').map(s=>s.trim()).filter(Boolean);
    openModal(`<h2>읽은 사람 ${Number(count||list.length)||list.length}명</h2><div class="list">${list.map(n=>`<div class="list-item"><div class="grow"><div class="title">${esc(n)}</div></div><span>✓</span></div>`).join('')||'<div class="empty-side">아직 읽은 사람이 없어요.</div>'}</div><div class="modal-actions"><button class="confirm" data-close-modal>닫기</button></div>`,{small:true});
  }

  // ---------- 부드러운 스크롤 (새 메시지 · 삭제 · 입력 중 표시) ----------
  let msgScrollRaf=null, msgScrollCleanup=null;
  function cancelMsgScroll(){
    if(msgScrollRaf){ cancelAnimationFrame(msgScrollRaf); msgScrollRaf=null; }
    if(msgScrollCleanup){ try{ msgScrollCleanup(); }catch(e){} msgScrollCleanup=null; }
  }
  function animateMsgScroll(host,to,dur,cleanup){
    cancelMsgScroll();   // 진행 중이던 이동과 임시 여백을 먼저 정리한다 (여백을 너무 일찍 지우면 끊겨 보임)
    const from=host.scrollTop, dist=to-from;
    if(prefersReducedMotion() || Math.abs(dist)<2){ host.scrollTop=to; if(cleanup){ try{ cleanup(); }catch(e){} } return; }
    msgScrollCleanup=cleanup||null;
    const start=performance.now(), ease=t=>1-Math.pow(1-t,3);
    const step=now=>{
      const p=Math.min(1,(now-start)/(dur||320));
      host.scrollTop=from+dist*ease(p);
      if(p<1) msgScrollRaf=requestAnimationFrame(step);
      else { msgScrollRaf=null; const c=msgScrollCleanup; msgScrollCleanup=null; if(c){ try{c();}catch(e){} } }
    };
    msgScrollRaf=requestAnimationFrame(step);
  }
  function scrollMessagesToBottom(host,smooth=true){
    if(!host) return;
    const to=host.scrollHeight-host.clientHeight;
    if(!smooth){ host.scrollTop=to; return; }
    animateMsgScroll(host,to,Math.min(560,240+Math.abs(to-host.scrollTop)*0.25));
  }

  // ---------- 채팅 잠금 (타임아웃 · 채팅 정지 · 도배 제한 · 금지어) ----------
  let chatSettingsUnsub=null, timeoutUnsub=null, lockTick=null, lockKey='';
  function clearChatLockListeners(){
    if(chatSettingsUnsub){try{chatSettingsUnsub();}catch(e){} chatSettingsUnsub=null;}
    if(timeoutUnsub){try{timeoutUnsub();}catch(e){} timeoutUnsub=null;}
    if(lockTick){clearInterval(lockTick);lockTick=null;}
  }
  function chatCfg(){ return state.chatSettings||{}; }
  function warnLimit(){ const n=Number(chatCfg().warnLimit); return n>0?n:3; }
  // 경고가 한도까지 쌓이면 '완전 차단' 대신 정한 시간 동안 타임아웃을 준다 (관리자가 설정)
  const WARN_TIMEOUT_OPTIONS=[{value:300,label:'5분'},{value:600,label:'10분'},{value:1800,label:'30분'},{value:3600,label:'1시간'},{value:10800,label:'3시간'},{value:86400,label:'하루'}];
  function warnTimeoutMin(){ const n=Number(chatCfg().warnTimeoutMin); return n>0?n:30; }
  function warnTimeoutMs(){ return warnTimeoutMin()*60000; }
  function fmtMinLabel(min){
    const o=WARN_TIMEOUT_OPTIONS.find(x=>x.value===min*60);
    if(o) return o.label;
    return min>=60?`${Math.round(min/60)}시간`:`${min}분`;
  }
  function isStaff(){ return isTeacher(); }
  function attachChatLockListeners(){
    clearChatLockListeners();
    chatSettingsUnsub=db.collection('chatSettings').doc('main').onSnapshot(s=>{
      const d=s.exists?s.data():{};
      const words=(v)=>Array.isArray(v)?v.map(x=>String(x).trim()).filter(Boolean):[];
      state.chatSettings={
        blockWords:words(d.blockWords),
        allowWords:words(d.allowWords),
        warnWords:words(d.warnWords),
        flagWords:words(d.flagWords),
        warnLimit:Number(d.warnLimit)>0?Number(d.warnLimit):3,
        warnTimeoutMin:Number(d.warnTimeoutMin)>0?Number(d.warnTimeoutMin):30,
        chatOffAll:!!d.chatOffAll,
        chatOffRooms:(d.chatOffRooms&&typeof d.chatOffRooms==='object')?d.chatOffRooms:{},
        timeoutAllUntil:Number(d.timeoutAllUntil)||0,
        timeoutAllReason:String(d.timeoutAllReason||'')
      };
      // 예전에 이미 한도까지 경고가 쌓여 있던 계정도 영구 차단 대신 타임아웃으로 넘긴다
      if(!isStaff() && state.warnCount>=warnLimit()) applyWarnTimeout();
      if(state.room){ refreshComposer(); startLockTick(); }
    },e=>console.error('chatSettings',e));
    timeoutUnsub=db.collection('chatTimeouts').doc(uid()).onSnapshot(s=>{
      state.timeout=s.exists?s.data():null;
      if(state.room){ refreshComposer(); startLockTick(); }
    },e=>console.error('chatTimeout',e));
  }
  // 내가 지금 타임아웃 상태인지 (개인 타임아웃 + 전체 타임아웃 중 더 늦은 것)
  function timeoutInfo(){
    let until=0, reason='';
    const t=state.timeout;
    if(t){
      if(t.permanent) return {permanent:true,ms:0,reason:t.reason||''};
      const u=Number(t.until)||0; if(u>until){until=u;reason=t.reason||'';}
    }
    const au=Number(chatCfg().timeoutAllUntil)||0;
    if(au>until){until=au;reason=chatCfg().timeoutAllReason||'';}
    const ms=until-Date.now();
    return ms>0?{permanent:false,ms,reason}:null;
  }
  function roomChatOff(room){
    if(!room) return false;
    if(chatCfg().chatOffAll) return true;
    return !!(chatCfg().chatOffRooms||{})[room.id];
  }
  function fmtRemain(ms){
    const s=Math.max(0,Math.ceil(ms/1000));
    const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
    return (h?`${h}시간 `:'')+`${m}분 ${sec}초`;
  }
  function normalizeWord(s){ return String(s||'').toLowerCase().replace(/\s+/g,''); }
  function findBanned(text,words){
    const t=normalizeWord(text); if(!t) return '';
    for(const w of (words||[])){ const n=normalizeWord(w); if(n&&t.includes(n)) return w; }
    return '';
  }
  // 우회 표기(시1발, 시.발, 시 발 …)를 잡기 위해 숫자·기호·공백을 전부 지우고 비교한다
  function normalizeLoose(s){ return String(s||'').toLowerCase().replace(/[^a-z\u3131-\u318e\uac00-\ud7a3]/g,''); }
  function findLoose(text,words){
    const t=normalizeLoose(text); if(!t) return '';
    for(const w of (words||[])){ const n=normalizeLoose(w); if(n.length>=2&&t.includes(n)) return w; }
    return '';
  }
  // 초성 축약 욕설은 관리자 금지어와 별개로 항상 막는다
  const BYPASS_PATTERNS=['ㅅㅂ','ㅆㅂ','ㅂㅅ','ㅄ','ㅁㅊ','ㅈㄴ','ㄲㅈ','ㅈㄹ','ㅅㅋ','ㅗㅗ'];
  function findAnyBanned(text,words){
    return findBanned(text,words) || findLoose(text,words);
  }
  // 짧은 시간에 너무 많이 보내면 10초 동안 전송을 막는다
  const FLOOD_WINDOW_MS=10000, FLOOD_MAX=8, FLOOD_PENALTY_MS=10000;
  function floodBlockMs(){
    const now=Date.now();
    if((state.flood.until||0)>now) return state.flood.until-now;
    const arr=(state.flood.times||[]).filter(t=>now-t<=FLOOD_WINDOW_MS);
    if(arr.length>=FLOOD_MAX){ state.flood.times=[]; state.flood.until=now+FLOOD_PENALTY_MS; return FLOOD_PENALTY_MS; }
    arr.push(now); state.flood.times=arr;
    return 0;
  }
  function lockState(){
    const to=timeoutInfo();
    if(to) return {kind:'timeout', to};
    const f=Math.max(0,(state.flood.until||0)-Date.now());
    if(f>0) return {kind:'flood', ms:f};
    if(!isStaff() && state.room && roomChatOff(state.room)) return {kind:'chatoff'};
    if(!isStaff() && state.warnCount>=warnLimit()) return {kind:'warn'};
    return {kind:'ok'};
  }
  function lockKeyOf(st){
    if(st.kind==='timeout') return st.to.permanent?'timeout-p':'timeout-'+Math.ceil(st.to.ms/1000);
    if(st.kind==='flood') return 'flood-'+Math.ceil(st.ms/1000);
    return st.kind;
  }
  function startLockTick(){
    if(lockTick) return;
    lockKey=lockKeyOf(lockState());
    lockTick=setInterval(()=>{
      const st=lockState(); const k=lockKeyOf(st);
      if(k===lockKey) return;
      lockKey=k; refreshComposer();
      if(k==='ok'){ clearInterval(lockTick); lockTick=null; }
    },1000);
  }
  // 경고가 한도까지 쌓이면 정해진 시간 동안 타임아웃을 주고 경고를 0으로 되돌린다
  async function applyWarnTimeout(){
    const limit=warnLimit(), min=warnTimeoutMin();
    // 먼저 로컬 경고를 비워 같은 처리가 여러 번 실행되지 않게 한다
    state.warnCount=0; if(state.profile) state.profile.warnCount=0;
    // 관리자·선생님이 직접 걸어 둔 타임아웃은 건드리지 않는다
    const t=state.timeout;
    const keep=!!(t && t.auto!==true && (t.permanent || Number(t.until)>Date.now()));
    try{
      if(!keep) await db.collection('chatTimeouts').doc(uid()).set({reason:`경고 ${limit}번 누적`,permanent:false,until:Date.now()+warnTimeoutMs(),auto:true,by:'system',byName:'자동',updatedAt:ts()},{merge:true});
      await db.collection('users').doc(uid()).update({warnCount:0,updatedAt:ts()});
    }catch(e){ console.error('warn timeout',e); }
    if(!keep) toast(`경고가 ${limit}번 쌓여서 ${fmtMinLabel(min)} 동안 메시지를 보낼 수 없어요.`);
  }
  async function addWarning(word){
    const n=(Number(state.profile?.warnCount)||0)+1;
    if(n>=warnLimit()) return applyWarnTimeout();
    state.warnCount=n; if(state.profile) state.profile.warnCount=n;
    try{ await db.collection('users').doc(uid()).update({warnCount:n,updatedAt:ts()}); }
    catch(e){ console.error('warn',e); }
    toast(`‘${word}’ 은(는) 쓰지 않는 게 좋아요. 경고 ${n}번 (${Math.max(0,warnLimit()-n)}번 더 받으면 ${fmtMinLabel(warnTimeoutMin())} 타임아웃이에요)`);
  }

  // ---------- 자동 검열 · 이의 신청 (오검열 제보) ----------
  let modBlocksUnsub=null, myAppealsUnsub=null;
  const MOD_TEXT_MAX=1500, MOD_REASON_MAX=500;
  function appealOf(blockId){ return (state.myAppeals||[]).find(a=>a.blockId===blockId)||null; }
  // 검열에 걸린 메시지는 보내지 않고 기록만 남긴다. 보낸 사람 화면에 카드로 보이고 이의 신청을 할 수 있다.
  async function blockMessage(text,word,kind){
    const room=state.room;
    const body={
      roomId:room?.id||'', roomName:room?.name||'', roomOwnerId:room?.createdBy||'',
      senderId:uid(), senderName:state.profile?.displayName||'', senderRole:state.profile?.role||'student',
      text:String(text||'').slice(0,MOD_TEXT_MAX), word:String(word||''), kind,
      status:'blocked', createdAt:ts(), expire_at:expireTs(365)
    };
    try{ await db.collection('moderationBlocks').add(body); }
    catch(e){ console.error('modblock',e); }
    toast(`‘${word}’ 은(는) 보낼 수 없는 말이에요. 대화 목록의 카드에서 이의 신청을 할 수 있어요.`);
  }
  function openModAppeal(blockId){
    const b=(state.modBlocks||[]).find(x=>x.id===blockId); if(!b) return;
    if(appealOf(blockId)) return toast('이미 이의 신청을 보냈어요.');
    openModal(`<h2>이의 신청</h2><p class="desc">잘못 걸렸다고 생각하면 사유를 적어 주세요. 담당 선생님이 확인하고, 받아들여지면 이 메시지가 채팅방에 다시 나타나요.</p>
      <div class="mod-quote">${esc(b.text)}</div>
      <div class="field"><label>사유</label><textarea id="modAppealReason" class="input" maxlength="${MOD_REASON_MAX}" style="min-height:120px" placeholder="예: ‘시발역’은 지하철역 이름이라 욕이 아니에요."></textarea><p class="desc" style="margin:7px 0 0;font-size:12px">5자 이상 적어 주세요.</p></div>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" data-action="mod-appeal-send" data-block="${esc(b.id)}">이의 신청 보내기</button></div>`);
  }
  async function submitModAppeal(blockId){
    const b=(state.modBlocks||[]).find(x=>x.id===blockId); if(!b) return;
    if(appealOf(blockId)){ closeAllModals(); return toast('이미 이의 신청을 보냈어요.'); }
    const reason=($('#modAppealReason')?.value||'').trim();
    if(reason.length<5) return toast('사유를 5자 이상 적어 주세요.');
    try{
      await db.collection('moderationAppeals').add({
        blockId:b.id, roomId:b.roomId||'', roomName:b.roomName||'', roomOwnerId:b.roomOwnerId||'',
        senderId:uid(), senderName:state.profile?.displayName||'',
        text:String(b.text||'').slice(0,MOD_TEXT_MAX), word:b.word||'', reason:reason.slice(0,MOD_REASON_MAX),
        status:'open', createdAt:ts(), expire_at:expireTs(365)
      });
    }catch(e){ console.error('modappeal',e); return toast(errText(e)); }
    closeAllModals();
    toast('이의 신청을 보냈어요. 선생님이 확인하면 복구돼요.');
  }
  // 지금 보고 있는 채팅방에서 내가 검열로 막힌 메시지를 카드로 보여준다 (나만 보임)
  // 카드 한 장을 그린다 (목록에서는 보낸 시점 자리에 끼워진다)
  function modBlockHtml(b){
    const a=appealOf(b.id);
    const foot=!a
      ? `<button type="button" class="soft-btn mod-appeal-btn" data-action="mod-appeal" data-block="${esc(b.id)}">이의 신청</button>`
      : a.status==='open' ? `<div class="mod-state">이의 신청을 보냈어요 · 확인 중</div>`
      : a.status==='approved' ? `<div class="mod-state ok">이의 신청이 받아들여져 복구됐어요.</div>`
      : `<div class="mod-state">이의 신청이 받아들여지지 않았어요.</div>`;
    return `<div class="message-row center" data-block-id="${esc(b.id)}"><div class="message-content"><div class="mod-card">
      <div class="mod-head">🚫 검열로 보내지 못한 메시지</div>
      <div class="mod-text">${esc(b.text)}</div>
      <div class="mod-meta">걸린 말: <b>${esc(b.word)}</b> · ${esc(timeText(b.createdAt))}</div>
      ${foot}
    </div></div></div>`;
  }
  function attachModerationListeners(){
    if(modBlocksUnsub) return;
    modBlocksUnsub=db.collection('moderationBlocks').where('senderId','==',uid()).limit(50).onSnapshot(s=>{
      state.modBlocks=s.docs.map(d=>({id:d.id,...d.data()})).filter(b=>b.status==='blocked').sort((a,b)=>docTs(a.createdAt)-docTs(b.createdAt));
      if(state.room && !state.searchMode) renderMessages();
    },e=>console.error('modBlocks',e));
    myAppealsUnsub=db.collection('moderationAppeals').where('senderId','==',uid()).limit(50).onSnapshot(s=>{
      state.myAppeals=s.docs.map(d=>({id:d.id,...d.data()}));
      if(state.room && !state.searchMode) renderMessages();
    },e=>console.error('myAppeals',e));
  }
  function clearModerationListeners(){
    if(modBlocksUnsub){try{modBlocksUnsub();}catch(e){} modBlocksUnsub=null;}
    if(myAppealsUnsub){try{myAppealsUnsub();}catch(e){} myAppealsUnsub=null;}
    state.modBlocks=[]; state.myAppeals=[];
  }

  function clearListeners() {
    state.listeners.forEach(fn => { try { fn(); } catch {} });
    state.listeners = [];
    stopBrandRotate();
    stopTyping();
    clearRoomListener();
    clearInviteListener();
    clearSentInviteListener();
    clearFriendListeners();
    clearSiteNoticeListener();
    clearChatLockListeners();
    clearModerationListeners();
    clearDutyListeners();
    clearRoleListeners();
    $$('#stickyRoot .sticky-card').forEach(el=>el.remove());
    if(noticeUnsub){try{noticeUnsub();}catch{} noticeUnsub=null;}
    state.profileUnsubs.forEach(fn=>{try{fn();}catch{}});state.profileUnsubs=[];state.profileListeningKey='';
    clearTimeout(roomLoadTimer);roomLoadTimer=null;
    clearTimeout(state.banner.timer);
    // 로그아웃 뒤에도 남아 있던 타이머를 정리한다
    clearTimeout(profileRerenderTimer);profileRerenderTimer=null;
    if(resetTick){ clearInterval(resetTick); resetTick=null; }
    clearSessionListener();
  }
  let roomLoadTimer = null;
  let roomUnsub = null;
  let attendanceUnsub=null;
  function clearAttendanceListener(){ if(attendanceUnsub){ try{attendanceUnsub();}catch(e){} attendanceUnsub=null; } const pill=$('#attendPill'); if(pill) pill.remove(); }
  function clearRoomListener() { if (roomUnsub) { roomUnsub(); roomUnsub = null; } clearTypingListener(); clearReadsListener(); clearRoomDocListener(); clearAttendanceListener(); clearFlagListener(); }
  // 보고 있는 방의 정보(참여자·이름·설명)가 바뀌면 헤더 숫자만 살려서 반영한다
  // (전체 다시 그리기는 입력 초안을 날리므로 하지 않는다)
  let roomDocUnsub=null;
  function clearRoomDocListener(){ if(roomDocUnsub){ try{roomDocUnsub();}catch(e){} roomDocUnsub=null; } }
  function attachRoomDocListener(id){
    clearRoomDocListener();
    try{
      roomDocUnsub=db.collection('channels').doc(id).onSnapshot(s=>{
        if(!s.exists || state.room?.id!==id) return;
        const data={id,...s.data()};
        const prevIds=new Set(state.room?.memberIds||[]), nextIds=new Set(data.memberIds||[]);
        const membersChanged=[...prevIds,...nextIds].some(x=>!prevIds.has(x)||!nextIds.has(x));
        const iWasIn=prevIds.has(uid()), iAmIn=nextIds.has(uid());
        const myChanged=iWasIn!==iAmIn;
        // 내가 방에서 빠지면 visibility와 무관하게 진짜 나가기로 처리한다
        // (대화 불가 상태로 남아있지 않고 목록에서 제거 + 화면·설정 닫기)
        if(!iAmIn && myChanged){
          markRoomLeft(id);
          state.rooms=(state.rooms||[]).filter(r=>r.id!==id);
          if(state.allRooms) state.allRooms=state.allRooms.filter(r=>r.id!==id);
          if(state.unread) delete state.unread[id];
          try{ renderUnreadSummary(); }catch(e){}
          state.room=null; clearRoomListener(); clearChatPane();
          closeRoomSettingsIfOpen(id);
          closeAllModals();
          renderRooms();
          toast('채팅방에서 나왔어요.');
          return;
        }
        state.rooms=(state.rooms||[]).map(r=>r.id===id?{...r,...data}:r);
        state.room={...(state.room||{}),...data};
        renderRooms();
        const c=document.querySelector('#chat .chat-head .hb-count'); if(c) c.textContent=String((data.memberIds||[]).length);
        // 참여자 패널 숫자는 목록에 실제 뜬 사람 수 기준이라 renderMemberPanel에서만 갱신한다
        if(myChanged) refreshComposer();
        if(membersChanged){ ensureCurrentProfiles(); if(state.memberPanel) renderMemberPanel(); }
      },e=>console.error('room doc',e?.code||e));
    }catch(e){}
  }
  let inviteUnsub = null;
  function clearInviteListener() { if (inviteUnsub) { try { inviteUnsub(); } catch {} inviteUnsub = null; } }
  let sentInviteUnsub = null;
  function clearSentInviteListener() { if (sentInviteUnsub) { try { sentInviteUnsub(); } catch {} sentInviteUnsub = null; } }

  function resetApp() {
    clearListeners();
    state.authPage='';
    state.landingRequested=false;
    state.landingDraft=null;
    closeAllModals();
    state.user = null; state.profile = null; state.room = null; state.rooms = []; state.messages = [];
    state.pendingInvites = []; state.unread = {}; state.profileCache.clear(); state.blockedMeCache.clear(); state.firstRender = true;
    // 계정이 바뀌면 이전 세션의 추적용 캐시·집합도 함께 비운다 (무한 증가 방지)
    state.knownRoomIds = new Set(); state.seenMsgIds = new Set(); state.bubbleAnims = new Map(); state._cleanedSchool = null;
    shownFriendCards.clear(); healedRooms.clear();
    state.view = 'chat'; state.adminTab = 'school'; state.adminUsers = null; state.reports = [];
    state.siteNotice = { banner: null, popup: null }; state.pendingHighlight = null; state.profileDraft = null;
    state.selectedSchool = null; state.schoolInfo = null; state.schoolList = null;
    state.neisRows = null; state.schoolCodes = null; state.schoolEdit = null;
    state.searchMode = false; state.searchQuery = ''; state.searchHits = []; state.searchIndex = -1;
    state.memberPanel = false; state.awayMsgId = null; state.unreadMarkerId = null; state.noReactions = false; state.allRooms = null;
    state.mention = null; state.attachDraft = null;
    stopPresence();
  }

  function bootError(err) {
    console.error(err);
    app.innerHTML = `<div class="boot"><div class="boot-mark" style="background:#e5484d">E</div><div><strong>에듀톡을 불러오지 못했어요</strong><span>잠시 후 다시 시도해 주세요.</span><button class="primary" data-action="retry" style="margin-top:14px;padding:0 18px">다시 시도</button></div></div>`;
  }

  function schoolInfoFrom(d){ return { grades: Array.isArray(d?.grades) ? d.grades.map(Number).sort((a,b)=>a-b) : [], classCounts: d?.classCounts || {} }; }
  async function loadSchool() {
    const sid = state.profile?.schoolId || state.selectedSchool?.id;
    if (sid) {
      try {
        const snap = await db.collection('schools').doc(sid).get();
        if (snap.exists) { state.school = schoolInfoFrom(snap.data()); state.schoolInfo = { id: sid, ...snap.data() }; return; }
      } catch (e) { console.error('school load', e); }
    }
    try {
      const snap = await db.collection('schoolSettings').doc('main').get();
      const d = snap.exists ? snap.data() : {};
      state.school = schoolInfoFrom(d);
    } catch (e) { state.school = { grades: [], classCounts: {} }; }
  }
  async function loadSchoolList(force = false) {
    if (state.schoolList && !force) return state.schoolList;
    try {
      const snap = await db.collection('schools').limit(300).get();
      state.schoolList = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.active !== false);
    } catch (e) { console.error('school list', e); state.schoolList = []; }
    return state.schoolList;
  }

  let pendingSignup = null;
  function setPendingSignup(v){
    pendingSignup = v || null;
    try{
      if(pendingSignup) sessionStorage.setItem('edutalk_pending_signup', JSON.stringify(pendingSignup));
      else sessionStorage.removeItem('edutalk_pending_signup');
    }catch(e){}
  }
  try{
    const raw=sessionStorage.getItem('edutalk_pending_signup');
    if(raw) pendingSignup=JSON.parse(raw);
  }catch(e){}
  async function ensureProfile() {
    const pending = pendingSignup;
    const ref = db.collection('users').doc(uid());
    const snap = await ref.get();
    if (!snap.exists) {
      const u = auth.currentUser;
      const displayName = pending?.displayName || u?.displayName || '사용자';
      const grade = pending?.grade ?? null, classNum = pending?.classNum ?? null;
      await ref.set({ email: u?.email || '', displayName, role:'student', grade, classNum, schoolId:pending?.schoolId||'', schoolName:pending?.schoolName||'', schoolCode:pending?.schoolCode||'', photoURL:u?.photoURL || '', blockedUsers:[], blockHistory:{}, invitePolicy:'ask', settings:{fontSize:'md',roomGroups:{}}, consents:{ privacy:pending?.consentPrivacy===true, terms:pending?.consentTerms===true, age14:pending?.consentAge14===true, privacyVersion: POLICY_VERSIONS.privacy, termsVersion: POLICY_VERSIONS.terms, at:ts() }, createdAt:ts(), updatedAt:ts() });
      await db.collection('publicProfiles').doc(uid()).set({ displayName, grade, classNum, schoolId:pending?.schoolId||'', avatarEmoji:'', avatarColor:'', bio:'', role:'student', photoURL:u?.photoURL || '', updatedAt:ts() }, {merge:true});
      setPendingSignup(null);
      return (await ref.get()).data();
    }
    setPendingSignup(null);
    return snap.data();
  }

  // ---------- 사용자 고유 초대 코드 ----------
  // 헷갈리기 쉬운 글자(0, O, 1, I, L)는 뺀다
  const CODE_ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function normalizeCode(v){ return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12); }
  function randomCode(n){
    const out=[]; const a=new Uint32Array(n);
    try{ crypto.getRandomValues(a); }catch(e){ for(let i=0;i<n;i++) a[i]=Math.floor(Math.random()*4294967296); }
    for(let i=0;i<n;i++) out.push(CODE_ALPHABET[a[i]%CODE_ALPHABET.length]);
    return out.join('');
  }
  // 코드는 겹치면 안 되므로 '문서 만들기'로 자리를 잡고, 이미 있으면 다시 뽑는다
  async function ensureUserCode(){
    if(state.profile?.userCode) return state.profile.userCode;
    for(let i=0;i<8;i++){
      const code=randomCode(6);
      try{ await db.collection('userCodes').doc(code).set({uid:uid(),createdAt:ts()}); }
      catch(e){ continue; }
      try{ await db.collection('users').doc(uid()).update({userCode:code,updatedAt:ts()}); }
      catch(e){ console.error('userCode save',e); }
      if(state.profile){ state.profile.userCode=code; state.profileCache.set(uid(),state.profile); }
      $$('[data-my-code]').forEach(el=>{ el.textContent=code; });
      return code;
    }
    return '';
  }
  async function findUserByCode(raw){
    if(!checkInviteRate()) return null;
    const code=normalizeCode(raw);
    if(code.length<4) return null;
    const s=await db.collection('userCodes').doc(code).get();
    if(!s.exists) return null;
    const target=String(s.data().uid||'');
    if(!target) return null;
    let profile=state.profileCache.get(target)||null;
    if(!profile){
      try{ const p=await db.collection('publicProfiles').doc(target).get(); profile=p.exists?p.data():null; }
      catch(e){ console.error('code profile',e); }
    }
    if(profile) state.profileCache.set(target,profile);
    return {uid:target,code,profile};
  }
  async function copyMyCode(){
    let code=state.profile?.userCode||'';
    if(!code){ try{ code=await ensureUserCode(); }catch(e){} }
    if(!code) return toast('초대 코드를 아직 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    try{ await navigator.clipboard.writeText(code); toast(`초대 코드를 복사했어요 · ${code}`); }
    catch(e){
      openModal(`<h2>내 초대 코드</h2><p class="desc">아래 코드를 복사해서 친구에게 알려 주세요.</p><div class="code-box">${esc(code)}</div><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
    }
  }

  async function handleUser(user) {
    resetApp();
    state.dupKickNotice=consumeDupKick(); state.dupKickToastShown=false;
    if (!user) {
      // 관리자가 소개 페이지를 켜 두었으면 로그인 화면보다 소개 페이지를 먼저 보여 준다
      if (landingReady) await landingReady;
      // 로그아웃은 화면 전체 줌 전환으로 나간다 (툭 바뀌지 않게)
      if(state.logoutZoom){
        state.logoutZoom=false;
        zoomTransition('#app .app', ()=>{
          // 모바일(좁은 화면)은 소개를 건너뛰고 로그인으로 바로 간다
          if (landingEnabled() && !(window.innerWidth<=820 && !state.landingRequested)){ renderLanding(); }
          else { loadSchoolList(true).catch(()=>{}); renderAuth(); }
          if(!prefersReducedMotion()){
            const el=document.querySelector('#app .landing')||document.querySelector('#app .auth');
            if(el) el.classList.add('screen-enter');
          }
        }, null);
        return;
      }
      // 모바일(좁은 화면)은 소개를 건너뛰고 로그인으로 바로 간다 (소개는 로그인 화면의 소개 보기로)
      if (landingEnabled() && !(window.innerWidth<=820 && !state.landingRequested)) { renderLanding(); return; }
      await loadSchoolList(true);
      renderAuth();
      return;
    }
    state.user = user;
    state.loginAt = Date.now();
    // 교육청 이메일 확인 링크로 들어왔으면 수신함 인증을 마무리한다
    try{ if(auth.isSignInWithEmailLink(location.href)) runAsync(()=>completeEduLink()); }catch(e){} // 로그인 전에 온 메시지는 숫자 배지만 띄우고 알림으로 보내지 않는다
    try {
      state.profile = await ensureProfile();
      if (!state.profile) { bootError(new Error('profile missing')); return; }
      // 관리자가 이용을 정지한 계정은 안내 화면만 보여준다
      if (state.profile.suspended === true) { await renderSuspended(); return; }
      // 탈퇴한 계정으로 다시 로그인한 경우
      if (state.profile.deleted === true) { await auth.signOut(); toast('탈퇴한 계정이에요. 다시 가입해 주세요.'); return; }
      await loadSchool();
      state.settings = { fontSize: state.profile.settings?.fontSize || 'md', invitePolicy: state.profile.invitePolicy || 'ask', roomGroups: state.profile.settings?.roomGroups || {}, groupOrder: state.profile.settings?.groupOrder || null, theme: state.profile.settings?.theme || currentTheme(), mutedRooms: state.profile.settings?.mutedRooms || [], presenceMode: state.profile.settings?.presenceMode || 'auto', notify: state.profile.settings?.notify || { sound:true, soundId:'bell', browser:false }, typingIndicator: state.profile.settings?.typingIndicator !== false, readReceipts: state.profile.settings?.readReceipts !== false, keywords: [], sideLayout: state.profile.settings?.sideLayout || 'split', reactionEmojis: Array.isArray(state.profile.settings?.reactionEmojis)?state.profile.settings.reactionEmojis.slice(0,8):null, collapsedSideSections: Array.isArray(state.profile.settings?.collapsedSideSections)?state.profile.settings.collapsedSideSections.slice():[], collapsedGroups: Array.isArray(state.profile.settings?.collapsedGroups)?state.profile.settings.collapsedGroups.slice():[], desktopUnread: state.profile.settings?.desktopUnread || { enabled:false, interval:5, sound:false, soundId:'bell' } };
      try{
        const priv=await db.collection('userPrivate').doc(uid()).get();
        const kws=priv.exists?(priv.data().keywords||[]):[];
        if(Array.isArray(kws)) state.settings.keywords=kws.map(x=>String(x||'')).filter(Boolean).slice(0,10);
      }catch(e){}
      if(!['auto','away','dnd','offline','hidden'].includes(state.settings.presenceMode)) state.settings.presenceMode='auto';   // 예전 '상시 온라인' 값 정리
      state.warnCount = Number(state.profile.warnCount) || 0;
      state.groupNames = Array.isArray(state.settings.groupOrder) && state.settings.groupOrder.length
        ? state.settings.groupOrder.slice()
        : DEFAULT_GROUPS.slice();
      state.profileCache.set(uid(), state.profile);
      ensureUserCode().catch(e=>console.error('userCode',e));
      applyFontSize();
      try{ if(DESKTOP) startDesktopUnreadTimer(); }catch(e){}
      // Native 푸시 등록 (Capacitor.isNativePlatform() 일 때만, 웹은 스킵)
      // 로그인 전에 받은 토큰이 있으면 지금 저장한다 (오프라인·백그라운드 알림용)
      try{ if(window.EdutalkNative?.isNative()) window.EdutalkNative.registerPush().catch(()=>{}); }catch(e){}
      try{ if(window.EdutalkNative?.flushPushToken) window.EdutalkNative.flushPushToken(); }catch(e){}
      try{ if(typeof window.__edutalkFlushPushToken==='function') window.__edutalkFlushPushToken(); }catch(e){}
      // 중복 로그인: 이 기기의 세션을 기록하고 감시를 시작한다
      state.dupKicked=false; state.dupKickNotice=''; state.dupKickToastShown=false;
      // 12번: 기존 세션이 있으면 예/아니오 확인 후 claim (아니오면 로그인 중단)
      try{
        const proceed=await checkExistingSession();
        if(!proceed) return;
      }catch(e){}
      claimSession().then(ok=>{ if(ok) attachSessionListener(); });
      runAsync(()=>flushOutbox());
      startSchedTimer();
      // 앱 잠금이 켜져 있으면 비밀번호를 먼저 묻는다 - SecureStorage/Keychain 및 서버에 저장된 잠금이 있으면 로컬로 복원
      try{ await restoreAppLockFromSecure(); }catch(e){}
      if(isLockEnabled()){
        state.shellZoomEnter=false;
        await new Promise(res=> showLockScreen(res));
        state.shellZoomEnter=true;
      }
      renderShell();
      try{ initHistoryRouting(); }catch(e){}
      try{ checkUrlForRoom(); }catch(e){}
      attachRoomListeners();
      attachInviteListener();
      attachSentInviteListener();
      attachFriendListeners();
      attachChatLockListeners();
      attachModerationListeners();
      loadHiddenMessages();
      backfillBlockDocs().catch(e=>console.error('blocks',e));
      attachNoticeListener();
      attachSiteNoticeListener();
      attachRoleListeners();
      attachDutyListeners();
      watchSuspension();
      backfillPublicProfile().catch(e=>console.error('public profile',e));
      recordLoginInfo().catch(e=>console.error('login info',e));
      await maybeShowProfileSetup();
      // 정책 개정 시 재동의 요청 (Firestore sitePolicy/current 우선, 버전 다르면 강제 동의 팝업 - X 없음, 체크 필수)
      try{ await loadEffectivePolicyVersions(); }catch(e){}
      try{ if(needsPolicyReconsent(state.profile)) await promptPolicyReconsent(); }catch(e){}
      maybeShowSiteNoticePopup();
    } catch (e) {
      console.error(e);
      if (e?.code === 'permission-denied') {
        renderSchoolGate('학교 코드가 맞지 않거나 학교가 아직 등록되지 않았어요. 선생님께 받은 코드를 다시 확인해 주세요.');
        return;
      }
      bootError(e);
    }
  }

  setupGlobalHandlers();
  try{ armInstantRelock(); }catch(e){}
  try{ armSwipeBack(); }catch(e){}
  auth.onAuthStateChanged(handleUser);

  // 데스크톱 알림창을 누르면 그 채팅방을 바로 연다.
  if(DESKTOP && typeof window.edutalkDesktop.onOpenRoom==='function'){
    window.edutalkDesktop.onOpenRoom((roomId)=>{ if(roomId && state.user) openRoom(roomId); });
  }

  const HERO_WORDS = ['멋지게 대화해요','편하게 대화해요','멋지게 고민해요','편하게 고민해요','멋지게 질문해요','편하게 질문해요','편하게 생활해요','멋지게 생활해요'];
  const HERO_POINTS = [
    { icon:'💬', text:'모둠·동아리·개인 메시지' },
    { icon:'🙋', text:'선생님분들께 멋지게 질문하기' },
    { icon:'🔒', text:'학교 코드로 안전하게 채팅' },
    { icon:'🌐', text:'타학교와 채팅 공유' }
  ];
  let heroRollTimer = null;
  let heroFadeTimer = null;
  function shuffled(list){
    const r=list.slice();
    for(let i=r.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=r[i]; r[i]=r[j]; r[j]=t; }
    return r;
  }
  function authHeroHtml(){
    const order=shuffled(HERO_WORDS);
    const items = order.concat([order[0]]).map(w=>`<i>${esc(w)}</i>`).join('');
    return `<aside class="auth-hero"><span class="auth-blob b1"></span><span class="auth-blob b2"></span><span class="auth-blob b3"></span>
      <div class="auth-hero-top"><div class="brand-mark">${brandMarkHtml()}</div><strong>${esc(brandNames()[0]||'에듀톡')}</strong></div>
      <div class="auth-hero-body"><h2>학교 안에서<br><span class="roll"><span class="roll-track" id="heroRoll">${items}</span></span></h2>
      <p>선생님이 알려준 <b>학교 코드</b>로 가입하고, 우리 학교 친구들과 안전하게 이야기해요.</p>
      <div class="auth-hero-mobile" id="heroFadeBox"><span id="heroFade">${esc(HERO_POINTS[0].text)}</span></div>
      <ul class="auth-points">${HERO_POINTS.map(p=>`<li><span class="pt-ico">${p.icon}</span>${esc(p.text)}</li>`).join('')}</ul></div></aside>`;
  }
  // 안내 페이지 링크 (관리자 도구 → 안내 페이지에서 켜고 끌 수 있어요)
  function authLinkButtons(){
    const pages=authPages();
    if(!pages.length) return '';
    return pages.map(p=>`<button type="button" class="auth-link" data-action="auth-page" data-page="${esc(p.id)}">${esc(p.label||p.title||p.id)}</button>`).join('<span class="auth-sep">·</span>');
  }
  function stopHeroRoll(){ if(heroRollTimer){ clearTimeout(heroRollTimer); heroRollTimer=null; } stopHeroFade(); }
  function stopHeroFade(){ if(heroFadeTimer){ clearInterval(heroFadeTimer); heroFadeTimer=null; } }
  // 좁은 화면용 알약: 글자 길이에 맞춰 폭이 부드럽게 늘었다 줄었다 해요.
  function heroPillFit(){
    const el=document.getElementById('heroFade'), b=document.getElementById('heroFadeBox');
    if(!el||!b) return;
    if(!b.offsetWidth){ b.style.width=''; return; }
    if(!b.dataset.pad) b.dataset.pad=String(Math.max(0,b.offsetWidth-el.offsetWidth));
    b.style.width=(el.offsetWidth+Number(b.dataset.pad))+'px';
  }
  function startHeroFade(){
    stopHeroFade();
    const first=document.getElementById('heroFade');
    if(!first) return;
    let i=0;
    first.textContent=HERO_POINTS[0].text;
    heroPillFit();
    heroFadeTimer=setInterval(()=>{
      const el=document.getElementById('heroFade');
      if(!el||!el.isConnected){ stopHeroFade(); return; }
      el.classList.add('out');
      setTimeout(()=>{
        i=(i+1)%HERO_POINTS.length;
        el.textContent=HERO_POINTS[i].text;   // 투명한 동안 글자만 바꾸고
        heroPillFit();                        // 폭은 transition으로 따라오게 한다
      },190);
      setTimeout(()=>{ if(el.isConnected) el.classList.remove('out'); },560);
    },2600);
  }
  const HERO_MOVE_MS=620;   // CSS transition(transform .62s)과 같은 값
  const HERO_HOLD_MS=1700;  // 한 문장이 머무는 시간
  function startHeroRoll(){
    stopHeroRoll();
    const track0=document.getElementById('heroRoll');
    if(!track0) return;
    try{ if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; }catch(e){}
    const items0=track0.children;
    if(items0.length<2) return;
    const total=items0.length-1; // 마지막 칸은 첫 문장 복제본 → 여기까지 오면 흔적 없이 되돌린다
    let i=0;
    const wait=HERO_MOVE_MS+HERO_HOLD_MS;
    const step=()=>{
      const t=document.getElementById('heroRoll');
      if(!t||!t.isConnected){ stopHeroRoll(); return; }
      const items=t.children;
      if(items.length<2) return;
      const h=items[0].getBoundingClientRect().height;
      if(!h){ heroRollTimer=setTimeout(step,300); return; }
      const wrap=t.parentElement;
      if(wrap) wrap.style.height=h+'px';
      if(i>=total){
        // 복제본 위치에 도착한 순간 되돌린다. 화면에 보이는 글자가 같아서 티가 나지 않는다.
        t.style.transition='none';
        t.style.transform='translateY(0px)';
        t.dataset.i='0';
        void t.offsetHeight;
        t.style.transition='';
        i=0;
      }
      i+=1;
      t.dataset.i=String(i);
      t.style.transform=`translateY(${-(i*h)}px)`;
      heroRollTimer=setTimeout(step,wait);
    };
    heroRollTimer=setTimeout(step,wait);
  }
  function showAuthError(msg){
    const el=$('#authError');
    if(el){ el.textContent=msg; el.classList.remove('hidden'); }
    toast(msg);
  }
  function clearAuthError(){
    const el=$('#authError');
    if(el){ el.textContent=''; el.classList.add('hidden'); }
  }
  // ---------- 이용 정지 안내 + 이의 제기 ----------
  // 관리자가 정지하면 쓰던 중이라도 바로 안내 화면으로 바뀐다
  function watchSuspension(){
    const unsub=db.collection('users').doc(uid()).onSnapshot(s=>{
      if(!s.exists) return;
      const d=s.data()||{};
      if(d.suspended===true){
        state.profile={...(state.profile||{}),...d};
        closeAllModals();
        clearListeners();
        renderSuspended();
        return;
      }
      // 학교에서 제거되면 남은 학교 방을 본인 기기에서 자동 정리한다 (관리자 눈에 안 보이는 개인 방까지)
      const pend=d.pendingSchoolCleanup;
      if(pend && pend.schoolId && state._cleanedSchool!==pend.schoolId){
        state._cleanedSchool=pend.schoolId;
        runAsync(async ()=>{
          state.profile={...(state.profile||{}),schoolId:d.schoolId||'',schoolName:d.schoolName||''};
          const n=await leaveOldSchoolRooms(uid(), pend.schoolId, '');
          try{ await db.collection('users').doc(uid()).update({pendingSchoolCleanup:firebase.firestore.FieldValue.delete(),updatedAt:ts()}); }catch(e){ console.warn('cleanup flag',e); }
          try{ await loadSchool(); }catch(e){}
          renderSidebar();
          if(state.room) refreshComposer();
          toast(`이전 학교(${pend.schoolName||'학교'}) 채팅방 ${n}개에서 나왔어요.`);
        });
      }
    },e=>console.error('suspend watch',e));
    state.listeners.push(unsub);
  }
  async function renderSuspended(){
    applyTheme();
    stopHeroRoll();
    const p=state.profile||{};
    let openAppeal=false;
    try{
      const s=await db.collection('appeals').where('uid','==',uid()).limit(5).get();
      openAppeal=s.docs.some(d=>(d.data().status||'open')==='open');
    }catch(e){ console.error(e); }
    app.innerHTML=`<div class="auth"><div class="auth-shell" style="grid-template-columns:minmax(0,1fr)"><div class="auth-card"><div class="auth-card-inner">
      <h1 class="auth-title">이용이 멈춰 있어요</h1>
      <p class="auth-desc">관리자가 이 계정의 이용을 잠시 멈췄어요.</p>
      <div class="suspend-box"><div class="suspend-label">사유</div><div class="suspend-text">${esc(p.suspendReason||'사유가 적혀 있지 않아요.')}</div>${p.suspendAt?`<div class="suspend-meta">${esc(fmtDateTime(p.suspendAt))}</div>`:''}</div>
      ${openAppeal
        ? `<div class="reset-msg ok" style="margin-top:16px">이의 제기를 보냈어요. 관리자가 확인하고 있어요.</div>`
        : `<div class="field" style="margin-top:16px"><label>이의 제기</label><textarea id="appealText" class="input" maxlength="400" style="min-height:110px" placeholder="어떤 일이 있었는지 자세히 적어 주세요."></textarea><p id="appealMsg" class="reset-msg"></p></div>
           <button class="primary" data-action="send-appeal">이의 제기 보내기</button>`}
      <div class="auth-foot"><button class="text-btn" data-action="logout">로그아웃</button></div>
    </div></div></div></div>`;
  }
  async function sendAppeal(){
    const ta=$('#appealText');
    const text=(ta?.value||'').trim();
    const msg=$('#appealMsg');
    const say=(t,cls)=>{ if(msg){ msg.textContent=t; msg.className='reset-msg'+(cls?' '+cls:''); } };
    if(text.length<5) return say('이의 제기 내용을 5자 이상 적어 주세요.','warn');
    try{
      await db.collection('appeals').add({uid:uid(),name:state.profile?.displayName||'',email:state.profile?.email||'',schoolId:state.profile?.schoolId||'',schoolName:state.profile?.schoolName||'',text,status:'open',createdAt:ts()});
    }catch(e){ console.error(e); return say('이의 제기를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.','warn'); }
    say('이의 제기를 보냈어요. 관리자가 확인하면 알려드릴게요.','ok');
    if(ta) ta.value=''; try{ saveDraft(state.room?.id, ''); const h=document.getElementById('composerDraftHint'); if(h) h.classList.remove('show'); }catch(e){}
    toast('이의 제기를 보냈어요.');
  }

  function renderSchoolGate(msg){
    applyTheme();
    stopHeroRoll();
    state.selectedSchool=null;
    app.innerHTML = `<div class="auth"><div class="auth-shell">${authHeroHtml()}
      <div class="auth-card"><div class="auth-card-inner">
        <h1 class="auth-title">학교 정보를 확인해 주세요</h1>
        <p class="auth-desc">${esc(msg||'선생님께 받은 학교 코드를 다시 확인해 주세요.')}</p>
        <div id="gateError" class="form-error hidden"></div>
        <div class="field"><label>학교</label><div class="custom-select"><button type="button" class="select-button" data-action="pick-school"><span data-selected="school">학교를 검색해 주세요</span><span>⌄</span></button></div></div>
        <div class="field"><label>학교 코드</label><input id="gateCode" class="input" maxlength="12" autocomplete="off" placeholder="선생님께 받은 코드를 입력해 주세요."></div>
        <div class="field" style="margin-top:2px"><label>약관 동의 (모두 필수)</label>
          <label class="consent"><input type="checkbox" id="gateAge14"><span><b>만 14세 이상</b>입니다. (필수)</span></label>
          <div class="consent" style="margin-top:8px;gap:10px"><label style="display:flex;gap:9px;align-items:flex-start;flex:1;min-width:0;cursor:pointer"><input type="checkbox" id="gateConsentPrivacy" style="margin:4px 0 0;flex:0 0 16px;width:16px;height:16px"><span><b>개인정보 처리방침</b>에 동의합니다. (필수)</span></label><button type="button" class="text-btn" style="flex:0 0 auto;font-size:12px" data-action="gate-privacy">보기</button></div>
          <div class="consent" style="margin-top:8px;gap:10px"><label style="display:flex;gap:9px;align-items:flex-start;flex:1;min-width:0;cursor:pointer"><input type="checkbox" id="gateConsentTerms" style="margin:4px 0 0;flex:0 0 16px;width:16px;height:16px"><span><b>서비스 이용약관</b>에 동의합니다. (필수)</span></label><button type="button" class="text-btn" style="flex:0 0 auto;font-size:12px" data-action="gate-terms">보기</button></div>
        </div>
        <button class="primary" data-action="retry-profile">다시 시도</button>
        <div class="auth-foot"><button class="text-btn" data-action="logout">다른 계정으로 로그인</button></div>
      </div></div>
    </div></div>`;
    startHeroRoll();
  }
  function retryProfile(){
    const sid=state.selectedSchool?.id||'';
    const code=($('#gateCode')?.value||'').trim().toUpperCase();
    const fail=m=>{ const el=$('#gateError'); if(el){ el.textContent=m; el.classList.remove('hidden'); } toast(m); };
    if(!sid) return fail('학교를 먼저 골라 주세요.');
    if(!code) return fail('학교 코드를 입력해 주세요.');
    if(!$('#gateAge14')?.checked) return fail('만 14세 이상만 가입할 수 있어요.');
    if(!$('#gateConsentPrivacy')?.checked) return fail('개인정보 처리방침에 동의해 주세요.');
    if(!$('#gateConsentTerms')?.checked) return fail('서비스 이용약관에 동의해 주세요.');
    setPendingSignup({ displayName:'', grade:null, classNum:null, schoolId:sid, schoolName:state.selectedSchool?.name||'', schoolCode:code, consentPrivacy:true, consentTerms:true, consentAge14:true, consentedAt:Date.now() });
    location.reload();
  }
  function prefersReducedMotion(){
    try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; }
  }
  // ---------- 로그인 전 소개(랜딩) 페이지 ----------
  const landingSectionId = (t) => 'landing-' + String(t||'top');
  function landingScroll(target){
    const smooth = prefersReducedMotion() ? 'auto' : 'smooth';
    // 맨 위는 sticky 헤더가 아니라 스크롤 영역을 직접 올린다
    if(String(target||'top')==='top'){ const box=$('.landing'); if(box) box.scrollTo({ top:0, behavior:smooth }); return; }
    const el=document.getElementById(landingSectionId(target));
    if(el) el.scrollIntoView({ behavior:smooth, block:'start' });
  }
  const landingScrollBtn = (label,target,cls) => `<button type="button" class="${cls}" data-action="landing-scroll" data-target="${esc(target)}">${esc(label)}</button>`;
  // 비어 있는 항목은 화면에 그리지 않는다 (관리자 편집 중에는 남아 있을 수 있어요)
  const landingFeatures = (c) => (c.features||[]).filter(f=>f.title);
  const landingSteps = (c) => (c.steps||[]).filter(s=>s.title);
  const landingPresets = (c) => (((c.mock&&c.mock.presets)||[])).map(p=>({ name:p.name, messages:(p.messages||[]).filter(m=>m.text) })).filter(p=>p.messages.length);
  function landingPageLinks(){
    const pages=authPages(); if(!pages.length) return '';
    return `<div class="auth-links card-links">${pages.map(p=>`<button type="button" class="auth-link" data-action="landing-page" data-page="${esc(p.id)}">${esc(p.label||p.title||p.id)}</button>`).join('')}</div>`;
  }
  // 메뉴 항목이 눌렸을 때 할 일을 data-action 으로 바꾼다
  function landingLinkAttrs(link){
    const v=link.value||'';
    if(link.action==='page') return `data-action="landing-page" data-page="${esc(v)}"`;
    if(link.action==='url') return `data-action="landing-open-url" data-url="${esc(v)}"`;
    if(link.action==='signup') return 'data-action="landing-signup"';
    if(link.action==='scroll') return `data-action="landing-scroll" data-target="${esc(v||'top')}"`;
    return 'data-action="landing-login"';
  }
  // 하위 항목이 있는 메뉴는 마우스를 올리면 차라락 내려온다
  function landingNavHtml(c){
    return (c.nav||[]).map(n=>{
      if(n.type!=='menu') return `<button type="button" class="landing-menu-btn" ${landingLinkAttrs(n)}>${esc(n.label)}</button>`;
      return `<div class="landing-drop">
        <button type="button" class="landing-menu-btn drop" data-action="landing-drop" aria-haspopup="true" aria-expanded="false">${esc(n.label)}<span class="drop-caret">⌄</span></button>
        <div class="landing-drop-menu">${(n.items||[]).map(s=>`<button type="button" class="landing-drop-item" ${landingLinkAttrs(s)}>${esc(s.label)}</button>`).join('')}</div>
      </div>`;
    }).join('');
  }
  // 좁은 화면용 햄버거 메뉴 (위에서 화면을 꽉 채우며 내려온다)
  function landingSheetHtml(c){
    const items=(c.nav||[]).map((n,i)=>{
      if(n.type!=='menu') return `<button type="button" class="landing-sheet-item" ${landingLinkAttrs(n)}>${esc(n.label)}</button>`;
      return `<div class="landing-acc" data-acc="${i}">
        <button type="button" class="landing-sheet-item" data-action="landing-acc" data-idx="${i}">${esc(n.label)}<span class="acc-caret">⌄</span></button>
        <div class="landing-acc-body">${(n.items||[]).map(s=>`<button type="button" class="landing-sheet-sub" ${landingLinkAttrs(s)}>${esc(s.label)}</button>`).join('')}</div>
      </div>`;
    }).join('');
    return `<div class="landing-sheet" id="landingSheet">
      <div class="landing-sheet-back" data-action="landing-sheet-close"></div>
      <nav class="landing-sheet-panel">
        <div class="landing-sheet-head"><span class="brand-mark">${brandMarkHtml()}</span><strong>${esc(c.brandName)}</strong><button type="button" class="sheet-close" data-action="landing-sheet-close" aria-label="메뉴 닫기">✕</button></div>
        <div class="landing-sheet-body">${items||'<div class="empty-side">메뉴가 없어요.</div>'}</div>
      </nav>
    </div>`;
  }
  function landingHtml(c){
    const hero=c.hero;
    const nav=landingNavHtml(c);
    const feats=landingFeatures(c);
    const stepList=landingSteps(c);
    const showMock = c.mock.enabled !== false && landingPresets(c).length>0;
    // 둘째 줄: 로그인 화면처럼 문구가 한 칸씩 스르륵 바뀐다 (마지막 칸은 첫 문구 복제본)
    const order=shuffled(hero.rollWords||[]);
    const roll = order.length ? `<br><span class="roll"><span class="roll-track" id="heroRoll">${order.concat([order[0]]).map(w=>`<i>${esc(w)}</i>`).join('')}</span></span>` : '';
    const features=feats.length ? `<section class="landing-sec" id="${landingSectionId('features')}">
        <div class="landing-head">${c.featuresTitle?`<h2>${esc(c.featuresTitle)}</h2>`:''}${c.featuresDesc?`<p>${esc(c.featuresDesc)}</p>`:''}</div>
        <div class="landing-grid">${feats.map(f=>`<article class="landing-card">${f.icon?`<div class="ico">${esc(f.icon)}</div>`:''}<h3>${esc(f.title)}</h3>${f.desc?`<p>${esc(f.desc)}</p>`:''}</article>`).join('')}</div>
      </section>` : '';
    const steps=stepList.length ? `<section class="landing-sec" id="${landingSectionId('steps')}">
        <div class="landing-head">${c.stepsTitle?`<h2>${esc(c.stepsTitle)}</h2>`:''}${c.stepsDesc?`<p>${esc(c.stepsDesc)}</p>`:''}</div>
        <div class="landing-steps">${stepList.map((s,i)=>`<article class="landing-step"><div class="num">${i+1}</div><h3>${esc(s.title)}</h3>${s.desc?`<p>${esc(s.desc)}</p>`:''}</article>`).join('')}</div>
      </section>` : '';
    const priceList=Array.isArray(c.pricing)?c.pricing.filter(x=>x&&(x.name||x.desc)):[];
    const pricing=priceList.length ? `<section class="landing-sec" id="${landingSectionId('pricing')}">
        <div class="landing-head">${c.pricingTitle?`<h2>${esc(c.pricingTitle)}</h2>`:''}${c.pricingDesc?`<p>${esc(c.pricingDesc)}</p>`:''}</div>
        <div class="landing-grid">${priceList.map(x=>`<article class="landing-card"><div class="ico">🎫</div><h3>${esc(x.name||'이용권')}</h3><p><b>${esc(x.price||'금액 미정')}</b> · ${esc(x.period||'1년')}</p>${x.desc?`<p>${esc(x.desc)}</p>`:''}</article>`).join('')}</div>
      </section>` : '';
    // 오른쪽 인디케이터 (지금 보고 있는 곳 표시)
    const dots=[['top','소개']];
    if(feats.length) dots.push(['features','기능']);
    if(stepList.length) dots.push(['steps','이용 방법']);
    if(priceList.length) dots.push(['pricing','요금']);
    dots.push(['start','시작하기']);
    const dotsHtml=dots.map(([t,label])=>`<button type="button" class="landing-dot" data-action="landing-scroll" data-target="${t}" data-sec="${t}" aria-label="${esc(label)}"><span aria-hidden="true">${label}</span><i></i></button>`).join('');
    return `<div class="landing">
      <header class="landing-nav"><div class="landing-nav-inner">
        <button type="button" class="landing-brand" data-action="landing-scroll" data-target="top"><span class="brand-mark">${brandMarkHtml()}</span><strong>${esc(c.brandName)}</strong></button>
        ${nav?`<nav class="landing-menu">${nav}</nav>`:''}
        <div class="landing-nav-actions">
          <button type="button" class="landing-btn ghost" data-action="landing-signup">${esc(c.signupLabel)}</button>
          <button type="button" class="landing-btn solid" data-action="landing-login">${esc(c.loginLabel)}</button>
          <button type="button" class="landing-burger" data-action="landing-sheet-open" aria-label="메뉴 열기"><i></i><i></i><i></i></button>
        </div>
      </div></header>
      ${landingSheetHtml(c)}
      <nav class="landing-dots" id="landingDots" aria-label="페이지 위치">${dotsHtml}</nav>
      <main>
        <section class="landing-hero" id="${landingSectionId('top')}"><div class="landing-hero-inner${showMock?'':' solo'}">
          <div class="landing-hero-copy">
            ${hero.badge?`<span class="landing-badge">${esc(hero.badge)}</span>`:''}
            <h1>${esc(hero.title)}${roll}</h1>
            <p class="lead">${esc(hero.desc)}</p>
            <div class="landing-cta">
              <button type="button" class="landing-btn solid xl" data-action="${hero.primaryAction==='signup'?'landing-signup':'landing-login'}">${esc(hero.primaryLabel)}</button>
              ${hero.secondaryLabel?landingScrollBtn(hero.secondaryLabel,hero.secondaryTarget,'landing-btn ghost xl'):''}
            </div>
          </div>
          ${showMock?`<div class="landing-mock" aria-hidden="true">
            <div class="mock-head"><span class="mock-dot"></span>${esc(c.mock.title)}</div>
            <div class="mock-list" id="mockList"></div>
            <div class="mock-input">메시지를 입력해 주세요</div>
            ${c.mock.caption?`<div class="mock-caption">${esc(c.mock.caption)}</div>`:''}
          </div>`:''}
        </div></section>
        ${features}
        ${steps}
        ${pricing}
        <section class="landing-end" id="${landingSectionId('start')}">
          <div class="landing-cta-sec"><div class="landing-cta-box">
            <h2>${esc(c.ctaTitle)}</h2>${c.ctaDesc?`<p>${esc(c.ctaDesc)}</p>`:''}
            <button type="button" class="landing-btn xl" data-action="landing-login">${esc(c.ctaButton)}</button>
          </div></div>
          <footer class="landing-foot"><div class="landing-foot-inner">
            ${c.footerText?`<p>${esc(c.footerText)}</p>`:''}
            ${c.businessInfo?`<p class="biz-info">${esc(c.businessInfo)}</p>`:''}
            ${landingPageLinks()}
          </div></footer>
        </section>
      </main>
    </div>`;
  }
  // 마우스가 있는 환경인지 (있으면 호버로 열고, 없으면 눌러서 연다)
  const finePointer = () => { try{ return window.matchMedia('(hover: hover) and (pointer: fine)').matches; }catch(e){ return false; } };
  let mockTimer=null;
  function stopLandingMock(){ if(mockTimer){ clearTimeout(mockTimer); mockTimer=null; } }
  // 프리셋이 여러 개면 일정 간격마다 스르륵 바뀐다 (한 줄씩 올라오는 방식 / 전체 페이드)
  function startLandingMock(){
    stopLandingMock();
    const host=document.getElementById('mockList');
    if(!host) return;
    const c=landingCfg();
    const list=landingPresets(c);
    if(!list.length) return;
    const reduce=prefersReducedMotion();
    const typing = !reduce && c.mock.chatStyle!=='fade';
    const row=(m,i)=>`<div class="mock-row${m.side==='right'?' mine':''}"${typing?` style="--d:${(i*0.42).toFixed(2)}s"`:''}>${m.side==='right'?'':`<div class="mock-av">${esc(m.avatar||'·')}</div>`}<div class="mock-bub">${esc(m.text)}</div></div>`;
    const paint=(n)=>{
      host.innerHTML=list[n].messages.map(row).join('');
      host.classList.toggle('mock-in',typing);
    };
    paint(0);
    if(list.length<2 || reduce) return;
    let i=0;
    const wait=Math.min(30,Math.max(3,Number(c.mock.intervalSec)||7))*1000;
    const step=()=>{
      if(!host.isConnected){ stopLandingMock(); return; }
      i=(i+1)%list.length;
      host.classList.add('mock-out');                 // 먼저 스르륵 사라지고
      setTimeout(()=>{
        if(!host.isConnected) return;
        host.classList.remove('mock-out');
        paint(i);                                     // 새 대화가 한 줄씩 올라온다
      },320);
      mockTimer=setTimeout(step,wait);
    };
    mockTimer=setTimeout(step,wait);
  }
  let landingDotsOff=null, landingPagingOff=null;
  // 햄버거 메뉴 열기/닫기 (좁은 화면 전용)
  function openLandingSheet(){
    const s=$('#landingSheet'); if(!s) return;
    s.classList.remove('closing'); s.classList.add('open');
    const b=$('.landing'); if(b) b.classList.add('sheet-open');
  }
  function closeLandingSheet(){
    const s=$('#landingSheet'); if(!s || !s.classList.contains('open')) return;
    const b=$('.landing'); if(b) b.classList.remove('sheet-open');
    s.classList.add('closing');
    setTimeout(()=>s.classList.remove('open','closing'),250);
  }
  function stopLandingNav(){
    if(landingDotsOff){ landingDotsOff(); landingDotsOff=null; }
    if(landingPagingOff){ landingPagingOff(); landingPagingOff=null; }
  }
  // 오른쪽 인디케이터: 지금 보고 있는 곳을 표시한다
  function startLandingDots(){
    const box=$('.landing'), dots=$('#landingDots');
    if(!box||!dots) return;
    const items=[...dots.querySelectorAll('.landing-dot')];
    const secs=items.map(el=>({ el, sec:document.getElementById(landingSectionId(el.dataset.sec)) })).filter(x=>x.sec);
    if(!secs.length) return;
    let raf=0;
    const update=()=>{
      raf=0;
      const boxRect=box.getBoundingClientRect();
      const probe=boxRect.top + box.clientHeight*0.4;
      let best=null;
      secs.forEach(({el,sec})=>{ if(sec.getBoundingClientRect().top<=probe) best=el; });
      // 맨 아래까지 내려왔으면 마지막 지점을 표시한다
      if(box.scrollTop + box.clientHeight >= box.scrollHeight - 4) best=secs[secs.length-1].el;
      secs.forEach(({el})=>el.classList.toggle('active', el===(best||secs[0].el)));
    };
    const onScroll=()=>{ if(!raf) raf=requestAnimationFrame(update); };
    box.addEventListener('scroll',onScroll,{passive:true});
    update();
    landingDotsOff=()=>{ box.removeEventListener('scroll',onScroll); if(raf) cancelAnimationFrame(raf); };
  }
  // 휠을 한 번 돌리면 다음 장까지 스르륵 이동한다 (화면에 다 들어오는 섹션에서만)
  // 화면보다 긴 섹션이 끼어 있으면 그 구간은 일반 스크롤로 볼 수 있게 둔다.
  function startLandingPaging(){
    const box=$('.landing'); if(!box) return;
    const secs=[...box.querySelectorAll('.landing-hero,.landing-sec,.landing-end')];
    if(!secs.length) return;
    const want=()=> finePointer() && window.innerWidth>=900 && window.innerHeight>=640 && !prefersReducedMotion();
    const apply=()=>{
      const on=want();
      box.classList.toggle('snap',on);
      const limit=box.clientHeight-70;
      secs.forEach(el=>el.classList.toggle('snap-ok', on && el.offsetHeight<=limit));
    };
    apply();
    let raf=0, lock=false, lastEnd=0;
    const tops=()=>{
      const br=box.getBoundingClientRect();
      const max=box.scrollHeight-box.clientHeight;
      return secs.map(el=>Math.max(0, Math.min(max, Math.round(el.getBoundingClientRect().top - br.top + box.scrollTop - 66))));
    };
    const indexAt=(list,st)=>{ let i=0; list.forEach((t,k)=>{ if(t<=st+6) i=k; }); return i; };
    const animate=(to)=>{
      const from=box.scrollTop, dist=to-from;
      if(Math.abs(dist)<2){ box.scrollTop=to; lock=false; lastEnd=performance.now(); return; }
      const dur=Math.min(1000, Math.max(460, Math.abs(dist)*0.85));
      const t0=performance.now();
      const ease=(t)=> t<.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
      const step=(now)=>{
        if(!box.isConnected){ raf=0; lock=false; return; }
        const p=Math.min(1,(now-t0)/dur);
        box.scrollTop=from+dist*ease(p);
        if(p<1){ raf=requestAnimationFrame(step); }
        else { raf=0; lock=false; lastEnd=performance.now(); }
      };
      raf=requestAnimationFrame(step);
    };
    const go=(dir)=>{
      const list=tops(), st=box.scrollTop;
      const i=indexAt(list,st);
      const j=Math.max(0, Math.min(secs.length-1, i+dir));
      if(!secs[i].classList.contains('snap-ok') || !secs[j].classList.contains('snap-ok')) return false;
      lock=true; lastEnd=0;
      animate(list[j]);
      return true;
    };
    const busy=()=> lock || performance.now()-lastEnd<220;   // 트랙패드 관성은 흘려보낸다
    const onWheel=(e)=>{
      if(!want()) return;
      if(box.classList.contains('sheet-open')) return;   // 햄버거 메뉴가 열려 있으면 그대로 둔다
      if(busy()){ e.preventDefault(); return; }
      if(Math.abs(e.deltaY)<3) return;
      if(go(e.deltaY>0?1:-1)) e.preventDefault();
    };
    const onKey=(e)=>{
      if(!want() || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag=(e.target&&e.target.tagName)||'';
      if(/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      const dir=(e.key==='ArrowDown'||e.key==='PageDown'||e.key===' ')?1:(e.key==='ArrowUp'||e.key==='PageUp')?-1:0;
      if(!dir || busy()) return;
      if(go(dir)) e.preventDefault();
    };
    box.addEventListener('wheel',onWheel,{passive:false});
    document.addEventListener('keydown',onKey);
    let t=0;
    const onResize=()=>{ clearTimeout(t); t=setTimeout(apply,180); };
    window.addEventListener('resize',onResize);
    landingPagingOff=()=>{
      box.removeEventListener('wheel',onWheel);
      document.removeEventListener('keydown',onKey);
      window.removeEventListener('resize',onResize);
      clearTimeout(t);
      if(raf) cancelAnimationFrame(raf); raf=0; lock=false; lastEnd=0;
      box.classList.remove('snap');
      secs.forEach(el=>el.classList.remove('snap-ok'));
    };
  }
  // 마우스 환경에서는 올린 것만 열리고(다른 메뉴는 닫힘), 터치에서는 눌러서 연다
  function wireLandingDrops(){
    const drops=$$('.landing-drop');
    if(!finePointer() || !drops.length) return;
    drops.forEach(d=>{
      d.addEventListener('mouseenter',()=>{
        drops.forEach(x=>{ if(x!==d) x.classList.remove('open'); });
        d.classList.add('open');
      });
      d.addEventListener('mouseleave',()=>d.classList.remove('open'));
      // 키보드로 접근할 때도 열리게
      d.addEventListener('focusin',()=>{ drops.forEach(x=>{ if(x!==d) x.classList.remove('open'); }); d.classList.add('open'); });
      d.addEventListener('focusout',e=>{ if(!d.contains(e.relatedTarget)) d.classList.remove('open'); });
    });
  }
  function renderLanding(){
    document.body.classList.remove('m-chat-open');
    applyTheme();
    stopHeroRoll();
    stopLandingMock();
    stopLandingNav();
    const c=landingCfg();
    state.view='landing';
    state.landingSig=JSON.stringify(c);
    app.innerHTML=landingHtml(c);
    startLandingMock();
    startHeroRoll();
    startLandingDots();
    startLandingPaging();
    wireLandingDrops();
    loadSchoolList().catch(()=>{});
    if(state.dupKickNotice && !state.dupKickToastShown){
      state.dupKickToastShown=true;
      const dev=String(state.dupKickNotice||'다른 기기');
      setTimeout(()=>showDupKickPopup(dev),400);
    }
  }
  // 바깥→안 줌 전환: 현재 화면은 1→1.02로 페이드아웃, 새 화면은 0.985→1로 진입 (나갈 땐 반대 모션)
  function zoomTransition(exitSel, renderFn, enterSel){
    if(prefersReducedMotion()){ renderFn(); return; }
    const exitEl=document.querySelector(exitSel);
    let done=false;
    const go=()=>{ if(done) return; done=true; renderFn(); if(enterSel){ const el=document.querySelector(enterSel); if(el) el.classList.add('screen-enter'); } };
    if(!exitEl){ go(); return; }
    exitEl.classList.add('screen-exit');
    setTimeout(go,270);
    setTimeout(go,1200); // 안전망: 애니메이션 미발동해도 반드시 전환
  }
  // 소개 페이지에서 로그인·회원가입 화면으로 넘어간다
  function enterAuth(mode){
    state.landingRequested=true;
    state.authMode = mode==='signup' ? 'signup' : 'login';
    state.authPage='';
    loadSchoolList(true).catch(()=>{});
    zoomTransition('#app .landing', ()=>renderAuth(), '#app .auth');
  }
  function renderAuth() {
    applyTheme();
    stopHeroRoll();
    stopLandingMock();
    stopLandingNav();
    state.view='auth';
    const bootEl=document.querySelector('#app .boot');
    if(bootEl && !prefersReducedMotion()){
      // CSS가 글자 바운스→정렬을 처리한다. JS는 정렬+페이드아웃 시간만 확보하고 반드시 진입한다
      bootEl.classList.add('leaving');
      state.authFromBoot=true;
      setTimeout(()=>paintAuth(),650);
      return;
    }
    paintAuth();
  }
  function paintAuth(){
    document.body.classList.remove('m-chat-open');
    // 소개 페이지에서 쓰던 document/window 리스너가 남아 키 입력을 가로채지 않게 정리한다
    stopLandingNav();
    stopLandingMock();
    const anim=state.authAnim||''; state.authAnim='';
    const isLogin=state.authMode==='login';
    const page=state.authPage ? authPages().find(p=>p.id===state.authPage) : null;
    if(page){
      // 개인정보 처리방침·문의하기·학교 등록 같은 안내 화면 (회원가입 전환과 같은 모션)
      app.innerHTML = `<div class="auth"><div class="auth-shell">
        ${authHeroHtml()}
        <div class="auth-card"><div class="auth-card-inner${anim?' auth-anim-'+anim:''}">
        <button type="button" class="back-btn" data-action="auth-page-back" aria-label="로그인으로 돌아가기">←</button>
        <h1 class="auth-title">${esc(page.title||page.label||'')}</h1>
        <div class="auth-page-body">${sanitizeRichHtml(page.html||'')}</div>
        ${(Array.isArray(page.buttons)&&page.buttons.some(x=>x&&x.label))?`<div class="auth-page-btns">${page.buttons.filter(x=>x&&x.label).map(x=>`<button type="button" class="soft-btn" data-action="auth-page-btn" data-url="${esc(x.url||'')}">${esc(x.label)}</button>`).join('')}</div>`:''}
      </div></div></div></div>`;
    } else {
    app.innerHTML = `<div class="auth"><div class="auth-shell">
      ${authHeroHtml()}
      <div class="auth-card"><div class="auth-card-inner${anim?' auth-anim-'+anim:''}">
      ${isLogin
        ? (landingEnabled()&&state.landingRequested?`<button type="button" class="back-btn" data-action="landing-home" aria-label="소개 페이지로 돌아가기">←</button>`:'')
        : `<button type="button" class="back-btn" data-action="toggle-auth" aria-label="로그인으로 돌아가기">←</button>`}
      <h1 class="auth-title">${state.authMode === 'login' ? '다시 만나서 반가워요' : '새 계정을 만들어봐요'}</h1>
      <p class="auth-desc">${state.authMode === 'login' ? '학교 코드로 만든 계정으로 로그인해 주세요.' : '학교 코드와 학급 정보를 입력하면 바로 시작할 수 있어요.'}</p>
      ${state.dupKickNotice?`<div class="form-error" style="margin:0 0 14px">[${esc(String(state.dupKickNotice))}]에서 로그인해서 로그아웃됐어요. 다시 로그인해 주세요.</div>`:''}
      <div id="authError" class="form-error hidden"></div>
      <form id="authForm">
        <div class="field"><label>이메일</label><input class="input" name="email" type="email" autocomplete="email" value="${esc(state.authMode==='login'?rememberedEmail():'')}" required></div>
        <div class="field"><label>비밀번호</label><div style="position:relative"><input class="input" name="password" type="password" autocomplete="current-password" minlength="6" required style="padding-right:44px"><button type="button" class="icon-btn" data-action="toggle-pw" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);width:32px;height:32px" aria-label="비밀번호 보기">👁</button></div></div>
        ${state.authMode==='login'?`<label class="remember-check"><input type="checkbox" name="rememberEmail" ${rememberedEmail()?'checked':''}> 아이디 기억하기</label><label class="remember-check" style="margin-top:6px"><input type="checkbox" name="autoLogin" ${localStorage.getItem('edutalk_auto_login')==='1'?'checked':''}> 자동 로그인</label>`:''}
        ${state.authMode === 'signup' ? `<div class="field"><label>학교</label><div class="custom-select"><button type="button" class="select-button" data-action="pick-school"><span data-selected="school">${state.selectedSchool?esc(state.selectedSchool.name):'학교를 검색해 주세요'}</span><span>⌄</span></button></div></div>
        <div class="field"><label>학교 코드</label><input class="input" name="schoolCode" maxlength="12" autocomplete="off" placeholder="선생님께 받은 코드를 입력해 주세요." required><p class="desc" style="margin:7px 0 0;font-size:12px">${(state.schoolList&&state.schoolList.length)?'학교 코드는 담당 선생님께 받을 수 있어요.':'아직 등록된 학교가 없어요. 담당 선생님(관리자)에게 학교 등록과 코드를 요청해 주세요.'}</p></div>
        <div class="field"><label>비밀번호 확인</label><div style="position:relative"><input class="input" name="passwordConfirm" type="password" autocomplete="new-password" minlength="6" required style="padding-right:44px"><button type="button" class="icon-btn" data-action="toggle-pw" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);width:32px;height:32px" aria-label="비밀번호 보기">👁</button></div></div>
        <div class="field"><label>닉네임</label><input class="input" name="displayName" maxlength="20" required></div>
        <div class="field"><label>학년</label><div class="custom-select"><button type="button" class="select-button" data-select-open="grade"><span data-selected="grade">학년을 골라 주세요</span><span>⌄</span></button></div></div>
        <div class="field"><label>반</label><div class="custom-select"><button type="button" class="select-button" data-select-open="class"><span data-selected="class">학년을 먼저 골라 주세요</span><span>⌄</span></button></div></div>` : ''}
        ${state.authMode === 'signup' ? `<div class="field" style="margin-top:2px"><label>약관 동의 (모두 필수)</label>
          <label class="consent"><input type="checkbox" name="age14"><span><b>만 14세 이상</b>입니다. (필수)</span></label>
          <div class="consent" style="margin-top:8px;gap:10px"><label style="display:flex;gap:9px;align-items:flex-start;flex:1;min-width:0;cursor:pointer"><input type="checkbox" name="consentPrivacy" style="margin:4px 0 0;flex:0 0 16px;width:16px;height:16px"><span><b>개인정보 처리방침</b>에 동의합니다. (필수)</span></label><button type="button" class="text-btn" style="flex:0 0 auto;font-size:12px" data-action="auth-page" data-page="privacy">보기</button></div>
          <div class="consent" style="margin-top:8px;gap:10px"><label style="display:flex;gap:9px;align-items:flex-start;flex:1;min-width:0;cursor:pointer"><input type="checkbox" name="consentTerms" style="margin:4px 0 0;flex:0 0 16px;width:16px;height:16px"><span><b>서비스 이용약관</b>에 동의합니다. (필수)</span></label><button type="button" class="text-btn" style="flex:0 0 auto;font-size:12px" data-action="auth-page" data-page="terms">보기</button></div>
        </div>` : ''}
        <button class="primary">${state.authMode === 'login' ? '로그인' : '가입하기'}</button>
      </form>
      <button class="google-btn" data-action="google"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg><span>Google 계정으로 ${state.authMode === 'login' ? '로그인' : '가입하기'}</span></button>
      ${isLogin?`<div class="auth-foot"><button class="text-btn" data-action="toggle-auth">회원가입</button><button class="text-btn" data-action="forgot">비밀번호 찾기</button>${landingEnabled()?`<button class="text-btn" data-action="landing-show">소개 보기</button>`:''}</div>`:''}
      <div class="auth-links under-card">${authLinkButtons()}</div>
    </div></div></div></div>`;
    }
    if (!page && state.authMode === 'signup') {
      wireSignupGrade();
      renderClassDropdown();
    }
    startHeroRoll();
    startHeroFade();
    // 첫 진입(로딩 화면에서 넘어올 때)에만 왼쪽 페이드 인 / 오른쪽 스르륵을 재생한다
    const shell=document.querySelector('.auth-shell');
    if(shell && state.authFromBoot && !prefersReducedMotion()) shell.classList.add('enter');
    state.authFromBoot=false;
  }

  function wireSignupGrade(){
    const btn=document.querySelector('[data-select-open="grade"]'); if(!btn) return;
    const opts=state.school.grades.length
      ? state.school.grades.map(g => ({value:g,label:`${g}학년`}))
      : [{value:'',label: state.selectedSchool ? '학년 정보가 아직 없어요.' : '학교를 먼저 골라 주세요.'}];
    wireDropdown(btn, opts, (v,label) => {
      const gs = $('[data-selected="grade"]'); if(gs){ gs.textContent=label; gs.dataset.value=v; }
      const cs = $('[data-selected="class"]'); if(cs){ cs.textContent='반을 골라 주세요'; cs.dataset.value=''; }
      renderClassDropdown();
    });
  }
  async function openSchoolPicker(){
    const list=await loadSchoolList();
    openModal(`<h2>학교 찾기</h2><p class="desc">담당 선생님이 등록한 학교 중에서 골라 주세요.</p><div class="field"><input id="schoolSearch" class="input" placeholder="학교 이름을 입력해 주세요. (예: 가락고등학교)"></div><div id="schoolResults" class="list modal-scroll"></div>`);
    const render=q=>{
      const host=$('#schoolResults'); if(!host) return;
      const kw=String(q||'').trim().toLowerCase();
      const rows=list.filter(s=>!kw || String(s.name||'').toLowerCase().includes(kw) || String(s.atpt||'').toLowerCase().includes(kw));
      host.innerHTML=rows.slice(0,200).map(s=>`<button type="button" class="list-item tappable" data-action="pick-school-item" data-sid="${esc(s.id)}"><div class="grow"><div class="title">${esc(s.name||'이름 없는 학교')}</div><div class="meta">${esc(s.atpt||'')}${s.kind?` · ${esc(s.kind)}`:''}</div></div><span>›</span></button>`).join('')||`<div class="empty-side">${list.length?'찾는 학교가 없어요.':'아직 등록된 학교가 없어요.<br>담당 선생님(관리자)에게 학교 등록을 요청해 주세요.'}</div>`;
    };
    render('');
    const input=$('#schoolSearch'); if(input){ input.focus(); input.addEventListener('input',e=>render(e.target.value)); }
  }
  function selectSchool(id){
    const s=(state.schoolList||[]).find(x=>x.id===id); if(!s) return;
    state.selectedSchool=s;
    state.school={grades:Array.isArray(s.grades)?s.grades.map(Number).sort((a,b)=>a-b):[],classCounts:s.classCounts||{}};
    state.schoolInfo={id:s.id,...s};
    const span=$('[data-selected="school"]'); if(span) span.textContent=s.name||'학교';
    const gs=$('[data-selected="grade"]'); if(gs){ gs.textContent='학년을 골라 주세요'; gs.dataset.value=''; }
    const cs=$('[data-selected="class"]'); if(cs){ cs.textContent='학년을 먼저 골라 주세요'; cs.dataset.value=''; }
    closeModal();
    wireSignupGrade();
    renderClassDropdown();
    toast(`${s.name}을(를) 선택했어요.`);
  }

  function renderClassDropdown() {
    const btn = document.querySelector('[data-select-open="class"]');
    if (!btn) return;
    wireDropdown(btn, () => {
      const grade = Number(document.querySelector('[data-selected="grade"]')?.dataset.value || 0);
      const count = Number(state.school.classCounts?.[grade] || 0);
      return grade && count
        ? Array.from({length:count},(_,i)=>({value:i+1,label:`${i+1}반`}))
        : [{value:'',label:'학년을 먼저 골라 주세요.'}];
    }, (v,label)=>{const span=document.querySelector('[data-selected="class"]');if(span){span.textContent=label;span.dataset.value=v;}});
  }

  function wireDropdown(button, options, onSelect) {
    button.onclick = () => {
      if (state.dropdownOwner === button) { closeDropdown(); return; }
      closeDropdown();
      openDropdown(button, typeof options === 'function' ? options() : options, onSelect);
    };
  }
  function openDropdown(button, options, onSelect) {
    closeDropdown();
    const list = Array.isArray(options) ? options : [];
    const rect = button.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'select-menu';
    menu.innerHTML = list.map(o=>`<button type="button" class="select-option" data-value="${esc(o.value)}">${o.dot?`<span class="presence-dot inline ${esc(o.dot)}" aria-hidden="true"></span>`:''}<span>${esc(o.label)}</span></button>`).join('');
    document.body.appendChild(menu);
    const width = Math.max(rect.width, 170);
    let x = Math.min(rect.left, window.innerWidth - width - 12), top = rect.bottom + 6, up = false;
    const menuHeight = Math.min(300, menu.scrollHeight || 300);
    if (top + menuHeight > window.innerHeight - 12 && rect.top > menuHeight + 10) { top = rect.top - menuHeight - 6; up = true; }
    menu.style.left = `${Math.max(12,x)}px`; menu.style.top = `${Math.max(12,top)}px`; menu.style.minWidth = `${width}px`;
    if (up) menu.classList.add('drop-up');
    requestAnimationFrame(()=>menu.classList.add('open'));
    menu.addEventListener('click', e => { const o=e.target.closest('.select-option'); if(!o) return; onSelect(o.dataset.value,o.textContent); closeDropdown(); });
    const onOutside = e => { if (menu.contains(e.target) || button.contains(e.target)) return; closeDropdown(); };
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', onOutside, true);
    state.dropdownOwner = button;
    state.openDropdownCleanup = () => {
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('scroll', onOutside, true);
      state.dropdownOwner = null;
      // 닫힐 때도 열릴 때의 반대 모션으로 사라진다
      if(prefersReducedMotion()){ menu.remove(); return; }
      menu.classList.remove('open');
      menu.classList.add('closing');
      setTimeout(()=>{ try{ menu.remove(); }catch(e){} },170);
    };
  }
  function closeDropdown(){ if(state.openDropdownCleanup){state.openDropdownCleanup();state.openDropdownCleanup=null;} }
  let kbRaf = 0;
  function isCoarsePointer(){
    try{ return !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches); }catch(e){ return false; }
  }
  function syncKeyboard(){
    try{
      const vv=window.visualViewport; if(!vv) return;
      if(kbRaf) return;
      kbRaf=requestAnimationFrame(()=>{
        kbRaf=0;
        try{
          const kb=Math.max(0,window.innerHeight-vv.height-(vv.offsetTop||0));
          document.documentElement.style.setProperty('--kb',Math.round(kb)+'px');
          // 키보드가 뜨거나 내려가도 보고 있던 맨 아래 위치를 유지한다 (카톡처럼)
          const host=$('#messages');
          if(host && state.atBottom){
            host.scrollTop=host.scrollHeight-host.clientHeight;
          }
          // 모달 안 입력칸에 포커스가 있으면 키보드에 가려지지 않게 가운데로 올린다
          try{
            const ae=document.activeElement;
            if(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT') && ae.closest && ae.closest('.modal')){
              ae.scrollIntoView({block:'center'});
            }
          }catch(e){}
        }catch(e){}
      });
    }catch(e){}
  }

  function rememberedEmail(){ try{ return localStorage.getItem('edutalk_remember_email')||''; }catch(e){ return ''; } }
  async function signInForm(f) {
    clearAuthError();
    try {
      const email=f.email.value.trim(), password=f.password.value;
      if(state.authMode==='login'){
        try{ if(f.rememberEmail?.checked && email) localStorage.setItem('edutalk_remember_email',email); else localStorage.removeItem('edutalk_remember_email'); }catch(e){}
        try{ if(f.autoLogin?.checked) localStorage.setItem('edutalk_auto_login','1'); else localStorage.removeItem('edutalk_auto_login'); }catch(e){}
        await auth.signInWithEmailAndPassword(email,password);
      }
      else {
        const pwConfirm=f.passwordConfirm?.value||''; if(password!==pwConfirm){ showAuthError('비밀번호 확인이 달라요. 다시 입력해 주세요.'); return; }
        const displayName=f.displayName.value.trim(); const grade=Number(document.querySelector('[data-selected="grade"]')?.dataset.value||0); const classNum=Number(document.querySelector('[data-selected="class"]')?.dataset.value||0);
        const schoolId=state.selectedSchool?.id||''; const schoolCode=(f.schoolCode?.value||'').trim().toUpperCase();
        if(!f.querySelector('[name="age14"]')?.checked){showAuthError('만 14세 이상만 가입할 수 있어요.');return;}
        if(!f.querySelector('[name="consentPrivacy"]')?.checked){showAuthError('개인정보 처리방침에 동의해 주세요. [보기]를 눌러 내용을 확인할 수 있어요.');return;}
        if(!f.querySelector('[name="consentTerms"]')?.checked){showAuthError('서비스 이용약관에 동의해 주세요. [보기]를 눌러 내용을 확인할 수 있어요.');return;}
        if(!schoolId){showAuthError('학교를 먼저 골라 주세요.');return;}
        if(!schoolCode){showAuthError('학교 코드를 입력해 주세요.');return;}
        if(!displayName || !grade || !classNum){showAuthError('닉네임과 학급 정보를 모두 골라 주세요.');return;}
        if(!state.school.grades.includes(grade)){showAuthError('학년 정보를 확인해 주세요.');return;}
        if(!Number(state.school.classCounts?.[grade]||0) || classNum>Number(state.school.classCounts[grade])){showAuthError('반 정보를 확인해 주세요.');return;}
        setPendingSignup({displayName,grade,classNum,schoolId,schoolName:state.selectedSchool?.name||'',schoolCode,consentPrivacy:true,consentTerms:true,consentAge14:true,consentedAt:Date.now()});
        try{ await auth.createUserWithEmailAndPassword(email,password); }
        catch(e){ setPendingSignup(null); throw e; }
      }
    } catch(e){console.error(e);showAuthError(errText(e));}
  }

  async function googleLogin(){
    try{
      if(isNativeApp()){
        try{
          const provider = new firebase.auth.GoogleAuthProvider();
          await auth.signInWithRedirect(provider);
          return;
        }catch(e){}
      }
    }catch(e){}

    const f=$('#authForm');
    if(state.authMode==='signup' && f){
      const schoolId=state.selectedSchool?.id||''; const schoolCode=(f.schoolCode?.value||'').trim().toUpperCase();
      if(!f.querySelector('[name="age14"]')?.checked) return showAuthError('만 14세 이상만 가입할 수 있어요.');
      if(!f.querySelector('[name="consentPrivacy"]')?.checked) return showAuthError('개인정보 처리방침에 동의해 주세요.');
      if(!f.querySelector('[name="consentTerms"]')?.checked) return showAuthError('서비스 이용약관에 동의해 주세요.');
      if(!schoolId) return toast('학교를 먼저 골라 주세요.');
      if(!schoolCode) return showAuthError('학교 코드를 입력해 주세요.');
      // 가입 화면에서 학년·반을 한 번만 묻는다 (이메일 가입과 동일 · 로그인 뒤 다시 묻지 않게)
      const grade=Number(document.querySelector('[data-selected="grade"]')?.dataset.value||0), classNum=Number(document.querySelector('[data-selected="class"]')?.dataset.value||0);
      if(!grade||!classNum) return showAuthError('학년과 반을 골라 주세요.');
      if(!state.school.grades.includes(grade)) return showAuthError('학년 정보를 확인해 주세요.');
      if(!Number(state.school.classCounts?.[grade]||0)||classNum>Number(state.school.classCounts[grade])) return showAuthError('반 정보를 확인해 주세요.');
      setPendingSignup({displayName:'',grade,classNum,schoolId,schoolName:state.selectedSchool?.name||'',schoolCode,consentPrivacy:true,consentTerms:true,consentAge14:true,consentedAt:Date.now()});
    }
    try{
      const provider=new firebase.auth.GoogleAuthProvider();
      try{ await auth.signInWithPopup(provider); }
      catch(e){
        // 팝업이 막힌 환경(인앱 웹뷰·아이폰 등)은 리다이렉트로 이어간다 (가입 정보는 sessionStorage에 유지)
        const code=e?.code||'';
        if(code==='auth/popup-blocked'||code==='auth/popup-closed-by-user'||code==='auth/cancelled-popup-request'||code==='auth/operation-not-supported-in-this-environment'||code==='auth/unauthorized-domain'){
          try{ await auth.signInWithRedirect(provider); return; }catch(e2){ console.error(e2); showAuthError(errText(e2)); return; }
        }
        setPendingSignup(null); console.error(e); showAuthError(errText(e));
      }
    }catch(e){ console.error(e); showAuthError(errText(e)); }
  }
  async function forgot(){
    openModal(`<h2>비밀번호를 다시 설정해 볼까요?</h2><p class="desc">가입한 이메일로 재설정 링크를 보내드릴게요.</p><div class="field"><input id="resetEmail" class="input" type="email" placeholder="이메일을 입력해 주세요."></div><p id="resetMsg" class="reset-msg"></p><div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" data-action="send-reset">보내기</button></div>`,true);
    startResetCooldown();
  }
  const RESET_COOLDOWN_MS=3*60*1000;
  let resetTick=null;
  function resetCooldownLeft(){
    try{ const t=Number(localStorage.getItem('edutalk_reset_at')||0); const left=t+RESET_COOLDOWN_MS-Date.now(); return left>0?left:0; }catch(e){ return 0; }
  }
  function fmtLeft(ms){ const s=Math.max(0,Math.ceil(ms/1000)); return `${Math.floor(s/60)}분 ${String(s%60).padStart(2,'0')}초`; }
  function updateResetCooldownUI(){
    const msg=$('#resetMsg');
    if(!msg){ if(resetTick){ clearInterval(resetTick); resetTick=null; } return; }
    const btn=document.querySelector('[data-action="send-reset"]');
    const left=resetCooldownLeft();
    if(left>0){
      if(btn){ btn.disabled=true; btn.textContent=`${fmtLeft(left)} 후 다시 시도`; }
      if(!msg.dataset.lock){ msg.dataset.lock='1'; msg.className='reset-msg warn'; msg.textContent='요청이 너무 잦아요. 잠시 후 다시 시도할 수 있어요.'; }
    } else {
      if(btn){ btn.disabled=false; btn.textContent='보내기'; }
      if(msg.dataset.lock){ delete msg.dataset.lock; msg.className='reset-msg'; msg.textContent=''; }
      if(resetTick){ clearInterval(resetTick); resetTick=null; }
    }
  }
  function startResetCooldown(){
    if(resetTick){ clearInterval(resetTick); resetTick=null; }
    if(resetCooldownLeft()>0){
      const msg=$('#resetMsg'); if(msg) msg.dataset.lock='1';
      updateResetCooldownUI();
      resetTick=setInterval(updateResetCooldownUI,1000);
    }
  }
  async function sendReset(){
    const email=$('#resetEmail')?.value?.trim()||'';
    const msg=$('#resetMsg');
    const say=(t,kind)=>{ if(msg){ delete msg.dataset.lock; msg.className='reset-msg'+(kind?' '+kind:''); msg.textContent=t; } };
    if(resetCooldownLeft()>0){ updateResetCooldownUI(); return; }
    if(!email){ say('이메일을 입력해 주세요.','warn'); return; }
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ say('이메일 형식을 확인해 주세요.','warn'); return; }
    const btn=document.querySelector('[data-action="send-reset"]');
    if(btn){ btn.disabled=true; btn.textContent='확인 중'; }
    say('확인하는 중이에요...');
    try{
      let methods=[];
      try{ methods=await auth.fetchSignInMethodsForEmail(email); }catch(e){ methods=[]; }
      if(methods.includes('google.com') && !methods.includes('password')){
        say('이 계정은 Google 로그인으로 만들어졌어요. Google로 로그인해 주세요.','warn');
        return;
      }
      await auth.sendPasswordResetEmail(email);
      try{ localStorage.setItem('edutalk_reset_at',String(Date.now())); }catch(e){}
      say('재설정 링크를 보냈어요. 메일함을 확인해 주세요.','ok');
      toast('재설정 링크를 보냈어요.');
    }catch(e){
      console.error(e);
      const code=e?.code||'';
      if(code==='auth/user-not-found'){
        say('이 이메일로 가입된 계정을 찾을 수 없어요. Google 로그인으로 만든 계정이라면 Google로 로그인해 주세요.','warn');
      } else if(code==='auth/invalid-email'){
        say('이메일 형식을 확인해 주세요.','warn');
      } else {
        say(errText(e),'warn');
      }
    }finally{
      const b=document.querySelector('[data-action="send-reset"]');
      if(b){ b.disabled=false; b.textContent='보내기'; }
      if(resetCooldownLeft()>0){
        if(resetTick) clearInterval(resetTick);
        resetTick=setInterval(updateResetCooldownUI,1000);
      }
      updateResetCooldownUI();
    }
  }

  function renderShell(){
    try{ if(isNativeApp() && !state.user) { state.landingRequested=false; state.landing=null; } }catch(e){}
    applyFontSize();
    applyTheme();
    stopHeroRoll();
    if(state.view==='admin' && canManageSchool()){
      app.innerHTML = adminPageHtml();
      renderAdminPanel(state.adminTab);
    } else if(state.view==='settings'){
      app.innerHTML = settingsPageHtml();
      renderSettingsPanel(state.settingsTab||'display');
    } else {
      state.view='chat';
      app.innerHTML = `<div class="app"><aside class="sidebar">${sidebarHtml()}</aside><div class="sb-resizer" id="sbResizer" title="끌어서 폭 조절 (더블클릭하면 기본값)"></div><main class="main"><div id="siteBanner" class="site-banner hidden"></div><div id="globalBanner" class="new-banner global-banner"></div><div id="chat" class="chat">${emptyChat()}</div></main></div><div id="drawer" class="drawer"><div class="drawer-back" data-action="close-drawer"></div><div class="drawer-panel" id="drawerPanel"></div></div>`;
      if(state.shellZoomEnter && !prefersReducedMotion()){ const shellEl=document.querySelector('#app .app'); if(shellEl) shellEl.classList.add('screen-enter'); }
      state.shellZoomEnter=false;
      renderRooms();
      wireResizer();
    }
    renderSiteBanner();
    setupGlobalHandlers();
    // 모바일은 채팅 목록을 기준으로 시작한다 (방이 없으면 목록을 바로 연다)
    if(window.innerWidth<=820 && state.view==='chat' && !state.room) openDrawer();
    // 초대 링크로 들어왔으면 로그인 뒤 코드 참가 흐름으로 잇는다 (1회성)
    if(state.profile) runAsync(()=>consumePendingJoinLink());
  }
  const SB_MIN=226, SB_MAX=572, SB_DEFAULT=286;
  function applySidebarWidth(w){
    const v=Math.min(SB_MAX,Math.max(SB_MIN,Math.round(Number(w)||SB_DEFAULT)));
    document.documentElement.style.setProperty('--sidebar',v+'px');
    return v;
  }
  function initSidebarWidth(){
    let w=SB_DEFAULT;
    try{ const s=Number(localStorage.getItem('edutalk_sidebar')); if(s) w=s; }catch(e){}
    applySidebarWidth(w);
  }
  function wireResizer(){
    const rz=$('#sbResizer'); if(!rz) return;
    let dragging=false, startX=0, startW=0;
    const currentW=()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar'))||SB_DEFAULT;
    rz.addEventListener('pointerdown',e=>{
      if(window.innerWidth<=820) return;
      dragging=true; startX=e.clientX; startW=currentW();
      rz.classList.add('dragging'); document.body.classList.add('resizing');
      try{ rz.setPointerCapture(e.pointerId); }catch(err){}
      e.preventDefault();
    });
    rz.addEventListener('pointermove',e=>{ if(dragging) applySidebarWidth(startW+(e.clientX-startX)); });
    const end=()=>{
      if(!dragging) return;
      dragging=false; rz.classList.remove('dragging'); document.body.classList.remove('resizing');
      try{ localStorage.setItem('edutalk_sidebar', String(Math.round(currentW()))); }catch(e){}
    };
    rz.addEventListener('pointerup',end);
    rz.addEventListener('pointercancel',end);
    rz.addEventListener('dblclick',()=>{ applySidebarWidth(SB_DEFAULT); try{ localStorage.setItem('edutalk_sidebar',String(SB_DEFAULT)); }catch(e){} });
  }
  initSidebarWidth();
  function adminTabs(){
    if(isAdmin())
      return [['school','학교 관리'],['licenses','이용권'],['refunds','환불'],['pricing','요금 안내'],['landing','소개 페이지'],['sitenotice','사이트 공지'],['pages','안내 페이지'],['chat','채팅 관리'],['sharereq','공유 요청'],['reports','신고 관리'],['modappeals','오검열 이의'],['appeals','이의 제기'],['popup','개인 안내'],['users','사용자'],['cross','학교 간 요청'],['rooms','채팅방'],['roles','역할'],['notice','공지'],['teachers','교사 승인'],['suggest','건의함']];
    if(isSchoolAdmin())
      return [['school','학교 관리'],['members','구성원'],['license','이용권 등록'],['rooms','채팅방'],['roles','역할'],['suggest','건의함'],['reports','신고 관리'],['modappeals','오검열 이의'],['notice','공지'],['sharereq','공유 요청'],['cross','학교 간 요청'],['popup','개인 안내']];
    return [['notice','공지'],['roles','역할'],['suggest','건의함'],['sharereq','공유 요청'],['cross','학교 간 요청'],['reports','신고 관리'],['modappeals','오검열 이의'],['rooms','채팅방'],['popup','개인 안내']];
  }
  function adminPageHtml(){
    const tabs=adminTabs();
    if(!tabs.some(t=>t[0]===state.adminTab)) state.adminTab=tabs[0][0];
    return `<div class="admin-page"><header class="admin-head"><button class="icon-btn" data-action="close-admin" aria-label="뒤로 가기">←</button><div class="grow"><div class="admin-title">${isAdmin()?'관리자 도구':isSchoolAdmin()?'학교 관리':'교사 도구'}</div><div class="admin-sub">${esc(state.profile?.displayName||'사용자')} · ${roleLabel(state.profile?.role)}</div></div><button class="icon-btn" data-action="settings" aria-label="설정">⚙</button></header><div id="siteBanner" class="site-banner hidden"></div><div class="admin-body"><div class="admin-wrap"><nav class="admin-tabs">${tabs.map(([k,l])=>`<button class="tab ${state.adminTab===k?'active':''}" data-tab="${k}">${l}</button>`).join('')}</nav><div id="adminPanel"></div></div></div></div>`;
  }
  function openAdmin(tab){
    if(!canManageSchool()) return;
    state.view='admin';
    state.adminTab=tab || ((isAdmin()||isSchoolAdmin())?'school':'rooms');
    zoomTransition('#app .app', ()=>renderShell(), '#app .app');
    // 총관리자: 대기 중인 교사 승인 요청이 있으면 알린다
    if(isAdmin()) runAsync(async()=>{
      try{ const s=await db.collection('teacherRequests').where('status','==','pending').limit(10).get(); if(!s.empty) setTimeout(()=>toast(`교사 승인 요청 ${s.size}건이 있어요. 관리자 도구 → 교사 승인에서 확인해 주세요.`),600); }catch(e){}
    });
  }
  function exitAdmin(){
    if(state.view!=='admin') return;
    const rid=state.room?.id;
    state.view='chat';
    zoomTransition('#app .app', ()=>{ renderShell(); if(rid) openRoom(rid); }, '#app .app');
  }
  function renderSidebar(){
    const sb=$('.sidebar'); if(sb)sb.innerHTML=sidebarHtml();
    const d=$('#drawer');
    if(d&&d.classList.contains('open')){const p=$('#drawerPanel');if(p)p.innerHTML=sidebarHtml();}
    renderRooms();
    renderFriends();
    startBrandRotate();
    try{ paintLicenseBanner(); }catch(e){}
    try{ refreshSchoolLicense(); }catch(e){}
    try{ loadMealWidget(); }catch(e){}
  }
  // ---------- 학교 역할 (반장·부반장·학생회장 등 · 중복 부여 가능) ----------
  let roleDefsUnsub=null, roleGrantsUnsub=null;
  function clearRoleListeners(){ if(roleDefsUnsub){try{roleDefsUnsub();}catch(e){} roleDefsUnsub=null;} if(roleGrantsUnsub){try{roleGrantsUnsub();}catch(e){} roleGrantsUnsub=null;} }
  function attachRoleListeners(){
    clearRoleListeners();
    const sid=state.profile?.schoolId||''; if(!sid) return;
    try{
      roleDefsUnsub=db.collection('schoolRoles').where('schoolId','==',sid).limit(100).onSnapshot(s=>{
        state.roleDefs=s.docs.map(d=>({id:d.id,...d.data()}));
        if(state.memberPanel) renderMemberPanel();
        if($('#messages')) renderMessages(false);
      },e=>console.warn('roleDefs',e?.code||e));
      roleGrantsUnsub=db.collection('roleGrants').where('schoolId','==',sid).limit(500).onSnapshot(s=>{
        state.roleGrants=s.docs.map(d=>({id:d.id,...d.data()}));
        if(state.memberPanel) renderMemberPanel();
        if($('#messages')) renderMessages(false);
      },e=>console.warn('roleGrants',e?.code||e));
    }catch(e){}
  }
  // uid가 가진 역할 목록 (부여 순서대로)
  function userRoles(uid){
    const grants=(state.roleGrants||[]).filter(g=>g.uid===uid);
    const defs=new Map((state.roleDefs||[]).map(d=>[d.id,d]));
    return grants.map(g=>{
      const d=defs.get(g.roleId)||{};
      return {...g, name:g.roleName||d.name||'역할', emoji:g.emoji||d.emoji||'', color:g.color||d.color||''};
    });
  }
  function roleChipsHtml(uid){
    const roles=userRoles(uid); if(!roles.length) return '';
    return `<span class="role-chips">${roles.map(r=>{
      const scope=(r.grade?`${r.grade}학년${r.classNum?` ${r.classNum}반`:''}`:'전교');
      const rc=safeColor(r.color);
      const style=rc?` style="background:${rc}1f;color:${rc}"`:'';
      return `<span class="role-chip"${style} title="${esc(scope)}" data-gid="${esc(r.id)}">${r.emoji?esc(r.emoji)+' ':''}${esc(r.name)}</span>`;
    }).join('')}</span>`;
  }
  function isSideCollapsed(key){ return !!(state.settings?.collapsedSideSections||[]).includes(key); }
  async function toggleSideCollapse(key){
    if(!key) return;
    const cur=new Set(state.settings.collapsedSideSections||[]);
    const on=!cur.has(key);
    if(on) cur.add(key); else cur.delete(key);
    state.settings.collapsedSideSections=[...cur];
    const s={...(state.profile?.settings||{}),collapsedSideSections:state.settings.collapsedSideSections,sideOrder:state.settings.sideOrder||sideOrderList(),collapsedGroups:state.settings.collapsedGroups||[]};
    if(state.profile) state.profile.settings=s;
    $$('.side-body .side-section[data-sidekey="'+key+'"]').forEach(el=>el.classList.toggle('collapsed', on));
    try{ await db.collection('users').doc(uid()).update({settings:s,updatedAt:ts()}); }catch(e){ console.error(e); }
  }
  function sidebarHtml(){
    // 4번: 친구탭·대화방 분리 설정 — split(기본) / friends-top(친구 먼저) / rooms-only / friends-only
    const layout=state.settings?.sideLayout||'split';
    const cChat=isSideCollapsed('chat')?' collapsed':'';
    const cInv=isSideCollapsed('invite')?' collapsed':'';
    const cFr=isSideCollapsed('friends')?' collapsed':'';
    const cSch=isSideCollapsed('sched')?' collapsed':'';
    const cMeal=isSideCollapsed('meal')?' collapsed':'';
    const cSug=isSideCollapsed('suggest')?' collapsed':'';
    const cAdm=isSideCollapsed('admin')?' collapsed':'';
    const chatSec=`<div class="side-section${cChat}" data-sidekey="chat"><div class="side-title" data-sidetitle="chat"><span class="side-title-left"><button class="side-caret-btn" data-action="side-toggle" data-side="chat" aria-label="접기/펼치기"><span class="side-caret">▾</span></button><span>채팅</span></span><span class="side-title-btns"><button class="text-btn" data-action="room-join-code">코드로 참가</button><button class="text-btn" data-action="new-room">+ 만들기</button></span></div><div class="side-section-body"><div class="side-section-inner"><div id="roomList"></div></div></div></div>`;
    const inviteSec=`<div class="side-section hidden${cInv}" data-sidekey="invite" id="inviteSection"><div class="side-title" data-sidetitle="invite"><span class="side-title-left"><button class="side-caret-btn" data-action="side-toggle" data-side="invite" aria-label="접기/펼치기"><span class="side-caret">▾</span></button><span>초대</span></span></div><div class="side-section-body"><div class="side-section-inner"><div id="inviteList"></div></div></div></div>`;
    const friendSec=`<div class="side-section${cFr}" data-sidekey="friends"><div class="side-title" data-sidetitle="friends"><span class="side-title-left"><button class="side-caret-btn" data-action="side-toggle" data-side="friends" aria-label="접기/펼치기"><span class="side-caret">▾</span></button><span>친구</span></span><button class="text-btn" data-action="friends">관리</button></div><div class="side-section-body"><div class="side-section-inner"><div id="friendList"></div></div></div></div>`;
    const schedSec=`<div class="side-section${cSch}" data-sidekey="sched"><div class="side-title" data-sidetitle="sched"><span class="side-title-left"><button class="side-caret-btn" data-action="side-toggle" data-side="sched" aria-label="접기/펼치기"><span class="side-caret">▾</span></button><span>일정</span></span><span class="side-title-btns"><button class="text-btn" data-action="calendar" aria-label="일정 열기">열기</button></span></div><div class="side-section-body"><div class="side-section-inner"><button class="room" data-action="calendar"><div class="room-icon">📅</div><div class="room-main"><div class="room-name">학교 일정</div><div class="room-sub">우리 학교 일정</div></div></button><button class="room" data-action="todos-go"><div class="room-icon">✅</div><div class="room-main"><div class="room-name">할 일</div><div class="room-sub">남은 할 일 보기</div></div></button></div></div></div>`;
    const mealSec=`<div class="side-section${cMeal}" data-sidekey="meal"><div class="side-title" data-sidetitle="meal"><span class="side-title-left"><button class="side-caret-btn" data-action="side-toggle" data-side="meal" aria-label="접기/펼치기"><span class="side-caret">▾</span></button><span>오늘 급식·시간표</span></span><button class="text-btn" data-action="meal-refresh">새로고침</button></div><div class="side-section-body"><div class="side-section-inner"><div id="mealWidget"><div class="empty-side">불러오는 중…</div></div></div></div></div>`;
    const suggestSec=state.profile?.role==='student'?`<div class="side-section${cSug}" data-sidekey="suggest"><div class="side-title" data-sidetitle="suggest"><span class="side-title-left"><button class="side-caret-btn" data-action="side-toggle" data-side="suggest" aria-label="접기/펼치기"><span class="side-caret">▾</span></button><span>건의함</span></span></div><div class="side-section-body"><div class="side-section-inner"><button class="room" data-action="suggest-box"><div class="room-icon">📮</div><div class="room-main"><div class="room-name">익명 건의함</div><div class="room-sub">누가 썼는지 알 수 없어요</div></div></button></div></div></div>`:'';
    const adminSec=(isAdmin()||state.profile?.role==='teacher'||isSchoolAdmin())?`<div class="side-section${cAdm}" data-sidekey="admin"><div class="side-title" data-sidetitle="admin"><span class="side-title-left"><button class="side-caret-btn" data-action="side-toggle" data-side="admin" aria-label="접기/펼치기"><span class="side-caret">▾</span></button><span>관리</span></span></div><div class="side-section-body"><div class="side-section-inner"><button class="room" data-action="admin"><div class="room-icon">⌘</div><div class="room-main"><div class="room-name">${isAdmin()?'관리자 도구':isSchoolAdmin()?'학교 관리':'교사 도구'}</div><div class="room-sub">학교 설정과 운영 도구</div></div></button></div></div></div>`:'';
    const secs={chat:chatSec,invite:inviteSec,friends:friendSec,sched:schedSec,meal:mealSec,suggest:suggestSec,admin:adminSec};
    // sideLayout이 rooms-only/friends-only면 해당 섹션만, split/friends-top이면 순서대로
    let keys=sideOrderList().filter(k=>secs[k]);
    if(layout==='rooms-only') keys=keys.filter(k=>k==='chat');
    else if(layout==='friends-only') keys=keys.filter(k=>k==='friends');
    else if(layout==='friends-top') keys=[...keys.filter(k=>k==='friends'),...keys.filter(k=>k!=='friends'&&k!=='invite'),...keys.filter(k=>k==='invite')];
    const listSecs=keys.map(k=>secs[k]).join('');
    const paletteHint=`<button class="icon-btn" data-action="open-palette" aria-label="빠른 실행" title="빠른 실행 (Ctrl+K)" style="margin-right:4px">⌕</button>`;
    return `<div class="side-top"><div class="brand"><div class="brand-mark">${brandMarkHtml()}</div><span class="brand-name" data-brand-roll>${esc(brandNames()[0]||'에듀톡')}</span></div>${paletteHint}</div>
      <div class="profile-card"><div class="profile-row"><button type="button" class="avatar-dot profile-open" data-action="profile" aria-label="내 프로필 보기">${avatarHtml(state.profile)}</button><div class="grow"><button type="button" class="profile-name profile-open" data-action="profile">${esc(state.profile?.displayName||'사용자')}</button><div class="profile-meta-line"><span class="profile-meta">${gradeClassPrefix(state.profile)}${roleLabel(state.profile?.role)}</span><span class="presence-dot inline ${myPresenceState()||'hidden'}" data-my-presence-dot aria-hidden="true"></span><button type="button" class="presence-menu-btn" data-action="presence-menu" aria-haspopup="menu" aria-label="접속 상태 변경"><span class="presence-text" data-my-presence-label>${esc(myPresenceLabel())}</span><span class="presence-caret" aria-hidden="true">⌄</span></button></div></div></div></div>
      <div id="licenseBanner" class="license-banner hidden"></div>
      <div id="bannerPager"></div>
      <div id="unreadSummary" class="unread-summary hidden" role="button" tabindex="0" data-action="unread-summary-go" aria-label="안읽은 방으로 이동" onkeydown="if(event.key==='Enter'||event.key===' ') { event.preventDefault(); this.click(); }"></div>
      <div class="side-body">${listSecs}</div>
      <div class="side-bottom"><button class="soft-btn manage-btn" data-action="chat-manage"><span>💬</span> 채팅 관리</button><div class="row"><button class="soft-btn" data-action="settings">전체 설정</button><button class="soft-btn" data-action="logout">로그아웃</button></div></div>`;
  }
  // 큰 탭(채팅·친구·일정 등) 순서 — 꾹 눌러 바꾸고 저장한다 (채팅방 순서 바꾸기와 동일한 모션)
  const SIDE_DEFAULT_ORDER=['chat','friends','sched','meal','suggest','admin','invite'];
  function sideOrderList(){
    const saved=Array.isArray(state.settings?.sideOrder)?state.settings.sideOrder:[];
    const known=SIDE_DEFAULT_ORDER.filter(k=>saved.includes(k));
    const rest=SIDE_DEFAULT_ORDER.filter(k=>!saved.includes(k));
    return [...known,...rest];
  }
  async function saveSideOrder(order){
    const next=Array.isArray(order)&&order.length ? order.slice() : sideOrderList();
    state.settings.sideOrder=next;
    const s={...(state.profile?.settings||{}),sideOrder:next, collapsedSideSections: state.settings.collapsedSideSections||[], collapsedGroups: state.settings.collapsedGroups||[]};
    if(state.profile) state.profile.settings=s;
    try{ await db.collection('users').doc(uid()).update({settings:s,updatedAt:ts()}); }
    catch(e){ console.error(e); }
  }
  // ---------- 큰 탭(채팅·친구·일정 등) 꾹 눌러 순서 바꾸기 — 채팅방 카테고리 드래그와 동일한 모션 ----------
  let sideDrag=null;
  function sideSectionEls(){ return $$('.side-body .side-section[data-sidekey]').filter(el=>!el.classList.contains('hidden')); }
  function sideBody(sec){ return sec.querySelector('.side-section-body'); }
  function beginSideDrag(titleEl, key){
    const secs=sideSectionEls();
    if(secs.length<2) return false;
    const el=titleEl.closest('.side-section'); if(!el) return false;
    sideDrag={key,el,wasCollapsed:secs.filter(s=>s.classList.contains('collapsed')).map(s=>s.dataset.sidekey)};
    state.suppressSideClick=true;
    document.body.classList.add('side-dragging');
    // 채팅방 카테고리처럼 차라락 접히며 들어간다
    secs.forEach((s,i)=>{ const b=sideBody(s); if(b) b.style.transitionDelay=(i*45)+'ms'; s.classList.add('collapsed'); });
    el.classList.add('side-lift');
    setTimeout(()=>{ secs.forEach(s=>{ const b=sideBody(s); if(b) b.style.transitionDelay='0ms'; }); }, secs.length*45+260);
    startDragHaptic();
    return true;
  }
  function moveSideDrag(y){
    if(!sideDrag) return;
    const others=sideSectionEls().filter(s=>s!==sideDrag.el);
    let target=null;
    for(const s of others){ const r=s.getBoundingClientRect(); if(y<r.top+r.height*0.55){ target=s; break; } }
    const parent=sideDrag.el.parentNode;
    if(target) parent.insertBefore(sideDrag.el, target);
    else parent.appendChild(sideDrag.el);
    updateEdgeScroll(y);
  }
  async function endSideDrag(){
    const d=sideDrag; if(!d) return;
    sideDrag=null;
    try{ stopDragHaptic(true); }catch(e){}
    try{ stopEdgeScroll(); }catch(e){}
    document.body.classList.remove('side-dragging');
    d.el.classList.remove('side-lift');
    const secs=sideSectionEls();
    const order=secs.map(s=>s.dataset.sidekey).filter(Boolean);
    const rest=SIDE_DEFAULT_ORDER.filter(k=>!order.includes(k));
    const finalOrder=order.concat(rest);
    // 접었던 탭은 원래 접힌 채로, 나머지는 튀어나온다
    const was=d.wasCollapsed||[];
    secs.filter(s=>!was.includes(s.dataset.sidekey)).forEach((s,i)=>{ const b=sideBody(s); if(b) b.style.transitionDelay=(i*45)+'ms'; s.classList.remove('collapsed'); });
    await saveSideOrder(finalOrder);
    setTimeout(()=>{
      $$('.side-body .side-section').forEach(s=>{ const b=sideBody(s); if(b) b.style.transitionDelay=''; });
      state.suppressSideClick=false;
      // 순서 저장은 이미 됐고, 렌더 없이 DOM 순서 유지 (깜박임 방지). 토스트만 띄운다
      toast('탭 순서를 바꿨어요.');
    }, 320);
  }
  function wireSideDrag(){
    document.addEventListener('pointerdown', e=>{
      const title=e.target.closest?.('[data-sidetitle]');
      if(!title) return;
      if(e.button!=null && e.button!==0) return;
      // 버튼(코드 참가·만들기 등)을 누른 건 드래그가 아니다
      if(e.target.closest('button')) return;
      const x0=e.clientX, y0=e.clientY, key=title.dataset.sidetitle;
      let timer=setTimeout(()=>{
        if(sideSectionEls().length<2){ sideDrag=null; toast('탭이 2개 이상 있어야 순서를 바꿀 수 있어요.'); return; }
        if(!beginSideDrag(title, key)){ sideDrag=null; }
      }, 320);
      const move=ev=>{
        if(!sideDrag){ if(Math.abs(ev.clientX-x0)>9||Math.abs(ev.clientY-y0)>9){ clearTimeout(timer); cleanup(); } return; }
        ev.preventDefault();
        moveSideDrag(ev.clientY);
      };
      const up=()=>{ if(sideDrag) endSideDrag(); else clearTimeout(timer); cleanup(); };
      const cleanup=()=>{
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
      };
      document.addEventListener('pointermove', move, {passive:false});
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
  }
  wireSideDrag();
  function avatarHtml(p,size='',withPresence=false){
    const cls=`avatar ${size}`.trim();
    const dot=withPresence?presenceDot(p):'';
    const emoji=String(p?.avatarEmoji||'').slice(0,4);
    const color=safeColor(p?.avatarColor);
    const style=color?` style="background:${color}1f;color:${color}"`:'';
    const face=p?.photoURL?`<img src="${esc(p.photoURL)}" alt="">`:esc(emoji || (p?.displayName||'?').trim().charAt(0) || '?');
    const warn=p?.photoFlagged?'<span class="avatar-warn" title="주의가 필요한 사진일 수 있어요">!</span>':'';
    return `<div class="${cls}"${style}>${dot}<span class="avatar-face">${face}</span>${warn}</div>`;
  }
  function emptyChat(){return `<div class="empty-chat"><button type="button" class="drawer-fab" data-action="open-drawer" aria-label="채팅방 목록 열기"><span>☰</span> 채팅방 목록</button><div><div class="brand-mark" style="margin:0 auto 16px">${brandMarkHtml()}</div><h2>채팅방을 골라 주세요</h2><p>왼쪽에서 채팅방을 고르면 메시지를 볼 수 있어요.</p></div></div>`;}
  // 관리자 화면 등 #chat 이 없는 화면에서도 안전하게 빈 채팅 화면으로 되돌린다
  function clearChatPane(){ const c=$('#chat'); if(c) c.innerHTML=emptyChat(); }

  // ---------- 개발자 도구 차단 (억제용: 진짜 보안 경계는 firestore.rules다) ----------
  // 주의: 아래 let 2개는 IIFE 맨 위에서 선언한다. setupGlobalHandlers()가 파일 앞부분(1605행)에서
  // 먼저 실행되므로 여기에 두면 TDZ ReferenceError로 부팅이 멈춘다.
  function devToolsOpen(){
    try{
      const w=window.outerWidth||0, iw=window.innerWidth||0, h=window.outerHeight||0, ih=window.innerHeight||0;
      if(Math.max(0,w-iw)>160 || Math.max(0,h-ih)>160) return true;
    }catch(e){}
    // 14번: 브라우저 메뉴로 분리창(undocked)으로 열면 크기 차이가 없어 우회됨 — console getter 트릭으로 보완
    try{
      let opened=false;
      const el=new Image();
      Object.defineProperty(el,'id',{get(){ opened=true; return 'x'; }});
      // 콘솔이 열려 있을 때만 getter가 호출돼 서식이 지정된다
      console.log(el);
      console.clear&&console.clear();
      if(opened) return true;
    }catch(e){}
    return false;
  }
  // 14번: 개발자도구가 열리면 화면 코드를 비우고 팝업만 남긴다
  function wipeForDevTools(){
    try{
      if(state._devWiped) return;
      state._devWiped=true;
      try{ clearListeners(); }catch(e){}
      try{ stopPresence(); }catch(e){}
      // 화면 비우기
      try{ ['app','modalRoot','toast'].forEach(id=>{ const n=document.getElementById(id); if(n) n.innerHTML=''; }); }catch(e){}
      try{ document.querySelectorAll('video,audio').forEach(n=>{ try{n.pause();}catch(e){} }); }catch(e){}
      // 추가: 스크립트·스타일 제거 (소스는 네트워크 탭에 남아있으므로 완전 은닉은 불가 - 진짜 보안은 서버 규칙)
      try{ document.querySelectorAll('script[src*="app.js"], script:not([src])').forEach(s=>{ try{ s.textContent=''; s.remove(); }catch(e){} }); }catch(e){}
      try{ document.querySelectorAll('link[rel="stylesheet"]').forEach(l=>{ try{ l.remove(); }catch(e){} }); }catch(e){}
      // 추가: body를 경고만 남기고 모두 제거, 히스토리 오염 방지
      try{
        const guard=document.getElementById('devGuard');
        const guardHtml = guard ? guard.outerHTML : '<div id="devGuard" class="show" style="position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(12,16,22,.92);backdrop-filter:blur(6px);padding:24px"><div style="background:#fff;border-radius:20px;padding:28px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 30px 90px rgba(0,0,0,.35)"><div style="width:52px;height:52px;border-radius:50%;background:#FFF0F1;color:#E5484D;display:grid;place-items:center;margin:0 auto 14px;font-size:26px">⚠️</div><h2 style="margin:0 0 8px;color:#000">개발자 도구가 감지되었습니다</h2><p style="margin:0;color:#333;font-size:14px;line-height:1.6">보안을 위해 화면을 보호했습니다.<br>창을 닫고 다시 시도해 주세요.</p></div></div>';
        // 문서 전체를 경고만 남기도록 교체 (소스는 이미 다운로드되어 네트워크 탭에 남지만, DOM에서는 제거)
        document.documentElement.innerHTML = '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>에듀톡</title><style>html,body{height:100%;margin:0;background:#101119;color:#fff;font-family:Pretendard,sans-serif}</style></head><body>' + guardHtml + '</body>';
        try{ window.stop(); }catch(e){}
        // 추가: 무한 debugger로 추가 분석 방해 (개발자 도구가 열려 있으면 멈춤)
        // Note: 실제 보안 경계는 firestore.rules이며, 클라이언트 코드는 항상 네트워크로 다운로드되므로 완전 은닉은 불가능합니다.
      }catch(e){}
    }catch(e){}
  }
  function showDevGuard(){
    try{ if(devToolsOpen()) wipeForDevTools(); }catch(e){}
    if(devGuardShown) return; devGuardShown=true;
    let ov=document.getElementById('devGuard');
    if(!ov){
      ov=document.createElement('div'); ov.id='devGuard';
      ov.innerHTML=`<div class="dev-guard-card"><div class="dev-guard-mark">!</div><h2>안전한 에듀톡을 위해 개발자 도구는 허용하지 않아요</h2><p>개발자 도구를 닫고 새로고침 해주세요.<br><span class="dev-guard-sub">(F12를 실수로 눌렀을 수도 있어요. F12를 누르지 마세요.)</span></p><div class="modal-actions" style="margin-top:6px"><button type="button" class="confirm" id="devGuardReload">새로고침</button><button type="button" class="cancel" id="devGuardClose">확인</button></div></div>`;
      document.body.appendChild(ov);
      ov.querySelector('#devGuardClose').onclick=()=>{ hideDevGuard(); };
      ov.querySelector('#devGuardReload').onclick=()=>{ try{ location.reload(); }catch(e){} };
    }else{
      // 문구 보장 (구버전 캐시 대응)
      try{
        const p=ov.querySelector('.dev-guard-card p');
        if(p && !/새로고침/.test(p.textContent||'')) p.innerHTML='개발자 도구를 닫고 새로고침 해주세요.<br><span class="dev-guard-sub">(F12를 실수로 눌렀을 수도 있어요. F12를 누르지 마세요.)</span>';
        if(!ov.querySelector('#devGuardReload')){
          const b=document.createElement('button'); b.type='button'; b.className='confirm'; b.id='devGuardReload'; b.textContent='새로고침';
          b.onclick=()=>{ try{ location.reload(); }catch(e){} };
          ov.querySelector('.modal-actions')?.prepend(b);
        }
      }catch(e){}
    }
    ov.classList.add('show');
  }
  function hideDevGuard(){ devGuardShown=false; const ov=document.getElementById('devGuard'); if(ov) ov.classList.remove('show'); }
  function isMobileLike(){
    try{
      if(window.matchMedia && window.matchMedia('(pointer:coarse)').matches) return true;
      if(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent||'')) return true;
    }catch(e){}
    return false;
  }
  function watchDevTools(){
    if(devGuardTimer) return;
    // 모바일은 브라우저 UI 때문에 창 크기 차이로 오탐이 나므로 감지하지 않는다 (키 차단도 PC 자판 위주라 영향 없음)
    if(isMobileLike()) return;
    // 한 번 뜨면 확인을 누르기 전까지 유지한다 (읽게 하기 위해 자동으로 숨기지 않는다)
    devGuardTimer=setInterval(()=>{
      try{ if(devToolsOpen()) showDevGuard(); }catch(e){}
    },1000);
  }
  function setupGlobalHandlers(){
    if(state._bound)return; state._bound=true;
    // 개발자 도구·소스 보기 단축키 차단 (F12, Ctrl+Shift+I/J/C, Ctrl+U/S)
    document.addEventListener('keydown',e=>{
      try{
        const k=String(e.key||'').toLowerCase();
        const mod=(e.ctrlKey||e.metaKey);
        const blocked = e.key==='F12'
          || (mod && e.shiftKey && ['i','j','c','k','e'].includes(k))
          || (mod && !e.shiftKey && ['u','s'].includes(k));
        if(blocked){ e.preventDefault(); e.stopPropagation(); showDevGuard(); }
      }catch(err){}
    }, true);
    watchDevTools();
    try{ stashJoinLink(); }catch(e){}
    document.addEventListener('click',e=>runAsync(()=>handleClick(e))); document.addEventListener('submit',e=>runAsync(()=>{if(e.target.id==='authForm'){e.preventDefault();return signInForm(e.target);}if(e.target.id==='composerForm'){e.preventDefault();return sendMessage(e.target);}if(e.target.id==='roomForm'){e.preventDefault();const b=document.querySelector('#roomActions .confirm');if(b)return b.click();const f2=$('#roomForm');return createRoom(f2);}if(e.target.id==='profileForm'){e.preventDefault();return saveProfile(e.target);}if(e.target.id==='settingsForm'){e.preventDefault();return saveSettings(e.target);}if(e.target.id==='schoolForm'){e.preventDefault();return saveSchoolSettings(e.target);}if(e.target.id==='reportForm'){e.preventDefault();return submitReport(e.target);}if(e.target.id==='noticeForm'){e.preventDefault();return sendNotice(e.target);}if(e.target.id==='siteNoticeForm'){e.preventDefault();return saveSiteNotice();}}));
    document.addEventListener('keydown',e=>{if(e.target.id==='composerText'&&mentionKeydown(e))return;if(e.key==='Escape'){if(state.openDropdownCleanup){closeDropdown();return;}dismissModal();return;}if(e.target.id==='composerText'&&e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing&&!isCoarsePointer()){e.preventDefault();runAsync(()=>sendMessage($('#composerForm')));}});
    document.addEventListener('input',e=>{if(e.target.id==='composerText'){smoothComposerResize(e.target);syncComposerHeight();updateCharCount();updat; try{ saveDraft(state.room?.id, e.target.value); const h=document.getElementById('composerDraftHint'); if(h) h.classList.toggle('show', !!e.target.value && !!loadDraft(state.room?.id)); }catch(e){}eMentionBox();pingTyping();if(state.room && !state.editingId){ try{ saveDraft(state.room.id, e.target.value); }catch(_){} }}if(e.target.id==='roomSearchInput'){runRoomSearch(e.target.value);}if(e.target.id==='rfAmount'||e.target.id==='licPrice'||e.target.id==='buyPrice'){formatKRWInput(e.target);}});
    document.addEventListener('change',e=>{ if(e.target && e.target.dataset && (e.target.dataset.action==='license-toggle')){ if(!(state.licenseSel instanceof Set)) state.licenseSel=new Set(); if(e.target.checked) state.licenseSel.add(e.target.dataset.code); else state.licenseSel.delete(e.target.dataset.code); } if(e.target && e.target.dataset && (e.target.dataset.action==='refund-toggle')){ if(!(state.refundSel instanceof Set)) state.refundSel=new Set(); if(e.target.checked) state.refundSel.add(e.target.dataset.id); else state.refundSel.delete(e.target.dataset.id); } });
    // 컴퓨터에서 이미지를 붙여넣으면 그 사진을 보낼지 물어본다
    document.addEventListener('paste',e=>{
      if(!e.target || e.target.id!=='composerText') return;
      const items=(e.clipboardData&&e.clipboardData.items)||[];
      let file=null;
      for(let i=0;i<items.length;i++){ const it=items[i]; if(it && it.kind==='file' && String(it.type||'').startsWith('image/')){ file=it.getAsFile(); break; } }
      if(!file) return;   // 글자 붙여넣기는 그대로 둔다
      e.preventDefault();
      openAttachConfirm(file);
    });
    document.addEventListener('change',e=>{ if(e.target && e.target.dataset && 'landingAction' in e.target.dataset){ syncLandingDraft(); renderLandingAdmin($('#adminPanel')); return; } if(e.target && e.target.id==='chatFileInput'){ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(f) openAttachConfirm(f); } if(e.target && e.target.id==='roomIconFile'){ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(f) setRoomIconPhoto(state.room?.id,f); } if(e.target && (e.target.id==='avatarFileInput'||e.target.id==='avatarCameraInput')){ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(f) setProfilePhoto(f); } if(e.target && e.target.id==='trCertFile'){ const f=e.target.files&&e.target.files[0]; const pv=$('#trCertPreview'); if(pv) pv.innerHTML=f?`<span>${esc(f.name||'파일')} · ${esc(fmtBytes(f.size))}</span>`:'<span>파일 없음</span>'; } if(e.target&&e.target.dataset&&e.target.dataset.cmPick){ if(!(state.cmSel instanceof Set)) state.cmSel=new Set(); if(e.target.checked) state.cmSel.add(e.target.dataset.cmPick); else state.cmSel.delete(e.target.dataset.cmPick); } });
    document.addEventListener('keydown',e=>{ if(e.target.id==='roomSearchInput'&&e.key==='Enter'){e.preventDefault();runRoomSearch(e.target.value);} if(e.target.id==='roomSearchInput'&&e.key==='Escape'){e.preventDefault();toggleRoomSearch(false);} });
    document.addEventListener('visibilitychange',onReadVisibility);
    wireMessagePress();
    window.addEventListener('resize',()=>closeDropdown());
    // 전송 버튼을 누르는 순간 입력창 포커스가 빠지면 키보드가 흔들리므로 미리 막는다 (클릭은 정상 동작)
    document.addEventListener('pointerdown',e=>{ try{ if(e.target && e.target.closest && e.target.closest('.composer .send')) e.preventDefault(); }catch(err){} },true);
    // 사진이 늦게 불러와져도 맨 아래에 고정되게 (이미지 로드 시점에 아래로 맞춤)
    // 진행 중인 스크롤을 취소하고 새 끝점으로 부드럽게 다시 간다 (낡은 목표지점 방지)
    document.addEventListener('load',e=>{
      try{
        const t=e.target;
        if(t && t.tagName==='IMG' && t.closest && t.closest('#messages') && state.atBottom){
          const h=$('#messages'); if(!h) return;
          cancelMsgScroll();
          scrollMessagesToBottom(h,true);
        }
      }catch(err){}
    },true);
    // 오프라인 감지 (순간 깜빡임에 반응하지 않고 2.5초 지속될 때만 오프라인으로 확정)
    try{
      let netTimer=null;
      const updateOnlineUI=(announce)=>{
        const online=navigator.onLine!==false;
        if(!online){
          if(state.netOffline) return;
          if(netTimer) return;
          netTimer=setTimeout(()=>{
            netTimer=null;
            if(navigator.onLine===false){
              state.netOffline=true;
              document.body.classList.add('offline');
              if(announce) toast('인터넷 연결이 끊겼어요. 메시지는 연결된 뒤에 보내 주세요.');
            }
          },2500);
          return;
        }
        if(netTimer){ clearTimeout(netTimer); netTimer=null; }
        const wasOff=!!state.netOffline;
        state.netOffline=false;
        document.body.classList.remove('offline');
        if(announce&&wasOff) toast('인터넷에 다시 연결됐어요.');
        if(online) runAsync(()=>flushOutbox());
      };
      window.addEventListener('online',()=>updateOnlineUI(true));
      window.addEventListener('offline',()=>updateOnlineUI(true));
      updateOnlineUI(false);
    }catch(e){}
    // 모바일 키보드가 올라오면 입력창이 키보드 위 여백에 맞게 따라간다
    try{
      if(window.visualViewport){
        const vv=window.visualViewport;
        vv.addEventListener('resize',syncKeyboard);
        vv.addEventListener('scroll',syncKeyboard);
        syncKeyboard();
      }
    }catch(e){}
  }

  async function handleClick(e){
    const stTabEl=e.target.closest('[data-settings-tab]');
    if(stTabEl){
      const tab=stTabEl.dataset.settingsTab;
      if(state.view==='settings'){
        renderSettingsPanel(tab);
        setTimeout(()=> updateTabsIndicator('.settings-page .admin-tabs'), 30);
      } else {
        state.settingsTab=tab;
        document.querySelectorAll('[data-settings-tab]').forEach(x=>x.classList.toggle('active', x.dataset.settingsTab===tab));
        document.querySelectorAll('.settings-pane').forEach(p=> p.classList.toggle('hidden', p.dataset.pane!==tab));
        setTimeout(()=> updateTabsIndicator(document.querySelector('.tabs')), 30);
      }
      return;
    }
    const el=e.target.closest('[data-action]');
    const a=el?.dataset.action;
    // 터치 화면에서만 눌러서 고정한다 (마우스에서는 호버로만 열려요)
    if(a!=='landing-drop' && !finePointer()) $$('.landing-drop.open').forEach(x=>{ x.classList.remove('open'); const b=x.querySelector('.landing-menu-btn'); if(b) b.setAttribute('aria-expanded','false'); });
    // 햄버거 메뉴 안에서 다른 항목을 고르면 메뉴를 닫는다
    if(a && a.startsWith('landing-') && !['landing-sheet-open','landing-sheet-close','landing-acc'].includes(a)) closeLandingSheet();
    // 멘션 목록은 다른 곳을 누르면 닫는다
    if(a!=='mention-pick') hideMentionBox();
    const rid=()=>el.closest('[data-room-id]')?.dataset.roomId;
    const inv=()=>el.closest('[data-invite]')?.dataset.invite;
    const u=()=>el.closest('[data-uid]');
    // 말풍선을 가볍게 누르면 그 말풍선의 전송 시간을 보여준다 (링크·사진·버튼은 제외, 꾹 누르면 메뉴)
    if(!a){
      const bub=e.target.closest?.('.message-row .bubble');
      if(bub && !e.target.closest('a,button,img,video,audio')){
        const row=bub.closest('.message-row'); if(row){ row.classList.toggle('show-time'); return; }
      }
    }
    if(a){
      if(a==='close-settings')return closeSettings();
      if(a==='retry')return location.reload(); if(a==='toggle-auth'){state.authAnim=state.authMode==='login'?'left':'right';state.authMode=state.authMode==='login'?'signup':'login';state.authPage='';renderAuth();return}
      if(a==='auth-page'){state.authAnim='left';state.authPage=el.dataset.page||'';paintAuth();return}
      if(a==='auth-page-back'){state.authAnim='right';state.authPage='';paintAuth();return}
      if(a==='gate-privacy'){ const p=(authPages().find(x=>x.id==='privacy')||DEFAULT_AUTH_PAGES.find(x=>x.id==='privacy')); if(p) openModal(`<h2>${esc(p.title||'개인정보 처리방침')}</h2><div class="auth-page-body">${sanitizeRichHtml(p.html||'')}</div><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`); return; }
      if(a==='gate-terms'){ const p=(authPages().find(x=>x.id==='terms')||DEFAULT_AUTH_PAGES.find(x=>x.id==='terms')); if(p) openModal(`<h2>${esc(p.title||'서비스 이용약관')}</h2><div class="auth-page-body">${sanitizeRichHtml(p.html||'')}</div><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`); return; }
      if(a==='auth-page-btn'){
        const url=el.dataset.url||''; if(!url) return;
        // 메일·전화 링크는 그 창에서 바로 열리고, 일반 주소는 새 탭으로 연다
        openSafeLink(url);
        return;
      }
      if(a==='landing-login')return enterAuth('login');
      if(a==='landing-signup')return enterAuth('signup');
      if(a==='landing-home'){state.landingRequested=false;state.authPage='';return zoomTransition('#app .auth', ()=>renderLanding(), '#app .landing');}
      if(a==='landing-show'){state.landingRequested=true;state.authPage='';return zoomTransition('#app .auth', ()=>renderLanding(), '#app .landing');}
      if(a==='landing-page'){state.landingRequested=true;state.authPage=el.dataset.page||'';return paintAuth();}
      if(a==='landing-scroll')return landingScroll(el.dataset.target);
      if(a==='landing-open-url'){
        const url=el.dataset.url||'';
        if(!url) return toast('주소가 아직 설정되지 않았어요. 관리자에게 알려 주세요.');
        openSafeLink(url);   // http(s) · mailto · tel 만 허용
        return;
      }
      if(a==='mention-pick')return pickMention(el.dataset.idx);
      if(a==='read-list')return openReadList(el.dataset.names||'',el.dataset.count||'');
      if(a==='attach-confirm-send'){ return confirmAttachmentSend(el); }
      if(a==='attach-send-risky'){
        const d=state.attachDraft;
        if(!d?.file) return;
        const file=d.file, screen={risk:true,score:d.score};
        closeModal();
        sendAttachment(file,screen);
        return;
      }
      if(a==='reveal-attach'){
        if(!(state.revealedAttach instanceof Set)) state.revealedAttach=new Set();
        state.revealedAttach.add(el.dataset.msg);
        renderMessages(false);
        return;
      }
      if(a==='save-risky-photo'){
        const d=state.photoDraft;
        if(!d) return;
        closeModal();
        saveProfilePhotoData(d.data,true,d.risk);
        return;
      }
      if(a==='photo-crop-save')return savePhotoCrop();
      if(a==='landing-sheet-open')return openLandingSheet();
      if(a==='landing-sheet-close')return closeLandingSheet();
      if(a==='landing-acc'){
        const box=el.closest('.landing-acc'); if(!box) return;
        const on=box.classList.contains('open');
        $$('.landing-acc.open').forEach(x=>x.classList.remove('open'));
        if(!on) box.classList.add('open');
        return;
      }
      if(a==='landing-drop'){
        const d=el.closest('.landing-drop'); if(!d) return;
        if(finePointer()) return;   // 마우스 환경: 호버로만 열린다 (눌러서 고정하지 않음)
        const was=d.classList.contains('open');
        $$('.landing-drop.open').forEach(x=>{ x.classList.remove('open'); const b=x.querySelector('.landing-menu-btn'); if(b) b.setAttribute('aria-expanded','false'); });
        if(!was){ d.classList.add('open'); el.setAttribute('aria-expanded','true'); }
        return;
      }
      if(a==='pages-btn-add'){syncPagesDraft();const l=pagesDraft();const i=Number(el.dataset.idx);if(l[i]&&l[i].buttons.length<6)l[i].buttons.push({label:'',url:''});renderPagesAdmin($('#adminPanel'));return}
      if(a==='pages-btn-remove'){syncPagesDraft();const l=pagesDraft();const i=Number(el.dataset.idx),bi=Number(el.dataset.bi);if(l[i])l[i].buttons.splice(bi,1);renderPagesAdmin($('#adminPanel'));return}
      if(a==='pages-remove'){syncPagesDraft();pagesDraft().splice(Number(el.dataset.idx),1);renderPagesAdmin($('#adminPanel'));return}
      if(a==='pages-add'){syncPagesDraft();const l=pagesDraft();if(l.length<12)l.push({id:'page'+Date.now().toString(36),label:'새 안내',title:'새 안내',html:'',enabled:true,buttons:[]});renderPagesAdmin($('#adminPanel'));return}
      if(a==='save-pages')return saveAuthPages();
      if(a==='load-policy')return loadPolicyAdmin();
      if(a==='save-policy')return savePolicyAdmin();
      if(a==='landing-nav-add'){syncLandingDraft();const L=landingDraft();if(L.nav.length<5)L.nav.push({label:'새 메뉴',type:'link',action:'login',value:'',items:[]});renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-nav-remove'){syncLandingDraft();landingDraft().nav.splice(Number(el.dataset.idx),1);renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-sub-add'){syncLandingDraft();const N=landingDraft().nav[Number(el.dataset.idx)];if(N&&N.items.length<5){N.type='menu';N.items.push({label:'새 항목',action:'page',value:''});}renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-sub-remove'){syncLandingDraft();const N=landingDraft().nav[Number(el.dataset.idx)];if(N)N.items.splice(Number(el.dataset.si),1);renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-feat-add'){syncLandingDraft();const L=landingDraft();if(L.features.length<6)L.features.push({icon:'✨',title:'새 기능',desc:''});renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-feat-remove'){syncLandingDraft();landingDraft().features.splice(Number(el.dataset.idx),1);renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-step-add'){syncLandingDraft();const L=landingDraft();if(L.steps.length<4)L.steps.push({title:'새 단계',desc:''});renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-step-remove'){syncLandingDraft();landingDraft().steps.splice(Number(el.dataset.idx),1);renderLandingAdmin($('#adminPanel'));return}
      if(a==='save-landing')return saveLanding();
      if(a==='landing-mock-preset-add'){syncLandingDraft();const M=landingDraft().mock;if(M.presets.length<5)M.presets.push({name:'새 프리셋',messages:[{side:'left',avatar:'',text:'새 메시지'},{side:'right',avatar:'',text:'새 메시지'}]});renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-mock-preset-remove'){syncLandingDraft();landingDraft().mock.presets.splice(Number(el.dataset.idx),1);renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-mock-msg-add'){syncLandingDraft();const P=landingDraft().mock.presets[Number(el.dataset.idx)];if(P&&P.messages.length<6)P.messages.push({side:'left',avatar:'',text:'새 메시지'});renderLandingAdmin($('#adminPanel'));return}
      if(a==='landing-mock-msg-remove'){syncLandingDraft();const P=landingDraft().mock.presets[Number(el.dataset.idx)];if(P)P.messages.splice(Number(el.dataset.mi),1);renderLandingAdmin($('#adminPanel'));return}
      if(a==='google')return googleLogin(); if(a==='forgot')return forgot(); if(a==='send-reset')return sendReset();
      if(a==='settings')return openSettings(); if(a==='delete-account')return openDeleteAccountModal(); if(a==='profile')return openProfile(); if(a==='presence-menu'){ openPresenceMenu(el); return; } if(a==='logout')return confirmModal('로그아웃 하시겠어요?','다시 로그인해야 들어올 수 있어요.',()=>{closeAllModals();clearListeners();state.logoutZoom=true;return auth.signOut();}); if(a==='new-room')return openRoomModal(); if(a==='admin')return openAdmin();
      if(a==='close-admin')return exitAdmin(); if(a==='site-notice')return openAdmin('sitenotice'); if(a==='users-admin')return openAdmin('users');
      if(a==='user-profile')return openUserProfile(el.dataset.uid,el.dataset.name);
      if(a==='notice-link')return openNoticeLink(el.dataset.url);
      if(a==='notice-align'){const seg=el.closest('.seg');if(seg)seg.querySelectorAll('.seg-btn').forEach(x=>x.classList.toggle('active',x===el));updateNoticePreview();return;}
      if(a==='refresh-admin-users'){state.adminUsers=null;return renderAdminPanel(state.adminTab);}
      if(a==='pick-school')return openSchoolPicker();
      if(a==='pick-school-item')return selectSchool(el.dataset.sid);
      if(a==='retry-profile')return retryProfile();
      if(a==='neis-search')return neisSearch();
      if(a==='register-school')return registerSchool(el.dataset.nid);
      if(a==='open-school-settings')return openSchoolSettings(el.dataset.sid);
      if(a==='regen-school-code')return regenSchoolCode(el.dataset.sid);
      if(a==='delete-school')return deleteSchool(el.dataset.sid);
      if(a==='link-school-data')return linkSchoolData(el.dataset.sid);
      if(a==='save-site-notice')return saveSiteNotice();
      if(a==='profile-emoji')return pickProfileEmoji(el.dataset.emoji); if(a==='profile-color')return pickProfileColor(el.dataset.color);
      if(a==='close-drawer')return closeDrawer(); if(a==='open-drawer')return openDrawer(); if(a==='mobile-back'){document.body.classList.remove('m-chat-open');openDrawer();return;} if(a==='jump-bottom'){hideInRoomPill();const h=$('#messages');if(h)scrollMessagesToBottom(h,true);return;} if(a==='load-more-msgs')return loadMoreMessages(); if(a==='open-invite'||a==='invite'){closeAllModals();return openInvite(rid());} if(a==='accept-invite')return acceptInvite(inv()); if(a==='decline-invite')return declineInvite(inv());
      if(a==='cross-approve')return handleCross(el.dataset.id,true); if(a==='cross-reject')return handleCross(el.dataset.id,false);
      if(a==='school-remove')return removeUserFromSchool(el.dataset.uid,el.dataset.name);
      if(a==='school-role')return openSchoolRoleModal(el.dataset.uid,el.dataset.name,el.dataset.role);
      if(a==='school-role-apply')return applySchoolRole(el.dataset.uid,el.dataset.name,el.dataset.role);
      if(a==='dm-uid')return startDM(el.dataset.uid,el.dataset.name);
      if(a==='admin-set-school')return openUserSchoolPicker(el.dataset.uid,el.dataset.name);
      if(a==='admin-role')return openUserRoleModal(el.dataset.uid,el.dataset.name,el.dataset.role);
      if(a==='admin-role-apply')return applyUserRole(el.dataset.uid,el.dataset.name,el.dataset.role);
      if(a==='admin-set-school-apply')return applyUserSchool(el.dataset.uid,el.dataset.name,el.dataset.sid);
      if(a==='admin-class')return openUserClassModal(el.dataset.uid,el.dataset.name);
      if(a==='admin-class-apply')return applyUserClass(el.dataset.uid,el.dataset.name);
      if(a==='suspend-user')return openSuspendModal(el.dataset.uid,el.dataset.name);
      if(a==='suspend-apply')return applySuspend(el.dataset.uid,el.dataset.name);
      if(a==='unsuspend-user')return unsuspendUser(el.dataset.uid,el.dataset.name);
      if(a==='send-appeal')return sendAppeal();
      if(a==='mod-appeal')return openModAppeal(el.dataset.block);
      if(a==='mod-appeal-send')return submitModAppeal(el.dataset.block);
      if(a==='refresh-modappeals')return renderModAppeals($('#adminPanel'));
      if(a==='mod-approve')return resolveModAppeal(el.dataset.id,true);
      if(a==='mod-reject')return resolveModAppeal(el.dataset.id,false);
      if(a==='role-def-add')return addRoleDef();
      if(a==='role-def-remove')return removeRoleDef(el.dataset.id);
      if(a==='role-user-search')return searchRoleUsers();
      if(a==='role-user-pick'){state.roleGrantPick={...(state.roleGrantPick||{}),uid:el.dataset.uid,name:el.dataset.name,grade:Number(el.dataset.grade)||null,class:el.dataset.class?Number(el.dataset.class):null};const pl=$('#rolePicked');if(pl)pl.innerHTML=rolePickedText();$$('#roleUserList .list-item').forEach(x=>{const on=x.dataset.uid===(state.roleGrantPick||{}).uid;const t=x.querySelector('.title');if(t)t.innerHTML=`${esc(x.dataset.name||'사용자')}${on?' ✓':''}`;});return;}
      if(a==='role-grant')return grantRole();
      if(a==='role-ungrant')return ungrantRole(el.dataset.id);
      if(a==='notice-create')return createNoticeRoom();
      if(a==='appeal-unblock')return handleAppeal(el.dataset.id,el.dataset.uid,el.dataset.name,true);
      if(a==='appeal-close')return handleAppeal(el.dataset.id,el.dataset.uid,el.dataset.name,false);
      if(a==='members'){closeAllModals();return openMembersPanel(el.dataset.roomId||state.room?.id);}
      if(a==='close-members')return closeMembersPanel();
      if(a==='room-menu')return openRoomMenu(rid());
      if(a==='search'||a==='toggle-search'){closeAllModals();return toggleRoomSearch();}
      if(a==='search-prev')return searchMove(-1);
      if(a==='search-next')return searchMove(1);
      if(a==='search-close')return toggleRoomSearch(false);
      if(a==='pick-chat')return startPickFrom(el.dataset.msg);
      if(a==='toggle-reaction')return setReaction(el.dataset.msg,el.dataset.emoji);
      if(a==='react-pick'){const r=el.getBoundingClientRect();return openReactPicker(el.dataset.msg,r.left,r.top-40);}
      if(a==='toggle-reactions'){state.noReactions=!state.noReactions;refreshComposer();return toast(state.noReactions?'이 공지는 공감을 받지 않도록 했어요.':'이 공지는 공감을 받을 수 있어요.');}
      if(a==='toggle-select')return toggleSelectMode();
      if(a==='select-mine')return selectMine();
      if(a==='select-all-msgs')return selectAllMessages();
      if(a==='select-none-msgs')return clearSelection();
      if(a==='pick-msg')return togglePick(el.dataset.msg);
      if(a==='delete-selected')return deleteSelectedMessages();
      if(a==='admin-join')return adminJoinRoom(el.dataset.roomId);
      if(a==='delete-room')return deleteRoom(rid()); if(a==='manage-room'){closeAllModals();return openRoomManage(rid());} if(a==='leave-room')return leaveRoom(rid()); if(a==='audience')return openAudienceModal(rid());
      if(a==='owner-transfer')return openOwnerTransferModal(rid());
      if(a==='owner-transfer-pick')return applyOwnerTransfer(el.dataset.room, el.dataset.uid);
      if(a==='file-box')return openFileBox(rid());
      if(a==='filebox-hide-risk'){ state.fileBoxHideRisk=!state.fileBoxHideRisk; return openFileBox(state.room?.id||rid()); }
      if(a==='blind-restore')return restoreBlindMessage(el.dataset.msg);
      if(a==='blind-confirm')return confirmBlindDelete(el.dataset.msg);
      if(a==='meal-refresh')return loadMealWidget(true);
      if(a==='neis-manual')return openNeisManual();
      if(a==='poll-opt-add'){ const host=$('#pollOpts'); if(host&&host.querySelectorAll('[data-poll-opt]').length<6){ const i=document.createElement('input'); i.className='input'; i.setAttribute('data-poll-opt',''); i.maxLength=30; i.placeholder='보기 '+(host.querySelectorAll('[data-poll-opt]').length+1); i.style.marginTop='6px'; host.appendChild(i); i.focus(); } return; }
      if(a==='poll-create')return createPoll();
      if(a==='poll-vote')return votePoll(el.dataset.msg,Number(el.dataset.i));
      if(a==='poll-close')return closePoll(el.dataset.msg);
      if(a==='notice-from-room')return openNoticeFromRoom(rid());
      if(a==='export-room')return exportRoomText(el.dataset.roomId||rid());
      if(a==='poll-open')return openPollModal();
      if(a==='renotify-unread')return renotifyUnread(el.dataset.roomId||rid());
      if(a==='notice-pick-create')return createNoticePickRoom(el.dataset.room);
      if(a==='todo-open')return openTodosModal(rid());
      if(a==='todo-add')return addTodo(rid());
      if(a==='todo-toggle')return toggleTodo(el.dataset.roomId||rid(), el.dataset.id);
      if(a==='todo-del')return deleteTodo(el.dataset.roomId||rid(), el.dataset.id);
      if(a==='attend-open')return openAttendanceModal(rid());
      if(a==='attend-start')return startAttendance(rid());
      if(a==='attend-mark')return markAttendance(el.dataset.roomId||rid());
      if(a==='attend-close')return closeAttendance(rid());
      if(a==='attend-refresh')return renderAttendance(rid());
      if(a==='withdraw-transfer'){ const wid=el.dataset.roomId||rid(); closeAllModals(); return openOwnerTransferModal(wid); }
      if(a==='withdraw-delete-room'){ const wid=el.dataset.roomId||rid(); return deleteRoom(wid); }
      if(a==='invite-by-code')return inviteByCode(el.dataset.roomId,$('#inviteCodeInput')?.value||'');
      if(a==='copy-code')return copyMyCode();
      if(a==='friend-add')return addFriendByCode($('#friendCodeInput')?.value||'');
      if(a==='friends')return openFriends();
      if(a==='friend-accept')return acceptFriendRequest(el.dataset.id);
      if(a==='friend-decline')return declineFriendRequest(el.dataset.id);
      if(a==='friend-remove')return removeFriend(el.dataset.uid);
      if(a==='friend-add-uid')return (async()=>{ const r=await requestFriend(el.dataset.uid,el.dataset.name); toast(r.msg); })();
      if(a==='invite-by-uid')return inviteByUid(el.dataset.roomId,el.dataset.uid,el.dataset.name);
      if(a==='open-admin-room'){exitAdmin();return openRoom(rid());}
      if(a==='block')return toggleBlock(u()?.dataset.uid,u()?.dataset.name); if(a==='report-user')return openReport(u()?.dataset.uid,u()?.dataset.name);
      if(a==='report-message')return openReport(el.dataset.senderId,el.dataset.senderName,el.dataset.msg,el.dataset.roomId); if(a==='delete-message')return deleteMessage(el.dataset.msg); if(a==='edit-message')return startEditMessage(el.dataset.msg); if(a==='cancel-edit')return cancelEditMessage(); if(a==='reply-message')return setReply(el.dataset.msg); if(a==='copy-message')return copyMessageText(el.dataset.msg);
      if(a==='open-report')return openReportDetail(el.dataset.id);
      if(a==='warn-by-report')return warnByReport(el.dataset.id,el.dataset.uid,el.dataset.name);
      if(a==='warn-user')return openWarnCountModal(el.dataset.uid,el.dataset.name);
      if(a==='admin-user-detail')return openAdminUserDetail(el.dataset.uid,el.dataset.name);
      if(a==='suspend-by-report')return suspendByReport(el.dataset.id,el.dataset.uid,el.dataset.name);
      if(a==='new-banner')return openRoom(rid()); if(a==='group-chat')return openRoomModal('private'); if(a==='school-settings')return openAdmin('school'); if(a==='reports')return openAdmin('reports'); if(a==='notice')return openAdmin('popup'); if(a==='save-group-map')return saveGroupMap();
      if(a==='calendar')return openCalendar();
      if(a==='cal-prev')return calMove(-1); if(a==='cal-next')return calMove(1);
      if(a==='cal-today'){ calInit(); const t=new Date(); state.calCursor={y:t.getFullYear(),m:t.getMonth()}; state.calSelected=calYmd(t); paintCalendar(); return; }
      if(a==='cal-pick'){ state.calSelected=el.dataset.date||state.calSelected; paintCalendar(); return; }
      if(a==='cal-add')return addCalEvent();
      if(a==='cal-del')return deleteCalEvent(el.dataset.id);
      if(a==='cal-neis')return importNeisSchedule();
      if(a==='cal-reload')return (async()=>{ await loadCalEvents(true); paintCalendar(); })();
      if(a==='chat-groups'){closeAllModals();return openGroupManager();} if(a==='chat-manage')return openChatManager(); if(a==='blocked-users')return openBlockedUsers(); if(a==='open-policies')return openPolicies(); if(a==='view-policy')return viewPolicy(el.dataset.page||el.dataset.id||'');       if(a==='attach-file'){const fi=$('#chatFileInput');if(fi)fi.click();return;}
      if(a==='download-attach')return;
      if(a==='view-attach'){const m=state.messages.find(x=>x.id===el.dataset.msg);if(!m?.attachment) return;const data=attachDataOf(m);if(data){const src=esc(safeImgSrc(data));const href=esc(safeFileHref(data));if(src)openModal(`<h2>${esc(m.attachment.name||'사진')}</h2><img class="attach-view" src="${src}" alt=""><div class="modal-actions"><button class="cancel" data-close-modal>닫기</button>${href?`<a class="confirm" style="text-decoration:none;display:grid;place-items:center" href="${href}" download="${esc(m.attachment.name||'사진')}" data-close-modal>내려받기</a>`:''}</div>`);}else openModal(`<h2>${esc(m.attachment.name||'파일')}</h2><div class="empty-side">파일을 불러오는 중이에요…</div><div data-chunkview="${esc(m.id)}"></div><div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);return;}
      if(a==='mute-room')return toggleRoomMute(el.dataset.roomId||state.room?.id);
      if(a==='room-chat-off')return toggleRoomChatOff(el.dataset.roomId||state.room?.id);
      if(a==='chat-off-all')return toggleChatOffAll();
      if(a==='save-chat-words')return saveChatWords();
      if(a==='timeout-all')return applyTimeoutAll();
      if(a==='timeout-all-clear')return clearTimeoutAll();
      if(a==='timeout-user')return openTimeoutModal(el.dataset.uid,el.dataset.name);
      if(a==='timeout-apply')return applyTimeout(el.dataset.uid,el.dataset.name);
      if(a==='timeout-clear')return clearTimeoutUser(el.dataset.uid,el.dataset.name);
      if(a==='reset-warns')return resetWarns(el.dataset.uid,el.dataset.name);
      if(a==='delete-report')return deleteReport(el.dataset.id);
      if(a==='purge-reports')return purgeReports();
      if(a==='delete-appeal')return deleteAppeal(el.dataset.id);
      if(a==='purge-appeals')return purgeAppeals();
      if(a==='room-scope'){syncRoomDraftInputs();state.roomDraft.visibility=el.dataset.scope==='all'?'all':'private';paintRoomModal('');return;}
      if(a==='room-next'){syncRoomDraftInputs();if(!(state.roomDraft.name||'').trim())return toast('방 이름을 적어 주세요.');state.roomDraft.step=2;paintRoomModal('right');return;}
      if(a==='room-back'){syncRoomDraftInputs();state.roomDraft.step=1;paintRoomModal('left');return;}
      if(a==='room-create')return createRoom();
      if(a==='share-target'){syncRoomDraftInputs();state.roomDraft.targets=el.dataset.target;paintRoomModal('');return;}
      if(a==='share-add-code'){const v=normalizeCode($('#shareCodeInput')?.value||'');if(v.length<4)return toast('코드를 정확히 입력해 주세요.');if(!state.roomDraft.codes.includes(v))state.roomDraft.codes.push(v);paintRoomModal('');return;}
      if(a==='join-policy-set'){state.roomDraft.joinPolicy=el.dataset.value==='open'?'open':'approve';paintRoomModal('');return;}
      if(a==='room-icon')return openRoomIconModal(el.dataset.roomId||state.room?.id);
      if(a==='room-emoji')return saveRoomIcon(el.dataset.roomId||state.room?.id,{icon:el.dataset.emoji,iconPhoto:''});
      if(a==='room-icon-photo'){const fi=$('#roomIconFile');if(fi)fi.click();return;}
      if(a==='room-icon-reset')return saveRoomIcon(state.room?.id,{icon:'',iconPhoto:''});
      if(a==='copy-join-code')return copyText(el.dataset.code||'', '참가 코드를 복사했어요');
      if(a==='copy-invite-link'){ const c=String(el.dataset.code||'').trim().toUpperCase(); if(!c) return toast('참가 코드가 없는 방이에요.'); let base=''; try{ base=location.origin; }catch(e){} return copyText(`${base}/?join=${c}`, '초대 링크를 복사했어요'); }
      if(a==='join-policy')return toggleJoinPolicy(el.dataset.roomId||state.room?.id);
      if(a==='room-join-code')return openJoinByCodeModal();
      if(a==='join-by-code')return joinByRoomCode($('#joinCodeInput')?.value||'');
      if(a==='join-req-ok')return handleJoinRequest(el.dataset.id,true);
      if(a==='join-req-no')return handleJoinRequest(el.dataset.id,false);
      if(a==='my-share-requests')return openMyShareRequests();
      if(a==='share-req-cancel')return cancelShareRequest(el.dataset.id);
      if(a==='share-approve')return handleShareRequest(el.dataset.id,true);
      if(a==='share-reject')return handleShareRequest(el.dataset.id,false);
      if(a==='cm-select-all'){state.cmSel=new Set((state.rooms||[]).map(r=>r.id));renderChatManagerRooms();return;}
      if(a==='cm-select-none'){state.cmSel=new Set();renderChatManagerRooms();return;}
      if(a==='leave-selected'){const sel=state.cmSel||new Set();const list=(state.rooms||[]).filter(r=>sel.has(r.id));if(!list.length)return toast('나갈 채팅방을 먼저 골라 주세요.');return confirmModal(`채팅방 ${list.length}개에서 나갈까요?`,'다시 초대받으면 들어올 수 있어요.',()=>leaveManyRooms(list));}
      if(a==='room-pin')return togglePinRoom(el.dataset.roomId);
      if(a==='admin-pin-room')return toggleAdminPinRoom(el.dataset.roomId);
      if(a==='cat-toggle')return toggleCatCollapse(el.dataset.group);
      if(a==='group-add')return groupAdd(); if(a==='group-del')return groupDelete(Number(el.dataset.i)); if(a==='group-up')return groupMove(Number(el.dataset.i),-1); if(a==='group-down')return groupMove(Number(el.dataset.i),1);
      if(a==='resolve-report')return resolveReport(el.dataset.id); if(a==='read-notice')return readNotice(el.dataset.id);
      if(a==='license-issue')return openLicenseIssueModal(); if(a==='license-buy')return openLicenseBuyModal();
      if(a==='license-days-plus')return adjustSchoolLicense(1); if(a==='license-days-minus')return adjustSchoolLicense(-1);
      if(a==='sched-add')return addScheduled(); if(a==='sched-cancel')return cancelScheduled(el.dataset.id);
      if(a==='license-tab'){ state.licenseFilter=el.dataset.filter||'all'; paintLicenseList(); return; }
      if(a==='license-revoke')return openDangerConfirm({ title:'이 이용권을 회수할까요?', desc:'학교 권한도 함께 회수돼요. 돈과 연결된 작업이라 5초 뒤에 진행할 수 있어요.', requireText:'', seconds:5, confirmLabel:'회수하기', onConfirm:()=>forceRevokeLicense(el.dataset.code) });
      if(a==='license-delete')return openDangerConfirm({ title:'이용권을 목록에서 지울까요?', desc:'회수·만료된 이용권만 지울 수 있어요. 코드는 복구되지 않아요.', requireText:'이용권을 삭제합니다.', seconds:5, confirmLabel:'삭제하기', onConfirm:()=>deleteLicense(el.dataset.code) });
      if(a==='license-select-all'){ state.licenseSel=new Set((state.licenseCache||[]).filter(l=>['refunded','revoked','expired'].includes(l.status)).map(l=>l.id||l.code)); paintLicenseList(); return; }
      if(a==='license-select-none'){ state.licenseSel=new Set(); paintLicenseList(); return; }
      if(a==='license-toggle'){ if(!(state.licenseSel instanceof Set)) state.licenseSel=new Set(); if(el.checked) state.licenseSel.add(el.dataset.code); else state.licenseSel.delete(el.dataset.code); return; }
      if(a==='license-delete-selected'){ const sel=[...(state.licenseSel||new Set())]; if(!sel.length) return toast('지울 이용권을 먼저 골라 주세요.'); return openDangerConfirm({ title:`이용권 ${sel.length}개를 지울까요?`, desc:'회수·만료된 이용권만 지워져요. 자동 삭제는 never, 직접 고른 것만 지워요.', requireText:'이용권을 삭제합니다.', seconds:5, confirmLabel:'일괄 삭제', onConfirm:()=>deleteLicenses(sel) }); }
      if(a==='refund-request')return openRefundRequestModal($('#rdCode')?.value||'');
      if(a==='refund-check')return checkRefundCode(el.dataset.code, el.dataset.id);
      if(a==='refund-done')return markRefundDone(el.dataset.id);
      if(a==='refund-delete')return openDangerConfirm({ title:'환불 요청을 지울까요?', desc:'목록에서만 지워져요. 이용권 자체는 그대로 남아요.', requireText:'환불 요청을 삭제합니다.', seconds:5, confirmLabel:'삭제하기', onConfirm:()=>deleteRefund(el.dataset.id) });
      if(a==='refund-select-all'){ const ids=[...(document.querySelectorAll('#refundList [data-refund-check]')||[])].map(x=>x.dataset.refundCheck); state.refundSel=new Set(ids); paintRefundList(); return; }
      if(a==='refund-select-none'){ state.refundSel=new Set(); paintRefundList(); return; }
      if(a==='refund-toggle'){ if(!(state.refundSel instanceof Set)) state.refundSel=new Set(); if(el.checked) state.refundSel.add(el.dataset.id); else state.refundSel.delete(el.dataset.id); return; }
      if(a==='refund-delete-selected'){ const sel=[...(state.refundSel||new Set())]; if(!sel.length) return toast('지울 요청을 먼저 골라 주세요.'); return openDangerConfirm({ title:`환불 요청 ${sel.length}개를 지울까요?`, desc:'목록에서만 지워져요.', requireText:'환불 요청을 삭제합니다.', seconds:5, confirmLabel:'일괄 삭제', onConfirm:()=>deleteRefunds(sel) }); }
      if(a==='ext-link'){ e.preventDefault(); return openExternalLinkConfirm(el.dataset.url||''); }
      if(a==='go-license-renew'){ closeDrawer(); return openAdmin('license'); }
      if(a==='banner-prev')return bannerPageMove(-1); if(a==='banner-next')return bannerPageMove(1);
      if(a==='banner-collapse')return setBannerCollapsed(true); if(a==='banner-expand')return setBannerCollapsed(false);
      if(a==='unread-summary-go'){ const nid=Object.keys(state.unread||{})[0]; if(nid) openRoom(nid); return; }
      if(a==='open-palette'){ try{ openCmdPalette(); }catch(e){} return; }
      if(a==='close-room-settings')return closeRoomSettings();
      if(a==='side-toggle')return toggleSideCollapse(el.dataset.side||el.dataset.sidekey||'');
      if(a==='toggle-pw'){
        const btn=el;
        const inp=btn.parentElement?.querySelector('input');
        if(inp){
          inp.type = inp.type==='password' ? 'text' : 'password';
          btn.textContent = inp.type==='password' ? '👁' : '🙈';
        }
        return;
      }
      if(a==='save-settings'){
        (async()=>{
          const form=document.getElementById('settingsPanel');
          // settingsPanel 안의 값들을 수집해 저장 (기존 saveSettings 로직을 재사용)
          // 폰트, 테마 등은 이미 state에 반영되어 있으므로 추가 저장만
          const p = form;
          // 키워드, 초대정책 등은 p에서 찾음
          const keywords = (p.querySelector('textarea[name="keywords"]')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,10);
          state.settings.keywords=keywords;
          // 다른 설정들은 이미 state에 반영 (fontSize, theme, notify 등)
          // 저장
          const ok = await (async()=>{
            try{
              const pm = p.querySelector('[data-selected="invitePolicy"]')?.dataset.value || state.settings.invitePolicy;
              const pres = p.querySelector('[data-selected="presenceMode"]')?.dataset.value || state.settings.presenceMode;
              const side = p.querySelector('[data-selected="sideLayout"]')?.dataset.value || state.settings.sideLayout;
              state.settings.invitePolicy=pm;
              state.settings.presenceMode=pres;
              state.settings.sideLayout=side;
              // 폰트 등은 이미 state에 있음
              const s={...state.profile?.settings||{}, fontSize:state.settings.fontSize, theme:currentTheme(), invitePolicy:pm, presenceMode:pres, sideLayout:side, keywords, roomGroups:state.settings.roomGroups||{}, collapsedGroups:state.settings.collapsedGroups||[], collapsedSideSections:state.settings.collapsedSideSections||[]};
              await db.collection('users').doc(uid()).update({settings:s, invitePolicy:pm, updatedAt:ts()});
              await db.collection('userPrivate').doc(uid()).set({keywords, updatedAt:ts()}, {merge:true});
              if(state.profile) state.profile.settings=s;
              try{ await hapticSuccess(); }catch(e){} toast('설정을 저장했어요.');
              return true;
            }catch(e){ console.error(e); toast(errText(e)); return false; }
          })();
          if(ok) closeSettings();
        })(); return;
      }
      if(a==='save-lock'){
        (async()=>{
          const pw=document.getElementById('lockPwInput')?.value||'';
          const cp=document.getElementById('lockPwConfirm')?.value||'';
          const msg=document.getElementById('lockMsg');
          if(!pw||pw.length<4){ if(msg){msg.textContent='비밀번호는 4자 이상으로 해주세요.';msg.className='reset-msg warn';} return; }
          if(pw!==cp){ if(msg){msg.textContent='확인이 달라요.';msg.className='reset-msg warn';} return; }
          await setAppLock(pw);
          if(msg){msg.textContent='앱 잠금을 설정했어요. 이 기기에서만 잠겨요.';msg.className='reset-msg ok';}
          toast('앱 잠금을 켰어요. 이 기기에서만 잠겨요.');
        })(); return;
      }
      if(a==='disable-lock'){ disableAppLock(); const msg=document.getElementById('lockMsg'); if(msg){msg.textContent='앱 잠금을 해제했어요.';msg.className='reset-msg ok';} const tg=document.getElementById('lockEnableToggle'); if(tg) tg.checked=false; const f=document.getElementById('lockPwField'); if(f) f.style.display='none'; toast('앱 잠금을 해제했어요.'); return; }
      if(a==='todos-go'){
        // 첫 미완료 할 일이 있는 방을 찾아 열어준다
        (async()=>{
          for(const r of (state.rooms||[])){
            try{
              const qs=await db.collection('channels').doc(r.id).collection('todos').where('done','==',false).limit(1).get();
              if(!qs.empty){ closeDrawer(); return openTodosModal(r.id); }
            }catch(e){}
          }
          toast('남은 할 일이 없어요.');
        })(); return;
      }
      if(a==='suggest-go'){ closeDrawer(); return openAdmin('suggest'); }
      if(a==='teachers-go'){ closeDrawer(); return openAdmin('teachers'); }
      if(a==='self-school-change')return openSelfSchoolChange();
      if(a==='teacher-request')return openTeacherRequest();
      if(a==='suggest-box')return openSuggestBox();
      if(a==='suggest-next')return suggestNoticeNext();
      if(a==='suggest-filter'){ state.suggestFilter=el.dataset.f||'open'; return paintSuggestList(state.suggestFilter); }
      if(a==='suggest-view')return viewSuggestion(el.dataset.id);
      if(a==='suggest-flag')return flagSuggestion(el.dataset.id);
      if(a==='suggest-resolve')return resolveSuggestion(el.dataset.id);
      if(a==='suggest-delete')return deleteSuggestion(el.dataset.id);
      if(a==='suggest-hold')return toggleSuggestHold(el.dataset.id);
      if(a==='suggest-assign')return openSuggestAssign();
      if(a==='suggest-assign-pick')return assignSuggestHandler(el.dataset.uid,el.dataset.name);
      if(a==='suggest-assign-clear')return assignSuggestHandler('','');
      if(a==='tr-tab'){ $$('.tabs .tab').forEach(x=>x.classList.toggle('active',x===el)); $('#trCert')?.classList.toggle('hidden',el.dataset.tab!=='cert'); $('#trEmail')?.classList.toggle('hidden',el.dataset.tab!=='email'); return; }
      if(a==='tr-cert-pick'){ $('#trCertFile')?.click(); return; }
      if(a==='tr-cert-send')return submitTeacherCert();
      if(a==='tr-email-send')return sendEduLink();
      if(a==='tr-email-submit')return submitTeacherEmail();
      if(a==='teacher-req-view')return viewTeacherCert(el.dataset.uid);
      if(a==='teacher-approve')return approveTeacher(el.dataset.uid,el.dataset.name);
      if(a==='teacher-reject')return rejectTeacher(el.dataset.uid,el.dataset.name);
      if(a==='copy-license')return copyText(`${el.dataset.code||''} / ${el.dataset.auth||''}`, '이용권 코드를 복사했어요');
      if(a==='close-modal')return closeModal(); if(a==='save-setup')return saveSetup(); if(a==='save-photo'||a==='upload-photo')return chooseProfilePhoto(); if(a==='remove-photo')return removeProfilePhoto();
      return;
    }
    const closeBtn=e.target.closest('[data-close-modal]'); if(closeBtn)return closeModal();
    const tab=e.target.closest('[data-tab]'); if(tab&&$('#adminPanel')){renderAdminPanel(tab.dataset.tab);$$('.tab',tab.closest('.overlay')||document).forEach(x=>x.classList.toggle('active',x===tab));setTimeout(()=>{ try{ const t=tab.closest('.admin-tabs')||document.querySelector('.admin-tabs'); if(t) updateTabsIndicator(t); }catch(e){} },30);return;}
    if(e.target.matches('.select-option'))return;
    const swAct=e.target.closest('[data-swipe-act]'); if(swAct){ const wrap=swAct.closest('[data-room-id]'); const rid2=wrap?.dataset.roomId; if(!rid2) return; const k=swAct.dataset.swipeAct; closeRoomSwipe(); if(k==='mute') return toggleRoomMute(rid2); if(k==='manage'){ closeAllModals(); return openRoomManage(rid2); } if(k==='leave') return leaveRoom(rid2); return; }
    const room=e.target.closest('[data-room-id]'); if(room){ if(state.suppressRoomClick) return; return openRoom(room.dataset.roomId); }
  }

  const modalStack = [];
  const MODAL_ANIM_MS = 220;
  // 제목(h2)·부제목(.desc)·닫기(X)를 한 덩어리로 묶어 팝업 상단에 고정한다
  function wrapModalHead(panel, addClose){
    try{
      if(!panel || panel.querySelector(':scope > .modal-head')) return;
      if(addClose && !panel.querySelector(':scope > .modal-close')){
        const xc=document.createElement('button');
        xc.type='button'; xc.className='modal-close'; xc.setAttribute('data-close-modal',''); xc.setAttribute('aria-label','닫기'); xc.textContent='✕';
        panel.insertBefore(xc,panel.firstChild);
      }
      const h2=panel.querySelector(':scope > h2');
      if(!h2) return;
      const head=document.createElement('div'); head.className='modal-head';
      const text=document.createElement('div'); text.className='modal-head-text';
      panel.insertBefore(head,panel.firstChild);
      text.appendChild(h2);
      head.appendChild(text);
      const x=panel.querySelector(':scope > .modal-close');
      if(x) head.appendChild(x);
      const d=head.nextSibling;
      if(d&&d.nodeType===1&&d.classList&&d.classList.contains('desc')) text.appendChild(d);
    }catch(e){}
  }
  function openModal(html, opts){
    closeDropdown();
    const o = typeof opts === 'boolean' ? { small: opts } : (opts || {});
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="modal ${o.small?'small':''}">${o.dismissible===false?'':'<button type="button" class="modal-close" data-close-modal aria-label="닫기">✕</button>'}${html}</div>`;
    const panel = el.firstElementChild;
    wrapModalHead(panel);
    if (o.dismissible !== false) {
      let downOnBack = false;
      el.addEventListener('pointerdown', e => { downOnBack = e.target === el; });
      el.addEventListener('click', e => { if (downOnBack && e.target === el) dismissModal(); downOnBack = false; });
    }
    modalRoot.appendChild(el);
    requestAnimationFrame(()=>{ el.classList.add('show'); });
    modalStack.push({ el, dismissible: o.dismissible !== false });
    return panel;
  }
  function popModal(animate=true){
    const top = modalStack.pop(); if (!top) return;
    // 사진 미리보기용 임시 주소는 어떤 방식으로 닫혀도(닫기·바깥클릭·전체닫기) 정리한다
    if(state.attachDraft){
      try{ if(state.attachDraft.url) URL.revokeObjectURL(state.attachDraft.url); }catch(e){}
      state.attachDraft=null;
    }
    const el = top.el;
    if (!animate || !el.isConnected) { el.remove(); return; }
    el.classList.remove('show');
    el.classList.add('closing');
    setTimeout(()=>el.remove(), MODAL_ANIM_MS);
  }
  function closeModal(){ closeDropdown(); popModal(); }
  function dismissModal(){ closeDropdown(); const top = modalStack[modalStack.length-1]; if (!top || top.dismissible === false) return; popModal(); }
  function closeAllModals(){ closeDropdown(); while (modalStack.length) popModal(); }
  function confirmModal(title,desc,onConfirm){
    const panel=openModal(`<h2>${esc(title)}</h2><p class="desc">${esc(desc)}</p><div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" id="confirmBtn">확인</button></div>`,{small:true});
    panel.querySelector('#confirmBtn').onclick=async()=>{try{await onConfirm();closeModal();}catch(e){console.error(e);toast(errText(e));}};
  }

  function openProfile(){
    const p=state.profile;
    state.profileDraft={ avatarEmoji:p.avatarEmoji||'', avatarColor:safeColor(p.avatarColor) };
    const classFields = p.role==='student'
      ? `<div class="field"><label>학년</label><div class="custom-select"><button type="button" class="select-button" data-select-open="profileGrade"><span data-selected="profileGrade" data-value="${esc(p.grade||'')}">${p.grade?`${p.grade}학년`:'골라 주세요'}</span><span>⌄</span></button></div></div><div class="field"><label>반</label><div class="custom-select"><button type="button" class="select-button" data-select-open="profileClass"><span data-selected="profileClass" data-value="${esc(p.classNum||'')}">${p.classNum?`${p.classNum}반`:'골라 주세요'}</span><span>⌄</span></button></div></div>`
      : '';
    const emojiButtons=AVATAR_EMOJIS.map(e=>`<button type="button" class="avatar-opt ${state.profileDraft.avatarEmoji===e?'on':''}" data-action="profile-emoji" data-emoji="${esc(e)}">${e?esc(e):esc((p.displayName||'?').trim().charAt(0)||'?')}</button>`).join('');
    const colorButtons=AVATAR_COLORS.map(c=>`<button type="button" class="color-opt ${state.profileDraft.avatarColor===c?'on':''}" data-action="profile-color" data-color="${esc(c)}" style="background:${c||'#eef2f6'}"></button>`).join('');
    openModal(`<h2>프로필</h2><p class="desc">닉네임과 학급 정보, 나만의 프로필을 꾸밀 수 있어요.</p><form id="profileForm">
      <div class="user-head"><div id="profileAvatarPreview">${avatarHtml(p,'large')}</div><div class="grow"><strong style="font-size:16px">${esc(p.displayName||'사용자')}</strong><div class="profile-meta">${gradeClassPrefix(p)}${roleLabel(p.role)}</div>${roleChipsHtml(uid())}<div class="presence-row"><span class="presence-dot inline ${myPresenceState()||'hidden'}" data-my-presence-dot aria-hidden="true"></span><button type="button" class="presence-menu-btn" data-action="presence-menu" aria-haspopup="menu" aria-label="접속 상태 변경"><span class="presence-text" data-my-presence-label>${esc(myPresenceLabel())}</span><span class="presence-caret" aria-hidden="true">⌄</span></button></div></div></div>
      <div class="code-row"><div class="grow"><div class="code-label">내 초대 코드</div><div class="code-value" data-my-code>${esc(p.userCode||'준비 중')}</div></div><button type="button" class="soft-btn" data-action="copy-code">복사</button></div>
      <p class="desc" style="margin:8px 0 16px;font-size:12px">친구가 이 코드를 입력하면 나를 채팅방에 초대할 수 있어요. 자유롭게 알려 주세요.</p>
      <div class="field"><label>닉네임</label><input class="input" name="displayName" value="${esc(p.displayName)}" maxlength="20" required></div>
      ${classFields}
      <div class="field"><label>자기소개</label><textarea class="input" name="bio" maxlength="80" style="min-height:76px" placeholder="예: 축구 좋아해요. 모둠방에서 만나요!">${esc(p.bio||'')}</textarea></div>
      <div class="field"><label>프로필 사진</label><div class="photo-row"><div id="photoPreview" class="photo-preview">${p.photoURL?`<img src="${esc(p.photoURL)}" alt="">`:'<span>사진 없음</span>'}</div><div class="grow"><input type="file" id="avatarFileInput" accept="image/*" hidden><button type="button" class="soft-btn" style="width:100%" data-action="upload-photo">사진 올리기</button>${p.photoURL?`<button type="button" class="soft-btn" style="width:100%;margin-top:8px" data-action="remove-photo">사진 지우기</button>`:''}</div></div></div>
      <div class="field"><label>프로필 이모지</label><div class="avatar-pick">${emojiButtons}</div></div>
      <div class="field"><label>프로필 색상</label><div class="avatar-pick">${colorButtons}</div></div>
      <div class="divider"></div>
      <div class="setting-row"><div class="setting-label"><strong style="color:var(--danger)">🗑️ 회원 탈퇴</strong><span>계정과 내 정보를 지워요. 되돌릴 수 없어요 — 프로필에서 바로 할 수 있어요.</span></div><button type="button" class="soft-btn" style="flex:0 0 100px;color:var(--danger)" data-action="delete-account">탈퇴하기</button></div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button class="confirm">저장하기</button></div></form>`);
    const gb=$('[data-select-open="profileGrade"]'); if(gb){wireDropdown(gb,state.school.grades.map(g=>({value:g,label:`${g}학년`})),(v,l)=>{gb.querySelector('[data-selected]').textContent=l;gb.querySelector('[data-selected]').dataset.value=v; const cb=$('[data-select-open="profileClass"]'); const cs=$('[data-selected="profileClass"]'); if(cs){cs.textContent='반을 골라 주세요';cs.dataset.value='';} if(cb){wireDropdown(cb,Array.from({length:Number(state.school.classCounts?.[v]||0)},(_,i)=>({value:i+1,label:`${i+1}반`})),(cv,cl)=>{cb.querySelector('[data-selected]').textContent=cl;cb.querySelector('[data-selected]').dataset.value=cv;});}});}
    const cb=$('[data-select-open="profileClass"]');if(cb && p.grade)wireDropdown(cb,Array.from({length:Number(state.school.classCounts?.[p.grade]||0)},(_,i)=>({value:i+1,label:`${i+1}반`})),(v,l)=>{cb.querySelector('[data-selected]').textContent=l;cb.querySelector('[data-selected]').dataset.value=v;});
  }
  function renderProfilePreview(){
    const host=$('#profileAvatarPreview'); if(!host) return;
    const name=$('#profileForm')?.displayName?.value || state.profile?.displayName || '?';
    host.innerHTML=avatarHtml({displayName:name,avatarEmoji:state.profileDraft?.avatarEmoji,avatarColor:state.profileDraft?.avatarColor},'large');
  }
  function pickProfileEmoji(emoji){
    if(!state.profileDraft) return;
    state.profileDraft.avatarEmoji=emoji||'';
    const form=$('#profileForm'); if(!form) return;
    form.querySelectorAll('[data-action="profile-emoji"]').forEach(b=>b.classList.toggle('on',(b.dataset.emoji||'')===state.profileDraft.avatarEmoji));
    renderProfilePreview();
  }
  function pickProfileColor(color){
    if(!state.profileDraft) return;
    state.profileDraft.avatarColor=safeColor(color);
    const form=$('#profileForm'); if(!form) return;
    form.querySelectorAll('[data-action="profile-color"]').forEach(b=>b.classList.toggle('on',(b.dataset.color||'')===state.profileDraft.avatarColor));
    renderProfilePreview();
  }
  async function openUserProfile(id, name){
    if(!id) return;
    if(id===uid()) return openProfile();
    let p=state.profileCache.get(id) || null;
    if(!p){ try{ const s=await db.collection('publicProfiles').doc(id).get(); p=s.exists?s.data():null; }catch(e){ console.error(e); } }
    p=p || {displayName:name||'사용자'};
    state.profileCache.set(id,p);
    const blocked=(state.profile?.blockedUsers||[]).includes(id);
    const isFr=isFriend(id), sentReq=mySentRequestTo(id), inReq=friendRequestFrom(id);
    const dispName=p.displayName||name||'사용자';
    const friendBtn = isFr
      ? `<button class="cancel" data-action="friend-remove" data-uid="${esc(id)}">친구 끊기</button>`
      : inReq
        ? `<button class="confirm" data-action="friend-accept" data-id="${esc(inReq.id)}">친구 수락</button>`
        : sentReq
          ? `<button class="cancel" disabled>요청 보냄</button>`
          : `<button class="confirm" data-action="friend-add-uid" data-uid="${esc(id)}" data-name="${esc(dispName)}">친구 추가</button>`;
    let adminInfo=null, privInfo=null;
    if(isAdmin()){
      try{ const s=await db.collection('users').doc(id).get(); adminInfo=s.exists?s.data():null; }catch(e){ console.error(e); }
      try{ const ps=await db.collection('userPrivate').doc(id).get(); privInfo=ps.exists?ps.data():null; }catch(e){ console.warn('priv',e); }
    }
    // 학교 관리자도 우리 학교 학생·교사에게는 타임아웃·제거·권한 변경을 할 수 있다
    let schoolInfo=null;
    if(isSchoolAdmin() && !isAdmin() && id!==uid()){
      try{ const s=await db.collection('users').doc(id).get(); if(s.exists) schoolInfo=s.data(); }catch(e){ console.error(e); }
    }
    const sameSchoolMember = schoolInfo && !schoolInfo.deleted
      && (schoolInfo.schoolId||'')===(state.profile?.schoolId||'') && (schoolInfo.schoolId||'')!==''
      && ['student','teacher'].includes(schoolInfo.role||'student');
    const schoolRows=sameSchoolMember?`<div class="admin-card" style="margin:14px 0 0;padding:14px"><h3 style="font-size:14px">구성원 관리 (우리 학교)</h3>
      <div class="admin-meta"><span class="admin-chip">${esc(roleLabel(schoolInfo.role))}</span><span class="admin-chip">${esc(schoolInfo.email||'')}</span></div>
      <div class="admin-btns"><button type="button" class="soft-btn" data-action="timeout-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">타임아웃</button><button type="button" class="soft-btn" data-action="school-remove" data-uid="${esc(id)}" data-name="${esc(dispName)}">학교에서 제거</button></div>
      <div class="admin-btns"><button type="button" class="soft-btn" data-action="school-role" data-uid="${esc(id)}" data-name="${esc(dispName)}" data-role="${esc(schoolInfo.role||'student')}">권한 변경</button></div>
    </div>`:'';
    const _lip=(privInfo&&privInfo.lastLoginIp)||(adminInfo&&adminInfo.lastLoginIp)||'';
    const _sip=(privInfo&&privInfo.signupIp)||(adminInfo&&adminInfo.signupIp)||'';
    const _ua=(privInfo&&privInfo.lastUserAgent)||(adminInfo&&adminInfo.lastUserAgent)||'';
    const infoRows=adminInfo?`<div class="admin-card" style="margin:14px 0 0;padding:14px"><h3 style="font-size:14px">접속 정보 (관리자만 볼 수 있어요)</h3>
      <div class="admin-meta"><span class="admin-chip">학교 ${esc(adminInfo.schoolName||'미지정')}</span><span class="admin-chip">마지막 로그인 ${esc(fmtDateTime(adminInfo.lastLoginAt))}</span><span class="admin-chip">IP ${esc(_lip||'기록 없음')}</span><span class="admin-chip">로그인 ${Number(adminInfo.loginCount||0)}회</span><span class="admin-chip">가입 IP ${esc(_sip||'기록 없음')}</span><span class="admin-chip">가입일 ${esc(fmtDateTime(adminInfo.createdAt))}</span><span class="admin-chip ${Number(adminInfo.warnCount||0)>0?'warn':''}">경고 ${Number(adminInfo.warnCount||0)}회</span></div>
      ${_ua?`<p class="desc" style="margin:10px 0 0;font-size:11px;word-break:break-all">${esc(String(_ua).slice(0,200))}</p>`:''}
      <div class="admin-btns"><button type="button" class="soft-btn" data-action="admin-set-school" data-uid="${esc(id)}" data-name="${esc(dispName)}">학교 변경</button><button type="button" class="soft-btn" data-action="admin-class" data-uid="${esc(id)}" data-name="${esc(dispName)}">학급·반 변경</button></div>
      <div class="admin-btns"><button type="button" class="soft-btn" data-action="warn-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">경고 주기</button><button type="button" class="soft-btn" data-action="admin-user-detail" data-uid="${esc(id)}" data-name="${esc(dispName)}">상세 설정으로</button></div>
      <div class="admin-btns"><button type="button" class="soft-btn" data-action="timeout-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">채팅 타임아웃</button>${Number(adminInfo.warnCount||0)>0?`<button type="button" class="soft-btn" data-action="reset-warns" data-uid="${esc(id)}" data-name="${esc(dispName)}">경고 지우기</button>`:''}</div>
      ${adminInfo.suspended
        ? `<div class="form-error" style="margin:10px 0 0">지금 이용이 정지된 계정이에요. 사유: ${esc(adminInfo.suspendReason||'적혀 있지 않아요.')}</div><button type="button" class="soft-btn" style="width:100%;margin-top:8px" data-action="unsuspend-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">이용 정지 풀기</button>`
        : `<button type="button" class="danger-btn" style="width:100%;margin-top:8px;height:38px;border-radius:13px;font-size:13px" data-action="suspend-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">이용 정지</button>`}
    </div>`:'';
    openModal(`<h2>프로필</h2><div class="user-head">${avatarHtml(p,'large',true)}<div class="grow"><strong style="font-size:17px">${esc(dispName)}</strong><div class="profile-meta">${gradeClassPrefix(p)}${roleLabel(p.role)}</div>${roleChipsHtml(id)}${presenceStateOf(p)?`<div class="presence-row static"><span class="presence-dot inline ${presenceStateOf(p)}" aria-hidden="true"></span><span class="presence-text">${esc(presenceLabel(presenceStateOf(p)))}</span></div>`:''}</div></div>${p.photoFlagged?'<p class="photo-caution">이 프로필 사진은 자동 검사에서 주의가 필요한 사진으로 확인됐어요.</p>':''}${p.bio?`<p class="bio-text">${esc(p.bio)}</p>`:'<p class="desc">아직 자기소개가 없어요.</p>'}${infoRows}${schoolRows}<div class="modal-actions" style="flex-wrap:wrap">${friendBtn}<button class="soft-btn" data-action="dm-uid" data-uid="${esc(id)}" data-name="${esc(dispName)}">1:1 대화</button><button class="cancel" data-action="block" data-uid="${esc(id)}" data-name="${esc(dispName)}">${blocked?'차단 해제':'차단'}</button><button class="cancel" data-action="report-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">신고</button><button class="confirm" data-close-modal>닫기</button></div>`);
  }
  async function saveProfile(f){
    const displayName=f.displayName.value.trim(); if(!displayName)return toast('닉네임을 적어 주세요.');
    const patch={displayName,bio:(f.bio?.value||'').trim().slice(0,80),avatarEmoji:state.profileDraft?.avatarEmoji||'',avatarColor:state.profileDraft?.avatarColor||'',updatedAt:ts()};
    if(state.profile.role==='student'){patch.grade=Number(f.querySelector('[data-selected="profileGrade"]')?.dataset.value||state.profile.grade||0)||null;patch.classNum=Number(f.querySelector('[data-selected="profileClass"]')?.dataset.value||state.profile.classNum||0)||null;}
    try{ await db.collection('users').doc(uid()).update(patch); }catch(e){ console.error(e); return toast(errText(e)); }
    try{ await putPublicProfile({...patch,invitePolicy:state.profile.invitePolicy||'ask'}); }catch(e){ console.error(e); }
    state.profile={...state.profile,...patch};state.profileCache.set(uid(),state.profile);state.profileDraft=null;closeModal();renderSidebar();renderMessages(false);toast('프로필을 저장했어요.');
  }
  function chooseProfilePhoto(){const fi=$('#avatarFileInput');if(fi)fi.click();}
  async function compressAvatar(file,size=256,maxBytes=90*1024){
    const raw=await readAsDataUrl(file);
    let img; try{ img=await loadImage(raw); }catch(e){ return ''; }
    const side=Math.min(img.width,img.height)||1;
    const sx=Math.max(0,(img.width-side)/2), sy=Math.max(0,(img.height-side)/2);
    const cv=document.createElement('canvas'); cv.width=size; cv.height=size;
    const ctx=cv.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,size,size);
    ctx.drawImage(img,sx,sy,side,side,0,0,size,size);
    for(const q of [0.85,0.75,0.65,0.5]){
      let out=''; try{ out=cv.toDataURL('image/jpeg',q); }catch(e){ return ''; }
      if(out.length<=maxBytes) return out;
    }
    try{ return cv.toDataURL('image/jpeg',0.4); }catch(e){ return ''; }
  }
  async function setProfilePhoto(file){
    if(!file || !state.profile) return;
    // 3번: 비율 조정(크롭) — 원본을 보여주고 확대/드래그로 맞춘 뒤 저장
    try{ openPhotoCropModal(file); return; }catch(e){}
    toast('사진을 준비하고 있어요...');
    let data='';
    try{ data=await compressAvatar(file); }catch(e){ console.error(e); }
    if(!data) return toast('사진을 처리하지 못했어요. 다른 사진으로 다시 시도해 주세요.');
    toast('사진을 살펴보는 중이에요...');
    const risk=await analyzeImageSrc(data);
    if(risk.checked && risk.risk){ showProfilePhotoRiskModal(data,risk); return; }
    await saveProfilePhotoData(data,false,risk);
  }
  // 3번 크롭 모달: 미리보기 원형 안에 들어가게 확대율(1~3) + 드래그로 위치 조정
  function openPhotoCropModal(file){
    readAsDataUrl(file).then(raw=>{
      loadImage(raw).then(img=>{
        state.photoCrop={img,scale:1,ox:0,oy:0};
        openModal(`<h2>프로필 사진 맞추기</h2><p class="desc">드래그로 위치를 옮기고 아래 막대로 크기를 조절해 주세요. 원 안에 들어간 부분만 저장돼요.</p>
          <div class="crop-box" id="cropBox"><img id="cropImg" src="${esc(raw)}" alt=""><div class="crop-mask"></div></div>
          <div class="field"><label>크기 <span id="cropScaleLabel">100%</span></label><input id="cropScale" type="range" min="100" max="300" value="100" style="width:100%"></div>
          <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" data-action="photo-crop-save">이대로 저장</button></div>`,{});
        const box=$('#cropBox'), cimg=$('#cropImg'), range=$('#cropScale'), lab=$('#cropScaleLabel');
        const paint=()=>{ const s=state.photoCrop.scale; cimg.style.transform=`translate(${state.photoCrop.ox}px,${state.photoCrop.oy}px) scale(${s})`; if(lab) lab.textContent=Math.round(s*100)+'%'; };
        paint();
        range?.addEventListener('input',()=>{ state.photoCrop.scale=Number(range.value)/100; // 확대하면 이미지가 박스를 벗어나지 않게 오프셋 제한
          const lim=80*(state.photoCrop.scale-1); state.photoCrop.ox=Math.max(-lim,Math.min(lim,state.photoCrop.ox)); state.photoCrop.oy=Math.max(-lim,Math.min(lim,state.photoCrop.oy)); paint(); });
        let drag=null;
        box?.addEventListener('pointerdown',e=>{ drag={x:e.clientX-ox(),y:e.clientY-oy()}; box.setPointerCapture(e.pointerId); });
        const ox=()=>state.photoCrop.ox, oy=()=>state.photoCrop.oy;
        box?.addEventListener('pointermove',e=>{ if(!drag) return; const lim=80*(state.photoCrop.scale-1)+40; state.photoCrop.ox=Math.max(-lim,Math.min(lim,e.clientX-drag.x)); state.photoCrop.oy=Math.max(-lim,Math.min(lim,e.clientY-drag.y)); paint(); });
        box?.addEventListener('pointerup',()=>{ drag=null; });
        box?.addEventListener('pointercancel',()=>{ drag=null; });
      }).catch(()=>toast('사진을 읽지 못했어요.'));
    }).catch(()=>toast('사진을 읽지 못했어요.'));
  }
  async function savePhotoCrop(){
    const c=state.photoCrop; if(!c?.img) return;
    try{
      const size=256, cv=document.createElement('canvas'); cv.width=size; cv.height=size;
      const ctx=cv.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,size,size);
      // 박스(240px) 기준 변환을 256 캔버스로 환산
      const boxSize=240, k=size/boxSize;
      const iw=c.img.width, ih=c.img.height;
      const base=Math.max(boxSize/iw,boxSize/ih);
      const dw=iw*base*c.scale*k, dh=ih*base*c.scale*k;
      const dx=(size-dw)/2 + c.ox*k, dy=(size-dh)/2 + c.oy*k;
      ctx.drawImage(c.img,dx,dy,dw,dh);
      let data='';
      for(const q of [0.85,0.75,0.65,0.5]){ try{ data=cv.toDataURL('image/jpeg',q); }catch(e){ data=''; } if(data&&data.length<=90*1024) break; }
      if(!data) try{ data=cv.toDataURL('image/jpeg',0.4); }catch(e){}
      if(!data) return toast('사진을 처리하지 못했어요.');
      closeModal();
      state.photoCrop=null;
      toast('사진을 살펴보는 중이에요...');
      const risk=await analyzeImageSrc(data);
      if(risk.checked&&risk.risk){ showProfilePhotoRiskModal(data,risk); return; }
      await saveProfilePhotoData(data,false,risk);
    }catch(e){ console.error(e); toast('사진을 처리하지 못했어요.'); }
  }
  function showProfilePhotoRiskModal(data,risk){
    state.photoDraft={data,risk};
    openModal(`<h2>주의가 필요한 사진일 수 있어요</h2><div class="notice-ico warn" aria-hidden="true"><span>!</span></div>
      <p class="desc">자동 검사 결과 <b>${esc(risk.label||'부적절한 내용')}</b> 가능성이 확인됐어요. 그래도 사용하면 프로필에 <b>주의 필요</b> 표시가 함께 보여요.</p>
      <img class="attach-view" src="${esc(data)}" alt="프로필 사진 미리보기">
      <div class="warn-box">부적절한 이미지를 여러 번 올릴 시 계정이 정지될 수 있어요.</div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>사용하지 않기</button><button type="button" class="danger-btn" data-action="save-risky-photo">그래도 사용하기</button></div>`);
  }
  async function saveProfilePhotoData(data,flagged,risk){
    state.photoDraft=null;
    try{
      await db.collection('users').doc(uid()).update({photoURL:data,updatedAt:ts()});
      await putPublicProfile({photoURL:data,photoFlagged:!!flagged});
    }catch(e){ console.error(e); return toast(errText(e)); }
    state.profile.photoURL=data; state.profile.photoFlagged=!!flagged;
    const cached={...(state.profileCache.get(uid())||{})}; cached.photoURL=data; cached.photoFlagged=!!flagged; state.profileCache.set(uid(),cached);
    const pv=$('#photoPreview'); if(pv) pv.innerHTML=`<img src="${esc(data)}" alt="">`;
    const prev=$('#profileAvatarPreview'); if(prev) prev.innerHTML=avatarHtml({...state.profile,photoURL:data,photoFlagged:!!flagged},'large');
    const rm=document.querySelector('[data-action="remove-photo"]');
    if(!rm){ const host=$('[data-action="upload-photo"]')?.parentNode; if(host) host.insertAdjacentHTML('beforeend','<button type="button" class="soft-btn" style="width:100%;margin-top:8px" data-action="remove-photo">사진 지우기</button>'); }
    if(flagged) await logImageFlag('profile-image',risk,'프로필 사진');
    renderSidebar(); renderMessages(false);
    toast(flagged?'주의가 필요한 사진으로 표시해 저장했어요.':'프로필 사진을 바꿨어요.');
  }
  async function removeProfilePhoto(){
    if(!state.profile) return;
    confirmModal('프로필 사진을 지울까요?','이모지와 색상으로 다시 보여요.',async()=>{
      try{
        await db.collection('users').doc(uid()).update({photoURL:'',updatedAt:ts()});
        await putPublicProfile({photoURL:'',photoFlagged:false});
      }catch(e){ console.error(e); return toast(errText(e)); }
      state.profile.photoURL=''; state.profile.photoFlagged=false;
      const cached={...(state.profileCache.get(uid())||{})}; cached.photoURL=''; cached.photoFlagged=false; state.profileCache.set(uid(),cached);
      const pv=$('#photoPreview'); if(pv) pv.innerHTML='<span>사진 없음</span>';
      const prev=$('#profileAvatarPreview'); if(prev) prev.innerHTML=avatarHtml(state.profile,'large');
      document.querySelector('[data-action="remove-photo"]')?.remove();
      renderSidebar(); renderMessages(false);
      toast('프로필 사진을 지웠어요.');
    });
  }

  async function maybeShowProfileSetup(){
    if(state.profile.role==='student' && (!state.profile.grade || !state.profile.classNum)){
      openModal(`<h2>학급 정보를 알려 주세요</h2><p class="desc">채팅방을 제대로 보여드리려면 학년과 반을 알려주세요.</p><form id="setupForm"><div class="field"><label>학년</label><div class="custom-select"><button type="button" class="select-button" data-select-open="setupGrade"><span data-selected="setupGrade">골라 주세요</span><span>⌄</span></button></div></div><div class="field"><label>반</label><div class="custom-select"><button type="button" class="select-button" data-select-open="setupClass"><span data-selected="setupClass">학년을 먼저 골라 주세요</span><span>⌄</span></button></div></div><label class="consent"><input type="checkbox" name="setupConsent"><span>에듀톡은 가입·접속할 때 <b>IP 주소, 접속 시각, 브라우저 정보</b>를 수집·보관할 수 있어요. 부적절한 사용을 확인하기 위한 목적으로만 쓰이며, 위 내용을 확인했습니다.</span></label><button class="primary" data-action="save-setup">저장하고 시작하기</button></form>`,{dismissible:false});
      const gb=$('[data-select-open="setupGrade"]');wireDropdown(gb,state.school.grades.map(g=>({value:g,label:`${g}학년`})),(v,l)=>{gb.querySelector('[data-selected]').textContent=l;gb.querySelector('[data-selected]').dataset.value=v;const cb=$('[data-select-open="setupClass"]');wireDropdown(cb,Array.from({length:Number(state.school.classCounts?.[v]||0)},(_,i)=>({value:i+1,label:`${i+1}반`})),(cv,cl)=>{cb.querySelector('[data-selected]').textContent=cl;cb.querySelector('[data-selected]').dataset.value=cv;});});
    }
  }
  async function saveSetup(){const g=Number($('[data-selected="setupGrade"]')?.dataset.value||0),c=Number($('[data-selected="setupClass"]')?.dataset.value||0);if(!$('[name="setupConsent"]')?.checked)return toast('접속 기록 수집 안내를 확인하고 체크해 주세요.');if(!g||!c)return toast('학년과 반을 모두 골라 주세요.');try{await db.collection('users').doc(uid()).update({grade:g,classNum:c,updatedAt:ts()});}catch(e){console.error(e);return toast(errText(e));}try{await db.collection('publicProfiles').doc(uid()).set({grade:g,classNum:c,updatedAt:ts()},{merge:true});}catch(e){console.error(e);}state.profile.grade=g;state.profile.classNum=c;closeModal();renderSidebar();toast('학급 정보를 저장했어요.');maybeShowSiteNoticePopup();}

  // 내 목록에 보이는 탭 순서 (사용자가 만든 탭 + 아직 순서에 없는 탭)
  function groupOrderList(){
    const names=(state.groupNames||[]).slice();
    state.rooms.forEach(r=>{const g=roomGroup(r); if(!names.includes(g))names.push(g);});
    return names;
  }
  // 채팅방이 어느 탭에 들어갈지 정한다.
  // ① 내가 직접 옮겨 둔 탭 → ② 방을 만들 때 고른 유형과 이름이 같은 탭이 내게 있으면 그 탭
  // ③ 개인 채팅방(초대한 사람만)은 개인 탭 → ④ 나머지는 모둠/동아리 탭
  function roomGroup(r){
    const explicit=state.settings.roomGroups?.[r.id];
    if(explicit) return explicit;
    const label=String(r.typeLabel||'').trim();
    if(label && (state.groupNames||[]).includes(label)) return label;
    if(r.type==='notice') return '공지';
    if(r.type==='private'||r.visibility==='private') return '개인';
    if(label) return '개인';
    return '모둠/동아리'; // 유형 정보가 없는 예전 채팅방
  }
  const ROOM_ICON_POOL = ['💬','🏫','📚','🎒','🌟','🎨','⚽','🎮','🎵','🧪','💡','🌈','🍀','⭐','🚀','🎯','🏆','🔥','🌊','🍎','📝','🎈','🧩','🌸','🍪'];
  function hashString(s){ let h=0; for(let i=0;i<String(s).length;i++) h=(h*31+String(s).charCodeAt(i))|0; return Math.abs(h); }
  function roomIcon(r){
    if(!r) return '💬';
    if(r.type==='notice') return '📌';
    if(r?.icon) return r.icon;
    const isPrivate=r.type==='private'||r.visibility==='private';
    const pool=isPrivate?['👤','💬','🔒','📝','🧑‍🤝‍🧑','💌','🤝','🌙']:ROOM_ICON_POOL;
    const id=String(r.id||r.name||'');
    if(!id) return pool[0];
    return pool[hashString(id)%pool.length];
  }
  function randomRoomIcon(isPrivate){
    const pool=isPrivate?['👤','💬','🔒','📝','🧑‍🤝‍🧑','💌','🤝','🌙']:ROOM_ICON_POOL;
    return pool[Math.floor(Math.random()*pool.length)];
  }
  function roomIconHtml(r){
    const photo=r?.iconPhoto?safeImgSrc(r.iconPhoto):'';
    if(photo) return `<img class="room-icon-img" src="${esc(photo)}" alt="">`;
    if(r?.icon) return esc(r.icon);
    return esc(roomIcon(r));
  }
  // 이 방이 다른 학교 / 같은 학교의 다른 학급과 함께 쓰이는 방인지
  function myClassKey(){
    const p=state.profile||{};
    return (p.grade&&p.classNum)?`${p.grade}-${p.classNum}`:'';
  }
  function roomShare(r){
    if(!r) return '';
    const mySchool=state.profile?.schoolId||'';
    const ids=Array.isArray(r.schoolIds)?r.schoolIds.filter(Boolean):[];
    if(mySchool && ids.some(s=>s!==mySchool)) return 'cross-school';
    const myKey=myClassKey();
    const keys=Array.isArray(r.classKeys)?r.classKeys.filter(Boolean):[];
    if(myKey && keys.some(k=>k!==myKey)) return 'cross-class';
    return '';
  }
  function shareDot(kind){
    if(!kind) return '';
    const title=kind==='cross-school'?'다른 학교와 함께 쓰는 채팅방이에요':'같은 학교의 다른 학급과 함께 쓰는 채팅방이에요';
    return `<span class="share-dot ${kind}" title="${title}" aria-label="${title}"></span>`;
  }
  function sharePill(kind){
    if(!kind) return '';
    return kind==='cross-school'
      ? `<span class="share-pill cross-school">🌐 다른 학교와 공유</span>`
      : `<span class="share-pill cross-class">🏫 다른 학급과 공유</span>`;
  }
  function renderRooms(){
    const hosts=$$('#roomList'); if(!hosts.length)return;
    if(!(state.settings.collapsedGroups instanceof Array)) state.settings.collapsedGroups=[];
    // 1번: 전송 직후 아래로 내려갔다 위로 올라오는 점프 방지 — 정렬을 안정화하고 DOM을 통째로 갈아끼우지 않고 순서만 이동
    // 기존 순서 캡처 (FLIP용)
    const oldOrder=new Map();
    try{ hosts[0].querySelectorAll('.room[data-room-id]').forEach(el=>{ oldOrder.set(el.dataset.roomId, el.getBoundingClientRect().top); }); }catch(e){}
    const sideBody=hosts[0].closest('.side-body');
    const oldScroll=sideBody?sideBody.scrollTop:0;
    const byTime=(a,b)=>(docTs(b.updatedAt)-docTs(a.updatedAt))||(docTs(b.lastCreatedAt)-docTs(a.lastCreatedAt))||String(a.id||'').localeCompare(String(b.id||''));
    const pinned=(state.rooms||[]).filter(r=>isRoomPinned(r.id)).sort((a,b)=>((isRoomPinnedByAdmin(b.id)?1:0)-(isRoomPinnedByAdmin(a.id)?1:0))||byTime(a,b));
    const buckets={}; state.rooms.forEach(r=>{ if(isRoomPinned(r.id)) return; const g=roomGroup(r); if(!buckets[g])buckets[g]=[]; buckets[g].push(r); });
    const groupHtml=(g,arr,pinnedGroup)=>{
      const collapsed=!pinnedGroup&&isCatCollapsed(g);
      const head=pinnedGroup
        ? `<div class="side-title pinned"><span>📌 고정</span><span class="group-count">${arr.length}</span></div>`
        : `<div class="side-title" data-action="cat-toggle" data-group="${esc(g)}"><span class="cat-caret">▾</span><span>${esc(g)}</span><span class="group-count">${arr.length||'＋'}</span></div>`;
      return `<div class="room-group${arr.length?'':' empty'}${collapsed?' collapsed':''}" data-group="${esc(g)}">${head}<div class="room-list-body"><div class="rl-inner">${arr.map(r=>roomHtml(r)).join('')}${arr.length?'':'<div class="group-drop-hint">여기에 놓기</div>'}</div></div></div>`;
    };
    const pinnedHtml=pinned.length?groupHtml('__pinned',pinned,true):'';
    const roomsHtml=state.rooms.length?(pinnedHtml+groupOrderList().map(g=>groupHtml(g,buckets[g]||[],false)).join('')):`<div class="empty-side">아직 채팅방이 없어요.</div>`;
    hosts.forEach(h=>h.innerHTML=roomsHtml);
    // 스크롤 점프 방지 + 순서 바뀔 때 부드럽게 이동(FLIP)
    try{
      if(sideBody) sideBody.scrollTop=oldScroll;
      if(!prefersReducedMotion()){
        hosts[0].querySelectorAll('.room[data-room-id]').forEach(el=>{
          const id=el.dataset.roomId;
          if(!oldOrder.has(id)) { el.classList.add('room-enter'); setTimeout(()=>el.classList.remove('room-enter'),420); return; }
          const dy=oldOrder.get(id)-el.getBoundingClientRect().top;
          if(Math.abs(dy)>4){ el.animate([{transform:`translateY(${dy}px)`},{transform:'translateY(0)'}],{duration:320,easing:'cubic-bezier(.2,.8,.2,1)'}); }
        });
      }
    }catch(e){}
    const invitesHtml=state.pendingInvites.map(i=>`<div class="list-item" data-invite="${esc(i.id)}"><div class="grow"><div class="title">${esc(i.roomName||'채팅방 초대')}</div><div class="meta">${esc(i.inviterName||'사용자')}님이 초대했어요.</div></div><button class="soft-btn" style="flex:0 0 58px" data-action="accept-invite" data-invite="${esc(i.id)}">받기</button><button class="soft-btn" style="flex:0 0 58px" data-action="decline-invite" data-invite="${esc(i.id)}">거절</button></div>`).join('');
    $$('#inviteList').forEach(h=>h.innerHTML=invitesHtml);
    $$('#inviteSection').forEach(s=>s.classList.toggle('hidden',!state.pendingInvites.length));
  }
  function isCatCollapsed(g){ return !!((state.settings&&state.settings.collapsedGroups)||[]).includes(g); }
  async function toggleCatCollapse(g){
    if(!g||state.suppressCatClick) return;
    const cur=new Set((state.settings.collapsedGroups)||[]);
    const on=!cur.has(g);
    if(on) cur.add(g); else cur.delete(g);
    state.settings.collapsedGroups=[...cur];
    const s={...(state.profile?.settings||{}),collapsedGroups:state.settings.collapsedGroups};
    if(state.profile) state.profile.settings=s;
    $$('#roomList .room-group').forEach(el=>{ if(el.dataset.group===g) el.classList.toggle('collapsed',on); });
    try{ await db.collection('users').doc(uid()).update({settings:s,updatedAt:ts()}); }
    catch(e){ console.error(e); }
  }
  function isRoomPinnedByAdmin(id){ return !!((state.chatSettings&&state.chatSettings.pinnedRooms)||[]).includes(id); }
  function isRoomPinned(id){ return !!id && (isRoomPinnedByAdmin(id) || ((state.settings&&state.settings.pinnedRooms)||[]).includes(id)); }
  async function togglePinRoom(id){
    if(!id) return;
    if(isRoomPinnedByAdmin(id)) return toast('관리자가 위로 고정한 채팅방이에요.');
    const cur=new Set((state.settings.pinnedRooms)||[]);
    const on=!cur.has(id);
    if(on) cur.add(id); else cur.delete(id);
    state.settings.pinnedRooms=[...cur];
    const s={...(state.profile?.settings||{}),pinnedRooms:state.settings.pinnedRooms};
    if(state.profile) state.profile.settings=s;
    try{ await db.collection('users').doc(uid()).update({settings:s,updatedAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    renderRooms();
    toast(on?'채팅방을 위로 고정했어요.':'고정을 풀었어요.');
  }
  function openRoomListMenu(roomId,x,y){
    const r=(state.rooms||[]).find(v=>v.id===roomId); if(!r) return;
    const pinned=isRoomPinned(roomId);
    const muted=isRoomMuted(roomId);
    const items=[];
    items.push(`<button type="button" data-action="room-pin" data-room-id="${esc(roomId)}">${pinned?'고정 해제':'위로 고정'}</button>`);
    items.push(`<button type="button" data-action="mute-room" data-room-id="${esc(roomId)}">${muted?'알림 켜기':'알림 끄기'}</button>`);
    if(isAdmin()||r.createdBy===uid()||(r.memberIds||[]).includes(uid())) items.push(`<button type="button" data-action="manage-room" data-room-id="${esc(roomId)}">채팅방 설정</button>`);
    // 채팅방 나가기는 모든 이용자(멤버)에게 권한이 있다
    if((r.memberIds||[]).includes(uid())) items.push(`<button type="button" class="danger" data-action="leave-room" data-room-id="${esc(roomId)}">채팅방 나가기</button>`);
    showFloatMenu(x,y,`<div class="float-title">${esc(r.name||'채팅방')}</div>${items.join('')}`);
  }
  function roomHtml(r){const unread=state.unread[r.id]?1:0;const lock=isRoomMuted(r.id)?'<span class="share-dot" style="background:#9aa4b2" title="알림을 꺼 둔 채팅방이에요"></span>':'';const pin=isRoomPinned(r.id)?'<span class="pin-mark" title="위로 고정">📌</span>':'';const muted=isRoomMuted(r.id);return `<div class="room-swipe" data-room-id="${esc(r.id)}"><div class="room-swipe-bg left"><button type="button" data-swipe-act="mute">${muted?'🔔 알림 켜기':'🔕 알림 끄기'}</button><button type="button" data-swipe-act="manage">⚙ 설정</button></div><div class="room-swipe-bg right"><button type="button" data-swipe-act="leave">🚪 나가기</button></div><button class="room ${state.room?.id===r.id?'active':''}${unread?' has-unread':''}" data-room-id="${esc(r.id)}"><div class="room-icon">${roomIconHtml(r)}</div><div class="room-main"><div class="room-name">${pin}${esc(r.name||'이름 없는 채팅방')}${shareDot(roomShare(r))}${lock}</div><div class="room-sub">${esc(r.lastText || (r.type==='notice'?'선생님이 안내를 올려요.':'메시지가 아직 없어요.'))}</div></div><div class="room-right">${state.unread[r.id]?`<span class="unread">${Math.min(99,state.unread[r.id])}</span>`:''}</div></button></div>`;}

  // ---------- 탭(카테고리) 저장 ----------
  async function persistGroups(){
    const s={...(state.profile?.settings||{}),fontSize:state.settings.fontSize,theme:state.settings.theme||currentTheme(),notify:state.settings.notify||notifySettings(),roomGroups:state.settings.roomGroups||{},groupOrder:(state.groupNames||[]).slice(),mutedRooms:state.settings.mutedRooms||[],pinnedRooms:state.settings.pinnedRooms||[],collapsedGroups:state.settings.collapsedGroups||[],collapsedSideSections:state.settings.collapsedSideSections||[],sideOrder:(state.settings.sideOrder||sideOrderList()).slice()};
    if(state.profile) state.profile.settings=s; state.settings.groupOrder=s.groupOrder;
    try{ await db.collection('users').doc(uid()).update({settings:s,updatedAt:ts()}); }
    catch(e){ console.error(e); toast(errText(e)); }
  }
  // 채팅방이 하나도 없는 탭은 저절로 없앤다 (개인 탭은 항상 남겨 둔다)
  function pruneEmptyGroups(){
    const used=new Set(state.rooms.map(roomGroup));
    const cur=groupOrderList();
    const next=cur.filter(g=>g==='개인'||used.has(g));
    if(next.length===cur.length) return false;
    state.groupNames=next; state.settings.groupOrder=next.slice();
    return true;
  }

  // ---------- 채팅방을 꾹 눌러 끌어서 탭 옮기기 ----------
  let roomDrag=null;
  function clearRoomDrag(){
    if(!roomDrag) return;
    if(roomDrag.timer) clearTimeout(roomDrag.timer);
    if(roomDrag.clone){ try{ roomDrag.clone.remove(); }catch(e){} }
    try{ roomDrag.el?.classList.remove('drag-src'); }catch(e){}
    $$('.room-group.drop-over').forEach(g=>g.classList.remove('drop-over'));
    document.body.classList.remove('room-dragging');
    try{ stopDragHaptic(false); }catch(e){}
    try{ stopEdgeScroll(); }catch(e){}
    roomDrag=null;
  }
  function beginRoomDrag(el,x,y){
    if(!roomDrag) return;
    try{ if(roomSwipe) return; }catch(e){}
    try{ if(document.querySelector('.room-swipe.open')) closeRoomSwipe(); }catch(e){}
    const rect=el.getBoundingClientRect();
    roomDrag.active=true;
    roomDrag.id=el.dataset.roomId;
    roomDrag.offX=x-rect.left; roomDrag.offY=y-rect.top;
    const clone=el.cloneNode(true);
    clone.classList.add('room-drag-clone');
    clone.style.width=rect.width+'px';
    clone.style.height=rect.height+'px';
    document.body.appendChild(clone);
    roomDrag.clone=clone;
    el.classList.add('drag-src');
    document.body.classList.add('room-dragging');
    moveRoomDrag(x,y);
    startDragHaptic();
  }
  function moveRoomDrag(x,y){
    if(!roomDrag?.clone) return;
    roomDrag.clone.style.left=(x-roomDrag.offX)+'px';
    roomDrag.clone.style.top=(y-roomDrag.offY)+'px';
    const prev=roomDrag.clone.style.pointerEvents;
    roomDrag.clone.style.pointerEvents='none';
    const under=document.elementFromPoint(x,y);
    roomDrag.clone.style.pointerEvents=prev;
    const group=under?.closest?.('.room-group')||null;
    $$('.room-group.drop-over').forEach(g=>{ if(g!==group) g.classList.remove('drop-over'); });
    if(group) group.classList.add('drop-over');
    roomDrag.over=group?.dataset.group||null;
    updateEdgeScroll(y);
  }
  async function endRoomDrag(){
    const d=roomDrag; if(!d) return;
    const id=d.id, over=d.over;
    try{ stopDragHaptic(true); }catch(e){}
    clearRoomDrag();
    if(!id) return;
    state.suppressRoomClick=true;
    setTimeout(()=>{ state.suppressRoomClick=false; },400);
    if(!over) return;
    const r=state.rooms.find(x=>x.id===id);
    if(!r || roomGroup(r)===over) return;
    state.settings.roomGroups[id]=over;
    const pruned=pruneEmptyGroups();
    renderRooms();
    await persistGroups();
    toast(pruned?`'${over}' 탭으로 옮겼어요. 빈 탭은 정리했어요.`:`'${over}' 탭으로 옮겼어요.`);
  }
  function wireRoomDrag(){
    document.addEventListener('pointerdown',e=>{
      if(e.button!=null && e.button!==0) return;
      const el=e.target.closest?.('.room[data-room-id]');
      if(!el) return;
      const x0=e.clientX, y0=e.clientY;
      const rec={el,timer:null,active:false};
      roomDrag=rec;
      rec.timer=setTimeout(()=>{ if(roomDrag===rec) beginRoomDrag(el,x0,y0); },340);
      const move=ev=>{
        if(roomDrag!==rec) return;
        if(!rec.active){ if(Math.abs(ev.clientX-x0)>9||Math.abs(ev.clientY-y0)>9){ clearRoomDrag(); cleanup(); } return; }
        ev.preventDefault();
        moveRoomDrag(ev.clientX,ev.clientY);
      };
      const up=()=>{
        if(roomDrag===rec && rec.active) endRoomDrag();
        else clearRoomDrag();
        cleanup();
      };
      const cleanup=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        document.removeEventListener('pointercancel',up);
      };
      document.addEventListener('pointermove',move,{passive:false});
      document.addEventListener('pointerup',up);
      document.addEventListener('pointercancel',up);
    });
  }
  wireRoomDrag();
  // 드래그 중(iOS 포함) 목록 스크롤이 끼어들지 않게 touch 스크롤을 잠근다
  try{
    document.addEventListener('touchmove', (e)=>{
      try{ if(roomDrag?.active||sideDrag||catDrag) e.preventDefault(); }catch(_){}
    }, {passive:false});
  }catch(e){}
  // 카톡식 방 밀기: 오른쪽으로 밀면 알림·설정, 왼쪽으로 밀면 나가기
  let roomSwipe=null;
  function closeRoomSwipe(){
    try{
      document.querySelectorAll('.room-swipe.open').forEach(w=>{
        w.classList.remove('open');
        const b=w.querySelector(':scope > .room'); if(b) b.style.transform='';
      });
    }catch(e){}
    if(roomSwipe){ roomSwipe=null; }
  }
  function armRoomSwipe(){
    let sx=0, sy=0, wrap=null, btn=null, dx=0, tracking=false;
    const reset=(el)=>{ if(el){ el.style.transform=''; el.closest('.room-swipe')?.classList.remove('open'); } };
    try{
      document.addEventListener('touchstart',(e)=>{
        try{
          if(e.touches.length>1) return;
          const t=e.touches[0];
          const w=t.target.closest?.('.room-swipe'); 
          // 다른 방이 열려 있으면 먼저 닫는다
          const opened=document.querySelector('.room-swipe.open');
          if(opened && (!w || opened!==w)){ closeRoomSwipe(); }
          if(!w) return;
          if(t.target.closest?.('[data-swipe-act]')) return;
          sx=t.clientX; sy=t.clientY; wrap=w; btn=w.querySelector(':scope > .room'); dx=0; tracking=true;
        }catch(_){ tracking=false; }
      },{passive:true});
      document.addEventListener('touchmove',(e)=>{
        if(!tracking||!wrap||!btn) return;
        try{
          if(roomDrag?.active){ tracking=false; reset(btn); wrap=null; btn=null; return; }
          const t=e.touches[0];
          const mx=t.clientX-sx, my=t.clientY-sy;
          if(!roomSwipe){
            if(Math.abs(my)>Math.abs(mx)*1.3+10){ tracking=false; wrap=null; btn=null; return; }
            if(Math.abs(mx)<12) return;
            roomSwipe={wrap};
            wrap.classList.add('swiping');
          }
          dx=Math.max(-88,Math.min(160,mx));
          btn.style.transform=`translateX(${dx}px)`;
          if(Math.abs(mx)>10) e.preventDefault();
        }catch(_){}
      },{passive:false});
      const finish=(e)=>{
        if(!tracking) return;
        tracking=false;
        try{
          if(!wrap||!btn){ roomSwipe=null; return; }
          const w=wrap, b=btn, d=dx;
          wrap=null; btn=null; roomSwipe=null;
          w.classList.remove('swiping');
          if(d>64){ b.style.transform='translateX(160px)'; w.classList.add('open'); }
          else if(d<-44){ b.style.transform='translateX(-88px)'; w.classList.add('open'); }
          else { b.style.transform=''; w.classList.remove('open'); }
          if(Math.abs(d)>10){
            state.suppressRoomClick=true;
            setTimeout(()=>{ state.suppressRoomClick=false; },400);
            try{ if(navigator.vibrate) navigator.vibrate(10); }catch(_){}
          }
        }catch(_){}
      };
      document.addEventListener('touchend',finish,{passive:true});
      document.addEventListener('touchcancel',()=>{ tracking=false; if(wrap&&btn){ reset(btn); } wrap=null; btn=null; roomSwipe=null; },{passive:true});
    }catch(e){}
  }
  try{ armRoomSwipe(); }catch(e){}
  // 방을 집은 채로 목록 위·아래 가장자리에 대면 일정 속도로 자동 스크롤 (100개 목록도 중간으로 옮길 수 있게)
  let edgeScrollTimer=null, edgeScrollDir=0, edgeScrollEl=null;
  function edgeScrollTick(){
    try{
      if(!edgeScrollEl || !edgeScrollDir || !document.body.contains(edgeScrollEl)){ stopEdgeScroll(); return; }
      edgeScrollEl.scrollTop += edgeScrollDir*10;
    }catch(e){ stopEdgeScroll(); }
  }
  function updateEdgeScroll(y){
    try{
      const cands=[...document.querySelectorAll('.side-body')].filter(el=>{ try{ const r=el.getBoundingClientRect(); return r.height>80 && r.width>0; }catch(e){ return false; } });
      const container=cands[0];
      if(!container){ stopEdgeScroll(); return; }
      const r=container.getBoundingClientRect(), M=72;
      let dir=0;
      if(y < r.top+M) dir=-1; else if(y > r.bottom-M) dir=1;
      if(dir===0){ stopEdgeScroll(); return; }
      if(edgeScrollEl!==container || edgeScrollDir!==dir){
        edgeScrollEl=container; edgeScrollDir=dir;
        if(!edgeScrollTimer) edgeScrollTimer=setInterval(edgeScrollTick, 16);
      }
    }catch(e){}
  }
  function stopEdgeScroll(){
    try{ if(edgeScrollTimer){ clearInterval(edgeScrollTimer); edgeScrollTimer=null; } }catch(e){ edgeScrollTimer=null; }
    edgeScrollEl=null; edgeScrollDir=0;
  }

  // ---------- 탭(카테고리)을 꾹 눌러 순서 바꾸기 ----------
  let catDrag=null;
  function catGroupEls(){ return $$('#roomList .room-group[data-group]').filter(g=>g.dataset.group!=='__pinned'); }
  function catBody(g){ return g.querySelector('.room-list-body'); }
  function beginCatDrag(head,group){
    const groups=catGroupEls();
    if(groups.length<2) return false;
    const el=head.closest('.room-group'); if(!el) return false;
    catDrag={group,el,wasCollapsed:groups.filter(g=>g.classList.contains('collapsed')).map(g=>g.dataset.group)};
    state.suppressCatClick=true;
    document.body.classList.add('cat-dragging');
    // 채팅방들이 탭 안으로 차라락 접혀 들어간다
    groups.forEach((g,i)=>{ const b=catBody(g); if(b) b.style.transitionDelay=(i*55)+'ms'; g.classList.add('collapsed'); });
    el.classList.add('cat-lift');
    setTimeout(()=>{ groups.forEach(g=>{ const b=catBody(g); if(b) b.style.transitionDelay='0ms'; }); }, groups.length*55+300);
    startDragHaptic();
    return true;
  }
  function moveCatDrag(y){
    if(!catDrag) return;
    const others=catGroupEls().filter(g=>g!==catDrag.el);
    let target=null;
    for(const g of others){ const r=g.getBoundingClientRect(); if(y<r.top+r.height*0.55){ target=g; break; } }
    const parent=catDrag.el.parentNode;
    if(target) parent.insertBefore(catDrag.el,target);
    else parent.appendChild(catDrag.el);
    updateEdgeScroll(y);
  }
  async function endCatDrag(){
    const d=catDrag; if(!d) return;
    catDrag=null;
    try{ stopDragHaptic(true); }catch(e){}
    try{ stopEdgeScroll(); }catch(e){}
    document.body.classList.remove('cat-dragging');
    d.el.classList.remove('cat-lift');
    const groups=catGroupEls();
    const order=groups.map(g=>g.dataset.group);
    // 다시 튀어나오는 모션 (원래 접어 둔 탭은 그대로 접힌 채로)
    const was=d.wasCollapsed||[];
    groups.filter(g=>!was.includes(g.dataset.group)).forEach((g,i)=>{ const b=catBody(g); if(b) b.style.transitionDelay=(i*55)+'ms'; g.classList.remove('collapsed'); });
    const rest=(state.groupNames||[]).filter(n=>!order.includes(n));
    state.groupNames=order.concat(rest);
    await persistGroups();
    setTimeout(()=>{
      $$('#roomList .room-group').forEach(g=>{ const b=catBody(g); if(b) b.style.transitionDelay=''; });
      state.suppressCatClick=false;
      renderRooms();
      toast('탭 순서를 바꿨어요.');
    },360);
  }
  function wireCatDrag(){
    document.addEventListener('pointerdown',e=>{
      const head=e.target.closest?.('[data-action="cat-toggle"][data-group]');
      if(!head) return;
      if(e.button!=null && e.button!==0) return;
      const x0=e.clientX,y0=e.clientY,group=head.dataset.group;
      let timer=setTimeout(()=>{ if(catGroupEls().length<2){ catDrag=null; toast('탭이 2개 이상 있어야 순서를 바꿀 수 있어요. 채팅 관리에서 탭을 추가해 보세요.'); return; } if(!beginCatDrag(head,group)){ catDrag=null; } },320);
      const move=ev=>{
        if(!catDrag){ if(Math.abs(ev.clientX-x0)>9||Math.abs(ev.clientY-y0)>9){ clearTimeout(timer); cleanup(); } return; }
        ev.preventDefault();
        moveCatDrag(ev.clientY);
      };
      const up=()=>{ if(catDrag) endCatDrag(); else clearTimeout(timer); cleanup(); };
      const cleanup=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        document.removeEventListener('pointercancel',up);
      };
      document.addEventListener('pointermove',move,{passive:false});
      document.addEventListener('pointerup',up);
      document.addEventListener('pointercancel',up);
    });
    // 채팅방을 오른쪽 버튼으로 누르면 메뉴가 뜬다 (고정 · 알림 · 설정 · 나가기)
    document.addEventListener('contextmenu',e=>{
      const el=e.target.closest?.('.room[data-room-id]');
      if(!el) return;
      e.preventDefault();
      openRoomListMenu(el.dataset.roomId,e.clientX,e.clientY);
    });
  }
  wireCatDrag();

  function roomQueries(){
    const sid=state.profile?.schoolId||'';
    // 관리자도 자기 채팅방만 목록에 보여준다. 모든 채팅방은 관리자 도구에서 본다.
    const qs=[db.collection('channels').where('createdBy','==',uid()).limit(100)];
    // 내가 들어가 있는 방은 학교가 달라도 보여준다 (학교 간 채팅)
    qs.push(db.collection('channels').where('memberIds','array-contains',uid()).limit(100));
    if(sid) qs.push(db.collection('channels').where('schoolId','==',sid).where('visibility','==','all').limit(100));
    else qs.push(db.collection('channels').where('visibility','==','all').limit(100));
    return qs;
  }
  function attachRoomListeners(){
    const previous = new Map(state.rooms.map(r=>[r.id, r.lastCreatedAt ? docTs(r.lastCreatedAt) : 0]));
    // 단조 가드: 서버 시간이 아직 안 박힌(STALE) 읽기가 와도 목록이 과거로 미끄러지지 않게
    // 본 적 있는 updatedAt보다 과거 값이 오면 이전 값을 유지한다 (아래→위 점프 방지)
    const prevUpdated = new Map(state.rooms.map(r=>[r.id, r.updatedAt ? docTs(r.updatedAt) : 0]));
    const prevUnreadCut = new Map();
    const queries=roomQueries();
    const load=async()=>{
      try{
        // 교체 전에 화면에 있던 값(낙관적 맨올림 포함)을 기억해 둔다
        const curUpdated=new Map(state.rooms.map(r=>[r.id, docTs(r.updatedAt)]));
        const snaps=await Promise.all(queries.map(q=>q.get()));
        const map=new Map(); snaps.forEach(s=>s.docs.forEach(d=>map.set(d.id,{id:d.id,...d.data()})));
        // 지워진 채팅방은 목록에서 감춘다 (기록은 관리자 도구에서 계속 볼 수 있다)
        // 나간 방은 visibility와 무관하게 감춘다 (공개방도 나간 뒤엔 없던 것처럼)
        state.rooms=[...map.values()].filter(r=>{
          if(r.deleted||r.deleted_at) return false;
          const amIn=(r.memberIds||[]).includes(uid());
          if(amIn){ try{ unmarkRoomLeft(r.id); }catch(e){} return true; }
          try{ if(isRoomLeft(r.id)) return false; }catch(e){}
          if((r.visibility||'')==='all') return true;
          return false;
        }).map(r=>{
          const best=Math.max(prevUpdated.get(r.id)||0,curUpdated.get(r.id)||0), fu=docTs(r.updatedAt);
          if(fu<best) r.updatedAt=best;
          return r;
        }).sort((a,b)=>(docTs(b.updatedAt)-docTs(a.updatedAt))||(docTs(b.lastCreatedAt)-docTs(a.lastCreatedAt))||String(a.id||'').localeCompare(String(b.id||'')));
        state.rooms.forEach(r=>{ const u=docTs(r.updatedAt); if(u>(prevUpdated.get(r.id)||0)) prevUpdated.set(r.id,u); });
        healStalePrivateRooms();
        if(!(state.knownRoomIds instanceof Set)) state.knownRoomIds=new Set();
        for(const r of state.rooms){
          const known=state.knownRoomIds.has(r.id);
          const old=previous.get(r.id)||0, fresh=docTs(r.lastCreatedAt);
          // 이미 알고 있던 방이면 lastCreatedAt이 0이었더라도(첫 메시지) 알림을 준다
          // 삭제 후 요약이 갱신되면 lastCreatedAt이 과거로 돌아갈 수 있다 → 과거 시간은 새 메시지가 아니다
          const isNewMsg = fresh>0 && fresh>old && (known||old>0);
          if(isNewMsg && r.lastSenderId && r.lastSenderId!==uid() && !summaryBlocked(r)){
            if(r.id!==state.room?.id && !isRoomMuted(r.id)) showNewMessageBanner(r.id,r,{senderName:r.lastSenderName||'사용자',text:r.lastText||''});
            notifyMessage(r.id,r,{senderId:r.lastSenderId,senderName:r.lastSenderName||'사용자',text:r.lastText||'',createdAt:r.lastCreatedAt});
          }
        }
        // 안읽음은 lastCreatedAt이 전진한 방만 다시 센다 (매번 전수 조회하면 요금 폭탄)
        // 안 센 방은 직전 값을 유지한다 (읽음 처리된 방은 아래 keep 조건에서 떨어진다)
        const reads=state.profile?.readAt||{};
        const keepUnread={...(state.unread||{})};
        const candidates=state.rooms.filter(r=>r.id!==state.room?.id && docTs(r.lastCreatedAt)>docTs(reads[r.id]) && docTs(r.lastCreatedAt)>(prevUnreadCut.get(r.id)||0) && r.lastSenderId!==uid() && !summaryBlocked(r));
        const counts=await Promise.all(candidates.slice(0,30).map(async r=>{try{const s=await db.collection('channels').doc(r.id).collection('messages').orderBy('createdAt','desc').limit(80).get();const cut=docTs(reads[r.id])||0;return [r.id,s.docs.filter(d=>{const m=d.data();return !m.deleted&&m.senderId!==uid()&&docTs(m.createdAt)>cut&&!isBlockedMessage(m)}).length];}catch{return [r.id,1];}}));
        state.unread={};counts.forEach(([id,c])=>{state.unread[id]=c; const rr=state.rooms.find(x=>x.id===id); prevUnreadCut.set(id,docTs(rr?.lastCreatedAt)||0);});
        for(const [id,c] of Object.entries(keepUnread)){
          if(id in state.unread) continue;
          const r=state.rooms.find(x=>x.id===id);
          if(r&&r.id!==state.room?.id&&docTs(r.lastCreatedAt)>docTs(reads[r.id])&&r.lastSenderId!==uid()&&!summaryBlocked(r)) state.unread[id]=c;
        }
        renderRooms(); try{ renderUnreadSummary(); }catch(e){} previous.clear();state.rooms.forEach(r=>{previous.set(r.id,docTs(r.lastCreatedAt));state.knownRoomIds.add(r.id);});
      }catch(e){console.error('room load',e);toast('채팅방을 불러오는 데 잠시 문제가 있었어요.');}
    };
    load();
    const schedule=()=>{clearTimeout(roomLoadTimer);roomLoadTimer=setTimeout(load,400);};
    queries.forEach(q=>state.listeners.push(q.onSnapshot(()=>schedule(),e=>console.error(e))));
  }
  // 예전에 '개인'으로 만든 채팅방이 학교 전체에 공개(visibility:'all')돼 있던 문제를 한 번만 고쳐 준다.
  const healedRooms=new Set();
  async function healStalePrivateRooms(){
    const targets=state.rooms.filter(r=>r.createdBy===uid() && r.visibility==='all' && r.type!=='notice' && String(r.typeLabel||'')==='개인' && !healedRooms.has(r.id));
    for(const r of targets){
      healedRooms.add(r.id);
      try{ await db.collection('channels').doc(r.id).update({visibility:'private',type:'private',updatedAt:ts()}); }
      catch(e){ console.error('heal room',e); }
    }
  }
  function summaryBlocked(r){
    if(!r.lastSenderId||!state.profile?.blockHistory?.[r.lastSenderId])return false;const t=docTs(r.lastCreatedAt);return state.profile.blockHistory[r.lastSenderId].some(x=>t>=Number(x.from||0)&&(x.to==null||t<=Number(x.to)));
  }

  function attachInviteListener(){
    clearInviteListener();
    inviteUnsub=db.collection('roomInvites').where('targetUid','==',uid()).where('status','==','pending').limit(30).onSnapshot(async s=>{
      const invites=s.docs.map(d=>({id:d.id,...d.data()}));
      if(state.settings.invitePolicy==='auto'){for(const i of invites){try{await acceptInvite(i.id);}catch(e){console.error(e)}} state.pendingInvites=[];}
      else if(state.settings.invitePolicy==='block'){for(const i of invites){try{await declineInvite(i.id);}catch(e){console.error(e)}} state.pendingInvites=[];}
      else {state.pendingInvites=invites; showInviteCards(invites);}
      renderRooms();
    },e=>console.error(e));
  }
  // 초대가 오면 아래에서 올라오는 카드로 알려준다 (받기 / 거절 / 다시 초대받지 않기)
  const shownInviteCards=new Set();
  function showInviteCards(invites){
    const ids=new Set((invites||[]).map(i=>i.id));
    // 더 이상 대기 중이 아닌 초대는 기록에서 지운다 → 다시 초대받으면 카드가 또 뜬다
    Array.from(shownInviteCards).forEach(id=>{ if(!ids.has(id)) shownInviteCards.delete(id); });
    (invites||[]).slice(0,3).forEach(i=>{
      if(shownInviteCards.has(i.id)) return;
      shownInviteCards.add(i.id);
      showStickyNotice(`invin_${i.id}`,`${i.inviterName||'사용자'}님이 초대했어요`,`'${i.roomName||'채팅방'}'에 들어갈까요?`,
        `<div class="sticky-btns"><button type="button" class="sticky-btn primary" data-action="accept-invite" data-invite="${esc(i.id)}">받기</button><button type="button" class="sticky-btn ghost" data-action="decline-invite" data-invite="${esc(i.id)}">거절</button></div>
         <label class="sticky-check"><input type="checkbox" data-invite-never="${esc(i.id)}"><span>다시 초대받지 않기</span></label>`);
    });
  }
  function inviteNeverChecked(id){
    const cb=document.querySelector(`[data-invite-never="${id}"]`);
    return !!(cb && cb.checked);
  }
  async function setInvitePolicyBlock(){
    state.settings.invitePolicy='block';
    if(state.profile) state.profile.invitePolicy='block';
    try{ await db.collection('users').doc(uid()).update({invitePolicy:'block',updatedAt:ts()}); }catch(e){ console.error(e); }
    try{ await putPublicProfile({invitePolicy:'block'}); }catch(e){ console.error(e); }
  }
  let noticeUnsub=null;
  function attachNoticeListener(){if(noticeUnsub)noticeUnsub();noticeUnsub=db.collection('directNotices').where('targetUid','==',uid()).where('read','==',false).limit(10).onSnapshot(s=>{if(s.empty)return;const d=s.docs[0].data();showNoticePopup({...d,id:s.docs[0].id});});}

  // ---------- 초대 결과 알림 (X를 누르기 전까지 사라지지 않는다) ----------
  function inviteSeenSet(){ try{ return new Set(JSON.parse(localStorage.getItem('edutalk_invite_seen')||'[]')); }catch(e){ return new Set(); } }
  function markInviteSeen(id){ try{ const s=inviteSeenSet(); s.add(id); localStorage.setItem('edutalk_invite_seen', JSON.stringify([...s].slice(-80))); }catch(e){} }
  function stickyHost(){
    let h=document.getElementById('stickyRoot');
    if(!h){ h=document.createElement('div'); h.id='stickyRoot'; h.className='sticky-root'; document.body.appendChild(h); }
    return h;
  }
  function showStickyNotice(id,title,text,actionsHtml,seenKey){
    const host=stickyHost();
    for(const c of Array.from(host.children)){ if(c.dataset.sticky===id) return; }
    const el=document.createElement('div');
    el.className='sticky-card';
    el.dataset.sticky=id;
    el.innerHTML=`<div class="grow"><div class="title">${esc(title)}</div><div class="text">${esc(text)}</div>${actionsHtml?`<div class="sticky-actions">${actionsHtml}</div>`:''}</div><button type="button" class="banner-x" aria-label="닫기">✕</button>`;
    host.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('show'));
    el.querySelector('.banner-x').onclick=()=>{
      if(seenKey) markInviteSeen(seenKey);
      dismissStickyNotice(id);
    };
    return el;
  }
  function dismissStickyNotice(id){
    const host=document.getElementById('stickyRoot'); if(!host) return;
    for(const c of Array.from(host.children)){
      if(c.dataset.sticky!==id) continue;
      c.classList.remove('show');
      c.classList.add('closing');
      setTimeout(()=>c.remove(),320);
    }
  }
  function attachSentInviteListener(){
    clearSentInviteListener();
    let firstSnap=true;
    sentInviteUnsub=db.collection('roomInvites').where('inviterId','==',uid()).limit(40).onSnapshot(s=>{
      const seen=inviteSeenSet();
      // 앱을 켠 뒤에 실제로 바뀐 초대만 알려준다 (예전에 거절된 초대가 다시 뜨지 않도록)
      if(firstSnap){
        firstSnap=false;
        s.docs.forEach(d=>{ if(d.data().status==='declined'){ markInviteSeen(d.id); } });
        return;
      }
      s.docChanges().forEach(ch=>{
        if(ch.type==='removed') return;
        const v=ch.doc.data();
        if(v.status!=='declined') return;
        if(seen.has(ch.doc.id)) return;
        showStickyNotice(`inv_${ch.doc.id}`,`${v.targetName||'상대방'}님이 초대를 거절했어요`,`'${v.roomName||'채팅방'}' 초대가 거절됐어요.`,null,ch.doc.id);
      });
    },e=>console.error('sent invites',e));
  }

  // ---------- 친구 ----------
  function pairId(a,b){ return [a,b].sort().join('_'); }
  function isFriend(id){ return (state.friends||[]).some(f=>f.uid===id); }
  function friendRequestFrom(id){ return (state.friendRequests||[]).find(r=>r.from===id)||null; }
  function mySentRequestTo(id){ return (state.sentRequests||[]).find(r=>r.to===id)||null; }
  function blockDocId(by,target){ return `${by}_${target}`; }
  async function syncBlockDoc(by,target,on){
    try{
      if(on) await db.collection('blocks').doc(blockDocId(by,target)).set({by,target,at:nowMs()});
      else await db.collection('blocks').doc(blockDocId(by,target)).delete();
    }catch(e){ console.error('block doc',e); }
  }
  // 상대가 나를 차단했는지 (차단하면 친구 요청을 보낼 수 없다)
  async function hasBlockedMe(otherUid){
    if(!otherUid) return false;
    const key=blockDocId(otherUid,uid());
    if(state.blockedMeCache.has(key)) return state.blockedMeCache.get(key);
    let v=false;
    try{ const s=await db.collection('blocks').doc(key).get(); v=s.exists; }
    catch(e){ console.error('block check',e); }
    state.blockedMeCache.set(key,v);
    return v;
  }
  let blockBackfillKey='';
  async function backfillBlockDocs(){
    const list=state.profile?.blockedUsers||[];
    const key=`edutalk_blockdocs_${uid()}`;
    if(blockBackfillKey===key) return;
    blockBackfillKey=key;
    let done=''; try{ done=localStorage.getItem(key)||''; }catch(e){}
    if(done===String(list.length)) return;
    await Promise.all(list.slice(0,60).map(t=>syncBlockDoc(uid(),t,true)));
    try{ localStorage.setItem(key,String(list.length)); }catch(e){}
  }
  async function ensureProfiles(ids){
    const need=[...new Set((ids||[]).filter(id=>id && !state.profileCache.has(id)))].slice(0,60);
    if(!need.length) return;
    await Promise.all(need.map(async id=>{
      try{ const s=await db.collection('publicProfiles').doc(id).get(); if(s.exists) state.profileCache.set(id,s.data()); }
      catch(e){ console.error('profile',e); }
    }));
  }
  let friendsUnsub=null, friendReqUnsub=null, sentFriendUnsub=null;
  let friendProfileUnsubs=new Map();
  function clearFriendProfileListeners(){
    friendProfileUnsubs.forEach(u=>{ try{ if(u) u(); }catch(e){} });
    friendProfileUnsubs.clear();
  }
  function syncFriendProfileListeners(ids){
    const idSet=new Set(ids||[]);
    for(const [id,unsub] of friendProfileUnsubs){
      if(!idSet.has(id)){ try{unsub();}catch(e){} friendProfileUnsubs.delete(id); }
    }
    for(const id of idSet){
      if(friendProfileUnsubs.has(id)) continue;
      try{
        const unsub=db.collection('publicProfiles').doc(id).onSnapshot(s=>{
          if(s.exists) state.profileCache.set(id, s.data());
          const idx=(state.friends||[]).findIndex(f=>f.uid===id);
          if(idx>=0) state.friends[idx].profile=state.profileCache.get(id)||{};
          renderFriends();
          try{ tickPresence(); }catch(e){}
        },e=>console.warn('friend profile listen',e?.code||e));
        friendProfileUnsubs.set(id, unsub);
      }catch(e){}
    }
  }
  function clearFriendListeners(){
    [friendsUnsub,friendReqUnsub,sentFriendUnsub].forEach(u=>{ try{ if(u) u(); }catch(e){} });
    friendsUnsub=friendReqUnsub=sentFriendUnsub=null;
    clearFriendProfileListeners();
  }
  const shownFriendCards=new Set();
  function attachFriendListeners(){
    clearFriendListeners();
    friendsUnsub=db.collection('friendships').where('members','array-contains',uid()).limit(200).onSnapshot(async s=>{
      const others=s.docs.map(d=>(d.data().members||[]).find(m=>m!==uid())).filter(Boolean);
      await ensureProfiles(others);
      state.friends=others.map(id=>({uid:id,profile:state.profileCache.get(id)||{}}));
      syncFriendProfileListeners(others);
      renderFriends(); renderSidebar();
    },e=>console.error('friends',e));
    friendReqUnsub=db.collection('friendRequests').where('to','==',uid()).where('status','==','pending').limit(50).onSnapshot(async s=>{
      const rows=s.docs.map(d=>({id:d.id,...d.data()}));
      await ensureProfiles(rows.map(r=>r.from));
      state.friendRequests=rows;
      renderFriends(); renderSidebar();
      rows.slice(0,3).forEach(r=>{
        if(shownFriendCards.has(r.id)) return;
        shownFriendCards.add(r.id);
        showStickyNotice(`fr_${r.id}`,`${r.fromName||'친구'}님이 친구를 신청했어요`,'수락하면 서로 친구가 돼요.',
          `<button type="button" class="sticky-btn primary" data-action="friend-accept" data-id="${esc(r.id)}">수락</button><button type="button" class="sticky-btn ghost" data-action="friend-decline" data-id="${esc(r.id)}">거절</button>`);
      });
    },e=>console.error('friend requests',e));
    sentFriendUnsub=db.collection('friendRequests').where('from','==',uid()).where('status','==','pending').limit(50).onSnapshot(s=>{
      state.sentRequests=s.docs.map(d=>({id:d.id,...d.data()}));
    },e=>console.error('sent friend requests',e));
  }
  async function requestFriend(targetUid,targetName){
    if(!targetUid||targetUid===uid()) return {ok:false,msg:'내 코드는 추가할 수 없어요.'};
    if(isFriend(targetUid)) return {ok:false,msg:'이미 친구예요.'};
    if(mySentRequestTo(targetUid)) return {ok:false,msg:'이미 친구 요청을 보냈어요.'};
    if(friendRequestFrom(targetUid)) return {ok:false,msg:'이 사람이 보낸 요청이 있어요. 친구 목록에서 받아 주세요.'};
    if(await hasBlockedMe(targetUid)) return {ok:false,msg:'친구 요청을 보낼 수 없어요.'};
    try{
      await db.collection('friendRequests').doc(`${uid()}_${targetUid}`).set({from:uid(),to:targetUid,fromName:state.profile?.displayName||'사용자',toName:targetName||'사용자',status:'pending',createdAt:ts()});
    }catch(e){ console.error(e); return {ok:false,msg:'친구 요청을 보낼 수 없어요.'}; }
    return {ok:true,msg:`${targetName||'상대방'}님에게 친구 요청을 보냈어요.`};
  }
  async function addFriendByCode(raw){
    const msg=$('#friendCodeMsg');
    const say=(t,cls)=>{ if(msg){ msg.textContent=t; msg.className='reset-msg'+(cls?' '+cls:''); } };
    const code=normalizeCode(raw);
    if(code.length<4) return say('친구 코드를 정확히 입력해 주세요.','warn');
    if(code===(state.profile?.userCode||'')) return say('내 코드는 추가할 수 없어요.','warn');
    say('코드를 확인하고 있어요…');
    let found=null;
    try{ found=await findUserByCode(code); }
    catch(e){ console.error(e); return say('코드를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.','warn'); }
    if(!found) return say('그 코드를 가진 사람을 찾지 못했어요.','warn');
    const name=(found.profile||{}).displayName||'사용자';
    const r=await requestFriend(found.uid,name);
    say(r.msg,r.ok?'ok':'warn');
  }
  function refreshFriendsModal(){
    const box=document.getElementById('friendCodeInput');
    if(!box) return;
    closeModal();
    openFriends();
  }
  async function acceptFriendRequest(id){
    const req=(state.friendRequests||[]).find(r=>r.id===id);
    if(!req){ dismissStickyNotice(`fr_${id}`); return toast('이미 처리된 요청이에요.'); }
    try{
      // 수락을 먼저 기록한 뒤 친구를 만든다 (수락 기록이 있어야 규칙을 통과한다)
      await db.collection('friendRequests').doc(id).update({status:'accepted',handledAt:ts()});
      await db.collection('friendships').doc(pairId(uid(),req.from)).set({members:[uid(),req.from].sort(),requestId:id,createdAt:ts()},{merge:true});
    }catch(e){ console.error(e); return toast(errText(e)); }
    dismissStickyNotice(`fr_${id}`);
    toast(`${req.fromName||'친구'}님과 친구가 됐어요.`);
    renderFriends(); renderSidebar();
    refreshFriendsModal();
  }
  async function declineFriendRequest(id){
    try{ await db.collection('friendRequests').doc(id).update({status:'declined',handledAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    dismissStickyNotice(`fr_${id}`);
    state.friendRequests=(state.friendRequests||[]).filter(r=>r.id!==id);
    renderFriends(); renderSidebar();
    refreshFriendsModal();
    toast('친구 요청을 거절했어요.');
  }
  async function removeFriend(otherUid){
    if(!otherUid) return;
    const name=state.profileCache.get(otherUid)?.displayName||'친구';
    confirmModal(`${name}님과 친구를 끊을까요?`,'서로 친구 목록에서 사라져요.',async()=>{
      try{ await db.collection('friendships').doc(pairId(uid(),otherUid)).delete(); }catch(e){ console.error(e); }
      try{ await db.collection('friendRequests').doc(`${uid()}_${otherUid}`).delete(); }catch(e){ console.error(e); }
      try{ await db.collection('friendRequests').doc(`${otherUid}_${uid()}`).delete(); }catch(e){ console.error(e); }
      state.friends=(state.friends||[]).filter(f=>f.uid!==otherUid);
      renderFriends(); renderSidebar();
      toast('친구를 끊었어요.');
      setTimeout(refreshFriendsModal,60);
    });
  }
  function friendRowHtml(f,compact){
    const p=f.profile||{};
    const name=p.displayName||'친구';
    const st=presenceStateOf(p);
    const dot=`<span class="presence-dot inline ${st||'hidden'}" aria-hidden="true"></span>`;
    const bio=esc(compact?(p.bio||'친구'):(gradeClassPrefix(p)+(p.bio||'친구')));
    const presLabel=st?presenceLabel(st):'오프라인';
    return `<button class="room" data-action="user-profile" data-uid="${esc(f.uid)}" data-name="${esc(name)}"><div>${avatarHtml(p,'',true)}</div><div class="room-main"><div class="room-name">${esc(name)} ${dot}</div><div class="room-sub">${bio} · ${esc(presLabel)}</div></div></button>`;
  }
  function renderFriends(){
    const hosts=$$('#friendList'); if(!hosts.length) return;
    const reqs=state.friendRequests||[], friends=state.friends||[];
    const reqHtml=reqs.slice(0,3).map(r=>`<div class="list-item" data-uid="${esc(r.from)}"><div>${avatarHtml(state.profileCache.get(r.from)||{displayName:r.fromName})}</div><div class="grow"><div class="title">${esc(r.fromName||'사용자')}</div><div class="meta">친구 요청</div></div><button class="soft-btn" style="flex:0 0 48px" data-action="friend-accept" data-id="${esc(r.id)}">받기</button></div>`).join('');
    const listHtml=friends.slice(0,20).map(f=>friendRowHtml(f,true)).join('');
    const moreHtml=friends.length>20?`<button class="soft-btn" style="width:100%;margin-top:6px" data-action="friends">친구 ${friends.length}명 모두 보기</button>`:'';
    hosts.forEach(h=>{ h.innerHTML=(reqHtml||'')+(listHtml||(reqs.length?'':'<div class="empty-side">아직 친구가 없어요.</div>'))+moreHtml; });
  }
  function openFriends(){
    const reqs=state.friendRequests||[], friends=state.friends||[];
    openModal(`<h2>친구</h2><p class="desc">친구 코드를 서로 알려 주고 친구가 되어 보세요. 친구는 채팅방에 바로 초대할 수 있어요.</p>
      <div class="field"><label>친구 코드로 추가</label><div class="row" style="align-items:center"><input id="friendCodeInput" class="input code-input" maxlength="12" autocomplete="off" spellcheck="false" placeholder="예: K7M3QP"><button type="button" class="soft-btn" style="flex:0 0 76px" data-action="friend-add">추가</button></div><p id="friendCodeMsg" class="reset-msg"></p></div>
      ${reqs.length?`<div class="field"><label>받은 친구 요청 (${reqs.length})</label><div class="list">${reqs.map(r=>`<div class="list-item"><div>${avatarHtml(state.profileCache.get(r.from)||{displayName:r.fromName})}</div><div class="grow"><div class="title">${esc(r.fromName||'사용자')}</div><div class="meta">친구가 되고 싶어 해요</div></div><div class="pair-btns"><button class="soft-btn" style="flex:0 0 52px" data-action="friend-accept" data-id="${esc(r.id)}">수락</button><button class="soft-btn" style="flex:0 0 52px" data-action="friend-decline" data-id="${esc(r.id)}">거절</button></div></div>`).join('')}</div></div>`:''}
      <div class="field"><label>내 친구 (${friends.length})</label><div class="list">${friends.map(f=>{const p=f.profile||{};const nm=p.displayName||'친구';const st=presenceStateOf(p);const pres=st?presenceLabel(st):'오프라인';const dot=presenceDot(p);return `<div class="list-item" data-uid="${esc(f.uid)}"><div>${avatarHtml(p,'',true)}</div><div class="grow"><div class="title">${esc(nm)} ${dot}</div><div class="meta">${gradeClassPrefix(p)}${esc(p.bio||'')} · ${esc(pres)}</div></div><button class="soft-btn" style="flex:0 0 60px" data-action="user-profile" data-uid="${esc(f.uid)}" data-name="${esc(nm)}">프로필</button><button class="soft-btn" style="flex:0 0 48px" data-action="friend-remove" data-uid="${esc(f.uid)}">끊기</button></div>`;}).join('')||'<div class="empty-side">아직 친구가 없어요.</div>'}</div></div>
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
  }
  function showNoticePopup(n){openModal(`<h2>안내가 왔어요</h2><p class="desc">${esc(n.text)}</p><div class="modal-actions"><button class="confirm" data-action="read-notice" data-id="${esc(n.id)}">확인</button></div>`,{small:true});}
  async function readNotice(id){if(!id)return;try{await db.collection('directNotices').doc(id).update({read:true,readAt:ts()});}catch(e){console.error(e);}closeModal();}

  // ---- 내 프로필 공개정보 동기화 + 접속(IP) 기록 ----
  async function backfillPublicProfile(){
    const p=state.profile; if(!p) return;
    const base={displayName:p.displayName||'사용자',grade:p.grade??null,classNum:p.classNum??null,photoURL:p.photoURL||'',avatarEmoji:p.avatarEmoji||'',avatarColor:p.avatarColor||'',bio:p.bio||'',schoolId:p.schoolId||'',schoolName:p.schoolName||'',updatedAt:ts()};
    try{ await putPublicProfile({...base,invitePolicy:p.invitePolicy||'ask'}); }
    catch(e){ console.error('profile sync',e); }
    startPresence();
  }
  async function recordLoginInfo(){
    try{
      const ip=await fetchClientIp();
      const first=state.profile?.loginCount==null;
      await db.collection('users').doc(uid()).update({ lastLoginAt:ts(), loginCount:firebase.firestore.FieldValue.increment(1), updatedAt:ts() });
      // IP·UA는 감사 분리 문서에만 둔다 (같은 학교 관리자 눈에 안 띄게)
      try{
        const priv={ lastUserAgent:String(navigator.userAgent||'').slice(0,300), updatedAt:ts() };
        if(ip){ priv.lastLoginIp=ip; if(first) priv.signupIp=ip; }
        await db.collection('userPrivate').doc(uid()).set(priv, {merge:true});
      }catch(e){ console.warn('login private record',e); }
    }catch(e){ console.error('login record',e); }
  }

  // ---- 로그인 화면 안내 페이지 (관리자 작성 / 로그인 전에도 읽기) ----
  let sitePagesUnsub=null;
  function attachSitePagesListener(){
    if(sitePagesUnsub) return;
    sitePagesUnsub=db.collection('sitePages').doc('main').onSnapshot(s=>{
      const d=s.exists?(s.data()||{}):{};
      state.sitePages=Array.isArray(d.pages)?d.pages.filter(p=>p&&p.id).slice(0,8).map(p=>({
        id:String(p.id).slice(0,40),
        label:String(p.label||'').slice(0,30),
        title:String(p.title||'').slice(0,60),
        html:typeof p.html==='string'?p.html:'',
        enabled:p.enabled!==false,
        buttons:(Array.isArray(p.buttons)?p.buttons:[]).slice(0,6).map(b=>({label:String(b?.label||'').slice(0,24),url:String(b?.url||'').slice(0,PAGE_BTN_URL_MAX)}))
      })):null;
      // 이미 그려진 로그인 화면의 링크만 조용히 갱신 (화면 전환 모션을 다시 재생하지 않도록)
      document.querySelectorAll('.auth-links').forEach(x=>{ x.innerHTML=authLinkButtons(); });
    },e=>console.warn('sitePages',e));
  }
  attachSitePagesListener();

  // ---- 소개(랜딩) 페이지 설정 (관리자 작성 / 로그인 전에도 읽기) ----
  let landingUnsub=null, landingReady=null, landingResolve=null;
  function attachLandingListener(){
    if(landingUnsub) return;
    landingReady=new Promise(r=>{ landingResolve=r; });
    const done=()=>{ const r=landingResolve; landingResolve=null; if(r) r(); };
    landingUnsub=db.collection('siteLanding').doc('main').onSnapshot(s=>{
      const cfg=normalizeLanding(s.exists?s.data():null);
      const changed=JSON.stringify(cfg)!==state.landingSig;
      state.landing=cfg;
      done();
      if(!changed || state.view!=='landing') return;
      // 보고 있는 중에 설정이 바뀌면 바로 반영한다
      if(cfg.enabled) renderLanding();
      else { state.landingRequested=true; loadSchoolList(true).catch(()=>{}); renderAuth(); }
    },e=>{
      console.warn('siteLanding',e);
      state.landing=cloneLanding();
      done();
    });
  }
  attachLandingListener();

  // ---- 사이트 공지 (관리자 작성 / 전체 공개) ----
  let siteNoticeUnsub=null;
  function clearSiteNoticeListener(){ if(siteNoticeUnsub){ try{siteNoticeUnsub();}catch{} siteNoticeUnsub=null; } }
  function attachSiteNoticeListener(){
    clearSiteNoticeListener();
    siteNoticeUnsub=db.collection('siteNotices').doc('main').onSnapshot(s=>{
      const d=s.exists?s.data():{};
      state.siteNotice={
        banner:{...DEFAULT_SITE_NOTICE.banner,...(d.banner||{}),updatedAt:d.updatedAt},
        popup:{...DEFAULT_SITE_NOTICE.popup,...(d.popup||{}),updatedAt:d.updatedAt},
        bottom:{...DEFAULT_SITE_NOTICE.bottom,...(d.bottom||{}),updatedAt:d.updatedAt}
      };
      renderSiteBanner();
      renderMainBottom();
      maybeShowSiteNoticePopup();
    },e=>console.error('site notice',e));
  }
  // 7번: 메인 하단 관리자 한마디 (채팅 입력창 바로 위, 글자 크기 조절)
  function renderMainBottom(){
    const hosts=$$('#mainBottom'); if(!hosts.length) return;
    const b=state.siteNotice?.bottom;
    const body=(b&&b.enabled)?String(b.html||'').trim():'';
    hosts.forEach(host=>{
      if(!body){ host.classList.add('hidden'); host.innerHTML=''; return; }
      host.classList.remove('hidden');
      host.style.color=safeColor(b.textColor);
      host.style.background=safeColor(b.bgColor);
      host.style.textAlign=safeAlign(b.align);
      host.style.fontSize=clampSize(b.fontSize,11,24,13)+'px';
      host.innerHTML=`<div class="main-bottom-inner">${sanitizeRichHtml(body)}</div>`;
    });
  }
  function renderSiteBanner(){
    const hosts=$$('#siteBanner'); if(!hosts.length) return;
    const b=state.siteNotice?.banner;
    const body=(b&&b.enabled)?String(b.html||'').trim():'';
    hosts.forEach(host=>{
      if(!body){ host.classList.add('hidden'); host.innerHTML=''; return; }
      host.classList.remove('hidden');
      host.style.color=safeColor(b.textColor);
      host.style.background=safeColor(b.bgColor);
      host.style.textAlign=safeAlign(b.align);
      host.style.fontSize=clampSize(b.fontSize,11,20,14)+'px';
      const link=String(b.linkText||'').trim()
        ? `<button type="button" class="site-banner-link" data-action="notice-link" data-url="${esc(b.linkUrl||'')}">${esc(b.linkText)}</button>` : '';
      host.innerHTML=`<div class="site-banner-inner">${sanitizeRichHtml(body)}${link}</div>`;
    });
  }
  function maybeShowSiteNoticePopup(){
    const p=state.siteNotice?.popup;
    if(!p||!p.enabled) return;
    if(!String(p.html||'').trim()) return;
    if(modalStack.length) return;
    if(state.profile?.role==='student' && (!state.profile.grade||!state.profile.classNum)) return;
    const key='edutalk_site_notice_'+String(p.updatedAt||'v1');
    try{ if(sessionStorage.getItem(key)) return; sessionStorage.setItem(key,'1'); }catch(e){}
    const primary=String(p.primaryText||'').trim()
      ? `<button class="confirm" data-action="notice-link" data-url="${esc(p.primaryUrl||'')}">${esc(p.primaryText)}</button>`
      : '<button class="confirm" data-close-modal>확인</button>';
    const secondary=String(p.secondaryText||'').trim() ? `<button class="cancel" data-close-modal>${esc(p.secondaryText)}</button>` : '';
    openModal(`<h2>${esc(p.title||'안내')}</h2><div class="desc site-notice-body" style="color:${safeColor(p.textColor)||'var(--sub)'};text-align:${safeAlign(p.align)};font-size:${clampSize(p.fontSize,11,20,15)}px">${sanitizeRichHtml(p.html)}</div><div class="modal-actions">${secondary}${primary}</div>`);
  }
  function openNoticeLink(url){
    const u=String(url||'').trim();
    if(/^https?:\/\//i.test(u)) window.open(u,'_blank','noopener');
    else if(u) toast('주소를 확인해 주세요.');
    closeModal();
  }

  // 방을 빠르게 여러 번 열면 먼저 시작한 호출이 뒤늦게 끝나 화면을 덮어쓸 수 있으므로
  // 마지막으로 시작한 호출만 살아남도록 토큰을 쓴다
  let roomOpenToken=0;
  // 메시지 목록은 최신 300개부터 보여주고, '이전 메시지 더 보기'로 넓혀간다
  const MSG_PAGE=300, MSG_MAX_LIMIT=3000;

  // ---------- History 라우팅 (뒤로가기/제스처 완화) ----------
  function pushRoomHistory(roomId){
    try{
      const url = roomId ? location.pathname + '?room=' + encodeURIComponent(roomId) : location.pathname;
      if(location.href.endsWith(url)) return;
      history.pushState({roomId: roomId||null}, '', url);
    }catch(e){}
  }
  function replaceRoomHistory(roomId){
    try{
      const url = roomId ? location.pathname + '?room=' + encodeURIComponent(roomId) : location.pathname;
      history.replaceState({roomId: roomId||null}, '', url);
    }catch(e){}
  }
  function initHistoryRouting(){
    try{ history.replaceState({roomId: state.room?.id||null, settings: state.view==='settings'}, '', location.href); }catch(e){}
    window.addEventListener('popstate', (e)=>{
      const st = e.state;
      const urlParams = new URLSearchParams(location.search);
      const urlRoom = urlParams.get('room');
      const urlSettings = urlParams.get('settings');
      const targetRoom = (st && st.roomId) || urlRoom;
      const isSettings = (st && st.settings) || urlSettings==='1';
      if(isSettings){
        if(state.view!=='settings') openSettings(state.settingsTab||'display');
        return;
      }
      if(state.view==='settings'){
        // 설정 닫기
        closeSettings();
        // if also has room target, open it after closing settings
        if(targetRoom && state.view!=='settings'){
          setTimeout(()=>{ if(state.room?.id !== targetRoom) openRoom(targetRoom, {fromHistory:true}); }, 50);
        }
        return;
      }
      if(targetRoom){
        if(state.room?.id !== targetRoom) openRoom(targetRoom, {fromHistory:true});
      } else {
        if(state.room){
          state.room=null;
          document.body.classList.remove('m-chat-open');
          try{ clearRoomListener(); }catch(_){}
          try{ const chat=document.getElementById('chat'); if(chat) chat.innerHTML=emptyChat(); }catch(_){}
          try{ renderRooms(); }catch(_){}
        }
      }
    });
  }
  function checkUrlForRoom(){
    try{
      const r = new URLSearchParams(location.search).get('room');
      if(r && state.user && state.profile){
        setTimeout(()=>{ if(!state.room || state.room.id!==r) openRoom(r, {fromHistory:true}); }, 400);
      }
      // settings는 URL로 자동 오픈하지 않음 (새로고침 시 설정이 계속 뜨는 문제 방지)
    }catch(e){}
  }

  async function openRoom(id, opts){
    const token=++roomOpenToken;
    let room=state.rooms.find(r=>r.id===id);
    if(!room){
      try{
        const s=await db.collection('channels').doc(id).get();
        if(!s.exists){ toast('채팅방을 찾지 못했어요.'); if(!fromHistory) try{ history.replaceState({},'', location.pathname); }catch(_){} return; }
        const data=s.data()||{};
        const mySid=state.profile?.schoolId||'';
        const isMember = Array.isArray(data.memberIds) && data.memberIds.includes(uid());
        try{ if(isMember) unmarkRoomLeft(id); }catch(e){}
        try{
          if(!isMember && !isAdmin() && isRoomLeft(id)){
            openModal(`<h2>나온 채팅방이에요</h2><p class="desc">이미 나온 채팅방은 다시 볼 수 없어요. 다시 초대받으면 들어갈 수 있어요.</p><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
            if(!fromHistory) try{ history.replaceState({},'', location.pathname); }catch(_){}
            return;
          }
        }catch(e){}
        const sameSchool = !data.schoolId || !mySid || data.schoolId===mySid;
        const canRead = isAdmin() || isMember || (sameSchool && (data.visibility==='all' || data.createdBy===uid()));
        if(!canRead){
          openModal(`<h2>권한이 없어요</h2><p class="desc">이 채팅방은 다른 학교 전용이에요. 우리 학교 채팅방만 들어갈 수 있어요.</p><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
          if(!fromHistory) try{ history.replaceState({},'', location.pathname); }catch(_){}
          return;
        }
        if(!isMember && !isAdmin()){
          try{ if(isRoomLeft(id)) return; }catch(e){}
        }
        room={id,...data}; state.rooms=[room,...state.rooms];
      }catch(e){
        if(e && e.code==='permission-denied'){
          openModal(`<h2>권한이 없어요</h2><p class="desc">이 채팅방은 다른 학교 전용이에요. 우리 학교 채팅방만 들어갈 수 있어요.</p><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
          if(!fromHistory) try{ history.replaceState({},'', location.pathname); }catch(_){}
          return;
        }
        console.error(e); return;
      }
    } else {
      const mySid=state.profile?.schoolId||'';
      const isMember = Array.isArray(room.memberIds) && room.memberIds.includes(uid());
      try{ if(isMember) unmarkRoomLeft(id); }catch(e){}
      try{
        if(!isMember && !isAdmin() && isRoomLeft(id)){
          state.rooms=(state.rooms||[]).filter(r=>r.id!==id);
          try{ renderRooms(); }catch(e){}
          openModal(`<h2>나온 채팅방이에요</h2><p class="desc">이미 나온 채팅방은 다시 볼 수 없어요. 다시 초대받으면 들어갈 수 있어요.</p><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
          if(!fromHistory) try{ history.replaceState({},'', location.pathname); }catch(_){}
          return;
        }
      }catch(e){}
      const sameSchool = !room.schoolId || !mySid || room.schoolId===mySid;
      const canRead = isAdmin() || isMember || (sameSchool && (room.visibility==='all' || room.createdBy===uid()));
      if(!canRead){
        openModal(`<h2>권한이 없어요</h2><p class="desc">이 채팅방은 다른 학교 전용이에요.</p><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
        if(!fromHistory) try{ history.replaceState({},'', location.pathname); }catch(_){}
        return;
      }
    }
    if(token!==roomOpenToken) return;   // 그 사이 다른 방을 열었으면 이 호출은 버린다
    try{ const prevTa=document.getElementById('composerText'); if(prevTa && state.room?.id) saveDraft(state.room.id, prevTa.value); }catch(e){}
    state.room=room; state.unread[id]=0; try{ renderUnreadSummary(); }catch(e){} state.replyText=null; state.selectMode=false; state.selected=new Set(); state.revealedAttach=new Set(); closeDrawer(); closeFloatMenu();
    state.editingId=null; state.sending=false;
    if(window.innerWidth<=820) document.body.classList.add('m-chat-open');
    stopTyping(); state.typingCooldownUntil=0; state.mentionTriedKey='';
    state.searchMode=false; state.searchQuery=''; state.searchHits=[]; state.searchIndex=-1; state.unreadMarkerId=null; state.awayMsgId=null; state.scrollToMarker=false; state.justOpenedRoom=true;
    state.msgLimit=MSG_PAGE; state.msgExhausted=false; state.msgLoading=false; state.msgPaging=false;
    state.memberQuery='';
    // 방을 옮기면 캐시를 비운다 (대용량 청크·투표 집계가 무한히 쌓이지 않게)
    state.pollVotes=new Map(); state.pollFetching=new Set();
    if(state.attachCache instanceof Map&&state.attachCache.size>20) state.attachCache=new Map();
    if(state.attachFetching instanceof Set&&state.attachFetching.size>20) state.attachFetching=new Set();
    const focus=(state.reportFocus&&state.reportFocus.roomId===id)?state.reportFocus:null;
    state.reportFocus=null; state.reportTargetId=focus?focus.msgId:null;
    const gb=$('#globalBanner'); if(gb){gb.classList.remove('show');clearTimeout(state.banner.timer);} hideInRoomPill(); renderRooms();
    ensureJoinCodeMapping(room);
    // 학교 전체 공개방 자동 입장: 나간 기록이 있는 방은 다시 들어가지 않는다 (나간 뒤 조회 차단)
    try{ if((room.memberIds||[]).includes(uid())) unmarkRoomLeft(id); }catch(e){}
    let leftBlocked=false;
    try{ leftBlocked=isRoomLeft(id) && !(room.memberIds||[]).includes(uid()); }catch(e){}
    // 학교 전체 공개방은 열람·발언 권한과 명단을 일치시키기 위해 열 때 자동으로 들어간다 (총관리자·나간 방 제외)
    if(!leftBlocked && room.visibility==='all' && !isAdmin() && !(room.memberIds||[]).includes(uid())){
      room.memberIds=[...(room.memberIds||[]),uid()];
      try{ unmarkRoomLeft(id); }catch(e){}
      db.collection('channels').doc(id).update({memberIds:firebase.firestore.FieldValue.arrayUnion(uid()),updatedAt:ts()}).catch(()=>{});
    }
    await markRead(id);
    if(token!==roomOpenToken) return;
    clearRoomListener();
    renderChatFrame(room);
    try{ restoreDraftToComposer(id); }catch(e){}
    // 메시지가 오기 전 빈 화면 대신 반짝이는 말풍선 틀을 보여준다
    try{ const mh=$('#messages'); if(mh) mh.innerHTML=chatSkeletonHtml(); }catch(e){}
    startLockTick();
    state.seenMsgIds=new Set();
    state.bubbleAnims=new Map();
    attachRoomDocListener(id);
    attachMessageListener(id,token,{initial:true});
    attachTypingListener(id);
    attachReadsListener(id);
    attachAttendanceListener(id);
    attachFlagListener(id);
    if(!fromHistory) pushRoomHistory(id);
  }
  // 2번: 신고 집계 리스너 — 블라인드 반영 + 담임/교사에게 "OOO 메시지에 신고 N건" 알림
  let flagUnsub=null;
  function clearFlagListener(){ if(flagUnsub){ try{flagUnsub();}catch(e){} flagUnsub=null; } state.flagMap=new Map(); }
  function attachFlagListener(roomId){
    clearFlagListener();
    let firstSync=true;
    try{
      flagUnsub=db.collection('messageFlags').where('roomId','==',roomId).onSnapshot(s=>{
        const map=new Map();
        s.docs.forEach(d=>{ const v=d.data()||{}; if(v.msgId) map.set(v.msgId,{count:Number(v.count||0),blinded:!!v.blinded,targetName:v.targetName||'',roomName:v.roomName||''}); });
        const prev=state.flagMap||new Map();
        state.flagMap=map;
        if(state.room?.id===roomId) renderMessages(false);
        // 같은 학교 교사에게만 알린다 (총관리자 제외 · 처음 붙을 때는 조용히 기준만 잡는다)
        try{
          const isFirst=firstSync; firstSync=false;
          const mySid=state.profile?.schoolId||'';
          const roomSid=state.room?.id===roomId?(state.room?.schoolId||''):'';
          const mine=mySid&&roomSid&&mySid===roomSid&&(state.profile?.role==='teacher'||state.profile?.role==='school_admin');
          if(!isFirst&&mine){
            map.forEach((v,mid)=>{
              const old=prev.get(mid);
              const oldC=Number(old?.count||0), newC=Number(v.count||0);
              if(newC>oldC&&newC>=1){
                const label=`'${state.room?.name||v.roomName||'채팅방'}' ${v.targetName||'메시지'}에 신고 ${newC}건이 접수되었습니다`;
                // 채팅방으로 들어가지 않고 신고 관리로 간다 (방에 없는 교사도 방에 끌려들어가지 않게)
                if(newC>=REPORT_BLIND_COUNT) showStickyNotice(`report_${mid}_${newC}`,'신고가 쌓였어요',label,`<div class="sticky-btns"><button type="button" class="sticky-btn primary" data-action="reports">신고 관리 열기</button></div>`);
                try{ notifyMessage('',{name:'에듀톡'},{senderId:'report',senderName:'신고 알림',text:label,createdAt:new Date()}); }catch(e){}
              }
            });
          }
        }catch(e){}
      },e=>{ /* 플래그 읽기 실패는 조용히 (규칙 배포 전) */ });
    }catch(e){}
  }
  // 2번: 블라인드 복구/삭제 확정 — 바로 실행하지 않고 카운트 팝업으로 확인
  function countConfirm({title,desc,confirmLabel,seconds}){
    return new Promise(res=>{
      const secs=Math.min(10,Math.max(1,Number(seconds)||3));
      const panel=openModal(`<h2>${esc(title)}</h2><p class="desc">${esc(desc)}</p><div class="modal-actions"><button class="cancel" id="ccNo">취소</button><button class="confirm" id="ccYes" disabled style="opacity:.5">${esc(confirmLabel||'확인')} (${secs})</button></div>`,{small:true,dismissible:false});
      let n=secs; const btn=panel.querySelector('#ccYes');
      const timer=setInterval(()=>{
        n--;
        if(!document.body.contains(btn)){ clearInterval(timer); return; }
        if(n<=0){ clearInterval(timer); btn.disabled=false; btn.style.opacity='1'; btn.textContent=confirmLabel||'확인'; }
        else btn.textContent=`${confirmLabel||'확인'} (${n})`;
      },1000);
      panel.querySelector('#ccNo').onclick=()=>{ clearInterval(timer); closeModal(); res(false); };
      btn.onclick=()=>{ clearInterval(timer); closeModal(); res(true); };
    });
  }
  async function restoreBlindMessage(msgId){
    const roomId=state.room?.id; if(!roomId||!msgId) return;
    if(!(isTeacherOrAdmin()||state.room?.createdBy===uid())) return toast('선생님·관리자만 복구할 수 있어요.');
    const ok=await countConfirm({title:'원본 메시지를 다시 띄울까요?',desc:'악성 장난으로 판단되면 복구해 주세요. 신고 기록은 남아 있어요.',confirmLabel:'복구하기'});
    if(!ok) return;
    try{
      await db.collection('channels').doc(roomId).collection('messages').doc(msgId).update({blinded:false,reportCount:0,blindUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      await db.collection('messageFlags').doc(`${roomId}_${msgId}`).set({blinded:false,count:0,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    }catch(e){ console.error(e); return toast(errText(e)); }
    toast('메시지를 복구했어요.');
  }
  async function confirmBlindDelete(msgId){
    const roomId=state.room?.id; if(!roomId||!msgId) return;
    if(!(isTeacherOrAdmin()||state.room?.createdBy===uid())) return toast('선생님·관리자만 삭제할 수 있어요.');
    const ok=await countConfirm({title:'유해 콘텐츠로 확정할까요?',desc:'삭제 확정하면 모두의 화면에서 사라지고 30일 뒤 완전히 파기돼요.',confirmLabel:'삭제 확정'});
    if(!ok) return;
    try{
      await db.collection('channels').doc(roomId).collection('messages').doc(msgId).update({...softDeletePatch(),text:'',attachment:null,staffDeleted:true,deletedBy:uid(),deletedByName:state.profile?.displayName||'',deletedByRole:state.profile?.role||''});
      await refreshLastTextAfterDelete(roomId,msgId);
    }catch(e){ console.error(e); return toast(errText(e)); }
    renderMessages(false);
    toast('삭제 확정했어요.');
  }
  function attachMessageListener(id,token,opts){
    if(roomUnsub){ try{roomUnsub();}catch(e){} roomUnsub=null; }
    const initial=!opts||opts.initial!==false;
    const onFirst=(opts&&opts.onFirst)||null;
    const ref=db.collection('channels').doc(id).collection('messages').orderBy('createdAt','asc').limitToLast(state.msgLimit||MSG_PAGE);
    let first=initial; roomUnsub=ref.onSnapshot(s=>{
      if(token!==roomOpenToken || state.room?.id!==id) return;   // 다른 방으로 옮겼으면 무시
      const oldCount=state.messages.length;
      state.messages=s.docs.map(d=>({id:d.id,...d.data()}));
      // 메시지가 늘거나 지워지면 검색 결과도 다시 계산한다 (개수 표시가 어긋나지 않게)
      if(state.searchMode) runRoomSearch(state.searchQuery);
      renderMessages(first);
      ensureCurrentProfiles();
      // 이전 메시지 더 보기로 넓히는 중에는 알림·읽음 처리를 건너뛴다 (옛날 메시지가 새 알림이 되지 않게)
      if(!first && !state.msgPaging && state.messages.length>oldCount){
        const latest=state.messages[state.messages.length-1];
        if(latest && !latest.system && latest.senderId!==uid() && !isBlockedMessage(latest)) notifyMessage(id,room,latest);
      }
      // 보고 있는 동안 새 메시지가 오면 읽음 위치를 갱신한다 (읽음 표시 · 안읽음 배지)
      if(!first && !state.msgPaging && state.messages.length>oldCount && !document.hidden && state.atBottom){
        const t=Date.now();
        if(t-(state.readWriteAt||0)>1500){ state.readWriteAt=t; markRead(id); }
      }
      first=false;
      if(onFirst){ const cb=onFirst; try{ cb(); }catch(e){} state.msgPaging=false; }
    },e=>{console.error(e);toast('채팅을 불러오지 못했어요.');});
  }
  // 이전 메시지 더 보기 (읽기 범위를 넓혀 다시 구독한다)
  function loadMoreMessages(){
    const id=state.room?.id; if(!id||state.msgLoading||state.msgExhausted) return;
    if((state.msgLimit||MSG_PAGE)>=MSG_MAX_LIMIT) return;
    const host=$('#messages'); if(!host) return;
    const rows=host.querySelectorAll('.message-row[data-msg-id]');
    const anchorId=rows.length?rows[0].dataset.msgId:null;
    const anchorTop=rows.length?rows[0].getBoundingClientRect().top:null;
    const before=state.messages.length;
    state.msgLoading=true; state.msgPaging=true;
    state.msgLimit=Math.min(MSG_MAX_LIMIT,(state.msgLimit||MSG_PAGE)+MSG_PAGE);
    renderMessages(false);
    attachMessageListener(id,roomOpenToken,{initial:false,onFirst:()=>{
      state.msgLoading=false;
      // 더 넓혔는데 개수가 그대로면 처음까지 다 본 것이다
      if(state.messages.length<=before) state.msgExhausted=true;
      renderMessages(false);
      if(anchorId){
        const h=$('#messages');
        const el=h&&h.querySelector(`[data-msg-id="${anchorId}"]`);
        if(h&&el&&anchorTop!=null){ h.scrollTop+=el.getBoundingClientRect().top-anchorTop; }
      }
    }});
  }
  function attachTypingListener(id){
    clearTypingListener();
    try{
      typingUnsub=db.collection('channels').doc(id).collection('typing').onSnapshot(s=>{
        const now=Date.now(), list=[];
        s.docs.forEach(d=>{
          if(d.id===uid()) return;
          const v=d.data()||{};
          const at=docTs(v.at)||0;
          if(!at || now-at>9000) return;   // 오래된 표시는 무시한다
          list.push({id:d.id,name:v.name,photoURL:v.photoURL,avatarEmoji:v.avatarEmoji,avatarColor:v.avatarColor,at});
        });
        list.sort((a,b)=>(b.at||0)-(a.at||0));
        const key=list.map(x=>x.id+':'+x.at).join(',');
        const changed=key!==state.typingKey;
        state.typingUsers=list; state.typingKey=key;
        if(changed && state.room?.id===id) renderTypingIndicator();
      },e=>{ /* 입력 표시는 실패해도 조용히 넘어간다 */ });
    }catch(e){}
  }
  // 읽음 위치(reads) 구독: 이 방을 읽은 사람들의 마지막 읽은 시각을 모아 둔다
  let readsUnsub=null;
  function clearReadsListener(){
    if(readsUnsub){ try{ readsUnsub(); }catch(e){} readsUnsub=null; }
    state.roomReads=new Map();
  }
  function attachReadsListener(id){
    clearReadsListener();
    try{
      readsUnsub=db.collection('channels').doc(id).collection('reads').onSnapshot(s=>{
        const map=new Map();
        s.docs.forEach(d=>{ const v=d.data()||{}; const at=docTs(v.at); if(at) map.set(d.id,{at,name:v.name||'사용자'}); });
        state.roomReads=map;
        if(state.room?.id===id) scheduleProfileRerender();   // 읽음 표시를 다시 그린다
      },e=>{ /* 읽음 표시는 실패해도 조용히 넘어간다 */ });
    }catch(e){}
  }
  async function markRead(id){
    if(!id) return;
    try{
      await db.collection('users').doc(uid()).update({[`readAt.${id}`]:ts()});
      if(state.profile){ state.profile.readAt=state.profile.readAt||{}; state.profile.readAt[id]={toDate:()=>new Date()}; }
      // 읽음 표시를 켠 사람만 방에 내 읽음 시각을 남긴다 (끄면 서로 보이지 않는다)
      if(readReceiptsEnabled()){
        await db.collection('channels').doc(id).collection('reads').doc(uid()).set({at:ts(),name:state.profile?.displayName||'사용자'},{merge:true});
      }
    }catch(e){console.error(e)}
  }
  function renderChatFrame(room){
    const isMember = isAdmin() || room.createdBy===uid() || (room.memberIds||[]).includes(uid());
    const canInvite = isAdmin() || room.createdBy===uid();
    const share=roomShare(room);
    const count=(room.memberIds||[]).length;
    const warnPill=(!isStaff() && state.warnCount>0)?`<span class="warn-pill">경고 ${state.warnCount}/${warnLimit()}</span>`:'';
    const desk=[];
    desk.push(`<button type="button" class="head-btn" data-action="members" data-room-id="${esc(room.id)}" title="참여자 보기"><span class="hb-ico">👥</span><span class="hb-label">참여자</span><span class="hb-count">${count}</span></button>`);
    desk.push(`<button type="button" class="head-btn" data-action="toggle-search" title="메시지 검색"><span class="hb-ico">🔍</span><span class="hb-label">검색</span></button>`);
    if(canInvite) desk.push(`<button type="button" class="head-btn" data-action="invite" data-room-id="${esc(room.id)}" title="사람 초대하기"><span class="hb-ico">👤</span><span class="hb-label">사람 초대</span><span class="hb-plus">＋</span></button>`);
    if(isMember) desk.push(`<button type="button" class="icon-btn" data-action="manage-room" data-room-id="${esc(room.id)}" title="채팅방 설정" aria-label="채팅방 설정">⚙</button>`);
    const desc=esc(room.description||((room.type==='notice')?'안내와 공지가 올라와요.':'편하게 이야기해 보세요.'));
    $('#chat').innerHTML=`<header class="chat-head"><button type="button" class="icon-btn narrow-only mobile-back" data-action="mobile-back" aria-label="채팅 목록으로" title="채팅 목록으로">←</button><button type="button" class="icon-btn narrow-only" data-action="open-drawer" aria-label="채팅방 목록" title="채팅방 목록">▤</button><div class="chat-head-left"><div class="chat-title">${esc(room.name||'채팅방')}${sharePill(share)}${warnPill}</div><div class="chat-desc">${desc}</div></div><div class="head-actions wide-only">${desk.join('')}</div><button type="button" class="icon-btn narrow-only" data-action="room-menu" data-room-id="${esc(room.id)}" aria-label="채팅 메뉴" title="채팅 메뉴">☰</button></header><div class="chat-body${state.memberPanel?' panel-open':''}"><div class="chat-main">${selectBarHtml()}${state.searchMode?searchBarHtml():''}<div id="oldChatBar" class="old-chat-bar hidden">오래전 채팅을 보고 있어요.</div><div class="messages-wrap"><div id="messages" class="messages"></div><div id="newBanner" class="new-banner"></div></div>${composerHtml(room)}<button type="button" id="jumpBottomFab" class="jump-bottom-fab hidden" data-action="jump-bottom" aria-label="맨 아래로">↓</button></div><div class="mp-resizer" id="mpResizer" title="끌어서 폭 조절 (더블클릭하면 기본값)"></div><aside id="memberPanel" class="member-panel${state.memberPanel?' open':''}"><div class="member-panel-inner"><div class="member-panel-head"><strong>참여자 <span id="memberCount">${count}</span>명</strong><button type="button" class="icon-btn" data-action="close-members" aria-label="닫기">✕</button></div><div class="member-search"><input id="memberSearch" class="input" placeholder="이름 검색" autocomplete="off"></div><div id="memberList" class="member-list"></div></div></aside></div>`;
    wireMemberResizer();
    observeComposer();
    try{ renderMainBottom(); }catch(e){}
    const cm=$('#chat .chat-main');
    if(cm && !prefersReducedMotion()){ cm.classList.remove('room-enter'); void cm.offsetWidth; cm.classList.add('room-enter'); setTimeout(()=>cm.classList.remove('room-enter'),380); }
    if(state.memberPanel) renderMemberPanel();
  }
  // 입력창이 여러 줄로 커져도 마지막 메시지가 가려지지 않게 실제 높이를 --composer에 반영한다
  let composerRO=null;
  // 툭 끊기지 않게 textarea 높이를 부드럽게 늘리고 줄인다 (8번)
  function smoothComposerResize(ta){
    try{
      if(!ta) return;
      const prev=ta.style.height||'';
      ta.style.height='auto';
      const target=Math.min(120,ta.scrollHeight);
      if(prefersReducedMotion()){ ta.style.height=target+'px'; syncComposerHeight(); return; }
      // auto 경유로 transition이 끊기지 않게 이전값→목표값으로 1프레임에 걸쳐 적용
      if(prev && prev!=='auto'){ ta.style.height=prev; void ta.offsetHeight; }
      requestAnimationFrame(()=>{ ta.style.height=target+'px'; syncComposerHeight(); });
    }catch(e){ try{ ta.style.height=Math.min(120,ta.scrollHeight)+'px'; syncComposerHeight(); }catch(_){} }
  }
  function syncComposerHeight(){
    try{
      const bar=$('#chat .composer'); if(!bar) return;
      const kb=Number(String(getComputedStyle(document.documentElement).getPropertyValue('--kb')||'0').replace('px',''))||0;
      const h=Math.max(56,Math.round(bar.offsetHeight-kb));
      if(h>0 && h<320) document.documentElement.style.setProperty('--composer',h+'px');
    }catch(e){}
  }
  function observeComposer(){
    try{
      const comp=document.querySelector('.composer');
      if(comp && !document.getElementById('composerDraftHint')){
        const hint=document.createElement('div');
        hint.id='composerDraftHint';
        hint.className='composer-draft-hint';
        hint.textContent='임시저장됨';
        comp.appendChild(hint);
      }
    }catch(e){}

    try{
      if(composerRO){ try{ composerRO.disconnect(); }catch(e){} composerRO=null; }
      const bar=$('#chat .composer'); if(!bar) return;
      syncComposerHeight();
      updateCharCount();
      if(typeof ResizeObserver!=='undefined'){
        composerRO=new ResizeObserver(()=>syncComposerHeight());
        composerRO.observe(bar);
        const inner=bar.querySelector('.composer-inner'); if(inner) composerRO.observe(inner);
      }
    }catch(e){}
  }
  // ---------- 참여자 패널 폭 조절 ----------
  const MP_MIN=220, MP_MAX=580, MP_DEFAULT=320;
  function applyMemberPanelWidth(w){
    const v=Math.min(MP_MAX,Math.max(MP_MIN,Math.round(Number(w)||MP_DEFAULT)));
    state.mpanelWidth=v;
    if(window.innerWidth>820) document.documentElement.style.setProperty('--mpanel',v+'px');
    else document.documentElement.style.removeProperty('--mpanel');
    return v;
  }
  function initMemberPanelWidth(){
    let w=MP_DEFAULT;
    try{ const s=Number(localStorage.getItem('edutalk_mpanel')); if(s) w=s; }catch(e){}
    applyMemberPanelWidth(w);
  }
  function wireMemberResizer(){
    const rz=$('#mpResizer'); if(!rz) return;
    let dragging=false,startX=0,startW=0;
    const currentW=()=>state.mpanelWidth||MP_DEFAULT;
    rz.addEventListener('pointerdown',e=>{
      if(window.innerWidth<=820) return;
      dragging=true; startX=e.clientX; startW=currentW();
      rz.classList.add('dragging'); document.body.classList.add('resizing-panel');
      try{ rz.setPointerCapture(e.pointerId); }catch(err){}
      e.preventDefault();
    });
    rz.addEventListener('pointermove',e=>{ if(dragging) applyMemberPanelWidth(startW-(e.clientX-startX)); });
    const end=()=>{
      if(!dragging) return;
      dragging=false; rz.classList.remove('dragging'); document.body.classList.remove('resizing-panel');
      try{ localStorage.setItem('edutalk_mpanel',String(currentW())); }catch(e){}
    };
    rz.addEventListener('pointerup',end);
    rz.addEventListener('pointercancel',end);
    rz.addEventListener('dblclick',()=>{ applyMemberPanelWidth(MP_DEFAULT); try{ localStorage.setItem('edutalk_mpanel',String(MP_DEFAULT)); }catch(e){} });
  }
  initMemberPanelWidth();
  function openRoomMenu(roomId){
    const room=state.rooms.find(r=>r.id===roomId)||state.room; if(!room) return;
    const canInvite=isAdmin()||room.createdBy===uid();
    const isMember=isAdmin()||room.createdBy===uid()||(room.memberIds||[]).includes(uid());
    openModal(`<h2>채팅 메뉴</h2><p class="desc">${esc(room.name||'채팅방')}</p><div class="settings-list">
      <button class="list-item" data-action="members" data-room-id="${esc(room.id)}"><div class="grow"><div class="title">참여자 보기</div><div class="meta">${(room.memberIds||[]).length}명이 함께 있어요.</div></div><span>👥</span></button>
      <button class="list-item" data-action="toggle-search"><div class="grow"><div class="title">메시지 검색</div><div class="meta">이 채팅방에서 지난 대화를 찾아요.</div></div><span>🔍</span></button>
      ${canInvite?`<button class="list-item" data-action="invite" data-room-id="${esc(room.id)}"><div class="grow"><div class="title">사람 초대하기</div><div class="meta">초대 코드로 사람을 불러요.</div></div><span>👤</span></button>`:''}
      ${isMember?`<button class="list-item" data-action="manage-room" data-room-id="${esc(room.id)}"><div class="grow"><div class="title">채팅방 설정</div><div class="meta">알림, 참여자, 나가기 등을 관리해요.</div></div><span>⚙</span></button>`:''}
      </div><div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
  }
  // ---------- 채팅방 검색 (입력창이 검색창으로 바뀐다) ----------
  function toggleRoomSearch(force){
    if(!state.room) return;
    const on=(force===undefined)?!state.searchMode:!!force;
    state.searchMode=on;
    if(!on){ state.searchQuery=''; state.searchHits=[]; state.searchIndex=-1; }
    // 검색창은 입력창을 대체하지 않고 목록 위에 붙인다 (입력 초안·키보드 유지)
    let bar=$('#roomSearchBar');
    if(on){
      if(!bar){
        const tmp=document.createElement('div'); tmp.innerHTML=searchBarHtml();
        const node=tmp.firstElementChild;
        const main=$('#chat .chat-main');
        if(main && node){
          const anchor=$('#oldChatBar',main)||main.firstChild;
          main.insertBefore(node,anchor);
          bar=node;
        }
      }
      if(bar && !state.searchQuery) runRoomSearch($('#roomSearchInput')?.value||'');
      setTimeout(()=>$('#roomSearchInput')?.focus(),50);
    } else {
      if(bar) bar.remove();
      clearSearchHighlight(); renderMessages(false);
    }
  }
  function clearSearchHighlight(){
    const host=$('#messages'); if(!host) return;
    host.querySelectorAll('.msg-hit').forEach(el=>el.classList.remove('msg-hit','msg-hit-current'));
  }
  function runRoomSearch(q){
    state.searchQuery=q||'';
    const needle=String(q||'').trim().toLowerCase();
    if(!needle){ state.searchHits=[]; state.searchIndex=-1; clearSearchHighlight(); updateSearchCount(); return; }
    state.searchHits=state.messages.filter(m=>!m.deleted && !m.system && !isHiddenMsg(m.id) && !isBlockedMessage(m) && String(m.text||'').toLowerCase().includes(needle)).map(m=>m.id);
    state.searchIndex=state.searchHits.length-1; // 가장 최근 메시지부터 보여준다
    applySearchHighlight();
    updateSearchCount();
  }
  function updateSearchCount(){
    const el=$('#searchCount'); if(!el) return;
    el.textContent=state.searchHits.length?`${state.searchIndex+1}/${state.searchHits.length}`:'0/0';
  }
  function searchMove(dir){ // -1 = 이전(더 오래된 것), +1 = 다음(더 최근 것)
    const n=state.searchHits.length; if(!n) return;
    let i=state.searchIndex+dir;
    if(i<0) i=n-1;
    if(i>=n) i=0;
    state.searchIndex=i;
    applySearchHighlight();
    updateSearchCount();
  }
  function applySearchHighlight(){
    const host=$('#messages'); if(!host) return;
    clearSearchHighlight();
    const hits=state.searchHits||[]; if(!hits.length) return;
    hits.forEach((id,i)=>{
      const el=host.querySelector(`[data-msg-id="${esc(id)}"]`); if(!el) return;
      el.classList.add('msg-hit');
      if(i===state.searchIndex) el.classList.add('msg-hit-current');
    });
    const cur=hits[state.searchIndex];
    if(cur){ const el=host.querySelector(`[data-msg-id="${esc(cur)}"]`); if(el) el.scrollIntoView({block:'center'}); }
  }
  // ---------- 참여자 패널 (오른쪽에서 열린다) ----------
  function openMembersPanel(roomId){
    if(!state.room) return;
    state.memberPanel=true;
    state.memberQuery='';
    $('#chat .chat-body')?.classList.add('panel-open');
    const p=$('#memberPanel'); if(p) p.classList.add('open');
    renderMemberPanel();
  }
  function closeMembersPanel(){
    state.memberPanel=false;
    const body=$('#chat .chat-body'); if(body) body.classList.remove('panel-open');
    const p=$('#memberPanel'); if(p) p.classList.remove('open');
  }
  // 채팅방 참여자 = 명단(memberIds) 기준 (헤더 숫자와 목록이 일치해야 함)
  function roomParticipantIds(){
    const r=state.room; if(!r) return [];
    return [...new Set((r.memberIds||[]).filter(Boolean))];
  }
  async function renderMemberPanel(){
    const r=state.room; if(!r) return;
    const host=$('#memberList'); if(!host) return;
    const ids=roomParticipantIds();
    host.innerHTML='<div class="empty-side">불러오는 중이에요.</div>';
    await ensureProfilesAll(ids);
    // 관리자·교사는 'users' 문서에 역할이 들어 있어서 그걸로 정확히 표시한다
    // 검색어 입력 때마다 다시 읽지 않도록 방 단위로 캐시한다
    let roles={};
    if(state.memberRoles?.roomId===r.id&&state.memberRoles?.roles){ roles=state.memberRoles.roles; }
    else {
      await Promise.all(ids.slice(0,60).map(async u=>{
        try{ const s=await db.collection('users').doc(u).get(); if(s.exists) roles[u]=s.data(); }catch(e){}
      }));
      state.memberRoles={roomId:r.id,roles};
    }
    if(!state.room || state.room.id!==r.id) return;
    const staffView=isStaff();
    const visible=ids.filter(id=>{
      const role=(roles[id]||{}).role || (state.profileCache.get(id)||{}).role;
      return staffView || role!=='admin';
    });
    const hidden=ids.length-visible.length;
    // 헤더 숫자는 실제 목록에 뜬 사람 수와 일치시킨다
    const cnt=$('#memberCount'); if(cnt) cnt.textContent=String(visible.length);
    // 참여자 검색 (이름으로 필터)
    try{
      const ms=$('#memberSearch');
      if(ms && !ms.dataset.bound){ ms.dataset.bound='1'; ms.addEventListener('input',()=>{ state.memberQuery=ms.value||''; renderMemberPanel(); }); }
      if(ms && document.activeElement!==ms) ms.value=state.memberQuery||'';
    }catch(e){}
    const mq=String(state.memberQuery||'').trim();
    const shown=mq?visible.filter(id=>{ const p=state.profileCache.get(id)||{}; const nm=String((roles[id]||{}).displayName||p.displayName||''); return nm.includes(mq); }):visible;
    const openNote=r.visibility==='all'?'<div class="empty-side" style="text-align:left">우리 학교 전체에 열려 있는 채팅방이라 아래 목록 말고도 들어올 수 있어요.</div>':(r.visibility==='members'?'<div class="empty-side" style="text-align:left">초대받았거나 참가 코드로 들어온 사람만 있어요.</div>':'');
    host.innerHTML=openNote+(shown.map(id=>{
      const p=state.profileCache.get(id)||{};
      const acct=roles[id]||{};
      const role=acct.role||p.role;
      const nm=acct.displayName||p.displayName||'사용자';
      const st=presenceStateOf(p);
      const owner=id===r.createdBy;
      return `<div class="list-item tappable" data-action="user-profile" data-uid="${esc(id)}" data-name="${esc(nm)}"><div>${avatarHtml(p,'',true)}</div><div class="grow"><div class="title">${esc(nm)}${id===uid()?' (나)':''}${owner?' <span class="admin-chip">방장</span>':''}</div><div class="meta">${gradeClassPrefix({grade:acct.grade||p.grade,classNum:acct.classNum||p.classNum})}${roleLabel(role)} <span class="presence-dot inline ${st||'hidden'}" data-mem-dot="${esc(id)}" aria-hidden="true"></span><span class="presence-text" data-mem-text="${esc(id)}">${st?esc(presenceLabel(st)):''}</span></div>${roleChipsHtml(id)}</div></div>`;
    }).join('')||'<div class="empty-side">표시할 참여자가 없어요.</div>')
      +(hidden&&!staffView?`<div class="empty-side">관리자 ${hidden}명은 목록에 표시되지 않아요.</div>`:'');
  }
  // ---------- 마지막으로 읽은 위치 ----------
  function onReadVisibility(){
    if(document.hidden){
      const last=state.messages[state.messages.length-1];
      state.awayMsgId=last?last.id:null;
      return;
    }
    if(state.awayMsgId && state.room){
      const idx=state.messages.findIndex(m=>m.id===state.awayMsgId);
      if(idx>=0 && idx<state.messages.length-1){ state.unreadMarkerId=state.awayMsgId; state.scrollToMarker=true; }
      renderMessages(false);
    }
    state.awayMsgId=null;
  }

  function selectBarHtml(){
    if(!state.selectMode) return '';
    const n=(state.selected||new Set()).size;
    return `<div class="select-bar"><span class="grow">${n}개 선택했어요</span><button type="button" class="soft-btn" data-action="select-mine">내 최근 40개</button><button type="button" class="soft-btn" data-action="select-all-msgs">전부</button><button type="button" class="soft-btn" data-action="select-none-msgs">선택 취소</button><button type="button" class="danger-btn" style="flex:0 0 auto;height:34px;padding:0 14px;font-size:13px;border-radius:13px" data-action="delete-selected">지우기</button></div>`;
  }
  function selSet(){ if(!(state.selected instanceof Set)) state.selected=new Set(); return state.selected; }
  function refreshChatFrame(){
    if(!state.room) return;
    renderChatFrame(state.room);
    renderMessages(true);
  }
  function toggleSelectMode(){
    state.selectMode=!state.selectMode;
    state.selected=new Set();
    refreshChatFrame();
  }
  function selectMine(){
    const ids=state.messages.filter(m=>!m.deleted&&m.senderId===uid()).slice(-40).map(m=>m.id);
    state.selected=new Set(ids);
    refreshChatFrame();
    if(!ids.length) toast('내가 보낸 메시지가 없어요.');
  }
  function selectAllMessages(){
    const ids=state.messages.filter(canPickMsg).map(m=>m.id);
    state.selected=new Set(ids);
    refreshChatFrame();
    if(!ids.length) toast('지울 수 있는 메시지가 없어요.');
  }
  function clearSelection(){ state.selected=new Set(); state.selectMode=false; refreshChatFrame(); }
  function togglePick(id){
    if(!id) return;
    const set=selSet();
    if(set.has(id)) set.delete(id); else set.add(id);
    const btn=document.querySelector(`[data-msg-id="${esc(id)}"] .msg-pick`);
    if(btn) btn.classList.toggle('on',set.has(id));
    const bar=document.querySelector('.select-bar .grow');
    if(bar) bar.textContent=`${set.size}개 선택했어요`;
  }
  async function deleteSelectedMessages(){
    if(!state.room) return;
    const roomId=state.room.id;
    const list=[...selSet()].map(id=>state.messages.find(m=>m.id===id)).filter(canPickMsg);
    if(!list.length) return toast('지울 수 있는 메시지가 없어요.');
    const mine=list.filter(m=>m.senderId===uid());
    const others=list.filter(m=>m.senderId!==uid());
    const purge=list.filter(m=>canPurgeMsg(m)).slice(0,400);
    const hide=list.filter(m=>!canPurgeMsg(m)).slice(0,400);
    let desc;
    if(purge.length===list.length) desc='모두의 화면에서 사라져요. 되돌릴 수 없어요.';
    else if(purge.length) desc=`선택한 메시지 중 ${purge.length}개는 모두의 화면에서, 나머지 ${hide.length}개는 내 기기에서만 지워져요.`;
    else if(others.length) desc=`내가 보낸 메시지 ${mine.length}개는 지워지고, 다른 사람의 메시지 ${others.length}개는 ${state.profile?.displayName||'나'}님의 기기에서만 지워져요. 다른 사람에게는 그대로 보여요.`;
    else desc='내 화면에서만 사라져요. 다른 사람에게는 그대로 보여요.';
    confirmModal(`${list.length}개 메시지를 지울까요?`,desc,async()=>{
      try{
        const col=db.collection('channels').doc(roomId).collection('messages');
        if(purge.length){
          const batch=db.batch();
          const patch={...softDeletePatch(),text:'',attachment:null};
          purge.forEach(m=>batch.update(col.doc(m.id),patch));
          await batch.commit();
          await refreshLastTextAfterDelete(roomId,purge.map(m=>m.id));
        }
        if(hide.length) await hideMessages(hide, roomId);
      }catch(e){ console.error(e); return toast(errText(e)); }
      state.selected=new Set();
      state.selectMode=false;
      refreshChatFrame();
      toast(`${list.length}개 메시지를 지웠어요.`);
    });
  }
  // 채팅방 참여자 프로필을 미리 불러온다
  async function ensureProfilesAll(ids){
    const need=[...new Set((ids||[]).filter(id=>id && !state.profileCache.has(id)))].slice(0,300);
    for(let i=0;i<need.length;i+=40){
      await Promise.all(need.slice(i,i+40).map(async id=>{
        try{ const s=await db.collection('publicProfiles').doc(id).get(); if(s.exists) state.profileCache.set(id,s.data()); }
        catch(e){ console.error('profile',e); }
      }));
    }
  }
  // ---------- 채팅방별 입력 임시저장 (방을 옮기거나 사이트를 껐다 켜도 유지) ----------
  function draftKey(roomId){ return `edutalk_draft_${uid()}_${roomId}`; }
  function saveDraft(roomId, text){
    if(!roomId) return;
    try{
      const v=String(text||'');
      if(!v.trim()) localStorage.removeItem(draftKey(roomId));
      else localStorage.setItem(draftKey(roomId), v.slice(0,1500));
    }catch(e){}
  }
  function loadDraft(roomId){
    if(!roomId) return '';
    try{ return localStorage.getItem(draftKey(roomId))||''; }catch(e){ return ''; }
  }
  function clearDraft(roomId){ if(!roomId) return; try{ localStorage.removeItem(draftKey(roomId)); }catch(e){} }
  function restoreDraftToComposer(roomId){
    const ta=$('#composerText'); if(!ta||!roomId) return;
    const v=loadDraft(roomId);
    if(v){
      ta.value=v;
      ta.style.height='auto'; ta.style.height=Math.min(120,ta.scrollHeight)+'px';
      updateCharCount(); syncComposerHeight();
    }
  }
  // 채팅방 로딩 틀: 실제 메시지가 오기 전까지 반짝이는 말풍선을 보여준다
  // 목록형 로딩 스켈레톤 (글자만 두지 않고 반짝이게)
  function loadingShimmer(n){
    const rows=Math.min(5,Math.max(2,Number(n)||3));
    return `<div class="sk-rows" aria-hidden="true">${Array.from({length:rows},(_,i)=>`<div class="sk-row${i%2?' short':''}"></div>`).join('')}</div>`;
  }
  function chatSkeletonHtml(){    const widths=[72,48,64,38,70,52];
    return `<div class="sk-wrap" aria-hidden="true">${widths.map((w,i)=>{
      const mine=i%2===1;
      return `<div class="message-row${mine?' mine':''}"><div class="msg-side">${mine?'':'<span class="msg-avatar-spacer"></span>'}</div><div class="message-content"><div class="bubble sk-bubble"><span class="sk-line" style="width:${w}%"></span><span class="sk-line short"></span></div></div></div>`;
    }).join('')}</div>`;
  }
  function composerHtml(room){
    const canSend = room.type==='notice' ? isTeacher() : (isAdmin() || room.visibility==='all' || (room.memberIds||[]).includes(uid()));
    if(!canSend)return `<div class="composer"><div class="composer-inner centered">${room.type==='notice'?'이 공지방은 선생님이 안내를 올리는 곳이에요.':'이 채팅방에 참여하면 메시지를 보낼 수 있어요.'}</div></div>`;
    if(!isAdmin()){
      const lic = licenseActiveInfo();
      if(!lic.active){
        const msg = licenseFrozenMessage();
        return `<div class="composer"><div class="composer-inner centered compose-lock license-lock">⛔ <span>${esc(msg)}</span></div></div>`;
      }
    }
    const st=lockState();
    if(st.kind==='timeout'){
      const head=st.to.permanent
        ? '채팅 이용이 정지되어 있어요. 선생님이 풀어 줄 때까지 기다려 주세요.'
        : `타임아웃 중이에요 · 남은 시간 <b>${esc(fmtRemain(st.to.ms))}</b>`;
      return `<div class="composer"><div class="composer-inner centered compose-lock">⏳ <span>${head}</span>${st.to.reason?`<span class="lock-reason">사유: ${esc(st.to.reason)}</span>`:''}</div></div>`;
    }
    if(st.kind==='flood') return `<div class="composer"><div class="composer-inner centered compose-lock">메시지를 너무 빠르게 보냈어요<span class="lock-reason"><b>${Math.ceil(st.ms/1000)}초</b> 뒤에 다시 보낼 수 있어요.</span></div></div>`;
    if(st.kind==='chatoff') return `<div class="composer"><div class="composer-inner centered compose-lock">관리자가 채팅을 정지한 방이에요.<span class="lock-reason">지금은 대화할 수 없어요.</span></div></div>`;
    if(st.kind==='warn') return `<div class="composer"><div class="composer-inner centered compose-lock">경고가 ${warnLimit()}번 쌓여서 메시지를 보낼 수 없어요.<span class="lock-reason">선생님께 이야기해 주세요.</span></div></div>`;
    const rxToggle=(room.type==='notice' && isTeacher())
      ? `<button type="button" class="icon-btn ${state.noReactions?'off':''}" data-action="toggle-reactions" title="${state.noReactions?'이 공지는 공감을 받지 않아요':'이 공지는 공감을 받을 수 있어요'}" aria-label="공감 허용">${state.noReactions?'🚫':'🙂'}</button>`
      : '';
    const editBar=state.editingId?`<div class="edit-bar"><span>✏️ 메시지 수정 중</span><span class="grow">${esc((state.messages.find(x=>x.id===state.editingId)?.text||'').slice(0,60))}</span><button type="button" class="soft-btn" data-action="cancel-edit">취소</button></div>`:'';
    const taPlaceholder=state.editingId?'메시지를 수정해 보세요. (Enter로 저장)':'메시지를 입력해 주세요. (최대 1500자)';
    return `<div id="mainBottom" class="main-bottom hidden"></div><div class="composer">${editBar}<div id="mentionBox" class="mention-box hidden"></div><div class="char-count" id="charCount">0 / 1500</div><form id="composerForm" class="composer-inner"><button type="button" class="icon-btn" data-action="attach-file" title="파일·사진 보내기">＋</button>${rxToggle}<textarea id="composerText" name="text" rows="1" maxlength="1500" placeholder="${taPlaceholder}" enterkeyhint="send" autocomplete="off" autocapitalize="sentences"></textarea><button type="submit" class="send" aria-label="전송">${state.editingId?'✓':'↑'}</button></form><input type="file" id="chatFileInput" accept="image/*,.pdf,.txt,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip" hidden></div>`;
  }
  // ---------- @ 멘션 (입력창에서 @를 치면 참여자 목록이 떠서 골라 넣는다) ----------
  function mentionQuery(ta){
    const pos=ta.selectionStart ?? ta.value.length;
    const m=ta.value.slice(0,pos).match(/(^|[\s\n])@([^\s@]{0,20})$/);
    if(!m) return null;
    return { at: pos - m[2].length - 1, query: m[2] };
  }
  function mentionRows(q){
    const room=state.room; if(!room) return [];
    const me=uid(), needle=String(q||'').toLowerCase(), rows=[];
    roomParticipantIds().forEach(id=>{
      if(id===me) return;
      const p=state.profileCache.get(id)||{};
      const name=String(p.displayName||'').trim(); if(!name) return;
      if(needle && !name.toLowerCase().includes(needle)) return;
      rows.push({ id, name, p });
    });
    rows.sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    return rows.slice(0,100);
  }
  function hideMentionBox(){
    const b=$('#mentionBox');
    if(b){ b.classList.add('hidden'); b.innerHTML=''; }
    state.mention=null;
  }
  function updateMentionBox(){
    const ta=$('#composerText'), box=$('#mentionBox');
    if(!ta||!box) return;
    const q=mentionQuery(ta);
    if(!q){ hideMentionBox(); return; }
    const rows=mentionRows(q.query);
    if(!rows.length){
      hideMentionBox();
      // 참여자 정보를 아직 못 불러왔으면 불러온 뒤 한 번만 다시 시도한다
      const idsAll=roomParticipantIds();
      const key=idsAll.join(',');
      if(idsAll.length && state.mentionTriedKey!==key){
        state.mentionTriedKey=key;
        ensureProfilesAll(idsAll).then(()=>{ const t2=$('#composerText'); if(t2 && mentionQuery(t2)) updateMentionBox(); }).catch(()=>{});
      }
      return;
    }
    const cur=Math.min(state.mention?.index??0, rows.length-1);
    state.mention={ at:q.at, query:q.query, index:cur, rows };
    box.classList.remove('hidden');
    box.innerHTML=rows.map((r,i)=>`<button type="button" class="mention-item ${i===cur?'on':''}" data-action="mention-pick" data-idx="${i}"><span class="ma">${r.p.photoURL?`<img src="${esc(r.p.photoURL)}" alt="">`:esc(String(r.p.avatarEmoji||r.name.charAt(0)))}</span><span class="grow">${esc(r.name)}</span>${r.p.grade?`<span class="mini muted">${r.p.grade}학년${r.p.classNum?` ${r.p.classNum}반`:''}</span>`:''}</button>`).join('');
  }
  function pickMention(idx){
    const ta=$('#composerText'); if(!ta) return;
    const r=(state.mention?.rows||[])[Number(idx)]; if(!r) return;
    const q=mentionQuery(ta); if(!q) return;
    const pos=ta.selectionStart ?? ta.value.length;
    const ins='@'+r.name+' ';
    ta.value=ta.value.slice(0,q.at)+ins+ta.value.slice(pos);
    const caret=q.at+ins.length;
    ta.setSelectionRange(caret,caret);
    hideMentionBox();
    updateCharCount();
    ta.focus();
  }
  function mentionKeydown(e){
    const box=$('#mentionBox');
    if(!box || box.classList.contains('hidden')) return false;
    const rows=state.mention?.rows||[];
    if(!rows.length) return false;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();
      const next=((state.mention?.index??0)+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
      state.mention.index=next;
      $$('.mention-item',box).forEach((el,i)=>el.classList.toggle('on',i===next));
      return true;
    }
    if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); pickMention(state.mention?.index??0); return true; }
    if(e.key==='Escape'){ e.preventDefault(); hideMentionBox(); return true; }
    return false;
  }
  function searchBarHtml(){
    const n=(state.searchHits||[]).length;
    return `<div class="search-top" id="roomSearchBar"><span class="search-ico">🔍</span><input id="roomSearchInput" class="search-input" type="text" autocomplete="off" spellcheck="false" placeholder="메시지 검색" value="${esc(state.searchQuery||'')}"><span class="search-count" id="searchCount">${n?`${state.searchIndex+1}/${n}`:'0/0'}</span><button type="button" class="icon-btn sm" data-action="search-prev" title="이전 (더 오래된 메시지)" aria-label="이전">▲</button><button type="button" class="icon-btn sm" data-action="search-next" title="다음 (더 최근 메시지)" aria-label="다음">▼</button><button type="button" class="icon-btn sm" data-action="search-close" title="검색 닫기" aria-label="검색 닫기">✕</button></div>`;
  }
  // 실시간 글자수 (1200자부터 표시, 1500자 도달 시 경고색)
  function updateCharCount(){
    const ta=$('#composerText'), el=$('#charCount');
    if(!ta || !el) return;
    const n=(ta.value||'').length;
    el.textContent=`${n} / ${MSG_MAX_LEN}`;
    el.classList.toggle('show',n>=1200);
    el.classList.toggle('over',n>=MSG_MAX_LEN);
  }
  // 입력창만 다시 그린다 (잠금 상태 · 남은 시간 표시 갱신)
  // 교체 중이던 입력 텍스트·포커스가 날아가면 키보드가 내려가므로 반드시 보존한다
  function refreshComposer(){
    if(!state.room) return;
    const cur=$('#chat .composer'); if(!cur || !cur.parentNode) return;
    const prevTa=$('#composerText');
    const hadFocus=!!(prevTa && document.activeElement===prevTa);
    const draft=prevTa?prevTa.value:'';
    const tmp=document.createElement('div'); tmp.innerHTML=composerHtml(state.room);
    const next=tmp.querySelector('.composer'); if(!next) return;
    const nextBottom=tmp.querySelector('#mainBottom');
    cur.replaceWith(next);
    try{ const mb=$('#chat .chat-main #mainBottom'); if(mb&&nextBottom){ mb.replaceWith(nextBottom); renderMainBottom(); } }catch(e){}
    const ta=$('#composerText');
    if(ta && draft && ta.value!==draft){
      ta.value=draft;
      ta.style.height='auto'; ta.style.height=Math.min(120,ta.scrollHeight)+'px';
    }
    updateCharCount();
    if(ta && hadFocus){ try{ ta.focus({preventScroll:true}); }catch(fe){ try{ ta.focus(); }catch(_){} } }
    observeComposer();
  }
  // @닉네임 을 태그처럼 강조해서 보여 준다
  const mentionText = (t) => esc(t).replace(/@([^\s@<>&]{1,20})/g,'<span class="mention">@$1</span>');
  function bubbleInner(m){
    const att=m.attachment;
    const mine=m.senderId===uid();
    let head='';
    if(att&&att.kind==='poll') return pollCardHtml(m);
    if(att&&(att.data||att.chunked)&&fileExpired(m)){
      const canDel=typeof canPurgeMsg==='function'&&canPurgeMsg(m);
      return `<div class="attach-expired">보관 기한(${fileRetentionDays()}일)이 지나 볼 수 없어요.${canDel?` <button type="button" class="text-btn" data-action="delete-message" data-msg="${esc(m.id)}">지우기</button>`:''}</div>`;
    }
    const data=attachDataOf(m);
    if(att && (att.data||att.chunked)){
      if(att.kind==='image'){
        if(!data){
          head=`<div class="attach-loading" aria-label="사진을 불러오는 중">사진을 불러오는 중…</div>`;
        } else {
          const src=esc(safeImgSrc(data));
          if(!src) return m.text?`<span class="attach-text">${mentionText(m.text)}</span>`:'';
          const revealed=(state.revealedAttach instanceof Set) && state.revealedAttach.has(m.id);
          const guarded=!!att.risk && !mine && !revealed;
          if(guarded){
            head=`<div class="attach-guard" data-action="reveal-attach" data-msg="${esc(m.id)}"><img class="attach-img" src="${src}" alt="${esc(att.name||'사진')}"><span class="attach-guard-note">주의가 필요한 사진일 수 있어요<br><b>눌러서 보기</b></span></div>`;
          }else{
            head=`<img class="attach-img" src="${src}" alt="${esc(att.name||'사진')}" data-action="view-attach" data-msg="${esc(m.id)}">`;
          }
          if(att.risk && !mine) head+=`<span class="attach-risk-chip">주의가 필요한 사진일 수 있어요</span>`;
        }
      }
      else if(data){ const href=esc(safeFileHref(data)); if(href) head=`<a class="attach-card" href="${href}" download="${esc(att.name||'파일')}" data-action="download-attach"><span class="attach-ico">${attachIcon(att)}</span><span class="grow"><span class="attach-name">${esc(att.name||'파일')}</span><span class="attach-size">${esc(fmtBytes(att.size))}</span></span></a>`; }
      else head=`<div class="attach-loading" aria-label="파일을 불러오는 중">파일을 불러오는 중… (${esc(fmtBytes(att.size))})</div>`;
    }
    const urls = m.text ? extractUrls(m.text) : [];
    const body=m.text?`<span class="attach-text">${linkifyChatText(m.text)}</span>`:'';
    const previews = urls.length ? `<span class="lp-wrap">${urls.map(u=>linkPreviewCardHtml(u)).join('')}</span>` : '';
    return head+(head&&(body||previews)?`<br>`:'')+body+previews;
  }
  function attachIcon(att){
    const t=String(att?.type||'');
    if(t.startsWith('image/')) return '🖼️';
    if(t.includes('pdf')) return '📕';
    if(/zip|compressed/.test(t)) return '🗜️';
    if(/word|document/.test(t)) return '📘';
    if(/sheet|excel/.test(t)) return '📗';
    if(/presentation|powerpoint/.test(t)) return '📙';
    return '📎';
  }
  function fmtBytes(n){
    const v=Number(n)||0;
    if(v<1024) return v+'B';
    if(v<1024*1024) return (v/1024).toFixed(v<10240?1:0)+'KB';
    return (v/(1024*1024)).toFixed(1)+'MB';
  }
  function attachSummary(att){
    if(!att) return '';
    if(att.kind==='poll') return '📊 '+(att.poll?.q||'투표');
    return att.kind==='image'?'📷 사진':('📎 '+(att.name||'파일'));
  }
  // ---------- 메시지 공감 (이모지) ----------
  const REACTIONS=['👍','❤️','😄','⭐','🎉','😢'];
  // 감정 아이콘 커스텀: 아래 후보에서 최대 8개까지 골라 쓴다 (이미지 업로드는 메시지 용량 문제로 미지원)
  const RX_CHOICES=['👍','❤️','😄','⭐','🎉','😢','👏','🙏','💪','🔥','💯','✅','❌','❓','❗','💡','🎊','🥳','😭','😮','🤔','🤝','👀','💤','🍚','⚽','🎮','📚','🌧️','☀️','❄️','🌸','🍀','💫','✨','🥺','🤣','😴','👋','🙌'];
  function reactionEmojis(){
    const v=state.settings?.reactionEmojis;
    if(Array.isArray(v)){ const list=v.filter(e=>typeof e==='string'&&e&&[...e].length<=4).slice(0,8); if(list.length) return list; }
    return REACTIONS.slice();
  }
  function reactionsHtml(m){
    if(m.noReactions||m.system) return '';
    const rx=m.reactions||{};
    const keys=Object.keys(rx).filter(k=>Array.isArray(rx[k])&&rx[k].length);
    const chips=keys.map(k=>{
      const mine=rx[k].includes(uid());
      return `<button type="button" class="rx-chip${mine?' mine':''}" data-action="toggle-reaction" data-msg="${esc(m.id)}" data-emoji="${esc(k)}" title="공감">${esc(k)}<span class="rx-n">${rx[k].length}</span></button>`;
    }).join('');
    return `<div class="rx-row">${chips}</div>`;
  }
  async function setReaction(msgId,emoji){
    const m=state.messages.find(x=>x.id===msgId); if(!m||!emoji||!state.room) return;
    if(m.noReactions) return toast('이 메시지는 공감을 받지 않아요.');
    const rx={...(m.reactions||{})};
    const arr=new Set(Array.isArray(rx[emoji])?rx[emoji]:[]);
    if(arr.has(uid())) arr.delete(uid()); else arr.add(uid());
    if(arr.size) rx[emoji]=[...arr]; else delete rx[emoji];
    m.reactions=rx; // 화면 먼저 반영
    renderMessages(false);
    try{ await db.collection('channels').doc(state.room.id).collection('messages').doc(msgId).update({reactions:rx}); }
    catch(e){ console.error('reaction',e); toast(errText(e)); }
  }
  function openReactPicker(msgId,x,y){
    showFloatMenu(x,y,`<div class="float-title">공감 남기기</div><div class="rx-picker">${reactionEmojis().map(e=>`<button type="button" data-action="toggle-reaction" data-msg="${esc(msgId)}" data-emoji="${esc(e)}">${esc(e)}</button>`).join('')}</div>`);
  }
  // ---------- 말풍선 메뉴 (우클릭 / 꾹 누르기) ----------
  let floatMenuEl=null;
  function closeFloatMenu(){
    const el=floatMenuEl; if(!el) return;
    floatMenuEl=null;
    if(el._off){ document.removeEventListener('pointerdown',el._off,true); window.removeEventListener('wheel',el._off); }
    el.classList.remove('open');
    el.classList.add('closing'); // 열릴 때의 반대 모션으로 사라진다
    setTimeout(()=>{ try{ el.remove(); }catch(e){} },150);
  }
  function showFloatMenu(x,y,html){
    closeFloatMenu();
    const el=document.createElement('div');
    el.className='float-menu';
    el.innerHTML=html;
    document.body.appendChild(el);
    floatMenuEl=el;
    const r=el.getBoundingClientRect();
    el.style.left=Math.max(8,Math.min(x,window.innerWidth-r.width-8))+'px';
    el.style.top=Math.max(8,Math.min(y,window.innerHeight-r.height-8))+'px';
    requestAnimationFrame(()=>el.classList.add('open'));
    const off=e=>{ if(!floatMenuEl||floatMenuEl!==el) return; if(!el.contains(e.target)) closeFloatMenu(); };
    el._off=off;
    setTimeout(()=>{ document.addEventListener('pointerdown',off,true); window.addEventListener('wheel',off,{passive:true}); },0);
  }
  function openMsgMenu(msgId,x,y){
    const m=state.messages.find(v=>v.id===msgId); if(!m||m.system||m.deleted) return;
    const mine=m.senderId===uid();
    const senderName=esc((state.profileCache.get(m.senderId)||{}).displayName||m.senderName||'사용자');
    const items=[];
    items.push(`<button type="button" data-action="copy-message" data-msg="${esc(m.id)}">복사</button>`);
    if(mine && canEditMsg(m)) items.push(`<button type="button" data-action="edit-message" data-msg="${esc(m.id)}">수정</button>`);
    items.push(`<button type="button" data-action="reply-message" data-msg="${esc(m.id)}">답장</button>`);
    if(!m.noReactions) items.push(`<button type="button" data-action="react-pick" data-msg="${esc(m.id)}">감정 아이콘</button>`);
    items.push(`<button type="button" data-action="pick-chat" data-msg="${esc(m.id)}">채팅 선택</button>`);
    if(!mine){
      items.push(`<button type="button" data-action="report-message" data-msg="${esc(m.id)}" data-room-id="${esc(state.room?.id||'')}" data-sender-id="${esc(m.senderId)}" data-sender-name="${senderName}" data-text="${esc(m.text||'')}">신고</button>`);
      items.push(`<button type="button" data-action="block" data-uid="${esc(m.senderId)}" data-name="${senderName}">차단</button>`);
    }
    if(canPickMsg(m)) items.push(`<button type="button" class="danger" data-action="delete-message" data-msg="${esc(m.id)}">지우기</button>`);
    state.menuXY={x,y};
    showFloatMenu(x,y,`<div class="float-title">${mine?'내 메시지':senderName+'님의 메시지'}</div>${items.join('')}`);
  }
  function startPickFrom(msgId){
    state.selectMode=true;
    state.selected=new Set(msgId?[msgId]:[]);
    refreshChatFrame();
  }
  let msgPressTimer=null, msgPressInfo=null;
  function wireMessagePress(){
    document.addEventListener('pointerdown',e=>{
      if(floatMenuEl && floatMenuEl.contains(e.target)) return; // 메뉴 안을 누른 것은 그대로 둔다
      const row=e.target.closest('.message-row[data-msg-id]');
      closeFloatMenu();
      if(!row) return;
      if(e.pointerType==='mouse') return; // 마우스는 오른쪽 버튼(우클릭)으로 연다
      // 삭제된 메시지예요 표시는 꾹 누르기 메뉴도 띄우지 않는다
      const pm=(state.messages||[]).find(v=>v.id===row.dataset.msgId);
      if(pm && (pm.deleted || pm.system)) return;
      msgPressInfo={id:row.dataset.msgId,x:e.clientX,y:e.clientY,moved:false};
      clearTimeout(msgPressTimer);
      msgPressTimer=setTimeout(()=>{
        if(!msgPressInfo||msgPressInfo.moved) return;
        const info=msgPressInfo; msgPressInfo=null;
        try{ navigator.vibrate&&navigator.vibrate(15); }catch(err){}
        openMsgMenu(info.id,info.x,info.y);
      },520);
    });
    document.addEventListener('pointermove',e=>{
      if(!msgPressInfo) return;
      if(Math.abs(e.clientX-msgPressInfo.x)>10||Math.abs(e.clientY-msgPressInfo.y)>10){ msgPressInfo.moved=true; clearTimeout(msgPressTimer); }
    });
    const end=()=>{ clearTimeout(msgPressTimer); msgPressInfo=null; };
    document.addEventListener('pointerup',end);
    document.addEventListener('pointercancel',end);
    document.addEventListener('contextmenu',e=>{
      const row=e.target.closest('.message-row[data-msg-id]');
      if(!row) return;
      e.preventDefault();
      // 삭제된 메시지예요 표시는 우클릭 메뉴를 띄우지 않는다 (원문 노출 방지)
      const m=(state.messages||[]).find(v=>v.id===row.dataset.msgId);
      if(m && (m.deleted || m.system)) return;
      openMsgMenu(row.dataset.msgId,e.clientX,e.clientY);
    });
    // 메뉴 안의 항목을 누르면 동작을 처리한 뒤 메뉴를 닫는다 (handleClick 다음에 실행됨)
    document.addEventListener('click',e=>{ if(floatMenuEl && floatMenuEl.contains(e.target)) closeFloatMenu(); });
  }
  function isBlockedMessage(m){
    if(!m?.senderId || !state.profile?.blockHistory?.[m.senderId])return false;
    const t=docTs(m.createdAt)||0; return state.profile.blockHistory[m.senderId].some(r=>t>=Number(r.from||0)&&(r.to==null||t<=Number(r.to)));
  }
  // ---------- 메시지 지우기 ----------
  // 학생 : 내가 보낸 지 24시간 이내 메시지를 '내 화면에서만' 숨긴다
  // 선생님·관리자 : 남의 메시지도 '모두의 화면에서' 지울 수 있다
  // ---------- 메시지 지우기 ----------
  // 학생 : 남의 메시지도 '내 화면에서만' 숨길 수 있다 (다른 사람에게는 그대로 보인다)
  // 모두의 화면에서 지울 수 있는 사람은 그 방을 만든 방장뿐이다.
  // 1번 추가: 학교 관리자·교사·총관리자는 학생의 부적절한 메시지를 모두의 화면에서 삭제할 수 있다.
  // 모두에게서 지우기: 방장이거나 본인 메시지 작성자 (남의 메시지는 방장만) + 교사/관리자는 권한 범위 내 삭제 가능
  function canStaffPurge(){
    if(!state.room) return false;
    if(isAdmin()) return true;
    if(isTeacher()||isSchoolAdmin()){
      const mySid=state.profile?.schoolId||'';
      const roomSid=state.room?.schoolId||'';
      if(mySid&&roomSid&&mySid===roomSid) return true;
      // 학교 정보가 없는 방(구버전)은 같은 학교 멤버이면 허용
      if(!roomSid) return true;
    }
    return false;
  }
  function canPurgeMsg(m){ return !!state.room && (state.room.createdBy===uid() || !!(m&&m.senderId===uid()) || canStaffPurge()); }
  // 본인 메시지는 본인만 수정할 수 있다 (삭제됨·시스템·공감금지 제외, 텍스트만)
  function canEditMsg(m){
    return !!m && !m.deleted && !m.system && m.senderId===uid() && typeof m.text==='string' && m.text.length>0;
  }
  // 수정한 메시지가 마지막 메시지였다면 목록 요약도 함께 고친다
  async function refreshLastTextAfterEdit(roomId, editedId){
    try{
      const rest=(state.messages||[]).filter(x=>!x.deleted&&!x.system);
      if(!rest.length) return;
      const last=rest[rest.length-1];
      if(last.id!==editedId) return;
      await db.collection('channels').doc(roomId).update({
        lastText:last.text||attachSummary(last.attachment),
        lastSenderId:last.senderId,lastSenderName:last.senderName||'사용자',
        lastCreatedAt:last.createdAt||ts(),updatedAt:ts()
      });
    }catch(e){ console.error('lastText edit',e); }
  }
  function startEditMessage(id){
    const m=state.messages.find(x=>x.id===id);
    if(!m || !canEditMsg(m)) return toast('수정할 수 있는 메시지가 아니에요.');
    state.editingId=id; state.replyText=null;
    closeFloatMenu();
    refreshComposer();
    const ta=$('#composerText');
    if(ta){
      ta.value=m.text||'';
      ta.placeholder='메시지를 수정해 보세요. (Enter로 저장)';
      ta.focus();
      ta.style.height='auto'; ta.style.height=Math.min(120,ta.scrollHeight)+'px';
      updateCharCount();
    }
  }
  function cancelEditMessage(){
    state.editingId=null;
    refreshComposer();
    const ta=$('#composerText');
    if(ta){ ta.value=loadDraft(state.room?.id)||''; ta.placeholder='메시지를 입력해 주세요. (최대 1500자)'; ta.style.height='auto'; ta.style.height=Math.min(120,ta.scrollHeight)+'px'; updateCharCount(); }
  }
  async function saveEditedMessage(){
    if(state.sending) return;
    state.sending=true;
    const id=state.editingId;
    const m=state.messages.find(x=>x.id===id);
    if(!m || !state.room) { state.editingId=null; state.sending=false; return refreshComposer(); }
    const ta=$('#composerText');
    const text=(ta?.value||'').trim();
    if(!text){ state.sending=false; return toast('수정할 내용을 입력해 주세요.'); }
    if(text.length>MSG_MAX_LEN){ state.sending=false; return toast(`메시지는 ${MSG_MAX_LEN}자까지만 보낼 수 있어요.`); }
    if(text===(m.text||'')){ state.sending=false; cancelEditMessage(); return; }
    try{
      await db.collection('channels').doc(state.room.id).collection('messages').doc(id).update({
        text,edited:true,editedAt:ts(),updatedAt:ts()
      });
      m.text=text; m.edited=true;
      state.editingId=null;
      state.sending=false;
      refreshComposer();
      try{
        const ta2=$('#composerText');
        if(ta2){ ta2.value=loadDraft(state.room?.id)||''; ta2.style.height='auto'; ta2.style.height=Math.min(120,ta2.scrollHeight)+'px'; updateCharCount(); }
      }catch(e){}
      renderMessages(false);
      refreshLastTextAfterEdit(state.room.id,id);
      toast('메시지를 수정했어요.');
    }catch(e){ console.error(e); state.sending=false; toast(errText(e)); }
  }
  // 지운 메시지가 마지막 메시지였다면 목록에 뜨는 최근 글도 함께 고친다
  async function refreshLastTextAfterDelete(roomId, deletedIds){
    try{
      const gone=new Set([].concat(deletedIds||[]));
      const rest=(state.messages||[]).filter(x=>!gone.has(x.id)&&!x.deleted);
      const last=rest.length?rest[rest.length-1]:null;
      const patch=last
        ?{lastText:last.text||attachSummary(last.attachment),lastSenderId:last.senderId,lastSenderName:last.senderName||'사용자',lastCreatedAt:last.createdAt||ts(),updatedAt:ts()}
        :{lastText:'',lastSenderId:'',lastSenderName:'',lastCreatedAt:ts(),updatedAt:ts()};
      await db.collection('channels').doc(roomId).update(patch);
    }catch(e){ console.error('lastText',e); }
  }
  function canHideMsg(m){ return !!m && !m.deleted; }
  function canPickMsg(m){ return !!m && !m.deleted; }
  function isHiddenMsg(id){ return !!(state.hidden instanceof Set) && state.hidden.has(id); }
  async function loadHiddenMessages(){
    state.hidden=new Set();
    try{
      const s=await db.collection('messageHides').where('uid','==',uid()).limit(800).get();
      s.docs.forEach(d=>{ const v=d.data(); if(v.msgId) state.hidden.add(v.msgId); });
    }catch(e){ console.error('hidden messages',e); }
    if($('#messages')) renderMessages(false);
  }
  async function hideMessages(list, roomIdArg=null){
    // 확인 창을 띄운 사이 방이 바뀌어도, 원래 방 기준으로만 숨김을 기록한다
    const roomId=roomIdArg||state.room?.id; if(!roomId||!list?.length) return;
    const batch=db.batch();
    list.forEach(m=>{
      batch.set(db.collection('messageHides').doc(`${uid()}_${m.id}`),{uid:uid(),msgId:m.id,roomId,at:ts()});
      if(!(state.hidden instanceof Set)) state.hidden=new Set();
      state.hidden.add(m.id);
    });
    await batch.commit();
  }
  function renderMessages(initial=false){
    const host=$('#messages'); if(!host)return;
    const wasBottom=host.scrollHeight-host.scrollTop-host.clientHeight<40;
    if(!(state.seenMsgIds instanceof Set)) state.seenMsgIds=new Set();
    const seen=state.seenMsgIds;
    if(!(state.bubbleAnims instanceof Map)) state.bubbleAnims=new Map();
    const anims=state.bubbleAnims;
    const isInitial = initial || seen.size===0;
    const newIds=[];
    let lastDate=''; let html='';
    // 같은 사람이 1분 안에 연달아 보낸 메시지는 한 묶음으로 보여준다 (프로필은 묶음의 가장 과거 메시지에만)
    const visible=[];
    for(const m of state.messages){
      if(isBlockedMessage(m))continue;
      if(isHiddenMsg(m.id))continue;
      visible.push(m);
    }
    // 가장 아래(최근) 메시지 1개에만 읽음 표시 (시스템 알림은 제외)
    let latestVisibleId='';
    for(const m of visible){ if(!m.deleted&&!m.system) latestVisibleId=m.id; }
    const msgTs=(m)=>docTs(m.createdAt)||0;
    // 검열 카드는 입력창 위에 고정하지 않고, 막힌 시점 자리에 끼워 넣는다
    // (서버 시각 전에는 맨 아래, 새 채팅이 오면 위로 올라간다)
    const blockCards=(state.modBlocks||[])
      .filter(b=>b.roomId===(state.room?.id||''))
      .map(b=>({b,t:docTs(b.createdAt)||Infinity}))
      .sort((x,y)=>x.t-y.t);
    const flow=[]; let bi=0;
    for(const m of visible){
      const mt=msgTs(m);
      while(bi<blockCards.length && blockCards[bi].t<=mt){ flow.push({block:blockCards[bi].b}); bi++; }
      flow.push({msg:m});
    }
    while(bi<blockCards.length){ flow.push({block:blockCards[bi].b}); bi++; }
    for(let i=0;i<flow.length;i++){
      const it=flow[i];
      if(it.block){ html+=modBlockHtml(it.block); continue; }
      const m=it.msg;
      if(!isInitial && (!seen.has(m.id) || anims.has(m.id))) newIds.push(m.id);
      seen.add(m.id);
      const d=dateText(m.createdAt); if(d&&d!==lastDate){lastDate=d;html+=`<div class="day-sep"><span>${esc(d)}</span></div>`;}
      const dividerHere=state.unreadMarkerId===m.id;
      if(dividerHere) html+=`<div class="read-divider"><span>여기까지 읽었어요</span></div>`;
      if(m.system==='join'||m.system==='leave'){
        const join=m.system==='join';
        html+=`<div class="message-row center"><div class="message-content"><div class="system-pill ${join?'join':'leave'}"><span class="sys-ico">${join?'👋':'🚪'}</span>${esc(m.targetName||m.senderName||'사용자')}님이 ${join?'채팅방에 참여했어요':'채팅방을 나갔어요'}.</div></div></div>`;
        continue;
      }
      if(m.deleted){
        // 지워진 메시지의 원문은 아무도 화면에서 볼 수 없다.
        // 신고가 접수된 경우에만 신고 관리 패널의 스냅샷으로 최소 열람한다.
        // 1번: 관리자가 지운 메시지는 문구를 구분한다
        const staffTxt=m.staffDeleted?`🛡️ 관리자에 의해 삭제된 메시지예요`:`🗑️ 삭제된 메시지예요`;
        html+=`<div class="message-row center" data-msg-id="${esc(m.id)}"><div class="message-content"><div class="deleted-pill${m.staffDeleted?' staff':''}">${esc(staffTxt)}</div></div></div>`;
        continue;
      }
      // 2번: 신고 N회 누적 블라인드 (*신고에 의해 가려진 메시지입니다)
      try{
        const flag=(state.flagMap instanceof Map)?state.flagMap.get(m.id):null;
        const blinded=!!(m.blinded||(flag&&(flag.blinded||Number(flag.count||0)>=REPORT_BLIND_COUNT)));
        if(blinded){
          const cnt=Number(m.reportCount||flag?.count||REPORT_BLIND_COUNT);
          const canMod=isTeacherOrAdmin()||state.room?.createdBy===uid();
          html+=`<div class="message-row center" data-msg-id="${esc(m.id)}"><div class="message-content"><div class="deleted-pill blind">🙈 신고에 의해 가려진 메시지입니다${cnt?` (신고 ${cnt}건)`:''}</div>${canMod?`<div class="blind-btns"><button type="button" class="soft-btn" style="flex:1" data-action="blind-restore" data-msg="${esc(m.id)}">복구하기</button><button type="button" class="danger-btn" style="flex:1" data-action="blind-confirm" data-msg="${esc(m.id)}">삭제 확정</button></div>`:''}</div></div>`;
          continue;
        }
      }catch(e){}
      const profile=state.profileCache.get(m.senderId)||{displayName:m.senderName||'사용자',photoURL:m.senderPhotoURL||''};
      const mine=m.senderId===uid(); const reply=m.replyToText?`<div style="font-size:11px;color:${mine?'rgba(255,255,255,.75)':'var(--muted)'};margin-bottom:6px;border-left:2px solid currentColor;padding-left:8px">${esc(String(m.replyToText).slice(0,90))}</div>`:'';
      const senderName=esc(profile.displayName||m.senderName||'사용자');
      const t=esc(timeText(m.createdAt));
      const pm=(i>0&&flow[i-1].msg)?flow[i-1].msg:null, nm=(i<flow.length-1&&flow[i+1].msg)?flow[i+1].msg:null;
      const ts=msgTs(m);
      // 전송 직후(서버 시간 미확정)에도 묶음이 깜빡이지 않게: 시간·날짜가 비어 있으면 같은 것으로 취급
      const md=dateText(m.createdAt);
      const pd=pm?dateText(pm.createdAt):'', nd=nm?dateText(nm.createdAt):'';
      const diffPrev=(pm&&(ts&&msgTs(pm)))?(ts-msgTs(pm)):0;
      const diffNext=(nm&&(ts&&msgTs(nm)))?(msgTs(nm)-ts):0;
      const samePrev=!!(pm&&!pm.deleted&&!pm.system&&pm.senderId===m.senderId&&diffPrev<60000&&state.unreadMarkerId!==pm.id&&(!pd||!md||pd===md));
      const sameNext=!!(nm&&!nm.deleted&&!nm.system&&nm.senderId===m.senderId&&diffNext<60000&&!dividerHere&&(!nd||!md||nd===md));
      const groupFirst=!samePrev, groupLast=!sameNext;
      const avBtn=`<button type="button" class="avatar-btn" data-action="user-profile" data-uid="${esc(m.senderId)}" data-name="${senderName}" aria-label="프로필 보기">${avatarHtml(profile,'',true)}</button>`;
      const receipt=(m.id===latestVisibleId)?(mine?readReceiptHtml(m):readReceiptOthersHtml(m)):'';
      const editedBadge=m.edited?`<span class="edited-badge">수정됨</span>`:'';
      html+=`<div class="message-row ${mine?'mine':''}${groupFirst?'':' grouped'}${m.id===state.reportTargetId?' report-target':''}" data-msg-id="${esc(m.id)}">${state.selectMode?(canPickMsg(m)?`<button type="button" class="msg-pick ${selSet().has(m.id)?'on':''}" data-action="pick-msg" data-msg="${esc(m.id)}" aria-label="선택">✓</button>`:'<span class="msg-pick blank"></span>'):''}<div class="msg-side">${!mine?(groupFirst?avBtn:'<span class="msg-avatar-spacer"></span>'):''}</div><div class="message-content">${groupFirst?`<div class="message-author"><button type="button" class="author-btn" data-action="user-profile" data-uid="${esc(m.senderId)}" data-name="${senderName}">${senderName}</button> · ${roleLabel(profile.role||m.senderRole)}${roleChipsHtml(m.senderId)} · ${t}${m.id===state.reportTargetId?' <span class="report-badge">신고된 메시지</span>':''}</div>`:''}${reply}<div class="bubble" data-time="${t}">${bubbleInner(m)}</div>${groupLast?'':`<div class="bubble-time">${t}${editedBadge}</div>`}${reactionsHtml(m)}${groupLast?`<div class="msg-time">${t}${editedBadge}</div>`:''}${receipt}</div>${mine?`<div class="msg-side">${groupFirst?avBtn:'<span class="msg-avatar-spacer"></span>'}</div>`:''}</div>`;
    }
    const pendingId=state.pendingHighlight; state.pendingHighlight=null;
    // 더 옛날 메시지가 있으면 맨 위에 '이전 메시지 더 보기'를 둔다
    const showLoadMore=!state.msgExhausted && (state.messages||[]).length>=(state.msgLimit||MSG_PAGE) && (state.messages||[]).length>0;
    if(showLoadMore) html=`<div class="load-more-wrap"><button type="button" class="load-more" data-action="load-more-msgs"${state.msgLoading?' disabled':''}>${state.msgLoading?'불러오는 중…':'이전 메시지 더 보기'}</button></div>`+html;
    const prevScrollTop=host.scrollTop, prevScrollH=host.scrollHeight;
    host.innerHTML=html || `<div class="empty-side" style="margin-top:30px">아직 메시지가 없어요.<br>첫 메시지를 남겨 보세요.</div>`;
    try{ enhanceLinkPreviews(host); }catch(e){}
    if(newIds.length){
      let reduce=false;
      try{ reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
      if(!reduce){
        const kf=[{opacity:0,transform:'translateY(12px) scale(.96)'},{opacity:1,transform:'translateY(0) scale(1)'}];
        newIds.forEach(id=>{
          const el=host.querySelector(`[data-msg-id="${esc(id)}"]`); if(!el) return;
          const prev=anims.get(id);
          const from=prev?Math.min(Number(prev.currentTime)||0,330):0;
          if(prev){ try{ prev.cancel(); }catch(e){} }
          let a=null;
          try{ a=el.animate(kf,{duration:340,easing:'cubic-bezier(.2,.8,.2,1)'}); }catch(e){ return; }
          try{ a.currentTime=from; }catch(e){}
          anims.set(id,a);
          const drop=()=>{ if(anims.get(id)===a) anims.delete(id); };
          a.addEventListener('finish',drop);
          a.addEventListener('cancel',drop);
        });
      }
    }
    renderTypingIndicator(false);   // 다시 그린 뒤 입력 중 말풍선을 맨 아래에 붙인다
    if(state.scrollToMarker){
      // 자리를 비운 사이에 온 메시지가 있으면 '여기까지 읽었어요' 위치로 이동한다
      state.scrollToMarker=false;
      requestAnimationFrame(()=>{
        const el=host.querySelector('.read-divider');
        if(el) el.scrollIntoView({block:'start',behavior:prefersReducedMotion()?'auto':'smooth'});
        else scrollMessagesToBottom(host,true);
      });
    } else if(pendingId){
      const row=host.querySelector(`[data-msg-id="${esc(pendingId)}"]`);
      if(row){ row.classList.add('flash'); requestAnimationFrame(()=>row.scrollIntoView({block:'center',behavior:prefersReducedMotion()?'auto':'smooth'})); }
      else toast('해당 메시지를 찾지 못했어요. 최근 메시지만 불러와요.');
    } else if(initial){
      cancelMsgScroll(); host.scrollTop=host.scrollHeight; state.atBottom=true;
      // 사진 등이 늦게 불러와져도 맨 밑에 고정되게 다시 맞춘다
      requestAnimationFrame(()=>{ host.scrollTop=host.scrollHeight; });
      setTimeout(()=>{ if(state.justOpenedRoom){ host.scrollTop=host.scrollHeight; state.atBottom=true; state.justOpenedRoom=false; } },600);
    } else if(wasBottom){
      // 내용이 늘거나 줄어도 채팅창이 뚝 끊기지 않고 부드럽게 움직인다
      const target=host.scrollHeight-host.clientHeight;
      const shrunk=prevScrollH-host.scrollHeight;
      if(shrunk>0){
        const spacer=document.createElement('div'); spacer.className='msg-scroll-spacer'; spacer.style.height=shrunk+'px'; host.appendChild(spacer);
        host.scrollTop=prevScrollTop;
        animateMsgScroll(host,target,320,()=>{ try{ spacer.remove(); }catch(e){} });
      } else {
        animateMsgScroll(host,target);
      }
    }
    // 과거를 보고 있는데 새 메시지가 오면 입력창 바로 위에 고정 알림을 띄운다 (계속 유지)
    // 이전 메시지 더 보기로 넓히는 중에는 옛날 메시지가 새 알림이 되지 않게 막는다
    if(!initial && !wasBottom && newIds.length && !state.msgPaging){
      const newSet=new Set(newIds);
      const latest=[...visible].reverse().find(m=>!m.deleted&&!m.system&&newSet.has(m.id)&&m.senderId!==uid());
      if(latest) showInRoomPill(latest);
    } else if(wasBottom||initial){ hideInRoomPill(); }
    updateOldChatBar();
    if(state.searchMode && (state.searchHits||[]).length) applySearchHighlight();
    host.onscroll=(e)=>{
      if(e&&e.isTrusted) state.justOpenedRoom=false;
      state.atBottom=host.scrollHeight-host.scrollTop-host.clientHeight<40;
      if(state.atBottom) hideInRoomPill();
      updateOldChatBar();
      if(state.atBottom && state.unreadMarkerId){
        state.unreadMarkerId=null;
        host.querySelectorAll('.read-divider').forEach(el=>el.remove());
      }
      // 맨 아래까지 내려오면 읽음 위치를 갱신한다 (읽음 표시)
      if(state.atBottom && state.room && !document.hidden){
        const t=Date.now();
        if(t-(state.readWriteAt||0)>1500){ state.readWriteAt=t; markRead(state.room.id); }
      }
    };
    // 사용자가 직접 스크롤하면 진행 중인 부드러운 이동을 멈춘다
    // renderMessages 는 자주 다시 호출되므로, 리스너가 쌓이지 않게 요소당 1회만 등록한다
    if(!host.dataset.scrollBound){
      host.dataset.scrollBound='1';
      ['wheel','touchstart','pointerdown'].forEach(ev=>host.addEventListener(ev,()=>cancelMsgScroll(),{passive:true}));
    }
  }
  let profileRerenderTimer=null;
  function scheduleProfileRerender(){
    if(profileRerenderTimer) return;
    profileRerenderTimer=setTimeout(()=>{ profileRerenderTimer=null; if($('#messages')) renderMessages(false); },300);
  }
  async function ensureCurrentProfiles(){
    // 메시지를 보낸 사람을 먼저, 그다음 채팅방 참여자를 구독한다 (이름·프로필 사진·접속 상태에 쓰임)
    const senders=state.messages.filter(m=>m.senderId).map(m=>m.senderId);
    const ids=[...new Set([...senders, ...((state.room?.memberIds)||[])])];
    const key=ids.join(',');
    if(key===state.profileListeningKey)return;
    state.profileListeningKey=key;
    state.profileUnsubs.forEach(fn=>{try{fn();}catch{}});state.profileUnsubs=[];
    ids.slice(0,80).forEach(id=>{
      const unsub=db.collection('publicProfiles').doc(id).onSnapshot(s=>{if(s.exists){state.profileCache.set(id,s.data());scheduleProfileRerender();tickPresence();}},e=>{console.warn('profile listen',id,e?.code||e);});
      state.profileUnsubs.push(unsub);
    });
    // 구독 인원이 많아 잘린 사람들도 이름·사진이 보이도록 한 번에 받아 둔다
    ensureProfilesAll(roomParticipantIds()).catch(()=>{});
    if(!state.profileCache.has(uid()))state.profileCache.set(uid(),state.profile);
  }

  const MSG_MAX_LEN=1500;
  // ---------- 오프라인 보관함 (연결되면 자동 전송 · 텍스트만, 최대 50개) ----------
  function readOutbox(){ try{ const v=JSON.parse(localStorage.getItem('edutalk_outbox')||'[]'); return Array.isArray(v)?v:[]; }catch(e){ return []; } }
  function writeOutbox(list){ try{ localStorage.setItem('edutalk_outbox',JSON.stringify(list.slice(-50))); }catch(e){} }
  function queueOutbox(roomId,text){
    if(!roomId||!String(text||'').trim()) return;
    const box=readOutbox();
    box.push({roomId,text:String(text).slice(0,MSG_MAX_LEN),at:Date.now()});
    writeOutbox(box);
    toast(`인터넷이 끊겨 ${box.length}개를 보관했어요. 연결되면 자동으로 보내요.`);
  }
  async function flushOutbox(){
    if(navigator.onLine===false||!uid()) return;
    let box=readOutbox();
    if(!box.length) return;
    // 타임아웃·정지 중에는 보관함을 비우지 않는다 (우회 방지 · 이용권은 규칙이 막는다)
    if(!isStaff()){ const to=timeoutInfo(); if(to) return; if(roomChatOff(state.room)) return; }
    const rest=[];
    for(const item of box){
      try{
        const room=(state.rooms||[]).find(r=>r.id===item.roomId);
        const batch=db.batch();
        const msgRef=db.collection('channels').doc(item.roomId).collection('messages').doc();
        batch.set(msgRef,{text:item.text,senderId:uid(),senderName:state.profile?.displayName||'사용자',senderRole:state.profile?.role||'student',replyToText:null,createdAt:ts(),deleted:false,queued:true});
        batch.update(db.collection('channels').doc(item.roomId),{lastText:item.text,lastSenderId:uid(),lastSenderName:state.profile?.displayName||'사용자',lastCreatedAt:ts(),updatedAt:ts()});
        await batch.commit();
        if(room&&state.room?.id===item.roomId){ state.atBottom=true; }
        await new Promise(r=>setTimeout(r,400));
      }catch(e){ console.warn('outbox flush',e?.code||e); rest.push(item); break; }
    }
    writeOutbox(rest);
    if(rest.length<box.length) toast(rest.length?'일부를 보냈어요. 나머지는 다음 연결 때 보내요.':'보관한 메시지를 다 보냈어요.');
  }
  async function sendMessage(form, attachment=null, roomIdArg=null){
    if(!state.room || !state.profile) return;
    if(!isAdmin() && !licenseActiveInfo().active){ refreshComposer(); return toast(licenseFrozenMessage()); }
    // 엔터 2번·연타로 같은 메시지가 2번 전송되는 것을 막는다
    if(state.sending) return;
    // 수정 모드면 저장 흐름으로 넘긴다 (파일 전송이면 수정 취소 후 새 메시지로 보낸다)
    if(state.editingId && !attachment) return saveEditedMessage();
    if(state.editingId && attachment){ state.editingId=null; refreshComposer(); }
    if(state.netOffline && !attachment) {
      // 오프라인이면 보관함에 넣어두고 연결되면 자동으로 보낸다 (통학버스·지하철 대응)
      const ta0=(form?.querySelector?form.querySelector('#composerText'):null)||$('#composerText');
      const tx0=(ta0?.value||'').trim();
      if(tx0){ queueOutbox(state.room?.id,tx0); if(ta0){ ta0.value=''; ta0.style.height='44px'; } updateCharCount(); syncComposerHeight(); }
      return;
    }
    const ta=(form?.querySelector?form.querySelector('#composerText'):null)||$('#composerText');
    const text=(ta?.value||'').trim();
    if(!text && !attachment) return;
    if(text.length>MSG_MAX_LEN){ if(ta) ta.value=text.slice(0,MSG_MAX_LEN); return toast(`메시지는 ${MSG_MAX_LEN}자까지만 보낼 수 있어요.`); }
    const now=Date.now();
    if(text && state.lastSendText===text && state.lastSendRoom===state.room?.id && (now-(state.lastSendAt||0))<900) return;
    state.sending=true;
    const room=state.room;
    // 사진 압축 등으로 시간이 걸리는 동안 사용자가 다른 방으로 옮겼다면 엉뚱한 방에 보내지 않는다
    if(roomIdArg && room.id!==roomIdArg){ state.sending=false; return toast('채팅방이 바뀌었어요. 다시 시도해 주세요.'); }
    const allowed = isAdmin() || (room.type==='notice' ? isTeacher() : room.visibility==='all' || (room.memberIds||[]).includes(uid()));
    if(!allowed){state.sending=false;toast('이 채팅방에서는 메시지를 보낼 수 없어요.');return;}
    if(!isStaff()){
      const to=timeoutInfo();
      if(to){ state.sending=false; return toast(to.permanent?'채팅 이용이 정지되어 있어요.':`타임아웃 중이에요. ${fmtRemain(to.ms)} 남았어요.`); }
      if(roomChatOff(room)){ state.sending=false; return toast('관리자가 채팅을 정지한 방이에요. 지금은 대화할 수 없어요.'); }
      if(state.warnCount>=warnLimit()){ state.sending=false; return toast('경고가 쌓여 메시지를 보낼 수 없어요. 선생님께 이야기해 주세요.'); }
      // 관리자가 '예외 단어'로 등록한 말이 들어 있으면 1차 차단을 건너뛴다 (예: 시발역)
      const allowed=findAnyBanned(text,chatCfg().allowWords);
      const hit=allowed?'':findAnyBanned(text,chatCfg().blockWords);
      if(hit){ state.sending=false; return blockMessage(text,hit,'word'); }
      // 우회 표기(시1발, ㅅㅂ …)는 관리자 목록에 없어도 막는다
      const byp=allowed?'':findLoose(text,BYPASS_PATTERNS);
      if(byp){ state.sending=false; return blockMessage(text,byp,'bypass'); }
    }
    if(!isStaff()){
      const fms=floodBlockMs();
      if(fms>0){ state.sending=false; toast(`메시지를 너무 빠르게 보냈어요. ${Math.ceil(fms/1000)}초 뒤에 다시 보내 주세요.`); refreshComposer(); startLockTick(); return; }
    }
    try{
      const sendBtn=form?.querySelector?form.querySelector('.send'):document.querySelector('#composerForm .send');
      if(sendBtn){ sendBtn.disabled=true; sendBtn.classList.add('sending'); }
      const batch=db.batch();
      const msgRef=db.collection('channels').doc(room.id).collection('messages').doc();
      const lastText = text || attachSummary(attachment);
      const doc={text,senderId:uid(),senderName:state.profile?.displayName||'사용자',senderRole:state.profile?.role||'student',replyToText:state.replyText||null,createdAt:ts(),deleted:false};
      if(attachment) doc.attachment=attachment;
      if(state.noReactions) doc.noReactions=true;
      batch.set(msgRef,doc);
      batch.update(db.collection('channels').doc(room.id),{lastText,lastSenderId:uid(),lastSenderName:state.profile?.displayName||'사용자',lastCreatedAt:ts(),updatedAt:ts()});
      await batch.commit();
      state.lastSendText=text; state.lastSendRoom=room.id; state.lastSendAt=Date.now();
      // 1번: 서버 스냅샷이 오기 전에 미리 맨 위로 올려 점프(아래로 내려갔다 올라옴) 방지
      try{
        const nowTs=Date.now();
        const rr=state.rooms.find(x=>x.id===room.id);
        if(rr){ rr.updatedAt=nowTs; rr.lastCreatedAt=nowTs; rr.lastText=lastText; rr.lastSenderId=uid(); }
        state.rooms.sort((a,b)=>(docTs(b.updatedAt)-docTs(a.updatedAt))||(docTs(b.lastCreatedAt)-docTs(a.lastCreatedAt)));
        renderRooms();
      }catch(e){}
      state.sending=false;
      if(sendBtn){ sendBtn.disabled=false; sendBtn.classList.remove('sending'); }
      state.replyText=null;
      state.unreadMarkerId=null;
      stopTyping();
      // 카톡처럼 전송 후에도 키보드를 유지하고 입력창이 키보드 위에서 내려오지 않게 한다
      state.atBottom=true;
      if(ta){ ta.value=''; try{ saveDraft(state.room?.id, ''); const h=document.getElementById('composerDraftHint'); if(h) h.classList.remove('show'); }catch(e){} ta.style.height='44px'; ta.placeholder='메시지를 입력해 주세요. (최대 1500자)'; }
      try{ clearDraft(room.id); }catch(e){}
      updateCharCount();
      syncComposerHeight();
      const host=$('#messages');
      if(host) scrollMessagesToBottom(host,true);
      requestAnimationFrame(()=>{
        const ta2=$('#composerText');
        if(ta2){ try{ ta2.focus({preventScroll:true}); }catch(fe){ try{ ta2.focus(); }catch(_){} } }
        const host2=$('#messages');
        if(host2 && state.atBottom) scrollMessagesToBottom(host2,true);
      });
    }catch(e){
      console.error(e);state.sending=false;
      try{const sb=form?.querySelector?form.querySelector('.send'):document.querySelector('#composerForm .send'); if(sb){sb.disabled=false;sb.classList.remove('sending');}}catch(_){}
      // 전송 중 끊겼으면 보관함에 넣는다 (다음 연결 때 자동 전송 · 중복 방지를 위해 입력창은 비운다)
      const code=e?.code||'';
      if(!attachment&&text&&(code==='unavailable'||code==='deadline-exceeded'||code==='failed-precondition'||/network|offline|fetch|Failed to fetch/i.test(String(e?.message||'')))){
        queueOutbox(room?.id,text);
        try{ if(ta){ ta.value=''; try{ saveDraft(state.room?.id, ''); const h=document.getElementById('composerDraftHint'); if(h) h.classList.remove('show'); }catch(e){} ta.style.height='44px'; } updateCharCount(); syncComposerHeight(); }catch(_){}
        try{ clearDraft(room?.id); }catch(_){}
        return;
      }
      toast(errText(e));return;
    }
    if(!isStaff() && text){
      const w=findAnyBanned(text,chatCfg().warnWords);
      const flag=findAnyBanned(text,chatCfg().flagWords);
      if(w) await addWarning(w);
      if(w||flag) await logModerationFlag(text, flag?'serious':'warn', flag||w);
    }
  }
  // 금지어·심각 키워드 자동 감지 기록 (관리자 신고 관리에서 확인)
  async function logModerationFlag(text,kind,word){
    try{
      await db.collection('moderationFlags').add({
        roomId:state.room?.id||'', roomName:state.room?.name||'',
        byUid:uid(), byName:state.profile?.displayName||'',
        word:String(word||'').slice(0,40), kind,
        text:String(text||'').slice(0,300),
        createdAt:ts(), expire_at:expireTs(365)
      });
    }catch(e){ console.warn('flag',e); }
  }
  // ---------- 파일 · 사진 보내기 ----------
  // Firestore 문서 1MB 제한 때문에 큰 파일은 800KB씩 나눠 chunks 서브컬렉션에 저장한다 (최대 8MB)
  const IMG_MAX_SIDE=1280, IMG_MAX_DATA=760*1024, FILE_MAX_BYTES=8*1024*1024, CHUNK_SIZE=800*1024, INLINE_MAX=850*1024;
  function readAsDataUrl(file){
    return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result||'')); r.onerror=()=>rej(new Error('read')); r.readAsDataURL(file); });
  }
  function loadImage(src){
    return new Promise((res,rej)=>{ const img=new Image(); img.onload=()=>res(img); img.onerror=()=>rej(new Error('img')); img.src=src; });
  }
  async function compressImage(file){
    const raw=await readAsDataUrl(file);
    let img; try{ img=await loadImage(raw); }catch(e){ return null; }
    const scale=Math.min(1,IMG_MAX_SIDE/Math.max(img.width,img.height));
    const w=Math.max(1,Math.round(img.width*scale)), h=Math.max(1,Math.round(img.height*scale));
    const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
    const ctx=cv.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);
    ctx.drawImage(img,0,0,w,h);
    for(const q of [0.82,0.7,0.58,0.44,0.32]){
      let out='';
      try{ out=cv.toDataURL('image/jpeg',q); }catch(e){ return null; }
      if(out.length<=IMG_MAX_DATA) return {data:out,type:'image/jpeg'};
    }
    return null;
  }

  /* ---------- 사진 자동 검열 (기기 안에서만 검사 · 사진은 외부로 보내지 않음) ---------- */
  // 1) NSFWJS(TensorFlow.js) AI 모델로 성인/선정적 여부를 보고
  // 2) 색상 분석으로 '과도한 피부색 노출'과 '피·상처 같은 강한 붉은색(잔인함)'을 함께 본다.
  // AI 모델을 못 불러와도 색상 분석은 항상 동작한다.
  const NSFW_TF_URL='https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
  const NSFW_LIB_URL='https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/browser/nsfwjs.min.js';
  // 브라우저 번들에는 기본 모델이 들어 있지 않아서 모델 주소를 직접 지정해야 한다.
  const NSFW_MODEL_URL='https://cdn.jsdelivr.net/gh/infinitered/nsfwjs@4.2.1/models/mobilenet_v2/';
  const NSFW_RISK_LABEL={Porn:'성인 사진',Hentai:'성인 그림',Sexy:'선정적인 사진'};
  let nsfwModelPromise=null;
  function loadExternalScript(src){
    return new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src=src; s.async=true;
      s.onload=()=>res(true);
      s.onerror=()=>rej(new Error('script load fail: '+src));
      document.head.appendChild(s);
    });
  }
  function loadNsfwModel(){
    if(nsfwModelPromise) return nsfwModelPromise;
    nsfwModelPromise=(async()=>{
      if(typeof window.tf==='undefined') await loadExternalScript(NSFW_TF_URL);
      if(typeof window.nsfwjs==='undefined') await loadExternalScript(NSFW_LIB_URL);
      if(typeof window.nsfwjs==='undefined') throw new Error('nsfwjs 없음');
      try{ window.tf?.enableProdMode?.(); }catch(e){}
      return await window.nsfwjs.load(NSFW_MODEL_URL);
    })().catch(e=>{ console.warn('사진 검열 모델을 불러오지 못했어요.',e); return null; });
    return nsfwModelPromise;
  }
  // 색상 기반 보조 검사: 피부색(살구색) 비율과 피 같은 강한 붉은색 비율
  function colorSignals(imgEl){
    try{
      const S=96;
      const cv=document.createElement('canvas'); cv.width=S; cv.height=S;
      const ctx=cv.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(imgEl,0,0,S,S);
      const d=ctx.getImageData(0,0,S,S).data;
      let skin=0, blood=0, sampled=0;
      for(let i=0;i<d.length;i+=4){
        const r=d[i],g=d[i+1],b=d[i+2],a=d[i+3];
        if(a<200) continue;
        sampled++;
        const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
        // 고전적인 피부색 판정 (Kovac 규칙) — 살구색·연한 갈색 계열
        if(r>95 && g>40 && b>20 && mx-mn>15 && Math.abs(r-g)>15 && r>g && r>b && r-mn>10) skin++;
        // 피·상처처럼 채도 높은 강한 붉은색 (초록·파랑이 확실히 낮은 픽셀)
        if(r>90 && r>g*1.6 && r>b*1.6 && g<110 && b<110) blood++;
      }
      if(!sampled) return {sampled:0,skinRatio:0,bloodRatio:0};
      return {sampled, skinRatio:skin/sampled, bloodRatio:blood/sampled};
    }catch(e){ return {sampled:0,skinRatio:0,bloodRatio:0}; }
  }
  // 반환: {checked:검사했는지, risk:주의 필요, score:0~1, label:사유}
  async function analyzeImageRisk(imgEl){
    if(!imgEl) return {checked:false,risk:false,score:0,label:''};
    const color=colorSignals(imgEl);
    const model=await loadNsfwModel();
    let adult=0, sexy=0, safeByAI=false, topClass='', aiChecked=false;
    if(model){
      try{
        const preds=await model.classify(imgEl,5);
        const at=(n)=>Number(preds.find(p=>p.className===n)?.probability||0);
        adult=at('Porn')+at('Hentai'); sexy=at('Sexy'); aiChecked=true;
        topClass=([...preds].sort((a,b)=>b.probability-a.probability)[0]||{}).className||'';
        // AI가 '평범한 사진/그림'이라고 확신하면 피부색 규칙으로 얼굴 사진을 잘못 잡지 않는다
        safeByAI=(at('Neutral')>=0.7 || at('Drawing')>=0.7);
      }catch(e){ console.warn('사진 검열 실패',e); }
    }
    const sexual=adult+sexy;
    let risk=false, label='';
    if(adult>=0.35){ risk=true; label=NSFW_RISK_LABEL[topClass]||'성인 사진'; }
    else if(sexual>=0.55){ risk=true; label='선정적인 사진'; }
    else if(!safeByAI && color.skinRatio>=0.5){ risk=true; label='과도한 피부색 노출'; }
    else if(!safeByAI && color.skinRatio>=0.35 && sexual>=0.2){ risk=true; label='과도한 피부색 노출'; }
    if(color.bloodRatio>=0.22){
      risk=true;
      label=label?`${label} · 잔인하거나 자극적인 사진`:'잔인하거나 자극적인 사진';
    }
    const checked=aiChecked || color.sampled>0;
    const score=Math.min(1, Math.max(sexual, color.skinRatio, color.bloodRatio));
    return {checked, risk, score, label};
  }
  async function analyzeImageSrc(src){
    if(!src) return {checked:false,risk:false,score:0,label:''};
    let img; try{ img=await loadImage(src); }catch(e){ return {checked:false,risk:false,score:0,label:''}; }
    return await analyzeImageRisk(img);
  }
  // 관리자 검토용 기록 (자동 처벌은 하지 않음)
  async function logImageFlag(kind,risk,label){
    try{
      const reason=String(risk?.label||'').trim();
      const where=kind==='profile-image'?'프로필 사진':'사진';
      await db.collection('moderationFlags').add({
        roomId:state.room?.id||'', roomName:state.room?.name||'',
        byUid:uid(), byName:state.profile?.displayName||'',
        word:label||where, kind,
        text:`주의가 필요한 ${where}일 수 있어요.${reason?` (${reason})`:''} 신뢰도 ${Math.round(Number(risk?.score||0)*100)}%`,
        score:Number(risk?.score||0),
        createdAt:ts(), expire_at:expireTs(365)
      });
    }catch(e){ console.warn('사진 검열 기록 실패',e); }
  }

  // 보내기 전에 한 번 확인한다 (사진 미리보기 + 보내기/취소)
  function openAttachConfirm(file){
    if(!file) return;
    if(!state.room) return toast('채팅방을 먼저 골라 주세요.');
    if(!String(file.type||'').startsWith('image/')) return sendAttachment(file);   // 일반 파일은 바로 보낸다
    let url='';
    try{ url=URL.createObjectURL(file); }catch(e){}
    const panel=openModal(`<h2>사진을 보낼까요?</h2><p class="desc">${esc(file.name||'사진')} · ${esc(fmtBytes(file.size))}</p><p class="desc" style="margin-top:-8px">사진은 기기를 벗어나지 않고 이 기기에서만 자동 검사돼요.</p>${url?`<img class="attach-view" src="${url}" alt="보낼 사진 미리보기">`:'<p class="desc">미리보기를 만들지 못했어요.</p>'}<div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" data-action="attach-confirm-send">보내기</button></div>`);
    state.attachDraft={ file, url, panel, risk:false, score:0 };
  }
  // '보내기'를 누르면 사진을 검사하고, 주의가 필요하면 경고 화면을 보여 준다.
  async function confirmAttachmentSend(btn){
    const draft=state.attachDraft;
    if(!draft?.file) return;
    if(btn){ btn.disabled=true; btn.textContent='사진을 살펴보는 중…'; }
    const risk=await analyzeImageSrc(draft.url);
    if(state.attachDraft!==draft) return;   // 검사 중 창을 닫았으면 그대로 종료
    if(risk.checked && risk.risk){ paintAttachRisk(draft,risk); return; }
    closeModal();
    sendAttachment(draft.file,{risk:false,score:risk.score});
  }
  function paintAttachRisk(draft,risk){
    draft.risk=true; draft.score=risk.score;
    const panel=draft.panel;
    if(!panel || !panel.isConnected) return;
    const label=String(risk.label||'');
    const violent=/잔인|자극|폭력|피·상처|상처/.test(label);
    const kindWord=violent?'폭력적·자극적인':'선정적인';
          panel.innerHTML=`<h2>주의가 필요한 사진일 수 있어요</h2><div class="notice-ico warn" aria-hidden="true"><span>!</span></div>
      <p class="desc">자동 검사 결과 <b>${esc(label||'부적절한 내용')}</b> 가능성이 확인됐어요. 그래도 보내면 상대방 화면에 <b>주의가 필요한 사진</b>으로 표시돼요.</p>
      <p class="desc">${kindWord} 사진이 아닌데도 이 안내가 떴다면, 사진을 보내더라도 아무런 제지를 받지 않아요. (자동 검사는 가끔 실제와 다르게 판단할 수 있어요.)</p>
      ${draft.url?`<img class="attach-view" src="${esc(draft.url)}" alt="보낼 사진 미리보기">`:''}
      <div class="warn-box">부적절한 이미지를 여러 번 보낼 시 계정이 정지될 수 있어요.</div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>보내지 않기</button><button type="button" class="danger-btn" data-action="attach-send-risky">그래도 보내기</button></div>`;
    wrapModalHead(panel,true);
  }
  async function sendAttachment(file, screen){
    if(!file) return;
    if(!state.room) return toast('채팅방을 먼저 골라 주세요.');
    const roomId=state.room.id;   // 준비하는 사이에 방이 바뀌어도 원래 방으로만 보낸다
    const isImage=String(file.type||'').startsWith('image/');
    if(!isImage && file.size>FILE_MAX_BYTES) return toast(`파일은 ${fmtBytes(FILE_MAX_BYTES)}까지만 보낼 수 있어요. (지금 ${fmtBytes(file.size)})`);
    if(!isImage && file.size===0) return toast('빈 파일은 보낼 수 없어요.');
    toast('파일을 준비하고 있어요...');
    let data='', type=file.type||'', name=file.name||'파일';
    try{
      if(isImage){
        const c=await compressImage(file);
        if(!c) return toast('사진을 처리하지 못했어요. 다른 사진으로 다시 시도해 주세요.');
        data=c.data; type=c.type; name=name.replace(/\.[^.]+$/,'')+'.jpg';
      } else {
        data=await readAsDataUrl(file);
        if(!data) return toast('파일을 읽지 못했어요.');
      }
    }catch(e){ console.error(e); return toast('파일을 읽지 못했어요.'); }
    const flagged=isImage && !!(screen && screen.risk);
    // 850KB 이하는 기존처럼 메시지에 바로 넣고, 그 이상은 청크로 나눠 보낸다 (MB 파일 지원)
    if(data.length<=INLINE_MAX){
      const att={kind:isImage?'image':'file',name,type,size:isImage?Math.round(data.length*0.75):file.size,data};
      if(flagged){ att.risk=true; att.riskScore=Math.min(1,Number(screen.score)||0); }
      await sendMessage(null,att,roomId);
      if(flagged) await logImageFlag('image',screen,'사진');
      return;
    }
    if(isImage) return toast('사진이 너무 커요. 조금 작은 사진으로 보내 주세요.');
    await sendChunkedFile({roomId,file,name,type,size:file.size,data});
  }
  // 큰 파일 나누어 보내기: chunks를 먼저 쓰고 메시지를 만든다 (미완성 메시지가 보이지 않게)
  async function sendChunkedFile({roomId,file,name,type,size,data}){
    const chunks=[];
    for(let i=0;i<data.length;i+=CHUNK_SIZE) chunks.push(data.slice(i,i+CHUNK_SIZE));
    if(chunks.length>10) return toast('파일이 너무 커요. 8MB 이하 파일로 보내 주세요.');
    toast(`큰 파일을 ${chunks.length}조각으로 나누어 보내는 중이에요…`);
    try{
      const msgRef=db.collection('channels').doc(roomId).collection('messages').doc();
      const msgId=msgRef.id;
      for(let i=0;i<chunks.length;i++){
        await db.collection('channels').doc(roomId).collection('messages').doc(msgId).collection('chunks').doc(`${msgId}_${i}`).set({i,senderUid:uid(),data:chunks[i],createdAt:ts()});
        if(i%3===2) toast(`파일을 보내는 중이에요… (${i+1}/${chunks.length})`);
      }
      const batch=db.batch();
      const lastText=`📎 ${name||'파일'}`;
      batch.set(msgRef,{text:'',senderId:uid(),senderName:state.profile?.displayName||'사용자',senderRole:state.profile?.role||'student',replyToText:state.replyText||null,createdAt:ts(),deleted:false,attachment:{kind:'file',name,type,size,chunked:true,chunks:chunks.length}});
      batch.update(db.collection('channels').doc(roomId),{lastText,lastSenderId:uid(),lastSenderName:state.profile?.displayName||'사용자',lastCreatedAt:ts(),updatedAt:ts()});
      await batch.commit();
      state.attachCache instanceof Map||(state.attachCache=new Map());
      state.attachCache.set(msgId,data);
      try{ clearDraft(roomId); }catch(e){}
      toast('파일을 보냈어요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  // 청크 합치기: 캐시→없으면 서버에서 합쳐서 캐시에 둔다 (동일 메시지 중복 요청 방지)
  function attachDataOf(m){
    const att=m?.attachment; if(!att) return '';
    if(att.data) return att.data;
    if(!att.chunked) return '';
    if(state.attachCache instanceof Map && state.attachCache.has(m.id)) return state.attachCache.get(m.id);
    fetchAttachChunks(m);
    return '';
  }
  async function fetchAttachChunks(m){
    if(!m?.id||!state.room) return;
    if(!(state.attachCache instanceof Map)) state.attachCache=new Map();
    if(!(state.attachFetching instanceof Set)) state.attachFetching=new Set();
    if(state.attachCache.has(m.id)||state.attachFetching.has(m.id)) return;
    state.attachFetching.add(m.id);
    try{
      const roomId=state.room.id, n=Number(m.attachment?.chunks||0);
      if(!(n>0&&n<=10)) return;
      const parts=new Array(n);
      for(let i=0;i<n;i++){
        const s=await db.collection('channels').doc(roomId).collection('messages').doc(m.id).collection('chunks').doc(`${m.id}_${i}`).get();
        const v=s.exists?s.data():null;
        if(!v||v.senderUid!==m.senderId||typeof v.data!=='string'){ parts.fill(null); break; }
        parts[i]=v.data;
      }
      if(parts.every(x=>typeof x==='string')){
        state.attachCache.set(m.id,parts.join(''));
        if(state.room?.id===roomId){
          renderMessages(false);
          try{ fillChunkThumbs(m.id,parts.join('')); }catch(e){}
          try{ fillChunkDocs(m.id,parts.join('')); }catch(e){}
          try{ fillChunkViewer(m.id,parts.join('')); }catch(e){}
        }
      }
    }catch(e){ console.warn('chunks',e?.code||e); }
    finally{ state.attachFetching.delete(m.id); }
  }
  function fillChunkThumbs(msgId,data){
    document.querySelectorAll(`[data-chunkmsg="${esc(msgId)}"]`).forEach(el=>{
      if(el.tagName==='IMG'&&!el.src){ el.src=data; el.removeAttribute('data-chunkmsg'); }
    });
  }
  function fillChunkDocs(msgId,data){
    document.querySelectorAll(`[data-chunkdoc="${esc(msgId)}"]`).forEach(el=>{
      const m=(state.messages||[]).find(x=>x.id===msgId); if(!m) return;
      const href=safeFileHref(data); if(!href) return;
      const a=document.createElement('a');
      a.className='attach-card'; a.href=href; a.download=m.attachment?.name||'파일';
      a.innerHTML=`<span class="attach-ico">${esc(attachIcon(m.attachment))}</span><span class="grow"><span class="attach-name">${esc(m.attachment.name||'파일')}</span><span class="attach-size">${esc(fmtBytes(m.attachment.size))}</span></span>`;
      el.replaceWith(a);
    });
  }
  function fillChunkViewer(msgId,data){    const host=document.querySelector(`[data-chunkview="${esc(msgId)}"]`); if(!host) return;
    const m=(state.messages||[]).find(x=>x.id===msgId); if(!m) return;
    const src=safeImgSrc(data), href=safeFileHref(data);
    host.innerHTML=`${src?`<img class="attach-view" src="${esc(src)}" alt="">`:''}<div class="modal-actions"><button class="cancel" data-close-modal>닫기</button>${href?`<a class="confirm" style="text-decoration:none;display:grid;place-items:center" href="${esc(href)}" download="${esc(m.attachment?.name||'파일')}" data-close-modal>내려받기</a>`:''}</div>`;
  }

  function setReply(id){const m=state.messages.find(x=>x.id===id);if(!m||m.deleted)return;state.replyText=m.text||'';const ta=$('#composerText');if(ta){ta.placeholder=`“${(m.text||'').slice(0,28)}”에 답장해 보세요.`;ta.focus();}toast('답장을 준비했어요.');}
  // 입장·퇴장 알림 (삭제된 메시지처럼 가운데 알약으로, 모두에게 남는다)
  async function postSystemMessage(roomId,kind,targetName){
    if(!roomId||!targetName) return;
    try{
      await db.collection('channels').doc(roomId).collection('messages').add({
        system:kind,targetName:String(targetName).slice(0,20),text:'',
        senderId:uid(),senderName:state.profile?.displayName||'사용자',
        createdAt:ts(),deleted:false
      });
    }catch(e){ console.warn('system msg',e); }
  }
  function copyMessageText(id){
    const m=state.messages.find(x=>x.id===id); if(!m||m.deleted) return;
    const text=String(m.text||'');
    if(!text) return toast('복사할 글자가 없어요.');
    closeFloatMenu();
    return copyText(text,'복사했어요');
  }
  async function deleteMessage(id){
    const m=state.messages.find(x=>x.id===id); if(!m) return;
    const roomId=state.room?.id; if(!roomId) return;
    if(canPurgeMsg(m)){
      const staffDel=m.senderId!==uid() && canStaffPurge() && state.room?.createdBy!==uid();
      // 방장·본인은 모두의 화면에서 숨긴다 (즉시 파기하지 않고 deleted_at 을 남긴다)
      // 1번: 교사/관리자가 지우면 문구를 구분한다
      return confirmModal(staffDel?'이 메시지를 관리자로 삭제할까요?':'이 메시지를 지울까요?',staffDel?'학생에게 보이는 화면에서 사라지고, ‘관리자에 의해 삭제된 메시지예요’로 표시돼요.':'모두의 화면에서 사라져요. 원문도 함께 지워지고 30일 뒤 완전히 파기돼요.',async()=>{
        try{
          const patch={...softDeletePatch(),text:'',attachment:null};
          if(staffDel){ patch.staffDeleted=true; patch.deletedBy=uid(); patch.deletedByName=state.profile?.displayName||''; patch.deletedByRole=state.profile?.role||''; }
          await db.collection('channels').doc(roomId).collection('messages').doc(id).update(patch); await refreshLastTextAfterDelete(roomId,id); }
        catch(e){ console.error(e); return toast(errText(e)); }
        // 위 채팅이 아래로 미끄러지듯 내려오게 부드럽게 다시 그린다
        renderMessages(false);
        try{ await hapticMedium(); }catch(e){} toast('메시지를 지웠어요.');
      });
    }
    if(!canHideMsg(m)) return toast('이미 지워진 메시지예요.');
    const mine=m.senderId===uid();
    confirmModal('이 메시지를 지울까요?',
      mine?'내 화면에서만 사라져요. 다른 사람에게는 그대로 보여요.'
          :`상대방에게는 그대로 보이고, ${state.profile?.displayName||'나'}님의 기기에서만 지워져요.`,
      async()=>{
        try{ await hideMessages([m]); }
        catch(e){ console.error(e); return toast(errText(e)); }
        renderMessages(false);
        try{ await hapticMedium(); }catch(e){} toast('메시지를 지웠어요.');
      });
  }

  function hideNewMessageBanner(){
    const host=$('#globalBanner')||$('#newBanner'); if(!host)return;
    clearTimeout(state.banner.timer);
    host.classList.remove('show');
    host.classList.add('closing');
    setTimeout(()=>host.classList.remove('closing'),320);
  }
  function showNewMessageBanner(roomId,room,msg){
    if(isDnd()) return;
    const host=$('#globalBanner')||$('#newBanner'); if(!host)return; clearTimeout(state.banner.timer);
    host.dataset.roomId=roomId;
    host.innerHTML=`<div class="banner-row"><div class="banner-main"><div class="title">새 메시지가 왔어요</div><div class="text">${esc(room.name||'채팅방')} · ${esc(msg.senderName||'사용자')} · ${esc(msg.text||'')}</div></div><button type="button" class="banner-x" data-banner-close aria-label="알림 닫기">✕</button></div><div class="progress"><i></i></div>`;
    host.classList.remove('show','closing');requestAnimationFrame(()=>host.classList.add('show'));
    const x=host.querySelector('[data-banner-close]');
    if(x) x.addEventListener('click',e=>{ e.stopPropagation(); hideNewMessageBanner(); });
    host.onclick=()=>{hideNewMessageBanner();openRoom(roomId);};
    state.banner.timer=setTimeout(hideNewMessageBanner,5000);
  }
  // 채팅방 안에서 과거를 보고 있을 때 뜨는 고정 알림 (5초 제한 없이 계속 유지, 누르면 맨 밑으로)
  function hideInRoomPill(){
    const host=$('#newBanner'); if(!host) return;
    host.classList.remove('show');
  }
  function showInRoomPill(msg){
    if(isDnd()) return;
    const host=$('#newBanner'); if(!host||!state.room) return;
    host.innerHTML=`<div class="banner-row"><div class="banner-main"><div class="title">새 메시지가 왔어요</div><div class="text">${esc(msg.senderName||'사용자')} · ${esc(String(msg.text||'').slice(0,80))}</div></div><span class="banner-go" aria-hidden="true">▼</span></div>`;
    host.classList.remove('show');host.classList.add('bottom-pill','sticky');
    requestAnimationFrame(()=>host.classList.add('show'));
    host.onclick=()=>{ hideInRoomPill(); const h=$('#messages'); if(h) scrollMessagesToBottom(h,true); };
  }
  // 50개 이상 과거 메시지를 보고 있으면 상단 바 + 아래쪽 화살표 표시
  function updateOldChatBar(){
    const host=$('#messages'); if(!host) return;
    const bar=$('#oldChatBar'), fab=$('#jumpBottomFab');
    if(!bar && !fab) return;
    const rows=host.querySelectorAll('.message-row[data-msg-id]');
    let below=0;
    if(rows.length){
      const viewBottom=host.scrollTop+host.clientHeight;
      for(let i=rows.length-1;i>=0;i--){ if(rows[i].offsetTop>viewBottom-20) below++; else break; }
    }
    const show=below>50;
    if(bar) bar.classList.toggle('hidden',!show);
    if(fab) fab.classList.toggle('hidden',!show);
  }

  async function openRoomModal(){
    state.roomDraft={visibility:'private',name:'',desc:'',targets:'friends',codes:[],joinPolicy:'approve',step:1};
    openModal(`<h2>채팅방 만들기</h2><form id="roomForm" autocomplete="off"><div id="roomPane" class="room-pane"></div><div class="modal-actions" id="roomActions"></div></form>`);
    paintRoomModal('');
  }
  function paintRoomModal(anim){
    const d=state.roomDraft; if(!d) return;
    const pane=$('#roomPane'), act=$('#roomActions'); if(!pane||!act) return;
    const friends=(state.friends||[]).length;
    if(d.step===1){
      pane.innerHTML=`<p class="desc">개인 채팅방은 <b>내가 초대한 사람만</b>, 공유 채팅방은 <b>내가 정한 사람만</b> 들어올 수 있어요.</p>
        <div class="field"><label>이름</label><input class="input" name="name" maxlength="40" placeholder="예: 과학 3모둠" value="${esc(d.name||'')}" required></div>
        <div class="field"><label>설명</label><textarea class="input" name="description" maxlength="120" placeholder="어떤 방인지 간단히 적어 주세요.">${esc(d.desc||'')}</textarea></div>
        <div class="field"><label>공개 범위</label>
          <div class="choice-row" style="gap:8px">
            <button type="button" class="choice ${d.visibility==='private'?'active':''}" data-action="room-scope" data-scope="private" style="flex:1;height:44px">🔒 개인 채팅방</button>
            <button type="button" class="choice ${d.visibility==='all'?'active':''}" data-action="room-scope" data-scope="all" style="flex:1;height:44px">👥 공유 채팅방</button>
          </div>
          <p class="desc" style="margin:8px 0 0;font-size:12px" id="scopeHint">${d.visibility==='all'?'다음 화면에서 누구에게 공유할지 골라요.':'초대한 사람만 들어올 수 있어요. <b>개인 탭</b>으로 들어가요.'}</p>
        </div>`;
      act.innerHTML=`<button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" data-action="${d.visibility==='all'?'room-next':'room-create'}">${d.visibility==='all'?'다음':'만들기'}</button>`;
    } else {
      pane.innerHTML=`<p class="desc">'${esc(d.name||'채팅방')}'을(를) 누구에게 공유할까요?</p>
        <div class="field"><div class="share-choices">
          <button type="button" class="share-choice ${d.targets==='friends'?'on':''}" data-action="share-target" data-target="friends"><span class="sc-ico">👥</span><span class="grow"><span class="sc-title">친구 모두에게</span><span class="sc-sub">친구 ${friends}명에게 초대를 보내요</span></span></button>
          <button type="button" class="share-choice ${d.targets==='code'?'on':''}" data-action="share-target" data-target="code"><span class="sc-ico">🔑</span><span class="grow"><span class="sc-title">코드로 추가</span><span class="sc-sub">초대 코드를 입력해 한 명씩 추가해요</span></span></button>
          <button type="button" class="share-choice ${d.targets==='school'?'on':''}" data-action="share-target" data-target="school"><span class="sc-ico">🏫</span><span class="grow"><span class="sc-title">우리 학교 전체에게</span><span class="sc-sub">관리자·선생님 승인이 필요해요</span></span></button>
        </div></div>
        ${d.targets==='code'?`<div class="field"><label>초대할 사람의 코드</label><div class="row"><input id="shareCodeInput" class="input code-input" maxlength="12" spellcheck="false" placeholder="예: K7M3QP"><button type="button" class="soft-btn" style="flex:0 0 78px" data-action="share-add-code">추가</button></div><div class="word-preview">${(d.codes||[]).map(c=>`<span class="word-chip">${esc(c)}</span>`).join('')||'<span class="mini muted">아직 없어요.</span>'}</div></div>`:''}
        <div class="field"><label>코드로 들어오기</label>
          <div class="choice-row"><button type="button" class="choice ${d.joinPolicy==='approve'?'active':''}" data-action="join-policy-set" data-value="approve">방장 승인 후 입장</button><button type="button" class="choice ${d.joinPolicy==='open'?'active':''}" data-action="join-policy-set" data-value="open">코드만 입력하면 바로 입장</button></div>
          <p class="desc" style="margin:8px 0 0;font-size:12px">${d.joinPolicy==='open'?'반 단체방처럼 여러 명이 한 번에 들어올 때 편해요.':'아무나 들어오지 못하게 방장이 확인해요.'}</p>
        </div>`;
      act.innerHTML=`<button type="button" class="cancel" data-action="room-back">← 이전</button><button type="button" class="confirm" data-action="room-create">만들기</button>`;
    }
    if(anim){
      pane.classList.remove('pane-in-right','pane-in-left');
      void pane.offsetWidth;
      pane.classList.add(anim==='right'?'pane-in-right':'pane-in-left');
    }
    syncRoomDraftInputs();
  }
  function syncRoomDraftInputs(){
    const d=state.roomDraft; if(!d) return;
    const f=$('#roomForm'); if(!f) return;
    if(f.name) d.name=f.name.value;
    if(f.description) d.desc=f.description.value;
  }
  function openPrivateRoomModal(){
    state.roomDraft={visibility:'private',name:'',desc:'',targets:'friends',codes:[],joinPolicy:'approve',step:1};
    openModal(`<h2>개인 채팅방 만들기</h2><p class="desc">처음에는 나만 들어가 있어요. 나중에 원하는 사람을 초대할 수 있어요.</p><form id="roomForm" autocomplete="off"><div class="field"><label>방 이름</label><input class="input" name="name" maxlength="40" placeholder="예: 우리 셋" required></div><div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" data-action="room-create">만들기</button></div></form>`);
  }
  async function createRoom(){
    const d=state.roomDraft; if(!d) return;
    if(!isAdmin() && !licenseActiveInfo().active) return toast(licenseFrozenMessage());
    syncRoomDraftInputs();
    const name=(d.name||'').trim();
    if(!name) return toast('방 이름을 적어 주세요.');
    const shared=d.visibility==='all';
    if(shared && d.targets==='code' && !(d.codes||[]).length) return toast('초대할 코드를 하나 이상 추가해 주세요.');
    const sid=state.profile?.schoolId||''; const ck=myClassKey();
    // 교사가 학교 전체 대상으로 만들면 처음부터 전체 공유방으로 만든다 (승인 요청 없음)
    const instantAllShare=shared&&d.targets==='school'&&isTeacher();
    const data={
      name,
      description:(d.desc||'').trim(),
      type:shared?'group':'private',
      typeLabel:shared?'모둠/동아리':'개인',
      visibility:instantAllShare?'all':(shared?'members':'private'),
      joinCode:shared?randomCode(6):'',
      joinPolicy:d.joinPolicy||'approve',
      icon: randomRoomIcon(!shared),
      createdBy:uid(), memberIds:[uid()],
      createdAt:ts(), updatedAt:ts(), lastText:'',
      ...((sid)?{schoolId:sid,schoolName:state.profile?.schoolName||'',schoolIds:[sid]}:{}),
      ...((ck)?{classKeys:[ck]}:{})
    };
    let ref=null;
    try{ ref=await db.collection('channels').add(data); }
    catch(e){ console.error(e); return toast(errText(e)); }
    const roomId=ref.id;
    // 참가 코드는 코드표에도 따로 둔다 (방 문서를 열지 않고 코드로 찾을 수 있게)
    if(shared && data.joinPolicy==='open' && data.joinCode){
      db.collection('joinCodes').doc(data.joinCode).set({roomId,createdBy:uid(),createdAt:ts()}).catch(e=>console.warn('joinCodes',e));
    }
    state.rooms=[{id:roomId,...data},...state.rooms];
    closeAllModals();
    renderRooms();
    if(!shared){ toast('개인 채팅방을 만들었어요.'); return openRoom(roomId); }
    // 공유 대상 처리
    const invites=[];
    if(d.targets==='friends'){
      (state.friends||[]).forEach(f=>{ if(f.uid&&f.uid!==uid()) invites.push({uid:f.uid,name:(f.profile||{}).displayName||'친구',schoolId:(f.profile||{}).schoolId||''}); });
    } else if(d.targets==='code'){
      for(const c of (d.codes||[])){
        try{ const found=await findUserByCode(c); if(found&&found.uid!==uid()) invites.push({uid:found.uid,name:(found.profile||{}).displayName||'사용자',schoolId:(found.profile||{}).schoolId||''}); }
        catch(e){ console.error('share code',e); }
      }
    }
    let sent=0;
    for(const t of invites){
      try{ await sendRoomInvite(roomId,name,t.uid,t.name,t.schoolId||''); sent++; }
      catch(e){ console.error('invite',e); }
    }
    if(d.targets==='school'){
      // 교사가 직접 만들 때는 승인 요청 없이 바로 전체 공유방으로 연다
      if(isTeacher()){
        renderRooms();
        toast('우리 학교 전체 공유 채팅방을 만들었어요.');
      } else {
        try{
          await db.collection('shareRequests').add({roomId,roomName:name,requestedBy:uid(),requestedByName:state.profile?.displayName||'',schoolId:sid,schoolName:state.profile?.schoolName||'',status:'pending',createdAt:ts()});
          toast('관리자·선생님께 우리 학교 전체 공유를 요청했어요.');
        }catch(e){ console.error(e); toast('공유 요청을 보내지 못했어요.'); }
      }
    } else {
      toast(sent?`공유 채팅방을 만들고 ${sent}명에게 초대를 보냈어요.`:'공유 채팅방을 만들었어요.');
    }
    await openRoom(roomId);
  }
  // 초대장의 crossOk 판정: 타학교면 true (규칙이 교사·승인 여부를 검증하고, 수락 시점에 다시 따지지 않는다)
  function crossOkFor(targetSchoolId){
    const mySid=state.profile?.schoolId||'';
    return !!(mySid && targetSchoolId && targetSchoolId!==mySid);
  }
  async function sendRoomInvite(roomId,roomName,targetUid,targetName,targetSchoolId){
    const inviteId=`${roomId}_${targetUid}`;
    await db.collection('roomInvites').doc(inviteId).set({roomId,roomName:roomName||'',targetUid,targetName:targetName||'',inviterId:uid(),inviterName:state.profile?.displayName||'',status:'pending',crossOk:crossOkFor(targetSchoolId),createdAt:ts(),updatedAt:ts()},{merge:true});
  }
  // 프로필에서 1:1 대화: 기존 1:1 방이 있으면 열고, 없으면 내 방을 만든 뒤 초대한다 (상대 수락 후 대화)
  async function startDM(targetUid,targetName){
    if(!targetUid||targetUid===uid()) return;
    if(!isAdmin() && !licenseActiveInfo().active) return toast(licenseFrozenMessage());
    if((state.profile?.blockedUsers||[]).includes(targetUid)) return toast('차단한 사용자예요. 차단을 풀고 시도해 주세요.');
    try{ if(await hasBlockedMe(targetUid)) return toast('상대방이 차단을 해서 초대를 보낼 수 없어요.'); }catch(e){}
    // 프로필이 캐시에 없으면 학교·초대설정 확인을 위해 한 번 읽는다
    let tp=state.profileCache.get(targetUid)||null;
    if(!tp){
      try{ const ps=await db.collection('publicProfiles').doc(targetUid).get(); if(ps.exists){ tp=ps.data(); state.profileCache.set(targetUid,tp); } }catch(e){}
    }
    tp=tp||{};
    if(tp.invitePolicy==='block') return toast('이 사람은 초대를 받지 않도록 설정했어요.');
    // 타학교 1:1은 학생끼리 바로 못 하고 선생님 승인이 먼저 필요하다
    if(!isTeacherOrAdmin()){
      const mySid=state.profile?.schoolId||'';
      if(tp.schoolId && mySid && tp.schoolId!==mySid){
        let ok=false;
        try{ ok=await crossApproved(targetUid); }catch(e){}
        if(!ok){
          confirmModal(`${targetName||'사용자'}님은 다른 학교 사람이에요`,'다른 학교와 1:1 대화는 선생님의 승인이 먼저 필요해요. 지금 승인 요청을 보낼까요?',async()=>{
            await requestCrossSchool(targetUid, targetName||'사용자', tp.schoolId||'', tp.schoolName||'');
          });
          return;
        }
      }
    }
    const ex=(state.rooms||[]).find(r=>(r.visibility||'')==='private' && !r.deleted && !r.deleted_at
      && (r.memberIds||[]).length===2 && (r.memberIds||[]).includes(uid()) && (r.memberIds||[]).includes(targetUid));
    if(ex){ closeAllModals(); return openRoom(ex.id); }
    const nm=String(targetName||'사용자').slice(0,20);
    const sid=state.profile?.schoolId||''; const ck=myClassKey();
    let ref=null;
    try{
      ref=await db.collection('channels').add({
        name:`${nm}님과의 대화`, description:'', type:'private', typeLabel:'개인',
        visibility:'private', joinCode:'', joinPolicy:'approve',
        createdBy:uid(), memberIds:[uid()],
        createdAt:ts(), updatedAt:ts(), lastText:'',
        ...((sid)?{schoolId:sid,schoolName:state.profile?.schoolName||'',schoolIds:[sid]}:{}),
        ...((ck)?{classKeys:[ck]}:{})
      });
    }catch(e){ console.error(e); return toast(errText(e)); }
    try{ await sendRoomInvite(ref.id, `${nm}님과의 대화`, targetUid, nm, tp.schoolId||''); }
    catch(e){
      console.error(e);
      // 초대가 막히면 빈 방이 남지 않게 만든 방을 바로 치운다
      try{ await db.collection('channels').doc(ref.id).update({...softDeletePatch(),updatedAt:ts()}); }catch(_){}
      return toast(errText(e));
    }
    state.rooms=[{id:ref.id,name:`${nm}님과의 대화`,type:'private',visibility:'private',createdBy:uid(),memberIds:[uid()],createdAt:new Date(),updatedAt:new Date(),lastText:'',schoolId:sid},...state.rooms];
    closeAllModals();
    renderRooms();
    toast('1:1 초대를 보냈어요. 상대가 수락하면 대화할 수 있어요.');
    openRoom(ref.id);
  }
  async function deleteRoom(id){
    const r=state.rooms.find(x=>x.id===id)||state.room;
    if(!r||r.createdBy!==uid()) return toast('내가 만든 채팅방만 지울 수 있어요.');
    openDangerConfirm({
      title:'이 채팅방을 지울까요?',
      desc:'목록에서 사라지고, 30일 뒤 기록이 완전히 파기돼요.',
      requireText:'', seconds:5, confirmLabel:'지우기',
      checkLabel:'위 내용을 이해했고, 지워도 됩니다.',
      onConfirm: async ()=>{
        try{ await db.collection('channels').doc(id).update({...softDeletePatch(),updatedAt:ts()}); }
        catch(e){ console.error(e); return toast(errText(e)); }
        closeAllModals();
        if(state.room?.id===id){ state.room=null; clearRoomListener(); clearChatPane(); }
        state.rooms=state.rooms.filter(x=>x.id!==id);
        renderRooms();
        toast('채팅방을 지웠어요.');
      }
    });
  }
  // ---------- 나간 방 기록 (공개방도 나간 뒤엔 없던 것처럼) ----------
  function leftRoomsKey(){ try{ return 'edutalk_left_rooms_'+String(uid()||'anon'); }catch(e){ return 'edutalk_left_rooms_anon'; } }
  function getLeftRooms(){
    try{
      const raw=localStorage.getItem(leftRoomsKey());
      if(!raw) return {};
      const o=JSON.parse(raw);
      return (o&&typeof o==='object')?o:{};
    }catch(e){ return {}; }
  }
  function isRoomLeft(id){
    try{ return !!getLeftRooms()[String(id||'')]; }catch(e){ return false; }
  }
  function markRoomLeft(id){
    try{
      const k=leftRoomsKey(); const o=getLeftRooms();
      o[String(id)]=Date.now();
      try{ localStorage.setItem(k, JSON.stringify(o)); }catch(e){}
    }catch(e){}
  }
  function unmarkRoomLeft(id){
    try{
      const k=leftRoomsKey(); const o=getLeftRooms();
      if(String(id) in o){ delete o[String(id)]; try{ localStorage.setItem(k, JSON.stringify(o)); }catch(e){} }
    }catch(e){}
  }
  async function autoTransferOwnershipIfOwner(roomId){
    // 방장이 나갈 때 남은 멤버 중 1명에게 자동으로 방장을 넘긴다. 넘길 사람이 없으면 null.
    try{
      let fresh=null;
      try{ const s=await db.collection('channels').doc(roomId).get(); if(s.exists) fresh={id:roomId,...s.data()}; }catch(e){}
      if(!fresh) return null;
      if(fresh.createdBy!==uid()) return fresh.createdBy||null;
      const others=(fresh.memberIds||[]).filter(x=>x&&x!==uid());
      if(!others.length) return null;
      const newOwner=others[0];
      try{ await db.collection('channels').doc(roomId).update({createdBy:newOwner,updatedAt:ts()}); }
      catch(e){ console.error(e); return fresh.createdBy||null; }
      state.rooms=(state.rooms||[]).map(x=>x.id===roomId?{...x,createdBy:newOwner}:x);
      if(state.allRooms) state.allRooms=state.allRooms.map(x=>x.id===roomId?{...x,createdBy:newOwner}:x);
      if(state.room?.id===roomId) state.room={...state.room,createdBy:newOwner};
      return newOwner;
    }catch(e){ return null; }
  }
  function closeRoomSettingsIfOpen(roomId){
    try{
      if(state.roomManageOpen && (!roomId || state.roomManagePrevId===roomId)){
        closeRoomSettings();
      }
    }catch(e){}
  }
  async function leaveRoom(id){
    const r=state.rooms.find(x=>x.id===id)||state.room||((state.allRooms||[]).find(x=>x.id===id));
    if(!r) return;
    if(!(r.memberIds||[]).includes(uid())) return toast('이미 나와 있는 채팅방이에요.');
    if(!isAdmin() && !licenseActiveInfo().active) return toast(licenseFrozenMessage());
    const owner=r.createdBy===uid();
    const othersCount=(r.memberIds||[]).filter(x=>x&&x!==uid()).length;
    confirmModal('이 채팅방에서 나갈까요?',
      owner?(othersCount>0?'방장이 나가면 다른 참여자에게 방장이 자동으로 넘어가요. 나간 방은 목록에서 사라져요.':'나간 방은 목록에서 사라져요. 다시 초대받으면 들어올 수 있어요.'):'나간 방은 목록에서 사라져요. 다시 초대받으면 들어올 수 있어요.',
      async()=>{
        try{
          if(owner && othersCount>0){
            await autoTransferOwnershipIfOwner(id);
          }
        }catch(e){ console.error(e); }
        try{ await postSystemMessage(id,'leave',state.profile?.displayName||'사용자'); }catch(e){ console.error(e); }
        try{ await db.collection('channels').doc(id).update({memberIds:firebase.firestore.FieldValue.arrayRemove(uid()),updatedAt:ts()}); }
        catch(e){ console.error(e); return toast(errText(e)); }
        // 내 타이핑·읽음 표시도 함께 지운다 (유령 표시 방지)
        try{ await db.collection('channels').doc(id).collection('typing').doc(uid()).delete().catch(()=>{}); }catch(e){}
        try{ await db.collection('channels').doc(id).collection('reads').doc(uid()).delete().catch(()=>{}); }catch(e){}
        // 진짜 나가기: 나간 기록을 남기고, 목록에서 제거하고, 보고 있던 방·설정 화면도 닫는다
        markRoomLeft(id);
        state.rooms=state.rooms.filter(x=>x.id!==id);
        if(state.allRooms) state.allRooms=state.allRooms.filter(x=>x.id!==id);
        if(state.unread && state.unread[id]!==undefined){ delete state.unread[id]; try{ renderUnreadSummary(); }catch(e){} }
        closeAllModals();
        closeRoomSettingsIfOpen(id);
        if(state.room?.id===id){ state.room=null; clearRoomListener(); clearChatPane(); }
        // 설정 화면에서 나간 경우 뒤에 남은 설정 화면이 현재 방을 가리키면 닫는다
        try{ renderRooms(); }catch(e){}
        toast('채팅방에서 나왔어요.');
      });
  }
  async function leaveManyRooms(list){
    const rooms=(list||[]).filter(r=>r&&(r.memberIds||[]).includes(uid()));
    if(!rooms.length) return toast('나갈 채팅방을 먼저 골라 주세요.');
    if(!isAdmin() && !licenseActiveInfo().active) return toast(licenseFrozenMessage());
    for(const r of rooms){
      if(r.createdBy===uid() && (r.memberIds||[]).filter(x=>x&&x!==uid()).length>0){
        await autoTransferOwnershipIfOwner(r.id);
      }
      await postSystemMessage(r.id,'leave',state.profile?.displayName||'사용자');
    }
    try{
      const batch=db.batch();
      rooms.forEach(r=>batch.update(db.collection('channels').doc(r.id),{memberIds:firebase.firestore.FieldValue.arrayRemove(uid()),updatedAt:ts()}));
      await batch.commit();
    }catch(e){ console.error(e); return toast(errText(e)); }
    const ids=new Set(rooms.map(r=>r.id));
    ids.forEach(id=>{ markRoomLeft(id); if(state.unread) delete state.unread[id]; });
    try{ renderUnreadSummary(); }catch(e){}
    state.rooms=state.rooms.filter(x=>!ids.has(x.id));
    if(state.allRooms) state.allRooms=state.allRooms.filter(x=>!ids.has(x.id));
    if(state.room&&ids.has(state.room.id)){ state.room=null; clearRoomListener(); clearChatPane(); }
    ids.forEach(id=>closeRoomSettingsIfOpen(id));
    state.cmSel=new Set();
    closeAllModals(); renderRooms();
    toast(`${rooms.length}개 채팅방에서 나왔어요.`);
  }

  function openRoomManage(id){
    const r=state.rooms.find(x=>x.id===id)||state.room||((state.allRooms||[]).find(x=>x.id===id));
    if(!r) return;
    // PC처럼 넓은 화면(>820px)에서는 사이드바를 유지하고 메인만 설정 화면으로 바꾼다 (모션 포함)
    const isWide = window.innerWidth>820 && document.querySelector('.app .main');
    if(isWide){
      const prev = state.roomManagePrev;
      // 이미 방 설정 화면이 열려 있으면 탭만 전환
      if(state.roomManageOpen && state.roomManagePrevId===id){
        document.querySelectorAll('[data-roomman-tab]').forEach(b=> b.classList.toggle('active', b.dataset.roommanTab=== (state.roomManTab||'general')));
        document.querySelectorAll('[data-roomman-pane]').forEach(p=> p.classList.toggle('hidden', p.dataset.roommanPane!== (state.roomManTab||'general')));
        return;
      }
      // 메인 패널을 설정 화면으로 교체 (뒤로가기 위해 기존 HTML 저장)
      const main=document.querySelector('.app .main');
      if(main){
        if(!state.roomManageOpen){
          state.roomManagePrev = main.innerHTML;
          state.roomManageOpen = true;
        }
        state.roomManagePrevId=id;
        state.roomManTab = state.roomManTab||'general';
        const tabActive=(k)=> state.roomManTab===k?'active':'';
        ensureJoinCodeMapping(r);
        const isOwner=r.createdBy===uid();
        const canEdit=isOwner||isAdmin();
        const isMember=(r.memberIds||[]).includes(uid());
        const muted=isRoomMuted(r.id);
        const off=!!(chatCfg().chatOffRooms||{})[r.id];
        const shared=r.visibility!=='private';
        // 탭별 아이템을 아이콘과 함께 나눈다
        const general=[];
        general.push(`<button class="list-item" data-action="room-icon" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🖼️ 채팅방 아이콘</div><div class="meta">이모지·사진으로 방을 꾸며요</div></div><span class="room-icon-inline">${roomIconHtml(r)}</span></button>`);
        general.push(`<button class="list-item" data-action="mute-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">${muted?'🔕 알림 켜기':'🔔 알림 끄기'}</div><div class="meta">${muted?'알림을 다시 받아요':'이 방만 알림을 꺼요'}</div></div></button>`);
        if(canEdit&&shared) general.push(`<button class="list-item" data-action="join-policy" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🔑 코드로 들어오기</div><div class="meta">${r.joinPolicy==='open'?'코드만 입력하면 바로 입장':'방장 승인 후 입장'}</div></div><span>›</span></button>`);
        if(canEdit&&r.joinCode) general.push(`<button class="list-item" data-action="copy-join-code" data-code="${esc(r.joinCode)}"><div class="grow"><div class="title">📋 참가 코드 복사</div><div class="meta">${esc(r.joinCode)}</div></div><span>🔗</span></button>`);
        if(isOwner&&r.joinCode) general.push(`<button class="list-item" data-action="copy-invite-link" data-code="${esc(r.joinCode)}"><div class="grow"><div class="title">🔗 초대 링크 복사</div><div class="meta">코드로 바로 들어오는 링크</div></div><span>›</span></button>`);
        if(isAdmin()) general.push(`<button class="list-item" data-action="room-chat-off" data-room-id="${esc(r.id)}"><div class="grow"><div class="title" style="color:${off?'var(--blue)':'var(--danger)'}">${off?'▶ 채팅 정지 풀기':'⏸ 이 방 채팅 정지'}</div></div></button>`);
        if(state.room&&state.room.id===r.id) general.push(`<button class="list-item" data-action="export-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">💾 대화 내보내기</div></div></button>`);
        general.push(`<button class="list-item" data-action="poll-open" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">📊 투표 만들기</div></div></button>`);
        if(state.room&&state.room.id===r.id) general.push(`<button class="list-item" data-action="file-box" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🖼️ 사진·파일함</div></div></button>`);
        general.push(`<button class="list-item" data-action="todo-open" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">✅ 할 일</div><div class="meta">모둠 할 일을 관리해요 (일정 탭에서도 볼 수 있어요)</div></div></button>`);
        general.push(`<button class="list-item" data-action="attend-open" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">📝 출석 체크</div></div></button>`);
        const members=[];
        members.push(`<button class="list-item" data-action="members" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">👥 참여자 보기</div><div class="meta">${(r.memberIds||[]).length}명</div></div><span>›</span></button>`);
        if(canEdit) members.push(`<button class="list-item" data-action="invite" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">➕ 사람 초대하기</div></div><span>›</span></button>`);
        if(r.type==='notice'&&isAdmin()) members.push(`<button class="list-item" data-action="audience" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">📢 공지 대상 정하기</div></div></button>`);
        if(r.type==='notice'&&isTeacher()) members.push(`<button class="list-item" data-action="renotify-unread" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🔔 안 읽은 사람 다시 알림</div></div></button>`);
        if(shared&&isTeacher()) members.push(`<button class="list-item" data-action="notice-from-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">📌 공지방 만들기</div></div></button>`);
        const manage=[];
        if(isOwner) manage.push(`<button class="list-item" data-action="owner-transfer" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">👑 방장 이전</div></div></button>`);
        if(isOwner) manage.push(`<button class="list-item" data-action="delete-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title" style="color:var(--danger)">🗑️ 채팅방 삭제</div></div></button>`);
        if(isMember) manage.push(`<button class="list-item" data-action="leave-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🚪 채팅방 나가기</div></div></button>`);
        // 전체 설정(상단 기어)는 전체화면, 방 설정은 메인만 교체: 뒤로가기 버튼으로 원래 채팅 복원
        main.innerHTML = `<div class="room-settings-screen">
          <div class="room-settings-head"><button class="icon-btn" data-action="close-room-settings" aria-label="뒤로">←</button><div class="grow"><div class="rs-title">${esc(r.name)} 설정</div><div class="rs-sub"><span class="rs-ico">${roomIconHtml(r)}</span><span>${esc(r.typeLabel||'채팅방')}</span></div></div><button class="icon-btn" data-action="close-room-settings" aria-label="닫기">✕</button></div>
          <div class="room-settings-body">
            <div class="room-settings-tabs">
              <button class="tab ${tabActive('general')}" data-roomman-tab="general"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4 1.4"/></svg></span> 일반</button>
              <button class="tab ${tabActive('members')}" data-roomman-tab="members"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V21"/><circle cx="10" cy="7" r="3"/><circle cx="17.5" cy="7" r="2.5"/><path d="M18.5 13.5A4 4 0 0 1 21 17v4"/></svg></span> 멤버</button>
              <button class="tab ${tabActive('manage')}" data-roomman-tab="manage"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L2 19l1 1 7.1-7.1a4 4 0 0 0 5.6-5.6Z"/><path d="M8.5 8.5 13 13"/></svg></span> 관리</button>
            </div>
            <div class="room-man-pane ${state.roomManTab==='general'?'':'hidden'}" data-roomman-pane="general"><div class="settings-list">${general.join('')}</div></div>
            <div class="room-man-pane ${state.roomManTab==='members'?'':'hidden'}" data-roomman-pane="members"><div class="settings-list">${members.join('')}</div><div id="joinReqHost"></div></div>
            <div class="room-man-pane ${state.roomManTab==='manage'?'':'hidden'}" data-roomman-pane="manage"><div class="settings-list">${manage.join('')}</div></div>
          </div>
        </div>`;
        // 탭 전환 + 실시간 반영
        main.querySelectorAll('[data-roomman-tab]').forEach(b=> b.onclick=()=>{
          state.roomManTab=b.dataset.roommanTab;
          main.querySelectorAll('[data-roomman-tab]').forEach(x=>x.classList.toggle('active', x===b));
          main.querySelectorAll('[data-roomman-pane]').forEach(p=> p.classList.toggle('hidden', p.dataset.roommanPane!==state.roomManTab));
          setTimeout(()=> updateTabsIndicator(main.querySelector('.room-settings-tabs')), 30);
          if(!prefersReducedMotion()){
            const pane=main.querySelector('[data-roomman-pane="'+state.roomManTab+'"]');
            if(pane){ pane.classList.remove('pane-in-right'); void pane.offsetWidth; pane.classList.add('pane-in-right'); }
          }
        });
        setTimeout(()=> updateTabsIndicator(main.querySelector('.room-settings-tabs')), 30);
        if(canEdit&&shared) setTimeout(()=>renderJoinRequests(r.id), 80);
        return;
      }
    }
    // 좁은 화면 또는 fallback: 기존 팝업 (탭 + 아이콘으로 개선)
    ensureJoinCodeMapping(r);
    const isOwner2=r.createdBy===uid();
    const canEdit2=isOwner2||isAdmin();
    const isMember2=(r.memberIds||[]).includes(uid());
    const muted2=isRoomMuted(r.id);
    const off2=!!(chatCfg().chatOffRooms||{})[r.id];
    const shared2=r.visibility!=='private';
    const items2=[];
    items2.push(`<button class="list-item" data-action="members" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">👥 참여자 보기</div><div class="meta">지금 ${(r.memberIds||[]).length}명이 함께 있어요.</div></div><span>›</span></button>`);
    items2.push(`<button class="list-item" data-action="mute-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">${muted2?'🔕 알림 켜기':'🔔 알림 끄기'}</div></div></button>`);
    if(canEdit2) items2.push(`<button class="list-item" data-action="room-icon" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🖼️ 채팅방 아이콘</div></div><span class="room-icon-inline">${roomIconHtml(r)}</span></button>`);
    if(canEdit2&&shared2) items2.push(`<button class="list-item" data-action="join-policy" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🔑 코드로 들어오기</div></div><span>›</span></button>`);
    if(canEdit2&&r.joinCode) items2.push(`<button class="list-item" data-action="copy-join-code" data-code="${esc(r.joinCode)}"><div class="grow"><div class="title">📋 참가 코드 복사</div></div><span class="code-chip">${esc(r.joinCode)}</span></button>`);
    if(isOwner2&&r.joinCode) items2.push(`<button class="list-item" data-action="copy-invite-link" data-code="${esc(r.joinCode)}"><div class="grow"><div class="title">🔗 초대 링크 복사</div></div><span>›</span></button>`);
    if(isAdmin()) items2.push(`<button class="list-item" data-action="room-chat-off" data-room-id="${esc(r.id)}"><div class="grow"><div class="title" style="color:${off2?'var(--blue)':'var(--danger)'}">${off2?'▶ 채팅 정지 풀기':'⏸ 이 방 채팅 정지'}</div></div></button>`);
    if(r.type==='notice'&&isAdmin()) items2.push(`<button class="list-item" data-action="audience" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">📢 공지 대상 정하기</div></div></button>`);
    if(r.type==='notice'&&isTeacher()) items2.push(`<button class="list-item" data-action="renotify-unread" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🔔 안 읽은 사람 다시 알림</div></div></button>`);
    if(shared2&&isTeacher()) items2.push(`<button class="list-item" data-action="notice-from-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">📌 공지방 만들기</div></div></button>`);
    if(canEdit2) items2.push(`<button class="list-item" data-action="invite" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">➕ 사람 초대하기</div></div></button>`);
    if(state.room&&state.room.id===r.id) items2.push(`<button class="list-item" data-action="export-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">💾 대화 내보내기</div></div></button>`);
    if(isMember2) items2.push(`<button class="list-item" data-action="poll-open" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">📊 투표 만들기</div></div></button>`);
    if(isAdmin()&&!isMember2) items2.push(`<button class="list-item" data-action="admin-join" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">👑 관리자로 참가하기</div></div></button>`);
    if(state.room&&state.room.id===r.id){
      items2.push(`<button class="list-item" data-action="file-box" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🖼️ 사진·파일함</div></div></button>`);
      items2.push(`<button class="list-item" data-action="todo-open" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">✅ 할 일</div><div class="meta">모둠 할 일을 체크리스트로 관리해요 (일정 탭에서도 볼 수 있어요)</div></div></button>`);
    }
    if(isMember2) items2.push(`<button class="list-item" data-action="attend-open" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">📝 출석 체크</div></div></button>`);
    if(isOwner2) items2.push(`<button class="list-item" data-action="owner-transfer" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">👑 방장 이전</div></div></button>`);
    if(isOwner2) items2.push(`<button class="list-item" data-action="delete-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title" style="color:var(--danger)">🗑️ 채팅방 삭제</div></div></button>`);
    if(isMember2) items2.push(`<button class="list-item" data-action="leave-room" data-room-id="${esc(r.id)}"><div class="grow"><div class="title">🚪 채팅방 나가기</div></div></button>`);
    // 팝업도 탭 없이 아이콘으로만 개선 (좁은 화면은 팝업이 더 자연스러움)
    openModal(`<h2>채팅방 설정</h2><p class="desc">${esc(r.name)}</p><div class="settings-list">${items2.join('')}</div><div id="joinReqHost"></div>`);
    if(canEdit2&&shared2) renderJoinRequests(r.id);
  }
  function closeRoomSettings(){
    const main=document.querySelector('.app .main');
    if(!main || !state.roomManageOpen) return;
    const prev=state.roomManagePrev;
    state.roomManageOpen=false; state.roomManagePrev=null; state.roomManagePrevId=null;
    if(prev!==null){
      main.innerHTML=prev;
      try{ renderMessages(false); }catch(e){}
      try{ renderSidebar(); }catch(e){}
      // 부드러운 복원 모션
      if(!prefersReducedMotion()){
        const chat=document.getElementById('chat');
        if(chat){ chat.classList.add('room-enter'); setTimeout(()=>chat.classList.remove('room-enter'), 420); }
      }
    } else {
      try{ renderShell(); }catch(e){}
    }
  }
  async function openOwnerTransferModal(roomId){
    const r=state.rooms.find(x=>x.id===roomId)||state.room;
    if(!r||r.createdBy!==uid()) return toast('방장만 이전할 수 있어요.');
    const ids=(r.memberIds||[]).filter(id=>id&&id!==uid());
    if(!ids.length) return toast('넘겨줄 사람이 없어요. 먼저 초대해 주세요.');
    await ensureProfilesAll(ids);
    openModal(`<h2>방장 이전</h2><p class="desc">${esc(r.name||'채팅방')}의 방장을 누구에게 넘길까요? 넘기면 삭제·관리 권한이 함께 넘어가요.</p>
      <div class="list modal-scroll">${ids.map(id=>{
        const p=state.profileCache.get(id)||{};
        const nm=p.displayName||'사용자';
        return `<button class="list-item" data-action="owner-transfer-pick" data-room="${esc(roomId)}" data-uid="${esc(id)}" data-name="${esc(nm)}"><div class="grow"><div class="title">${esc(nm)}</div><div class="meta">${gradeClassPrefix({grade:p.grade,classNum:p.classNum})}${esc(roleLabel(p.role))}</div></div><span>›</span></button>`;
      }).join('')}</div>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button></div>`);
  }
  async function applyOwnerTransfer(roomId, newUid){
    const r=state.rooms.find(x=>x.id===roomId)||state.room;
    if(!r||r.createdBy!==uid()) return toast('방장만 이전할 수 있어요.');
    if(!newUid||newUid===uid()) return;
    const nm=(state.profileCache.get(newUid)||{}).displayName||'사용자';
    openDangerConfirm({
      title:'정말 방장을 이전할까요?',
      desc:`${nm}님에게 방장을 넘기면, 삭제·관리 권한이 함께 넘어가고 되돌리려면 새 방장에게 부탁해야 해요.`,
      requireText:'', seconds:5, confirmLabel:'이전하기',
      checkLabel:'위 내용을 이해했고, 방장을 이전해도 됩니다.',
      onConfirm: async ()=>{
        let fresh=r;
        try{ const s=await db.collection('channels').doc(roomId).get(); if(s.exists) fresh={id:roomId,...s.data()}; }catch(e){}
        if(fresh.createdBy!==uid()){ toast('이미 방장이 바뀌었어요.'); return; }
        if(!(fresh.memberIds||[]).includes(newUid)){ toast('지금 참여 중인 사람에게만 넘길 수 있어요.'); return; }
        try{ await db.collection('channels').doc(roomId).update({createdBy:newUid,updatedAt:ts()}); }
        catch(e){ console.error(e); toast(errText(e)); return; }
        state.rooms=(state.rooms||[]).map(x=>x.id===roomId?{...x,createdBy:newUid}:x);
        if(state.room?.id===roomId){ state.room={...state.room,createdBy:newUid}; refreshChatFrame(); }
        if(state.allRooms) state.allRooms=state.allRooms.map(x=>x.id===roomId?{...x,createdBy:newUid}:x);
        if(state.memberPanel) renderMemberPanel();
        renderRooms();
        closeAllModals();
        try{ await hapticSuccess(); }catch(e){} toast('방장을 넘겼어요.');
      }
    });
  }
  // ---------- 할 일 (방별 체크리스트) ----------
  async function openTodosModal(roomId){
    const r=state.rooms.find(x=>x.id===roomId)||state.room;
    if(!r) return;
    openModal(`<h2>할 일</h2><p class="desc">${esc(r.name||'채팅방')} · 누구나 추가하고, 완료는 본인 이름으로 찍어요.</p>
      <div id="todoList" class="list"><div class="empty-side">불러오는 중…</div></div>
      <div class="row" style="margin-top:12px"><input id="todoInput" class="input" maxlength="200" placeholder="예: 과학 준비물 챙기기" style="flex:1;min-width:0"><button type="button" class="soft-btn" style="flex:0 0 72px" data-action="todo-add" data-room-id="${esc(r.id)}">추가</button></div>
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
    const ti0=$('#todoInput');
    if(ti0){ try{ ti0.focus(); }catch(e){} ti0.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); addTodo(roomId); } }; }
    await renderTodos(roomId);
  }
  async function renderTodos(roomId){
    const host=$('#todoList'); if(!host) return;
    let rows=[];
    try{
      const s=await db.collection('channels').doc(roomId).collection('todos').orderBy('createdAt','asc').limit(100).get();
      rows=s.docs.map(d=>({id:d.id,...d.data()}));
    }catch(e){ console.error(e); host.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; return; }
    const r=state.rooms.find(x=>x.id===roomId)||state.room||{};
    const done=rows.filter(t=>t.done).length;
    host.innerHTML=(rows.length?`<div class="empty-side" style="padding:6px 0 10px">${done}/${rows.length}개 완료</div>`:'')
      +rows.map(t=>{
        const mine=t.createdBy===uid();
        const canDel=isAdmin()||mine||(r.createdBy===uid());
        const who=t.done&&t.doneBy?` · ${(state.profileCache.get(t.doneBy)||{}).displayName||t.doneByName||'완료'}`:'';
        return `<div class="list-item todo-item${t.done?' done':''}"><button type="button" class="todo-check${t.done?' on':''}" data-action="todo-toggle" data-room-id="${esc(roomId)}" data-id="${esc(t.id)}" aria-label="완료 표시">✓</button><div class="grow"><div class="title">${esc(t.text||'')}</div><div class="meta">${esc(t.done?`완료${who}`:'미완료')}</div></div>${canDel?`<button type="button" class="soft-btn" style="flex:0 0 60px;color:var(--danger)" data-action="todo-del" data-room-id="${esc(roomId)}" data-id="${esc(t.id)}">삭제</button>`:''}</div>`;
      }).join('')||'<div class="empty-side">아직 할 일이 없어요.</div>';
  }
  async function addTodo(roomId){
    const v=($('#todoInput')?.value||'').trim();
    if(!v) return toast('할 일을 적어 주세요.');
    try{
      await db.collection('channels').doc(roomId).collection('todos').add({text:v.slice(0,200),done:false,doneBy:'',doneByName:'',createdBy:uid(),createdAt:ts(),updatedAt:ts()});
    }catch(e){ console.error(e); return toast(errText(e)); }
    const inp=$('#todoInput'); if(inp) inp.value='';
    await renderTodos(roomId);
    try{ await refreshBanners(true); }catch(e){}
  }
  async function toggleTodo(roomId,todoId){
    if(!roomId||!todoId) return;
    try{
      const ref=db.collection('channels').doc(roomId).collection('todos').doc(todoId);
      const s=await ref.get(); if(!s.exists) return;
      const t=s.data()||{};
      if(t.done){ await ref.update({done:false,doneBy:'',doneByName:'',updatedAt:ts()}); }
      else{ await ref.update({done:true,doneBy:uid(),doneByName:state.profile?.displayName||'사용자',updatedAt:ts()}); }
    }catch(e){ console.error(e); return toast(errText(e)); }
    await renderTodos(roomId);
    try{ await refreshBanners(true); }catch(e){}
  }
  async function deleteTodo(roomId,todoId){
    if(!roomId||!todoId) return;
    try{ await db.collection('channels').doc(roomId).collection('todos').doc(todoId).delete(); }
    catch(e){ console.error(e); return toast(errText(e)); }
    await renderTodos(roomId);
    try{ await refreshBanners(true); }catch(e){}
    try{ await hapticMedium(); }catch(e){} toast('할 일을 지웠어요.');
  }
  // ---------- 출석 체크 (하루 1세션 · 방장·교사 시작/마감, 본인 출석) ----------
  function attendTodayId(){ return calYmd(new Date()); }
  async function openAttendanceModal(roomId){
    const r=state.rooms.find(x=>x.id===roomId)||state.room;
    if(!r) return;
    openModal(`<h2>출석 체크</h2><p class="desc">${esc(r.name||'채팅방')} · 오늘(${esc(calPretty(attendTodayId()))})</p><div id="attendHost"><div class="empty-side">불러오는 중…</div></div><div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
    await renderAttendance(roomId);
  }
  async function renderAttendance(roomId){
    const host=$('#attendHost'); if(!host) return;
    const r=state.rooms.find(x=>x.id===roomId)||state.room||{};
    const canRun=r.createdBy===uid()||isAdmin()||(isTeacherOrAdmin()&&(r.schoolId||'')!==''&&(r.schoolId||'')===(state.profile?.schoolId||''));
    let s=null;
    try{ const d=await db.collection('channels').doc(roomId).collection('attendance').doc(attendTodayId()).get(); if(d.exists) s={id:d.id,...d.data()}; }catch(e){ console.error(e); }
    if(!s){
      host.innerHTML=canRun
        ?`<div class="empty-side">오늘 출석을 시작하지 않았어요.</div><button type="button" class="soft-btn" style="width:100%" data-action="attend-start" data-room-id="${esc(roomId)}">출석 시작</button>`
        :'<div class="empty-side">진행 중인 출석이 없어요.</div>';
      return;
    }
    const present=Array.isArray(s.present)?s.present:[];
    await ensureProfilesAll(present.slice(0,100));
    const mine=present.includes(uid());
    host.innerHTML=`<div class="empty-side" style="padding:6px 0 10px">${s.open?'진행 중':'마감됨'} · ${present.length}명 출석</div>
      <div class="list modal-scroll" style="max-height:220px">${present.map(id=>{ const p=state.profileCache.get(id)||{}; return `<div class="list-item"><div>${avatarHtml(p)}</div><div class="grow"><div class="title">${esc(p.displayName||'사용자')}${id===uid()?' (나)':''}</div></div></div>`; }).join('')||'<div class="empty-side">아직 출석한 사람이 없어요.</div>'}</div>
      <div class="admin-toolbar" style="margin-top:12px">${(s.open&&!mine)?`<button type="button" class="soft-btn" data-action="attend-mark" data-room-id="${esc(roomId)}">출석하기</button>`:''}${(s.open&&canRun)?`<button type="button" class="soft-btn" data-action="attend-close" data-room-id="${esc(roomId)}">마감</button>`:''}<button type="button" class="soft-btn" data-action="attend-refresh" data-room-id="${esc(roomId)}">새로고침</button></div>`;
  }
  async function startAttendance(roomId){
    if(!roomId) return;
    try{
      const ex=await db.collection('channels').doc(roomId).collection('attendance').doc(attendTodayId()).get();
      if(ex.exists){ await renderAttendance(roomId); return toast(ex.data().open?'이미 진행 중이에요.':'오늘 출석은 마감됐어요.'); }
      await db.collection('channels').doc(roomId).collection('attendance').doc(attendTodayId()).set({roomId,date:attendTodayId(),open:true,byUid:uid(),byName:state.profile?.displayName||'사용자',present:[],createdAt:ts(),updatedAt:ts()});
    }catch(e){ console.error(e); return toast(errText(e)); }
    await renderAttendance(roomId);
    toast('출석을 시작했어요.');
  }
  async function markAttendance(roomId){
    const rid=roomId||state.room?.id; if(!rid) return;
    try{
      const chk=await db.collection('channels').doc(rid).collection('attendance').doc(attendTodayId()).get();
      if(!chk.exists || chk.data().open!==true){ const pill=$('#attendPill'); if(pill) pill.remove(); if($('#attendHost')) await renderAttendance(rid); return toast('출석이 마감됐어요.'); }
      if(((chk.data()||{}).present||[]).includes(uid())){ const pill=$('#attendPill'); if(pill) pill.remove(); return toast('이미 출석했어요.'); }
      await db.collection('channels').doc(rid).collection('attendance').doc(attendTodayId()).update({present:firebase.firestore.FieldValue.arrayUnion(uid()),updatedAt:ts()});
    }catch(e){ console.error(e); return toast(errText(e)); }
    if($('#attendHost')) await renderAttendance(rid);
    else toast('출석했어요.');
  }
  async function closeAttendance(roomId){
    if(!roomId) return;
    try{ await db.collection('channels').doc(roomId).collection('attendance').doc(attendTodayId()).update({open:false,closedAt:ts(),updatedAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    await renderAttendance(roomId);
    toast('출석을 마감했어요.');
  }
  function attachAttendanceListener(id){
    clearAttendanceListener();
    try{
      attendanceUnsub=db.collection('channels').doc(id).collection('attendance').where('open','==',true).limit(1).onSnapshot(s=>{
        if(state.room?.id!==id) return;
        const old=$('#attendPill'); if(old) old.remove();
        if(s.empty) return;
        const d=s.docs[0].data()||{};
        if((d.present||[]).includes(uid())) return;
        const bar=$('#chat .composer'); if(!bar||!bar.parentNode) return;
        const pill=document.createElement('button');
        pill.type='button'; pill.id='attendPill'; pill.className='attend-pill';
        pill.setAttribute('data-action','attend-mark'); pill.setAttribute('data-room-id',id);
        pill.innerHTML='<span>📋 출석 진행 중이에요</span><b>출석하기</b>';
        bar.parentNode.insertBefore(pill,bar);
      },e=>{});
    }catch(e){}
  }
  function openFileBox(roomId){
    const r=state.rooms.find(x=>x.id===roomId)||state.room;
    if(!r) return;
    if(!state.fileBoxSort) state.fileBoxSort='new';
    if(state.fileBoxHideRisk===undefined) state.fileBoxHideRisk=false;
    // 6번: 삭제된 메시지는 제외 (이미 !deleted 필터) — 혹시 남아있던 캐시도 다시 걸러낸다
    // 청크 파일(대용량)도 포함한다
    const files=(state.messages||[]).filter(m=>!m.deleted&&!m.hidden&&m.attachment&&(m.attachment.data||m.attachment.chunked));
    const sortFiles=(arr)=>{
      const a=[...arr];
      const tsOf=m=>docTs(m.createdAt)||0;
      if(state.fileBoxSort==='old') a.sort((x,y)=>tsOf(x)-tsOf(y));
      else if(state.fileBoxSort==='name') a.sort((x,y)=>String(x.attachment?.name||'').localeCompare(String(y.attachment?.name||''),'ko'));
      else a.sort((x,y)=>tsOf(y)-tsOf(x));
      return a;
    };
    let imgs=sortFiles(files.filter(m=>m.attachment.kind==='image'));
    let docs=sortFiles(files.filter(m=>m.attachment.kind!=='image'));
    // 검열된 사진은 제외 보기 옵션이 켜져 있으면 숨긴다
    if(state.fileBoxHideRisk){ imgs=imgs.filter(m=>!(m.attachment&&m.attachment.risk)); docs=docs.filter(m=>!(m.attachment&&m.attachment.risk)); }
    const imgThumb=(m)=>{
      if(fileExpired(m)) return `<div class="file-thumb loading" aria-label="보관 기한 지남"><span class="flag-badge">기한 지남</span></div>`;
      const data=attachDataOf(m);
      if(!data) return `<div class="file-thumb loading" aria-label="불러오는 중"><img data-chunkmsg="${esc(m.id)}" alt="${esc(m.attachment.name||'사진')}" loading="lazy"><span class="flag-badge">불러오는 중</span></div>`;
      const src=safeImgSrc(data); if(!src) return '';
      const risk=!!(m.attachment&&m.attachment.risk);
      if(risk) return `<button type="button" class="file-thumb flagged" data-action="view-attach" data-msg="${esc(m.id)}" title="검열된 사진 — 눌러서 확인"><img src="${esc(src)}" alt="" loading="lazy" style="filter:blur(14px) brightness(.7)"><span class="flag-badge">검열됨</span></button>`;
      return `<button type="button" class="file-thumb" data-action="view-attach" data-msg="${esc(m.id)}"><img src="${esc(src)}" alt="${esc(m.attachment.name||'사진')}" loading="lazy"></button>`;
    };
    openModal(`<h2>사진·파일함</h2><p class="desc">${esc(r.name||'채팅방')} · 불러온 범위에서 ${files.length}개예요. 더 옛날 것은 '이전 메시지 더 보기'로 불러오면 보여요. 삭제한 메시지는 여기서도 빠집니다.</p>
      <div class="row" style="margin-bottom:10px"><div class="custom-select" style="flex:1"><button type="button" class="select-button" data-select-open="fileBoxSort" style="height:44px"><span data-selected="fileBoxSort" data-value="${esc(state.fileBoxSort)}">${state.fileBoxSort==='old'?'오래된 순':state.fileBoxSort==='name'?'이름순':'최신 순'}</span><span>⌄</span></button></div><button type="button" class="soft-btn" style="flex:0 0 auto;padding:0 14px;height:44px" data-action="filebox-hide-risk">${state.fileBoxHideRisk?'검열 포함 보기':'검열 제외 보기'}</button></div>
      ${imgs.length?`<div class="field"><label>사진 ${imgs.length}개</label><div class="file-grid">${imgs.map(imgThumb).join('')}</div></div>`:''}
      ${docs.length?`<div class="field"><label>파일 ${docs.length}개</label><div class="list">${docs.map(m=>{ if(fileExpired(m)) return `<div class="attach-card"><span class="attach-ico">⏳</span><span class="grow"><span class="attach-name">${esc(m.attachment.name||'파일')}</span><span class="attach-size">보관 기한 지남</span></span></div>`; const data=attachDataOf(m); const href=data?safeFileHref(data):''; if(!href) return `<div class="attach-card" data-chunkdoc="${esc(m.id)}"><span class="attach-ico">${esc(attachIcon(m.attachment))}</span><span class="grow"><span class="attach-name">${esc(m.attachment.name||'파일')}</span><span class="attach-size">불러오는 중… · ${esc(fmtBytes(m.attachment.size))}</span></span></div>`; const risk=!!(m.attachment&&m.attachment.risk); return `<a class="attach-card${risk?' flagged':''}" href="${href}" download="${esc(m.attachment.name||'파일')}"><span class="attach-ico">${esc(attachIcon(m.attachment))}</span><span class="grow"><span class="attach-name">${esc(m.attachment.name||'파일')}${risk?' · 검열됨':''}</span><span class="attach-size">${esc(fmtBytes(m.attachment.size))}</span></span></a>`; }).join('')}</div></div>`:''}
      ${!files.length?'<div class="empty-side">아직 주고받은 사진·파일이 없어요.</div>':''}
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
    const sc=$('[data-select-open="fileBoxSort"]');
    if(sc) wireDropdown(sc,[{value:'new',label:'최신 순'},{value:'old',label:'오래된 순'},{value:'name',label:'이름순'}],(v)=>{ state.fileBoxSort=v; openFileBox(roomId); });
  }
  // 공유 채팅방에 들어오려는 요청 (방장이 수락/거절)
  async function renderJoinRequests(roomId){
    const host=$('#joinReqHost'); if(!host) return;
    let rows=[];
    try{ const s=await db.collection('joinRequests').where('roomId','==',roomId).where('status','==','pending').limit(30).get(); rows=s.docs.map(d=>({id:d.id,...d.data()})); }
    catch(e){ console.error('join requests',e); return; }
    if(!rows.length) return;
    host.innerHTML=`<div class="field" style="margin-top:16px"><label>참가 요청 ${rows.length}건</label><div class="list">${rows.map(x=>`<div class="list-item"><div class="grow"><div class="title">${esc(x.name||'사용자')}</div><div class="meta">${gradeClassPrefix(x)}${esc(x.schoolName||'')} · ${esc(fmtDateTime(x.createdAt))}</div></div><button class="soft-btn" style="flex:0 0 56px" data-action="join-req-ok" data-id="${esc(x.id)}">수락</button><button class="soft-btn" style="flex:0 0 56px" data-action="join-req-no" data-id="${esc(x.id)}">거절</button></div>`).join('')}</div></div>`;
  }
  function openRoomIconModal(id){
    const r=state.rooms.find(x=>x.id===id)||state.room; if(!r) return;
    if(!(r.createdBy===uid()||isAdmin())) return toast('방을 만든 사람만 바꿀 수 있어요.');
    const ICONS=['💬','🏫','📚','🎒','🌟','🎨','⚽','🎮','🎵','🧪','💡','🌈','🍀','⭐','🚀','🎯','🏆','🔥','🌊','🍎','📚','🎓','🔬','💻','🌱','📌','🌍','🐣'];
    openModal(`<h2>채팅방 아이콘</h2><p class="desc">${esc(r.name||'채팅방')}</p>
      <div class="field"><label>이모지</label><div class="avatar-pick">${ICONS.map(e=>`<button type="button" class="avatar-opt ${(!r.iconPhoto&&(r.icon||roomIcon(r))===e)?'on':''}" data-action="room-emoji" data-emoji="${esc(e)}">${e}</button>`).join('')}</div></div>
      <div class="field"><label>사진으로 지정</label><div class="photo-row"><div id="roomIconPreview" class="photo-preview">${r.iconPhoto?`<img src="${esc(r.iconPhoto)}" alt="">`:'<span>사진 없음</span>'}</div><div class="grow"><input type="file" id="roomIconFile" accept="image/*" hidden><button type="button" class="soft-btn" style="width:100%" data-action="room-icon-photo">사진 올리기</button><button type="button" class="soft-btn" style="width:100%;margin-top:8px" data-action="room-icon-reset">기본 아이콘으로</button></div></div></div>
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
  }
  async function saveRoomIcon(roomId,patch){
    const r=state.rooms.find(x=>x.id===roomId)||state.room; if(!r) return;
    if(!(r.createdBy===uid()||isAdmin())) return toast('방을 만든 사람만 바꿀 수 있어요.');
    try{ await db.collection('channels').doc(roomId).update({...patch,updatedAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    Object.assign(r,patch);
    if(state.room?.id===roomId){ renderChatFrame(state.room); renderMessages(false); }
    renderRooms();
    if(state.view==='admin'&&state.allRooms) state.allRooms=state.allRooms.map(x=>x.id===roomId?{...x,...patch}:x);
    closeAllModals();
    toast('채팅방 아이콘을 바꿨어요.');
  }
  async function setRoomIconPhoto(roomId,file){
    if(!file) return;
    toast('사진을 준비하고 있어요...');
    let data='';
    try{ data=await compressAvatar(file,128,40*1024); }catch(e){ console.error(e); }
    if(!data) return toast('사진을 처리하지 못했어요. 다른 사진으로 시도해 주세요.');
    await saveRoomIcon(roomId,{iconPhoto:data,icon:''});
  }
  async function toggleJoinPolicy(roomId){
    const r=state.rooms.find(x=>x.id===roomId)||state.room; if(!r) return;
    if(!(r.createdBy===uid()||isAdmin())) return;
    const next=r.joinPolicy==='open'?'approve':'open';
    try{ await db.collection('channels').doc(roomId).update({joinPolicy:next,updatedAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    r.joinPolicy=next;
    closeAllModals();
    toast(next==='open'?'이제 코드만 입력하면 바로 들어올 수 있어요.':'이제 방장이 승인해야 들어올 수 있어요.');
    openRoomManage(roomId);
  }
  async function copyText(text,label){
    try{ await navigator.clipboard.writeText(text); toast(`${label||'복사했어요'} · ${text}`); }
    catch(e){ openModal(`<h2>${esc(label||'복사')}</h2><div class="code-box">${esc(text)}</div><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true}); }
  }
  // ---------- 참가 코드로 공유 채팅방에 들어가기 ----------
  // 초대 링크(?join=CODE): 들어오면 보관했다가 로그인 뒤 코드 참가 흐름으로 잇는다
  function stashJoinLink(){
    try{
      const u=new URL(location.href);
      const c=(u.searchParams.get('join')||'').trim().toUpperCase();
      if(c) sessionStorage.setItem('edutalk_pending_join', c);
      if(u.searchParams.has('join')){ u.searchParams.delete('join'); history.replaceState(null,'',u.pathname+u.search+(u.hash||'')); }
    }catch(e){}
  }
  function consumePendingJoinLink(){
    let c='';
    try{ c=sessionStorage.getItem('edutalk_pending_join')||''; sessionStorage.removeItem('edutalk_pending_join'); }catch(e){}
    if(!c || !state.profile) return;
    openJoinByCodeModal();
    const inp=$('#joinCodeInput'); if(inp) inp.value=c;
    joinByRoomCode(c);
  }
  function openJoinByCodeModal(){
    openModal(`<h2>참가 코드로 들어가기</h2><p class="desc">공유 채팅방의 <b>참가 코드</b>를 입력하면 들어갈 수 있어요. 방장이 정한 방식에 따라 바로 들어가거나, 방장의 수락을 기다려요.</p>
      <div class="field"><label>참가 코드</label><div class="row"><input id="joinCodeInput" class="input code-input" maxlength="8" spellcheck="false" autocomplete="off" placeholder="예: K7M3QP"><button type="button" class="soft-btn" style="flex:0 0 78px" data-action="join-by-code">확인</button></div><p id="joinCodeMsg" class="reset-msg"></p></div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>닫기</button></div>`);
    setTimeout(()=>$('#joinCodeInput')?.focus(),60);
  }
  // 방에 적힌 코드를 코드표에 옮겨 둔다 (방 문서를 읽지 않고도 코드로 찾을 수 있게, 세션당 1회)
  const joinCodeBackfilled=new Set();
  async function ensureJoinCodeMapping(r){
    try{
      if(!r || !r.id || !r.joinCode || r.joinPolicy!=='open') return;
      if(joinCodeBackfilled.has(r.id)) return;
      joinCodeBackfilled.add(r.id);
      const code=String(r.joinCode).toUpperCase();
      const m=await db.collection('joinCodes').doc(code).get();
      if(!m.exists) await db.collection('joinCodes').doc(code).set({roomId:r.id,createdBy:r.createdBy||uid(),createdAt:ts()});
    }catch(e){ /* 다음 기회에 다시 시도한다 */ try{ joinCodeBackfilled.delete(r.id); }catch(_){} }
  }
  async function joinByRoomCode(raw){
    const msg=$('#joinCodeMsg');
    const say=(t,cls)=>{ if(msg){ msg.textContent=t; msg.className='reset-msg'+(cls?' '+cls:''); } };
    const code=normalizeCode(raw);
    if(code.length<4) return say('참가 코드를 정확히 입력해 주세요.','warn');
    say('코드를 확인하고 있어요…');
    let r=null;
    // 1) 코드표에서 방을 찾는다 (방 문서를 열지 않고 코드만으로 확인)
    try{
      const m=await db.collection('joinCodes').doc(code).get();
      if(m.exists && m.data().roomId){
        try{ const s=await db.collection('channels').doc(m.data().roomId).get(); if(s.exists) r={id:s.id,...s.data()}; }catch(e){}
      }
    }catch(e){ console.error('joinCodes',e); }
    // 2) 예전 방 호환: 코드로 직접 찾는다
    if(!r){
      let snap=null;
      try{ snap=await db.collection('channels').where('joinCode','==',code).limit(1).get(); }
      catch(e){ console.error(e); return say('코드를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.','warn'); }
      if(!snap || snap.empty) return say('그 코드의 채팅방을 찾지 못했어요.','warn');
      const ch=snap.docs[0]; r={id:ch.id,...ch.data()};
    }
    if(r.deleted) return say('지워진 채팅방이에요.','warn');
    if((r.memberIds||[]).includes(uid())){ closeAllModals(); return openRoom(r.id); }
    if(r.joinPolicy==='open'){
      try{
        // 서버가 코드를 검증할 수 있게 증표를 먼저 남긴다 (모르면 입장 규칙에서 막힌다)
        await db.collection('joinAttempts').doc(`${r.id}_${uid()}`).set({roomId:r.id,uid:uid(),code,createdAt:ts()},{merge:true});
        await db.collection('channels').doc(r.id).update({memberIds:firebase.firestore.FieldValue.arrayUnion(uid()),updatedAt:ts()});
        try{ unmarkRoomLeft(r.id); }catch(e){}
        await db.collection('joinAttempts').doc(`${r.id}_${uid()}`).delete().catch(()=>{});
      }
      catch(e){
        console.error(e);
        if(e?.code==='permission-denied') return say('코드가 맞지 않거나 들어갈 수 없는 방이에요.','warn');
        return say('채팅방에 들어가지 못했어요.','warn');
      }
      state.rooms=[r,...state.rooms];
      closeAllModals();
      toast('채팅방에 들어왔어요.');
      postSystemMessage(r.id,'join',state.profile?.displayName||'사용자');
      return openRoom(r.id);
    }
    try{
      await db.collection('joinRequests').doc(`${r.id}_${uid()}`).set({
        roomId:r.id, roomName:r.name||'', uid:uid(), name:state.profile?.displayName||'사용자',
        grade:state.profile?.grade??null, classNum:state.profile?.classNum??null,
        schoolId:state.profile?.schoolId||'', schoolName:state.profile?.schoolName||'',
        status:'pending', createdAt:ts(), updatedAt:ts()
      },{merge:true});
    }catch(e){ console.error(e); return say('참가 요청을 보내지 못했어요.','warn'); }
    say('참가 요청을 보냈어요. 방장이 수락하면 들어갈 수 있어요.','ok');
  }
  async function handleJoinRequest(id,ok){
    if(!id) return;
    try{
      const s=await db.collection('joinRequests').doc(id).get();
      if(!s.exists) return;
      const q=s.data();
      await db.collection('joinRequests').doc(id).update({status:ok?'accepted':'declined',handledBy:uid(),handledAt:ts()});
      if(ok){
        await db.collection('channels').doc(q.roomId).update({memberIds:firebase.firestore.FieldValue.arrayUnion(q.uid),updatedAt:ts()});
        const inviteId=`${q.roomId}_${q.uid}`;
        await db.collection('roomInvites').doc(inviteId).set({roomId:q.roomId,roomName:q.roomName||'',targetUid:q.uid,targetName:q.name||'',inviterId:uid(),inviterName:state.profile?.displayName||'',status:'pending',createdAt:ts(),updatedAt:ts()},{merge:true});
        postSystemMessage(q.roomId,'join',q.name||'사용자');
      }
    }catch(e){ console.error(e); return toast(errText(e)); }
    toast(ok?'참가 요청을 수락했어요.':'참가 요청을 거절했어요.');
    const rid=$('#joinReqHost')?state.room?.id:null;
    closeAllModals();
    if(rid) openRoomManage(rid);
  }
  // ---------- 우리 학교 전체 공유 승인 요청 ----------
  async function openMyShareRequests(){
    let rows=[];
    try{ const s=await db.collection('shareRequests').where('requestedBy','==',uid()).limit(30).get(); rows=s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==='pending'); }
    catch(e){ console.error(e); }
    openModal(`<h2>학교 전체 공유 요청</h2><p class="desc">관리자·선생님이 승인하면 우리 학교 학생 모두에게 채팅방이 보여요. 처리되기 전에는 언제든 취소할 수 있어요.</p>
      <div class="list">${rows.map(x=>`<div class="list-item"><div class="grow"><div class="title">${esc(x.roomName||'채팅방')}</div><div class="meta">승인을 기다리는 중 · ${esc(fmtDateTime(x.createdAt))}</div></div><button class="soft-btn" style="flex:0 0 76px" data-action="share-req-cancel" data-id="${esc(x.id)}">요청 취소</button></div>`).join('')||'<div class="empty-side">기다리는 요청이 없어요.</div>'}</div>
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
  }
  async function cancelShareRequest(id){
    if(!id) return;
    try{ await db.collection('shareRequests').doc(id).update({status:'cancelled',cancelledAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast('공유 요청을 취소했어요.');
    closeAllModals();
  }
  async function handleShareRequest(id,ok){
    if(!isTeacher()||!id) return;
    let req=null;
    try{
      const s=await db.collection('shareRequests').doc(id).get(); if(!s.exists) return; req=s.data();
      await db.collection('shareRequests').doc(id).update({status:ok?'approved':'rejected',handledBy:uid(),handledAt:ts()});
      if(ok&&req.roomId) await db.collection('channels').doc(req.roomId).update({visibility:'all',updatedAt:ts()});
    }catch(e){ console.error(e); return toast(errText(e)); }
    toast(ok?'우리 학교 전체에 공유했어요.':'공유 요청을 거절했어요.');
    renderAdminPanel(state.adminTab);
  }
  async function renderShareRequests(p){
    if(!isTeacher()) return;
    p.innerHTML=`<div class="admin-card"><h3>학교 전체 공유 요청</h3><p class="desc">학생이 만든 공유 채팅방을 우리 학교 전체에 열어 달라는 요청이에요. 승인하면 모든 학생 목록에 보여요.</p><div id="shareReqList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>`;
    let rows=[];
    try{ const s=await db.collection('shareRequests').where('status','==','pending').limit(100).get(); rows=s.docs.map(d=>({id:d.id,...d.data()})); }
    catch(e){ console.error(e); const h=$('#shareReqList'); if(h) h.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; return; }
    const host=$('#shareReqList'); if(!host) return;
    host.innerHTML=rows.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(r.roomName||'채팅방')}</div><div class="meta">${esc(r.requestedByName||'학생')} · ${esc(r.schoolName||'')} · ${esc(fmtDateTime(r.createdAt))}</div></div><button class="soft-btn" style="flex:0 0 52px" data-action="share-approve" data-id="${esc(r.id)}">승인</button><button class="soft-btn" style="flex:0 0 52px" data-action="share-reject" data-id="${esc(r.id)}">거절</button></div>`).join('')||'<div class="empty-side">대기 중인 요청이 없어요.</div>';
  }
  async function toggleRoomChatOff(roomId){
    if(!isAdmin()||!roomId) return;
    const cur={...(chatCfg().chatOffRooms||{})};
    const on=!cur[roomId];
    if(on) cur[roomId]=true; else delete cur[roomId];
    try{ await db.collection('chatSettings').doc('main').set({chatOffRooms:cur,updatedAt:ts()},{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast(on?'이 채팅방 채팅을 정지했어요.':'이 채팅방 채팅 정지를 풀었어요.');
    closeModal();
    if(state.room){ renderChatFrame(state.room); renderMessages(false); }
  }
  async function toggleChatOffAll(){
    if(!isAdmin()) return;
    const on=!chatCfg().chatOffAll;
    try{ await db.collection('chatSettings').doc('main').set({chatOffAll:on,updatedAt:ts()},{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast(on?'모든 채팅방의 채팅을 정지했어요.':'전체 채팅 정지를 풀었어요.');
    renderAdminPanel(state.adminTab);
  }
  async function adminJoinRoom(id){
    if(!isAdmin()||!id) return;
    const r=state.rooms.find(x=>x.id===id); if(!r) return;
    if((r.memberIds||[]).includes(uid())) return toast('이미 이 채팅방에 있어요.');
    try{ await db.collection('channels').doc(id).update({memberIds:firebase.firestore.FieldValue.arrayUnion(uid()),updatedAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    try{ unmarkRoomLeft(id); }catch(e){}
    closeAllModals();
    toast('관리자로 참가했어요.');
    postSystemMessage(id,'join',state.profile?.displayName||'사용자');
    renderRooms();
    openRoom(id);
  }
  function openInvite(id){openRoomInviteModal(id);}
  async function openAudienceModal(id){
    if(!isAdmin())return;const r=state.rooms.find(x=>x.id===id);if(!r)return;
    const choices=[['all','전체 학생'],...state.school.grades.map(g=>[`g${g}`,`${g}학년 전체`]),...state.school.grades.flatMap(g=>Array.from({length:Number(state.school.classCounts?.[g]||0)},(_,i)=>[`c${g}-${i+1}`,`${g}학년 ${i+1}반`]))];
    openModal(`<h2>공지 대상을 골라 주세요</h2><p class="desc">여기에 선택한 학생만 공지방에 들어와요.</p><div class="list modal-scroll">${choices.map(([v,l])=>`<label class="list-item"><input type="radio" name="audience" value="${v}" ${v==='all'?'checked':''}><div class="grow"><div class="title">${esc(l)}</div></div></label>`).join('')}</div><div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" id="saveAudience">저장하기</button></div>`);
    const saveBtn=$('#saveAudience'); if(!saveBtn) return;
    saveBtn.onclick=async()=>{try{const v=$('[name="audience"]:checked')?.value||'all';const sid=state.profile?.schoolId||'';const snap=await (sid?db.collection('publicProfiles').where('schoolId','==',sid).limit(500):db.collection('publicProfiles').limit(500)).get();const members=[];snap.docs.forEach(d=>{const u=d.data();if(sid&&u.schoolId!==sid)return;if(u.role==='admin'||u.role==='teacher'||u.role==='school_admin'||d.id===uid())members.push(d.id);else if(v==='all')members.push(d.id);else if(v.startsWith('g')&&Number(u.grade)===Number(v.slice(1)))members.push(d.id);else if(v.startsWith('c')){const [g,c]=v.slice(1).split('-').map(Number);if(Number(u.grade)===g&&Number(u.classNum)===c)members.push(d.id);}});await db.collection('channels').doc(id).update({visibility:'members',memberIds:[...new Set(members)],audience:v,updatedAt:ts()});closeModal();toast('공지 대상을 바꿨어요.');}catch(e){console.error(e);toast(errText(e));}};
  }

  async function openRoomInviteModal(id){
    const r=state.rooms.find(x=>x.id===id); if(!r) return;
    const inRoom=new Set(r.memberIds||[]);
    const quick=(state.friends||[]).filter(f=>!inRoom.has(f.uid));
    openModal(`<h2>사람 초대하기</h2><p class="desc">친구의 <b>초대 코드</b>를 입력하면 그 사람에게 초대가 가요. 코드는 친구가 프로필에서 확인할 수 있어요.</p>
      <div class="field"><label>초대 코드</label><div class="row" style="align-items:center"><input id="inviteCodeInput" class="input code-input" maxlength="12" autocomplete="off" spellcheck="false" placeholder="예: K7M3QP"><button type="button" class="soft-btn" style="flex:0 0 84px" data-action="invite-by-code" data-room-id="${esc(id)}">초대하기</button></div><p id="inviteCodeMsg" class="reset-msg"></p></div>
      <div class="code-row"><div class="grow"><div class="code-label">내 초대 코드</div><div class="code-value" data-my-code>${esc(state.profile?.userCode||'준비 중')}</div></div><button type="button" class="soft-btn" data-action="copy-code">복사</button></div>
      ${quick.length?`<div class="field" style="margin-top:16px"><label>친구 바로 초대 (${quick.length})</label><div class="list">${quick.map(f=>{const nm=(f.profile||{}).displayName||'친구';return `<div class="list-item"><div>${avatarHtml(f.profile)}</div><div class="grow"><div class="title">${esc(nm)}</div><div class="meta">${esc((f.profile||{}).bio||'친구')}</div></div><button class="soft-btn" style="flex:0 0 62px" data-action="invite-by-uid" data-room-id="${esc(id)}" data-uid="${esc(f.uid)}" data-name="${esc(nm)}">초대</button></div>`;}).join('')}</div></div>`:''}
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
    setTimeout(()=>$('#inviteCodeInput')?.focus(),60);
  }
  async function inviteByUid(roomId,targetUid,targetName){
    const r=state.rooms.find(x=>x.id===roomId); if(!r||!targetUid) return;
    if((r.memberIds||[]).includes(targetUid)) return toast('이미 이 채팅방에 있는 사람이에요.');
    const p=state.profileCache.get(targetUid)||{};
    if(p.invitePolicy==='block') return toast('이 사람은 초대를 받지 않도록 설정했어요.');
    if((state.profile?.blockedUsers||[]).includes(targetUid)) return toast('차단한 사람은 초대할 수 없어요.');
    if(p.schoolId && state.profile?.schoolId && p.schoolId!==state.profile.schoolId){
      const ok=await crossApproved(targetUid);
      if(!ok) return toast('다른 학교 친구는 초대 코드로 요청해야 해요. (선생님 승인이 필요해요)');
    }
    await createInvite(roomId,targetUid,targetName||p.displayName||'친구',p.invitePolicy||'ask',p.schoolId||'');
  }
  async function inviteByCode(roomId,raw){
    if(!checkInviteRate()) return;
    const r=state.rooms.find(x=>x.id===roomId); if(!r) return;
    const msg=$('#inviteCodeMsg');
    const say=(t,cls)=>{ if(msg){ msg.textContent=t; msg.className='reset-msg'+(cls?' '+cls:''); } };
    const code=normalizeCode(raw);
    if(code.length<4) return say('초대 코드를 정확히 입력해 주세요.','warn');
    if(code===(state.profile?.userCode||'')) return say('내 코드로는 나를 초대할 수 없어요.','warn');
    say('코드를 확인하고 있어요…');
    let found=null;
    try{ found=await findUserByCode(code); }
    catch(e){ console.error(e); return say('코드를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.','warn'); }
    if(!found) return say('그 코드를 가진 사람을 찾지 못했어요.','warn');
    if(found.uid===uid()) return say('내 코드로는 나를 초대할 수 없어요.','warn');
    if((r.memberIds||[]).includes(found.uid)) return say('이미 이 채팅방에 있는 사람이에요.','warn');
    if((state.profile?.blockedUsers||[]).includes(found.uid)) return say('차단한 사람은 초대할 수 없어요.','warn');
    const p=found.profile||{};
    const name=p.displayName||'사용자';
    if(p.schoolId && state.profile?.schoolId && p.schoolId!==state.profile.schoolId){
      const approved=await crossApproved(found.uid);
      if(!approved){
        say('다른 학교 사람이에요. 선생님 승인이 필요해요.','warn');
        confirmModal(`${name}님은 다른 학교 사람이에요`,'다른 학교 학생과 채팅하려면 선생님(관리자)의 승인이 필요해요. 지금 요청을 보낼까요?',async()=>{
          await requestCrossSchool(found.uid,name,p.schoolId,p.schoolName);
          say('학교 간 채팅 요청을 보냈어요. 승인되면 초대할 수 있어요.','ok');
        });
        return;
      }
    }
    if(p.invitePolicy==='block') return say('이 사람은 초대를 받지 않도록 설정했어요.','warn');
    say(`${name}님을 찾았어요.`,'ok');
    await createInvite(roomId,found.uid,name,p.invitePolicy||'ask',p.schoolId||'');
  }
  async function createInvite(id, targetUid, targetName, policy, targetSchoolId){
    const r=state.rooms.find(x=>x.id===id);if(!r)return;
    confirmModal(`${targetName}님을 초대할까요?`,policy==='auto'?'상대가 바로 들어와요.':'상대가 확인하면 들어와요.',async()=>{
      if(policy==='block'){toast('이 사용자는 초대를 받지 않도록 설정했어요.');return;}
      const inviteId=`${id}_${targetUid}`;
      await db.collection('roomInvites').doc(inviteId).set({roomId:id,roomName:r.name,targetUid,targetName,inviterId:uid(),inviterName:state.profile.displayName,status:'pending',crossOk:crossOkFor(targetSchoolId||''),createdAt:ts(),updatedAt:ts()},{merge:true});
      toast(policy==='auto'?'초대를 보냈어요. 상대방 설정에 따라 바로 들어가요.':'초대 요청을 보냈어요.');
      closeAllModals();
    });
  }

  async function acceptInvite(id){
    dismissStickyNotice(`invin_${id}`);
    let roomId='';
    let step='초대 읽기';
    try{
      const ref=db.collection('roomInvites').doc(id);
      const s=await ref.get(); if(!s.exists) return;
      const inv=s.data(); roomId=inv.roomId||'';
      if(!roomId) return;
      const cref=db.collection('channels').doc(roomId);
      // 방 정보를 못 읽더라도 들어가기는 시도한다
      let already=false;
      step='방 정보 확인';
      try{ const r=await cref.get(); already=r.exists && (((r.data().memberIds)||[]).includes(uid())); }
      catch(e){ console.error('room read before join',e); }
      if(!already){
        step='채팅방 들어가기';
        const upd={memberIds:firebase.firestore.FieldValue.arrayUnion(uid()),updatedAt:ts()};
        const sid=state.profile?.schoolId||''; if(sid) upd.schoolIds=firebase.firestore.FieldValue.arrayUnion(sid);
        const ck=myClassKey(); if(ck) upd.classKeys=firebase.firestore.FieldValue.arrayUnion(ck);
        await cref.update(upd);
        try{ unmarkRoomLeft(roomId); }catch(e){}
      } else {
        try{ unmarkRoomLeft(roomId); }catch(e){}
      }
      step='초대 상태 변경';
      await ref.update({status:'accepted',handledAt:ts()});
      renderRooms();
      if(!already) postSystemMessage(roomId,'join',state.profile?.displayName||'사용자');
      toast(already?'이미 이 채팅방에 들어가 있어요.':'채팅방에 들어갔어요.');
    }catch(e){
      console.error(`invite accept [${step}]`,e);
      // 이미 들어가 있는데 규칙에 걸린 경우 등 → 초대만 정리하고 넘어간다
      let joined=false;
      if(roomId){
        try{ const r2=await db.collection('channels').doc(roomId).get(); joined=r2.exists && (((r2.data().memberIds)||[]).includes(uid())); }
        catch(e2){ console.error(e2); }
      }
      if(joined){ try{ await db.collection('roomInvites').doc(id).update({status:'accepted',handledAt:ts()}); }catch(e2){ console.error(e2); } }
      renderRooms();
      toast(joined?'채팅방에 들어갔어요.':'초대를 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }
  async function declineInvite(id){
    const never=inviteNeverChecked(id);
    dismissStickyNotice(`invin_${id}`);
    try{ await db.collection('roomInvites').doc(id).update({status:'declined',handledAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    if(never){ await setInvitePolicyBlock(); toast('초대를 거절했어요. 앞으로 초대받지 않아요.'); }
    else toast('초대를 거절했어요.');
  }

  async function toggleBlock(target,name){if(!target||target===uid())return;const blocked=(state.profile.blockedUsers||[]).includes(target);confirmModal(blocked?`${name}님의 차단을 해제할까요?`:`${name}님을 차단할까요?`,blocked?'차단했던 동안 받은 메시지는 다시 나타나지 않아요.':'차단하면 지금부터 이 사용자의 새 메시지를 볼 수 없어요.',async()=>{const hist={...(state.profile.blockHistory||{})};const arr=[...(hist[target]||[])];if(blocked){const last=arr[arr.length-1];if(last&&!last.to)last.to=nowMs();await db.collection('users').doc(uid()).update({blockedUsers:firebase.firestore.FieldValue.arrayRemove(target),blockHistory:hist});state.profile.blockedUsers=(state.profile.blockedUsers||[]).filter(x=>x!==target);}else{arr.push({from:nowMs(),to:null});hist[target]=arr;await db.collection('users').doc(uid()).update({blockedUsers:firebase.firestore.FieldValue.arrayUnion(target),blockHistory:hist});state.profile.blockedUsers=[...(state.profile.blockedUsers||[]),target];}state.profile.blockHistory=hist;renderMessages(true);await syncBlockDoc(uid(),target,!blocked);state.blockedMeCache.delete(blockDocId(target,uid()));updateBlockButtons(target,!blocked);toast(blocked?'차단을 해제했어요.':'차단했어요.');});}
  // 열려 있는 프로필 창의 차단 버튼 글자를 바로 바꿔 준다
  function updateBlockButtons(targetUid,nowBlocked){
    document.querySelectorAll('#modalRoot [data-action="block"]').forEach(b=>{
      if(b.dataset.uid===targetUid) b.textContent=nowBlocked?'차단 해제':'차단';
    });
  }

  function settingsPageHtml(){
    const tabActive=(k)=> (state.settingsTab===k?'active':'');
    return `<div class="settings-page"><header class="admin-head"><button class="icon-btn" data-action="close-settings" aria-label="뒤로 가기">←</button><div class="grow"><div class="admin-title">전체 설정</div><div class="admin-sub">${esc(state.profile?.displayName||'사용자')} · ${roleLabel(state.profile?.role)}</div></div><button class="icon-btn" data-action="close-settings" aria-label="닫기">✕</button></header><div class="admin-body"><div class="admin-wrap"><nav class="admin-tabs" style="margin-bottom:12px">
        <button class="tab ${tabActive('display')}" data-settings-tab="display"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8"/><path d="M12 14v6"/></svg></span> 표시</button>
        <button class="tab ${tabActive('chat')}" data-settings-tab="chat"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4 3V6Z"/></svg></span> 채팅/알림</button>
        <button class="tab ${tabActive('invite')}" data-settings-tab="invite"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V21"/><circle cx="10" cy="7" r="3"/><circle cx="17.5" cy="7" r="2.5"/><path d="M18.5 13.5A4 4 0 0 1 21 17v4"/></svg></span> 초대/친구</button>
        <button class="tab ${tabActive('security')}" data-settings-tab="security"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/><circle cx="12" cy="15" r="1"/></svg></span> 보안</button>
      </nav><div id="settingsPanel"></div></div></div><div class="settings-save-bar" id="settingsSaveBar"><div class="admin-wrap"><button class="primary" data-action="save-settings" id="settingsSaveBtn" style="width:100%;height:50px;border-radius:13px" disabled><span class="save-dot"></span>저장하기</button></div></div></div>`;
  }
  function renderSettingsPanel(tab){
    if(tab) state.settingsTab=tab;
    // 헤더 탭 활성화 업데이트 (전체화면 설정)
    try{
      document.querySelectorAll('.settings-page .admin-tabs [data-settings-tab]').forEach(x=> x.classList.toggle('active', x.dataset.settingsTab===state.settingsTab));
      // 인디케이터는 헤더 .admin-tabs 안에 있어야 함
      const headerTabs=document.querySelector('.settings-page .admin-tabs');
      if(headerTabs) updateTabsIndicator(headerTabs);
    }catch(e){}
    const p=document.getElementById('settingsPanel');
    if(!p) return;
    // 검색바 제거됨 (요청)
    // 저장 버튼 상태는 dirty에 따라 유지 (탭 전환 시 초기화하지 않음)
    // 초기 오픈 시에는 clearSettingsDirty가 openSettings에서 호출됨
    const saveBtn=document.getElementById('settingsSaveBtn');
    if(saveBtn) saveBtn.disabled = !settingsDirty;
    const nt=notifySettings();
    let perm=notificationPermission();
    let permText=perm==='granted'?'허용됨':perm==='denied'?'차단됨':perm==='unsupported'?'지원 안 함':'허용 필요';
    let permCls=perm==='granted'?'on':(perm==='denied'||perm==='unsupported')?'warn':'';
    if(isNativeApp()){
      perm='granted'; permText='앱 알림'; permCls='on';
    }
    const lockOn=isLockEnabled();
    // 탭별 HTML
    let html='';
    if(state.settingsTab==='display'){
      html=`
      <div class="admin-card"><h3><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8"/><path d="M12 14v6"/></svg></span> 표시</h3>
        <div class="setting-row"><div class="setting-label"><strong>화면 테마</strong></div><div class="choice-row">${[['light','밝게'],['dark','어둡게'],['system','시스템']].map(([v,l])=>`<button type="button" class="choice ${currentTheme()===v?'active':''}" data-theme="${v}">${l}</button>`).join('')}</div></div>
        <div class="setting-row"><div class="setting-label"><strong>글자 크기</strong></div><div class="choice-row">${[['sm','작게'],['md','기본'],['lg','크게'],['xl','더 크게']].map(([v,l])=>`<button type="button" class="choice ${state.settings.fontSize===v?'active':''}" data-setting-font="${v}">${l}</button>`).join('')}</div></div>
        <div class="setting-row"><div class="setting-label"><strong>친구·대화방 배치</strong></div><div class="custom-select" style="width:210px"><button type="button" class="select-button" data-select-open="sideLayout"><span data-selected="sideLayout" data-value="${esc(state.settings.sideLayout||'split')}">${(state.settings.sideLayout==='friends-top'?'친구 먼저':state.settings.sideLayout==='rooms-only'?'대화방만':state.settings.sideLayout==='friends-only'?'친구만':'나눠서 보기')}</span><span>⌄</span></button></div></div>
      </div>
      <div class="admin-card"><h3><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14c1 1 2.3 1.6 4 1.6s3-.6 4-1.6"/><path d="M9 9h.01M15 9h.01"/></svg></span> 감정 아이콘</h3><div class="avatar-pick" id="rxPick" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:8px">${RX_CHOICES.map(e=>`<button type="button" class="avatar-opt ${reactionEmojis().includes(e)?'on':''}" data-rx="${esc(e)}">${esc(e)}</button>`).join('')}</div></div>
      `;
    } else if(state.settingsTab==='chat'){
      html=`
      <div class="admin-card"><h3><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4 3V6Z"/></svg></span> 채팅 알림</h3>
        <div class="setting-row"><div class="setting-label"><strong>새 메시지 알림음</strong></div><label class="choice ${nt.sound?'active':''}"><input type="checkbox" name="notifySound" ${nt.sound?'checked':''} data-sound-toggle> 사용</label></div>
        <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:10px"><div class="setting-label"><strong>알림음 고르기</strong></div><div class="sound-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">${SOUNDS.map(s=>`<button type="button" class="sound-item ${s.id===nt.soundId?'on':''}" data-sound="${s.id}"><div class="grow"><div class="title">${esc(s.name)}</div></div><span>▶</span></button>`).join('')}</div></div>
        ${isNativeApp() ? `<div class="setting-row"><div class="setting-label"><strong>푸시 알림</strong></div><div class="notify-row"><span class="perm-badge ${permCls}">${permText}</span><label class="choice ${nt.browser?'active':''}"><input type="checkbox" name="notifyBrowser" ${nt.browser?'checked':''} data-browser-toggle> 사용</label></div></div>` : `<div class="setting-row"><div class="setting-label"><strong>기기 알림</strong></div><div class="notify-row"><span class="perm-badge ${permCls}">${permText}</span><label class="choice ${nt.browser?'active':''}"><input type="checkbox" name="notifyBrowser" ${nt.browser?'checked':''} data-browser-toggle> 사용</label></div></div>`}
        ${DESKTOP?'<div class="setting-row"><div class="setting-label"><strong>알림창 위치</strong></div><div class="choice-row">'+NOTIFY_POSITIONS.map(([v,l])=>'<button type="button" class="choice" data-notify-pos="'+v+'">'+l+'</button>').join('')+'</div></div>':''}
        <div class="setting-row"><div class="setting-label"><strong>입력 중 표시</strong></div><label class="choice ${state.settings.typingIndicator!==false?'active':''}"><input type="checkbox" name="typingIndicator" ${state.settings.typingIndicator!==false?'checked':''} data-typing-toggle> 사용</label></div>
        <div class="setting-row"><div class="setting-label"><strong>읽음 표시</strong></div><label class="choice ${state.settings.readReceipts!==false?'active':''}"><input type="checkbox" name="readReceipts" ${state.settings.readReceipts!==false?'checked':''} data-read-toggle> 사용</label></div>
      </div>
      ${DESKTOP?`<div class="admin-card" id="desktopUnreadCard"><h3><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z"/><path d="M7 8h10"/><path d="M7 12h6"/></svg></span> 데스크탑 요약 알림</h3><div class="setting-row"><div class="setting-label"><strong>요약 알림 사용</strong></div><label class="choice "+(getDesktopUnread().enabled?'active':'')+""><input type="checkbox" id="desktopUnreadToggle" "+(getDesktopUnread().enabled?'checked':'')+" > "+(getDesktopUnread().enabled?'켜짐':'꺼짐')+"</label></div><div id="desktopUnreadOpts" style=""+(getDesktopUnread().enabled?'':'display:none')+";display:"+(getDesktopUnread().enabled?'block':'none')+""><div class="setting-row"><div class="setting-label"><strong>알림 주기</strong></div><div class="choice-row"><button type="button" class="choice "+(getDesktopUnread().interval===5?'active':'')+"" data-desktop-interval="5">5분</button><button type="button" class="choice "+(getDesktopUnread().interval===10?'active':'')+"" data-desktop-interval="10">10분</button></div></div><div class="setting-row"><div class="setting-label"><strong>소리</strong></div><label class="choice "+(getDesktopUnread().sound?'active':'')+""><input type="checkbox" id="desktopUnreadSound" "+(getDesktopUnread().sound?'checked':'')+" > 소리와 함께</label></div></div></div>`:''}
      `;
    } else if(state.settingsTab==='invite'){
      html=`
      <div class="admin-card"><h3><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V21"/><circle cx="10" cy="7" r="3"/><circle cx="17.5" cy="7" r="2.5"/><path d="M18.5 13.5A4 4 0 0 1 21 17v4"/></svg></span> 초대 / 친구</h3>
        <div class="setting-row"><div class="setting-label"><strong>내 초대 코드</strong></div><div class="notify-row"><span class="code-chip" data-my-code>${esc(state.profile?.userCode||'준비 중')}</span><button type="button" class="soft-btn" style="flex:0 0 74px" data-action="copy-code">복사</button></div></div>
        <div class="setting-row"><div class="setting-label"><strong>채팅방 초대</strong></div><div class="custom-select" style="width:190px"><button type="button" class="select-button" data-select-open="invitePolicy"><span data-selected="invitePolicy" data-value="${state.settings.invitePolicy}">${state.settings.invitePolicy==='auto'?'자동으로 들어가요':state.settings.invitePolicy==='block'?'초대를 받지 않아요':'초대받으면 확인해요'}</span><span>⌄</span></button></div></div>
        <div class="setting-row"><div class="setting-label"><strong>접속 상태 표시</strong></div><div class="custom-select" style="width:210px"><button type="button" class="select-button" data-select-open="presenceMode"><span data-selected="presenceMode" data-value="${state.settings.presenceMode||'auto'}">${presenceModeLabel(state.settings.presenceMode||'auto')}</span><span>⌄</span></button></div></div>
      </div>
      `;
    } else if(state.settingsTab==='security'){
      html=`
      <div class="admin-card"><h3><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/><circle cx="12" cy="15" r="1"/></svg></span> 보안</h3>
        ${isNativeApp() ? `<div class="setting-row"><div class="setting-label"><strong>앱 잠금</strong></div><label class="choice ${lockOn?'active':''}"><input type="checkbox" id="lockEnableToggle" ${lockOn?'checked':''}> ${lockOn?'켜짐':'꺼짐'}</label></div><div class="setting-row"><div class="setting-label"><strong>생체 인증으로 바로 해제</strong><div class="meta" style="font-size:12px;color:var(--sub);margin-top:2px">잠금 화면에서 버튼 안 눌러도 Face ID가 저절로 떠요</div></div><label class="choice ${isBioAuto()?'active':''}"><input type="checkbox" id="bioAutoToggle" ${isBioAuto()?'checked':''}> ${isBioAuto()?'켜짐':'꺼짐'}</label></div>` : `<div class="setting-row" style="opacity:.6"><div class="setting-label"><strong>앱 잠금</strong></div><span class="perm-badge">앱 전용</span></div>`}
        <div class="field" id="lockPwField" style="${lockOn?'':'display:none'}"><label>새 비밀번호 (4자리)</label><input id="lockPwInput" class="input" type="password" inputmode="numeric" autocomplete="new-password" maxlength="4" placeholder="4자리 숫자" style="letter-spacing:8px;text-align:center;font-size:16px"><input id="lockPwConfirm" class="input" type="password" inputmode="numeric" autocomplete="new-password" maxlength="4" placeholder="한 번 더 입력" style="margin-top:8px;letter-spacing:8px;text-align:center;font-size:16px"><p class="desc" style="margin:8px 0 0;font-size:12px">이 기기에서만 잠겨요. 앱을 지웠다가 다시 깔면 잠금이 풀려요.</p><div class="row" style="margin-top:8px"><button type="button" class="soft-btn" data-action="save-lock" style="flex:1">저장</button><button type="button" class="soft-btn" data-action="disable-lock" style="flex:1">잠금 해제</button></div><p id="lockMsg" class="reset-msg"></p></div>
        <div class="setting-row"><div class="setting-label"><strong>차단한 사용자</strong></div><button type="button" class="soft-btn" style="flex:0 0 110px" data-action="blocked-users">보기</button></div>
        <div class="setting-row"><div class="setting-label"><strong>약관 및 정책</strong></div><button type="button" class="soft-btn" style="flex:0 0 110px" data-action="open-policies">보기</button></div>
        <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:10px"><div class="setting-label"><strong>키워드 알림</strong></div><textarea name="keywords" class="input word-box" maxlength="200" rows="3" placeholder="예: 시험&#10;급식" style="width:100%;font-size:16px">${esc((state.settings.keywords||[]).join('\n'))}</textarea></div>
        <div class="setting-row"><div class="setting-label"><strong>학교 변경 (전학·이직)</strong></div><button type="button" class="soft-btn" style="flex:0 0 110px" data-action="self-school-change">변경하기</button></div>
        ${state.profile?.role==='student'?'<div class="setting-row"><div class="setting-label"><strong>교사 인증 신청</strong></div><button type="button" class="soft-btn" style="flex:0 0 110px" data-action="teacher-request">신청하기</button></div>':''}
      </div>
      `;
    }
    p.innerHTML=html;
    // wire controls
    p.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>{setTheme(b.dataset.theme);p.querySelectorAll('[data-theme]').forEach(x=>x.classList.toggle('active',x===b));});
    p.querySelectorAll('[data-setting-font]').forEach(b=>b.onclick=()=>{state.settings.fontSize=b.dataset.settingFont;p.querySelectorAll('[data-setting-font]').forEach(x=>x.classList.toggle('active',x===b));applyFontSize();});
    p.querySelectorAll('[data-sound]').forEach(b=>b.onclick=()=>{state.soundDraft=b.dataset.sound;p.querySelectorAll('[data-sound]').forEach(x=>x.classList.toggle('on',x===b));playSound(state.soundDraft);});
    const ib=p.querySelector('[data-select-open="invitePolicy"]');if(ib)wireDropdown(ib,[{value:'auto',label:'자동으로 들어가요'},{value:'ask',label:'초대받으면 확인해요'},{value:'block',label:'초대를 받지 않아요'}],(v,l)=>{ib.querySelector('[data-selected]').textContent=l;ib.querySelector('[data-selected]').dataset.value=v; markSettingsDirty();});
    const pb=p.querySelector('[data-select-open="presenceMode"]');if(pb)wireDropdown(pb,[{value:'auto',label:presenceModeLabel('auto'),dot:'online'},{value:'away',label:presenceModeLabel('away'),dot:'away'},{value:'dnd',label:presenceModeLabel('dnd'),dot:'dnd'},{value:'offline',label:presenceModeLabel('offline'),dot:'offline'},{value:'hidden',label:presenceModeLabel('hidden'),dot:'hidden'}],(v,l)=>{pb.querySelector('[data-selected]').textContent=l;pb.querySelector('[data-selected]').dataset.value=v; markSettingsDirty();});
    const tt=p.querySelector('[data-typing-toggle]'); if(tt) tt.onchange=()=>{ tt.closest('.choice')?.classList.toggle('active',tt.checked); markSettingsDirty(); };
    const rt=p.querySelector('[data-read-toggle]'); if(rt) rt.onchange=()=>{ rt.closest('.choice')?.classList.toggle('active',rt.checked); markSettingsDirty(); };
    // 데스크탑 요약 알림 와이어링
    const duToggle=p.querySelector('#desktopUnreadToggle');
    const duOpts=p.querySelector('#desktopUnreadOpts');
    if(duToggle){
      duToggle.onchange=()=>{
        const on=!!duToggle.checked;
        duToggle.closest('.choice')?.classList.toggle('active',on);
        duToggle.closest('.choice')&& (duToggle.closest('.choice').lastChild.textContent = on?'켜짐':'꺼짐');
        if(duOpts) duOpts.style.display=on?'block':'none';
        state.settings.desktopUnread = { ...(state.settings.desktopUnread||{}), enabled:on, interval: (state.settings.desktopUnread?.interval===10?10:5), sound: !!state.settings.desktopUnread?.sound };
        markSettingsDirty();
      };
    }
    const duSound=p.querySelector('#desktopUnreadSound');
    if(duSound){
      duSound.onchange=()=>{ duSound.closest('.choice')?.classList.toggle('active',duSound.checked); state.settings.desktopUnread={ ...(state.settings.desktopUnread||{}), sound: !!duSound.checked }; markSettingsDirty(); };
    }
    p.querySelectorAll('[data-desktop-interval]').forEach(b=>{
      b.onclick=()=>{
        const v=Number(b.dataset.desktopInterval)||5;
        state.settings.desktopUnread={ ...(state.settings.desktopUnread||{}), interval: v===10?10:5 };
        p.querySelectorAll('[data-desktop-interval]').forEach(x=>x.classList.toggle('active', Number(x.dataset.desktopInterval)===v));
        markSettingsDirty();
      };
    });
    // dirty: any change marks dirty
    const markOnChange=(el)=>{ if(!el) return; const h=()=>markSettingsDirty(); el.addEventListener('change', h); el.addEventListener('input', h); };
    p.querySelectorAll('input, textarea, select, button.choice, button.tab').forEach(el=>{ markOnChange(el); });
    // generic delegate for dropdowns and other dynamic controls
    if(!p._dirtyBound){
      p._dirtyBound=true;
      p.addEventListener('click', (e)=>{
        const t=e.target.closest('button, input, [data-action], [data-desktop-interval], [data-theme], [data-setting-font], [data-sound], [data-select-open]');
        if(t) setTimeout(()=>markSettingsDirty(), 10);
      });
      p.addEventListener('input', ()=> setTimeout(()=>markSettingsDirty(), 10));
      p.addEventListener('change', ()=> setTimeout(()=>markSettingsDirty(), 10));
    }
    p.querySelectorAll('[data-theme],[data-setting-font],[data-sound]').forEach(b=>{
      const orig=b.onclick;
      if(orig) b.onclick=(e)=>{ orig(e); markSettingsDirty(); };
    });
    // 키보드 탭 이동 (좌우 화살표)
    const tabsEl=document.querySelector('.settings-page .admin-tabs');
    if(tabsEl && !tabsEl._kbdBound){
      tabsEl._kbdBound=true;
      tabsEl.setAttribute('role','tablist');
      tabsEl.querySelectorAll('.tab').forEach(t=>t.setAttribute('role','tab'));
      tabsEl.addEventListener('keydown', (e)=>{
        if(e.key!=='ArrowLeft' && e.key!=='ArrowRight') return;
        e.preventDefault();
        const tabs=[...tabsEl.querySelectorAll('.tab')];
        const idx=tabs.findIndex(t=>t.classList.contains('active'));
        let next= e.key==='ArrowRight' ? (idx+1)%tabs.length : (idx-1+tabs.length)%tabs.length;
        tabs[next]?.click();
        tabs[next]?.focus();
      });
    }
    // reaction
    state.rxDraft=new Set(reactionEmojis());
    p.querySelectorAll('#rxPick [data-rx]').forEach(b=>b.onclick=()=>{
      const e=b.dataset.rx||'';
      if(state.rxDraft.has(e)){ if(state.rxDraft.size<=1) return toast('1개는 남겨 주세요.'); state.rxDraft.delete(e); b.classList.remove('on'); }
      else { if(state.rxDraft.size>=8) return toast('최대 8개까지 고를 수 있어요.'); state.rxDraft.add(e); b.classList.add('on'); }
    });
    const persistBrowserPref=async()=>{
      // 토글은 누르는 즉시 저장된다 (저장 버튼을 안 눌러도 유지)
      try{
        const nt2={...(state.settings.notify||{}), browser:bt.checked};
        state.settings.notify=nt2;
        if(state.profile) state.profile.settings={...(state.profile.settings||{}), notify:nt2};
        await db.collection('users').doc(uid()).update({['settings.notify']:nt2, updatedAt:ts()});
      }catch(e){ console.error('notify pref', e); }
    };
    const bt=p.querySelector('[data-browser-toggle]'); if(bt) bt.onchange=async()=>{
      if(!bt.checked){ bt.closest('.choice')?.classList.remove('active'); persistBrowserPref(); return; }
      if(DESKTOP){ bt.closest('.choice')?.classList.add('active'); persistBrowserPref(); return; }
      // 네이티브 앱(iOS/Android)은 브라우저 Notification이 없어도 FCM으로 알림이 온다
      if(isNativeApp()){
        try{ await window.EdutalkNative.registerPush(); }catch(e){}
        try{ if(window.EdutalkNative.flushPushToken) window.EdutalkNative.flushPushToken(); }catch(e){}
        const st=String(window.__edutalkPushPerm||'');
        if(st==='denied'){
          bt.checked=false; bt.closest('.choice')?.classList.remove('active');
          persistBrowserPref();
          toast('알림이 차단되어 있어요. 아이폰 설정 → 에듀톡 → 알림에서 허용해 주세요.');
          return;
        }
        bt.closest('.choice')?.classList.add('active');
        persistBrowserPref();
        toast('앱 알림을 켰어요. 새 메시지가 오면 알림이 와요.');
        return;
      }
      if(notificationPermission()==='granted'){ bt.closest('.choice')?.classList.add('active'); persistBrowserPref(); return; }
      if(notificationPermission()==='unsupported'){ bt.checked=false; bt.closest('.choice')?.classList.remove('active'); return toast('이 브라우저는 기기 알림을 지원하지 않아요.'); }
      try{
        const r=await Notification.requestPermission();
        if(r==='granted'){ bt.closest('.choice')?.classList.add('active'); persistBrowserPref(); toast('기기 알림을 켰어요.'); }
        else { bt.checked=false; bt.closest('.choice')?.classList.remove('active'); persistBrowserPref(); toast('브라우저에서 알림이 차단되어 있어요.'); }
      }catch(e){ bt.checked=false; bt.closest('.choice')?.classList.remove('active'); }
    };
    if(DESKTOP && window.edutalkDesktop?.getNotificationPosition){
      const markPos=(v)=>p.querySelectorAll('[data-notify-pos]').forEach(b=>b.classList.toggle('active',b.dataset.notifyPos===v));
      window.edutalkDesktop.getNotificationPosition().then(markPos).catch(()=>{});
      p.querySelectorAll('[data-notify-pos]').forEach(b=>b.onclick=()=>{ markPos(b.dataset.notifyPos); try{ window.edutalkDesktop.setNotificationPosition(b.dataset.notifyPos); }catch(e){} });
    }
    // lock toggle
    const lockToggle=p.querySelector('#lockEnableToggle');
    const lockField=p.querySelector('#lockPwField');
    if(lockToggle){ lockToggle.onchange=()=>{ if(lockField) lockField.style.display=lockToggle.checked?'':'none'; if(!lockToggle.checked){ disableAppLock(); toast('앱 잠금을 껐어요.'); } } }
    const bioAuto=p.querySelector('#bioAutoToggle');
    if(bioAuto){ bioAuto.onchange=()=>{ setBioAuto(bioAuto.checked); bioAuto.closest('.choice')?.classList.toggle('active',bioAuto.checked); markSettingsDirty(); }; }
    // tabs already handled via delegation, but also ensure panel animation
    if(!prefersReducedMotion()){
      p.style.opacity='0'; p.style.transform='translateY(6px)';
      requestAnimationFrame(()=>{ p.style.transition='opacity .22s ease, transform .22s cubic-bezier(.2,.8,.2,1)'; p.style.opacity='1'; p.style.transform='none'; });
    }
    // wire sideLayout
    const sl=p.querySelector('[data-select-open="sideLayout"]');if(sl)wireDropdown(sl,[{value:'split',label:'나눠서 보기'},{value:'friends-top',label:'친구 먼저'},{value:'rooms-only',label:'대화방만'},{value:'friends-only',label:'친구만'}],(v,l)=>{sl.querySelector('[data-selected]').textContent=l;sl.querySelector('[data-selected]').dataset.value=v; markSettingsDirty();});
    // 탭 슬라이딩 인디케이터 업데이트
    try{
      const tabsEl = p.querySelector('.admin-tabs') || p.querySelector('.tabs');
      if(tabsEl){
        let ind = tabsEl.querySelector('.tabs-indicator');
        if(!ind){
          ind=document.createElement('div');
          ind.className='tabs-indicator';
          tabsEl.prepend(ind);
        }
        const active = tabsEl.querySelector('.tab.active');
        if(active){
          const r = active.getBoundingClientRect();
          const pr = tabsEl.getBoundingClientRect();
          ind.style.width = r.width + 'px';
          ind.style.transform = 'translateX(' + (r.left - pr.left - 4) + 'px)';
        }
      }
    }catch(e){}

  }
  function openSettings(tab){
    state.view='settings';
    state.settingsTab=tab||state.settingsTab||'display';
    try{ history.pushState({settings:true, tab:state.settingsTab}, '', location.pathname); }catch(e){}
    settingsDirty=false;
    renderShell();
    // focus first tab animation
    requestAnimationFrame(()=>{ const el=document.querySelector('.settings-page'); if(el) el.classList.add('screen-enter'); try{ clearSettingsDirty(); }catch(e){} });
  }

  function updateTabsIndicator(container){
    try{
      const tabsEl = typeof container==='string' ? document.querySelector(container) : container;
      if(!tabsEl) return;
      let ind = tabsEl.querySelector('.tabs-indicator');
      if(!ind){
        ind=document.createElement('div');
        ind.className='tabs-indicator';
        tabsEl.prepend(ind);
      }
      tabsEl.classList.add('has-indicator');
      const active = tabsEl.querySelector('.tab.active');
      if(active){
        const r = active.getBoundingClientRect();
        const pr = tabsEl.getBoundingClientRect();
        ind.style.width = r.width + 'px';
        ind.style.transform = 'translateX(' + (r.left - pr.left - 4) + 'px)';
      }
    }catch(e){}
  }

  function closeSettings(){
    state.view='chat';
    try{ history.replaceState({}, '', location.pathname); }catch(e){}
    renderShell();
  }

  function presenceModeLabel(m){
    return m==='away'?'항상 자리비움':m==='dnd'?'방해금지':m==='offline'?'항상 오프라인':m==='hidden'?'표시 안 함':'자동 (창 상태에 따라)';
  }
  // ---- 회원 탈퇴 ----
  async function openDeleteAccountModal(){
    // 방장인 방이 있으면 탈퇴를 막고, 방장 이전·방 삭제를 먼저 안내한다
    let owned=[];
    try{
      const s=await db.collection('channels').where('createdBy','==',uid()).limit(100).get();
      owned=s.docs.map(d=>({id:d.id,...d.data()})).filter(r=>!r.deleted&&!r.deleted_at);
    }catch(e){ console.error('owned rooms',e); }
    if(owned.length){
      const panel=openModal(`<h2>탈퇴할 수 없어요</h2><p class="desc">방장인 채팅방이 ${owned.length}개 있어요. 탈퇴하면 방이 주인 없이 남게 돼요.<br>각 방의 방장을 다른 사람에게 넘기거나 방을 삭제한 뒤에 탈퇴해 주세요.</p>
        <div class="list modal-scroll">${owned.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(r.name||'채팅방')}</div><div class="meta">${(r.memberIds||[]).length}명 · ${r.visibility==='all'?'공유':r.visibility==='private'?'개인':'대상 지정'}</div></div><span style="display:flex;gap:6px;flex:0 0 auto"><button class="soft-btn" style="flex:0 0 auto;padding:0 12px;height:38px" data-action="withdraw-transfer" data-room-id="${esc(r.id)}">방장 이전</button><button class="soft-btn" style="flex:0 0 auto;padding:0 12px;height:38px;color:var(--danger)" data-action="withdraw-delete-room" data-room-id="${esc(r.id)}">삭제</button></span></div>`).join('')}</div>
        <div class="modal-actions"><button type="button" class="cancel" data-close-modal>닫기</button><button type="button" class="confirm" id="withdrawRetry">다 했어요 · 다시 확인</button></div>`);
      panel.querySelector('#withdrawRetry').onclick=()=>{ closeModal(); openDeleteAccountModal(); };
      return;
    }
    const user=auth.currentUser;
    const providers=(user?.providerData||[]).map(p=>p.providerId);
    const hasPassword=providers.includes('password');
    const email=user?.email||'';
    openModal(`<h2>회원 탈퇴</h2>
      <p class="desc">탈퇴하면 되돌릴 수 없어요. 아래 내용을 꼭 확인해 주세요.</p>
      <div class="danger-box">
        <p>닉네임, 학년·반, 프로필 사진 등 <b>내 정보가 모두 삭제</b>돼요.</p>
        <p>참여 중인 채팅방에서 나오게 되고, 친구 목록에서도 사라져요.</p>
        <p>내가 보낸 메시지는 다른 사람의 대화에 남아 있을 수 있어요.</p>
        <p>같은 이메일로 다시 가입할 수는 있지만 이전 기록은 돌아오지 않아요.</p>
      </div>
      ${hasPassword
        ? `<div class="field" style="margin-top:16px"><label>비밀번호 확인</label><input id="delPassword" class="input" type="password" autocomplete="current-password" placeholder="지금 쓰는 비밀번호를 입력해 주세요."><p id="delPwMsg" class="reset-msg"></p></div>`
        : `<div class="warn-box" style="margin-top:16px">Google 로그인으로 가입한 계정이에요. 탈퇴하려면 Google로 본인 확인을 해주세요.</div>`}
      <label class="consent" style="margin-top:16px"><input type="checkbox" id="delConfirm"><span>위 내용을 확인했어요.</span></label>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="danger-btn" id="delGo" disabled style="opacity:.5">${hasPassword?'탈퇴하기':'Google 확인 후 탈퇴'}</button></div>`);
    const chk=$('#delConfirm'), go=$('#delGo');
    if(chk&&go) chk.onchange=()=>{ go.disabled=!chk.checked; go.style.opacity=chk.checked?'1':'.5'; };
    if(go) go.onclick=()=>deleteAccount();
  }
  async function deleteAccount(){
    const user=auth.currentUser; if(!user) return;
    const u=user.uid;
    const go=$('#delGo'); if(go){ go.disabled=true; go.textContent='확인 중…'; }
    const resetGo=(t)=>{ if(go){ go.disabled=false; go.textContent=t||'탈퇴하기'; } };
    // 탈퇴 전 본인 확인 (비밀번호가 틀리면 여기서 멈추고 탈퇴하지 않는다)
    try{
      const providers=(user.providerData||[]).map(p=>p.providerId);
      if(providers.includes('password')){
        const pw=$('#delPassword')?.value||'';
        const msg=$('#delPwMsg');
        if(!pw){ if(msg){ msg.className='reset-msg warn'; msg.textContent='비밀번호를 입력해 주세요.'; } resetGo(); return; }
        const cred=firebase.auth.EmailAuthProvider.credential(user.email,pw);
        await user.reauthenticateWithCredential(cred);
      } else {
        const provider=new firebase.auth.GoogleAuthProvider();
        await user.reauthenticateWithPopup(provider);
      }
    }catch(e){
      console.warn('deleteAccount reauth',e);
      const code=e?.code||'';
      if(code==='auth/wrong-password'||code==='auth/invalid-credential'||code==='auth/invalid-login-credentials'){
        const msg=$('#delPwMsg');
        if(msg){ msg.className='reset-msg warn'; msg.textContent='비밀번호가 맞지 않아요. 탈퇴하지 않았어요.'; }
      } else if(code==='auth/popup-closed-by-user'||code==='auth/cancelled-popup-request'){
        toast('본인 확인을 취소했어요.');
      } else if(code==='auth/too-many-requests'){
        toast('너무 많이 시도했어요. 잠시 뒤에 다시 시도해 주세요.');
      } else {
        toast('본인 확인에 실패했어요. 탈퇴하지 않았어요.');
      }
      resetGo(auth.currentUser?.providerData?.some(p=>p.providerId==='password')?'탈퇴하기':'Google 확인 후 탈퇴');
      return;
    }
    if(go){ go.disabled=true; go.textContent='처리 중…'; }
    // 그 사이 방장이 된 방이 생겼으면 탈퇴를 멈추고 안내로 돌린다
    try{
      const chk=await db.collection('channels').where('createdBy','==',u).limit(1).get();
      if(chk.docs.some(d=>!d.data().deleted&&!d.data().deleted_at)){
        closeAllModals(); openDeleteAccountModal();
        return toast('방장인 방이 있어 탈퇴를 멈췄어요.');
      }
    }catch(e){ console.warn('deleteAccount owned check',e); }
    // 탈퇴하면 모든 채팅방에서 자동으로 나온다 (공유 채팅방 포함 · 유령 멤버 방지)
    // 400개씩 끊어서 끝까지 반복하고, 나갈 때마다 퇴장 시스템 메시지를 남긴다
    const leaveAllMyRooms=async ()=>{
      const myName=state.profile?.displayName||'사용자';
      for(let round=0;round<10;round++){
        const s=await db.collection('channels').where('memberIds','array-contains',u).limit(400).get();
        const targets=s.docs.filter(d=>!d.data().deleted&&!d.data().deleted_at);
        if(!targets.length) break;
        for(const d of targets){
          try{
            await d.ref.collection('messages').add({
              system:'leave',targetName:String(myName).slice(0,20),text:'',
              senderId:u,senderName:myName,createdAt:ts(),deleted:false
            });
          }catch(e){}
        }
        for(let i=0;i<targets.length;i+=400){
          const b=db.batch();
          targets.slice(i,i+400).forEach(d=>b.update(d.ref,{memberIds:firebase.firestore.FieldValue.arrayRemove(u),updatedAt:ts()}));
          await b.commit();
        }
        // 타이핑·읽음 표시도 함께 정리한다
        for(const d of targets){
          try{ await d.ref.collection('typing').doc(u).delete().catch(()=>{}); }catch(e){}
          try{ await d.ref.collection('reads').doc(u).delete().catch(()=>{}); }catch(e){}
        }
        if(targets.length<400) break;
      }
    };
    try{ await leaveAllMyRooms(); }catch(e){ console.warn('deleteAccount leave',e); }
    // 탈퇴 표시를 먼저 남기면 이용권 만료 상태에서도 남은 방 정리가 규칙에서 허용된다
    try{ await db.collection('users').doc(u).set({deleted:true,deletedAt:ts()},{merge:true}); }catch(e){ console.warn('deleteAccount flag',e); }
    try{ await leaveAllMyRooms(); }catch(e){ console.warn('deleteAccount leave 2nd',e); }
    try{
      // 남에게 보이는 정보부터 지운다
      await db.collection('publicProfiles').doc(u).delete().catch(()=>{});
      await db.collection('users').doc(u).set({ displayName:'탈퇴한 사용자', photoURL:'', avatarEmoji:'', avatarColor:'', userCode:'', deleted:true, deletedAt:ts() },{merge:true}).catch(()=>{});
    }catch(e){ console.warn('deleteAccount data',e); }
    try{
      closeAllModals();
      await user.delete();
      toast('탈퇴가 완료됐어요. 그동안 고마웠어요.');
    }catch(e){
      console.warn('deleteAccount auth',e);
      if(e && e.code==='auth/requires-recent-login'){
        closeAllModals();
        await auth.signOut();
        toast('탈퇴 처리를 접수했어요. 다시 로그인한 뒤 한 번 더 눌러 주세요.');
      } else {
        toast('탈퇴를 끝내지 못했어요. 잠시 후 다시 시도해 주세요.');
        resetGo('탈퇴하기');
      }
    }
  }
  async function saveSettings(f){
    const p=f.querySelector('[data-selected="invitePolicy"]')?.dataset.value||state.settings.invitePolicy;state.settings.invitePolicy=p;
    const pm0=f.querySelector('[data-selected="presenceMode"]')?.dataset.value||state.settings.presenceMode||'auto';
    const pm=(pm0==='away'||pm0==='dnd'||pm0==='offline'||pm0==='hidden'||pm0==='auto')?pm0:'auto';state.settings.presenceMode=pm;
    const typingOn=!!f.typingIndicator?.checked;
    const readOn=!!f.readReceipts?.checked;
    const rxList=[...(state.rxDraft instanceof Set?state.rxDraft:[])].filter(e=>typeof e==='string'&&e).slice(0,8);
    if(rxList.length) state.settings.reactionEmojis=rxList;
    state.rxDraft=null;
    const sideLayout=f.querySelector('[data-selected="sideLayout"]')?.dataset.value||state.settings.sideLayout||'split';
    state.settings.typingIndicator=typingOn;
    state.settings.readReceipts=readOn;
    state.settings.sideLayout=['split','friends-top','rooms-only','friends-only'].includes(sideLayout)?sideLayout:'split';
    const nt={sound:!!f.notifySound?.checked,soundId:state.soundDraft||notifySettings().soundId,browser:!!f.notifyBrowser?.checked};
    if(DESKTOP) nt.desktopNotify=!!f.notifyBrowser?.checked;
    state.settings.notify=nt;
    // 데스크탑 요약 알림 저장
    if(DESKTOP){
      const duEnabled = !!p.querySelector('#desktopUnreadToggle')?.checked;
      const duInterval = Number(p.querySelector('[data-desktop-interval].active')?.dataset.desktopInterval)|| (state.settings.desktopUnread?.interval===10?10:5);
      const duSound = !!p.querySelector('#desktopUnreadSound')?.checked;
      state.settings.desktopUnread = { enabled: duEnabled, interval: (duInterval===10?10:5), sound: duSound, soundId: state.soundDraft||'bell' };
    }
    const kws=String(f.keywords?.value||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,10).map(x=>x.slice(0,20));
    state.settings.keywords=kws;
    const s={...(state.profile?.settings||{}),fontSize:state.settings.fontSize,theme:state.settings.theme||currentTheme(),roomGroups:state.settings.roomGroups||{},groupOrder:(state.groupNames||[]).slice(),mutedRooms:state.settings.mutedRooms||[],presenceMode:pm,notify:nt,typingIndicator:typingOn,readReceipts:readOn,sideLayout:state.settings.sideLayout||'split',reactionEmojis:state.settings.reactionEmojis||null,desktopUnread: state.settings.desktopUnread||{enabled:false,interval:5,sound:false}};
    try{await db.collection('users').doc(uid()).update({invitePolicy:p,settings:s,updatedAt:ts()});}catch(e){console.error(e);return toast(errText(e));}
    // 키워드는 분리 문서에만 둔다 (같은 학교 관리자 눈에 안 띄게)
    try{ await db.collection('userPrivate').doc(uid()).set({keywords:kws,updatedAt:ts()},{merge:true}); }catch(e){ console.warn('keywords save',e); }
    if(state.profile){ state.profile.invitePolicy=p; state.profile.settings=s; }
    try{await putPublicProfile({invitePolicy:p});}catch(e){console.error(e);}
    // 끄면 내 입력 상태를 즉시 지우고, 읽음 위치 공개도 멈춘다 (서로 보이지 않게)
    if(!typingOn){ stopTyping(); state.typingUsers=[]; }
    if(readOn){ if(state.room) markRead(state.room.id); }
    else {
      // 읽음 공개를 끄면 이 방에 남긴 내 읽음 기록도 지운다 (서로 보이지 않게)
      if(state.room){ try{ await db.collection('channels').doc(state.room.id).collection('reads').doc(uid()).delete(); }catch(e){} }
    }
    pushPresence();
    try{ clearSettingsDirty(); }catch(e){}
    try{ if(DESKTOP) startDesktopUnreadTimer(); }catch(e){}
    closeModal();renderSidebar();attachInviteListener();
    renderTypingIndicator(); if($('#messages')) renderMessages(false);
    try{ await hapticSuccess(); }catch(e){} toast('설정을 저장했어요.');
  }
  function openBlockedUsers(){openModal(`<h2>차단한 사용자</h2><p class="desc">차단을 풀어도 차단했던 동안 받은 메시지는 다시 보이지 않아요.</p><div class="list">${(state.profile.blockedUsers||[]).map(id=>`<div class="list-item" data-uid="${esc(id)}"><div class="grow"><div class="title">${esc(state.profileCache.get(id)?.displayName||'사용자')}</div></div><button class="soft-btn" style="flex:0 0 90px" data-action="block" data-uid="${esc(id)}" data-name="${esc(state.profileCache.get(id)?.displayName||'사용자')}">해제</button></div>`).join('')||'<div class="empty-side">차단한 사용자가 없어요.</div>'}</div>`);}
  function openPolicies(){
    const pages=authPages();
    const list=pages.length?pages:DEFAULT_AUTH_PAGES.filter(p=>p.enabled!==false);
    openModal(`<h2>약관 및 정책</h2><p class="desc">서비스 이용에 필요한 약관과 정책을 확인해요. 최신 내용은 로그인 화면에서도 볼 수 있어요.</p><div class="list">${list.map(p=>`<button type="button" class="list-item tappable" data-action="view-policy" data-page="${esc(p.id)}"><div class="grow"><div class="title">${esc(p.title||p.label||p.id)}</div><div class="meta">${esc(p.label||'')}</div></div><span>›</span></button>`).join('')}</div><div class="modal-actions"><button class="confirm" data-close-modal>닫기</button></div>`);
  }
  function viewPolicy(id){
    const p=(authPages().find(x=>x.id===id)||DEFAULT_AUTH_PAGES.find(x=>x.id===id));
    if(!p) return toast('문서를 찾지 못했어요.');
    openModal(`<h2>${esc(p.title||p.label||'')}</h2><div class="auth-page-body">${sanitizeRichHtml(p.html||'')}</div><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`);
  }
  // ---------- 일정 캘린더 (우리 학교 일정) ----------
  // 날짜는 로컬 기준 YYYYMMDD 문자열로 다룬다
  function calYmd(d){ const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`; }
  function calPretty(ymd){
    const s=String(ymd||''); if(s.length!==8) return s;
    return `${Number(s.slice(4,6))}월 ${Number(s.slice(6,8))}일`;
  }
  function calInit(){
    const t=new Date();
    if(!state.calCursor) state.calCursor={y:t.getFullYear(),m:t.getMonth()};
    if(!state.calSelected) state.calSelected=calYmd(t);
    if(!Array.isArray(state.calEvents)) state.calEvents=[];
  }
  function openCalendar(){
    if(!state.profile) return;
    calInit();
    const canAdd=isTeacherOrAdmin();
    openModal(`<h2>일정</h2><p class="desc">우리 학교 일정이에요. 선생님·관리자만 등록할 수 있어요.</p>
      <div class="cal-head"><button type="button" class="icon-btn" data-action="cal-prev" aria-label="이전 달">‹</button><strong id="calTitle"></strong><button type="button" class="icon-btn" data-action="cal-next" aria-label="다음 달">›</button><button type="button" class="soft-btn" style="flex:0 0 64px;height:38px" data-action="cal-today">오늘</button></div>
      <div class="cal-grid cal-week">${['일','월','화','수','목','금','토'].map(d=>`<span>${d}</span>`).join('')}</div>
      <div class="cal-grid" id="calGrid"></div>
      <div class="divider"></div>
      <div id="calDayHost"></div>
      ${canAdd?`<div class="field" style="margin-top:12px"><label>새 학교 일정</label><input id="calTitleInput" class="input" maxlength="60" placeholder="예: 수학 수행평가"></div>
      <div class="row"><input id="calDateInput" class="input" type="date" style="flex:1;min-width:0" title="시작일"><input id="calEndInput" class="input" type="date" style="flex:1;min-width:0" title="끝일 (연속 일정)"><input id="calTimeInput" class="input" type="time" style="flex:0 0 118px;min-width:0" title="시간 (선택)"></div>
      <div class="field" style="margin-top:8px"><input id="calMemoInput" class="input" maxlength="300" placeholder="메모 (선택)"></div>
      <div class="admin-toolbar"><button type="button" class="soft-btn" data-action="cal-add">일정 추가</button><button type="button" class="soft-btn" data-action="cal-neis">NEIS 학사일정 가져오기</button><button type="button" class="soft-btn" data-action="cal-reload">새로고침</button></div>`:''}
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
    runAsync(async()=>{ await loadCalEvents(); paintCalendar(); });
  }
  async function loadCalEvents(manual=false){
    let sid=state.profile?.schoolId||'';
    // 학교 정보가 stale하면 쿼리가 permission-denied로 실패해 달력이 비어 보인다.
    // 서버의 최신 schoolId를 우선 사용한다.
    try{
      const uDoc=await db.collection('users').doc(uid()).get();
      if(uDoc.exists){
        const fresh=String(uDoc.data()?.schoolId||'').trim();
        if(fresh && fresh!==sid){
          sid=fresh;
          state.profile={...(state.profile||{}), schoolId:fresh, schoolName:uDoc.data()?.schoolName||state.profile?.schoolName||''};
        }
      }
    }catch(e){}
    const school=[];
    const doFetch=async (targetSid)=>{
      if(targetSid){
        const s=await db.collection('scheduleItems').where('schoolId','==',targetSid).limit(500).get();
        s.docs.forEach(d=>{ const v=d.data()||{}; if(v.scope==='school') school.push({id:d.id,...v}); });
      } else if(isAdmin()){
        const s=await db.collection('scheduleItems').limit(500).get();
        s.docs.forEach(d=>{ const v=d.data()||{}; if(v.scope==='school') school.push({id:d.id,...v}); });
      }
    };
    try{
      await doFetch(sid);
    }catch(e){
      console.warn('cal school',e?.code||e);
      if(e?.code==='permission-denied'){
        // stale 프로필로 인한 1회 재시도: users 문서를 다시 읽고 재조회
        try{
          const u2=await db.collection('users').doc(uid()).get();
          const fresh2=String(u2.data()?.schoolId||'').trim();
          if(fresh2 && fresh2!==sid){
            sid=fresh2;
            state.profile={...(state.profile||{}), schoolId:fresh2, schoolName:u2.data()?.schoolName||state.profile?.schoolName||''};
            try{ await doFetch(fresh2); }catch(e2){
              console.warn('cal retry', e2?.code||e2);
              if(manual) toast('학교 일정을 불러오지 못했어요. 학교 정보가 달라졌을 수 있어요. 새로고침해 주세요.');
            }
          } else {
            if(manual) toast('학교 일정을 불러오지 못했어요. 학교 정보가 달라졌을 수 있어요. 새로고침해 주세요.');
          }
        }catch(_){
          if(manual) toast('학교 일정을 불러오지 못했어요. 학교 정보가 달라졌을 수 있어요. 새로고침해 주세요.');
        }
        try{ await loadSchool(); }catch(_){}
      } else if(manual){
        toast(errText(e));
      }
    }
    state.calEvents=school;
  }
  function paintCalendar(anim){
    const grid=$('#calGrid'), title=$('#calTitle'); if(!grid||!title) return;
    const {y,m}=state.calCursor;
    title.textContent=`${y}년 ${m+1}월`;
    const first=new Date(y,m,1).getDay();
    const days=new Date(y,m+1,0).getDate();
    const today=calYmd(new Date());
    const byDate={};
    (state.calEvents||[]).forEach(ev=>{
      const k=String(ev.date||'');
      if(k.length!==8) return;
      (byDate[k]=byDate[k]||[]).push(ev);
    });
    let html='';
    for(let i=0;i<first;i++) html+='<span class="cal-day empty"></span>';
    for(let d=1;d<=days;d++){
      const dt=new Date(y,m,d), k=calYmd(dt);
      const evs=byDate[k]||[];
      const hasS=evs.some(e=>e.scope==='school');
      html+=`<button type="button" class="cal-day${k===today?' today':''}${k===state.calSelected?' sel':''}" data-action="cal-pick" data-date="${k}"><span class="cal-num">${d}</span><span class="cal-dots">${hasS?'<i class="dot s"></i>':''}</span></button>`;
    }
    grid.innerHTML=html;
    if(anim){ grid.classList.remove('pane-in-right','pane-in-left'); void grid.offsetWidth; grid.classList.add(anim==='right'?'pane-in-right':'pane-in-left'); }
    paintCalDay();
  }
  function paintCalDay(){
    const host=$('#calDayHost'); if(!host) return;
    const k=state.calSelected||'';
    const evs=(state.calEvents||[]).filter(e=>String(e.date||'')===k);
    const canDel=(ev)=>isAdmin()||(ev.scope==='school'&&isTeacherOrAdmin());
    host.innerHTML=`<div class="field" style="margin:0"><label>${esc(calPretty(k))} 일정 ${evs.length}개</label><div class="list">`
      +(evs.map(ev=>`<div class="list-item"><div class="grow"><div class="title">${esc(ev.title||'일정')} ${ev.scope==='school'?'<span class="admin-chip" style="background:#FFF0F1;color:#C81E2B">학교</span>':''}${ev.time?`<span class="admin-chip">${esc(ev.time)}</span>`:''}</div>${ev.memo?`<div class="meta">${esc(ev.memo)}</div>`:''}${ev.source==='neis'?'<div class="meta">NEIS 학사일정</div>':''}</div>${canDel(ev)?`<button type="button" class="soft-btn" style="flex:0 0 60px;color:var(--danger)" data-action="cal-del" data-id="${esc(ev.id)}">삭제</button>`:''}</div>`).join('')||'<div class="empty-side">일정이 없어요.</div>')
      +`</div></div>`;
    // 날짜를 누르면 등록 폼 날짜가 그 날로 따라간다
    const di=$('#calDateInput'); if(di && k.length===8) di.value=`${k.slice(0,4)}-${k.slice(4,6)}-${k.slice(6,8)}`;
    const di2=$('#calEndInput'); if(di2 && k.length===8 && !di2.value) di2.value=`${k.slice(0,4)}-${k.slice(4,6)}-${k.slice(6,8)}`;
  }
  function calMove(dir){
    calInit();
    let {y,m}=state.calCursor;
    m+=dir; if(m<0){m=11;y--;} if(m>11){m=0;y++;}
    state.calCursor={y,m};
    paintCalendar(dir>0?'right':'left');
  }
  async function addCalEvent(){
    if(!isTeacherOrAdmin()) return toast('선생님·관리자만 등록할 수 있어요.');
    const title=($('#calTitleInput')?.value||'').trim();
    if(!title) return toast('일정 제목을 적어 주세요.');
    const dv=$('#calDateInput')?.value||'';
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dv);
    if(!m) return toast('날짜를 골라 주세요.');
    const ev=$('#calEndInput')?.value||'';
    const em=/^(\d{4})-(\d{2})-(\d{2})$/.exec(ev);
    const tv=$('#calTimeInput')?.value||'';
    const time=/^([01]\d|2[0-3]):([0-5]\d)$/.test(tv)?tv:'';
    const start=`${m[1]}${m[2]}${m[3]}`;
    let end=em?`${em[1]}${em[2]}${em[3]}`:start;
    if(end<start) return toast('끝 날짜가 시작보다 빠를 수 없어요.');
    const memo=($('#calMemoInput')?.value||'').trim().slice(0,300);
    let sid=state.profile?.schoolId||'';
    // 서버의 최신 schoolId로 보정 (stale 프로필로 다른 학교에 저장되는 문제 방지)
    try{
      const uDoc=await db.collection('users').doc(uid()).get();
      if(uDoc.exists){
        const fresh=String(uDoc.data()?.schoolId||'').trim();
        if(fresh && fresh!==sid){ sid=fresh; state.profile={...(state.profile||{}),schoolId:fresh, schoolName:uDoc.data()?.schoolName||state.profile?.schoolName||''}; }
      }
    }catch(e){}
    if(!sid) return toast('학교 정보가 없어요.');
    // 연속 일정: 시작~끝 하루씩 나눠 저장한다 (최대 62일)
    const days=[];
    { const d0=new Date(Number(start.slice(0,4)),Number(start.slice(4,6))-1,Number(start.slice(6,8)));
      const d1=new Date(Number(end.slice(0,4)),Number(end.slice(4,6))-1,Number(end.slice(6,8)));
      for(let d=new Date(d0);d<=d1&&days.length<62;d.setDate(d.getDate()+1)){
        days.push(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`);
      } }
    if(!days.length) return toast('날짜를 확인해 주세요.');
    try{
      const batch=db.batch();
      days.forEach(date=>batch.set(db.collection('scheduleItems').doc(),{ title:title.slice(0,60), date, memo, scope:'school', time, ownerUid:'', schoolId:sid, source:'manual', createdBy:uid(), createdAt:ts(), updatedAt:ts() }));
      await batch.commit();
    }
    catch(e){ console.error(e); return toast(errText(e)); }
    const ti=$('#calTitleInput'); if(ti) ti.value='';
    const mi=$('#calMemoInput'); if(mi) mi.value='';
    // 저장한 달로 달력을 옮겨서 바로 보이게 한다
    state.calCursor={y:Number(start.slice(0,4)),m:Number(start.slice(4,6))-1};
    state.calSelected=start;
    state.schedCache=null; // 배너 캐시도 즉시 갱신
    await loadCalEvents(); paintCalendar();
    try{ await refreshBanners(true); }catch(e){}
    try{ renderSidebar(); }catch(e){}
    toast(days.length>1?`${days.length}일 일정을 추가했어요.`:'일정을 추가했어요.');
  }
  async function deleteCalEvent(id){
    if(!id) return;
    if(!isTeacherOrAdmin()) return toast('선생님·관리자만 삭제할 수 있어요.');
    try{ await db.collection('scheduleItems').doc(id).delete(); }
    catch(e){ console.error(e); return toast(errText(e)); }
    state.schedCache=null;
    await loadCalEvents(); paintCalendar();
    try{ await refreshBanners(true); }catch(e){}
    try{ renderSidebar(); }catch(e){}
    toast('일정을 지웠어요.');
  }
  // NEIS 학사일정 불러오기 (이번 달, 학교 일정으로 저장 · 같은 날짜+제목 중복 제외)
  // NEIS는 한 번에 최대 1000개씩, 페이지로 나눠 준다. 서버가 요청 달과 다른 달을 섞어 줄 수 있어서
  // 끝까지 다 받아온 뒤 요청한 달(YYYYMM)만 골라 저장한다. (1페이지만 읽으면 다른 달 일정이 저장돼 이번 달에 안 보이는 문제 수정)
  async function importNeisSchedule(){
    if(!isTeacherOrAdmin()) return toast('선생님·관리자만 가져올 수 있어요.');
    let sid=state.profile?.schoolId||'';
    try{
      const uDoc=await db.collection('users').doc(uid()).get();
      if(uDoc.exists){
        const fresh=String(uDoc.data()?.schoolId||'').trim();
        if(fresh && fresh!==sid){ sid=fresh; state.profile={...(state.profile||{}),schoolId:fresh, schoolName:uDoc.data()?.schoolName||state.profile?.schoolName||''}; }
      }
    }catch(e){}
    const parts=String(sid||'').split('-');
    if(parts.length!==2||!parts[0]||!parts[1]) return toast('NEIS 등록 학교가 아니에요.');
    const {y,m}=state.calCursor||{};
    if(!(y>2000&&m>=0&&m<=11)) return toast('달력을 먼저 열어 주세요.');
    const ym=`${y}${String(m+1).padStart(2,'0')}`;
    toast('NEIS에서 가져오는 중이에요...');
    let allRows=[], total=0, resultCode='';
    try{
      let page=1; total=Infinity;
      while(allRows.length<total&&page<=10){
        const res=await fetch(`https://open.neis.go.kr/hub/SchoolSchedule?Type=json&pIndex=${page}&pSize=1000&ATPT_OFCDC_SC_CODE=${encodeURIComponent(parts[0])}&SD_SCHUL_CODE=${encodeURIComponent(parts[1])}&AA_YM=${ym}`);
        const j=await res.json();
        const headArr=j?.SchoolSchedule?.[0]?.head||[];
        const first=Array.isArray(headArr)?headArr[0]:headArr;
        total=Number(first?.list_total_count)||0;
        const rslt=Array.isArray(headArr)?headArr.find(x=>x&&x.RESULT):null;
        if(rslt?.RESULT?.CODE) resultCode=String(rslt.RESULT.CODE);
        resultCode=String(list?.RESULT?.CODE||j?.RESULT?.CODE||'');
        const rows=(j?.SchoolSchedule?.[1]?.row)||[];
        if(!rows.length) break;
        allRows=allRows.concat(rows);
        if(allRows.length>=total) break;
        page++;
      }
    }catch(e){ console.error(e); return toast('NEIS에서 가져오지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    const monthRows=allRows.filter(r=>String(r.AA_YMD||'').slice(0,6)===ym);
    if(!monthRows.length){
      // 학교가 NEIS에 학사일정을 올리지 않았거나, 이번 달 자료가 비어 있는 경우
      return openModal(`<h2>가져올 일정이 없어요</h2><p class="desc">NEIS 응답 ${allRows.length}건 중 이번 달(${ym.slice(0,4)}년 ${Number(ym.slice(4))}월) 자료는 0건이에요.<br>학교에서 NEIS에 학사일정을 올리지 않았다면 이렇게 나와요. 학교 행정실에 확인해 보세요.${resultCode?`<br>응답 코드: ${esc(resultCode)}`:''}</p><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
    }
    const have=new Set((state.calEvents||[]).filter(e=>e.scope==='school').map(e=>`${e.date}|${e.title}`));
    const fresh=monthRows
      .map(r=>({ date:String(r.AA_YMD||''), title:String(r.EVENT_NM||'').slice(0,60), memo:String(r.EVENT_CNTNT||'').slice(0,300) }))
      .filter(r=>/^\d{8}$/.test(r.date)&&r.title&&!have.has(`${r.date}|${r.title}`));
    if(!fresh.length) return toast('새로 가져올 일정이 없어요.');
    try{
      const batch=db.batch();
      fresh.slice(0,300).forEach(r=>{
        batch.set(db.collection('scheduleItems').doc(), { ...r, scope:'school', ownerUid:'', schoolId:sid, source:'neis', createdBy:uid(), createdAt:ts(), updatedAt:ts() });
      });
      await batch.commit();
    }catch(e){ console.error(e); return toast(errText(e)); }
    state.schedCache=null;
    await loadCalEvents(); paintCalendar();
    try{ await refreshBanners(true); }catch(e){}
    try{ renderSidebar(); }catch(e){}
    toast(`이번 달 ${monthRows.length}건 중 새로 ${fresh.length}개를 가져왔어요.`);
  }
  // ---------- 채팅 관리 (사이드바 아래 버튼) — 재구성: 탭 + 아이콘 + 일정/할 일 연계 ----------
  function openChatManager(){
    state.cmSel=new Set();
    if(!state.cmTab) state.cmTab='rooms';
    const tabActive=(k)=> state.cmTab===k?'active':'';
    openModal(`<h2>채팅 관리</h2>
      <div class="tabs" style="margin-bottom:14px">
        <button type="button" class="tab ${tabActive('rooms')}" data-cm-tab="rooms"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4 3V6Z"/></svg></span> 내 채팅방</button>
        <button type="button" class="tab ${tabActive('lists')}" data-cm-tab="lists"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg></span> 목록 탭</button>
        <button type="button" class="tab ${tabActive('invites')}" data-cm-tab="invites"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l1-1a5 5 0 0 0-7-7L9 5"/><path d="M14 11a5 5 0 0 0-7 0l-1 1a5 5 0 0 0 7 7l1-1"/></svg></span> 초대/공유</button>
      </div>
      <div class="cm-pane ${state.cmTab==='rooms'?'':'hidden'}" data-cm-pane="rooms">
        <div class="field"><label>내 채팅방</label>
          <div class="row" style="margin-bottom:8px"><button type="button" class="soft-btn" data-action="cm-select-all">전체 선택</button><button type="button" class="soft-btn" data-action="cm-select-none">선택 해제</button><button type="button" class="danger-btn" style="flex:1;height:42px;border-radius:13px;font-size:14px;font-weight:650" data-action="leave-selected">선택한 채팅방 나가기</button></div>
          <div id="chatManagerRooms" class="list"></div>
        </div>
        <div class="setting-row"><div class="setting-label"><strong>✅ 할 일 바로가기</strong></div><button type="button" class="soft-btn" style="flex:0 0 100px" data-action="todos-go">할 일 보기</button></div>
      </div>
      <div class="cm-pane ${state.cmTab==='lists'?'':'hidden'}" data-cm-pane="lists">
        <div class="settings-list">
          <button class="list-item" data-action="chat-groups"><div class="grow"><div class="title"><span class="s-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg></span> 목록 탭 관리</div><div class="meta">탭을 만들고 이름을 바꿔요. 탭은 꾹 눌러 순서를 바꿀 수 있어요.</div></div><span>›</span></button>
          <div class="setting-row"><div class="setting-label"><strong>📅 일정</strong></div><button type="button" class="soft-btn" style="flex:0 0 100px" data-action="calendar">일정 열기</button></div>
        </div>
      </div>
      <div class="cm-pane ${state.cmTab==='invites'?'':'hidden'}" data-cm-pane="invites">
        <div class="settings-list">
          <button class="list-item" data-action="room-join-code"><div class="grow"><div class="title">🔑 참가 코드로 들어가기</div><div class="meta">공유 채팅방의 코드를 입력해 들어가요.</div></div><span>›</span></button>
          <button class="list-item" data-action="my-share-requests"><div class="grow"><div class="title">🏫 학교 전체 공유 요청</div><div class="meta">승인을 기다리는 요청을 확인하고 취소할 수 있어요.</div></div><span>›</span></button>
        </div>
      </div>
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
    // 탭 전환
    setTimeout(()=> updateTabsIndicator(document.querySelector('.tabs')), 30);
    $('[data-cm-tab]').forEach(b=> b.onclick=()=>{
      state.cmTab=b.dataset.cmTab;
      $('[data-cm-tab]').forEach(x=>x.classList.toggle('active',x===b));
      $('.cm-pane').forEach(p=> p.classList.toggle('hidden', p.dataset.cmPane!==state.cmTab));
      setTimeout(()=> updateTabsIndicator(document.querySelector('.tabs')), 30);
      if(!prefersReducedMotion()){
        const pane=document.querySelector('.cm-pane[data-cm-pane="'+state.cmTab+'"]');
        if(pane){ pane.classList.remove('pane-in-right'); void pane.offsetWidth; pane.classList.add('pane-in-right'); }
      }
    });
    renderChatManagerRooms();
  }
  function renderChatManagerRooms(){
    const host=$('#chatManagerRooms'); if(!host) return;
    const rooms=state.rooms||[];
    if(!(state.cmSel instanceof Set)) state.cmSel=new Set();
    host.innerHTML=rooms.map(r=>{
      const muted=isRoomMuted(r.id);
      return `<div class="list-item"><label class="cm-check"><input type="checkbox" data-cm-pick="${esc(r.id)}" ${state.cmSel.has(r.id)?'checked':''}></label><div class="grow"><div class="title"><span class="room-icon-inline">${roomIconHtml(r)}</span> ${esc(r.name||'채팅방')}${isRoomPinned(r.id)?' <span class="admin-chip">고정</span>':''}</div><div class="meta">${(r.memberIds||[]).length}명${r.createdBy===uid()?' · 내가 만든 방':''}${muted?' · 알림 꺼짐':''}</div></div><button type="button" class="soft-btn" style="flex:0 0 44px" data-action="room-pin" data-room-id="${esc(r.id)}" title="상단 고정">${isRoomPinned(r.id)?'📌':'📍'}</button><button type="button" class="soft-btn" style="flex:0 0 84px" data-action="mute-room" data-room-id="${esc(r.id)}">${muted?'알림 켜기':'알림 끄기'}</button></div>`;
    }).join('')||'<div class="empty-side">채팅방이 없어요.</div>';
  }
  function openGroupManager(){
    state.groupDraft=groupOrderList().map(n=>({orig:n,name:n}));
    openModal(`<h2>목록 탭 관리</h2>
      <div class="field"><label>새 탭 만들기</label><div class="row"><input id="newGroupName" class="input" maxlength="12" placeholder="예: 컴퓨터"><button type="button" class="soft-btn" style="flex:0 0 78px" data-action="group-add">추가</button></div></div>
      <div id="groupDraftList" class="settings-list"></div>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" data-action="save-group-map">저장하기</button></div>`);
    renderGroupDraft();
  }
  function renderGroupDraft(){
    const host=$('#groupDraftList'); if(!host) return;
    const rows=state.groupDraft||[];
    host.innerHTML=rows.length?rows.map((g,i)=>`<div class="setting-row"><div class="grow"><input class="input" maxlength="12" value="${esc(g.name)}" data-group-name="${i}" placeholder="탭 이름"></div><div class="group-row-btns"><button type="button" class="soft-btn" data-action="group-up" data-i="${i}" ${i===0?'disabled':''}>↑</button><button type="button" class="soft-btn" data-action="group-down" data-i="${i}" ${i===rows.length-1?'disabled':''}>↓</button><button type="button" class="soft-btn" data-action="group-del" data-i="${i}">삭제</button></div></div>`).join('')
      :'<div class="empty-side">탭이 없어요. 새 탭을 만들어 보세요.</div>';
  }
  function syncGroupDraftInputs(){
    $$('#groupDraftList [data-group-name]').forEach(i=>{const idx=Number(i.dataset.groupName);if(state.groupDraft?.[idx])state.groupDraft[idx].name=i.value.trim();});
  }
  function groupAdd(){
    const inp=$('#newGroupName'); const name=(inp?.value||'').trim();
    if(!name) return toast('탭 이름을 적어 주세요.');
    syncGroupDraftInputs();
    if((state.groupDraft||[]).some(g=>g.name===name)) return toast('같은 이름의 탭이 이미 있어요.');
    state.groupDraft.push({orig:'',name});
    if(inp) inp.value='';
    renderGroupDraft();
  }
  function groupMove(i,dir){
    syncGroupDraftInputs();
    const rows=state.groupDraft; const j=i+dir;
    if(!rows||!rows[i]||!rows[j]) return;
    const t=rows[i]; rows[i]=rows[j]; rows[j]=t;
    renderGroupDraft();
  }
  function groupDelete(i){
    syncGroupDraftInputs();
    const rows=state.groupDraft; if(!rows||!rows[i]) return;
    if(rows[i].orig==='개인') return toast('개인 탭은 기본이라 지울 수 없어요.');
    rows.splice(i,1);
    renderGroupDraft();
  }
  async function saveGroupMap(){
    syncGroupDraftInputs();
    const rows=(state.groupDraft||[]).filter(r=>r.name);
    const names=[]; rows.forEach(r=>{if(!names.includes(r.name))names.push(r.name);});
    if(!names.length) return toast('탭을 하나 이상 남겨 주세요.');
    if(!names.includes('개인')) names.push('개인');
    const old=groupOrderList();
    const renames={}; rows.forEach(r=>{if(r.orig&&r.orig!==r.name)renames[r.orig]=r.name;});
    const removed=old.filter(g=>!names.includes(g)&&!renames[g]);
    const map={...(state.settings.roomGroups||{})};
    state.rooms.forEach(r=>{
      const g=roomGroup(r);
      if(renames[g]) map[r.id]=renames[g];
      else if(removed.includes(g)) map[r.id]='개인';
    });
    Object.keys(map).forEach(k=>{if(!names.includes(map[k]))delete map[k];});
    state.settings.roomGroups=map;
    state.groupNames=names;
    state.groupDraft=null;
    await persistGroups();
    closeModal(); renderRooms();
    toast(removed.length?'탭을 정리했어요.':'목록 탭을 저장했어요.');
  }

  function renderAdminPanel(tab){
    const p=$('#adminPanel'); if(!p) return;
    if(tab) state.adminTab=tab;
    const allowed=adminTabs().map(t=>t[0]);
    if(!allowed.includes(state.adminTab)) state.adminTab=allowed[0];
    $$('.admin-tabs .tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===state.adminTab));
    setTimeout(()=>{ try{ const t=document.querySelector('.admin-tabs'); if(t) updateTabsIndicator(t); }catch(e){} },30);
    if(state.adminTab==='school')return renderSchoolAdmin(p);
    if(state.adminTab==='landing')return renderLandingAdmin(p);
    if(state.adminTab==='sitenotice')return renderSiteNoticeAdmin(p);
    if(state.adminTab==='pages')return renderPagesAdmin(p);
    if(state.adminTab==='chat')return renderChatAdmin(p);
    if(state.adminTab==='sharereq')return renderShareRequests(p);
    if(state.adminTab==='reports')return renderReports(p);
    if(state.adminTab==='modappeals')return renderModAppeals(p);
    if(state.adminTab==='appeals')return renderAppeals(p);
    if(state.adminTab==='popup')return renderNoticeAdmin(p);
    if(state.adminTab==='users')return renderUsersAdmin(p);
    if(state.adminTab==='teachers')return renderTeachersAdmin(p);
    if(state.adminTab==='cross')return renderCrossAdmin(p);
    if(state.adminTab==='rooms')return renderRoomsAdmin(p);
    if(state.adminTab==='roles')return renderRolesAdmin(p);
    if(state.adminTab==='suggest')return renderSuggestHandler(p);
    if(state.adminTab==='notice'){ renderNoticeRoomsAdmin(p).then(()=>renderSchedCard(p)).catch(()=>{}); return; }
    if(state.adminTab==='licenses')return renderLicensesAdmin(p);
    if(state.adminTab==='refunds')return renderRefundsAdmin(p);
    if(state.adminTab==='pricing')return renderPricingAdmin(p);
    if(state.adminTab==='license')return renderLicenseRedeem(p);
    if(state.adminTab==='members')return renderMembersAdmin(p);
  }
  // ---------- 이용권(라이선스) · 환불 구성틀 ----------
  // licenses/{16자리코드}: {authCode, type, days, price, status, schoolId, purchasedBy, purchaseAt, activatedAt, expiresAt, memo}
  // licenseRefunds/{autoId}: {code, amount, reason, requestedBy, requestedAt, status, note}
  // status: issued(미사용) · active(이용중) · refunded(환불폐기) · revoked(강제회수) · expired
  function licenseStatusLabel(s){
    return s==='active'?'이용 중':s==='refunded'?'환불·폐기':s==='revoked'?'회수됨':s==='expired'?'만료':'미사용';
  }
  function licenseExpiryText(l){
    if(!l) return '-';
    if(l.status==='refunded'||l.status==='revoked') return '폐기됨';
    if(!(l.days>0)) return '무제한';
    if(l.expiresAt) return fmtDateTime(l.expiresAt);
    return `미개시 · ${l.days}일권`;
  }
  async function issueLicense(typeId, price, memo){
    if(!isAdmin()) return toast('총관리자만 발급할 수 있어요.');
    const days=licenseDaysOf(typeId);
    for(let t=0;t<5;t++){
      const code=genLicenseCode(16), authCode=genLicenseCode(8);
      try{
        const ref=db.collection('licenses').doc(code);
        const ex=await ref.get();
        if(ex.exists) continue;
        await ref.set({ code, authCode, type:typeId, days, price:Number(price)||0, status:'issued', schoolId:'', purchasedBy:uid(), purchasedByName:state.profile?.displayName||'', purchaseAt:ts(), activatedAt:null, expiresAt:null, memo:String(memo||'').slice(0,200), createdAt:ts(), updatedAt:ts() });
        return { code, authCode };
      }catch(e){ if(t===4) throw e; }
    }
    throw new Error('code-gen-failed');
  }
  function openLicenseIssueModal(){
    if(!isAdmin()) return toast('총관리자만 발급할 수 있어요.');
    const hasPw=(auth.currentUser?.providerData||[]).some(p=>p.providerId==='password');
    openModal(`<h2>이용권 발급</h2><p class="desc">종류(1일·10일·1년·무제한)를 고르고 비밀번호로 확인하면 16자리 고유코드+인증코드가 만들어져요.</p>
      <div class="field"><label>종류</label><div class="custom-select"><button type="button" class="select-button" data-select-open="licType"><span data-selected="licType" data-value="free_10d">무료 10일</span><span>⌄</span></button></div></div>
      <div class="field"><label>금액 (원 · 유료만)</label><input id="licPrice" class="input" inputmode="numeric" placeholder="0"></div>
      <div class="field"><label>메모</label><input id="licMemo" class="input" placeholder="예: ○○초 체험용"></div>
      ${hasPw?'<div class="field"><label>비밀번호 확인 (필수)</label><input id="licPw" class="input" type="password" autocomplete="current-password" placeholder="지금 쓰는 비밀번호"></div>':'<div class="warn-box">Google 로그인 계정은 발급 확인을 위해 Google 재인증이 필요해요.</div>'}
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="licGo">발급하기</button></div>`);
    const tb=$('[data-select-open="licType"]');
    if(tb) wireDropdown(tb, LICENSE_TYPES.map(t=>({value:t.id,label:t.label})), (v,l)=>{ tb.querySelector('[data-selected]').textContent=l; tb.querySelector('[data-selected]').dataset.value=v; });
    $('#licGo').onclick=()=>runAsync(async()=>{
      const type=$('[data-selected="licType"]')?.dataset.value||'free_10d';
      const price=Number(($('#licPrice')?.value||'').replace(/[^0-9]/g,''))||0;
      const memo=$('#licMemo')?.value||'';
      try{
        if(hasPw){
          const pw=$('#licPw')?.value||'';
          if(!pw) return toast('비밀번호를 입력해 주세요.');
          const cred=firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, pw);
          await auth.currentUser.reauthenticateWithCredential(cred);
        } else {
          const provider=new firebase.auth.GoogleAuthProvider();
          await auth.currentUser.reauthenticateWithPopup(provider);
        }
      }catch(e){ return toast('본인 확인에 실패했어요.'); }
      try{
        const r=await issueLicense(type, price, memo);
        openModal(`<h2>발급 완료</h2><p class="desc">아래 두 코드를 함께 전달해야 등록할 수 있어요. 인증코드까지 일치해야 정보가 뜹니다.</p>
          <div class="code-box">${esc(r.code)}</div>
          <p class="desc">인증코드: <b class="code-chip">${esc(r.authCode)}</b> · ${esc(licenseTypeLabel(type))}</p>
          <div class="modal-actions"><button type="button" class="cancel" data-action="copy-license" data-code="${esc(r.code)}" data-auth="${esc(r.authCode)}">복사</button><button type="button" class="confirm" data-close-modal>닫기</button></div>`);
      }catch(e){ console.error(e); toast(errText(e)); }
    });
  }
  function openLicenseBuyModal(){
    // 실결제 연동 전 모의 구매: 1년 단위, 코드는 계정에 바로 들어가지 않고 코드로 발급
    openModal(`<h2>1년 이용권 구매 (준비 중)</h2><p class="desc">실결제 연동 전이라 결제는 되지 않고 구성만 보여줘요. 구매하면 고유코드+인증코드가 발급돼요.</p>
      <div class="list-item"><div class="grow"><div class="title">학교 1년 이용권</div><div class="meta">이용개시일로부터 1년 · 금액 미정</div></div><span>1년</span></div>
      <div class="field" style="margin-top:12px"><label>금액</label><input id="buyPrice" class="input" inputmode="numeric" placeholder="금액 미정 (예: 99000)"></div>
      <label class="consent" style="margin-top:12px"><input type="checkbox" id="buyAgree"><span>${esc(DIGITAL_VOUCHER_NOTICE)}</span></label>
      <label class="consent"><input type="checkbox" id="buyPrivacy"><span>이용권·환불 안내와 개인정보 처리방침에 동의해요.</span></label>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="buyGo">구매하고 코드 받기</button></div>`);
    $('#buyGo').onclick=()=>runAsync(async()=>{
      if(!$('#buyAgree')?.checked) return toast('디지털 이용권 안내에 동의해 주세요.');
      if(!$('#buyPrivacy')?.checked) return toast('이용권·환불 안내에 동의해 주세요.');
      const price=Number(($('#buyPrice')?.value||'').replace(/[^0-9]/g,''))||0;
      try{
        const r=await issueLicense('paid_1y', price, '모의구매');
        openModal(`<h2>구매 완료 (모의)</h2><p class="desc">아래 코드를 학교 관리자 계정에서 등록하고 이용 시작을 눌러야 1년이 시작돼요.</p>
          <div class="code-box">${esc(r.code)}</div><p class="desc">인증코드: <b class="code-chip">${esc(r.authCode)}</b></p>
          <div class="modal-actions"><button type="button" class="cancel" data-action="copy-license" data-code="${esc(r.code)}" data-auth="${esc(r.authCode)}">복사</button><button type="button" class="confirm" data-close-modal>닫기</button></div>`);
      }catch(e){ console.error(e); toast(errText(e)); }
    });
  }
  const LICENSE_TABS = [['all','전체'],['issued','이용전'],['active','이용중'],['recalled','회수됨'],['expired','만료됨']];
  function licenseGroup(l){
    const s=l?.status||'issued';
    if(s==='active') return 'active';
    if(s==='expired') return 'expired';
    if(s==='refunded'||s==='revoked') return 'recalled';
    return 'issued';
  }
  function licenseTabLabel(f){ return (LICENSE_TABS.find(t=>t[0]===f)||[])[1]||'전체'; }
  function paintLicenseList(){
    const host=$('#licenseList'); if(!host) return;
    const rows=Array.isArray(state.licenseCache)?state.licenseCache:[];
    if(!(state.licenseSel instanceof Set)) state.licenseSel=new Set();
    const f=state.licenseFilter||'all';
    const q=String(state.licenseQuery||'').trim().toUpperCase();
    const counts={ all:rows.length, issued:0, active:0, recalled:0, expired:0 };
    rows.forEach(d=>{ counts[licenseGroup(d)]=(counts[licenseGroup(d)]||0)+1; });
    $$('#licenseTabs .tab').forEach(x=>{
      const k=x.dataset.filter||'all';
      x.classList.toggle('active',k===f);
      x.textContent=`${licenseTabLabel(k)}${counts[k]!=null?` (${counts[k]})`:''}`;
    });
    const list=rows.filter(l=>{
      if(f!=='all' && licenseGroup(l)!==f) return false;
      if(!q) return true;
      const hay=[l.code||l.id,l.authCode,l.schoolId,l.purchasedByName,l.purchasedBy,l.activatedBy,l.memo,licenseTypeLabel(l.type),licenseStatusLabel(l.status)].map(v=>String(v||'').toUpperCase()).join(' ');
      return q.split(/\s+/).every(w=>w&&hay.includes(w));
    });
    if(!list.length){ host.innerHTML='<div class="empty-side">해당 이용권이 없어요.</div>'; return; }
    host.innerHTML=list.map(l=>{
      const code=l.id||l.code||'';
      const deletable=['refunded','revoked','expired'].includes(l.status);
      const checked=state.licenseSel.has(code)?' checked':'';
      const issuer=l.purchasedByName||l.issuedByName||'';
      const issuerUid=l.purchasedBy||l.issuedBy||l.createdBy||'';
      const issuerText=issuer?`${issuer}${issuerUid?` · ${String(issuerUid).slice(0,8)}…`:''}`:(issuerUid?`uid ${String(issuerUid).slice(0,8)}…`:'기록 없음');
      return `<div class="list-item"><input type="checkbox" data-action="license-toggle" data-code="${esc(code)}"${checked} ${deletable?'':'disabled'} title="${deletable?'회수·만료된 이용권만 지울 수 있어요':'이용 중·미사용 이용권은 지울 수 없어요'}"><div class="grow"><div class="title">${esc(l.code||l.id)} · ${esc(licenseTypeLabel(l.type))} · ${esc(licenseStatusLabel(l.status))}</div><div class="meta">인증 ${esc(l.authCode||'-')} · ${esc(licenseExpiryText(l))} · ${l.price?Number(l.price).toLocaleString()+'원':'무료'}${l.schoolId?` · 학교 ${esc(l.schoolId)}`:''}</div><div class="admin-meta"><span class="admin-chip">발급 ${esc(issuerText)}</span>${l.memo?`<span class="admin-chip">${esc(String(l.memo).slice(0,20))}</span>`:''}<span class="admin-chip">${esc(fmtDateTime(l.purchaseAt||l.createdAt))}</span></div></div><span style="display:flex;gap:6px;flex:0 0 auto"><button class="soft-btn" style="flex:0 0 64px" data-action="license-revoke" data-code="${esc(code)}">회수</button>${deletable?`<button class="soft-btn" style="flex:0 0 64px;color:var(--danger)" data-action="license-delete" data-code="${esc(code)}">삭제</button>`:''}</span></div>`;
    }).join('');
  }
  async function deleteLicense(code){
    if(!isAdmin()) return toast('총관리자만 지울 수 있어요.');
    try{
      const d=await db.collection('licenses').doc(code).get();
      const st=d.exists?(d.data().status||'issued'):'';
      if(d.exists && !['refunded','revoked','expired'].includes(st)) return toast('회수·만료된 이용권만 지울 수 있어요.');
      await db.collection('licenses').doc(code).delete();
      state.licenseCache=(state.licenseCache||[]).filter(l=>(l.id||l.code)!==code);
      if(state.licenseSel instanceof Set) state.licenseSel.delete(code);
      paintLicenseList();
      toast('이용권을 지웠어요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function deleteLicenses(codes){
    if(!isAdmin()) return toast('총관리자만 지울 수 있어요.');
    let n=0;
    for(const code of (codes||[])){
      try{
        const d=await db.collection('licenses').doc(code).get();
        const st=d.exists?(d.data().status||'issued'):'';
        if(d.exists && !['refunded','revoked','expired'].includes(st)) continue;
        await db.collection('licenses').doc(code).delete();
        n++;
      }catch(e){ console.error('license del', code, e); }
    }
    state.licenseCache=(state.licenseCache||[]).filter(l=>![...(state.licenseSel||new Set())].includes(l.id||l.code));
    state.licenseSel=new Set();
    paintLicenseList();
    toast(`${n}개 이용권을 지웠어요. (자동 삭제는 하지 않아요)`);
  }
  function renderLicensesAdmin(p){
    if(!isAdmin()){ p.innerHTML='<div class="empty-side">총관리자만 볼 수 있어요.</div>'; return; }
    if(!state.licenseFilter) state.licenseFilter='all';
    if(state.licenseQuery==null) state.licenseQuery='';
    if(!(state.licenseSel instanceof Set)) state.licenseSel=new Set();
    p.innerHTML=`<div class="admin-card"><h3>이용권</h3><p class="desc">16자리 고유코드+인증코드. 1년 단위 유료와 1일·10일·1년·무제한 무료를 발급해요. 발급 시 비밀번호가 반드시 필요해요.<br>회수·만료된 이용권만 직접 지울 수 있어요. 자동 삭제는 하지 않아요.</p>
      <div class="admin-toolbar"><button class="soft-btn" data-action="license-issue">+ 이용권 발급</button><button class="soft-btn" data-action="license-buy">모의 구매창</button><button class="soft-btn" data-action="license-select-all">회수·만료 전체선택</button><button class="soft-btn" data-action="license-select-none">선택해제</button><button class="soft-btn" data-action="license-delete-selected">선택 삭제</button></div>
      <div class="tabs" id="licenseTabs" style="margin-bottom:12px">${LICENSE_TABS.map(([v])=>`<button class="tab" data-action="license-tab" data-filter="${v}">${licenseTabLabel(v)}</button>`).join('')}</div>
      <div class="admin-toolbar"><input id="licenseSearch" class="input" placeholder="고유코드·인증코드·학교·발급자·메모로 검색" value="${esc(state.licenseQuery||'')}"></div>
      <div id="licenseList" class="list"><div class="empty-side">불러오는 중…</div></div></div>`;
    $('#licenseSearch')?.addEventListener('input',e=>{ state.licenseQuery=e.target.value; paintLicenseList(); });
    renderLicenseAdjust($('#adminPanel'));
    runAsync(async()=>{
      const host=$('#licenseList'); if(!host) return;
      try{
        const s=await db.collection('licenses').orderBy('createdAt','desc').limit(200).get();
        state.licenseCache=s.docs.map(d=>({id:d.id,...d.data()}));
        paintLicenseList();
        if(!s.empty) return;
        host.innerHTML='<div class="empty-side">아직 발급된 이용권이 없어요.</div>';
      }catch(e){ host.innerHTML='<div class="empty-side">불러오지 못했어요. 규칙을 확인해 주세요.</div>'; }
    });
  }
  // ---------- 학교 이용권 일수 조정 (총관리자만 · 5초 확인) ----------
  async function renderLicenseAdjust(host){
    if(!isAdmin()||!host) return;
    if($('#licenseAdjustCard')) return;
    const wrap=document.createElement('div');
    wrap.innerHTML=`<div class="admin-card" id="licenseAdjustCard"><h3>학교 이용권 일수 조정</h3><p class="desc">학교의 이용 기간을 직접 늘리거나 줄여요. 줄여서 오늘보다 과거가 되면 즉시 만료돼요.</p>
      <div class="admin-toolbar"><select id="licSchool" class="input"><option value="">학교를 골라 주세요</option></select><input id="licDays" class="input" type="number" style="flex:0 0 110px" placeholder="일수" value="30"><button type="button" class="soft-btn" style="flex:0 0 96px" data-action="license-days-plus">늘리기</button><button type="button" class="soft-btn" style="flex:0 0 96px" data-action="license-days-minus">줄이기</button></div>
      <div id="licSchoolInfo" class="mini muted"></div></div>`;
    const list=$('#licenseList',host); if(list) list.before(wrap.firstElementChild); else host.prepend(wrap.firstElementChild);
    try{
      const s=await db.collection('schools').limit(200).get();
      const sel=$('#licSchool'); if(!sel) return;
      sel.innerHTML='<option value="">학교를 골라 주세요</option>'+s.docs.map(d=>{ const v=d.data()||{}; return `<option value="${esc(d.id)}">${esc(v.name||d.id)}</option>`; }).join('');
      sel.onchange=async()=>{
        const info=$('#licSchoolInfo'); if(!info) return;
        if(!sel.value){ info.textContent=''; return; }
        try{
          const d=await db.collection('schools').doc(sel.value).get();
          const v=d.exists?(d.data()||{}):{};
          const ms=(v.licenseExpiresAt&&v.licenseExpiresAt.toDate)?v.licenseExpiresAt.toDate().getTime():(typeof v.licenseExpiresAt==='number'?v.licenseExpiresAt:0);
          info.textContent=`현재: ${v.licenseStatus||'없음'} · 만료 ${ms?fmtDateTime(v.licenseExpiresAt):'-'}`;
        }catch(e){ info.textContent=''; }
      };
    }catch(e){}
  }
  async function adjustSchoolLicense(deltaSign){
    if(!isAdmin()) return;
    const sid=$('#licSchool')?.value||'';
    const days=Math.abs(Math.round(Number($('#licDays')?.value||0)));
    if(!sid) return toast('학교를 골라 주세요.');
    if(!(days>0)) return toast('일수를 적어 주세요.');
    let cur=null;
    try{ const s=await db.collection('schools').doc(sid).get(); if(s.exists) cur=s.data()||null; }catch(e){ return toast(errText(e)); }
    const curMs=(cur?.licenseExpiresAt&&cur.licenseExpiresAt.toDate)?cur.licenseExpiresAt.toDate().getTime():(typeof cur?.licenseExpiresAt==='number'?cur.licenseExpiresAt:0);
    const base=Math.max(Date.now(),curMs||0);
    const next=new Date(base+deltaSign*days*86400000);
    openDangerConfirm({
      title:`이용권을 ${days}일 ${deltaSign>0?'늘릴까요':'줄일까요'}?`,
      desc:`${esc(cur?.name||sid)} · 변경 후 만료일: ${next.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})}. 줄여서 오늘이 지나면 즉시 만료돼요.`,
      requireText:'', seconds:5, confirmLabel:deltaSign>0?'늘리기':'줄이기',
      checkLabel:'위 내용을 이해했고, 변경해도 됩니다.',
      onConfirm: async ()=>{
        try{ await db.collection('schools').doc(sid).set({licenseStatus:'active',licenseExpiresAt:firebase.firestore.Timestamp.fromMillis(next.getTime()),updatedAt:ts()},{merge:true}); }
        catch(e){ console.error(e); toast(errText(e)); return; }
        toast(`이용권을 ${days}일 ${deltaSign>0?'늘렸어요':'줄였어요'}.`);
        try{ await logAdminAudit('license-days',`${cur?.name||sid} ${deltaSign>0?'+':''}${deltaSign*days}일`,null); }catch(e){}
        renderLicenseAdjustRefresh();
      }
    });
  }
  async function renderLicenseAdjustRefresh(){
    try{
      const sel=$('#licSchool'); const sid=sel?.value||'';
      if(sid){ const d=await db.collection('schools').doc(sid).get(); const v=d.exists?(d.data()||{}):{}; const info=$('#licSchoolInfo'); if(info) info.textContent=`현재: ${v.licenseStatus||'없음'} · 만료 ${v.licenseExpiresAt?fmtDateTime(v.licenseExpiresAt):'-'}`; }
    }catch(e){}
  }
  function renderLicenseRedeem(p){
    const sid=state.profile?.schoolId||'';
    p.innerHTML=`<div class="admin-card"><h3>이용권 등록</h3><p class="desc">학교 관리자 계정에서 고유코드+인증코드를 입력하면 이용권 정보가 떠요. 이용 시작을 눌러야 이용개시일부터 기산돼요.</p>
      <div class="field"><label>고유코드 (16자리)</label><input id="rdCode" class="input code-input" placeholder="예: AB12CD34EF56GH78" maxlength="16"></div>
      <div class="field"><label>인증코드</label><input id="rdAuth" class="input code-input" placeholder="8자리" maxlength="8"></div>
      <div class="admin-toolbar"><button class="soft-btn" id="rdCheck">정보 확인</button><button class="soft-btn" data-action="refund-request">환불 요청</button></div>
      <div id="rdInfo"></div></div>`;
    $('#rdCheck').onclick=()=>runAsync(async()=>{
      const code=($('#rdCode')?.value||'').trim().toUpperCase(), auth=($('#rdAuth')?.value||'').trim().toUpperCase();
      const host=$('#rdInfo'); if(!host) return;
      if(code.length!==16) return toast('고유코드 16자리를 입력해 주세요.');
      if(!auth) return toast('인증코드를 입력해 주세요.');
      try{
        const d=await db.collection('licenses').doc(code).get();
        if(!d.exists) return toast('코드를 확인해 주세요.');
        const l={id:d.id,...d.data()};
        if(String(l.authCode||'').toUpperCase()!==auth) return toast('인증코드가 맞지 않아요.');
        if(l.status && l.status!=='issued'){ host.innerHTML=`<div class="warn-box">이미 쓰인 이용권이에요. (${esc(licenseStatusLabel(l.status))})</div>`; return; }
        host.innerHTML=`<div class="list-item"><div class="grow"><div class="title">${esc(licenseTypeLabel(l.type))} · ${l.days?l.days+'일':'무제한'}</div><div class="meta">고유 ${esc(l.code)} · 미사용 · ${l.price?Number(l.price).toLocaleString()+'원':'무료'}</div></div></div>
          <label class="consent" style="margin-top:12px"><input type="checkbox" id="rdAgree"><span>${esc(DIGITAL_VOUCHER_NOTICE)}</span></label>
          <div class="admin-toolbar"><button class="soft-btn" id="rdStart">이용 시작</button></div>`;
        $('#rdStart').onclick=()=>{
          if(!$('#rdAgree')?.checked) return toast('안내에 동의해 주세요.');
          if(!sid) return toast('학교 정보가 없어요.');
          const panel=openModal(`<h2>이용을 시작할까요?</h2><p class="desc">이용을 시작하시면 취소할 수 없고 환불이 불가능해요.<br>${esc(licenseTypeLabel(l.type))} · 고유 ${esc(l.code)} · ${l.days?l.days+'일':'무제한'}</p>
            <label class="consent"><input type="checkbox" id="rdConfirmCheck"><span>위 내용을 이해했고, 이용 시작에 동의해요. (취소·환불 불가)</span></label>
            <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="rdGo" data-label="이용 시작">이용 시작</button></div>`, {small:true, dismissible:false});
          const go=panel.querySelector('#rdGo');
          wireCountdownButton(go, 5, '이용 시작');
          go.onclick=()=>runAsync(async()=>{
            if(go.disabled) return;
            if(!panel.querySelector('#rdConfirmCheck')?.checked) return toast('동의에 체크해 주세요.');
            const now=new Date();
            const expires=(l.days>0)?firebase.firestore.Timestamp.fromMillis(now.getTime()+l.days*86400000):null;
            try{
              await db.collection('licenses').doc(code).update({ status:'active', schoolId:sid, activatedBy:uid(), activatedAt:ts(), expiresAt:expires, updatedAt:ts() });
              await db.collection('schools').doc(sid).set({ licenseCode:code, licenseStatus:'active', licenseActivatedAt:ts(), licenseExpiresAt:expires, updatedAt:ts() }, {merge:true});
              closeAllModals();
              toast('이용이 시작됐어요.');
              try{ await refreshSchoolLicense(); }catch(e){}
              renderAdminPanel();
            }catch(e){ console.error(e); toast(errText(e)); }
          });
        };
      }catch(e){ console.error(e); toast(errText(e)); }
    });
  }
  function renderMembersAdmin(p){
    // 학교 관리자용 구성원 목록 틀 (같은 학교만, 규칙은 mySchool 기준 · 탈퇴 계정은 제외)
    p.innerHTML=`<div class="admin-card"><h3>구성원</h3><p class="desc">우리 학교 계정 목록이에요. 이름을 누르면 타임아웃·학교에서 제거·권한 변경(학생↔교사)을 할 수 있어요.</p><div id="memberList" class="list"><div class="empty-side">불러오는 중…</div></div></div>`;
    runAsync(async()=>{
    const host=$('#memberList'); if(!host) return;
    host.innerHTML=loadingShimmer(5);
      try{
        const sid=state.profile?.schoolId||'';
        if(!sid){ host.innerHTML='<div class="empty-side">학교 정보가 없어요.</div>'; return; }
        const s=await db.collection('users').where('schoolId','==',sid).limit(100).get();
        const rows=s.docs.map(d=>({id:d.id,...(d.data()||{})})).filter(u=>!u.deleted);
        host.innerHTML=rows.map(u=>`<button class="list-item tappable" data-action="user-profile" data-uid="${esc(u.id)}" data-name="${esc(u.displayName||'사용자')}"><div class="grow"><div class="title">${esc(u.displayName||'사용자')} · ${esc(roleLabel(u.role))}</div><div class="meta">${esc(u.email||'')}</div></div><span>›</span></button>`).join('')||'<div class="empty-side">구성원이 없어요.</div>';
      }catch(e){ host.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; }
    });
  }
  function paintRefundList(){
    const host=$('#refundList'); if(!host) return;
    const rows=Array.isArray(state.refundCache)?state.refundCache:[];
    if(!(state.refundSel instanceof Set)) state.refundSel=new Set();
    if(!rows.length){ host.innerHTML='<div class="empty-side">환불 요청이 없어요.</div>'; return; }
    host.innerHTML=rows.map(r=>{
      const checked=state.refundSel.has(r.id)?' checked':'';
      return `<div class="list-item"><input type="checkbox" data-action="refund-toggle" data-id="${esc(r.id)}"${checked}><div class="grow"><div class="title">${esc(r.code||'')} · ${r.amount?Number(r.amount).toLocaleString()+'원':'-'} · ${esc(refundStatusLabel(r.status))}</div><div class="meta">${esc(r.reason||'')}</div><div class="admin-meta"><span class="admin-chip">${esc(r.requestedByEmail||r.requestedBy||'')}</span>${r.schoolName?`<span class="admin-chip">${esc(r.schoolName)}</span>`:r.schoolId?`<span class="admin-chip">학교 ${esc(r.schoolId)}</span>`:''}<span class="admin-chip">${esc(fmtDateTime(r.requestedAt||r.createdAt))}</span></div></div><span style="display:flex;gap:6px;flex:0 0 auto"><button class="soft-btn" style="flex:0 0 64px" data-action="refund-check" data-id="${esc(r.id)}" data-code="${esc(r.code||'')}">검증</button><button class="soft-btn" style="flex:0 0 78px" data-action="refund-done" data-id="${esc(r.id)}">처리 완료</button><button class="soft-btn" style="flex:0 0 64px;color:var(--danger)" data-action="refund-delete" data-id="${esc(r.id)}">삭제</button></span><span style="display:none" data-refund-check="${esc(r.id)}"></span></div>`;
    }).join('');
  }
  function renderRefundsAdmin(p){
    if(!isAdmin()){ p.innerHTML='<div class="empty-side">총관리자만 볼 수 있어요.</div>'; return; }
    if(!(state.refundSel instanceof Set)) state.refundSel=new Set();
    p.innerHTML=`<div class="admin-card"><h3>환불 요청</h3><p class="desc">사람이 직접 확인해요. 코드 미사용 + 구매 후 7일 이내면 전액 환불, 환불된 코드는 폐기돼요. 이미 쓰인 코드면 안내가 떠요.<br>요청자는 이메일로, 학교도 함께 보여요. 검증 옆 처리 완료로 진행 상태를 표시하고, 목록에서 직접 지울 수 있어요. (자동 삭제 없음)</p><div class="admin-toolbar"><button class="soft-btn" data-action="refund-select-all">전체선택</button><button class="soft-btn" data-action="refund-select-none">선택해제</button><button class="soft-btn" data-action="refund-delete-selected">선택 삭제</button></div><div id="refundList" class="list"><div class="empty-side">불러오는 중…</div></div></div>`;
    runAsync(async()=>{
      const host=$('#refundList'); if(!host) return;
      try{
        const s=await db.collection('licenseRefunds').orderBy('requestedAt','desc').limit(100).get();
        state.refundCache=s.docs.map(d=>({id:d.id,...d.data()}));
        paintRefundList();
      }catch(e){ host.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; }
    });
  }
  async function markRefundDone(id){
    if(!isAdmin()||!id) return;
    try{
      await db.collection('licenseRefunds').doc(id).update({ status:'done', handledBy:uid(), handledAt:ts() });
      state.refundCache=(state.refundCache||[]).map(r=>r.id===id?{...r,status:'done'}:r);
      paintRefundList();
      toast('처리 완료로 표시했어요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function deleteRefund(id){
    if(!isAdmin()||!id) return;
    try{
      await db.collection('licenseRefunds').doc(id).delete();
      state.refundCache=(state.refundCache||[]).filter(r=>r.id!==id);
      if(state.refundSel instanceof Set) state.refundSel.delete(id);
      paintRefundList();
      toast('환불 요청을 지웠어요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function deleteRefunds(ids){
    if(!isAdmin()) return;
    let n=0;
    for(const id of (ids||[])){
      try{ await db.collection('licenseRefunds').doc(id).delete(); n++; }catch(e){ console.error('refund del', id, e); }
    }
    state.refundCache=(state.refundCache||[]).filter(r=>![...(state.refundSel||new Set())].includes(r.id));
    state.refundSel=new Set();
    paintRefundList();
    toast(`${n}개 요청을 지웠어요.`);
  }
  function renderPricingAdmin(p){
    if(!isAdmin()){ p.innerHTML='<div class="empty-side">총관리자만 볼 수 있어요.</div>'; return; }
    const c=landingCfg();
    p.innerHTML=`<div class="admin-card"><h3>요금 안내</h3><p class="desc">소개페이지에 separately 뜨는 요금표예요. 금액 미정 상태로 틀만 공개돼요.</p>
      <div class="field"><label>제목</label><input id="prTitle" class="input" value="${esc(c.pricingTitle||'요금 안내')}"></div>
      <div class="field"><label>설명</label><input id="prDesc" class="input" value="${esc(c.pricingDesc||'')}"></div>
      <div class="field"><label>요금표 (이름 | 기간 | 금액 | 설명 · 줄바꿈 구분)</label><textarea id="prPlans" class="input" rows="5" placeholder="학교 1년 이용권 | 1년 | 금액 미정 | ...">${esc((c.pricing||[]).map(x=>[x.name,x.period,x.price,x.desc].join(' | ')).join('\n'))}</textarea></div>
      <div class="admin-toolbar"><button class="soft-btn" id="prSave">저장</button></div></div>`;
    $('#prSave').onclick=()=>runAsync(async()=>{
      const plans=($('#prPlans')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,4).map(s=>{
        const [name,period,price,desc]=s.split('|').map(x=>(x||'').trim());
        return { name:(name||'').slice(0,30), period:(period||'').slice(0,20), price:(price||'').slice(0,20), desc:(desc||'').slice(0,160), cta:'문의하기' };
      });
      try{
        await db.collection('siteLanding').doc('main').set({ pricingTitle:$('#prTitle')?.value||'요금 안내', pricingDesc:$('#prDesc')?.value||'', pricing:plans, updatedAt:ts() }, {merge:true});
        toast('요금 안내를 저장했어요.');
      }catch(e){ console.error(e); toast(errText(e)); }
    });
  }
  function openRefundRequestModal(presetCode){
    // 환불 요청은 학교 관리자·총관리자만, 실존하는 이용권 코드에 한해 접수한다
    if(!(isAdmin()||isSchoolAdmin())) return toast('학교 관리자 계정으로 요청해 주세요.');
    const code0=String(presetCode||'').toUpperCase();
    openModal(`<h2>환불 요청</h2><p class="desc">코드 미사용 + 구매 후 7일 이내면 전액 환불돼요. 사람이 직접 확인해요.<br>실제로 발급된 코드가 아니면 요청을 보낼 수 없어요.</p>
      <div class="field"><label>고유코드 (실제 발급된 16자리만 가능)</label><input id="rfCode" class="input code-input" value="${esc(code0)}" maxlength="16" autocomplete="off"></div>
      <div class="field"><label>금액 (숫자만 입력, 자동으로 콤마)</label><input id="rfAmount" class="input" inputmode="numeric" placeholder="예: 99,000"></div>
      <div class="field"><label>사유</label><input id="rfReason" class="input" placeholder="예: 단순 변심 (미사용)"></div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="rfGo">요청하기</button></div>`);
    $('#rfGo').onclick=()=>runAsync(async()=>{
      const code=($('#rfCode')?.value||'').trim().toUpperCase();
      const amount=parseKRW($('#rfAmount')?.value||'');
      const reason=($('#rfReason')?.value||'').trim();
      if(code.length!==16) return toast('고유코드 16자리를 입력해 주세요.');
      if(!reason || reason.length<2) return toast('사유를 2자 이상 입력해 주세요.');
      const go=$('#rfGo'); if(go){ go.disabled=true; go.textContent='확인 중…'; }
      try{
        // 1) 실제 발급된 이용권인지 먼저 확인한다 (아무 코드나 요청 불가)
        let lic=null;
        try{ const d=await db.collection('licenses').doc(code).get(); if(d.exists) lic={id:d.id,...d.data()}; }
        catch(e){ console.error(e); return toast('이용권을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
        if(!lic) return toast('존재하지 않는 이용권 코드예요. 코드를 다시 확인해 주세요.');
        // 2) 남의 이용권에는 요청할 수 없다 (구매자·등록 학교·총관리자만)
        const mine=isAdmin() || lic.purchasedBy===uid() || lic.activatedBy===uid() || (lic.schoolId && lic.schoolId===(state.profile?.schoolId||''));
        if(!mine) return toast('이 이용권의 환불을 요청할 권한이 없어요.');
        // 3) 이미 접수된 요청이 있으면 중복 접수하지 않는다
        try{
          const dup=await db.collection('licenseRefunds').where('code','==',code).where('status','==','pending').limit(1).get();
          if(!dup.empty) return toast('이미 접수된 환불 요청이 있어요.');
        }catch(e){}
        await db.collection('licenseRefunds').add({ code, amount, reason, schoolId:lic.schoolId||state.profile?.schoolId||'', schoolName:state.profile?.schoolName||'', licenseType:lic.type||'', licenseStatus:lic.status||'issued', requestedBy:uid(), requestedByName:state.profile?.displayName||'', requestedByEmail:auth.currentUser?.email||state.profile?.email||'', requestedAt:ts(), status:'pending', createdAt:ts() });
        closeModal(); toast('환불 요청을 보냈어요.');
      }catch(e){ console.error(e); toast(errText(e)); }
      finally{ if(go){ go.disabled=false; go.textContent='요청하기'; } }
    });
  }
  async function checkRefundCode(code, refundId){
    try{
      const d=await db.collection('licenses').doc(code).get();
      if(!d.exists) return toast('코드를 확인해 주세요.');
      const l={id:d.id,...d.data()};
      if(l.status && l.status!=='issued'){ toast('이미 쓰인 이용권이에요.'); return; }
      const purchaseMs=docTs(l.purchaseAt||l.createdAt)||0;
      const over7=purchaseMs ? (Date.now()-purchaseMs>7*86400000) : false;
      const panel=openModal(`<h2>환불 검증</h2><p class="desc">${esc(code)} · ${esc(licenseTypeLabel(l.type))} · 미사용 확인됨 ${over7?'· 7일 초과':''}<br>환불·폐기하면 되돌릴 수 없어요. 돈과 연결된 작업이라 5초 뒤에 진행할 수 있어요.</p>
        <div class="modal-actions"><button type="button" class="cancel" data-close-modal>닫기</button><button type="button" class="confirm" id="rfOk" data-label="환불·폐기">환불·폐기</button></div>`);
      const go=panel.querySelector('#rfOk');
      wireCountdownButton(go, 5, '환불·폐기');
      go.onclick=()=>runAsync(async()=>{
        if(go.disabled) return;
        try{
          await db.collection('licenses').doc(code).update({ status:'refunded', updatedAt:ts() });
          if(refundId) await db.collection('licenseRefunds').doc(refundId).update({ status:'approved', handledBy:uid(), handledAt:ts() });
          closeAllModals(); toast('환불 처리하고 코드를 폐기했어요.'); renderAdminPanel();
        }catch(e){ console.error(e); toast(errText(e)); }
      });
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function forceRevokeLicense(code){
    if(!isAdmin()) return toast('총관리자만 회수할 수 있어요.');
    try{
      const d=await db.collection('licenses').doc(code).get();
      if(!d.exists) return toast('코드를 확인해 주세요.');
      const l=d.data()||{};
      const sid=l.schoolId||'';
      await db.collection('licenses').doc(code).update({ status:'revoked', updatedAt:ts() });
      if(sid){
        try{ await db.collection('schools').doc(sid).set({ licenseCode:'', licenseStatus:'revoked', updatedAt:ts() }, {merge:true}); }catch(e){}
      }
      toast('학교 권한을 회수하고 환불 처리했어요.');
      renderAdminPanel();
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  function richToolbarHtml(id){
    return `<div class="rich-toolbar" data-rich-toolbar="${id}"><button type="button" class="re-btn" data-cmd="bold" title="굵게"><b>B</b></button><button type="button" class="re-btn" data-cmd="italic" title="기울임"><i>I</i></button><button type="button" class="re-btn" data-cmd="underline" title="밑줄"><u>U</u></button><button type="button" class="re-btn" data-cmd="strikeThrough" title="취소선"><s>S</s></button><button type="button" class="re-btn" data-cmd="h2" title="제목">H</button><button type="button" class="re-btn" data-cmd="ul" title="목록">☰</button><button type="button" class="re-btn" data-cmd="hr" title="구분선">―</button><button type="button" class="re-btn" data-cmd="image" title="사진 넣기">🖼</button><label class="re-color" title="글자색"><input type="color" value="#3F9BFF" data-cmd-color="1"></label><button type="button" class="re-btn" data-cmd="createLink" title="링크">🔗</button><button type="button" class="re-btn" data-cmd="removeFormat" title="서식 지우기">⌫</button></div>`;
  }
  // 에디터 사진을 가볍게 줄여 data URL로 넣는다 (별도 서버 없이 페이지에 바로 저장)
  function compressImageToDataUrl(file, maxW=960, quality=0.72){
    return new Promise((res, rej)=>{
      try{
        const img=new Image();
        const url=URL.createObjectURL(file);
        img.onload=()=>{
          try{
            const ratio=Math.min(1, maxW/Math.max(1, img.width||maxW));
            const w=Math.round((img.width||maxW)*ratio), h=Math.round((img.height||maxW)*ratio);
            const cv=document.createElement('canvas'); cv.width=Math.max(1,w); cv.height=Math.max(1,h);
            cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
            URL.revokeObjectURL(url);
            res(cv.toDataURL('image/jpeg', quality));
          }catch(e){ try{URL.revokeObjectURL(url);}catch(_){} rej(e); }
        };
        img.onerror=(e)=>{ try{URL.revokeObjectURL(url);}catch(_){} rej(e||new Error('img')); };
        img.src=url;
      }catch(e){ rej(e); }
    });
  }
  function alignSegHtml(id,current){
    return `<div class="seg" id="${id}">${[['left','왼쪽'],['center','가운데'],['right','오른쪽']].map(([v,l])=>`<button type="button" class="seg-btn ${safeAlign(current)===v?'active':''}" data-action="notice-align" data-align="${v}">${l}</button>`).join('')}</div>`;
  }
  function currentAlign(segId){
    const el=document.getElementById(segId);
    return safeAlign(el?.querySelector('.seg-btn.active')?.dataset.align);
  }
  const editorHtml=(id)=>sanitizeRichHtml(document.getElementById(id)?.innerHTML||'');
  function wireRichEditors(ids=['bannerEditor','popupEditor']){
    ids.forEach(id=>{
      const editor=document.getElementById(id); if(!editor) return;
      const bar=document.querySelector(`[data-rich-toolbar="${id}"]`); if(!bar) return;
      bar.querySelectorAll('[data-cmd]').forEach(btn=>{
        btn.addEventListener('mousedown',e=>e.preventDefault());
        btn.addEventListener('click',()=>{
          editor.focus();
          const cmd=btn.dataset.cmd;
          if(cmd==='createLink'){
            const url=(prompt('링크 주소를 입력해 주세요. (https:// 로 시작)','https://')||'').trim();
            if(!url||url==='https://') return;
            if(!/^https?:\/\//i.test(url)) return toast('http:// 또는 https:// 로 시작하는 주소만 넣을 수 있어요.');
            document.execCommand('createLink',false,url);
          } else if(cmd==='h2'){
            document.execCommand('formatBlock',false,'h2');
          } else if(cmd==='ul'){
            document.execCommand('insertUnorderedList',false,null);
          } else if(cmd==='hr'){
            document.execCommand('insertHorizontalRule',false,null);
          } else if(cmd==='image'){
            const pick=(prompt('사진 주소(https://…)를 붙여넣거나, 파일로 넣으려면 비워 두고 확인을 눌러 주세요.','https://')||'').trim();
            if(pick && pick!=='https://'){
              if(!/^https:\/\//i.test(pick)) return toast('https:// 로 시작하는 사진 주소만 넣을 수 있어요.');
              document.execCommand('insertImage',false,pick);
              return;
            }
            const fi=document.createElement('input');
            fi.type='file'; fi.accept='image/*';
            fi.onchange=async()=>{
              const f=fi.files&&fi.files[0]; if(!f) return;
              if(f.size>8*1024*1024) return toast('8MB 이하 사진만 넣을 수 있어요.');
              try{
                toast('사진을 넣는 중이에요.');
                const dataUrl=await compressImageToDataUrl(f, 960, 0.72);
                if(dataUrl && dataUrl.length>700*1024) toast('사진이 커서 페이지 저장이 무거울 수 있어요. 작은 사진이 좋아요.');
                editor.focus();
                document.execCommand('insertImage',false,dataUrl);
              }catch(e){ console.error(e); toast('사진을 넣지 못했어요.'); }
            };
            fi.click();
          } else document.execCommand(cmd,false,null);
        });
      });
      const colorInput=bar.querySelector('[data-cmd-color]');
      if(colorInput) colorInput.addEventListener('input',()=>{ editor.focus(); document.execCommand('foreColor',false,colorInput.value); });
    });
  }
  function updateNoticePreview(){
    const f=$('#siteNoticeForm'); const host=$('#bannerPreview'); if(!f||!host) return;
    host.style.color=safeColor(f.bannerTextColor?.value,'#3F9BFF');
    host.style.background=safeColor(f.bannerBgColor?.value,'#EAF4FF');
    host.style.textAlign=currentAlign('bannerAlign');
    host.style.fontSize=clampSize(f.bannerFontSize?.value,11,20,14)+'px';
    const body=editorHtml('bannerEditor');
    const lt=(f.bannerLinkText?.value||'').trim();
    host.innerHTML=(body||'<span style="opacity:.5">배너 내용을 입력해 주세요.</span>')+(lt?` <span style="text-decoration:underline;font-weight:650">${esc(lt)}</span>`:'');
    const badge=$('#bannerLiveBadge');
    if(badge){ const on=!!f.bannerEnabled?.checked; badge.textContent=on?'게시 중':'꺼짐'; badge.classList.toggle('on',on); }
  }
  function renderSiteNoticeAdmin(p){
    const s=state.siteNotice||{};
    const b={...DEFAULT_SITE_NOTICE.banner,...(s.banner||{})};
    const n={...DEFAULT_SITE_NOTICE.popup,...(s.popup||{})};
    const m={...DEFAULT_SITE_NOTICE.bottom,...(s.bottom||{})};
    p.innerHTML=`<form id="siteNoticeForm">
      <div class="admin-card"><h3>상단 배너</h3><p class="desc">앱 화면 맨 위에 항상 보이는 공지예요. 로그인한 모든 사용자에게 보여요.</p>
        <div class="setting-row"><div class="setting-label"><strong>표시</strong></div><label class="choice ${b.enabled?'active':''}"><input type="checkbox" name="bannerEnabled" ${b.enabled?'checked':''}> 사용</label></div>
        <div class="field"><label>배너 내용</label>${richToolbarHtml('bannerEditor')}<div class="rich-editor" id="bannerEditor" contenteditable="true" data-placeholder="예: 9월 20일은 재량휴업일이에요.">${sanitizeRichHtml(b.html)}</div></div>
        <div class="admin-grid">
          <div class="field"><label>정렬</label>${alignSegHtml('bannerAlign',b.align)}</div>
          <div class="field"><label>글자 크기 (11~20)</label><input class="input" type="number" min="11" max="20" name="bannerFontSize" value="${clampSize(b.fontSize,11,20,14)}"></div>
          <div class="field"><label>글자색</label><input class="input" type="color" name="bannerTextColor" value="${safeColor(b.textColor,'#3F9BFF')}" style="padding:5px"></div>
          <div class="field"><label>배경색</label><input class="input" type="color" name="bannerBgColor" value="${safeColor(b.bgColor,'#EAF4FF')}" style="padding:5px"></div>
          <div class="field"><label>링크 글자 (선택)</label><input class="input" name="bannerLinkText" maxlength="30" value="${esc(b.linkText||'')}" placeholder="자세히 보기"></div>
          <div class="field"><label>링크 주소 (선택)</label><input class="input" name="bannerLinkUrl" maxlength="300" value="${esc(b.linkUrl||'')}" placeholder="https://..."></div>
        </div>
        <div class="preview-label">미리보기 <span class="live-badge ${b.enabled?'on':''}" id="bannerLiveBadge">${b.enabled?'게시 중':'꺼짐'}</span></div>
        <div class="preview-banner" id="bannerPreview"></div>
      </div>
      <div class="admin-card"><h3>안내 팝업</h3><p class="desc">사용자가 로그인한 뒤 한 번만 뜨는 팝업이에요.</p>
        <div class="setting-row"><div class="setting-label"><strong>표시</strong></div><label class="choice ${n.enabled?'active':''}"><input type="checkbox" name="popupEnabled" ${n.enabled?'checked':''}> 사용</label></div>
        <div class="field"><label>팝업 제목</label><input class="input" name="popupTitle" maxlength="60" value="${esc(n.title||'')}" placeholder="안내"></div>
        <div class="field"><label>팝업 내용</label>${richToolbarHtml('popupEditor')}<div class="rich-editor" id="popupEditor" contenteditable="true" data-placeholder="팝업에 보여줄 내용을 적어 주세요.">${sanitizeRichHtml(n.html)}</div></div>
        <div class="admin-grid">
          <div class="field"><label>정렬</label>${alignSegHtml('popupAlign',n.align)}</div>
          <div class="field"><label>글자 크기 (11~20)</label><input class="input" type="number" min="11" max="20" name="popupFontSize" value="${clampSize(n.fontSize,11,20,15)}"></div>
          <div class="field"><label>글자색</label><input class="input" type="color" name="popupTextColor" value="${safeColor(n.textColor,'#191f28')}" style="padding:5px"></div>
          <div class="field"><label>확인 버튼 글자</label><input class="input" name="popupPrimaryText" maxlength="20" value="${esc(n.primaryText||'확인')}"></div>
          <div class="field"><label>확인 버튼 주소 (선택)</label><input class="input" name="popupPrimaryUrl" maxlength="300" value="${esc(n.primaryUrl||'')}" placeholder="https://..."></div>
          <div class="field"><label>보조 버튼 글자 (선택)</label><input class="input" name="popupSecondaryText" maxlength="20" value="${esc(n.secondaryText||'닫기')}" placeholder="비우면 버튼 없음"></div>
        </div>
      </div>
      <div class="admin-card"><h3>메인 하단 한마디</h3><p class="desc">채팅 입력창 바로 위에 보이는 관리자 글이에요. 글자 크기를 조절할 수 있어요.</p>
        <div class="setting-row"><div class="setting-label"><strong>표시</strong></div><label class="choice ${m.enabled?'active':''}"><input type="checkbox" name="bottomEnabled" ${m.enabled?'checked':''}> 사용</label></div>
        <div class="field"><label>하단 내용</label>${richToolbarHtml('bottomEditor')}<div class="rich-editor" id="bottomEditor" contenteditable="true" data-placeholder="예: 오늘 급식은 카레라이스예요." style="min-height:70px;resize:vertical">${sanitizeRichHtml(m.html)}</div></div>
        <div class="admin-grid">
          <div class="field"><label>정렬</label>${alignSegHtml('bottomAlign',m.align)}</div>
          <div class="field"><label>글자 크기 (11~24)</label><input class="input" type="number" min="11" max="24" name="bottomFontSize" value="${clampSize(m.fontSize,11,24,13)}"></div>
          <div class="field"><label>글자색</label><input class="input" type="color" name="bottomTextColor" value="${safeColor(m.textColor,'#5B6472')}" style="padding:5px"></div>
          <div class="field"><label>배경색</label><input class="input" type="color" name="bottomBgColor" value="${safeColor(m.bgColor,'#F1F2F7')}" style="padding:5px"></div>
        </div>
      </div>
      <button type="button" class="primary" data-action="save-site-notice">사이트 공지 저장하기</button>
    </form>`;
    wireRichEditors();
    const form=$('#siteNoticeForm');
    form?.addEventListener('input',()=>updateNoticePreview());
    updateNoticePreview();
  }
  // ---- 안내 페이지 (로그인 화면의 개인정보 처리방침 · 문의하기 · 학교 등록 + 자유 페이지) ----
  function rawAuthPages(){
    const stored=(Array.isArray(state.sitePages)&&state.sitePages.length) ? state.sitePages : null;
    if(!stored) return DEFAULT_AUTH_PAGES;
    // 기본 새 페이지(윈도우·교사 안내)가 아직 저장본에 없으면 자동으로 덧붙인다 (관리자 손댈 필요 없음)
    try{
      const ids=new Set(stored.map(p=>p&&p.id));
      const missing=DEFAULT_AUTH_PAGES.filter(p=>p&&p.id&&!ids.has(p.id));
      if(missing.length) return [...stored, ...missing];
    }catch(e){}
    return stored;
  }
  function pagesDraft(){
    if(!state.pageDraft) state.pageDraft=rawAuthPages().map(p=>({
      id:p.id, label:p.label||'', title:p.title||'', html:p.html||'', enabled:p.enabled!==false,
      buttons:(Array.isArray(p.buttons)?p.buttons:[]).map(b=>({label:b?.label||'', url:b?.url||''}))
    }));
    return state.pageDraft;
  }
  function syncPagesDraft(){
    const f=$('#pagesForm'); if(!f) return;
    pagesDraft().forEach((pg,i)=>{
      const en=f.querySelector(`[data-page-enabled="${i}"]`);
      const lb=f.querySelector(`[data-page-label="${i}"]`);
      const ti=f.querySelector(`[data-page-title="${i}"]`);
      const ed=document.getElementById('pageEditor'+i);
      if(en) pg.enabled=en.checked;
      if(lb) pg.label=lb.value.slice(0,30);
      if(ti) pg.title=ti.value.slice(0,60);
      if(ed) pg.html=sanitizeRichHtml(ed.innerHTML);
      pg.buttons=pg.buttons.map((b,bi)=>{
        const bl=f.querySelector(`[data-page-btn-label="${i}:${bi}"]`);
        const bu=f.querySelector(`[data-page-btn-url="${i}:${bi}"]`);
        return { label:bl?bl.value.slice(0,24):b.label, url:bu?bu.value.slice(0,PAGE_BTN_URL_MAX):b.url };
      });
    });
  }
  function renderPagesAdmin(p){
    const list=pagesDraft();
    p.innerHTML=`<form id="pagesForm">
      <div class="admin-card"><h3>자유 페이지 만들기</h3>
        <p class="desc">로그인 화면 아래 링크·소개 메뉴에서 열리는 페이지예요. <b>+ 새 페이지 추가</b>로 직접 만들 수 있어요. 제목(H)·목록·구분선·<b>사진(🖼)</b>·링크를 자유롭게 넣을 수 있고, 사진은 파일로 올리면 자동 축소돼요. 표시를 끄면 링크도 사라져요.<br>윈도우 다운로드는 <b>윈도우 앱 다운로드</b> 페이지를 열고 장점을 쭉 설명한 뒤 맨 아래 <b>다운로드 버튼</b>에 설치 파일 주소(https://… 또는 /downloads/…)를 넣으면 돼요. 바로 파일로 가지 않고 소개를 먼저 보여주는 방식이에요.</p>
        ${list.map((pg,i)=>`<div class="page-edit">
          <div class="page-edit-head"><strong>${esc(pg.label||pg.title||pg.id)}</strong>
            <label class="choice ${pg.enabled?'active':''}"><input type="checkbox" data-page-enabled="${i}" ${pg.enabled?'checked':''}> 표시</label>
            <button type="button" class="text-btn" data-action="pages-remove" data-idx="${i}" style="color:var(--danger)">삭제</button></div>
          <div class="admin-grid">
            <div class="field"><label>링크 글자</label><input class="input" data-page-label="${i}" maxlength="30" value="${esc(pg.label)}" placeholder="예: 개인정보 처리방침"></div>
            <div class="field"><label>페이지 제목</label><input class="input" data-page-title="${i}" maxlength="60" value="${esc(pg.title)}"></div>
          </div>
          <div class="field"><label>내용</label>${richToolbarHtml('pageEditor'+i)}<div class="rich-editor" id="pageEditor${i}" contenteditable="true" data-placeholder="내용을 적어 주세요.">${sanitizeRichHtml(pg.html)}</div></div>
          <div class="page-btn-list">
            ${pg.buttons.map((b,bi)=>`<div class="page-btn-row">
              <input class="input" data-page-btn-label="${i}:${bi}" maxlength="24" placeholder="버튼 글자 (예: 윈도우 앱 다운로드)" value="${esc(b.label||'')}">
              <input class="input" data-page-btn-url="${i}:${bi}" placeholder="https://... 또는 /downloads/... (비우면 안내만)" value="${esc(b.url||'')}">
              <button type="button" class="soft-btn" style="flex:0 0 66px" data-action="pages-btn-remove" data-idx="${i}" data-bi="${bi}">삭제</button>
            </div>`).join('')}
            ${pg.buttons.length<6?`<button type="button" class="soft-btn" data-action="pages-btn-add" data-idx="${i}">+ 버튼 추가</button>`:''}
          </div>
        </div>`).join('')}
        ${list.length<12?`<button type="button" class="soft-btn" data-action="pages-add">+ 새 페이지 추가</button>`:''}
      </div>
      <button type="button" class="primary" data-action="save-pages">안내 페이지 저장하기</button>
    </form>
    <div class="admin-card" style="margin-top:18px"><h3>📢 약관 변경 알림 (전체 사용자 동의 팝업)</h3>
      <p class="desc">약관이 바뀌면 여기에 새 버전을 적고 <b>전송</b>을 눌러 주세요. 전송 후 로그인하는 모든 사용자에게 <b>X 없는 동의 팝업</b>이 뜨고, <b>“변경된 약관에 동의합니다”</b>를 체크해야만 서비스 이용이 가능해요. 팝업에는 노란 경고로 눈에 띄게 표시되고, 변경 요약과 바로 보기 버튼이 함께 나와요.</p>
      <div class="admin-grid">
        <div class="field"><label>개인정보 버전</label><input id="policyPrivacy" class="input" maxlength="12" placeholder="예: 2026-09-24"></div>
        <div class="field"><label>이용약관 버전</label><input id="policyTerms" class="input" maxlength="12" placeholder="예: 2026-09-24"></div>
        <div class="field"><label>청소년 보호 버전</label><input id="policyYouth" class="input" maxlength="12" placeholder="예: 2026-09-24"></div>
      </div>
      <div class="field"><label>변경 요약 (팝업에 노란 경고로 표시)</label><input id="policyNote" class="input" maxlength="120" placeholder="예: 학교 일정에서 내 일정이 제외되었어요."></div>
      <div class="field"><label>변경된 부분만 보기 (HTML, 팝업에 함께 표시)</label><div class="rich-toolbar"><button type="button" class="re-btn" data-cmd="bold"><b>B</b></button><button type="button" class="re-btn" data-cmd="italic"><i>I</i></button></div><div class="rich-editor" id="policyDiff" contenteditable="true" data-placeholder="예: 제6조에서 '학교·내 일정'을 '학교 일정'으로 변경"></div></div>
      <div class="admin-toolbar"><button type="button" class="soft-btn" data-action="load-policy">불러오기</button><button type="button" class="confirm" data-action="save-policy">전송 (모든 사용자에게 동의 팝업)</button></div>
      <p class="desc" style="margin-top:8px">저장하면 <code>sitePolicy/current</code>에 버전이 저장되고, 다음 로그인부터 강제 동의가 필요해요.</p>
    </div>`;
    wireRichEditors(list.map((_,i)=>'pageEditor'+i));
  }

  async function loadPolicyAdmin(){
    try{
      const s=await db.collection('sitePolicy').doc('current').get();
      const d=s.exists?(s.data()||{}):{};
      const pp=document.getElementById('policyPrivacy');
      const pt=document.getElementById('policyTerms');
      const py=document.getElementById('policyYouth');
      const pn=document.getElementById('policyNote');
      const pd=document.getElementById('policyDiff');
      if(pp) pp.value=d.privacy||POLICY_VERSIONS.privacy;
      if(pt) pt.value=d.terms||POLICY_VERSIONS.terms;
      if(py) py.value=d.youth||POLICY_VERSIONS.youth;
      if(pn) pn.value=d.note||'';
      if(pd) pd.innerHTML=d.diffHtml||'';
      toast('정책 버전을 불러왔어요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function savePolicyAdmin(){
    const pp=document.getElementById('policyPrivacy');
    const pt=document.getElementById('policyTerms');
    const py=document.getElementById('policyYouth');
    const pn=document.getElementById('policyNote');
    const pd=document.getElementById('policyDiff');
    const privacy=(pp?.value||'').trim()||POLICY_VERSIONS.privacy;
    const terms=(pt?.value||'').trim()||POLICY_VERSIONS.terms;
    const youth=(py?.value||'').trim()||POLICY_VERSIONS.youth;
    const note=(pn?.value||'').trim().slice(0,120);
    const diffHtml=pd?sanitizeRichHtml(pd.innerHTML):'';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(privacy) || !/^\d{4}-\d{2}-\d{2}$/.test(terms)){
      return toast('버전은 YYYY-MM-DD 형식으로 적어 주세요.');
    }
    const ok=await new Promise(res=>{
      const panel=openModal(`<h2>약관 변경을 전송할까요?</h2><div class="notice-ico warn"><span>!</span></div><p class="desc">저장하면 <b>모든 사용자</b>가 다음 로그인 시 <b>동의 팝업</b>을 봐야 해요. X나 여백으로 닫을 수 없고 체크 후에만 계속할 수 있어요.</p><div class="warn-box">버전: ${esc(privacy)} / ${esc(terms)} / ${esc(youth)}</div><div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" id="policyGo">전송</button></div>`,{small:true});
      panel.querySelector('#policyGo').onclick=()=>{ closeModal(); res(true); };
      panel.querySelector('[data-close-modal]')?.addEventListener('click',()=>res(false));
    });
    if(!ok) return;
    try{
      await db.collection('sitePolicy').doc('current').set({privacy,terms,youth,note,diffHtml,updatedAt:ts(),updatedBy:uid()},{merge:true});
      effectivePolicyVersions={privacy,terms,youth,note,diffHtml};
      toast('전송했어요. 다음 로그인부터 동의가 필요해요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }

  async function saveAuthPages(){
    if(!isAdmin()) return;
    syncPagesDraft();
    const pages=pagesDraft().map(p=>({
      id:String(p.id).slice(0,40), label:String(p.label||'').slice(0,30), title:String(p.title||'').slice(0,60),
      html:sanitizeRichHtml(p.html||''), enabled:p.enabled!==false,
      buttons:p.buttons.filter(b=>b&&b.label).slice(0,6).map(b=>({label:String(b.label).slice(0,24),url:String(b.url||'').slice(0,PAGE_BTN_URL_MAX)}))
    }));
    try{
      await db.collection('sitePages').doc('main').set({pages,updatedAt:ts(),updatedBy:uid()});
      state.pageDraft=null;
      renderPagesAdmin($('#adminPanel'));
      toast('안내 페이지를 저장했어요.');
    }catch(e){ console.error(e); toast('저장하지 못했어요.'); }
  }

  // ---- 소개(랜딩) 페이지 (관리자 도구 → 소개 페이지) ----
  function landingDraft(){
    if(!state.landingDraft) state.landingDraft=normalizeLanding(state.landing);
    return state.landingDraft;
  }
  function syncLandingDraft(){
    const f=$('#landingForm'); if(!f) return;
    const gv=(k)=>(f.querySelector(`[data-landing="${k}"]`)?.value||'').trim();
    const gc=(k)=>!!f.querySelector(`[data-landing="${k}"]`)?.checked;
    const L=landingDraft();
    state.landingDraft=normalizeLanding({
      ...L,
      enabled: gc('enabled'),
      brandMark: gv('brandMark'),
      brandTexts: gv('brandTexts').split(/\r?\n/).map(w=>w.trim()).filter(Boolean),
      loginLabel: gv('login'),
      signupLabel: gv('signup'),
      nav: L.nav.map((n,i)=>{
        const type = gv(`navType:${i}`)==='menu' ? 'menu' : 'link';
        return {
          label: gv(`navLabel:${i}`),
          type,
          action: gv(`navAction:${i}`) || n.action,
          value: gv(`navValue:${i}`),
          items: type==='menu'
            ? (n.items||[]).map((_,si)=>({ label:gv(`subLabel:${i}:${si}`), action:gv(`subAction:${i}:${si}`), value:gv(`subValue:${i}:${si}`) }))
            : []
        };
      }).filter(n=>n.label),
      hero: {
        badge: gv('heroBadge'), title: gv('heroTitle'), desc: gv('heroDesc'),
        rollWords: gv('heroRollWords').split(/\r?\n/).map(w=>w.trim()).filter(Boolean),
        primaryLabel: gv('heroPrimaryLabel'), primaryAction: gv('heroPrimaryAction'),
        secondaryLabel: gv('heroSecondaryLabel'), secondaryTarget: gv('heroSecondaryTarget')
      },
      featuresTitle: gv('featuresTitle'), featuresDesc: gv('featuresDesc'),
      features: L.features.map((_,i)=>({ icon:gv(`featIcon:${i}`), title:gv(`featTitle:${i}`), desc:gv(`featDesc:${i}`) })),
      mock: {
        enabled: gc('mockEnabled'),
        title: gv('mockTitle'),
        caption: gv('mockCaption'),
        intervalSec: gv('mockInterval'),
        chatStyle: gv('mockStyle'),
        presets: L.mock.presets.map((p,pi)=>({
          name: gv(`presetName:${pi}`),
          messages: p.messages.map((_,mi)=>({ side:gv(`msgSide:${pi}:${mi}`), avatar:gv(`msgAvatar:${pi}:${mi}`), text:gv(`msgText:${pi}:${mi}`) }))
        }))
      },
      stepsTitle: gv('stepsTitle'), stepsDesc: gv('stepsDesc'),
      steps: L.steps.map((_,i)=>({ title:gv(`stepTitle:${i}`), desc:gv(`stepDesc:${i}`) })),
      ctaTitle: gv('ctaTitle'), ctaDesc: gv('ctaDesc'), ctaButton: gv('ctaButton'), footerText: gv('footerText'),
      businessInfo: (()=>{ try{ return document.querySelector('[data-landing="businessInfo"]')?.value.replace(/\r/g,'')||''; }catch(e){ return ''; } })()
    });
  }
  function landingTargetSelect(key,current,style=''){
    return `<select class="input" data-landing="${key}"${style?` style="${style}"`:''}>${LANDING_TARGETS.map(([v,l])=>`<option value="${v}" ${current===v?'selected':''}>${l}</option>`).join('')}</select>`;
  }
  function landingActionOptions(cur){
    return LANDING_ACTIONS.map(([v,l])=>`<option value="${v}" ${cur===v?'selected':''}>${l}</option>`).join('');
  }
  // 동작에 따라 입력 칸이 달라진다 (안내 페이지 고르기 · 페이지 안 이동 · 주소 입력)
  function landingValueControl(key,action,value){
    const v=value||'';
    if(action==='page'){
      const pages=authPages();
      return `<select class="input" data-landing="${key}">${pages.map(p=>`<option value="${esc(p.id)}" ${v===p.id?'selected':''}>${esc(p.label||p.title||p.id)}</option>`).join('')}${pages.length?'':'<option value="">안내 페이지가 없어요</option>'}</select>`;
    }
    if(action==='scroll') return landingTargetSelect(key,v||'top');
    if(action==='url') return `<input class="input" data-landing="${key}" maxlength="300" placeholder="https://... 또는 mailto:..." value="${esc(v)}">`;
    return '<input class="input" value="값이 필요 없어요" disabled style="opacity:.55">';
  }
  function renderLandingAdmin(p){
    const L=landingDraft();
    p.innerHTML=`<div id="landingForm">
      <div class="admin-card"><h3>기본 설정</h3>
        <p class="desc">로그인하기 전에 처음 보이는 소개 페이지예요. 끄면 지금처럼 로그인 화면이 바로 나와요.</p>
        <div class="setting-row"><div class="setting-label"><strong>소개 페이지 사용</strong></div><label class="choice ${L.enabled?'active':''}"><input type="checkbox" data-landing="enabled" ${L.enabled?'checked':''}> 사용</label></div>
        <div class="admin-grid">
          <div class="field"><label>로고 글자 (1~2자 · E면 말풍선 로고)</label><input class="input" data-landing="brandMark" maxlength="2" value="${esc(L.brandMark||'E')}" placeholder="E"></div>
          <div class="field"><label>로그인 버튼 글자</label><input class="input" data-landing="login" maxlength="16" value="${esc(L.loginLabel)}"></div>
          <div class="field"><label>회원가입 버튼 글자</label><input class="input" data-landing="signup" maxlength="16" value="${esc(L.signupLabel)}"></div>
        </div>
        <div class="field"><label>브랜드 이름 (한 줄에 하나씩 · 2개 이상이면 번갈아 나와요)</label><textarea class="input" data-landing="brandTexts" style="min-height:80px" placeholder="에듀톡">${esc((L.brandTexts||[L.brandName||'에듀톡']).join('\n'))}</textarea></div>
        <p class="desc" style="margin:-6px 0 14px">왼쪽 위 로고와 로그인 화면 이름에 쓰여요. 첫 번째 이름은 소개 페이지 대표 이름으로도 쓰여요.</p>
      </div>
      <div class="admin-card"><h3>상단 메뉴</h3><p class="desc">메뉴에 마우스를 올리면 하위 항목이 차라락 내려와요. 왼쪽부터 순서대로 보이고, 로그인 버튼은 오른쪽 끝에 고정돼요.</p>
        ${L.nav.map((n,i)=>`<div class="page-edit">
          <div class="page-edit-head"><strong>${esc(n.label||'메뉴')}${n.type==='menu'?' · 드롭다운':''}</strong><button type="button" class="text-btn" data-action="landing-nav-remove" data-idx="${i}" style="color:var(--danger)">메뉴 삭제</button></div>
          <div class="admin-grid">
            <div class="field"><label>메뉴 이름</label><input class="input" data-landing="navLabel:${i}" maxlength="20" placeholder="예: 다운로드" value="${esc(n.label)}"></div>
            <div class="field"><label>형태</label><select class="input" data-landing="navType:${i}"><option value="link" ${n.type!=='menu'?'selected':''}>누르면 바로 이동</option><option value="menu" ${n.type==='menu'?'selected':''}>마우스 올리면 펼쳐짐</option></select></div>
          </div>
          ${n.type==='menu'
            ? `<div class="landing-sub-list">
                ${(n.items||[]).map((s,si)=>`<div class="page-btn-row" style="margin-bottom:8px">
                  <input class="input" data-landing="subLabel:${i}:${si}" maxlength="20" placeholder="하위 항목 이름" value="${esc(s.label)}">
                  <select class="input" data-landing="subAction:${i}:${si}" data-landing-action="1" style="flex:0 0 118px">${landingActionOptions(s.action)}</select>
                  ${landingValueControl(`subValue:${i}:${si}`,s.action,s.value)}
                  <button type="button" class="soft-btn" style="flex:0 0 56px" data-action="landing-sub-remove" data-idx="${i}" data-si="${si}">삭제</button>
                </div>`).join('')}
                ${(n.items||[]).length<5?`<button type="button" class="soft-btn" data-action="landing-sub-add" data-idx="${i}">+ 하위 항목 추가</button>`:''}
              </div>`
            : `<div class="admin-grid">
                <div class="field"><label>누르면</label><select class="input" data-landing="navAction:${i}" data-landing-action="1">${landingActionOptions(n.action)}</select></div>
                <div class="field"><label>대상</label>${landingValueControl(`navValue:${i}`,n.action,n.value)}</div>
              </div>`}
        </div>`).join('')}
        ${L.nav.length<5?`<button type="button" class="soft-btn" data-action="landing-nav-add">+ 메뉴 추가</button>`:''}
      </div>
      <div class="admin-card"><h3>첫 화면</h3>
        <div class="field"><label>뱃지 (선택)</label><input class="input" data-landing="heroBadge" maxlength="30" value="${esc(L.hero.badge)}" placeholder="예: 학교 전용 메신저"></div>
        <div class="field"><label>큰 제목 (첫 줄)</label><input class="input" data-landing="heroTitle" maxlength="70" value="${esc(L.hero.title)}" placeholder="예: 학교 안에서"></div>
        <div class="field"><label>둘째 줄 회전 문구 (한 줄에 하나씩 · 비우면 표시하지 않아요)</label><textarea class="input" data-landing="heroRollWords" style="min-height:96px" placeholder="멋지게 대화해요">${esc((L.hero.rollWords||[]).join('\n'))}</textarea></div>
        <p class="desc" style="margin:-6px 0 14px">로그인 화면 히어로와 같아요. 첫 줄은 그대로 있고 <b>둘째 줄 문구만 한 칸씩 스르륵</b> 바뀌어요.</p>
        <div class="field"><label>설명</label><textarea class="input" data-landing="heroDesc" maxlength="240" style="min-height:92px">${esc(L.hero.desc)}</textarea></div>
        <div class="admin-grid">
          <div class="field"><label>주 버튼 글자</label><input class="input" data-landing="heroPrimaryLabel" maxlength="20" value="${esc(L.hero.primaryLabel)}"></div>
          <div class="field"><label>주 버튼 동작</label><select class="input" data-landing="heroPrimaryAction"><option value="login" ${L.hero.primaryAction!=='signup'?'selected':''}>로그인 화면 열기</option><option value="signup" ${L.hero.primaryAction==='signup'?'selected':''}>회원가입 화면 열기</option></select></div>
          <div class="field"><label>보조 버튼 글자 (선택)</label><input class="input" data-landing="heroSecondaryLabel" maxlength="20" value="${esc(L.hero.secondaryLabel)}"></div>
          <div class="field"><label>보조 버튼 이동</label>${landingTargetSelect('heroSecondaryTarget',L.hero.secondaryTarget)}</div>
        </div>
      </div>
      <div class="admin-card"><h3>채팅 미리보기</h3>
        <p class="desc">첫 화면 오른쪽의 채팅창이에요. 프리셋을 2개 이상 두면 지정한 간격마다 스르륵 바뀌어요.</p>
        <div class="setting-row"><div class="setting-label"><strong>채팅창 표시</strong></div><label class="choice ${L.mock.enabled?'active':''}"><input type="checkbox" data-landing="mockEnabled" ${L.mock.enabled?'checked':''}> 사용</label></div>
        <div class="admin-grid">
          <div class="field"><label>방 이름</label><input class="input" data-landing="mockTitle" maxlength="24" value="${esc(L.mock.title)}"></div>
          <div class="field"><label>채팅창 밑 글자</label><input class="input" data-landing="mockCaption" maxlength="120" value="${esc(L.mock.caption||'')}" placeholder="예: 실제 화면과 똑같이 써 보세요"></div>
          <div class="field"><label>바뀌는 간격 (3~30초)</label><input class="input" type="number" min="3" max="30" data-landing="mockInterval" value="${L.mock.intervalSec}"></div>
          <div class="field"><label>전환 방식</label><select class="input" data-landing="mockStyle"><option value="typing" ${L.mock.chatStyle!=='fade'?'selected':''}>한 줄씩 올라오듯이</option><option value="fade" ${L.mock.chatStyle==='fade'?'selected':''}>전체가 부드럽게</option></select></div>
        </div>
        ${L.mock.presets.map((p,pi)=>`<div class="page-edit">
          <div class="page-edit-head"><strong>프리셋 ${pi+1}${p.name?` · ${esc(p.name)}`:''}</strong><button type="button" class="text-btn" data-action="landing-mock-preset-remove" data-idx="${pi}" style="color:var(--danger)">프리셋 삭제</button></div>
          <div class="field" style="margin:0 0 10px"><input class="input" data-landing="presetName:${pi}" maxlength="20" placeholder="프리셋 이름 (관리용)" value="${esc(p.name)}"></div>
          ${p.messages.map((m,mi)=>`<div class="page-btn-row" style="margin-bottom:8px">
            <select class="input" data-landing="msgSide:${pi}:${mi}" style="flex:0 0 92px"><option value="left" ${m.side!=='right'?'selected':''}>왼쪽</option><option value="right" ${m.side==='right'?'selected':''}>오른쪽</option></select>
            <input class="input" data-landing="msgAvatar:${pi}:${mi}" maxlength="4" style="flex:0 0 58px;text-align:center" placeholder="민" value="${esc(m.avatar)}">
            <input class="input" data-landing="msgText:${pi}:${mi}" maxlength="60" placeholder="메시지 내용" value="${esc(m.text)}">
            <button type="button" class="soft-btn" style="flex:0 0 56px" data-action="landing-mock-msg-remove" data-idx="${pi}" data-mi="${mi}">삭제</button>
          </div>`).join('')}
          ${p.messages.length<6?`<button type="button" class="soft-btn" data-action="landing-mock-msg-add" data-idx="${pi}">+ 메시지 추가</button>`:''}
        </div>`).join('')}
        ${L.mock.presets.length<5?`<button type="button" class="soft-btn" data-action="landing-mock-preset-add">+ 프리셋 추가</button>`:''}
        <p class="desc" style="margin:14px 0 0">오른쪽 말풍선(내가 보낸 메시지)은 프로필 없이 표시돼요. 내용을 비운 메시지는 저장할 때 빠져요.</p>
      </div>
      <div class="admin-card"><h3>기능 소개</h3><p class="desc">카드로 보여 줄 기능이에요. 제목을 비우면 그 카드는 사라져요.</p>
        <div class="admin-grid">
          <div class="field"><label>섹션 제목</label><input class="input" data-landing="featuresTitle" maxlength="40" value="${esc(L.featuresTitle)}"></div>
          <div class="field"><label>섹션 설명</label><input class="input" data-landing="featuresDesc" maxlength="120" value="${esc(L.featuresDesc)}"></div>
        </div>
        ${L.features.map((f,i)=>`<div class="page-edit">
          <div class="page-edit-head"><strong>${esc(f.title||'새 기능')}</strong><button type="button" class="text-btn" data-action="landing-feat-remove" data-idx="${i}" style="color:var(--danger)">삭제</button></div>
          <div class="page-btn-row">
            <input class="input" data-landing="featIcon:${i}" maxlength="4" style="flex:0 0 70px;text-align:center" placeholder="🙂" value="${esc(f.icon)}">
            <input class="input" data-landing="featTitle:${i}" maxlength="30" placeholder="기능 제목" value="${esc(f.title)}">
          </div>
          <div class="field" style="margin:8px 0 0"><input class="input" data-landing="featDesc:${i}" maxlength="120" placeholder="설명" value="${esc(f.desc)}"></div>
        </div>`).join('')}
        ${L.features.length<6?`<button type="button" class="soft-btn" data-action="landing-feat-add">+ 기능 추가</button>`:''}
      </div>
      <div class="admin-card"><h3>이용 방법</h3><p class="desc">순서대로 보여 줄 단계예요. 제목을 비우면 그 단계는 사라져요.</p>
        <div class="admin-grid">
          <div class="field"><label>섹션 제목</label><input class="input" data-landing="stepsTitle" maxlength="40" value="${esc(L.stepsTitle)}"></div>
          <div class="field"><label>섹션 설명</label><input class="input" data-landing="stepsDesc" maxlength="120" value="${esc(L.stepsDesc)}"></div>
        </div>
        ${L.steps.map((s,i)=>`<div class="page-edit">
          <div class="page-edit-head"><strong>${i+1}단계 · ${esc(s.title||'새 단계')}</strong><button type="button" class="text-btn" data-action="landing-step-remove" data-idx="${i}" style="color:var(--danger)">삭제</button></div>
          <div class="field" style="margin:0 0 8px"><input class="input" data-landing="stepTitle:${i}" maxlength="40" placeholder="단계 제목" value="${esc(s.title)}"></div>
          <div class="field" style="margin:0"><input class="input" data-landing="stepDesc:${i}" maxlength="140" placeholder="설명" value="${esc(s.desc)}"></div>
        </div>`).join('')}
        ${L.steps.length<4?`<button type="button" class="soft-btn" data-action="landing-step-add">+ 단계 추가</button>`:''}
      </div>
      <div class="admin-card"><h3>마지막 안내 · 하단</h3>
        <div class="field"><label>안내 제목</label><input class="input" data-landing="ctaTitle" maxlength="60" value="${esc(L.ctaTitle)}"></div>
        <div class="field"><label>안내 설명</label><input class="input" data-landing="ctaDesc" maxlength="140" value="${esc(L.ctaDesc)}"></div>
        <div class="admin-grid">
          <div class="field"><label>버튼 글자</label><input class="input" data-landing="ctaButton" maxlength="20" value="${esc(L.ctaButton)}"></div>
          <div class="field"><label>하단 문구</label><input class="input" data-landing="footerText" maxlength="160" value="${esc(L.footerText)}"></div>
        </div>
        <div class="field"><label>사업자 정보 (푸터 하단 · 줄바꿈 가능 · 글자수 제한 없음)</label><textarea class="input" data-landing="businessInfo" rows="4" style="min-height:90px;resize:vertical" placeholder="예: 상호">${esc(L.businessInfo||'')}</textarea></div>
        <p class="desc" style="margin:14px 0 0">아래쪽 안내 페이지 링크(개인정보 처리방침·문의하기 등)는 <b>안내 페이지</b> 탭에서 관리해요.</p>
      </div>
      <button type="button" class="primary" data-action="save-landing">소개 페이지 저장하기</button>
    </div>`;
  }
  async function saveLanding(){
    if(!isAdmin()) return;
    syncLandingDraft();
    const cfg=normalizeLanding(state.landingDraft);
    // 비어 있는 항목은 저장하지 않는다
    cfg.features=cfg.features.filter(f=>f.title);
    cfg.steps=cfg.steps.filter(s=>s.title);
    cfg.mock.presets=cfg.mock.presets.map(p=>({...p,messages:p.messages.filter(m=>m.text)})).filter(p=>p.messages.length);
    try{
      await db.collection('siteLanding').doc('main').set({...cfg,updatedAt:ts(),updatedBy:uid()},{merge:true});
    }catch(e){ console.error(e); return toast(errText(e)); }
    state.landing=cfg;
    state.landingDraft=null;
    state.landingSig=JSON.stringify(cfg);
    renderLandingAdmin($('#adminPanel'));
    toast('소개 페이지를 저장했어요.');
  }

  async function saveSiteNotice(){
    if(!isAdmin()) return;
    const f=$('#siteNoticeForm'); if(!f) return;
    const banner={ enabled:!!f.bannerEnabled?.checked, html:editorHtml('bannerEditor'), align:currentAlign('bannerAlign'), fontSize:clampSize(f.bannerFontSize?.value,11,20,14), textColor:safeColor(f.bannerTextColor?.value,'#3F9BFF'), bgColor:safeColor(f.bannerBgColor?.value,'#EAF4FF'), linkText:(f.bannerLinkText?.value||'').trim().slice(0,30), linkUrl:(f.bannerLinkUrl?.value||'').trim().slice(0,300) };
    const popup={ enabled:!!f.popupEnabled?.checked, title:(f.popupTitle?.value||'').trim().slice(0,60), html:editorHtml('popupEditor'), align:currentAlign('popupAlign'), fontSize:clampSize(f.popupFontSize?.value,11,20,15), textColor:safeColor(f.popupTextColor?.value,'#191f28'), primaryText:(f.popupPrimaryText?.value||'').trim().slice(0,20)||'확인', primaryUrl:(f.popupPrimaryUrl?.value||'').trim().slice(0,300), secondaryText:(f.popupSecondaryText?.value||'').trim().slice(0,20) };
    const bottom={ enabled:!!f.bottomEnabled?.checked, html:editorHtml('bottomEditor'), align:currentAlign('bottomAlign'), fontSize:clampSize(f.bottomFontSize?.value,11,24,13), textColor:safeColor(f.bottomTextColor?.value,'#5B6472'), bgColor:safeColor(f.bottomBgColor?.value,'#F1F2F7') };
    try{ await db.collection('siteNotices').doc('main').set({banner,popup,bottom,updatedAt:ts(),updatedBy:uid()},{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    state.siteNotice={banner:{...DEFAULT_SITE_NOTICE.banner,...banner},popup:{...DEFAULT_SITE_NOTICE.popup,...popup},bottom:{...DEFAULT_SITE_NOTICE.bottom,...bottom}};
    renderSiteBanner();
    try{ renderMainBottom(); }catch(e){}
    toast('사이트 공지를 저장했어요.');
  }
  function makeSchoolCode(){
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out='';
    for(let i=0;i<6;i++) out+=chars[Math.floor(Math.random()*chars.length)];
    return out;
  }
  function renderSchoolAdmin(p){
    p.innerHTML=`<div class="admin-card"><h3>우리 학교</h3><p class="desc">학교를 등록하면 학생이 가입할 때 쓸 <b>가입 코드</b>가 만들어져요. 코드가 있어야 가입할 수 있어요.</p><div id="mySchools" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>
    <div class="admin-card"><h3>전국 학교 검색</h3><p class="desc">교육부 나이스(NEIS)에서 전국 학교를 찾아 등록할 수 있어요. 무료이고 따로 가입할 필요가 없어요.</p><div class="admin-toolbar"><input id="neisSearch" class="input" placeholder="학교 이름 (예: 가락고등학교)"><button type="button" class="soft-btn" style="flex:0 0 84px" data-action="neis-search">검색</button></div><div id="neisResults" class="list"></div></div>`;
    renderMySchools();
  }
  async function renderMySchools(){
    const host=$('#mySchools'); if(!host) return;
    let rows=[];
    try{ const snap=await db.collection('schools').limit(300).get(); rows=snap.docs.map(d=>({id:d.id,...d.data()})); }
    catch(e){ console.error(e); host.innerHTML='<div class="empty-side">학교 목록을 불러오지 못했어요.</div>'; return; }
    state.schoolList=rows.filter(s=>s.active!==false);
    // 학교 관리자는 전체 목록을 긁을 수 없고, 우리 학교 코드만 단건 조회한다 (규칙: 본인 학교 get 허용)
    state.schoolCodes={};
    try{
      if(isAdmin()){
        const cs=await db.collection('schoolCodes').limit(300).get();
        state.schoolCodes=Object.fromEntries(cs.docs.map(d=>[d.id,d.data().code||'']));
      }else{
        const mySid=state.profile?.schoolId||'';
        if(mySid){
          try{ const one=await db.collection('schoolCodes').doc(mySid).get(); if(one.exists) state.schoolCodes[mySid]=one.data().code||''; }catch(e){ console.warn('schoolCode self', e?.code||e); }
        }
      }
    }
    catch(e){ state.schoolCodes={}; }
    if(!rows.length){ host.innerHTML='<div class="empty-side">아직 등록된 학교가 없어요.<br>아래에서 전국 학교를 검색해 등록해 주세요.</div>'; return; }
    host.innerHTML=rows.map(s=>{
      const code=(state.schoolCodes||{})[s.id]||'';
      return `<div class="list-item tappable" data-action="open-school-settings" data-sid="${esc(s.id)}"><div class="grow"><div class="title">${esc(s.name||'이름 없는 학교')}${s.active===false?' <span class="mini muted">(사용 중지)</span>':''}${state.profile?.schoolId===s.id?' <span class="mini" style="color:var(--blue)">우리 학교</span>':''}</div><div class="meta">${esc(s.atpt||'')}${s.kind?` · ${esc(s.kind)}`:''} · ${(s.grades||[]).length}개 학년</div><div class="admin-meta"><span class="admin-chip">가입 코드 ${esc(code||'없음')}</span></div></div><span>›</span></div>`;
    }).join('');
  }
  async function neisSearch(){
    const q=$('#neisSearch')?.value?.trim();
    if(!q) return toast('학교 이름을 입력해 주세요.');
    const host=$('#neisResults'); if(host) host.innerHTML='<div class="empty-side">검색 중이에요...</div>';
    try{
      const res=await fetch(`https://open.neis.go.kr/hub/schoolInfo?Type=json&pIndex=1&pSize=40&SCHUL_NM=${encodeURIComponent(q)}`);
      const j=await res.json();
      const rows=(j?.schoolInfo?.[1]?.row)||[];
      state.neisRows=rows.map(r=>({id:`${r.ATPT_OFCDC_SC_CODE}-${r.SD_SCHUL_CODE}`,name:r.SCHUL_NM,atpt:r.ATPT_OFCDC_SC_NM,kind:r.SCHUL_KND_SC_NM,addr:r.ORG_RDNMA||''}));
      if(!state.neisRows.length){ host.innerHTML='<div class="empty-side">검색 결과가 없어요. 학교 이름을 정확히 입력해 보세요.</div>'; return; }
      const registered=new Set((state.schoolList||[]).map(s=>s.id));
      host.innerHTML=state.neisRows.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(r.name)}</div><div class="meta">${esc(r.atpt||'')} · ${esc(r.kind||'')}${r.addr?` · ${esc(r.addr)}`:''}</div></div>${registered.has(r.id)?'<span class="mini muted">등록됨</span>':`<button class="soft-btn" style="flex:0 0 72px" data-action="register-school" data-nid="${esc(r.id)}">등록</button>`}</div>`).join('');
    }catch(e){ console.error(e); if(host) host.innerHTML='<div class="empty-side">전국 학교 검색에 실패했어요. 잠시 후 다시 시도해 주세요.</div>'; }
  }
  async function registerSchool(nid){
    const r=(state.neisRows||[]).find(x=>x.id===nid); if(!r) return;
    const code=makeSchoolCode();
    try{
      await db.collection('schools').doc(r.id).set({name:r.name,atpt:r.atpt||'',kind:r.kind||'',address:r.addr||'',grades:[1,2,3],classCounts:{1:1,2:1,3:1},active:true,createdAt:ts(),createdBy:uid()},{merge:true});
      await db.collection('schoolCodes').doc(r.id).set({code,updatedAt:ts(),updatedBy:uid()},{merge:true});
    }catch(e){ console.error(e); return toast(errText(e)); }
    state.schoolList=null;
    toast(`${r.name} 등록 완료 · 코드 ${code}`);
    renderAdminPanel('school');
  }
  function regenSchoolCode(sid){
    if(!sid) return;
    if(!(isAdmin() || (isSchoolAdmin() && (state.profile?.schoolId||'')===sid))) return toast('우리 학교 코드만 재발급할 수 있어요.');
    openDangerConfirm({
      title:'가입 코드를 새로 만들까요?',
      desc:'기존 코드는 즉시 사용할 수 없게 되고, 학생들은 새 코드로만 가입할 수 있어요. 개인정보와 연결된 작업이라 5초 뒤에 진행할 수 있어요.',
      requireText:'', seconds:5, confirmLabel:'재발급하기',
      checkLabel:'위 내용을 이해했고, 재발급해도 됩니다.',
      onConfirm: async ()=>{
        const code=makeSchoolCode();
        try{ await db.collection('schoolCodes').doc(sid).set({code,updatedAt:ts(),updatedBy:uid()},{merge:true}); }
        catch(e){ console.error(e); toast(errText(e)); return; }
        state.schoolCodes={...(state.schoolCodes||{}),[sid]:code};
        state.schoolEdit={...(state.schoolEdit||{}),code};
        const badge=$('#schoolCodeValue'); if(badge) badge.textContent=code;
        toast(`새 코드: ${code}`);
        renderMySchools();
      }
    });
  }
  async function openSchoolSettings(sid){
    let s=(state.schoolList||[]).find(x=>x.id===sid);
    if(!s){ try{ const snap=await db.collection('schools').doc(sid).get(); s=snap.exists?{id:sid,...snap.data()}:null; }catch(e){ console.error(e); } }
    if(!s) return;
    let code=(state.schoolCodes||{})[sid];
    if(code===undefined){ try{ const cs=await db.collection('schoolCodes').doc(sid).get(); code=cs.exists?(cs.data().code||''):''; }catch(e){ code=''; } }
    state.schoolEdit={id:sid,data:s,code};
    renderSchoolSettingsModal();
  }
  function renderSchoolSettingsModal(){
    const ed=state.schoolEdit; if(!ed) return;
    const s=ed.data||{}; const grades=Array.isArray(s.grades)?s.grades.map(Number).sort((a,b)=>a-b):[];
    const panel=openModal(`<h2>${esc(s.name||'학교 설정')}</h2><p class="desc">${esc(s.atpt||'')}${s.kind?` · ${esc(s.kind)}`:''}</p>
      <form id="schoolForm" data-sid="${esc(ed.id)}">
        <div class="setting-row"><div class="setting-label"><strong>가입 코드</strong></div><div style="display:flex;gap:8px;align-items:center"><b id="schoolCodeValue" style="font-size:18px;letter-spacing:2px">${esc(ed.code||'없음')}</b><button type="button" class="soft-btn" style="flex:0 0 72px" data-action="regen-school-code" data-sid="${esc(ed.id)}">재발급</button></div></div>
        <div class="field" style="margin-top:14px"><label>학년</label><div class="check-grid" id="schoolGradeChips">${Array.from({length:6},(_,i)=>i+1).map(g=>`<button type="button" class="check-chip ${grades.includes(g)?'on':''}" data-school-grade="${g}">${g}학년</button>`).join('')}</div></div>
        <div class="admin-grid" id="schoolCounts"></div>
        ${isAdmin()?`<div class="field"><label>교육청 이메일 도메인 (교사 인증용 · 한 줄에 하나)</label><textarea class="input" name="eduDomains" rows="3" style="min-height:70px;resize:vertical" placeholder="예: sen.go.kr">${esc(Array.isArray(s.eduDomains)?s.eduDomains.join('\n'):'')}</textarea></div><div class="field"><label>파일 보관 기한 (일 · 0이면 영구 보관)</label><input class="input" type="number" min="0" max="3650" name="fileRetentionDays" value="${Number(s.fileRetentionDays||0)}"></div>`:''}
        <div class="setting-row" style="margin-top:8px"><div class="setting-label"><strong>사용</strong></div><label class="choice ${s.active!==false?'active':''}"><input type="checkbox" name="schoolActive" ${s.active!==false?'checked':''}> 사용</label></div>
        <div class="modal-actions"><button type="button" class="cancel" data-close-modal>닫기</button><button class="confirm">저장하기</button></div>
      </form>
      <div class="divider"></div>
      <div class="admin-toolbar" style="margin:0"><button type="button" class="soft-btn" data-action="link-school-data" data-sid="${esc(ed.id)}">기존 계정·채팅방 연결</button><button type="button" class="soft-btn" data-action="suggest-assign">건의함 담당 교사</button><button type="button" class="soft-btn" data-action="delete-school" data-sid="${esc(ed.id)}">학교 삭제</button></div>`);
    const draft={...(s.classCounts||{})};
    const grid=panel.querySelector('#schoolCounts');
    const renderCounts=()=>{
      const gs=[...panel.querySelectorAll('#schoolGradeChips .check-chip')].filter(b=>b.classList.contains('on')).map(b=>Number(b.dataset.schoolGrade)).sort((a,b)=>a-b);
      grid.innerHTML=gs.map(g=>`<div class="field"><label>${g}학년 반 수</label><input class="input" type="number" min="1" max="60" name="grade-${g}" value="${Number(draft[g]||1)}"></div>`).join('')||'<div class="empty-side">학년을 하나 이상 골라 주세요.</div>';
    };
    panel.querySelectorAll('#schoolGradeChips .check-chip').forEach(b=>b.onclick=()=>{
      grid.querySelectorAll('input[name^="grade-"]').forEach(i=>{ draft[Number(i.name.split('-')[1])]=Number(i.value||1); });
      b.classList.toggle('on');
      renderCounts();
    });
    renderCounts();
  }
  async function saveSchoolSettings(f){
    const sid=f?.dataset?.sid; if(!sid) return;
    const panel=f.closest('.modal')||document;
    const grades=[...panel.querySelectorAll('#schoolGradeChips .check-chip')].filter(b=>b.classList.contains('on')).map(b=>Number(b.dataset.schoolGrade)).sort((a,b)=>a-b);
    const classCounts={};
    grades.forEach(g=>{ classCounts[g]=Math.min(60,Math.max(1,Number(f[`grade-${g}`]?.value||1))); });
    const active=!!f.schoolActive?.checked;
    const patch={grades,classCounts,active,updatedAt:ts()};
    if(isAdmin()&&f.eduDomains){ patch.eduDomains=String(f.eduDomains?.value||'').split('\n').map(x=>x.trim().toLowerCase()).filter(x=>/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)).slice(0,20); }
    if(isAdmin()&&f.fileRetentionDays){ patch.fileRetentionDays=Math.min(3650,Math.max(0,Math.round(Number(f.fileRetentionDays?.value||0)))); }
    try{ await db.collection('schools').doc(sid).update(patch); }
    catch(e){ console.error(e); return toast(errText(e)); }
    state.schoolList=null;
    if(state.profile?.schoolId===sid){ state.school={grades,classCounts}; state.schoolInfo={...(state.schoolInfo||{}),id:sid,grades,classCounts}; }
    closeModal(); toast('학교 설정을 저장했어요.'); renderAdminPanel('school');
  }
  async function deleteSchool(sid){
    if(!sid) return;
    if(!isAdmin()) return toast('학교 삭제는 총관리자만 할 수 있어요.');
    openDangerConfirm({
      title:'이 학교를 삭제할까요?',
      desc:'학생들이 더 이상 이 학교로 가입할 수 없어요. 이미 가입한 계정·채팅 기록은 그대로 남아 절대 저절로 지워지지 않아요.',
      requireText:'학교 삭제를 원합니다.', seconds:5, confirmLabel:'삭제하기',
      checkLabel:'위 내용을 이해했고, 학교 삭제를 원합니다.',
      onConfirm: async ()=>{
        try{ await db.collection('schools').doc(sid).delete(); }catch(e){ console.error(e); }
        try{ await db.collection('schoolCodes').doc(sid).delete(); }catch(e){ console.error(e); }
        state.schoolList=null; closeAllModals(); toast('학교를 삭제했어요.'); renderAdminPanel('school');
      }
    });
  }
  async function linkSchoolData(sid){
    if(!sid) return;
    const s=state.schoolList?.find(x=>x.id===sid)||state.schoolEdit?.data||{};
    const name=s.name||'';
    openDangerConfirm({
      title:'기존 계정·채팅방을 이 학교로 연결할까요?',
      desc:'학교 정보가 없던 계정·프로필·채팅방에 이 학교를 붙여요. 되돌릴 수 없어요.',
      requireText:'', seconds:5, confirmLabel:'연결하기',
      checkLabel:'위 내용을 이해했고, 연결해도 됩니다.',
      onConfirm: async ()=>{
        let n=0;
        for(const col of ['users','publicProfiles','channels']){
          let snap; try{ snap=await db.collection(col).limit(400).get(); }catch(e){ continue; }
          const need=snap.docs.filter(d=>!d.data().schoolId);
          for(let i=0;i<need.length;i+=400){
            const chunk=need.slice(i,i+400);
            const b=db.batch();
            chunk.forEach(d=>b.update(d.ref,{schoolId:sid,schoolName:name}));
            await b.commit(); n+=chunk.length;
          }
        }
        try{ await db.collection('users').doc(uid()).update({schoolId:sid,schoolName:name}); state.profile.schoolId=sid; state.profile.schoolName=name; }catch(e){ console.error(e); }
        state.adminUsers=null; state.schoolList=null;
        await loadSchool();
        reattachAll();
        toast(`${n}개 문서를 이 학교로 연결했어요.`);
      }
    });
  }
  // ---------- 관리자 · 채팅 관리 (금지어 · 채팅 정지 · 타임아웃) ----------
  function fmtDurationLeft(until){
    const ms=Number(until||0)-Date.now();
    if(ms<=0) return '지남';
    return fmtRemain(ms);
  }
  async function renderChatAdmin(p){
    if(!isAdmin()) return;
    const c=chatCfg();
    const allTo=Number(c.timeoutAllUntil||0)>Date.now();
    p.innerHTML=`<div class="admin-card"><h3>채팅 정지</h3><p class="desc">이용 정지와는 별개로, 메시지 보내기만 잠시 멈출 수 있어요. (선생님·관리자는 영향을 받지 않아요)</p>
        <div class="setting-row"><div class="setting-label"><strong>전체 채팅 정지</strong></div><button type="button" class="soft-btn" style="flex:0 0 110px" data-action="chat-off-all">${c.chatOffAll?'정지 풀기':'전체 정지'}</button></div>
        <div class="setting-row"><div class="setting-label"><strong>채팅방 하나만 정지</strong></div></div>
      </div>
      <div class="admin-card" style="margin-top:14px"><h3>전체 타임아웃</h3><p class="desc">정한 시간 동안 모든 학생이 메시지를 보낼 수 없어요. 채팅창에 남은 시간이 표시돼요.</p>
        ${allTo?`<div class="form-error" style="margin:0 0 10px">지금 전체 타임아웃 중이에요 · 남은 시간 ${esc(fmtDurationLeft(c.timeoutAllUntil))}${c.timeoutAllReason?` · 사유: ${esc(c.timeoutAllReason)}`:''}</div>`:''}
        <div class="field"><label>기간</label><div class="custom-select"><button type="button" class="select-button" data-select-open="allTimeout"><span data-selected="allTimeout" data-value="600">10분</span><span>⌄</span></button></div></div>
        <div class="field" id="allTimeoutCustomWrap" style="display:none"><label>직접 입력 (분)</label><input id="allTimeoutCustom" class="input" type="number" min="1" max="43200" inputmode="numeric" placeholder="예: 2"></div>
        <div class="field"><label>사유 (선택)</label><input id="allTimeoutReason" class="input" maxlength="80" placeholder="예: 수업 시간에는 조용히 해 주세요."></div>
        <div class="modal-actions" style="margin-top:6px">${allTo?`<button type="button" class="cancel" data-action="timeout-all-clear">타임아웃 풀기</button>`:''}<button type="button" class="confirm" style="flex:1" data-action="timeout-all">전체 타임아웃 주기</button></div>
      </div>
      <div class="admin-card" style="margin-top:14px"><h3>금지어 관리</h3><p class="desc">한 줄에 하나씩 적어 주세요. 띄어쓰기와 대소문자는 무시하고 찾아요.</p>
        <div class="field"><label>보내지 못하는 말 (전송 자체가 막혀요)</label><textarea id="blockWords" class="input word-box" placeholder="예: 욕설1&#10;금지어2">${esc((c.blockWords||[]).join('\n'))}</textarea>
          <div class="word-preview">${(c.blockWords||[]).map(w=>`<span class="word-chip block">${esc(w)}</span>`).join('')||'<span class="mini muted">아직 없어요.</span>'}</div></div>
        <div class="field"><label>예외 단어 (이 말이 들어 있으면 차단하지 않아요)</label><textarea id="allowWords" class="input word-box" placeholder="예: 시발역&#10;ㅅㅂㄹ">${esc((c.allowWords||[]).join('\n'))}</textarea>
          <div class="word-preview">${(c.allowWords||[]).map(w=>`<span class="word-chip">${esc(w)}</span>`).join('')||'<span class="mini muted">아직 없어요.</span>'}</div>
          <p class="desc" style="margin:7px 0 0;font-size:12px">문맥을 보는 AI 없이 글자로만 검사해서 정상적인 말이 막힐 수 있어요. 그런 말을 여기에 적으면 그 말이 들어간 메시지는 통과돼요.</p></div>
        <div class="field"><label>경고하는 말 (보내지지만 경고가 쌓여요)</label><textarea id="warnWords" class="input word-box" placeholder="예: 바보&#10;멍청">${esc((c.warnWords||[]).join('\n'))}</textarea>
          <div class="word-preview">${(c.warnWords||[]).map(w=>`<span class="word-chip warn">${esc(w)}</span>`).join('')||'<span class="mini muted">아직 없어요.</span>'}</div></div>
        <div class="field"><label>심각 키워드 (자동 경고 + 관리자 플래그)</label><textarea id="flagWords" class="input word-box" placeholder="예: 시험지&#10;답지&#10;정답">${esc((c.flagWords||[]).join('\n'))}</textarea>
          <div class="word-preview">${(c.flagWords||[]).map(w=>`<span class="word-chip block">${esc(w)}</span>`).join('')||'<span class="mini muted">아직 없어요.</span>'}</div>
          <p class="desc" style="margin:7px 0 0;font-size:12px">이 말이 들어오면 보내되, 자동으로 경고를 남기고 <b>신고 관리</b>에 감지 기록이 쌓여요.</p></div>
        <div class="field"><label>경고 한도</label><input id="warnLimitInput" class="input" type="number" min="1" max="10" value="${warnLimit()}"><p class="desc" style="margin:7px 0 0;font-size:12px">경고가 이 횟수만큼 쌓이면 아래 시간 동안 타임아웃돼요. (경고는 0으로 초기화돼요)</p></div>
        <div class="field"><label>경고 누적 타임아웃 시간</label><div class="custom-select"><button type="button" class="select-button" data-select-open="warnTimeout"><span data-selected="warnTimeout" data-value="${warnTimeoutMin()*60}">${esc(fmtMinLabel(warnTimeoutMin()))}</span><span>⌄</span></button></div><div class="field" id="warnTimeoutCustomWrap" style="display:none;margin-top:8px"><label>직접 입력 (분)</label><input id="warnTimeoutCustom" class="input" type="number" min="1" max="1440" inputmode="numeric" placeholder="예: 2"></div><p class="desc" style="margin:7px 0 0;font-size:12px">한도까지 쌓인 학생은 이 시간 동안 메시지를 보낼 수 없어요. (이용 정지와는 달라요)</p></div>
        <div class="modal-actions" style="margin-top:6px"><button type="button" class="confirm" style="flex:1" data-action="save-chat-words">금지어 저장</button></div>
      </div>
      <div class="admin-card" style="margin-top:14px"><h3>모두에게 상단 고정</h3><p class="desc">고정한 채팅방은 모든 사용자의 목록 맨 위에 나타나요. (사용자가 직접 고정한 방보다 더 위)</p><div id="pinRoomList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>
      <p class="desc" style="margin-top:14px">학생 한 명만 멈추려면 <b>사용자</b> 탭에서 그 학생을 찾아 <b>타임아웃</b>을 눌러 주세요.</p>`;
    const sel=$('[data-select-open="allTimeout"]');
    if(sel) wireDropdown(sel,[{value:60,label:'1분'},{value:300,label:'5분'},{value:600,label:'10분'},{value:1800,label:'30분'},{value:3600,label:'1시간'},{value:10800,label:'3시간'},{value:86400,label:'하루'},{value:604800,label:'일주일'},{value:'custom',label:'직접 입력…'}],(v,l)=>{sel.querySelector('[data-selected]').textContent=l;sel.querySelector('[data-selected]').dataset.value=String(v);const w=$('#allTimeoutCustomWrap');if(w)w.style.display=(v==='custom')?'':'none';});
    const wsel=$('[data-select-open="warnTimeout"]');
    if(wsel) wireDropdown(wsel,[...WARN_TIMEOUT_OPTIONS,{value:'custom',label:'직접 입력…'}],(v,l)=>{wsel.querySelector('[data-selected]').textContent=l;wsel.querySelector('[data-selected]').dataset.value=String(v);const w=$('#warnTimeoutCustomWrap');if(w)w.style.display=(v==='custom')?'':'none';});
    renderAdminPinRooms();
  }
  async function renderAdminPinRooms(){
    const host=$('#pinRoomList'); if(!host) return;
    let rows=[];
    // 개인·모둠 대화는 볼 수 없다. 관리자는 '우리 학교 전체 공유' 채팅방만 다룰 수 있다.
    try{ const s=await db.collection('channels').where('visibility','==','all').limit(200).get(); rows=s.docs.map(d=>({id:d.id,...d.data()})).filter(r=>!r.deleted); }
    catch(e){ console.error(e); host.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; return; }
    const pins=(chatCfg().pinnedRooms||[]);
    host.innerHTML=rows.map(r=>{
      const on=pins.includes(r.id);
      return `<div class="list-item"><div class="grow"><div class="title">${esc(r.name||'채팅방')}</div><div class="meta">${(r.memberIds||[]).length}명 · ${r.visibility==='all'?'공유':r.visibility==='private'?'개인':'대상 지정'}</div></div><button class="soft-btn" style="flex:0 0 76px" data-action="admin-pin-room" data-room-id="${esc(r.id)}">${on?'고정 해제':'위로 고정'}</button></div>`;
    }).join('')||'<div class="empty-side">채팅방이 없어요.</div>';
  }
  async function toggleAdminPinRoom(id){
    if(!isAdmin()||!id) return;
    const cur=new Set(chatCfg().pinnedRooms||[]);
    const on=!cur.has(id);
    if(on) cur.add(id); else cur.delete(id);
    try{ await db.collection('chatSettings').doc('main').set({pinnedRooms:[...cur],updatedAt:ts()},{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast(on?'모든 사용자에게 상단 고정했어요.':'고정을 풀었어요.');
    renderAdminPinRooms();
  }
  async function saveChatWords(){
    if(!isAdmin()) return;
    const parse=id=>String($('#'+id)?.value||'').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,200);
    const blockWords=parse('blockWords'), allowWords=parse('allowWords'), warnWords=parse('warnWords'), flagWords=parse('flagWords');
    const lim=Math.min(10,Math.max(1,Number($('#warnLimitInput')?.value)||3));
    const warnSelVal=$('[data-selected="warnTimeout"]')?.dataset.value;
    const warnCustomMin=Math.round(Number($('#warnTimeoutCustom')?.value)||0);
    if(warnSelVal==='custom'&&!(warnCustomMin>0)) return toast('경고 타임아웃 직접 입력 칸에 분을 적어 주세요.');
    const toMin=warnSelVal==='custom'
      ? Math.min(1440,Math.max(1,warnCustomMin))
      : Math.min(1440,Math.max(1,Math.round((Number(warnSelVal||1800))/60)));
    try{ await db.collection('chatSettings').doc('main').set({blockWords,allowWords,warnWords,flagWords,warnLimit:lim,warnTimeoutMin:toMin,updatedAt:ts()},{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast('금지어를 저장했어요.');
    renderChatAdmin($('#adminPanel'));
  }
  async function applyTimeoutAll(){
    if(!isAdmin()) return;
    const sel=$('[data-selected="allTimeout"]');
    const customMin=Math.round(Number($('#allTimeoutCustom')?.value)||0);
    if(sel?.dataset.value==='custom'&&!(customMin>0)) return toast('직접 입력 칸에 분을 적어 주세요.');
    const min=(sel?.dataset.value==='custom')
      ? Math.min(43200,Math.max(1,customMin))
      : Math.max(1,Math.round(Number(sel?.dataset.value||600)/60));
    const reason=($('#allTimeoutReason')?.value||'').trim();
    const until=Date.now()+min*60000;
    try{ await db.collection('chatSettings').doc('main').set({timeoutAllUntil:until,timeoutAllReason:reason,updatedAt:ts()},{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast(`${min}분 동안 전체 타임아웃을 걸었어요.`);
    renderChatAdmin($('#adminPanel'));
  }
  async function clearTimeoutAll(){
    if(!isAdmin()) return;
    try{ await db.collection('chatSettings').doc('main').set({timeoutAllUntil:0,timeoutAllReason:'',updatedAt:ts()},{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast('전체 타임아웃을 풀었어요.');
    renderChatAdmin($('#adminPanel'));
  }
  async function openTimeoutModal(targetUid,targetName){
    if(!(isAdmin()||isSchoolAdmin())||!targetUid) return;
    if(targetUid===uid()) return toast('자기 자신에게는 줄 수 없어요.');
    if(isSchoolAdmin()&&!isAdmin()){
      let tu=null;
      try{ const s=await db.collection('users').doc(targetUid).get(); if(s.exists) tu=s.data(); }catch(e){ console.error(e); return toast(errText(e)); }
      if(!tu||tu.deleted||(tu.schoolId||'')!==(state.profile?.schoolId||'')) return toast('우리 학교 구성원에게만 할 수 있어요.');
    }
    openModal(`<h2>채팅 타임아웃</h2><p class="desc">${esc(targetName||'사용자')}님이 정한 시간 동안 메시지를 보낼 수 없어요. (이용 정지와는 달라요)</p>
      <div class="field"><label>기간</label><div class="custom-select"><button type="button" class="select-button" data-select-open="toDuration"><span data-selected="toDuration" data-value="1800">30분</span><span>⌄</span></button></div></div>
      <div class="field" id="toDurationCustomWrap" style="display:none"><label>직접 입력 (분)</label><input id="toDurationCustom" class="input" type="number" min="1" max="10080" inputmode="numeric" placeholder="예: 2"></div>
      <div class="field"><label>사유 (선택)</label><input id="toReason" class="input" maxlength="80" placeholder="예: 같은 말을 반복해서 도배했어요."></div>
      ${isAdmin()?'<label class="choice" style="margin-bottom:4px"><input type="checkbox" id="toPermanent"> 내가 풀어 줄 때까지 계속</label>':'<p class="desc" style="margin:0 0 4px;font-size:12px">학교 관리자는 최대 30일까지만 줄 수 있어요. (계속 타임아웃은 총관리자만)</p>'}
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" data-action="timeout-apply" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}">타임아웃 주기</button></div>
      <button type="button" class="soft-btn" style="width:100%;margin-top:8px" data-action="timeout-clear" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}">타임아웃 풀기</button>`);
    const sel=$('[data-select-open="toDuration"]');
    if(sel) wireDropdown(sel,[{value:60,label:'1분'},{value:300,label:'5분'},{value:1800,label:'30분'},{value:3600,label:'1시간'},{value:10800,label:'3시간'},{value:86400,label:'하루'},{value:604800,label:'일주일'},{value:'custom',label:'직접 입력…'}],(v,l)=>{sel.querySelector('[data-selected]').textContent=l;sel.querySelector('[data-selected]').dataset.value=String(v);const w=$('#toDurationCustomWrap');if(w)w.style.display=(v==='custom')?'':'none';});
  }
  async function applyTimeout(targetUid,targetName){
    if(!(isAdmin()||isSchoolAdmin())||!targetUid) return;
    if(targetUid===uid()&&!isAdmin()) return toast('자기 자신에게는 줄 수 없어요.');
    if(isSchoolAdmin()&&!isAdmin()){
      let tu=null;
      try{ const s=await db.collection('users').doc(targetUid).get(); if(s.exists) tu=s.data(); }catch(e){ console.error(e); return toast(errText(e)); }
      if(!tu||tu.deleted||(tu.schoolId||'')!==(state.profile?.schoolId||'')) return toast('우리 학교 구성원에게만 할 수 있어요.');
    }
    const perm=!!$('#toPermanent')?.checked;
    const toSelVal=$('[data-selected="toDuration"]')?.dataset.value;
    const toCustomMin=Math.round(Number($('#toDurationCustom')?.value)||0);
    if(toSelVal==='custom'&&!(toCustomMin>0)) return toast('직접 입력 칸에 분을 적어 주세요.');
    const ms=toSelVal==='custom'
      ? Math.min(10080*60000,Math.max(60000,toCustomMin*60000))
      : Math.max(60,Number(toSelVal||1800))*1000;
    const reason=($('#toReason')?.value||'').trim();
    const ok=await countConfirm({title:`${targetName||'사용자'}님에게 타임아웃을 줄까요?`,desc:`${perm?'내가 풀어 줄 때까지 계속돼요.':fmtRemain(ms)+' 동안 메시지를 보낼 수 없어요.'}${reason?` 사유: ${reason}`:''}`,confirmLabel:'주기',seconds:5});
    if(!ok) return;
    const data={reason,permanent:perm,until:perm?null:(Date.now()+ms),by:uid(),byName:state.profile?.displayName||'',updatedAt:ts()};
    try{ await db.collection('chatTimeouts').doc(targetUid).set(data,{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    closeAllModals();
    if(state.view==='admin') renderAdminPanel(state.adminTab);
    toast(perm?`${targetName||'사용자'}님을 해제할 때까지 타임아웃했어요.`:`${targetName||'사용자'}님에게 타임아웃을 줬어요.`);
    try{ await logAdminAudit('timeout',`${targetName||'사용자'}${reason?' · '+reason:''}`,targetUid); }catch(e){}
    try{ await notifyAccountAction(targetUid,`채팅 타임아웃이 걸렸어요.${reason?` 사유: ${reason}`:''} 시간이 지나면 자동으로 풀려요.`); }catch(e){}
  }
  async function clearTimeoutUser(targetUid,targetName){
    if(!(isAdmin()||isSchoolAdmin())||!targetUid) return;
    if(isSchoolAdmin()&&!isAdmin()){
      let tu=null;
      try{ const s=await db.collection('users').doc(targetUid).get(); if(s.exists) tu=s.data(); }catch(e){ console.error(e); return toast(errText(e)); }
      if(!tu||tu.deleted||(tu.schoolId||'')!==(state.profile?.schoolId||'')) return toast('우리 학교 구성원에게만 할 수 있어요.');
    }
    try{ await db.collection('chatTimeouts').doc(targetUid).delete(); }
    catch(e){ console.error(e); return toast(errText(e)); }
    closeAllModals();
    if(state.view==='admin') renderAdminPanel(state.adminTab);
    toast(`${targetName||'사용자'}님의 타임아웃을 풀었어요.`);
  }
  async function resetWarns(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    let cur=0;
    try{ const s=await db.collection('users').doc(targetUid).get(); cur=Number(s.exists?(s.data()?.warnCount||0):0); }catch(e){}
    if(!(cur>0)) return toast('지울 경고가 없어요.');
    openModal(`<h2>경고 지우기</h2><p class="desc">${esc(targetName||'사용자')}님은 지금 경고 ${cur}개예요. 몇 개 지울까요?</p><div class="field"><label>개수 (1~${cur} · 전부 지우려면 ${cur})</label><input id="unwarnCountInput" class="input" type="number" min="1" max="${cur}" value="${cur}"></div><div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="unwarnGo">지우기</button></div>`,{small:true});
    $('#unwarnGo').onclick=async()=>{
      const n=Math.min(cur,Math.max(1,Math.round(Number($('#unwarnCountInput')?.value||cur))));
      try{ await db.collection('users').doc(targetUid).update({warnCount:Math.max(0,cur-n),updatedAt:ts()}); }
      catch(e){ console.error(e); return toast(errText(e)); }
      try{ await logAdminAudit('unwarn',`${targetName||'사용자'} -${n}`,targetUid); }catch(e){}
      closeModal();
      if(state.view==='admin') renderAdminPanel(state.adminTab);
      toast(`경고를 ${n}개 지웠어요.`);
    };
  }

  function reattachAll(){
    state.listeners.forEach(fn=>{try{fn()}catch{}}); state.listeners=[];
    clearRoomListener(); clearInviteListener(); clearSiteNoticeListener(); clearChatLockListeners(); clearModerationListeners(); clearRoleListeners();
    if(noticeUnsub){try{noticeUnsub()}catch{} noticeUnsub=null;}
    state.profileUnsubs.forEach(fn=>{try{fn()}catch{}}); state.profileUnsubs=[]; state.profileListeningKey='';
    attachRoomListeners(); attachInviteListener(); attachNoticeListener(); attachSiteNoticeListener(); attachChatLockListeners(); attachModerationListeners(); attachRoleListeners(); attachDutyListeners();
    watchSuspension();   // 목록을 다시 붙일 때 정지 감시가 빠지지 않게 다시 건다
  }
  // ---------- 관리자 · 오검열 이의 신청 (검열된 메시지 복구) ----------
  async function renderModAppeals(p){
    if(!p) return;
    if(!isTeacher()) return;
    p.innerHTML=`<div class="admin-card"><h3>오검열 이의 신청</h3><p class="desc">자동 검열로 보내지 못한 메시지에 대한 이의 신청이에요. <b>복구</b>를 누르면 그 메시지가 채팅방에 원래 시각 그대로 다시 나타나요.${isAdmin()?'':' 내가 만든 채팅방의 신청만 볼 수 있어요.'}</p>
      <div class="admin-toolbar"><button type="button" class="soft-btn" data-action="refresh-modappeals">새로고침</button></div>
      <div id="modAppealList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>`;
    let rows=[];
    try{
      // 관리자는 전체, 교사는 자기 채팅방의 신청만 (다른 사람 대화는 보지 않는다)
      // 조건을 하나로 유지해 색인(인덱스) 준비 없이도 바로 동작하게 한다
      const q=isAdmin()
        ? db.collection('moderationAppeals').where('status','==','open').limit(100)
        : db.collection('moderationAppeals').where('roomOwnerId','==',uid()).limit(100);
      const s=await q.get();
      rows=s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==='open');
    }catch(e){
      console.error('modappeals',e);
      const h=$('#modAppealList');
      if(h) h.innerHTML=`<div class="empty-side">불러오지 못했어요.${e?.code==='failed-precondition'?' (데이터베이스 색인이 필요할 수 있어요.)':''}</div>`;
      return;
    }
    const host=$('#modAppealList'); if(!host) return;
    host.innerHTML=rows.map(x=>`<div class="list-item"><div class="grow">
        <div class="title">${esc(x.senderName||'학생')} <span class="mini muted">· ${esc(x.roomName||'채팅방')}</span></div>
        <div class="meta mod-quote">${esc(x.text||'')}</div>
        <div class="meta">사유: ${esc(x.reason||'적지 않음')}</div>
        <div class="admin-meta"><span class="admin-chip warn">걸린 말 ${esc(x.word||'')}</span><span class="admin-chip">${esc(fmtDateTime(x.createdAt))}</span></div>
        ${(!isAdmin()||x.roomOwnerId===uid())
          ? `<div class="admin-btns">
          <button type="button" class="soft-btn" data-action="mod-approve" data-id="${esc(x.id)}">복구(승인)</button>
          <button type="button" class="soft-btn" data-action="mod-reject" data-id="${esc(x.id)}">거부</button>
        </div>`
          : `<div class="meta" style="margin-top:8px">복구·거부는 담당 선생님이 처리해요. (개인 대화는 관리자도 볼 수 없어요)</div>`}
      </div></div>`).join('')||'<div class="empty-side">새로 들어온 이의 신청이 없어요.</div>';
  }
  async function resolveModAppeal(appealId,approve){
    if(!isTeacher() || !appealId) return;
    const ref=db.collection('moderationAppeals').doc(appealId);
    let a=null;
    try{ const s=await ref.get(); if(!s.exists) return toast('이미 처리된 이의 신청이에요.'); a=s.data(); }
    catch(e){ console.error(e); return toast(errText(e)); }
    const run=async()=>{
      try{
        const bRef=a.blockId?db.collection('moderationBlocks').doc(a.blockId):null;
        if(bRef){
          const bs=await bRef.get();
          const b=bs.exists?bs.data():null;
          if(approve && b && b.status==='blocked'){
            // 원래 시각을 그대로 써서 대화 흐름 속 원래 자리에 복구한다
            // appealBlockId 를 함께 남겨, 규칙이 '원래 작성자'와 '그 방'이 맞는지 검증할 수 있게 한다
            await db.collection('channels').doc(b.roomId).collection('messages').add({
              text:String(b.text||'').slice(0,MOD_TEXT_MAX), senderId:b.senderId, senderName:b.senderName||'',
              senderRole:b.senderRole||'student', replyToText:null,
              createdAt:b.createdAt||ts(), deleted:false, appealRestored:true, appealBlockId:String(a.blockId||''), appealRestoredBy:uid()
            });
            await bRef.update({status:'approved',resolvedBy:uid(),resolvedAt:ts()});
          }else if(!approve){
            try{ await bRef.update({status:'rejected',resolvedBy:uid(),resolvedAt:ts()}); }catch(e){ console.error(e); }
          }
        }
        await ref.update({status:approve?'approved':'rejected',handledBy:uid(),handledAt:ts()});
      }catch(e){
        console.error('resolveModAppeal',e);
        return toast(e?.code==='permission-denied'?'이 채팅방은 담당 선생님만 복구할 수 있어요.':errText(e));
      }
      toast(approve?'메시지를 복구했어요.':'이의 신청을 거부했어요.');
      renderAdminPanel(state.adminTab);
    };
    if(approve) confirmModal('이 메시지를 복구할까요?','채팅방에 원래 시각 그대로 다시 나타나요. 참여자 모두가 볼 수 있게 돼요.',run);
    else confirmModal('이의 신청을 거부할까요?','메시지는 복구되지 않고 그대로 남아요.',run);
  }
  // ---------- 관리자 · 신고 관리 ----------
  async function renderReports(p){
    if(!isAdmin() && state.profile?.role!=='teacher') return;
    p.innerHTML=`<div class="admin-card"><h3>신고 관리</h3><p class="desc">신고가 접수된 대화만 확인할 수 있어요. 신고 시점의 대화 ${REPORT_SNAPSHOT_MAX}개가 함께 보관돼 있고, 확인이 끝나면 처리 완료로 바꿔 주세요.</p><div class="admin-toolbar"><button type="button" class="soft-btn" data-action="purge-reports">처리한 신고 모두 지우기</button></div><div id="reportList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>${isAdmin()?`<div class="admin-card" style="margin-top:14px"><h3>자동 감지 기록</h3><p class="desc">금지어·심각 키워드, 그리고 주의가 필요한 사진(자동 검열)이 감지되면 자동으로 남는 기록이에요. (최근 50개)</p><div id="flagList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>`:''}`;
    const host=$('#reportList'); if(!host) return;
    try{
      if(isAdmin()){
        const snap=await db.collection('reports').orderBy('createdAt','desc').limit(100).get();
        state.reports=snap.docs.map(d=>({id:d.id,...d.data()}));
      }else{
        // 학생 신고는 해당 학교 교사에게 간다 (자기 방이 아니어도 같은 학교 건은 본다)
        const mySid=state.profile?.schoolId||'';
        const snap=await db.collection('reports').where('schoolId','==',mySid).limit(200).get();
        state.reports=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>docTs(b.createdAt)-docTs(a.createdAt));
      }
    }catch(e){ console.error(e); state.reports=[]; }
    if(!state.reports.length){
      host.innerHTML='<div class="empty-side">신고가 아직 없어요.</div>';
    }else{
      host.innerHTML=state.reports.map(x=>{
        const resolved=x.status==='resolved';
        const cnt=Array.isArray(x.snapshot)?x.snapshot.length:0;
        const tgt=x.targetName?`${esc(x.targetName)}님`:'대화';
        return `<div class="list-item"><div class="grow" style="cursor:pointer" data-action="open-report" data-id="${x.id}"><div class="title">${esc(x.reasonLabel||'신고')} <span class="mini muted">· ${tgt}</span>${resolved?' <span class="admin-chip">처리 완료</span>':' <span class="admin-chip warn">확인 필요</span>'}</div><div class="meta">${esc(x.reporterName||'사용자')}님이 신고 · 대화 ${cnt}개 보관</div><div class="admin-meta"><span class="admin-chip">${esc(fmtDateTime(x.createdAt))}</span>${x.roomName?`<span class="admin-chip">${esc(x.roomName)}</span>`:''}${x.detail?`<span class="admin-chip">${esc(String(x.detail).slice(0,50))}</span>`:''}</div></div><div class="appeal-btns"><button class="soft-btn" style="flex:0 0 62px" data-action="open-report" data-id="${x.id}">자세히</button>${isAdmin()?`<button class="soft-btn" style="flex:0 0 52px;color:var(--danger)" data-action="delete-report" data-id="${x.id}">삭제</button>`:''}</div></div>`;
      }).join('');
    }
    loadModerationFlags();
  }
  async function loadModerationFlags(){
    const host=$('#flagList'); if(!host) return;
    try{
      const snap=await db.collection('moderationFlags').orderBy('createdAt','desc').limit(50).get();
      const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
      host.innerHTML=rows.length?rows.map(f=>`<div class="list-item"><div class="grow"><div class="title">${esc(f.byName||'사용자')} <span class="mini muted">· ${flagKindLabel(f.kind)}</span></div><div class="meta">${esc(String(f.text||'').slice(0,60))}</div><div class="admin-meta"><span class="admin-chip warn">${esc(f.word||'')}</span><span class="admin-chip">${esc(fmtDateTime(f.createdAt))}</span>${f.roomName?`<span class="admin-chip">${esc(f.roomName)}</span>`:''}</div></div></div>`).join(''):'<div class="empty-side">감지된 기록이 없어요.</div>';
    }catch(e){ console.error(e); host.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; }
  }
  function flagKindLabel(kind){
    if(kind==='serious') return '심각 키워드';
    if(kind==='image') return '사진 검열';
    if(kind==='profile-image') return '프로필 사진 검열';
    return '금지어';
  }
  function openReportDetail(id){
    const x=(state.reports||[]).find(r=>r.id===id);
    if(!x) return;
    const snap=Array.isArray(x.snapshot)?x.snapshot:[];
    const tgt=x.targetUid?`${esc(x.targetName||'사용자')}님`:(x.roomName?esc(x.roomName):'대화');
    const rows=snap.map(m=>{
      const hit=x.targetUid&&m.uid===x.targetUid;
      return `<div class="snap-row${hit?' hit':''}"><div class="snap-head"><b>${esc(m.name||'사용자')}</b></div><div class="snap-text">${esc(m.text||'')}</div></div>`;
    }).join('')||'<div class="empty-side">보관된 대화가 없어요.</div>';
    openModal(`<h2>신고 내용</h2>
      <p class="desc">${esc(x.reasonLabel||'신고')} · ${esc(fmtDateTime(x.createdAt))}</p>
      <div class="admin-meta"><span class="admin-chip">신고자 ${esc(x.reporterName||'사용자')}</span><span class="admin-chip">대상 ${tgt}</span>${x.roomName?`<span class="admin-chip">${esc(x.roomName)}</span>`:''}<span class="admin-chip ${x.status==='resolved'?'':'warn'}">${x.status==='resolved'?'처리 완료':'확인 필요'}</span></div>
      ${x.detail?`<div class="field" style="margin-top:14px"><label>신고자가 적은 내용</label><div class="report-detail">${esc(x.detail)}</div></div>`:''}
      <div class="field" style="margin-top:14px"><label>신고 시점의 대화 (${snap.length}개)</label><div class="snap-list">${rows}</div></div>
      <div class="modal-actions" style="flex-wrap:wrap">
        <button type="button" class="cancel" data-close-modal>닫기</button>
        ${x.status==='resolved'?'':`<button type="button" class="soft-btn" style="flex:1 1 120px;height:46px" data-action="resolve-report" data-id="${x.id}">처리 완료</button>`}
        ${x.targetUid?`<button type="button" class="soft-btn" style="flex:1 1 120px;height:46px" data-action="warn-by-report" data-id="${x.id}" data-uid="${esc(x.targetUid)}" data-name="${esc(x.targetName||'')}">경고 주기</button>
        <button type="button" class="danger-btn" style="flex:1 1 120px;height:46px" data-action="suspend-by-report" data-id="${x.id}" data-uid="${esc(x.targetUid)}" data-name="${esc(x.targetName||'')}">이용 정지</button>`:''}
      </div>`);
  }
  async function markReportResolved(id){
    try{ await db.collection('reports').doc(id).update({status:'resolved',resolvedAt:ts(),resolvedBy:uid()}); }catch(e){ console.error(e); }
    state.reports=(state.reports||[]).map(x=>x.id===id?{...x,status:'resolved'}:x);
  }
  async function warnByReport(id,targetUid,targetName){
    if(!targetUid) return;
    return warnUserDirect(targetUid,targetName||'사용자',id);
  }
  // 15번: 프로필 화면에서 바로 경고 + 상세 설정으로 이동
  async function warnUserDirect(targetUid,targetName,reportId,count){
    if(!targetUid) return;
    if(!(isAdmin()||isTeacher()||isSchoolAdmin())) return toast('관리자만 경고를 줄 수 있어요.');
    const n=Math.min(99,Math.max(1,Number(count)||1));
    confirmModal(`${targetName||'사용자'}님에게 경고를 ${n}개 줄까요?`,'경고가 쌓이면 채팅을 보낼 수 없게 돼요.',async()=>{
      try{
        const ref=db.collection('users').doc(targetUid);
        const cur=Number((await ref.get()).data()?.warnCount||0);
        await ref.update({warnCount:cur+n,warnUpdatedAt:ts(),updatedAt:ts()});
        if(reportId) await markReportResolved(reportId);
      }catch(e){ console.error(e); return toast(errText(e)); }
      closeAllModals(); toast(`경고를 ${n}개 줬어요.`);
      try{ await logAdminAudit('warn',`${targetName||'사용자'} +${n}`,targetUid); }catch(e){}
      try{ if(state.view==='admin') renderAdminPanel(state.adminTab); }catch(e){}
    });
  }
  function openWarnCountModal(targetUid,targetName){
    if(!(isAdmin()||isTeacher()||isSchoolAdmin())) return;
    openModal(`<h2>경고 주기</h2><p class="desc">${esc(targetName||'사용자')}님에게 한 번에 몇 개 줄까요?</p><div class="field"><label>개수 (1~99)</label><input id="warnCountInput" class="input" type="number" min="1" max="99" value="1"></div><div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="warnGo">주기</button></div>`,{small:true});
    $('#warnGo').onclick=()=>{ const n=Math.min(99,Math.max(1,Math.round(Number($('#warnCountInput')?.value||1)))); closeModal(); warnUserDirect(targetUid,targetName,undefined,n); };
  }
  function openAdminUserDetail(targetUid,targetName){
    if(!isAdmin()) return toast('관리자만 볼 수 있어요.');
    state.adminUserSearch=String(targetName||'');
    state.adminUserFocus=targetUid;
    openAdmin('users');
    setTimeout(()=>{
      try{
        const inp=$('#userSearch');
        if(inp&&state.adminUserSearch){ inp.value=state.adminUserSearch; inp.dispatchEvent(new Event('input',{bubbles:true})); }
      }catch(e){}
    },600);
  }
  async function suspendByReport(id,targetUid,targetName){
    if(!targetUid) return;
    confirmModal(`${targetName||'사용자'}님의 이용을 정지할까요?`,'정지된 계정은 안내 화면만 보게 돼요.',async()=>{
      try{
        await db.collection('users').doc(targetUid).update({suspended:true,suspendReason:'신고 처리',suspendedAt:ts()});
        await markReportResolved(id);
      }catch(e){ console.error(e); return toast(errText(e)); }
      closeAllModals(); toast('이용을 정지하고 처리 완료로 바꿨어요.'); renderAdminPanel('reports');
    });
  }
  async function deleteReport(id){
    if(!isAdmin()||!id) return;
    try{ await db.collection('reports').doc(id).delete(); }catch(e){ console.error(e); return toast(errText(e)); }
    state.reports=state.reports.filter(x=>x.id!==id);
    toast('신고를 지웠어요.'); renderAdminPanel('reports');
  }
  async function purgeReports(){
    if(!isAdmin()) return;
    const done=(state.reports||[]).filter(x=>x.status==='resolved');
    if(!done.length) return toast('처리 완료된 신고가 없어요.');
    confirmModal(`처리한 신고 ${done.length}개를 지울까요?`,'지운 신고는 되돌릴 수 없어요.',async()=>{
      try{
        const batch=db.batch();
        done.slice(0,400).forEach(x=>batch.delete(db.collection('reports').doc(x.id)));
        await batch.commit();
      }catch(e){ console.error(e); return toast(errText(e)); }
      state.reports=state.reports.filter(x=>x.status!=='resolved');
      toast('처리한 신고를 지웠어요.'); renderAdminPanel('reports');
    });
  }
  async function deleteAppeal(id){
    if(!isAdmin()||!id) return;
    try{ await db.collection('appeals').doc(id).delete(); }catch(e){ console.error(e); return toast(errText(e)); }
    toast('이의 제기를 지웠어요.'); renderAdminPanel(state.adminTab);
  }
  async function purgeAppeals(){
    if(!isAdmin()) return;
    let rows=[];
    try{ const s=await db.collection('appeals').where('status','==','resolved').limit(300).get(); rows=s.docs; }catch(e){ console.error(e); return toast(errText(e)); }
    if(!rows.length) return toast('처리한 이의 제기가 없어요.');
    confirmModal(`처리한 이의 제기 ${rows.length}개를 지울까요?`,'지운 기록은 되돌릴 수 없어요.',async()=>{
      try{
        const batch=db.batch();
        rows.forEach(d=>batch.delete(d.ref));
        await batch.commit();
      }catch(e){ console.error(e); return toast(errText(e)); }
      toast('처리한 이의 제기를 지웠어요.'); renderAdminPanel(state.adminTab);
    });
  }
  async function renderNoticeAdmin(p){
    p.innerHTML=`<div class="admin-card"><h3>개인 안내</h3><p class="desc">채팅이 아니라 별도의 안내창으로 보여줄 수 있어요. 한 사람에게만 전달돼요.</p><form id="noticeForm"><div class="field"><label>받는 사람</label><input id="noticeSearch" class="input" placeholder="이름이나 학년/반으로 찾기" style="margin-bottom:8px"><div id="noticeUsers" class="list" style="max-height:280px;overflow:auto"><div class="empty-side">불러오는 중이에요.</div></div></div><div class="field"><label>내용</label><textarea class="input" name="text" maxlength="500" placeholder="전달할 내용을 적어 주세요." required></textarea></div><button class="primary">보내기</button></form></div>`;
    const users=(await loadAdminUsers()).filter(u=>u.id!==uid());
    const render=q=>{
      const host=$('#noticeUsers'); if(!host) return;
      const list=users.filter(u=>matchUser(u,q));
      host.innerHTML=list.map(u=>`<label class="list-item tappable"><input type="radio" name="targetUid" value="${u.id}"><div class="grow"><div class="title">${esc(u.displayName||'사용자')}</div><div class="meta">${gradeClassPrefix(u)}${roleLabel(u.role)}</div></div></label>`).join('')||'<div class="empty-side">찾는 사용자가 없어요.</div>';
    };
    render('');
    $('#noticeSearch')?.addEventListener('input',e=>render(e.target.value));
  }
  async function loadAdminUsers(){
    if(state.adminUsers) return state.adminUsers;
    const sid=state.profile?.schoolId||'';
    const order = isAdmin() ? ['users','publicProfiles'] : ['publicProfiles','users'];
    for(const col of order){
      try{
        const q=(col==='publicProfiles'&&sid)?db.collection(col).where('schoolId','==',sid).limit(600):db.collection(col).limit(600);
        const snap=await q.get();
        state.adminUsers=snap.docs.map(d=>({id:d.id,...d.data()}));
        return state.adminUsers;
      }catch(e){ console.error('load users '+col,e); }
    }
    state.adminUsers=[]; return state.adminUsers;
  }
  function matchUser(u,q){
    const s=String(q||'').trim().toLowerCase(); if(!s) return true;
    return [u.displayName,u.grade,u.classNum,u.email,roleLabel(u.role),u.grade?`${u.grade}학년`:'',u.classNum?`${u.classNum}반`:''].filter(v=>v!=null&&v!=='').join(' ').toLowerCase().includes(s);
  }
  async function sendNotice(f){
    const t=f.querySelector('[name="targetUid"]:checked'); if(!t)return toast('받는 사람을 골라 주세요.');
    const text=(f.text.value||'').trim(); if(!text)return toast('내용을 적어 주세요.');
    try{ await db.collection('directNotices').add({targetUid:t.value,senderId:uid(),senderName:state.profile.displayName,text,read:false,createdAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast('안내를 보냈어요.'); f.reset();
  }
  // ---------- 학교 역할 관리 (반장·부반장·학생회장 등 · 선생님이 만들어 부여) ----------
  // ---------- 익명 건의함 담당자 화면 (작성자 IP·기기 노출 없음 · 신고/삭제·해결만) ----------
  async function suggestBoxOf(){
    const sid=state.profile?.schoolId||'';
    try{ const s=await db.collection('suggestionBoxes').doc(sid).get(); if(s.exists) return {id:sid,...s.data()}; }catch(e){}
    return {id:sid,handlerUid:'',handlerName:''};
  }
  async function renderSuggestHandler(p){
    const sid=state.profile?.schoolId||'';
    const box=await suggestBoxOf();
    const isHandler=box.handlerUid&&box.handlerUid===uid();
    if(!(isAdmin()||isSchoolAdmin()||isHandler)){ p.innerHTML='<div class="empty-side">건의 담당 선생님만 볼 수 있어요.</div>'; return; }
    p.innerHTML=`<div class="admin-card"><h3>익명 건의함</h3><p class="desc">작성자가 누군지·어디서 썼는지 볼 수 없어요. 신고가 필요하면 위로 고정하고, 해결했으면 해결 버튼을 눌러 주세요.<br>학교폭력·아동학대 의심 내용이 보이면 법에 따른 신고 의무가 있어요. 방치하지 말고 학교 절차에 따라 꼭 보고해 주세요.</p><div class="admin-toolbar"><button type="button" class="soft-btn" data-action="suggest-filter" data-f="open">미해결</button><button type="button" class="soft-btn" data-action="suggest-filter" data-f="resolved">해결됨</button><button type="button" class="soft-btn" data-action="suggest-filter" data-f="all">전체</button></div><div id="suggestList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>`;
    await paintSuggestList(state.suggestFilter||'open');
  }
  async function paintSuggestList(filter){
    const sid=state.profile?.schoolId||'';
    const host=$('#suggestList'); if(!host) return;
    try{ $$('#adminPanel [data-action="suggest-filter"]').forEach(b=>b.classList.toggle('active',b.dataset.f===filter)); }catch(e){}
    host.innerHTML=loadingShimmer(4);
    let rows=[];
    try{
      // 복합 인덱스 없이 동작하도록 학교로만 조회하고 상태는 앞에서 거른다
      const s=await db.collection('suggestions').where('schoolId','==',sid).limit(200).get();
      rows=s.docs.map(d=>({id:d.id,...d.data()}));
      if(filter==='resolved') rows=rows.filter(r=>r.status==='resolved');
      else if(filter==='open') rows=rows.filter(r=>r.status==='open'||r.status==='flagged');
    }catch(e){ console.error(e); host.innerHTML='<div class="empty-side">불러오지 못했어요. 규칙을 확인해 주세요.</div>'; return; }
    rows=rows.filter(r=>r.status!=='deleted');
    rows.sort((a,b)=>(b.flagged?1:0)-(a.flagged?1:0)||docTs(b.createdAt)-docTs(a.createdAt));
    if(!rows.length){ host.innerHTML='<div class="empty-side">건의가 없어요.</div>'; return; }
    host.innerHTML=rows.map(r=>`<div class="list-item${r.flagged?' flagged':''}"><div class="grow"><div class="title">${r.legalHold?'<span class="timeout-chip">수사협조 동결 중</span> ':''}${r.flagged?'<span class="timeout-chip">신고 필요</span> ':''}${esc(String(r.text||'').slice(0,120))}</div><div class="meta">${esc(fmtDateTime(r.createdAt))}${r.status==='resolved'?' · 해결됨':''}</div></div><span style="display:flex;gap:6px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end"><button class="soft-btn" style="flex:0 0 auto;padding:0 10px;height:36px" data-action="suggest-view" data-id="${esc(r.id)}">보기</button>${r.status!=='resolved'?`<button class="soft-btn" style="flex:0 0 auto;padding:0 10px;height:36px" data-action="suggest-flag" data-id="${esc(r.id)}">${r.flagged?'신고해제':'신고'}</button><button class="soft-btn" style="flex:0 0 auto;padding:0 10px;height:36px" data-action="suggest-resolve" data-id="${esc(r.id)}">해결</button>`:''}<button class="soft-btn" style="flex:0 0 auto;padding:0 10px;height:36px" data-action="suggest-hold" data-id="${esc(r.id)}">${r.legalHold?'동결 해제':'동결'}</button><button class="soft-btn" style="flex:0 0 auto;padding:0 10px;height:36px;color:var(--danger)" data-action="suggest-delete" data-id="${esc(r.id)}">삭제</button></span></div>`).join('');
  }
  async function viewSuggestion(id){
    if(!id) return;
    try{
      const s=await db.collection('suggestions').doc(id).get();
      if(!s.exists) return;
      const r=s.data()||{};
      openModal(`<h2>건의 내용</h2><p class="desc">${esc(fmtDateTime(r.createdAt))}</p><div class="report-detail">${esc(r.text||'')}</div><div class="modal-actions"><button class="confirm" data-close-modal>닫기</button></div>`);
    }catch(e){ console.error(e); }
  }
  async function flagSuggestion(id){
    if(!id) return;
    try{
      const s=await db.collection('suggestions').doc(id).get();
      const on=!(s.exists&&s.data()?.flagged);
      await db.collection('suggestions').doc(id).update(on?{flagged:true,status:'flagged',updatedAt:ts()}:{flagged:false,status:'open',updatedAt:ts()});
      toast(on?'신고 필요로 표시하고 맨 위에 고정했어요. (경찰에 자동 신고되지 않아요)':'신고 표시를 해제했어요.');
    }catch(e){ console.error(e); return toast(errText(e)); }
    paintSuggestList(state.suggestFilter||'open');
  }
  async function resolveSuggestion(id){
    if(!id) return;
    try{
      await db.collection('suggestions').doc(id).update({status:'resolved',flagged:false,resolvedAt:ts(),resolvedBy:uid(),updatedAt:ts()});
      await bumpSuggestStats(1,0);
    }catch(e){ console.error(e); return toast(errText(e)); }
    toast('해결 처리했어요. 해결됨 목록에서 확인할 수 있어요.');
    state.suggestFilter='resolved';
    paintSuggestList('resolved');
  }
  async function deleteSuggestion(id){
    if(!id) return;
    try{
      const s=await db.collection('suggestions').doc(id).get();
      if(s.exists&&s.data()?.legalHold) return toast('수사 협조로 동결된 건의예요. 먼저 동결을 해제해 주세요.');
    }catch(e){}
    const ok=await new Promise(res=>{
      const panel=openModal(`<h2>이 건의를 삭제할까요?</h2><p class="desc">교사 화면에서는 안 보이지만, 은폐 의혹·감사·민원 이력 확인을 위해 DB에 1년간 보관돼요. 1년이 지나면 자동으로 영구 삭제돼요. 학생 화면의 처리 현황에도 ‘보관 중’으로 표시돼요.</p><div class="modal-actions"><button class="cancel" id="sgNo">취소</button><button class="confirm" id="sgYes">삭제하기</button></div>`,{small:true,dismissible:false});
      panel.querySelector('#sgNo').onclick=()=>{ closeModal(); res(false); };
      panel.querySelector('#sgYes').onclick=()=>{ closeModal(); res(true); };
    });
    if(!ok) return;
    try{
      await db.collection('suggestions').doc(id).update({status:'deleted',updatedAt:ts()});
      await bumpSuggestStats(0,1);
    }catch(e){ console.error(e); return toast(errText(e)); }
    toast('삭제했어요. 1년간 보관 후 자동 파기돼요.');
    paintSuggestList(state.suggestFilter||'open');
  }
  async function toggleSuggestHold(id){
    if(!id) return;
    try{
      const s=await db.collection('suggestions').doc(id).get();
      if(!s.exists) return;
      const on=!!s.data()?.legalHold;
      if(!on){
        const ok=await new Promise(res=>{
          const panel=openModal(`<h2>수사 협조로 동결할까요?</h2><div class="notice-ico danger" aria-hidden="true"><span></span></div><p class="desc">경찰 수사가 끝날 때까지 자동 파기 대상에서 제외돼요. 동결 중에는 삭제할 수 없어요.</p><div class="modal-actions"><button class="cancel" id="hdNo">취소</button><button class="confirm" id="hdYes">동결하기</button></div>`,{small:true,dismissible:false});
          panel.querySelector('#hdNo').onclick=()=>{ closeModal(); res(false); };
          panel.querySelector('#hdYes').onclick=()=>{ closeModal(); res(true); };
        });
        if(!ok) return;
        await db.collection('suggestions').doc(id).update({legalHold:true,holdAt:ts(),updatedAt:ts()});
        toast('동결했어요. 수사가 끝나면 해제해 주세요.');
      } else {
        await db.collection('suggestions').doc(id).update({legalHold:false,updatedAt:ts()});
        toast('동결을 해제했어요.');
      }
      paintSuggestList(state.suggestFilter||'open');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function bumpSuggestStats(resolved,deleted){
    const sid=state.profile?.schoolId||'';
    try{
      const ref=db.collection('suggestionStats').doc(sid);
      const s=await ref.get();
      const cur=s.exists?(s.data()||{}):{};
      await ref.set({resolved:Number(cur.resolved||0)+resolved,deleted:Number(cur.deleted||0)+deleted,updatedAt:ts()},{merge:true});
    }catch(e){ console.warn('stats',e?.code||e); }
  }
  // 담당 교사 지정·변경·해제 (학교 관리자 · 변경 이력은 DB 감사 로그에 남는다)
  async function openSuggestAssign(){
    if(!(isAdmin()||isSchoolAdmin())) return;
    const sid=state.profile?.schoolId||'';
    const box=await suggestBoxOf();
    let teachers=[];
    try{ const s=await db.collection('publicProfiles').where('schoolId','==',sid).limit(200).get(); teachers=s.docs.map(d=>({id:d.id,...d.data()})).filter(u=>(u.role||'')==='teacher'); }catch(e){}
    openModal(`<h2>건의함 담당 교사</h2><p class="desc">지금 담당: <b>${esc(box.handlerName||'(학교 관리자)')}</b><br>바꾸는 순간 이전 담당에게는 안 보이고 새 담당에게만 보여요. 미해결과 보관 내역이 자동으로 이관돼요.</p>
      <div class="list modal-scroll">${teachers.map(u=>`<button class="list-item" data-action="suggest-assign-pick" data-uid="${esc(u.id)}" data-name="${esc(u.displayName||'사용자')}"><div class="grow"><div class="title">${esc(u.displayName||'사용자')}</div></div><span>›</span></button>`).join('')||'<div class="empty-side">교사가 없어요.</div>'}</div>
      <div class="field" style="margin-top:12px"><label>변경 기록 (누가 언제 바꿨는지)</label><div id="suggestAuditList" class="list"><div class="empty-side">불러오는 중…</div></div></div>
      <div class="modal-actions"><button type="button" class="soft-btn" data-action="suggest-assign-clear">담당 해제 (학교 관리자가 맡기)</button><button class="cancel" data-close-modal>닫기</button></div>`);
    runAsync(async()=>{
      try{
        const s=await db.collection('suggestionAudit').where('schoolId','==',sid).limit(30).get();
        const rows=s.docs.map(d=>({id:d.id,...d.data()}));
        const host=$('#suggestAuditList'); if(!host) return;
        // 예: [2026-03-01] 학교 관리자(admin_01)가 '익명 건의함' 담당자를 A 교사에서 B 교사로 변경함.
        host.innerHTML=rows.map(r=>{ const dt=r.createdAt?fmtDateTime(r.createdAt):''; const dstr=dt.length>=10?dt.slice(0,10):dt; return `<div class="list-item"><div class="grow"><div class="title" style="font-weight:400">[${esc(dstr)}] ${esc(r.byName||'')}(${(r.byUid||'').slice(0,8)})가 '익명 건의함' 담당자를 ${esc(r.fromName||'')}에서 ${esc(r.toName||'')}로 변경함.</div></div></div>`; }).join('')||'<div class="empty-side">변경 기록이 없어요.</div>';
      }catch(e){ const host=$('#suggestAuditList'); if(host) host.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; }
    });
  }
  async function assignSuggestHandler(targetUid,targetName){
    if(!(isAdmin()||isSchoolAdmin())) return;
    const sid=state.profile?.schoolId||'';
    const box=await suggestBoxOf();
    const fromUid=box.handlerUid||'', fromName=box.handlerName||'(학교 관리자)';
    try{
      await db.collection('suggestionBoxes').doc(sid).set({handlerUid:targetUid||'',handlerName:targetName||'',updatedBy:uid(),updatedAt:ts()},{merge:true});
      await db.collection('suggestionAudit').add({schoolId:sid,action:'assign',fromUid,fromName,toUid:targetUid||'',toName:targetName||'(학교 관리자)',byUid:uid(),byName:state.profile?.displayName||'',createdAt:ts()});
      try{ await logAdminAudit('suggest-assign',`${fromName} → ${targetName||'(학교 관리자)'}`); }catch(e){}
    }catch(e){ console.error(e); return toast(errText(e)); }
    closeModal(); toast(targetUid?'담당 교사를 바꿨어요. 이전 담당에게는 더 이상 안 보여요.':'담당을 해제했어요. 학교 관리자가 맡아요.');
    try{ renderAdminPanel(state.adminTab); }catch(e){}
  }
  function renderRolesAdmin(p){
    if(!isTeacher()) return;
    const defs=state.roleDefs||[], grants=state.roleGrants||[];
    const pick=state.roleGrantPick||{};
    p.innerHTML=`<div class="admin-card"><h3>역할 만들기</h3><p class="desc">학교에서 쓰는 역할을 만들어요. 한 사람에게 여러 개를 줄 수 있어요.</p>
      <div class="row"><input id="roleNameInput" class="input" maxlength="20" placeholder="예: 반장"><input id="roleEmojiInput" class="input" style="flex:0 0 64px;text-align:center" maxlength="4" placeholder="🎖"><button type="button" class="soft-btn" style="flex:0 0 76px" data-action="role-def-add">추가</button></div>
      <div class="word-preview" style="margin-top:10px">${defs.map(d=>`<span class="word-chip" style="display:inline-flex;align-items:center;gap:6px">${d.emoji?esc(d.emoji)+' ':''}${esc(d.name)}<button type="button" data-action="role-def-remove" data-id="${esc(d.id)}" aria-label="역할 지우기" style="color:var(--danger);font-weight:800">×</button></span>`).join('')||'<span class="mini muted">아직 없어요.</span>'}</div></div>
      <div class="admin-card"><h3>역할 주기</h3><p class="desc">받을 사람을 찾아 역할을 고르고 주세요. 같은 역할은 한 번만 줄 수 있어요.</p>
      <div class="field"><label>받을 사람 (이름 검색)</label><div class="row"><input id="roleUserSearch" class="input" placeholder="이름 입력"><button type="button" class="soft-btn" style="flex:0 0 76px" data-action="role-user-search">찾기</button></div><div id="roleUserList" class="list" style="margin-top:8px"></div></div>
      <div class="field"><label>역할</label><div class="choice-row" style="flex-wrap:wrap">${defs.map(d=>`<label class="choice ${pick.defId===d.id?'active':''}" style="cursor:pointer"><input type="radio" name="roleDefPick" value="${esc(d.id)}" ${pick.defId===d.id?'checked':''} style="display:none">${d.emoji?esc(d.emoji)+' ':''}${esc(d.name)}</label>`).join('')||'<span class="mini muted">먼저 역할을 만드세요.</span>'}</div></div>
      <div class="field"><label class="choice" style="cursor:pointer"><input type="checkbox" id="roleScopeSchool" ${pick.schoolWide?'checked':''}> 전교 역할로 (학급 없이)</label>
      <div id="rolePicked" class="mini muted" style="margin-top:6px">${pick.uid?`받을 사람: ${esc(pick.name||'')} (${pick.schoolWide?'전교':`${pick.grade||'?'}학년 ${pick.classNum||'?'}반`})`:'받을 사람을 아직 고르지 않았어요.'}</div></div>
      <button type="button" class="confirm" style="width:100%;height:46px;border-radius:13px" data-action="role-grant">주기</button></div>
      <div class="admin-card"><h3>준 역할 (${grants.length})</h3><div class="list">${grants.map(g=>`<div class="list-item"><div class="grow"><div class="title">${g.emoji?esc(g.emoji)+' ':''}${esc(g.roleName||'역할')} <span class="mini muted">→ ${esc(g.displayName||'')}</span></div><div class="meta">${g.grade?`${g.grade}학년 ${g.classNum||''}반`.trim()+' · ':''}전교${g.grade?'학급':''} · ${esc(fmtDateTime(g.createdAt))}</div></div><button class="soft-btn" style="flex:0 0 68px" data-action="role-ungrant" data-id="${esc(g.id)}">회수</button></div>`).join('')||'<div class="empty-side">아직 준 역할이 없어요.</div>'}</div></div>`;
    $$('input[name="roleDefPick"]',p).forEach(r=>r.onchange=()=>{ state.roleGrantPick={...(state.roleGrantPick||{}),defId:r.value}; renderRolesAdmin($('#adminPanel')); });
    const sc=$('#roleScopeSchool'); if(sc) sc.onchange=()=>{ state.roleGrantPick={...(state.roleGrantPick||{}),schoolWide:sc.checked}; const pl=$('#rolePicked'); if(pl) pl.innerHTML=rolePickedText(); };
  }
  function rolePickedText(){
    const pick=state.roleGrantPick||{};
    return pick.uid?`받을 사람: ${esc(pick.name||'')} (${pick.schoolWide?'전교':`${pick.grade||'?'}학년 ${pick.classNum||'?'}반`})`:'받을 사람을 아직 고르지 않았어요.';
  }
  async function searchRoleUsers(){
    const q=($('#roleUserSearch')?.value||'').trim();
    const host=$('#roleUserList'); if(!host) return;
    if(!q){ host.innerHTML='<div class="empty-side">이름을 입력해 주세요.</div>'; return; }
    const sid=state.profile?.schoolId||'';
    let docs=[];
    try{ const s=await db.collection('publicProfiles').where('schoolId','==',sid).limit(200).get(); docs=s.docs.map(d=>({id:d.id,...d.data()})); }
    catch(e){ host.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; return; }
    const rows=docs.filter(u=>String(u.displayName||'').includes(q)&&(u.role||'student')==='student').slice(0,20);
    host.innerHTML=rows.map(u=>`<button class="list-item" data-action="role-user-pick" data-uid="${esc(u.id)}" data-name="${esc(u.displayName||'')}" data-grade="${u.grade||''}" data-class="${u.classNum||''}"><div class="grow"><div class="title">${esc(u.displayName||'사용자')}${state.roleGrantPick?.uid===u.id?' ✓':''}</div><div class="meta">${gradeClassPrefix(u)}${roleLabel(u.role)}</div></div></button>`).join('')||'<div class="empty-side">찾지 못했어요.</div>';
  }
  async function grantRole(){
    if(!isTeacher()) return;
    const pick=state.roleGrantPick||{};
    const def=(state.roleDefs||[]).find(d=>d.id===pick.defId);
    if(!pick.uid) return toast('받을 사람을 먼저 고르세요.');
    if(!def) return toast('역할을 먼저 고르세요.');
    const sid=state.profile?.schoolId||'';
    const schoolWide=!!pick.schoolWide;
    const grade=schoolWide?null:(Number(pick.grade)||null), classNum=schoolWide?null:(Number(pick.class)||null);
    const scopeKey=schoolWide?'school':`${grade||'?'}-${classNum||'?'}`;
    const gid=`${def.id}_${pick.uid}_${scopeKey}`;
    const dup=(state.roleGrants||[]).some(g=>g.id===gid);
    if(dup) return toast('이미 준 역할이에요.');
    try{
      await db.collection('roleGrants').doc(gid).set({
        schoolId:sid,roleId:def.id,roleName:def.name,emoji:def.emoji||'',color:def.color||'',
        uid:pick.uid,displayName:pick.name||'',grade,classNum,
        grantedBy:uid(),grantedByName:state.profile?.displayName||'',createdAt:ts()
      });
    }catch(e){ console.error(e); return toast(errText(e)); }
    state.roleGrantPick=null;
    toast(`‘${def.name}’ 역할을 줬어요.`);
    renderRolesAdmin($('#adminPanel'));
  }
  async function ungrantRole(gid){
    if(!isTeacher()) return;
    try{ await db.collection('roleGrants').doc(gid).delete(); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast('역할을 회수했어요.');
    renderRolesAdmin($('#adminPanel'));
  }
  async function addRoleDef(){
    if(!isTeacher()) return;
    const name=($('#roleNameInput')?.value||'').trim().slice(0,20);
    const emoji=($('#roleEmojiInput')?.value||'').trim().slice(0,4);
    if(!name) return toast('역할 이름을 적어 주세요.');
    const sid=state.profile?.schoolId||'';
    try{ await db.collection('schoolRoles').add({schoolId:sid,name,emoji,color:'',createdBy:uid(),createdAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast(`‘${name}’ 역할을 만들었어요.`);
    renderRolesAdmin($('#adminPanel'));
  }
  async function removeRoleDef(rid){
    if(!isTeacher()) return;
    try{
      const s=await db.collection('roleGrants').where('roleId','==',rid).limit(400).get();
      const b=db.batch(); s.docs.forEach(d=>b.delete(d.ref)); await b.commit();
      await db.collection('schoolRoles').doc(rid).delete();
    }catch(e){ console.error(e); return toast(errText(e)); }
    toast('역할을 지웠어요.');
    renderRolesAdmin($('#adminPanel'));
  }

  // ---------- 선생 전용 공지방 만들기 ----------
  // ---------- 공지방 특정 참여자 지정 (공유방에서 바로 만들기 + 개별 선택) ----------
  // 공지방은 기본 교사만 발송한다 (canSend/composer 규칙 유지) · 대상은 교사가 고른 멤버로 한정한다
  async function openNoticeFromRoom(roomId){
    if(!isTeacher()) return;
    const r=state.rooms.find(x=>x.id===roomId)||state.room; if(!r) return;
    const ids=[...(r.memberIds||[])].filter(id=>id&&id!==uid());
    await ensureProfilesAll(ids);
    state.noticePick=new Set(ids);
    openModal(`<h2>이 방에서 공지방 만들기</h2><p class="desc">${esc(r.name||'채팅방')} 참여자 중 공지를 받을 사람을 골라 주세요. 공지방에서는 선생님만 글을 올릴 수 있어요.</p>
      <div class="field"><label>제목</label><input id="noticePickName" class="input" maxlength="40" value="${esc((r.name||'')+' 공지')}"></div>
      <div class="field"><label>받을 사람 검색</label><input id="noticePickSearch" class="input" placeholder="이름 검색"></div>
      <div id="noticePickList" class="list modal-scroll"></div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" data-action="notice-pick-create" data-room="${esc(roomId)}">공지방 만들기</button></div>`);
    const paint=(q)=>{
      const host=$('#noticePickList'); if(!host) return;
      const needle=String(q||'').trim();
      host.innerHTML=ids.map(id=>{
        const p=state.profileCache.get(id)||{};
        const nm=p.displayName||'사용자';
        if(needle&&!nm.includes(needle)) return '';
        const on=state.noticePick instanceof Set&&state.noticePick.has(id);
        return `<label class="list-item"><input type="checkbox" data-notice-pick="${esc(id)}" ${on?'checked':''}><div class="grow"><div class="title">${esc(nm)}</div><div class="meta">${gradeClassPrefix(p)}${roleLabel(p.role)}</div></div></label>`;
      }).join('')||'<div class="empty-side">해당하는 사람이 없어요.</div>';
      host.querySelectorAll('[data-notice-pick]').forEach(cb=>cb.onchange=()=>{ if(!(state.noticePick instanceof Set)) state.noticePick=new Set(); if(cb.checked) state.noticePick.add(cb.dataset.noticePick); else state.noticePick.delete(cb.dataset.noticePick); });
    };
    paint('');
    $('#noticePickSearch')?.addEventListener('input',e=>paint(e.target.value));
  }
  async function createNoticePickRoom(fromRoomId){
    if(!isTeacher()) return;
    const members=state.noticePick instanceof Set?[...state.noticePick]:[];
    if(!members.length) return toast('받을 사람을 한 명 이상 골라 주세요.');
    const name=($('#noticePickName')?.value||'').trim().slice(0,40);
    if(!name) return toast('제목을 적어 주세요.');
    const sid=state.profile?.schoolId||'';
    const all=[...new Set([uid(),...members])];
    try{
      // 방 생성 규칙상 처음에는 본인만 넣고, 방장이 된 뒤 멤버를 추가한다
      const ref=await db.collection('channels').add({
        name,description:'',type:'notice',typeLabel:'공지',visibility:'members',
        memberIds:[uid()],audience:'pick',pickFrom:fromRoomId||'',
        createdBy:uid(),schoolId:sid,schoolName:state.profile?.schoolName||'',
        createdAt:ts(),updatedAt:ts(),lastText:''
      });
      try{ await db.collection('channels').doc(ref.id).update({memberIds:all,updatedAt:ts()}); }catch(e){ console.error(e); }
      closeAllModals(); toast('공지방을 만들었어요. 선생님만 글을 올릴 수 있어요.');
      exitAdmin(); openRoom(ref.id);
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function renderNoticeRoomsAdmin(p){
    if(!isTeacher()) return;
    const grades=state.school.grades||[];
    const mine=(state.rooms||[]).filter(r=>r.type==='notice'&&r.createdBy===uid());
    p.innerHTML=`<div class="admin-card"><h3>공지 만들기</h3><p class="desc">선생님만 글을 올리는 공지방을 만들어요. 대상을 고르면 그 학생들이 자동으로 들어와요.</p>
      <div class="field"><label>제목</label><input id="noticeRoomName" class="input" maxlength="40" placeholder="예: 3학년 2반 알림장"></div>
      <div class="field"><label>설명</label><input id="noticeRoomDesc" class="input" maxlength="120" placeholder="어떤 안내를 올리는 방인지 적어 주세요."></div>
      <div class="field"><label>대상</label><div class="row">
        <select id="noticeGrade" class="input"><option value="all">전체 학생</option>${grades.map(g=>`<option value="${g}">${g}학년 전체</option>`).join('')}</select>
        <select id="noticeClass" class="input"><option value="">반 전체</option></select>
      </div></div>
      <button type="button" class="confirm" style="width:100%;height:46px;border-radius:13px" data-action="notice-create">공지방 만들기</button></div>
      <div class="admin-card"><h3>내 공지방 (${mine.length})</h3><div class="list">${mine.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(r.name||'공지방')}</div><div class="meta">${(r.memberIds||[]).length}명</div></div><button class="soft-btn" style="flex:0 0 76px" data-action="open-admin-room" data-room-id="${esc(r.id)}">열기</button></div>`).join('')||'<div class="empty-side">아직 만든 공지방이 없어요.</div>'}</div></div>`;
    const gs=$('#noticeGrade');
    const refreshClasses=()=>{
      const g=Number(gs?.value)||0, cs=$('#noticeClass');
      if(!cs) return;
      const n=g?Number(state.school.classCounts?.[g]||0):0;
      cs.innerHTML='<option value="">반 전체</option>'+Array.from({length:n},(_,i)=>`<option value="${i+1}">${i+1}반</option>`).join('');
    };
    if(gs){ gs.onchange=refreshClasses; refreshClasses(); }
  }
  async function createNoticeRoom(){
    if(!isTeacher()) return;
    const name=($('#noticeRoomName')?.value||'').trim().slice(0,40);
    const desc=($('#noticeRoomDesc')?.value||'').trim().slice(0,120);
    if(!name) return toast('제목을 적어 주세요.');
    const gv=$('#noticeGrade')?.value||'all', cv=$('#noticeClass')?.value||'';
    const sid=state.profile?.schoolId||'';
    let members=[];
    try{
      const snap=await (sid?db.collection('publicProfiles').where('schoolId','==',sid).limit(500):db.collection('publicProfiles').limit(200).get());
      snap.docs.forEach(d=>{
        const u=d.data(); if(sid&&u.schoolId!==sid) return;
        if(u.role==='admin'||u.role==='teacher'||d.id===uid()){ members.push(d.id); return; }
        if(gv==='all'){ members.push(d.id); return; }
        if(Number(u.grade)!==Number(gv)) return;
        if(cv && Number(u.classNum)!==Number(cv)) return;
        members.push(d.id);
      });
    }catch(e){ console.error(e); return toast('대상을 불러오지 못했어요.'); }
    members=[...new Set(members)];
    if(!members.length) return toast('대상이 없어요.');
    try{
      // 방 생성 규칙상 처음에는 본인만 넣고, 방장이 된 뒤 멤버를 추가한다
      const ref=await db.collection('channels').add({
        name,description:desc,type:'notice',typeLabel:'공지',visibility:'members',
        memberIds:[uid()],audience:cv?`c${gv}-${cv}`:(gv==='all'?'all':`g${gv}`),
        createdBy:uid(),schoolId:sid,schoolName:state.profile?.schoolName||'',
        createdAt:ts(),updatedAt:ts(),lastText:''
      });
      try{ await db.collection('channels').doc(ref.id).update({memberIds:members,updatedAt:ts()}); }catch(e){ console.error(e); }
      toast('공지방을 만들었어요.');
      exitAdmin();
      openRoom(ref.id);
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function renderRoomsAdmin(p){
    let rows=[];
    try{
      if(isAdmin()){
        // 관리자도 개인·모둠 대화는 볼 수 없다. 우리 학교 전체 공유 채팅방만 보인다.
        const snap=await db.collection('channels').where('visibility','==','all').limit(200).get();
        rows=snap.docs.map(d=>({id:d.id,...d.data()}));
      }
      else rows=state.rooms;
    }catch(e){ console.error(e); rows=state.rooms; }
    p.innerHTML=`<div class="admin-card"><h3>채팅방</h3><p class="desc">내가 만들었거나 우리 학교 전체에 공유된 채팅방이에요. 개인·모둠 대화는 볼 수 없어요.</p><div class="list">${rows.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(r.name||'채팅방')}</div><div class="meta">${(r.memberIds||[]).length}명 · ${r.type==='notice'?'공지':r.type==='private'?'개인':'모둠/동아리'}</div></div><button class="soft-btn" style="flex:0 0 76px" data-action="open-admin-room" data-room-id="${esc(r.id)}">열기</button></div>`).join('')||'<div class="empty-side">채팅방이 없어요.</div>'}</div></div>`;
  }
  async function renderUsersAdmin(p){
    if(!isAdmin())return;
    p.innerHTML=`<div class="admin-card"><h3>사용자</h3><p class="desc">마지막 로그인 시각과 IP를 확인할 수 있어요. 이름을 누르면 프로필이 열려요.</p><div class="admin-toolbar"><input id="userSearch" class="input" placeholder="이름, 학년/반, 이메일로 찾기"><button type="button" class="soft-btn" style="flex:0 0 96px" data-action="refresh-admin-users">새로고침</button></div><div id="userList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>`;
    const users=await loadAdminUsers();
    const render=q=>{
      const host=$('#userList'); if(!host) return;
      const list=users.filter(u=>matchUser(u,q));
      host.innerHTML=list.slice(0,300).map(u=>`<div class="list-item"><div class="grow" style="display:flex;align-items:center;gap:10px;cursor:pointer" data-action="user-profile" data-uid="${esc(u.id)}" data-name="${esc(u.displayName||'사용자')}"><div>${avatarHtml(u)}</div><div class="grow" style="min-width:0"><div class="title">${esc(u.displayName||'사용자')}${Number(u.warnCount||0)>0?` <span class="timeout-chip">경고 ${Number(u.warnCount)}</span>`:''}</div><div class="meta">${gradeClassPrefix(u)}${roleLabel(u.role)}${u.email?` · ${esc(u.email)}`:''}</div><div class="admin-meta"><span class="admin-chip">로그인 ${Number(u.loginCount||0)}회</span><span class="admin-chip">${esc(fmtDateTime(u.lastLoginAt))}</span></div></div></div><button class="soft-btn" style="flex:0 0 64px" data-action="admin-role" data-uid="${esc(u.id)}" data-name="${esc(u.displayName||'사용자')}" data-role="${esc(u.role||'student')}">권한</button><button class="soft-btn" style="flex:0 0 84px" data-action="timeout-user" data-uid="${esc(u.id)}" data-name="${esc(u.displayName||'사용자')}">타임아웃</button></div>`).join('')||'<div class="empty-side">사용자가 없어요.</div>';
    };
    render('');
    $('#userSearch')?.addEventListener('input',e=>render(e.target.value));
  }
  // ---------- 교사 승격 심사 (총관리자만 · 재직증명서 직접 확인) ----------
  async function renderTeachersAdmin(p){
    if(!isAdmin()){ p.innerHTML='<div class="empty-side">총관리자만 볼 수 있어요.</div>'; return; }
    p.innerHTML=`<div class="admin-card"><h3>교사 승인</h3><p class="desc">학생이 올린 교사 인증 신청이에요. 재직증명서는 직접 보고, 교육청 이메일은 인증 표시를 확인한 뒤 승인해 주세요. 승인해야 teacher가 되고, 그 전까지는 절대 권한이 가지 않아요.</p><div id="teacherReqList" class="list">${loadingShimmer(4)}</div></div>`;
    let rows=[];
    try{ const s=await db.collection('teacherRequests').where('status','==','pending').limit(100).get(); rows=s.docs.map(d=>({id:d.id,...d.data()})); }
    catch(e){ console.error(e); const h=$('#teacherReqList'); if(h) host_fallback(h); return; }
    const host=$('#teacherReqList'); if(!host) return;
    if(!rows.length){ host.innerHTML='<div class="empty-side">대기 중인 신청이 없어요.</div>'; return; }
    host.innerHTML=rows.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(r.displayName||'사용자')} · ${esc(r.schoolName||'학교 미지정')}</div><div class="meta">${r.method==='certificate'?'재직증명서':'교육청 이메일'} · ${esc(fmtDateTime(r.createdAt))}</div><div class="admin-meta">${r.method==='edu-email'?`<span class="admin-chip">${esc(r.eduEmail||'')}</span><span class="admin-chip ${r.emailVerified?'':'warn'}">${r.emailVerified?'수신함 인증됨':'미인증'}</span>`:`<span class="admin-chip">${esc(r.fileName||'서류')}</span><span class="admin-chip">${esc(fmtBytes(r.fileSize||0))}</span>`}</div></div><span style="display:flex;gap:6px;flex:0 0 auto"><button class="soft-btn" style="flex:0 0 auto;padding:0 12px;height:38px" data-action="teacher-req-view" data-uid="${esc(r.uid||r.id)}">서류 보기</button><button class="soft-btn" style="flex:0 0 auto;padding:0 12px;height:38px" data-action="teacher-approve" data-uid="${esc(r.uid||r.id)}" data-name="${esc(r.displayName||'사용자')}">승인</button><button class="soft-btn" style="flex:0 0 auto;padding:0 12px;height:38px;color:var(--danger)" data-action="teacher-reject" data-uid="${esc(r.uid||r.id)}" data-name="${esc(r.displayName||'사용자')}">반려</button></span></div>`).join('');
    function host_fallback(h){ h.innerHTML='<div class="empty-side">불러오지 못했어요. 규칙을 확인해 주세요.</div>'; }
  }
  async function viewTeacherCert(targetUid){
    if(!isAdmin()||!targetUid) return;
    try{
      const s=await db.collection('teacherRequests').doc(targetUid).get();
      if(!s.exists) return toast('신청을 찾지 못했어요.');
      const r=s.data()||{};
      let data=r.fileData||'';
      if(!data&&r.certChunked){
        const n=Number(r.certChunks||0), parts=[];
        for(let i=0;i<n&&i<10;i++){
          const c=await db.collection('teacherRequests').doc(targetUid).collection('chunks').doc(`${targetUid}_${i}`).get();
          if(!c.exists){ parts.length=0; break; }
          parts.push(c.data().data||'');
        }
        if(parts.length===n) data=parts.join('');
      }
      if(!data&&r.method==='edu-email') return openModal(`<h2>교육청 이메일 신청</h2><p class="desc">${esc(r.displayName||'사용자')} · ${esc(r.eduEmail||'')}</p><div class="admin-meta"><span class="admin-chip ${r.emailVerified?'':'warn'}">${r.emailVerified?'수신함 인증됨':'미인증'}</span></div><div class="modal-actions"><button class="confirm" data-close-modal>닫기</button></div>`,{small:true});
      if(!data){
        // 승인/반려 후에는 운영자가 확인 후 즉시 영구 삭제되어 더 이상 볼 수 없음
        if(r.method==='certificate' && (r.status==='approved' || r.status==='rejected')){
          return openModal(`<h2>서류가 삭제됐어요</h2><p class="desc">제출하신 서류는 운영자가 확인 후 즉시 영구 삭제되었어요.<br>교사 인증이 반려되었다면 파일을 다시 보내주셔야 확인할 수 있어요.</p><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
        }
        return toast('서류가 없어요.');
      }
      const isImg=String(data).startsWith('data:image');
      const safeHref=safeFileHref(data);
      if(!isImg&&!safeHref) return toast('서류 형식을 확인하지 못했어요.');
      openModal(`<h2>재직증명서</h2><p class="desc">${esc(r.displayName||'사용자')} · ${esc(r.fileName||'')}</p>${isImg?`<img class="attach-view" src="${esc(data)}" alt="재직증명서">`:`<a class="attach-card" href="${esc(safeHref)}" download="${esc(r.fileName||'cert')}"><span class="attach-ico">📎</span><span class="grow"><span class="attach-name">${esc(r.fileName||'서류')}</span></span></a>`}<div class="modal-actions"><button class="confirm" data-close-modal>닫기</button></div>`);
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function approveTeacher(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    openDangerConfirm({
      title:'교사 계정으로 승인할까요?',
      desc:`${targetName||'사용자'}님의 권한이 teacher로 바뀌어요. 서류를 직접 확인했을 때만 진행해 주세요.`,
      requireText:'', seconds:5, confirmLabel:'승인하기',
      checkLabel:'서류를 확인했고, 승인해도 됩니다.',
      onConfirm: async ()=>{
        try{
          await db.collection('users').doc(targetUid).update({role:'teacher',updatedAt:ts()});
          await db.collection('publicProfiles').doc(targetUid).set({role:'teacher',updatedAt:ts()},{merge:true});
          try{ await db.collection('teacherRequests').doc(targetUid).update({status:'approved',handledBy:uid(),handledAt:ts(),updatedAt:ts()}); }catch(e){ console.error(e); toast(errText(e)); return; }
          // 승인 후 재직증명서 자체는 즉시 영구 삭제 (목록에는 남아도 파일은 안 보임) — 반려 시 재제출 필요 문구와 동일
          try{
            for(let i=0;i<10;i++){ try{ await db.collection('teacherRequests').doc(targetUid).collection('chunks').doc(`${targetUid}_${i}`).delete(); }catch(_){} }
          }catch(e){}
          try{
            await db.collection('teacherRequests').doc(targetUid).update({fileData:'',fileName:'',fileType:'',fileSize:0,certChunked:false,certChunks:0,updatedAt:ts()});
          }catch(e){ console.warn('cert wipe',e?.code||e); }
        }catch(e){ console.error(e); toast(errText(e)); return; }
        toast('교사 계정으로 승인했어요. 제출하신 서류는 즉시 영구 삭제했어요.');
        try{ await logAdminAudit('teacher-approve',targetName||'사용자',targetUid); }catch(e){}
        try{ await notifyAccountAction(targetUid,'교사 인증이 승인됐어요. 교사 권한으로 이용할 수 있어요. 제출하신 서류는 확인 후 즉시 영구 삭제되었어요.'); }catch(e){}
        renderAdminPanel('teachers');
      }
    });
  }
  async function rejectTeacher(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    openModal(`<h2>신청을 반려할까요?</h2><div class="field"><label>반려 사유 (신청자에게 보여요)</label><input id="rejReason" class="input" maxlength="120" placeholder="예: 서류가 잘 안 보여요"></div><div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="danger-btn" id="rejGo">반려하기</button></div>`,{small:true});
    $('#rejGo').onclick=async()=>{
      const reason=($('#rejReason')?.value||'').trim().slice(0,120);
      try{ await db.collection('teacherRequests').doc(targetUid).update({status:'rejected',rejectReason:reason,handledBy:uid(),handledAt:ts(),updatedAt:ts()}); }
      catch(e){ console.error(e); return toast(errText(e)); }
      // 반려 후에도 재직증명서 자체는 즉시 영구 삭제 — 다시 보내야 확인할 수 있음
      try{
        for(let i=0;i<10;i++){ try{ await db.collection('teacherRequests').doc(targetUid).collection('chunks').doc(`${targetUid}_${i}`).delete(); }catch(_){} }
      }catch(e){}
      try{
        await db.collection('teacherRequests').doc(targetUid).update({fileData:'',fileName:'',fileType:'',fileSize:0,certChunked:false,certChunks:0,updatedAt:ts()});
      }catch(e){ console.warn('cert wipe',e?.code||e); }
      try{ await logAdminAudit('teacher-reject',`${targetName||'사용자'}${reason?' · '+reason:''}`,targetUid); }catch(e){}
      try{ await notifyAccountAction(targetUid,`교사 인증 신청이 반려됐어요.${reason?` 사유: ${reason}`:''} 제출하신 서류는 즉시 영구 삭제되었으니 다시 신청하려면 파일을 다시 보내주세요.`); }catch(e){}
      closeModal(); toast('반려했어요. 제출하신 서류는 즉시 영구 삭제했어요.');
      renderAdminPanel('teachers');
    };
  }

  // ---------- 학교 간 채팅 요청 ----------
  function crossDocId(a,b){ return `${a}_${b}`; }
  async function crossApproved(otherUid){
    if(!otherUid) return false;
    try{
      const s=await db.collection('crossRequests').doc(crossDocId(uid(),otherUid)).get();
      if(s.exists && s.data().status==='approved') return true;
      const s2=await db.collection('crossRequests').doc(crossDocId(otherUid,uid())).get();
      return !!(s2.exists && s2.data().status==='approved');
    }catch(e){ console.error('cross check',e); return false; }
  }
  async function requestCrossSchool(otherUid,otherName,theirSchoolId,theirSchoolName){
    try{
      await db.collection('crossRequests').doc(crossDocId(uid(),otherUid)).set({
        fromUid:uid(),fromName:state.profile?.displayName||'사용자',
        fromSchoolId:state.profile?.schoolId||'',fromSchoolName:state.profile?.schoolName||'',
        toUid:otherUid,toName:otherName||'사용자',
        toSchoolId:theirSchoolId||'',toSchoolName:theirSchoolName||'',
        status:'pending',createdAt:ts()
      });
    }catch(e){ console.error(e); return toast('요청을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }
    toast('학교 간 채팅 요청을 보냈어요. 선생님이 승인하면 초대할 수 있어요.');
  }
  async function renderCrossAdmin(p){
    if(!(isAdmin()||isTeacher())) return;
    p.innerHTML=`<div class="admin-card"><h3>학교 간 채팅 요청</h3><p class="desc">다른 학교 학생과 채팅하고 싶다는 요청이에요. 승인하면 두 사람이 서로 초대할 수 있어요.${isAdmin()?'':' 우리 학교와 관련된 요청만 보여요.'}</p><div id="crossList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>`;
    let rows=[];
    try{ const s=await db.collection('crossRequests').where('status','==','pending').limit(100).get(); rows=s.docs.map(d=>({id:d.id,...d.data()})); }
    catch(e){ console.error(e); const h=$('#crossList'); if(h) h.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; return; }
    if(!isAdmin()){
      const sid=state.profile?.schoolId||'';
      rows=rows.filter(r=>(r.fromSchoolId||'')===sid||(r.toSchoolId||'')===sid);
    }
    const host=$('#crossList'); if(!host) return;
    host.innerHTML=rows.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(r.fromName||'학생')} · ${esc(r.fromSchoolName||'다른 학교')}</div><div class="meta">→ ${esc(r.toName||'학생')} · ${esc(r.toSchoolName||'우리 학교')} · ${esc(fmtDateTime(r.createdAt))}</div></div><button class="soft-btn" style="flex:0 0 52px" data-action="cross-approve" data-id="${esc(r.id)}">승인</button><button class="soft-btn" style="flex:0 0 52px" data-action="cross-reject" data-id="${esc(r.id)}">거절</button></div>`).join('')||'<div class="empty-side">대기 중인 요청이 없어요.</div>';
  }
  async function handleCross(id,ok){
    if(!(isAdmin()||isTeacher())||!id) return;
    if(!isAdmin()){
      let r=null;
      try{ const s=await db.collection('crossRequests').doc(id).get(); if(s.exists) r=s.data(); }catch(e){ console.error(e); return toast(errText(e)); }
      const sid=state.profile?.schoolId||'';
      if(!r || ((r.fromSchoolId||'')!==sid && (r.toSchoolId||'')!==sid)) return toast('우리 학교와 관련된 요청만 처리할 수 있어요.');
    }
    try{ await db.collection('crossRequests').doc(id).update({status:ok?'approved':'rejected',handledBy:uid(),handledAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast(ok?'승인했어요. 이제 서로 초대할 수 있어요.':'요청을 거절했어요.');
    renderCrossAdmin($('#adminPanel'));
  }

  // ---------- 관리자: 사용자 학교 변경 ----------
  // 총관리자 전용: 학생 · 교사 · 학교 관리자 · 총관리자 권한을 바꾼다
  const ROLE_OPTIONS = [['student','학생'],['teacher','교사'],['school_admin','학교 관리자'],['admin','총관리자']];
  function openUserRoleModal(targetUid,targetName,currentRole){
    if(!isAdmin()||!targetUid) return;
    const cur=currentRole||'student';
    openModal(`<h2>권한 변경</h2><p class="desc">${esc(targetName||'사용자')}님의 현재 권한은 <b>${esc(roleLabel(cur))}</b>이에요. 학교 관리자는 자기 학교만 관리하고, 사이트 공지·요금·이용권 발급은 총관리자만 할 수 있어요.</p>
      <div class="list">${ROLE_OPTIONS.map(([v,l])=>`<button class="list-item" data-action="admin-role-apply" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}" data-role="${v}"><div class="grow"><div class="title">${esc(l)}${v===cur?' ✓':''}</div><div class="meta">${v==='admin'?'사이트 전체 관리':v==='school_admin'?'자기 학교 멤버·채팅방·신고 관리':v==='teacher'?'수업·채팅 보조 관리':'일반 사용'}</div></div><span>›</span></button>`).join('')}</div>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button></div>`);
  }
  function applyUserRole(targetUid,targetName,newRole){
    if(!isAdmin()||!targetUid||!newRole) return;
    if(!ROLE_OPTIONS.some(([v])=>v===newRole)) return;
    if(targetUid===uid() && newRole!=='admin') return toast('자기 자신의 총관리자 권한은 뺄 수 없어요.');
    // 권한 변경은 되돌리기 어려워서 5초 확인으로 감싼다
    openDangerConfirm({
      title:`${targetName||'사용자'}님을 ${roleLabel(newRole)}(으)로 바꿀까요?`,
      desc:newRole==='admin'?'사이트 전체를 관리할 수 있게 돼요.':newRole==='school_admin'?'자기 학교의 멤버·채팅방·신고를 관리할 수 있게 돼요.':'권한을 변경해요.',
      requireText:'', seconds:5, confirmLabel:'바꾸기',
      checkLabel:'위 내용을 이해했고, 바꿔도 됩니다.',
      onConfirm: async ()=>{
        try{
          await db.collection('users').doc(targetUid).update({role:newRole,updatedAt:ts()});
          try{ await db.collection('publicProfiles').doc(targetUid).set({role:newRole,updatedAt:ts()},{merge:true}); }catch(e){ console.error(e); }
        }catch(e){ console.error(e); return toast(errText(e)); }
        state.profileCache.delete(targetUid);
        state.adminUsers=null;
        closeAllModals();
        if(state.view==='admin') renderAdminPanel(state.adminTab);
        toast(`${roleLabel(newRole)}(으)로 바꿨어요.`);
        try{ await logAdminAudit('role',`${targetName||'사용자'} → ${roleLabel(newRole)}`,targetUid); }catch(e){}
        try{ await notifyAccountAction(targetUid,`계정 권한이 ${roleLabel(newRole)}(으)로 변경됐어요. 본인이 신청한 게 아니라면 선생님께 문의해 주세요.`); }catch(e){}
      }
    });
  }
  async function removeUserFromSchool(targetUid,targetName){
    if(!isSchoolAdmin()||!targetUid||targetUid===uid()) return;
    const mySid=state.profile?.schoolId||''; if(!mySid) return toast('학교 정보가 없어요.');
    let u=null;
    try{ const s=await db.collection('users').doc(targetUid).get(); if(s.exists) u=s.data(); }catch(e){ console.error(e); return toast(errText(e)); }
    if(!u||u.deleted) return toast('이미 탈퇴한 계정이에요.');
    if((u.schoolId||'')!==mySid) return toast('우리 학교 구성원에게만 할 수 있어요.');
    if(!['student','teacher'].includes(u.role||'student')) return toast('관리자 계정에는 할 수 없어요.');
    openDangerConfirm({
      title:`${targetName||'사용자'}님을 학교에서 제거할까요?`,
      desc:'우리 학교 구성원에서 빠지고, 학교 채팅방에서도 나가져요. 바로 안 보이는 개인 방은 본인 기기에서 자동으로 정리돼요. 계정·기록은 지워지지 않아요.',
      requireText:'', seconds:5, confirmLabel:'제거하기',
      checkLabel:'위 내용을 이해했고, 학교에서 제거해도 됩니다.',
      onConfirm: async ()=>{
        // 1) 관리자가 볼 수 있는 학교 방부터 바로 정리한다
        try{ await leaveOldSchoolRooms(targetUid, mySid, ''); }catch(e){ console.warn('remove leave',e); }
        // 2) 학교 연결을 끊고, 남은 방 자정리 표시를 남긴다
        try{
          await db.collection('users').doc(targetUid).update({schoolId:'',schoolName:'',schoolChangedAt:Date.now(),pendingSchoolCleanup:{schoolId:mySid,schoolName:state.profile?.schoolName||'',at:Date.now()},updatedAt:ts()});
        }catch(e){ console.error(e); toast(errText(e)); return; }
        try{ await db.collection('publicProfiles').doc(targetUid).set({schoolId:'',schoolName:'',updatedAt:ts()},{merge:true}); }catch(e){ console.error(e); }
        state.profileCache.delete(targetUid);
        closeAllModals();
        if(state.view==='admin') renderAdminPanel(state.adminTab);
        toast('학교에서 제거했어요.');
      }
    });
  }
  function openSchoolRoleModal(targetUid,targetName,currentRole){
    if(!isSchoolAdmin()||!targetUid||targetUid===uid()) return;
    const cur=currentRole||'student';
    if(!['student','teacher'].includes(cur)) return toast('학생·교사에게만 변경할 수 있어요.');
    const opts=[['student','학생','일반 사용'],['teacher','교사','수업·채팅 보조 관리']];
    openModal(`<h2>권한 변경</h2><p class="desc">${esc(targetName||'사용자')}님의 현재 권한은 <b>${esc(roleLabel(cur))}</b>이에요. 우리 학교 안에서 학생↔교사로만 바꿀 수 있어요.</p>
      <div class="list">${opts.map(([v,l,d])=>`<button class="list-item" data-action="school-role-apply" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}" data-role="${v}"><div class="grow"><div class="title">${esc(l)}${v===cur?' ✓':''}</div><div class="meta">${esc(d)}</div></div><span>›</span></button>`).join('')}</div>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button></div>`);
  }
  function applySchoolRole(targetUid,targetName,newRole){
    if(!isSchoolAdmin()||!targetUid||!newRole) return;
    if(!['student','teacher'].includes(newRole)) return;
    if(targetUid===uid()) return toast('자기 자신의 권한은 바꿀 수 없어요.');
    openDangerConfirm({
      title:`${targetName||'사용자'}님을 ${roleLabel(newRole)}(으)로 바꿀까요?`,
      desc:'우리 학교 안에서 적용돼요. 되돌리려면 다시 변경하면 돼요.',
      requireText:'', seconds:5, confirmLabel:'변경하기',
      checkLabel:'위 내용을 이해했고, 권한을 변경해도 됩니다.',
      onConfirm: async ()=>{
        let u=null;
        try{ const s=await db.collection('users').doc(targetUid).get(); if(s.exists) u=s.data(); }catch(e){ console.error(e); toast(errText(e)); return; }
        if(!u||u.deleted) return toast('이미 탈퇴한 계정이에요.');
        if((u.schoolId||'')!==(state.profile?.schoolId||'')) return toast('우리 학교 구성원에게만 할 수 있어요.');
        if(!['student','teacher'].includes(u.role||'student')) return toast('학생·교사에게만 변경할 수 있어요.');
        try{
          await db.collection('users').doc(targetUid).update({role:newRole,updatedAt:ts()});
          try{ await db.collection('publicProfiles').doc(targetUid).set({role:newRole,updatedAt:ts()},{merge:true}); }catch(e){ console.error(e); }
        }catch(e){ console.error(e); toast(errText(e)); return; }
        state.profileCache.delete(targetUid);
        closeAllModals();
        if(state.view==='admin') renderAdminPanel(state.adminTab);
        toast(`${roleLabel(newRole)}(으)로 바꿨어요.`);
      }
    });
  }
  async function openUserSchoolPicker(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    let list=[];
    try{ list=await loadSchoolList(); }catch(e){ console.error(e); }
    openModal(`<h2>학교 변경</h2><p class="desc">${esc(targetName||'사용자')}님의 학교를 골라 주세요. 바꾸면 그 학교 사람에게만 보여요.</p>
      <div class="list modal-scroll">${(list||[]).map(s=>`<button class="list-item" data-action="admin-set-school-apply" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}" data-sid="${esc(s.id)}"><div class="grow"><div class="title">${esc(s.name)}</div><div class="meta">${esc([s.atpt,s.kind].filter(Boolean).join(' · '))}</div></div><span>›</span></button>`).join('')||'<div class="empty-side">등록된 학교가 없어요. 먼저 학교를 등록해 주세요.</div>'}</div>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button></div>`);
  }
  async function leaveOldSchoolRooms(targetUid, oldSid, newSid){
    if(!targetUid || !oldSid) return 0;
    try{
      const snap=await db.collection('channels').where('memberIds','array-contains',targetUid).limit(200).get();
      const targets=snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>{
        if(r.deleted) return false;
        if((r.schoolId||'')===oldSid) return true;
        const ids=Array.isArray(r.schoolIds)?r.schoolIds:[];
        if(ids.includes(oldSid) && !(newSid && ids.includes(newSid))) return true;
        return false;
      });
      if(!targets.length) return 0;
      let n=0;
      for(const r of targets){
        try{ await db.collection('channels').doc(r.id).update({ memberIds:firebase.firestore.FieldValue.arrayRemove(targetUid), updatedAt:ts() }); n++; }
        catch(e){ console.warn('auto-leave', r.id, e?.code||e); }
        try{ await db.collection('channels').doc(r.id).collection('typing').doc(targetUid).delete().catch(()=>{}); }catch(e){}
        try{ await db.collection('channels').doc(r.id).collection('reads').doc(targetUid).delete().catch(()=>{}); }catch(e){}
      }
      return n;
    }catch(e){ console.warn('auto-leave list', e); return 0; }
  }
  async function applyUserSchool(targetUid,targetName,sid){
    if(!isAdmin()||!targetUid||!sid) return;
    const s=(state.schoolList||[]).find(x=>x.id===sid)||{name:''};
    let oldData=null;
    try{ const od=await db.collection('users').doc(targetUid).get(); if(od.exists) oldData=od.data(); }catch(e){}
    const lastChange=Number(oldData?.schoolChangedAt||0);
    if(lastChange && Date.now()-lastChange < SCHOOL_CHANGE_COOLDOWN_MS){
      const left=Math.ceil((SCHOOL_CHANGE_COOLDOWN_MS-(Date.now()-lastChange))/86400000);
      return toast(`학교 변경은 7일에 1회만 가능해요. (${left}일 뒤 가능)`);
    }
    const panel=openModal(`<h2>학교를 변경할까요?</h2><p class="desc">${esc(targetName||'사용자')}님을 '${esc(s.name||sid)}'(으)로 바꿔요.<br>이전 학교와 관련한 채팅방에서는 자동으로 나가져요. 본인 계정·기록은 그대로 남아 절대 지워지지 않아요.<br>학교 변경은 7일에 1회만 가능해요.</p>
      <label class="consent"><input type="checkbox" id="admSchoolCheck"><span>위 내용을 이해했고, 이전 학교 채팅방에서 자동 나가기에 동의해요.</span></label>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="admSchoolGo" data-label="변경하기">변경하기</button></div>`, {small:true});
    const go=panel.querySelector('#admSchoolGo');
    wireCountdownButton(go, 5, '변경하기');
    go.onclick=()=>runAsync(async()=>{
      if(go.disabled) return;
      if(!panel.querySelector('#admSchoolCheck')?.checked) return toast('자동 나가기 안내에 체크해 주세요.');
      const oldSid=oldData?.schoolId||'';
      await db.collection('users').doc(targetUid).update({schoolId:sid,schoolName:s.name||'',schoolChangedAt:Date.now(),updatedAt:ts()});
      try{ await db.collection('publicProfiles').doc(targetUid).set({schoolId:sid,schoolName:s.name||'',updatedAt:ts()},{merge:true}); }catch(e){ console.error(e); }
      try{ await logAdminAudit('school',`${targetName||'사용자'} → ${s.name||sid}`,targetUid); }catch(e){}
      try{ await notifyAccountAction(targetUid,`소속 학교가 '${s.name||sid}'(으)로 변경됐어요. 본인이 신청한 게 아니라면 선생님께 문의해 주세요.`); }catch(e){}
      if(oldSid && oldSid!==sid){ const n=await leaveOldSchoolRooms(targetUid, oldSid, sid); toast(`학교를 바꿨어요. 이전 학교 방 ${n}개에서 나왔어요.`); }
      else toast('학교를 바꿨어요.');
      state.profileCache.delete(targetUid);
      state.adminUsers=null;
      closeAllModals();
      if(state.view==='admin') renderAdminPanel(state.adminTab);
    });
  }
  async function openSelfSchoolChange(){
    const curSid=state.profile?.schoolId||'';
    const lastChange=Number(state.profile?.schoolChangedAt||0);
    if(lastChange && Date.now()-lastChange < SCHOOL_CHANGE_COOLDOWN_MS){
      const left=Math.ceil((SCHOOL_CHANGE_COOLDOWN_MS-(Date.now()-lastChange))/86400000);
      return toast(`학교 변경은 7일에 1회만 가능해요. (${left}일 뒤 가능)`);
    }
    let list=[];
    try{ list=await loadSchoolList(); }catch(e){ console.error(e); }
    const others=(list||[]).filter(s=>s.id!==curSid);
    openModal(`<h2>학교 변경 (전학·이직)</h2><p class="desc">현재 ${esc(state.profile?.schoolName||'학교 미지정')}<br>바꾸면 이전 학교와 관련한 채팅방에서 자동으로 나가져요. 본인 계정·기록은 그대로 남아 절대 지워지지 않아요. 새 학교에서도 그대로 쓸 수 있어요.<br>학교 변경은 7일에 1회만 가능해요.</p>
      <div class="field"><label>새 학교</label><div class="custom-select"><button type="button" class="select-button" data-select-open="selfSchool"><span data-selected="selfSchool" data-value="">골라 주세요</span><span>⌄</span></button></div></div>
      <div class="field"><label>새 학교 가입 코드</label><input id="selfSchoolCode" class="input code-input" maxlength="12" placeholder="새 학교 코드를 입력해 주세요"></div>
      <label class="consent"><input type="checkbox" id="selfSchoolCheck"><span>이전 학교 채팅방에서 자동으로 나가지는 것과, 7일에 1회 제한을 이해했어요.</span></label>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="selfSchoolGo" data-label="변경하기">변경하기</button></div>`, {small:true});
    const sb=$('[data-select-open="selfSchool"]');
    if(sb) wireDropdown(sb, others.map(s=>({value:s.id,label:s.name})), (v,l)=>{ sb.querySelector('[data-selected]').textContent=l; sb.querySelector('[data-selected]').dataset.value=v; });
    const go=$('#selfSchoolGo');
    wireCountdownButton(go, 5, '변경하기');
    go.onclick=()=>runAsync(async()=>{
      if(go.disabled) return;
      const nid=$('[data-selected="selfSchool"]')?.dataset.value||'';
      const code=($('#selfSchoolCode')?.value||'').trim().toUpperCase();
      if(!nid) return toast('새 학교를 골라 주세요.');
      if(!code) return toast('새 학교 가입 코드를 입력해 주세요.');
      if(!$('#selfSchoolCheck')?.checked) return toast('안내에 체크해 주세요.');
      const s=(list||[]).find(x=>x.id===nid)||{name:''};
      const oldSid=curSid;
      try{
        await db.collection('users').doc(uid()).update({ schoolId:nid, schoolName:s.name||'', schoolCode:code, schoolChangedAt:Date.now(), updatedAt:ts() });
      }catch(e){ console.error(e); return toast(errText(e)==='권한이 없어요.'?'학교 변경 조건(7일 제한·코드 확인)을 만족하지 못했어요.':errText(e)); }
      try{ await db.collection('publicProfiles').doc(uid()).set({schoolId:nid,schoolName:s.name||'',updatedAt:ts()},{merge:true}); }catch(e){ console.error(e); }
      state.profile={...state.profile,schoolId:nid,schoolName:s.name||'',schoolCode:code,schoolChangedAt:Date.now()};
      state.profileCache.set(uid(),state.profile);
      let n=0;
      if(oldSid && oldSid!==nid){ n=await leaveOldSchoolRooms(uid(), oldSid, nid); }
      try{ await loadSchool(); }catch(e){}
      try{ await refreshSchoolLicense(); }catch(e){}
      closeAllModals();
      renderSidebar();
      toast(`학교를 바꿨어요. 이전 학교 방 ${n}개에서 나왔어요.`);
    });
  }
  async function openUserClassModal(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    let school={grades:[1,2,3],classCounts:{}};
    try{
      const s=await db.collection('users').doc(targetUid).get();
      const sid=s.exists?(s.data().schoolId||''):'';
      if(sid){ const sc=await db.collection('schools').doc(sid).get(); if(sc.exists) school=schoolInfoFrom(sc.data()); }
    }catch(e){ console.error(e); }
    const grades=(school.grades&&school.grades.length)?school.grades:[1,2,3];
    openModal(`<h2>학급·반 변경</h2><p class="desc">${esc(targetName||'사용자')}님의 학년과 반을 바꿔요.</p>
      <div class="field"><label>학년</label><div class="custom-select"><button type="button" class="select-button" data-select-open="ucGrade"><span data-selected="ucGrade">학년을 골라 주세요</span><span>⌄</span></button></div></div>
      <div class="field"><label>반</label><div class="custom-select"><button type="button" class="select-button" data-select-open="ucClass"><span data-selected="ucClass">학년을 먼저 골라 주세요</span><span>⌄</span></button></div></div>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" data-action="admin-class-apply" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}">저장하기</button></div>`);
    const gb=$('[data-select-open="ucGrade"]');
    if(gb) wireDropdown(gb,grades.map(g=>({value:g,label:`${g}학년`})),(v,l)=>{
      gb.querySelector('[data-selected]').textContent=l; gb.querySelector('[data-selected]').dataset.value=v;
      const cb=$('[data-select-open="ucClass"]');
      if(cb){
        const n=Number(school.classCounts?.[v]||0)||12;
        wireDropdown(cb,Array.from({length:n},(_,i)=>({value:i+1,label:`${i+1}반`})),(cv,cl)=>{cb.querySelector('[data-selected]').textContent=cl;cb.querySelector('[data-selected]').dataset.value=cv;});
      }
    });
  }
  async function applyUserClass(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    const g=Number($('[data-selected="ucGrade"]')?.dataset.value||0), c=Number($('[data-selected="ucClass"]')?.dataset.value||0);
    if(!g||!c) return toast('학년과 반을 모두 골라 주세요.');
    confirmModal(`${targetName||'사용자'}님의 학급을 ${g}학년 ${c}반으로 바꿀까요?`,'바꾸면 그 학급 기준으로 보여요.',async()=>{
      await db.collection('users').doc(targetUid).update({grade:g,classNum:c,updatedAt:ts()});
      try{ await db.collection('publicProfiles').doc(targetUid).set({grade:g,classNum:c,updatedAt:ts()},{merge:true}); }catch(e){ console.error(e); }
      state.profileCache.delete(targetUid); state.adminUsers=null;
      closeAllModals();
      if(state.view==='admin') renderAdminPanel(state.adminTab);
      toast('학급 정보를 바꿨어요.');
    });
  }
  function openSuspendModal(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    openModal(`<h2>이용 정지</h2><p class="desc">${esc(targetName||'사용자')}님의 계정 이용을 멈춰요. 교사·관리자 계정도 정지할 수 있어요.</p>
      <div class="field"><label>사유</label><textarea id="suspendReason" class="input" maxlength="200" style="min-height:96px" placeholder="예: 같은 반 친구를 여러 번 놀림"></textarea><p class="desc" style="margin:7px 0 0;font-size:12px">적은 사유는 그 사람 화면에 그대로 보여요.</p></div>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" data-action="suspend-apply" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}">정지하기</button></div>`);
  }
  async function applySuspend(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    if(targetUid===uid()) return toast('자기 자신은 정지할 수 없어요.');
    const reason=($('#suspendReason')?.value||'').trim();
    if(reason.length<2) return toast('정지 사유를 적어 주세요.');
    openDangerConfirm({
      title:`${targetName||'사용자'}님의 이용을 정지할까요?`,
      desc:'그 사람은 로그인해도 채팅을 할 수 없어요.',
      requireText:'', seconds:5, confirmLabel:'정지하기',
      checkLabel:'위 내용을 이해했고, 정지해도 됩니다.',
      onConfirm: async ()=>{
        await db.collection('users').doc(targetUid).update({suspended:true,suspendReason:reason,suspendedAt:ts(),suspendedBy:uid(),updatedAt:ts()});
        state.profileCache.delete(targetUid); state.adminUsers=null;
        closeAllModals();
        if(state.view==='admin') renderAdminPanel(state.adminTab);
        toast('이용을 정지했어요.');
        try{ await logAdminAudit('suspend',`${targetName||'사용자'} · ${reason}`,targetUid); }catch(e){}
        try{ await notifyAccountAction(targetUid,`계정 이용이 정지됐어요. 사유: ${reason} 이의가 있으면 선생님께 문의해 주세요.`); }catch(e){}
      }
    });
  }
  async function unsuspendUser(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    confirmModal(`${targetName||'사용자'}님의 정지를 풀까요?`,'다시 정상적으로 이용할 수 있어요.',async()=>{
      await db.collection('users').doc(targetUid).update({suspended:false,suspendReason:'',suspendedAt:null,updatedAt:ts()});
      state.profileCache.delete(targetUid); state.adminUsers=null;
      closeAllModals();
      if(state.view==='admin') renderAdminPanel(state.adminTab);
      toast('정지를 풀었어요.');
      try{ await logAdminAudit('unsuspend',targetName||'사용자',targetUid); }catch(e){}
      try{ await notifyAccountAction(targetUid,'계정 정지가 풀렸어요. 다시 정상적으로 이용할 수 있어요.'); }catch(e){}
    });
  }
  async function renderAppeals(p){
    if(!isAdmin()) return;
    p.innerHTML=`<div class="admin-card"><h3>이의 제기</h3><p class="desc">이용이 멈춘 사용자가 보낸 내용이에요. 확인하고 바로 정지를 풀어 줄 수 있어요. 처리한 기록은 지울 수 있어요.</p><div class="admin-toolbar"><button type="button" class="soft-btn" data-action="purge-appeals">처리한 이의 제기 지우기</button></div><div id="appealList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>`;
    let rows=[];
    try{ const s=await db.collection('appeals').where('status','==','open').limit(100).get(); rows=s.docs.map(d=>({id:d.id,...d.data()})); }
    catch(e){ console.error(e); const h=$('#appealList'); if(h) h.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; return; }
    const host=$('#appealList'); if(!host) return;
    host.innerHTML=rows.map(r=>`<div class="list-item" style="align-items:flex-start"><div class="grow"><div class="title">${esc(r.name||'사용자')} · ${esc(r.schoolName||'학교 미지정')}</div><div class="meta">${esc(fmtDateTime(r.createdAt))}${r.email?' · '+esc(r.email):''}</div><div class="appeal-text">${esc(r.text||'')}</div></div><div class="appeal-btns" style="flex-wrap:wrap;justify-content:flex-end"><button class="soft-btn" style="flex:0 0 88px" data-action="appeal-unblock" data-id="${esc(r.id)}" data-uid="${esc(r.uid||'')}" data-name="${esc(r.name||'')}">정지 해제</button><button class="soft-btn" style="flex:0 0 76px" data-action="appeal-close" data-id="${esc(r.id)}" data-uid="${esc(r.uid||'')}" data-name="${esc(r.name||'')}">처리 완료</button><button class="soft-btn" style="flex:0 0 52px;color:var(--danger)" data-action="delete-appeal" data-id="${esc(r.id)}">삭제</button></div></div>`).join('')||'<div class="empty-side">대기 중인 이의 제기가 없어요.</div>';
  }
  async function handleAppeal(id,targetUid,targetName,unblock){
    if(!isAdmin()||!id) return;
    const run=async()=>{
      await db.collection('appeals').doc(id).update({status:'resolved',handledBy:uid(),handledAt:ts()});
      if(unblock && targetUid){
        await db.collection('users').doc(targetUid).update({suspended:false,suspendReason:'',suspendedAt:null,updatedAt:ts()});
        state.profileCache.delete(targetUid); state.adminUsers=null;
      }
      closeAllModals();
      renderAdminPanel(state.adminTab);
      toast(unblock?'정지를 풀고 처리했어요.':'처리 완료로 표시했어요.');
    };
    if(!unblock){ try{ await run(); }catch(e){ console.error(e); toast(errText(e)); } return; }
    confirmModal(`${targetName||'사용자'}님의 정지를 풀까요?`,'이의 제기를 받아들이고 바로 이용할 수 있게 해요.',run);
  }
  // ---------- 교사 승격 신청 (학생 → 교사 · 즉시 승격 불가) ----------
  // 방법1: 재직증명서 파일을 올리면 총관리자가 직접 보고 승인한다.
  // 방법2: 교육청 이메일 도메인 확인 + 수신함 링크 인증을 마치면 신청된다.
  // 학생은 어떤 방법으로도 스스로 권한을 올릴 수 없고, 최종 승인은 총관리자만 한다.
  // 교육청 도메인만 허용한다 — 학교 홈페이지(es.kr/ms.kr/hs.kr 등)는 학생도 쓰므로 제외
  const KNOWN_EDU_DOMAINS=['sen.go.kr','pen.go.kr','dge.go.kr','ice.go.kr','gen.go.kr','doe.go.kr','cbe.go.kr','cne.go.kr','jbe.go.kr','jne.go.kr','gbe.go.kr','gne.go.kr','jje.go.kr','kne.go.kr','edu.go.kr'];
  function eduDomainOf(email){
    const m=String(email||'').trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
    return m?m[1]:'';
  }
  // 교육청 하위 도메인(xxx.sen.go.kr 등)도 허용한다
  function eduDomainAllowed(dom,allowed){
    const d=String(dom||'').toLowerCase();
    return (allowed||[]).some(a=>{ a=String(a||'').toLowerCase(); return d===a||d.endsWith('.'+a); });
  }
  async function schoolEduDomains(){
    const sid=state.profile?.schoolId||'';
    let custom=[];
    try{
      if(sid){ const s=await db.collection('schools').doc(sid).get(); const v=s.exists?(s.data().eduDomains||[]):[]; if(Array.isArray(v)) custom=v.map(x=>String(x||'').trim().toLowerCase()).filter(Boolean); }
    }catch(e){}
    return [...new Set([...custom,...KNOWN_EDU_DOMAINS])];
  }
  async function openTeacherRequest(){
    if(state.profile?.role!=='student') return toast('이미 교사·관리자 계정이에요.');
    let req=null;
    try{ const s=await db.collection('teacherRequests').doc(uid()).get(); if(s.exists) req={id:s.id,...s.data()}; }catch(e){}
    if(req&&req.status==='pending') return openModal(`<h2>교사 인증 신청</h2><p class="desc">심사 중이에요. 총관리자가 확인하면 알려드릴게요. (${esc(req.method==='certificate'?'재직증명서':'교육청 이메일')})</p><div class="modal-actions"><button class="confirm" data-close-modal>확인</button></div>`,{small:true});
    if(req&&req.status==='rejected') toast(`지난 신청이 반려됐어요.${req.rejectReason?` 사유: ${req.rejectReason}`:''} 다시 신청할 수 있어요.`);
    const verified=state.eduVerifiedEmail||'';
    openModal(`<h2>교사 인증 신청</h2><p class="desc">학생 계정에서는 직접 교사 권한을 켤 수 없어요. 아래 둘 중 하나로 인증하면 총관리자가 보고 승인해요.</p>
      <div class="tabs"><button type="button" class="tab active" data-action="tr-tab" data-tab="cert">재직증명서</button><button type="button" class="tab" data-action="tr-tab" data-tab="email">교육청 이메일</button></div>
      <div id="trCert">
        <div class="field"><label>재직증명서 사진·파일 (8MB 이하)</label><div class="photo-row"><div id="trCertPreview" class="photo-preview"><span>파일 없음</span></div><div class="grow"><input type="file" id="trCertFile" accept="image/*,.pdf" hidden><button type="button" class="soft-btn" style="width:100%" data-action="tr-cert-pick">파일 고르기</button></div></div></div>
        <p class="desc">제출하신 서류는 운영자에게만 전달돼요. 운영자가 확인 후 서류는 즉시 영구 삭제해요. 교사 인증이 반려되었다면 파일을 다시 보내주셔야 확인할 수 있어요.</p>
        <div class="warn-box" style="border-color:var(--danger);background:var(--danger-soft);color:var(--danger)">장난으로 서류를 보내면 계정이 이용 정지될 수 있어요.</div>
        <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" data-action="tr-cert-send">제출하기</button></div>
      </div>
      <div id="trEmail" class="hidden">
        <div class="field"><label>교육청 이메일</label><input id="trEmailInput" class="input" type="email" placeholder="예: teacher@sen.go.kr" value="${esc(verified)}"></div>
        <p class="desc">학교에 등록된 교육청 도메인과 맞아야 해요. 맞는 도메인이면 그 메일함으로 확인 링크를 보내고, 링크를 눌러야 인증이 끝나요.</p>
        ${verified?`<div class="warn-box" style="border-color:var(--green);background:#F0FDF4;color:#166534">수신함 인증 완료: ${esc(verified)}</div>`:''}
        <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="soft-btn" data-action="tr-email-send">확인 링크 보내기</button><button type="button" class="confirm" data-action="tr-email-submit" ${verified?'':'disabled style="opacity:.5"'}>인증 완료 · 신청하기</button></div>
      </div>`,{});
  }
  async function submitTeacherCert(){
    if(state.profile?.role!=='student') return;
    const fi=$('#trCertFile'); const f=fi?.files?.[0];
    if(!f) return toast('재직증명서 파일을 먼저 골라 주세요.');
    if(f.size>8*1024*1024) return toast('8MB 이하 파일로 올려 주세요.');
    // 반려된 예전 신청이 있으면 깨끗이 지우고 새로 만든다 (덮어쓰기 권한 문제 원천 차단)
    try{
      const ex=await db.collection('teacherRequests').doc(uid()).get();
      if(ex.exists){
        const ev=ex.data()||{};
        if(ev.status==='pending') return toast('심사 중인 신청이 있어요.');
        const n=ev.certChunked?Number(ev.certChunks||0):0;
        for(let i=0;i<n&&i<10;i++){ try{ await db.collection('teacherRequests').doc(uid()).collection('chunks').doc(`${uid()}_${i}`).delete(); }catch(e){} }
        try{ await db.collection('teacherRequests').doc(uid()).delete(); }catch(e){}
      }
    }catch(e){}
    toast('서류를 총관리자에게 전송하는 중이에요…');
    try{
      const data=await readAsDataUrl(f);
      const doc={uid:uid(),displayName:state.profile?.displayName||'',email:state.profile?.email||'',schoolId:state.profile?.schoolId||'',schoolName:state.profile?.schoolName||'',method:'certificate',fileName:String(f.name||'재직증명서').slice(0,80),fileType:String(f.type||''),fileSize:f.size,status:'pending',createdAt:ts(),updatedAt:ts()};
      if(data.length<=INLINE_MAX){
        doc.fileData=data;
        await db.collection('teacherRequests').doc(uid()).set(doc);
      } else {
        const chunks=[];
        for(let i=0;i<data.length;i+=CHUNK_SIZE) chunks.push(data.slice(i,i+CHUNK_SIZE));
        if(chunks.length>10) return toast('파일이 너무 커요. 8MB 이하로 줄여 주세요.');
        for(let i=0;i<chunks.length;i++) await db.collection('teacherRequests').doc(uid()).collection('chunks').doc(`${uid()}_${i}`).set({i,senderUid:uid(),data:chunks[i],createdAt:ts()});
        doc.certChunked=true; doc.certChunks=chunks.length; doc.fileData='';
        await db.collection('teacherRequests').doc(uid()).set(doc);
      }
      closeModal(); toast('제출했어요. 총관리자가 확인한 뒤 승인해요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function sendEduLink(){
    const email=($('#trEmailInput')?.value||'').trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('이메일 주소를 정확히 적어 주세요.');
    const dom=eduDomainOf(email);
    const allowed=await schoolEduDomains();
    if(!eduDomainAllowed(dom,allowed)) return toast('우리 학교에 등록된 교육청 도메인과 달라요. 재직증명서로 신청해 주세요.');
    try{
      await auth.sendSignInLinkToEmail(email,{url:location.origin+location.pathname,handleCodeInApp:true});
      try{ localStorage.setItem('edutalk_edu_email',email); }catch(e){}
      toast('확인 링크를 보냈어요. 그 메일함에서 링크를 눌러 주세요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  async function completeEduLink(){
    try{
      if(!auth.isSignInWithEmailLink(location.href)) return false;
      let email='';
      try{ email=localStorage.getItem('edutalk_edu_email')||''; }catch(e){}
      if(!email) email=window.prompt('확인 링크를 받은 이메일 주소를 적어 주세요.')||'';
      if(!email) return true;
      const cred=firebase.auth.EmailAuthProvider.credentialWithLink(email,location.href);
      await auth.currentUser.linkWithCredential(cred);
      try{ localStorage.removeItem('edutalk_edu_email'); }catch(e){}
      try{ history.replaceState(null,'',location.pathname); }catch(e){}
      state.eduVerifiedEmail=email;
      toast('이메일 인증이 끝났어요. 교사 인증 신청에서 신청을 마무리해 주세요.');
      openTeacherRequest();
      return true;
    }catch(e){ console.error(e); toast('인증에 실패했어요. 링크를 다시 보내 주세요.'); return true; }
  }
  async function submitTeacherEmail(){
    if(state.profile?.role!=='student') return;
    const email=state.eduVerifiedEmail||($('#trEmailInput')?.value||'').trim();
    if(!state.eduVerifiedEmail) return toast('먼저 확인 링크를 보내고 메일함에서 인증을 마쳐 주세요.');
    const dom=eduDomainOf(email);
    const allowed=await schoolEduDomains();
    if(!eduDomainAllowed(dom,allowed)) return toast('도메인이 확인되지 않아요.');
    try{
      const ex=await db.collection('teacherRequests').doc(uid()).get();
      if(ex.exists){
        if((ex.data()||{}).status==='pending') return toast('심사 중인 신청이 있어요.');
        try{ await db.collection('teacherRequests').doc(uid()).delete(); }catch(e){}
      }
    }catch(e){}
    try{
      await db.collection('teacherRequests').doc(uid()).set({uid:uid(),displayName:state.profile?.displayName||'',email:state.profile?.email||'',schoolId:state.profile?.schoolId||'',schoolName:state.profile?.schoolName||'',method:'edu-email',eduEmail:email,emailVerified:true,status:'pending',createdAt:ts(),updatedAt:ts()});
      state.eduVerifiedEmail='';
      closeModal(); toast('신청했어요. 총관리자가 확인한 뒤 승인해요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  // ---------- 익명 건의함 (작성자 식별정보를 저장하지 않는다) ----------
  // 접속 로그(IP·기기 식별값)는 AES-GCM 암호문으로만 보관하고 화면에는 누구에게도 노출하지 않는다.
  // (순수 클라이언트 방식이라 키는 학교ID에서 파생된다 — 완벽한 종단간 암호화가 아니라 수사 협조용 봉인 보관이다)
  function deviceUuid(){
    try{
      let id=localStorage.getItem('edutalk_device');
      if(!id){ const b=new Uint8Array(16); try{ crypto.getRandomValues(b); }catch(e){ for(let i=0;i<16;i++) b[i]=Math.floor(Math.random()*256); } id=[...b].map(x=>x.toString(16).padStart(2,'0')).join(''); localStorage.setItem('edutalk_device',id); }
      return id;
    }catch(e){ return ''; }
  }
  async function sha256hex(s){
    try{
      const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(s)));
      return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');
    }catch(e){ return ''; }
  }
  async function sealKey(schoolId){
    const km=await crypto.subtle.importKey('raw',new TextEncoder().encode('edutalk-seal-v1|'+String(schoolId||'')),{name:'PBKDF2'},false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:new TextEncoder().encode('edutalk-suggest'),iterations:50000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt']);
  }
  async function sealText(schoolId,plain){
    const key=await sealKey(schoolId);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(String(plain||'')));
    const b=new Uint8Array(12+ct.byteLength); b.set(iv,0); b.set(new Uint8Array(ct),12);
    let s=''; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
    return btoa(s);
  }
  async function openSuggestBox(){
    const sid=state.profile?.schoolId||'';
    let stats=null;
    try{ const s=await db.collection('suggestionStats').doc(sid).get(); if(s.exists) stats=s.data(); }catch(e){}
    openModal(`<h2>익명 건의함</h2><p class="desc">누가 썼는지 알 수 없게 학교 건의 담당 선생님에게만 전달돼요.${stats?`<br>지금까지 ${Number(stats.resolved||0)}건 해결됨 · ${Number(stats.deleted||0)}건 보관 중` : ''}</p>
      <p class="desc" style="color:var(--danger);font-weight:700">접수한 뒤에는 취소하거나 고칠 수 없어요. 보내기 전에 다시 읽어 주세요.</p>
      <div class="field"><label>건의 내용 (1000자까지)</label><textarea id="suggestText" class="input" maxlength="1000" style="min-height:120px;resize:vertical" placeholder="학교에 바라는 점을 적어 주세요."></textarea></div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" data-action="suggest-next">등록하기</button></div>`);
  }
  async function suggestNoticeNext(){
    const text=($('#suggestText')?.value||'').trim();
    if(!text) return toast('내용을 적어 주세요.');
    if(text.length>1000) return toast('1000자까지만 적어 주세요.');
    const panel=openModal(`<h2>등록하기 전에 확인해 주세요</h2><div class="notice-ico warn" aria-hidden="true"><span>!</span></div><div class="desc" style="white-space:pre-line">담당 교사를 포함한 앱 화면에서는 작성자가 누구인지 알 수 없어요. 단, 음란물·협박·학교폭력 등 부적절한 건의사항을 작성할 시 관련 법령에 따라 수사기관(경찰)의 영장 등 적법한 요청이 있을 경우 접속 기록(IP 등)이 수사 기관에 제공될 수 있으니 주의가 필요해요.</div><div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="suggestGo">위 내용을 확인하고 등록하기</button></div>`,{small:true});
    panel.querySelector('#suggestGo').onclick=()=>runAsync(()=>submitSuggestion(text));
  }
  async function submitSuggestion(text){
    const sid=state.profile?.schoolId||'';
    if(!sid) return toast('학교 정보가 없어요.');
    try{
      const last=Number(localStorage.getItem('edutalk_suggest_last')||0);
      if(Date.now()-last<5*60000) return toast('도배 방지를 위해 5분에 한 번만 쓸 수 있어요.');
    }catch(e){}
    toast('익명으로 접수하는 중이에요…');
    try{
      const ip=await fetchClientIp().catch(()=>'');
      const ua=String(navigator.userAgent||'').slice(0,300);
      const dev=deviceUuid();
      const ref=db.collection('suggestions').doc();
      const now=Date.now();
      await db.collection('suggestions').doc(ref.id).set({schoolId:sid,text:String(text).slice(0,1000),status:'open',flagged:false,createdAt:ts(),updatedAt:ts(),expire_at:firebase.firestore.Timestamp.fromMillis(now+365*86400000)});
      try{
        await db.collection('suggestionLogs').doc(ref.id).set({schoolId:sid,suggestionId:ref.id,ipHash:await sha256hex(ip+'|'+sid),ipEnc:await sealText(sid,ip),uaEnc:await sealText(sid,ua),devEnc:await sealText(sid,dev),createdAt:ts()});
      }catch(e){ console.warn('suggest log',e?.code||e); }
      closeAllModals(); toast('접수됐어요. 담당 선생님이 확인해요.');
      try{ localStorage.setItem('edutalk_suggest_last',String(Date.now())); }catch(e){}
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  // ---------- 관리자 감사 로그 (누가 무엇을 했는지 · 수정 불가 · 이후 기능도 이 함수를 쓴다) ----------
  async function logAdminAudit(action,detail,targetUid){
    try{
      if(!(isTeacher()||isAdmin()||isSchoolAdmin())) return;
      await db.collection('adminAudit').add({schoolId:state.profile?.schoolId||'',action:String(action||''),detail:String(detail||'').slice(0,300),targetUid:targetUid||'',byUid:uid(),byName:state.profile?.displayName||'',createdAt:ts()});
    }catch(e){ console.warn('audit',e?.code||e); }
  }
  // 계정 조치 알림 (학교 변경·권한 변경·타임아웃·정지 — 본인에게 팝업으로 알려준다 · X로 닫기 가능)
  async function notifyAccountAction(targetUid,text){
    try{
      if(!targetUid||targetUid===uid()) return;
      await db.collection('directNotices').add({targetUid,senderId:uid(),senderName:state.profile?.displayName||'',text:String(text||'').slice(0,300),read:false,createdAt:ts()});
    }catch(e){ console.warn('account notice',e?.code||e); }
  }
  // ---------- 예약 발송 (열려 있는 앱이 대신 보낸다 · Functions 도입 전까지) ----------
  let schedTimer=null;
  function startSchedTimer(){
    if(schedTimer) return;
    schedTimer=setInterval(()=>{ runAsync(()=>tickScheduledNotices()); },45000);
    runAsync(()=>tickScheduledNotices());
  }
  async function tickScheduledNotices(){
    if(!uid()||!isTeacher()) return;
    const sid=state.profile?.schoolId||'';
    let rows=[];
    try{
      // 읽기 규칙(byUid 본인) 때문에 본인 예약만 조회하고 앞에서 거른다
      const s=await db.collection('scheduledNotices').where('byUid','==',uid()).limit(20).get();
      rows=s.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.status==='waiting'&&r.schoolId===(state.profile?.schoolId||'')&&docTs(r.runAt)<=Date.now());
    }catch(e){ return; }
    for(const r of rows){
      try{
        let claimed=false;
        await db.runTransaction(async tx=>{
          const s=await tx.get(db.collection('scheduledNotices').doc(r.id));
          if(s.exists&&s.data().status==='waiting'){ tx.update(db.collection('scheduledNotices').doc(r.id),{status:'sending',updatedAt:ts()}); claimed=true; }
        });
        if(!claimed) continue;
        const roomId=r.roomId||'';
        if(roomId){
          const msgRef=db.collection('channels').doc(roomId).collection('messages').doc();
          const batch=db.batch();
          batch.set(msgRef,{text:String(r.text||''),senderId:uid(),senderName:state.profile?.displayName||'사용자',senderRole:state.profile?.role||'student',replyToText:null,createdAt:ts(),deleted:false,scheduled:true});
          batch.update(db.collection('channels').doc(roomId),{lastText:String(r.text||''),lastSenderId:uid(),lastSenderName:state.profile?.displayName||'사용자',lastCreatedAt:ts(),updatedAt:ts()});
          await batch.commit();
        }
        await db.collection('scheduledNotices').doc(r.id).update({status:'sent',sentAt:ts(),updatedAt:ts()});
      }catch(e){ console.warn('sched',e?.code||e); }
    }
  }
  async function renderSchedCard(p){
    if(!isTeacher()||!p) return;
    if($('#schedCard')) return;
    const rooms=(state.rooms||[]).filter(r=>r.type==='notice'||r.createdBy===uid()||isAdmin());
    const wrap=document.createElement('div');
    wrap.innerHTML=`<div class="admin-card" id="schedCard"><h3>예약 발송</h3><p class="desc">쓴 시간에 자동으로 올라가요. 예약한 본인의 앱이 켜져 있을 때 실행돼요.</p>
      <div class="field"><label>방</label><div class="custom-select"><button type="button" class="select-button" data-select-open="schedRoom"><span data-selected="schedRoom" data-value="">골라 주세요</span><span>⌄</span></button></div></div>
      <div class="admin-grid"><div class="field"><label>날짜·시간</label><input id="schedWhen" class="input" type="datetime-local"></div></div>
      <div class="field"><label>내용</label><textarea id="schedText" class="input" maxlength="1000" style="min-height:80px" placeholder="예약할 공지 내용을 적어 주세요."></textarea></div>
      <div class="admin-toolbar"><button type="button" class="soft-btn" data-action="sched-add">예약하기</button></div>
      <div id="schedList" class="list"></div></div>`;
    p.appendChild(wrap.firstElementChild);
    const sc=$('[data-select-open="schedRoom"]');
    if(sc) wireDropdown(sc,rooms.map(r=>({value:r.id,label:r.name||'채팅방'})),(v,l)=>{ sc.querySelector('[data-selected]').textContent=l; sc.querySelector('[data-selected]').dataset.value=v; });
    paintSchedList();
  }
  async function paintSchedList(){
    const host=$('#schedList'); if(!host) return;
    let rows=[];
    try{ const s=await db.collection('scheduledNotices').where('byUid','==',uid()).limit(30).get(); rows=s.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.status==='waiting'); }catch(e){}
    rows.sort((a,b)=>docTs(a.runAt)-docTs(b.runAt));
    host.innerHTML=rows.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(String(r.text||'').slice(0,60))}</div><div class="meta">${esc(fmtDateTime(r.runAt))}</div></div><button class="soft-btn" style="flex:0 0 64px" data-action="sched-cancel" data-id="${esc(r.id)}">취소</button></div>`).join('')||'<div class="empty-side">예약된 발송이 없어요.</div>';
  }
  async function addScheduled(){
    if(!isTeacher()) return;
    const roomId=$('[data-selected="schedRoom"]')?.dataset.value||'';
    const when=$('#schedWhen')?.value||'';
    const text=($('#schedText')?.value||'').trim();
    if(!roomId) return toast('방을 골라 주세요.');
    if(!text) return toast('내용을 적어 주세요.');
    const at=new Date(when).getTime();
    if(!(at>Date.now()+60000)) return toast('지금보다 1분 뒤로 잡아 주세요.');
    try{
      await db.collection('scheduledNotices').add({roomId,schoolId:state.profile?.schoolId||'',byUid:uid(),byName:state.profile?.displayName||'',text:text.slice(0,1000),runAt:firebase.firestore.Timestamp.fromMillis(at),status:'waiting',createdAt:ts()});
    }catch(e){ console.error(e); return toast(errText(e)); }
    $('#schedText').value='';
    toast('예약했어요.');
    paintSchedList();
  }
  async function cancelScheduled(id){
    if(!id) return;
    try{ await db.collection('scheduledNotices').doc(id).delete(); }catch(e){ console.error(e); return toast(errText(e)); }
    paintSchedList();
  }
  // ---------- 공지방 미열람자 재알림 ----------
  async function renotifyUnread(roomId){
    if(!isTeacher()) return;
    const r=state.rooms.find(x=>x.id===roomId)||state.room; if(!r) return;
    const map=state.roomReads instanceof Map?state.roomReads:new Map();
    const members=[...(r.memberIds||[])].filter(id=>id&&id!==uid());
    let targets=[];
    if(state.room?.id===roomId&&map.size){
      let latest=0;
      (state.messages||[]).forEach(m=>{ if(!m.deleted&&!m.system) latest=Math.max(latest,docTs(m.createdAt)); });
      targets=members.filter(id=>{ const v=map.get(id); return !(v&&v.at>=latest); });
    } else {
      targets=members;
    }
    targets=targets.slice(0,30);
    if(!targets.length) return toast('모두 읽었어요.');
    confirmModal(`${targets.length}명에게 다시 알릴까요?`,`읽지 않은 사람에게만 안내가 가요.`,async()=>{
      let n=0;
      for(const t of targets){
        try{ await db.collection('directNotices').add({targetUid:t,senderId:uid(),senderName:state.profile?.displayName||'',text:`'${r.name||'공지'}'에 안 읽은 안내가 있어요. 확인해 주세요.`,read:false,createdAt:ts()}); n++; }catch(e){}
      }
      toast(`${n}명에게 다시 알렸어요.`);
    });
  }
  // ---------- 급식·시간표 위젯 (NEIS 공개 API · 하루 1회 캐시) ----------
  function neisSchoolCodes(){
    // 수동으로 저장한 NEIS 코드가 있으면 우선 사용 (학교ID가 NEIS 형식이 아닌 경우 fallback)
    try{
      const raw=localStorage.getItem('edutalk_neis_manual_'+(state.profile?.schoolId||''));
      if(raw){
        const j=JSON.parse(raw);
        if(j && j.atpt && j.school) return {atpt:String(j.atpt).trim(), school:String(j.school).trim()};
      }
    }catch(e){}
    const parts=String(state.profile?.schoolId||'').split('-');
    if(parts.length!==2||!parts[0]||!parts[1]) return null;
    return {atpt:parts[0],school:parts[1]};
  }
  function openNeisManual(){
    const cur=neisSchoolCodes()||{atpt:'',school:''};
    openModal(`<h2>NEIS 코드 직접 입력</h2><p class="desc">학교가 NEIS 형식의 ID가 아닐 때, 교육청 코드와 학교 코드를 직접 입력하면 급식·시간표를 불러올 수 있어요.<br>학교 행정실에서 NEIS 코드를 확인해 주세요. (예: B10 - 7010559)</p><div class="field"><label>교육청 코드 (ATPT_OFCDC_SC_CODE)</label><input id="neisAtpt" class="input" maxlength="10" placeholder="예: B10" value="${esc(cur.atpt||'')}"></div><div class="field"><label>학교 코드 (SD_SCHUL_CODE)</label><input id="neisSchul" class="input" maxlength="10" placeholder="예: 7010559" value="${esc(cur.school||'')}"></div><div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" id="neisManualSave">저장하고 불러오기</button></div>`);
    $('#neisManualSave').onclick=()=>{
      const atpt=($('#neisAtpt')?.value||'').trim().toUpperCase();
      const schul=($('#neisSchul')?.value||'').trim();
      if(!atpt || !schul) return toast('두 코드를 모두 입력해 주세요.');
      try{ localStorage.setItem('edutalk_neis_manual_'+(state.profile?.schoolId||''), JSON.stringify({atpt,school:schul})); }catch(e){}
      closeModal();
      loadMealWidget(true);
      toast('NEIS 코드를 저장했어요.');
    };
  }
  function schoolYearSem(d){
    const y=d.getFullYear(), m=d.getMonth()+1;
    return m>=3?{ay:String(y),sem:'1'}:{ay:String(y-1),sem:'2'};
  }
  function ttEndpoint(){
    const kind=String(state.school?.kind||state.profile?.schoolName||'');
    if(/초등/.test(kind)) return 'elsTimetable';
    if(/중학|중학교/.test(kind)) return 'misTimetable';
    if(/고등|고교|고등학교/.test(kind)) return 'hisTimetable';
    if(/특수/.test(kind)) return 'spsTimetable';
    return 'hisTimetable';
  }
  async function loadMealWidget(force){
    const host=$('#mealWidget'); if(!host) return;
    const codes=neisSchoolCodes();
    if(!codes){ host.innerHTML='<div class="empty-side">NEIS 등록 학교가 아니에요.<br><button type="button" class="text-btn" style="margin-top:8px" data-action="neis-manual">NEIS 코드 직접 입력</button></div>'; return; }
    const now=new Date();
    const ymd=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const ck=`edutalk_meal_${codes.atpt}-${codes.school}_${ymd}`;
    const paint=(diet,tt)=>{
      const lunch=diet?String(diet.DDISH_NM||'').replace(/<br\s*\/?>/gi,' · ').replace(/\([^)]*\)/g,'').trim():'';
      const cal=diet?String(diet.CAL_INFO||'').trim():'';
      const rows=(tt||[]).map(r=>`${r.PERIO}교시 ${r.ITRT_CNTNT||''}`);
      host.innerHTML=`<div class="meal-box"><div class="meal-title">🍱 오늘 중식${cal?` · ${esc(cal)}`:''}</div><div class="meal-text">${lunch?esc(lunch):'급식 정보가 없어요.'}</div>${rows.length?`<div class="meal-title" style="margin-top:8px">📚 오늘 시간표</div><div class="meal-text">${rows.map(esc).join('<br>')}</div>`:''}</div>`;
    };
    // 캐시가 있으면 먼저 보여주고, 30분마다 뒤에서 새로고침한다 (실패해도 캐시는 유지)
    let cached=null;
    const mealLoadingHtml = '<div class="meal-loading"><span class="shimmer-text">불러오는 중이에요..</span></div>' + loadingShimmer(3);
    try{ cached=JSON.parse(localStorage.getItem(ck)||'null'); if(cached) paint(cached.diet,cached.tt); else host.innerHTML=mealLoadingHtml; }catch(e){ host.innerHTML=mealLoadingHtml; }
    if(!force&&state.mealFetchedAt&&Date.now()-state.mealFetchedAt<30*60000&&cached) return;
    state.mealFetchedAt=Date.now();
    try{
      let diet=cached?.diet||null, tt=cached?.tt||[];
      try{
        const r=await fetch(`https://open.neis.go.kr/hub/mealServiceDietInfo?Type=json&pIndex=1&pSize=10&ATPT_OFCDC_SC_CODE=${encodeURIComponent(codes.atpt)}&SD_SCHUL_CODE=${encodeURIComponent(codes.school)}&MLSV_YMD=${ymd}`);
        const j=await r.json();
        const rows=(j?.mealServiceDietInfo?.[1]?.row)||[];
        const found=rows.find(x=>String(x.MMEAL_SC_NM||'').includes('중식'))||rows[0]||null;
        if(found) diet=found;
      }catch(e){}
      try{
        const {ay,sem}=schoolYearSem(now);
        const g=Number(state.profile?.grade||0), c=Number(state.profile?.classNum||0);
        if(g&&c){
          // 학교급 추정이 틀릴 수 있어서 끝까지 돌아가며 맞는 것을 쓴다 (맞춘 것은 기억해 둔다)
          const eps=[ttEndpoint(),...['elsTimetable','misTimetable','hisTimetable','spsTimetable'].filter(e=>e!==ttEndpoint())];
          const saved=state.ttEndpoint||'';
          const ordered=saved?[saved,...eps.filter(e=>e!==saved)]:eps;
          for(const ep of ordered){
            try{
              const r=await fetch(`https://open.neis.go.kr/hub/${ep}?Type=json&pIndex=1&pSize=20&ATPT_OFCDC_SC_CODE=${encodeURIComponent(codes.atpt)}&SD_SCHUL_CODE=${encodeURIComponent(codes.school)}&AY=${ay}&SEM=${sem}&GRADE=${g}&CLASS_NM=${c}&TI_FROM_YMD=${ymd}&TI_TO_YMD=${ymd}`);
              const j=await r.json();
              const rows=(j?.[ep]?.[1]?.row)||[];
              if(rows.length){ tt=rows; state.ttEndpoint=ep; break; }
            }catch(e){}
          }
        }
      }catch(e){}
      if(diet||tt.length){
        try{ localStorage.setItem(ck,JSON.stringify({diet,tt})); }catch(e){}
        const h2=$('#mealWidget'); if(h2) paint(diet,tt);
      } else if(!cached){
        const h2=$('#mealWidget'); if(h2) h2.innerHTML='<div class="empty-side">오늘 정보가 없어요.</div>';
      }
    }catch(e){ if(!cached){ const h2=$('#mealWidget'); if(h2) h2.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; } }
  }
  // ---------- 투표 (방 안에서 바로 만들기 · 마감은 작성자·교사만) ----------
  function openPollModal(){
    if(!state.room) return;
    openModal(`<h2>투표 만들기</h2><p class="desc">${esc(state.room.name||'채팅방')}에서 바로 투표해요.</p>
      <div class="field"><label>질문</label><input id="pollQ" class="input" maxlength="80" placeholder="예: 소풍 장소 정하기"></div>
      <div class="field"><label>보기 (2~6개)</label><div id="pollOpts"><input class="input" data-poll-opt maxlength="30" placeholder="보기 1"><input class="input" data-poll-opt maxlength="30" placeholder="보기 2" style="margin-top:6px"></div><button type="button" class="soft-btn" style="margin-top:8px" data-action="poll-opt-add">+ 보기 추가</button></div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button type="button" class="confirm" data-action="poll-create">올리기</button></div>`);
  }
  async function createPoll(){
    if(!state.room) return;
    const q=($('#pollQ')?.value||'').trim().slice(0,80);
    const opts=[...document.querySelectorAll('[data-poll-opt]')].map(i=>i.value.trim()).filter(Boolean).slice(0,6);
    if(!q) return toast('질문을 적어 주세요.');
    if(opts.length<2) return toast('보기를 2개 이상 적어 주세요.');
    const room=state.room;
    try{
      const msgRef=db.collection('channels').doc(room.id).collection('messages').doc();
      const batch=db.batch();
      batch.set(msgRef,{text:'',senderId:uid(),senderName:state.profile?.displayName||'사용자',senderRole:state.profile?.role||'student',replyToText:null,createdAt:ts(),deleted:false,attachment:{kind:'poll',name:'투표',poll:{q,opts,multi:false,closed:false}}});
      batch.update(db.collection('channels').doc(room.id),{lastText:'📊 '+q,lastSenderId:uid(),lastSenderName:state.profile?.displayName||'사용자',lastCreatedAt:ts(),updatedAt:ts()});
      await batch.commit();
      closeModal(); toast('투표를 올렸어요.');
    }catch(e){ console.error(e); toast(errText(e)); }
  }
  function pollDataOf(m){
    if(state.pollVotes instanceof Map&&state.pollVotes.has(m.id)) return state.pollVotes.get(m.id);
    fetchPollVotes(m);
    return {counts:(m.attachment?.poll?.opts||[]).map(()=>0),total:0,mine:[]};
  }
  async function fetchPollVotes(m){
    if(!m?.id||!state.room) return;
    if(!(state.pollVotes instanceof Map)) state.pollVotes=new Map();
    if(!(state.pollFetching instanceof Set)) state.pollFetching=new Set();
    if(state.pollVotes.has(m.id)||state.pollFetching.has(m.id)) return;
    state.pollFetching.add(m.id);
    try{
      const s=await db.collection('channels').doc(state.room.id).collection('messages').doc(m.id).collection('votes').limit(200).get();
      const n=(m.attachment?.poll?.opts||[]).length;
      const counts=new Array(n).fill(0); let total=0; const mine=[];
      s.docs.forEach(d=>{
        const v=d.data()||{};
        const ch=Array.isArray(v.choices)?v.choices.filter(x=>Number.isInteger(x)&&x>=0&&x<n):[];
        if(!ch.length) return;
        total++;
        ch.forEach(i=>counts[i]++);
        if(d.id===uid()) mine.push(...ch);
      });
      state.pollVotes.set(m.id,{counts,total,mine});
      if(state.room) renderMessages(false);
    }catch(e){} finally{ state.pollFetching.delete(m.id); }
  }
  function pollCardHtml(m){
    const poll=m.attachment?.poll||{};
    const opts=Array.isArray(poll.opts)?poll.opts:[];
    const d=pollDataOf(m);
    const closed=!!poll.closed;
    const canClose=m.senderId===uid()||isTeacher();
    return `<div class="poll-card"><div class="poll-q">📊 ${esc(poll.q||'투표')}${closed?' <span class="admin-chip">마감됨</span>':''}</div>`
      +opts.map((o,i)=>{
        const c=d.counts[i]||0, pct=d.total?Math.round(c/d.total*100):0;
        const on=d.mine.includes(i);
        return `<button type="button" class="poll-opt${on?' on':''}" data-action="poll-vote" data-msg="${esc(m.id)}" data-i="${i}" ${closed?'disabled':''}><span class="poll-bar" style="width:${pct}%"></span><span class="poll-label">${esc(o)}</span><span class="poll-n">${c}표${on?' ✓':''}</span></button>`;
      }).join('')
      +`<div class="poll-foot">총 ${d.total}표${canClose&&!closed?` · <button type="button" class="text-btn" data-action="poll-close" data-msg="${esc(m.id)}">마감하기</button>`:''}</div></div>`;
  }
  async function votePoll(msgId,idx){
    if(!state.room) return;
    const m=(state.messages||[]).find(x=>x.id===msgId); if(!m||m.attachment?.poll?.closed) return;
    try{ await db.collection('channels').doc(state.room.id).collection('messages').doc(msgId).collection('votes').doc(uid()).set({choices:[idx],at:ts()},{merge:true}); }catch(e){ console.error(e); return toast(errText(e)); }
    if(state.pollVotes instanceof Map) state.pollVotes.delete(msgId);
    fetchPollVotes(m);
  }
  async function closePoll(msgId){
    if(!state.room) return;
    const m=(state.messages||[]).find(x=>x.id===msgId); if(!m) return;
    if(!(m.senderId===uid()||isTeacher())) return;
    try{
      const att={...(m.attachment||{}),poll:{...(m.attachment?.poll||{}),closed:true}};
      await db.collection('channels').doc(state.room.id).collection('messages').doc(msgId).update({attachment:att,updatedAt:ts()});
    }catch(e){ console.error(e); return toast(errText(e)); }
    toast('투표를 마감했어요.');
  }
  // ---------- 파일 보관 기한 (학교 설정 · 지나면 보기만 막고 지우기는 기존 삭제 흐름) ----------
  function fileRetentionDays(){
    const n=Number(state.schoolInfo?.fileRetentionDays??state.school?.fileRetentionDays??0);
    return n>0?n:0;
  }
  function fileExpired(m){
    const days=fileRetentionDays(); if(!(days>0)) return false;
    const at=docTs(m.createdAt)||0; if(!at) return false;
    return Date.now()-at>days*86400000;
  }
  function exportRoomText(roomId){
    const r=state.rooms.find(x=>x.id===roomId)||state.room; if(!r) return;
    const lines=(state.messages||[]).filter(m=>!m.deleted&&!m.hidden&&!m.chunkOf).map(m=>{
      const t=m.createdAt?fmtDateTime(m.createdAt):'';
      const who=m.senderName||'사용자';
      const body=m.text||(m.attachment?attachSummary(m.attachment):'');
      return `[${t}] ${who}: ${body}`;
    });
    const blob=new Blob([`${r.name||'채팅방'} 대화 내보내기 (${new Date().toLocaleString('ko-KR')})\n\n`+lines.join('\n')],{type:'text/plain;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=`${(r.name||'chat').replace(/[\\/:*?"<>|]/g,'_')}.txt`;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); a.remove(); }catch(e){} },4000);
    toast('대화를 내려받았어요.');
  }
  // ---------- 업무 배너 실시간 반영 (건의·승인 요청이 오면 새로고침 없이 뜬다) ----------
  let dutyUnsubs=[];
  function clearDutyListeners(){ dutyUnsubs.forEach(fn=>{ try{fn()}catch(e){} }); dutyUnsubs=[]; }
  function attachDutyListeners(){
    clearDutyListeners();
    const sid=state.profile?.schoolId||'';
    if(!sid) return;
    try{
      // 건의 담당·학교관리자만 구독한다 (학생 리스너는 규칙에서 막힌다)
      if(isTeacher()||isSchoolAdmin()||isAdmin()){
        dutyUnsubs.push(db.collection('suggestions').where('schoolId','==',sid).limit(1).onSnapshot(()=>{ refreshBanners(true); },()=>{}));
      }
      if(isAdmin()){
        dutyUnsubs.push(db.collection('teacherRequests').where('status','==','pending').limit(1).onSnapshot(()=>{ refreshBanners(true); },()=>{}));
      }
    }catch(e){}
  }
  // ---------- 신고 (신고 시점의 대화 30개를 함께 보관) ----------
  // 4번: 카테고리 확대 (부정행위/시험지유출 분리 + 기타 포함 10종)
  const REPORT_REASONS = [
    { value:'violence', label:'학교폭력 / 언어폭력' },
    { value:'bullying', label:'따돌림 / 괴롭힘' },
    { value:'sexual', label:'성희롱 / 음란물' },
    { value:'cheat', label:'부정행위' },
    { value:'leak', label:'시험지 유출' },
    { value:'privacy', label:'개인정보 노출' },
    { value:'spam', label:'도배 / 스팸' },
    { value:'hate', label:'혐오 / 차별 발언' },
    { value:'image', label:'부적절한 사진·파일' },
    { value:'etc', label:'기타' }
  ];
  // 2번: N회 누적 시 자동 블라인드 (기본 3회)
  const REPORT_BLIND_COUNT = 3;
  const REPORT_SNAPSHOT_MAX = 30;
  // 신고한 메시지 앞뒤로 최대 30개를 담는다 (신고자도 그 방의 메시지를 읽을 권한이 있다)
  function reportSnapshot(msgId){
    const list=(state.messages||[]).filter(m=>!m.deleted);
    const idx=list.findIndex(m=>m.id===msgId);
    let picked;
    if(idx<0){
      picked=list.slice(-REPORT_SNAPSHOT_MAX);
    }else{
      const half=Math.floor(REPORT_SNAPSHOT_MAX/2);
      const from=Math.max(0, Math.min(idx-half, Math.max(0, list.length-REPORT_SNAPSHOT_MAX)));
      picked=list.slice(from, from+REPORT_SNAPSHOT_MAX);
    }
    return picked.map(m=>{
      const pr=state.profileCache.get(m.senderId)||{};
      const att=m.attachment?`[${m.attachment.kind==='image'?'사진':'파일'}] ${m.attachment.name||''}`:'';
      return {
        id:m.id, uid:m.senderId||'',
        name:String(pr.displayName||m.senderName||'사용자').slice(0,30),
        text:String(m.text||att).slice(0,1000)
      };
    });
  }
  function openReport(targetUid,targetName,messageId='',roomId=''){
    const roomId2=roomId||state.room?.id||'';
    const room=(state.rooms||[]).find(r=>r.id===roomId2)||(state.room?.id===roomId2?state.room:null);
    const label=targetUid?`${esc(targetName||'사용자')}님`:(room?esc(room.name||'채팅방'):'이 대화');
    openModal(`<h2>신고하기</h2><p class="desc">${label}에 대한 신고 내용을 남겨 주세요. 신고하면 <b>신고 시점의 대화 ${REPORT_SNAPSHOT_MAX}개</b>가 함께 보관돼 담당 선생님과 관리자만 확인할 수 있어요.</p>
      <form id="reportForm">
        <input type="hidden" name="targetUid" value="${esc(targetUid||'')}">
        <input type="hidden" name="targetName" value="${esc(targetName||'')}">
        <input type="hidden" name="messageId" value="${esc(messageId||'')}">
        <input type="hidden" name="roomId" value="${esc(roomId2)}">
        <div class="field"><label>신고 사유</label><div class="custom-select"><button type="button" class="select-button" data-select-open="reason"><span data-selected="reason">골라 주세요</span><span>⌄</span></button></div></div>
        <div class="field"><label>자세한 내용 (선택)</label><textarea class="input" name="detail" maxlength="600" placeholder="어떤 일이 있었는지 적어 주세요."></textarea></div>
        <div class="warn-box">허위 신고 시 계정이 일시 정지될 수 있어요. 신중하게 신고해 주세요.</div>
        <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button class="confirm" id="reportGo" disabled style="opacity:.5">신고하기 (3)</button></div>
      </form>`);
    const b=$('[data-select-open="reason"]');
    wireDropdown(b,REPORT_REASONS.map(x=>({value:x.value,label:x.label})),(v,l)=>{b.querySelector('[data-selected]').textContent=l;b.querySelector('[data-selected]').dataset.value=v;});
    // 3번: 3초 카운트 뒤에 버튼 활성화 (충동 신고 방지)
    try{
      let n=3; const btn=$('#reportGo');
      const timer=setInterval(()=>{
        n--;
        if(!document.body.contains(btn)){ clearInterval(timer); return; }
        if(n<=0){ clearInterval(timer); btn.disabled=false; btn.style.opacity='1'; btn.textContent='신고하기'; }
        else btn.textContent=`신고하기 (${n})`;
      },1000);
    }catch(e){}
  }
  async function submitReport(f){
    const reason=f.querySelector('[data-selected="reason"]')?.dataset.value||'';
    if(!reason) return toast('신고 사유를 골라 주세요.');
    const roomId=f.roomId.value||'';
    const msgId=f.messageId.value||'';
    const targetUid=f.targetUid.value||'';
    const targetName=f.targetName?.value||'';
    const room=(state.rooms||[]).find(r=>r.id===roomId)||(state.room?.id===roomId?state.room:null);
    // 3번: 정말 신고할 건지 한 번 더 확인 (허위 경고 포함)
    const go=await new Promise(res=>{
      const panel=openModal(`<h2>정말 신고할까요?</h2><div class="notice-ico danger" aria-hidden="true"><span></span></div><p class="desc">접수되면 담당 선생님과 관리자가 확인해요.</p><div class="warn-box">허위 신고 시 계정이 일시 정지될 수 있어요.</div><div class="modal-actions"><button class="cancel" id="repNo">취소</button><button class="confirm" id="repYes">신고하기</button></div>`,{small:true,dismissible:false});
      panel.querySelector('#repNo').onclick=()=>{ closeModal(); res(false); };
      panel.querySelector('#repYes').onclick=()=>{ closeModal(); res(true); };
    });
    if(!go) return;
    // 2번: 1계정 1회 — 같은 메시지를 이미 신고했으면 차단 (악의적 누적 방지)
    const flagId=msgId?`${roomId}_${msgId}`:'';
    try{
      if(msgId){
        const dup=await db.collection('reports').where('roomId','==',roomId).limit(200).get();
        const mine=dup.docs.some(d=>{ const v=d.data()||{}; return v.messageId===msgId&&v.reporterId===uid(); });
        if(mine){ closeAllModals(); return toast('이미 신고한 메시지예요. 1계정당 1회만 신고할 수 있어요.'); }
      }
    }catch(e){ console.warn('dup check',e?.code||e); }
    const reasonLabel=(REPORT_REASONS.find(x=>x.value===reason)||{}).label||'기타';
    try{
      await db.collection('reports').add({
        reporterId:uid(), reporterName:state.profile?.displayName||'',
        targetUid, targetName,
        roomId, roomName:room?.name||'', roomOwnerId:room?.createdBy||'',
        schoolId:state.profile?.schoolId||room?.schoolId||'',
        messageId:msgId||null,
        reason, reasonLabel,
        detail:String(f.detail?.value||'').trim().slice(0,600),
        snapshot:reportSnapshot(msgId),
        status:'open', createdAt:ts(), expire_at:expireTs(365)
      });
    }catch(e){ console.error(e); return toast(errText(e)); }
    // 2번: 신고 기록(누가 누구를 신고했는지) + 누적 집계 → N회 시 자동 블라인드 + 담임 알림
    try{ await trackMessageFlag({roomId,msgId,room,targetUid,targetName,reasonLabel}); }catch(e){ console.warn('flag',e); }
    closeAllModals(); toast('신고를 접수했어요. 담당 선생님과 관리자가 확인해요.');
  }
  // 2번: 메시지별 신고 집계 (messageFlags/{roomId_msgId} 에 reporters 배열로 누가 신고했는지 기록)
  async function trackMessageFlag({roomId,msgId,room,targetUid,targetName,reasonLabel}){
    if(!roomId||!msgId) return;
    const fid=`${roomId}_${msgId}`;
    const ref=db.collection('messageFlags').doc(fid);
    let count=1;
    try{
      await db.runTransaction(async tx=>{
        const s=await tx.get(ref);
        if(!s.exists){
          tx.set(ref,{roomId,msgId,roomName:room?.name||'',schoolId:state.profile?.schoolId||room?.schoolId||'',targetUid:targetUid||'',targetName:targetName||'',count:1,reporters:[uid()],reporterNames:[state.profile?.displayName||''],reasons:[reasonLabel||''],blinded:false,createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
        }else{
          const d=s.data()||{};
          const reps=Array.isArray(d.reporters)?d.reporters:[];
          if(!reps.includes(uid())) reps.push(uid());
          const names=Array.isArray(d.reporterNames)?d.reporterNames:[];
          const nm=state.profile?.displayName||'';
          if(nm&&!names.includes(nm)) names.push(nm);
          count=reps.length;
          const blinded=count>=REPORT_BLIND_COUNT?true:!!d.blinded;
          tx.set(ref,{reporters:reps,reporterNames:names,count,blinded,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
        }
      });
    }catch(e){ throw e; }
    // 예시 문구: "OOO 메시지에 신고 N건이 접수되었습니다" — 담임/교사에게 배너+소리로 알림 (교사 클라이언트에서 수신)
    try{ state.lastFlagAlert={fid,count,at:Date.now()}; }catch(e){}
    if(count>=REPORT_BLIND_COUNT){
      // 블라인드 시도 (규칙 배포 전에는 실패할 수 있음 — 그래도 신고 기록과 알림은 남는다)
      try{ await db.collection('channels').doc(roomId).collection('messages').doc(msgId).update({blinded:true,reportCount:count,blindUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()}); }catch(e){ console.warn('blind update',e?.code||e); }
      try{ toast(`신고 ${count}건이 누적돼 메시지를 가렸어요. (*신고에 의해 가려진 메시지입니다)`); }catch(e){}
    }
    return count;
  }
  async function resolveReport(id){if(!isAdmin() && state.profile?.role!=='teacher')return;try{await db.collection('reports').doc(id).update({status:'resolved',resolvedAt:ts(),resolvedBy:uid()});}catch(e){console.error(e);return toast(errText(e));}closeAllModals();toast('처리 완료로 바꿨어요.');state.reports=state.reports.map(x=>x.id===id?{...x,status:'resolved'}:x);renderAdminPanel('reports');}

  function openDrawer(){const d=$('#drawer'),p=$('#drawerPanel');if(!d||!p)return;p.innerHTML=sidebarHtml();d.classList.add('open');renderRooms();}
  function closeDrawer(){const d=$('#drawer');if(d)d.classList.remove('open');}

  // Profile cache is populated when messages render.
  // Initial online state is deliberately omitted: users should see a calm, product-like interface.
})();
