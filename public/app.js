(() => {
  'use strict';
  const { firebase, auth, db } = window.EduFirebase;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modalRoot');
  const toastEl = document.getElementById('toast');
  const DEFAULT_GROUPS = ['공지', '모둠/동아리', '개인'];

  // 데스크톱(Electron) 앱에서는 브라우저 알림 대신 앱 자체 알림창을 쓴다.
  const DESKTOP = !!(window.edutalkDesktop && window.edutalkDesktop.isDesktop && typeof window.edutalkDesktop.notify === 'function');
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
    settings: { fontSize: 'md', invitePolicy: 'ask', roomGroups: {}, mutedRooms: [], presenceMode: 'auto', pinnedRooms: [], collapsedGroups: [], typingIndicator: true, readReceipts: true },
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
    photoDraft: null
  };

  const AVATAR_EMOJIS = ['', '🙂', '😎', '🐱', '🐶', '🦊', '🐼', '🐧', '🐸', '🦉', '🌱', '⭐', '🍀'];
  const AVATAR_COLORS = ['', '#3F9BFF', '#10B981', '#f04452', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ec4899'];
  const DEFAULT_SITE_NOTICE = {
    banner: { enabled: false, html: '', align: 'left', fontSize: 14, textColor: '#3F9BFF', bgColor: '#EAF4FF', linkText: '', linkUrl: '' },
    popup: { enabled: false, title: '', html: '', align: 'left', fontSize: 15, textColor: '#191f28', primaryText: '확인', primaryUrl: '', secondaryText: '닫기', secondaryUrl: '' }
  };
  // 로그인 화면에서 여는 안내 페이지 (관리자 도구 → 안내 페이지에서 수정)
  const DEFAULT_AUTH_PAGES = [
    { id:'privacy', label:'개인정보 처리방침', enabled:true, title:'개인정보 처리방침', html:
      '<p><b>1. 수집하는 개인정보 항목</b><br>· 필수: 학교 코드, 닉네임, 학년·반, 이메일 주소<br>· 서비스 이용 중 생성: <b>채팅 대화 내용, 첨부파일(사진·파일), 신고 및 불량 이용 기록, 금지어 감지 기록</b><br>· 자동 수집: 접속 기록(IP 주소, 접속 시각, 브라우저 정보)</p>'+
      '<p><b>2. 이용 목적</b><br>우리 학교 학생인지 확인, 채팅 서비스 제공, 신고 처리와 이용 제한, 부적절한 사용 확인</p>'+
      '<p><b>3. 보유 및 파기</b><br>· 회원 탈퇴 시 개인정보를 지체 없이 파기합니다.<br>· <b>삭제된 채팅 기록은 신고 처리 및 법적 분쟁 대응을 위해 30일간 보관한 뒤 영구 파기</b>합니다.<br>· 신고·제재 기록은 처리 완료 후 1년간 보관한 뒤 파기합니다.</p>'+
      '<p><b>4. 채팅 내용 열람 조건</b><br>대화 내용은 원칙적으로 그 대화에 참여한 사람만 볼 수 있습니다. 관리자와 교사도 학생들의 1:1·그룹 대화를 상시 열람할 수 없습니다. 다음 경우에만 최소한으로 열람합니다.<br>· 이용자가 직접 신고를 접수한 경우 (신고 시점의 대화 30개)<br>· 자동 금지어·심각 키워드 감지 시스템이 감지한 경우<br>· 수사기관의 적법한 법적 수사 요청이 있는 경우</p>'+
      '<p><b>5. 제3자 제공</b><br>법령에 근거한 경우를 제외하고 외부에 제공하지 않습니다.</p>'+
      '<p><b>6. 이용자의 권리</b><br>언제든지 설정에서 회원 탈퇴를 할 수 있고, 개인정보 열람·정정을 요청할 수 있습니다.</p>'+
      '<p>· 만 14세 미만은 가입할 수 없습니다.</p>',
      buttons: [] },
    { id:'contact', label:'문의하기', enabled:true, title:'문의하기', html:
      '<p>에듀톡을 쓰다가 궁금한 점이나 불편한 점이 있으면 담당 선생님께 알려 주세요.</p>'+
      '<p>학교 이름, 학년·반, 닉네임을 함께 적어 주시면 더 빠르게 확인할 수 있어요.</p>',
      buttons: [] },
    { id:'school', label:'학교 등록', enabled:true, title:'학교 등록 안내', html:
      '<p>에듀톡은 담당 선생님이 학교를 먼저 등록한 뒤, 그 학교의 <b>학교 코드</b>로 학생들이 가입할 수 있어요.</p>'+
      '<p><b>등록 순서</b><br>1) 담당 선생님이 관리자 계정을 만듭니다.<br>2) 관리자 도구 → 학교 관리에서 학교를 등록합니다.<br>3) 발급된 학교 코드를 학생들에게 알려 줍니다.</p>'+
      '<p>이미 학교가 등록되어 있다면 선생님께 학교 코드를 받아 회원가입해 주세요.</p>',
      buttons: [] }
  ];
  function authPages(){
    const list=Array.isArray(state.sitePages)&&state.sitePages.length ? state.sitePages : DEFAULT_AUTH_PAGES;
    return list.filter(p=>p && p.enabled!==false && p.id);
  }
  // 버튼 링크는 mailto: 처럼 길어질 수 있어 넉넉하게 허용한다 (사실상 제한 없음)
  const PAGE_BTN_URL_MAX = 4000;

  // ---------- 로그인 전 소개(랜딩) 페이지 ----------
  // 관리자 도구 → 소개 페이지에서 수정한다. 저장 위치: siteLanding/main
  const LANDING_TARGETS = [['top','맨 위'],['features','기능'],['steps','이용 방법'],['start','시작 안내']];
  // 메뉴 항목이 눌렸을 때 할 일
  const LANDING_ACTIONS = [['page','안내 페이지 열기'],['url','주소 열기'],['scroll','페이지 안 이동'],['login','로그인 화면'],['signup','회원가입 화면']];
  const LANDING_ACTION_OK = LANDING_ACTIONS.map(a=>a[0]);
  const DEFAULT_LANDING_NAV = [
    { label:'다운로드', type:'menu', items:[
      { label:'윈도우 다운로드', action:'url', value:'' },
      { label:'안드로이드 앱 (준비 중)', action:'url', value:'' }
    ] },
    { label:'문의하기', type:'menu', items:[
      { label:'학교 등록', action:'page', value:'school' },
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
    ctaTitle: '우리 학교에서도 에듀톡을 써 보세요',
    ctaDesc: '선생님이 학교를 등록하면 학생들이 학교 코드로 바로 가입할 수 있어요.',
    ctaButton: '로그인 / 회원가입',
    footerText: '에듀톡은 학교 안에서만 쓰는 전용 메신저예요.'
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
      ctaTitle: req(d.ctaTitle, b.ctaTitle, 60),
      ctaDesc: opt(d.ctaDesc, b.ctaDesc, 140),
      ctaButton: req(d.ctaButton, b.ctaButton, 20),
      footerText: opt(d.footerText, b.footerText, 160)
    };
  }
  function landingCfg(){ return state.landing || cloneLanding(); }
  function landingEnabled(){ return landingCfg().enabled !== false; }

  // ---------- 브랜드(로고 글자 · 이름) ----------
  // 관리자 도구 → 소개 페이지에서 수정한다. 이름을 2개 이상 넣으면 번갈아 나온다.
  function brandMarkText(){ return String(landingCfg().brandMark||'E').slice(0,2)||'E'; }
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
  // 파일 내려받기용 주소: 실행 스킴과 HTML·SVG data 는 막는다
  const safeFileHref = (v) => {
    const s=String(v??'').trim(); if(!s) return '';
    if(/^https:\/\//i.test(s)) return s;
    if(/^data:/i.test(s)) return /^data:(?:text\/html|image\/svg\+xml)/i.test(s) ? '' : s;
    return '';
  };
  // 외부 링크는 http(s) · mailto · tel 만 허용한다
  const openSafeLink = (raw) => {
    const u=String(raw??'').trim(); if(!u) return false;
    if(/^https?:\/\//i.test(u)){ try{ window.open(u,'_blank','noopener'); }catch(e){} return true; }
    if(/^(?:mailto:|tel:)/i.test(u)){ try{ location.href=u; }catch(e){} return true; }
    toast('주소를 확인해 주세요.');
    return false;
  };
  const uid = () => auth.currentUser?.uid || '';
  // 이벤트 리스너 안에서 async 함수를 안전하게 실행한다 (거부된 Promise가 앱을 멈추지 않게)
  const runAsync = (fn) => { try { const r=fn(); if(r && typeof r.catch==='function') r.catch(e=>console.error(e)); } catch(e){ console.error(e); } };
  const isAdmin = () => state.profile?.role === 'admin';
  const isTeacher = () => state.profile?.role === 'teacher' || isAdmin();
  const canModerate = () => isAdmin() || state.profile?.role === 'teacher';
  const nowMs = () => Date.now();
  const ts = () => firebase.firestore.FieldValue.serverTimestamp();
  // 지워진 채팅은 즉시 파기하지 않고 30일 보관한 뒤 TTL이 영구 파기한다
  const RETENTION_DAYS = 30;
  const expireTs = (days=RETENTION_DAYS) => firebase.firestore.Timestamp.fromMillis(Date.now() + days*86400000);
  const softDeletePatch = (byUid) => ({ deleted:true, deleted_at:ts(), expire_at:expireTs(), deleted_by:byUid||uid() });
  const docTs = (v) => v?.toDate ? v.toDate().getTime() : (v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : 0));
  const timeText = (v) => v?.toDate ? v.toDate().toLocaleTimeString('ko-KR', {hour:'numeric',minute:'2-digit'}) : '';
  const dateText = (v) => v?.toDate ? v.toDate().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'}) : '';
  const roleLabel = r => r === 'admin' ? '관리자' : r === 'teacher' ? '교사' : '학생';
  // 학년·반 표기 (반 정보가 없으면 'null반'이 아니라 학년까지만 보여준다)
  function gradeClassLabel(p){
    const g=Number(p?.grade)||0, c=Number(p?.classNum)||0;
    if(!g) return '';
    return c?`${g}학년 ${c}반`:`${g}학년`;
  }
  function gradeClassPrefix(p){ const s=gradeClassLabel(p); return s?s+' · ':''; }
  // publicProfiles 쓰기는 항상 내 역할(role)을 함께 보낸다.
  // → 문서가 아직 없을 때(생성)와 역할 표시가 어긋났을 때 모두 규칙을 통과한다.
  const putPublicProfile = (patch) => db.collection('publicProfiles').doc(uid()).set({...(patch||{}), role:state.profile?.role||'student'}, {merge:true});
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
  const RICH_TAGS = new Set(['B','STRONG','I','EM','U','S','STRIKE','A','BR','DIV','P','FONT','SPAN','SUB','SUP']);
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
          if(child.tagName==='A' && name==='href' && /^(?:https?:|mailto:|\/(?!\/))/i.test(attr.value)) return;
          if(child.tagName==='FONT' && (name==='color'||name==='size')) return;
          if((child.tagName==='SPAN'||child.tagName==='FONT') && name==='style'){
            const m=/(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(attr.value);
            if(m) attr.value='color:'+m[1].trim(); else child.removeAttribute('style');
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
      const n=new Notification(title||'에듀톡',{ body:body||'', tag:'edutalk-'+Date.now(), silent:true });
      n.onclick=()=>{ try{ window.focus(); }catch(e){} try{ n.close(); }catch(e){} };
    }catch(e){ console.error('notify',e); }
  }
  // 같은 메시지가 두 경로(채팅방 목록 요약 · 열려 있는 채팅방)에서 겹쳐 알림/소리가 나지 않도록 막는다.
  const NOTIFY_DEDUP_MS=15000;
  function isDuplicateNotify(roomId,msg){
    if(!(state.notifySeen instanceof Map)) state.notifySeen=new Map();
    const key=`${roomId}|${msg?.senderId||''}|${docTs(msg?.createdAt)}|${String(msg?.text||'').slice(0,40)}`;
    const now=nowMs();
    for(const [k,t] of state.notifySeen){ if(now-t>NOTIFY_DEDUP_MS) state.notifySeen.delete(k); }
    if(state.notifySeen.has(key)) return true;
    state.notifySeen.set(key,now);
    return false;
  }
  function notifyMessage(roomId,room,msg){
    if(!msg||!msg.senderId||msg.senderId===uid()) return;
    if(msg.deleted) return;
    if(isRoomMuted(roomId)) return;
    if(isDnd()) return;
    // 로그인 전에 온 메시지는 목록 숫자로만 표시하고 알림으로 보내지 않는다
    // 로그인 전에 온 메시지는 목록 숫자로만 표시하고 알림으로 보내지 않는다
    try{ const ct=docTs(msg.createdAt)||0; if(ct && state.loginAt && ct<state.loginAt) return; }catch(e){}
    if(isDuplicateNotify(roomId,msg)) return;
    const s=notifySettings();
    if(s.sound) playSound(s.soundId);
    const hidden=document.hidden;
    const otherRoom=state.room?.id!==roomId;
    if(hidden||otherRoom) showDesktopNotification(room?.name||'에듀톡', `${msg.senderName||'사용자'}: ${msg.text||''}`, roomId);
  }
  function isRoomMuted(roomId){ return !!(state.settings?.mutedRooms||[]).includes(roomId); }
  function isDnd(){ return presenceModeSetting()==='dnd'; }
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
    renderRooms(); if(state.room) renderChatFrame(state.room);
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
    toast(v==='auto'?'자동으로 표시해요.':v==='hidden'?'상태를 숨겼어요.':`${presenceModeLabel(v)}으로 바꿨어요.`);
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
    return `<div class="read-receipt">${esc(label)}</div>`;
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
    return `<div class="read-receipt">${esc(label)}</div>`;
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
  function isStaff(){ return state.profile?.role==='teacher' || isAdmin(); }
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
    toast(`‘${word}’ 은(는) 보낼 수 없는 말이에요. 아래 카드에서 이의 신청을 할 수 있어요.`);
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
  function modBlocksHtml(){
    const list=(state.modBlocks||[]).filter(b=>b.roomId===(state.room?.id||''));
    if(!list.length) return '';
    return list.map(b=>{
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
    }).join('');
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
    $$('#stickyRoot .sticky-card').forEach(el=>el.remove());
    if(noticeUnsub){try{noticeUnsub();}catch{} noticeUnsub=null;}
    state.profileUnsubs.forEach(fn=>{try{fn();}catch{}});state.profileUnsubs=[];state.profileListeningKey='';
    clearTimeout(roomLoadTimer);roomLoadTimer=null;
    clearTimeout(state.banner.timer);
    // 로그아웃 뒤에도 남아 있던 타이머를 정리한다
    clearTimeout(profileRerenderTimer);profileRerenderTimer=null;
    if(resetTick){ clearInterval(resetTick); resetTick=null; }
  }
  let roomLoadTimer = null;
  let roomUnsub = null;
  function clearRoomListener() { if (roomUnsub) { roomUnsub(); roomUnsub = null; } clearTypingListener(); clearReadsListener(); }
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
    state.knownRoomIds = new Set(); state.seenMsgIds = new Set(); state.bubbleAnims = new Map();
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
      await ref.set({ email: u?.email || '', displayName, role:'student', grade, classNum, schoolId:pending?.schoolId||'', schoolName:pending?.schoolName||'', schoolCode:pending?.schoolCode||'', photoURL:u?.photoURL || '', blockedUsers:[], blockHistory:{}, invitePolicy:'ask', settings:{fontSize:'md',roomGroups:{}}, consents:{ privacy:pending?.consentPrivacy===true, age14:pending?.consentAge14===true, at:ts() }, createdAt:ts(), updatedAt:ts() });
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
    if (!user) {
      // 관리자가 소개 페이지를 켜 두었으면 로그인 화면보다 소개 페이지를 먼저 보여 준다
      if (landingReady) await landingReady;
      if (landingEnabled()) { renderLanding(); return; }
      await loadSchoolList(true);
      renderAuth();
      return;
    }
    state.user = user;
    state.loginAt = Date.now(); // 로그인 전에 온 메시지는 숫자 배지만 띄우고 알림으로 보내지 않는다
    try {
      state.profile = await ensureProfile();
      if (!state.profile) { bootError(new Error('profile missing')); return; }
      // 관리자가 이용을 정지한 계정은 안내 화면만 보여준다
      if (state.profile.suspended === true) { await renderSuspended(); return; }
      // 탈퇴한 계정으로 다시 로그인한 경우
      if (state.profile.deleted === true) { await auth.signOut(); toast('탈퇴한 계정이에요. 다시 가입해 주세요.'); return; }
      await loadSchool();
      state.settings = { fontSize: state.profile.settings?.fontSize || 'md', invitePolicy: state.profile.invitePolicy || 'ask', roomGroups: state.profile.settings?.roomGroups || {}, groupOrder: state.profile.settings?.groupOrder || null, theme: state.profile.settings?.theme || currentTheme(), mutedRooms: state.profile.settings?.mutedRooms || [], presenceMode: state.profile.settings?.presenceMode || 'auto', notify: state.profile.settings?.notify || { sound:true, soundId:'bell', browser:false }, typingIndicator: state.profile.settings?.typingIndicator !== false, readReceipts: state.profile.settings?.readReceipts !== false };
      if(!['auto','away','dnd','offline','hidden'].includes(state.settings.presenceMode)) state.settings.presenceMode='auto';   // 예전 '상시 온라인' 값 정리
      state.warnCount = Number(state.profile.warnCount) || 0;
      state.groupNames = Array.isArray(state.settings.groupOrder) && state.settings.groupOrder.length
        ? state.settings.groupOrder.slice()
        : DEFAULT_GROUPS.slice();
      state.profileCache.set(uid(), state.profile);
      ensureUserCode().catch(e=>console.error('userCode',e));
      applyFontSize();
      state.shellZoomEnter=true; // 로딩→채팅 진입도 바깥→안 줌으로
      renderShell();
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
      watchSuspension();
      backfillPublicProfile().catch(e=>console.error('public profile',e));
      recordLoginInfo().catch(e=>console.error('login info',e));
      await maybeShowProfileSetup();
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
      <div class="auth-hero-top"><div class="brand-mark">${esc(brandMarkText())}</div><strong>${esc(brandNames()[0]||'에듀톡')}</strong></div>
      <div class="auth-hero-body"><h2>학교 안에서<br><span class="roll"><span class="roll-track" id="heroRoll">${items}</span></span></h2>
      <p>선생님이 알려준 <b>학교 코드</b>로 가입하고, 우리 학교 친구들과 안전하게 이야기해요.</p>
      <div class="auth-hero-mobile" id="heroFadeBox"><span id="heroFade">${esc(HERO_POINTS[0].text)}</span></div>
      <ul class="auth-points">${HERO_POINTS.map(p=>`<li><span class="pt-ico">${p.icon}</span>${esc(p.text)}</li>`).join('')}</ul></div>
      <div class="auth-hero-foot"><div class="auth-links">${authLinkButtons()}</div></div></aside>`;
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
      if(!s.exists || s.data().suspended!==true) return;
      state.profile={...(state.profile||{}),...s.data()};
      closeAllModals();
      clearListeners();
      renderSuspended();
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
    if(ta) ta.value='';
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
          <label class="consent"><input type="checkbox" id="gateAge14"><span><b>만 14세 이상</b>입니다.</span></label>
          <label class="consent" style="margin-top:8px"><input type="checkbox" id="gateConsent"><span>가입할 때 <b>접속 기록</b>과 <b>채팅 대화 내용·신고 기록</b>이 수집·보관될 수 있어요. 학교 안전과 신고 처리 목적으로만 쓰이며, 위 내용을 확인했습니다.</span></label>
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
    if(!$('#gateConsent')?.checked) return fail('개인정보 수집·이용 안내를 확인하고 체크해 주세요.');
    setPendingSignup({ displayName:'', grade:null, classNum:null, schoolId:sid, schoolName:state.selectedSchool?.name||'', schoolCode:code, consentPrivacy:true, consentAge14:true, consentedAt:Date.now() });
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
        <div class="landing-sheet-head"><span class="brand-mark">E</span><strong>${esc(c.brandName)}</strong><button type="button" class="sheet-close" data-action="landing-sheet-close" aria-label="메뉴 닫기">✕</button></div>
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
    // 오른쪽 인디케이터 (지금 보고 있는 곳 표시)
    const dots=[['top','소개']];
    if(feats.length) dots.push(['features','기능']);
    if(stepList.length) dots.push(['steps','이용 방법']);
    dots.push(['start','시작하기']);
    const dotsHtml=dots.map(([t,label])=>`<button type="button" class="landing-dot" data-action="landing-scroll" data-target="${t}" data-sec="${t}"><span>${label}</span><i></i></button>`).join('');
    return `<div class="landing">
      <header class="landing-nav"><div class="landing-nav-inner">
        <button type="button" class="landing-brand" data-action="landing-scroll" data-target="top"><span class="brand-mark">E</span><strong>${esc(c.brandName)}</strong></button>
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
          </div>`:''}
        </div></section>
        ${features}
        ${steps}
        <section class="landing-end" id="${landingSectionId('start')}">
          <div class="landing-cta-sec"><div class="landing-cta-box">
            <h2>${esc(c.ctaTitle)}</h2>${c.ctaDesc?`<p>${esc(c.ctaDesc)}</p>`:''}
            <button type="button" class="landing-btn xl" data-action="landing-login">${esc(c.ctaButton)}</button>
          </div></div>
          <footer class="landing-foot"><div class="landing-foot-inner">
            ${c.footerText?`<p>${esc(c.footerText)}</p>`:''}
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
        <div class="auth-links card-links">${authLinkButtons()}</div>
      </div></div></div></div>`;
    } else {
    app.innerHTML = `<div class="auth"><div class="auth-shell">
      ${authHeroHtml()}
      <div class="auth-card"><div class="auth-card-inner${anim?' auth-anim-'+anim:''}">
      ${isLogin
        ? (landingEnabled()?`<button type="button" class="back-btn" data-action="landing-home" aria-label="소개 페이지로 돌아가기">←</button>`:'')
        : `<button type="button" class="back-btn" data-action="toggle-auth" aria-label="로그인으로 돌아가기">←</button>`}
      <h1 class="auth-title">${state.authMode === 'login' ? '다시 만나서 반가워요' : '새 계정을 만들어봐요'}</h1>
      <p class="auth-desc">${state.authMode === 'login' ? '학교 코드로 만든 계정으로 로그인해 주세요.' : '학교 코드와 학급 정보를 입력하면 바로 시작할 수 있어요.'}</p>
      <div id="authError" class="form-error hidden"></div>
      <form id="authForm">
        <div class="field"><label>이메일</label><input class="input" name="email" type="email" autocomplete="email" value="${esc(state.authMode==='login'?rememberedEmail():'')}" required></div>
        <div class="field"><label>비밀번호</label><input class="input" name="password" type="password" autocomplete="current-password" minlength="6" required></div>
        ${state.authMode==='login'?`<label class="remember-check"><input type="checkbox" name="rememberEmail" ${rememberedEmail()?'checked':''}> 아이디 기억하기</label>`:''}
        ${state.authMode === 'signup' ? `<div class="field"><label>학교</label><div class="custom-select"><button type="button" class="select-button" data-action="pick-school"><span data-selected="school">${state.selectedSchool?esc(state.selectedSchool.name):'학교를 검색해 주세요'}</span><span>⌄</span></button></div></div>
        <div class="field"><label>학교 코드</label><input class="input" name="schoolCode" maxlength="12" autocomplete="off" placeholder="선생님께 받은 코드를 입력해 주세요." required><p class="desc" style="margin:7px 0 0;font-size:12px">${(state.schoolList&&state.schoolList.length)?'학교 코드는 담당 선생님께 받을 수 있어요.':'아직 등록된 학교가 없어요. 담당 선생님(관리자)에게 학교 등록과 코드를 요청해 주세요.'}</p></div>
        <div class="field"><label>닉네임</label><input class="input" name="displayName" maxlength="20" required></div>
        <div class="field"><label>학년</label><div class="custom-select"><button type="button" class="select-button" data-select-open="grade"><span data-selected="grade">학년을 골라 주세요</span><span>⌄</span></button></div></div>
        <div class="field"><label>반</label><div class="custom-select"><button type="button" class="select-button" data-select-open="class"><span data-selected="class">학년을 먼저 골라 주세요</span><span>⌄</span></button></div></div>` : ''}
        ${state.authMode === 'signup' ? `<div class="field" style="margin-top:2px"><label>약관 동의 (모두 필수)</label>
          <label class="consent"><input type="checkbox" name="age14"><span><b>만 14세 이상</b>입니다.</span></label>
          <label class="consent" style="margin-top:8px"><input type="checkbox" name="consent"><span>가입할 때 <b>접속 기록(IP 주소, 접속 시각, 브라우저 정보)</b>과 <b>채팅 대화 내용·신고 기록</b>이 수집·보관될 수 있어요. 학교 안전과 신고 처리 목적으로만 쓰이며, 위 내용을 확인했습니다.</span></label>
        </div>` : ''}
        <button class="primary">${state.authMode === 'login' ? '로그인' : '가입하기'}</button>
      </form>
      <button class="google-btn" data-action="google"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Google 계정으로 ${state.authMode === 'login' ? '로그인' : '가입하기'}</span></button>
      ${isLogin?`<div class="auth-foot"><button class="text-btn" data-action="toggle-auth">회원가입</button><button class="text-btn" data-action="forgot">비밀번호 찾기</button></div>`:''}
      <div class="auth-links card-links">${authLinkButtons()}</div>
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
      menu.remove();
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('scroll', onOutside, true);
      state.dropdownOwner = null;
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
        await auth.signInWithEmailAndPassword(email,password);
      }
      else {
        const displayName=f.displayName.value.trim(); const grade=Number(document.querySelector('[data-selected="grade"]')?.dataset.value||0); const classNum=Number(document.querySelector('[data-selected="class"]')?.dataset.value||0);
        const schoolId=state.selectedSchool?.id||''; const schoolCode=(f.schoolCode?.value||'').trim().toUpperCase();
        if(!f.querySelector('[name="age14"]')?.checked){showAuthError('만 14세 이상만 가입할 수 있어요.');return;}
        if(!f.querySelector('[name="consent"]')?.checked){showAuthError('개인정보 수집·이용 안내를 확인하고 체크해 주세요.');return;}
        if(!schoolId){showAuthError('학교를 먼저 골라 주세요.');return;}
        if(!schoolCode){showAuthError('학교 코드를 입력해 주세요.');return;}
        if(!displayName || !grade || !classNum){showAuthError('닉네임과 학급 정보를 모두 골라 주세요.');return;}
        if(!state.school.grades.includes(grade)){showAuthError('학년 정보를 확인해 주세요.');return;}
        if(!Number(state.school.classCounts?.[grade]||0) || classNum>Number(state.school.classCounts[grade])){showAuthError('반 정보를 확인해 주세요.');return;}
        setPendingSignup({displayName,grade,classNum,schoolId,schoolName:state.selectedSchool?.name||'',schoolCode,consentPrivacy:true,consentAge14:true,consentedAt:Date.now()});
        try{ await auth.createUserWithEmailAndPassword(email,password); }
        catch(e){ setPendingSignup(null); throw e; }
      }
    } catch(e){console.error(e);showAuthError(errText(e));}
  }

  async function googleLogin(){
    const f=$('#authForm');
    if(state.authMode==='signup' && f){
      const schoolId=state.selectedSchool?.id||''; const schoolCode=(f.schoolCode?.value||'').trim().toUpperCase();
      if(!f.querySelector('[name="age14"]')?.checked) return showAuthError('만 14세 이상만 가입할 수 있어요.');
      if(!f.querySelector('[name="consent"]')?.checked) return showAuthError('개인정보 수집·이용 안내를 확인하고 체크해 주세요.');
      if(!schoolId) return toast('학교를 먼저 골라 주세요.');
      if(!schoolCode) return showAuthError('학교 코드를 입력해 주세요.');
      setPendingSignup({displayName:'',grade:null,classNum:null,schoolId,schoolName:state.selectedSchool?.name||'',schoolCode});
    }
    try{const provider=new firebase.auth.GoogleAuthProvider();await auth.signInWithPopup(provider);}catch(e){setPendingSignup(null);console.error(e);showAuthError(errText(e));}
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
    applyFontSize();
    applyTheme();
    stopHeroRoll();
    if(state.view==='admin' && (isAdmin()||state.profile?.role==='teacher')){
      app.innerHTML = adminPageHtml();
      renderAdminPanel(state.adminTab);
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
    return isAdmin()
      ? [['school','학교 관리'],['landing','소개 페이지'],['sitenotice','사이트 공지'],['pages','안내 페이지'],['chat','채팅 관리'],['sharereq','공유 요청'],['reports','신고 관리'],['modappeals','오검열 이의'],['appeals','이의 제기'],['popup','개인 안내'],['users','사용자'],['cross','학교 간 요청'],['rooms','채팅방']]
      : [['sharereq','공유 요청'],['reports','신고 관리'],['modappeals','오검열 이의'],['rooms','채팅방'],['popup','개인 안내']];
  }
  function adminPageHtml(){
    const tabs=adminTabs();
    if(!tabs.some(t=>t[0]===state.adminTab)) state.adminTab=tabs[0][0];
    return `<div class="admin-page"><header class="admin-head"><button class="icon-btn" data-action="close-admin" aria-label="뒤로 가기">←</button><div class="grow"><div class="admin-title">${isAdmin()?'관리자 도구':'교사 도구'}</div><div class="admin-sub">${esc(state.profile?.displayName||'사용자')} · ${roleLabel(state.profile?.role)}</div></div><button class="icon-btn" data-action="settings" aria-label="설정">⚙</button></header><div id="siteBanner" class="site-banner hidden"></div><div class="admin-body"><div class="admin-wrap"><nav class="admin-tabs">${tabs.map(([k,l])=>`<button class="tab ${state.adminTab===k?'active':''}" data-tab="${k}">${l}</button>`).join('')}</nav><div id="adminPanel"></div></div></div></div>`;
  }
  function openAdmin(tab){
    if(!(isAdmin()||state.profile?.role==='teacher')) return;
    state.view='admin';
    state.adminTab=tab || (isAdmin()?'school':'rooms');
    renderShell();
  }
  function exitAdmin(){
    if(state.view!=='admin') return;
    const rid=state.room?.id;
    state.view='chat';
    renderShell();
    if(rid) openRoom(rid);
  }
  function renderSidebar(){
    const sb=$('.sidebar'); if(sb)sb.innerHTML=sidebarHtml();
    const d=$('#drawer');
    if(d&&d.classList.contains('open')){const p=$('#drawerPanel');if(p)p.innerHTML=sidebarHtml();}
    renderRooms();
    renderFriends();
    startBrandRotate();
  }
  function sidebarHtml(){
    return `<div class="side-top"><div class="brand"><div class="brand-mark">${esc(brandMarkText())}</div><span class="brand-name" data-brand-roll>${esc(brandNames()[0]||'에듀톡')}</span></div><button class="icon-btn" data-action="settings" aria-label="설정">⚙</button></div>
      <div class="profile-card"><div class="profile-row"><button type="button" class="avatar-dot profile-open" data-action="profile" aria-label="내 프로필 보기">${avatarHtml(state.profile)}</button><div class="grow"><button type="button" class="profile-name profile-open" data-action="profile">${esc(state.profile?.displayName||'사용자')}</button><div class="profile-meta-line"><span class="profile-meta">${gradeClassPrefix(state.profile)}${roleLabel(state.profile?.role)}</span><span class="presence-dot inline ${myPresenceState()||'hidden'}" data-my-presence-dot aria-hidden="true"></span><button type="button" class="presence-menu-btn" data-action="presence-menu" aria-haspopup="menu" aria-label="접속 상태 변경"><span class="presence-text" data-my-presence-label>${esc(myPresenceLabel())}</span><span class="presence-caret" aria-hidden="true">⌄</span></button></div></div></div></div>
      <div class="side-body"><div class="side-section"><div class="side-title"><span>채팅</span><span class="side-title-btns"><button class="text-btn" data-action="room-join-code">코드로 참가</button><button class="text-btn" data-action="new-room">+ 만들기</button></span></div><div id="roomList"></div></div>
      <div class="side-section hidden" id="inviteSection"><div class="side-title"><span>초대</span></div><div id="inviteList"></div></div>
      <div class="side-section"><div class="side-title"><span>친구</span><button class="text-btn" data-action="friends">관리</button></div><div id="friendList"></div></div>
      ${(isAdmin()||state.profile?.role==='teacher')?`<div class="side-section"><div class="side-title"><span>관리</span></div><button class="room" data-action="admin"><div class="room-icon">⌘</div><div class="room-main"><div class="room-name">${isAdmin()?'관리자 도구':'교사 도구'}</div><div class="room-sub">학교 설정과 운영 도구</div></div></button></div>`:''}</div>
      <div class="side-bottom"><button class="soft-btn manage-btn" data-action="chat-manage"><span>💬</span> 채팅 관리</button><div class="row"><button class="soft-btn" data-action="settings">설정</button><button class="soft-btn" data-action="logout">로그아웃</button></div></div>`;
  }
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
  function emptyChat(){return `<div class="empty-chat"><button type="button" class="drawer-fab" data-action="open-drawer" aria-label="채팅방 목록 열기"><span>☰</span> 채팅방 목록</button><div><div class="brand-mark" style="margin:0 auto 16px">E</div><h2>채팅방을 골라 주세요</h2><p>왼쪽에서 채팅방을 고르면 메시지를 볼 수 있어요.</p></div></div>`;}
  // 관리자 화면 등 #chat 이 없는 화면에서도 안전하게 빈 채팅 화면으로 되돌린다
  function clearChatPane(){ const c=$('#chat'); if(c) c.innerHTML=emptyChat(); }

  function setupGlobalHandlers(){
    if(state._bound)return; state._bound=true;
    document.addEventListener('click',e=>runAsync(()=>handleClick(e))); document.addEventListener('submit',e=>runAsync(()=>{if(e.target.id==='authForm'){e.preventDefault();return signInForm(e.target);}if(e.target.id==='composerForm'){e.preventDefault();return sendMessage(e.target);}if(e.target.id==='roomForm'){e.preventDefault();const b=document.querySelector('#roomActions .confirm');if(b)return b.click();const f2=$('#roomForm');return createRoom(f2);}if(e.target.id==='profileForm'){e.preventDefault();return saveProfile(e.target);}if(e.target.id==='settingsForm'){e.preventDefault();return saveSettings(e.target);}if(e.target.id==='schoolForm'){e.preventDefault();return saveSchoolSettings(e.target);}if(e.target.id==='reportForm'){e.preventDefault();return submitReport(e.target);}if(e.target.id==='noticeForm'){e.preventDefault();return sendNotice(e.target);}if(e.target.id==='siteNoticeForm'){e.preventDefault();return saveSiteNotice();}}));
    document.addEventListener('keydown',e=>{if(e.target.id==='composerText'&&mentionKeydown(e))return;if(e.key==='Escape'){if(state.openDropdownCleanup){closeDropdown();return;}dismissModal();return;}if(e.target.id==='composerText'&&e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing&&!isCoarsePointer()){e.preventDefault();runAsync(()=>sendMessage($('#composerForm')));}});
    document.addEventListener('input',e=>{if(e.target.id==='composerText'){e.target.style.height='auto';e.target.style.height=Math.min(120,e.target.scrollHeight)+'px';syncComposerHeight();updateCharCount();updateMentionBox();pingTyping();}if(e.target.id==='roomSearchInput'){runRoomSearch(e.target.value);}});
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
    document.addEventListener('change',e=>{ if(e.target && e.target.dataset && 'landingAction' in e.target.dataset){ syncLandingDraft(); renderLandingAdmin($('#adminPanel')); return; } if(e.target && e.target.id==='chatFileInput'){ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(f) openAttachConfirm(f); } if(e.target && e.target.id==='roomIconFile'){ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(f) setRoomIconPhoto(state.room?.id,f); } if(e.target && (e.target.id==='avatarFileInput'||e.target.id==='avatarCameraInput')){ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(f) setProfilePhoto(f); } if(e.target&&e.target.dataset&&e.target.dataset.cmPick){ if(!(state.cmSel instanceof Set)) state.cmSel=new Set(); if(e.target.checked) state.cmSel.add(e.target.dataset.cmPick); else state.cmSel.delete(e.target.dataset.cmPick); } });
    document.addEventListener('keydown',e=>{ if(e.target.id==='roomSearchInput'&&e.key==='Enter'){e.preventDefault();runRoomSearch(e.target.value);} if(e.target.id==='roomSearchInput'&&e.key==='Escape'){e.preventDefault();toggleRoomSearch(false);} });
    document.addEventListener('visibilitychange',onReadVisibility);
    wireMessagePress();
    window.addEventListener('resize',()=>closeDropdown());
    // 전송 버튼을 누르는 순간 입력창 포커스가 빠지면 키보드가 흔들리므로 미리 막는다 (클릭은 정상 동작)
    document.addEventListener('pointerdown',e=>{ try{ if(e.target && e.target.closest && e.target.closest('.composer .send')) e.preventDefault(); }catch(err){} },true);
    // 오프라인 감지 (연결이 끊기면 전송 버튼을 흐리게 하고, 돌아오면 알림)
    try{
      const updateOnlineUI=(announce)=>{
        const online=navigator.onLine!==false;
        document.body.classList.toggle('offline',!online);
        if(announce) toast(online?'인터넷에 다시 연결됐어요.':'인터넷 연결이 끊겼어요. 메시지는 연결된 뒤에 보내 주세요.');
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
      if(a==='retry')return location.reload(); if(a==='toggle-auth'){state.authAnim=state.authMode==='login'?'left':'right';state.authMode=state.authMode==='login'?'signup':'login';state.authPage='';renderAuth();return}
      if(a==='auth-page'){state.authAnim='left';state.authPage=el.dataset.page||'';paintAuth();return}
      if(a==='auth-page-back'){state.authAnim='right';state.authPage='';paintAuth();return}
      if(a==='auth-page-btn'){
        const url=el.dataset.url||''; if(!url) return;
        // 메일·전화 링크는 그 창에서 바로 열리고, 일반 주소는 새 탭으로 연다
        openSafeLink(url);
        return;
      }
      if(a==='landing-login')return enterAuth('login');
      if(a==='landing-signup')return enterAuth('signup');
      if(a==='landing-home'){state.landingRequested=false;state.authPage='';return zoomTransition('#app .auth', ()=>renderLanding(), '#app .landing');}
      if(a==='landing-page'){state.landingRequested=true;state.authPage=el.dataset.page||'';return paintAuth();}
      if(a==='landing-scroll')return landingScroll(el.dataset.target);
      if(a==='landing-open-url'){
        const url=el.dataset.url||'';
        if(!url) return toast('주소가 아직 설정되지 않았어요. 관리자에게 알려 주세요.');
        openSafeLink(url);   // http(s) · mailto · tel 만 허용
        return;
      }
      if(a==='mention-pick')return pickMention(el.dataset.idx);
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
      if(a==='pages-add'){syncPagesDraft();const l=pagesDraft();if(l.length<8)l.push({id:'page'+Date.now().toString(36),label:'새 안내',title:'새 안내',html:'',enabled:true,buttons:[]});renderPagesAdmin($('#adminPanel'));return}
      if(a==='save-pages')return saveAuthPages();
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
      if(a==='settings')return openSettings(); if(a==='delete-account')return openDeleteAccountModal(); if(a==='profile')return openProfile(); if(a==='presence-menu'){ openPresenceMenu(el); return; } if(a==='logout')return confirmModal('로그아웃 하시겠어요?','다시 로그인해야 들어올 수 있어요.',()=>{closeAllModals();clearListeners();return auth.signOut();}); if(a==='new-room')return openRoomModal(); if(a==='admin')return openAdmin();
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
      if(a==='close-drawer')return closeDrawer(); if(a==='open-drawer')return openDrawer(); if(a==='mobile-back'){document.body.classList.remove('m-chat-open');openDrawer();return;} if(a==='jump-bottom'){hideInRoomPill();const h=$('#messages');if(h)scrollMessagesToBottom(h,true);return;} if(a==='open-invite'||a==='invite'){closeAllModals();return openInvite(rid());} if(a==='accept-invite')return acceptInvite(inv()); if(a==='decline-invite')return declineInvite(inv());
      if(a==='cross-approve')return handleCross(el.dataset.id,true); if(a==='cross-reject')return handleCross(el.dataset.id,false);
      if(a==='admin-set-school')return openUserSchoolPicker(el.dataset.uid,el.dataset.name);
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
      if(a==='report-message')return openReport(el.dataset.senderId,el.dataset.senderName,el.dataset.msg,el.dataset.roomId); if(a==='delete-message')return deleteMessage(el.dataset.msg); if(a==='reply-message')return setReply(el.dataset.msg);
      if(a==='open-report')return openReportDetail(el.dataset.id);
      if(a==='warn-by-report')return warnByReport(el.dataset.id,el.dataset.uid,el.dataset.name);
      if(a==='suspend-by-report')return suspendByReport(el.dataset.id,el.dataset.uid,el.dataset.name);
      if(a==='new-banner')return openRoom(rid()); if(a==='group-chat')return openRoomModal('private'); if(a==='school-settings')return openAdmin('school'); if(a==='reports')return openAdmin('reports'); if(a==='notice')return openAdmin('popup'); if(a==='save-group-map')return saveGroupMap();
      if(a==='chat-groups'){closeAllModals();return openGroupManager();} if(a==='chat-manage')return openChatManager(); if(a==='blocked-users')return openBlockedUsers(); if(a==='attach-file'){const fi=$('#chatFileInput');if(fi)fi.click();return;}
      if(a==='view-attach'){const m=state.messages.find(x=>x.id===el.dataset.msg);const src=m?.attachment?.data?esc(safeImgSrc(m.attachment.data)):'';const href=m?.attachment?.data?esc(safeFileHref(m.attachment.data)):'';if(src)openModal(`<h2>${esc(m.attachment.name||'사진')}</h2><img class="attach-view" src="${src}" alt=""><div class="modal-actions"><button class="cancel" data-close-modal>닫기</button>${href?`<a class="confirm" style="text-decoration:none;display:grid;place-items:center" href="${href}" download="${esc(m.attachment.name||'사진')}" data-close-modal>내려받기</a>`:''}</div>`);return;}
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
      if(a==='close-modal')return closeModal(); if(a==='save-setup')return saveSetup(); if(a==='save-photo'||a==='upload-photo')return chooseProfilePhoto(); if(a==='remove-photo')return removeProfilePhoto();
      return;
    }
    const closeBtn=e.target.closest('[data-close-modal]'); if(closeBtn)return closeModal();
    const tab=e.target.closest('[data-tab]'); if(tab&&$('#adminPanel')){renderAdminPanel(tab.dataset.tab);$$('.tab',tab.closest('.overlay')||document).forEach(x=>x.classList.toggle('active',x===tab));return;}
    if(e.target.matches('.select-option'))return;
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
      <div class="user-head"><div id="profileAvatarPreview">${avatarHtml(p,'large')}</div><div class="grow"><strong style="font-size:16px">${esc(p.displayName||'사용자')}</strong><div class="profile-meta">${gradeClassPrefix(p)}${roleLabel(p.role)}</div><div class="presence-row"><span class="presence-dot inline ${myPresenceState()||'hidden'}" data-my-presence-dot aria-hidden="true"></span><button type="button" class="presence-menu-btn" data-action="presence-menu" aria-haspopup="menu" aria-label="접속 상태 변경"><span class="presence-text" data-my-presence-label>${esc(myPresenceLabel())}</span><span class="presence-caret" aria-hidden="true">⌄</span></button></div></div></div>
      <div class="code-row"><div class="grow"><div class="code-label">내 초대 코드</div><div class="code-value" data-my-code>${esc(p.userCode||'준비 중')}</div></div><button type="button" class="soft-btn" data-action="copy-code">복사</button></div>
      <p class="desc" style="margin:8px 0 16px;font-size:12px">친구가 이 코드를 입력하면 나를 채팅방에 초대할 수 있어요. 자유롭게 알려 주세요.</p>
      <div class="field"><label>닉네임</label><input class="input" name="displayName" value="${esc(p.displayName)}" maxlength="20" required></div>
      ${classFields}
      <div class="field"><label>자기소개</label><textarea class="input" name="bio" maxlength="80" style="min-height:76px" placeholder="예: 축구 좋아해요. 모둠방에서 만나요!">${esc(p.bio||'')}</textarea></div>
      <div class="field"><label>프로필 사진</label><div class="photo-row"><div id="photoPreview" class="photo-preview">${p.photoURL?`<img src="${esc(p.photoURL)}" alt="">`:'<span>사진 없음</span>'}</div><div class="grow"><input type="file" id="avatarFileInput" accept="image/*" hidden><button type="button" class="soft-btn" style="width:100%" data-action="upload-photo">사진 올리기</button>${p.photoURL?`<button type="button" class="soft-btn" style="width:100%;margin-top:8px" data-action="remove-photo">사진 지우기</button>`:''}</div></div></div>
      <div class="field"><label>프로필 이모지</label><div class="avatar-pick">${emojiButtons}</div></div>
      <div class="field"><label>프로필 색상</label><div class="avatar-pick">${colorButtons}</div></div>
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
    let adminInfo=null;
    if(isAdmin()){ try{ const s=await db.collection('users').doc(id).get(); adminInfo=s.exists?s.data():null; }catch(e){ console.error(e); } }
    const infoRows=adminInfo?`<div class="admin-card" style="margin:14px 0 0;padding:14px"><h3 style="font-size:14px">접속 정보 (관리자만 볼 수 있어요)</h3>
      <div class="admin-meta"><span class="admin-chip">학교 ${esc(adminInfo.schoolName||'미지정')}</span><span class="admin-chip">마지막 로그인 ${esc(fmtDateTime(adminInfo.lastLoginAt))}</span><span class="admin-chip">IP ${esc(adminInfo.lastLoginIp||'기록 없음')}</span><span class="admin-chip">로그인 ${Number(adminInfo.loginCount||0)}회</span><span class="admin-chip">가입 IP ${esc(adminInfo.signupIp||'기록 없음')}</span><span class="admin-chip">가입일 ${esc(fmtDateTime(adminInfo.createdAt))}</span><span class="admin-chip ${Number(adminInfo.warnCount||0)>0?'warn':''}">경고 ${Number(adminInfo.warnCount||0)}회</span></div>
      ${adminInfo.lastUserAgent?`<p class="desc" style="margin:10px 0 0;font-size:11px;word-break:break-all">${esc(String(adminInfo.lastUserAgent).slice(0,200))}</p>`:''}
      <div class="admin-btns"><button type="button" class="soft-btn" data-action="admin-set-school" data-uid="${esc(id)}" data-name="${esc(dispName)}">학교 변경</button><button type="button" class="soft-btn" data-action="admin-class" data-uid="${esc(id)}" data-name="${esc(dispName)}">학급·반 변경</button></div>
      <div class="admin-btns"><button type="button" class="soft-btn" data-action="timeout-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">채팅 타임아웃</button>${Number(adminInfo.warnCount||0)>0?`<button type="button" class="soft-btn" data-action="reset-warns" data-uid="${esc(id)}" data-name="${esc(dispName)}">경고 지우기</button>`:''}</div>
      ${adminInfo.suspended
        ? `<div class="form-error" style="margin:10px 0 0">지금 이용이 정지된 계정이에요. 사유: ${esc(adminInfo.suspendReason||'적혀 있지 않아요.')}</div><button type="button" class="soft-btn" style="width:100%;margin-top:8px" data-action="unsuspend-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">이용 정지 풀기</button>`
        : `<button type="button" class="danger-btn" style="width:100%;margin-top:8px;height:38px;border-radius:13px;font-size:13px" data-action="suspend-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">이용 정지</button>`}
    </div>`:'';
    openModal(`<h2>프로필</h2><div class="user-head">${avatarHtml(p,'large',true)}<div class="grow"><strong style="font-size:17px">${esc(dispName)}</strong><div class="profile-meta">${gradeClassPrefix(p)}${roleLabel(p.role)}</div>${presenceStateOf(p)?`<div class="presence-row static"><span class="presence-dot inline ${presenceStateOf(p)}" aria-hidden="true"></span><span class="presence-text">${esc(presenceLabel(presenceStateOf(p)))}</span></div>`:''}</div></div>${p.photoFlagged?'<p class="photo-caution">이 프로필 사진은 자동 검사에서 주의가 필요한 사진으로 확인됐어요.</p>':''}${p.bio?`<p class="bio-text">${esc(p.bio)}</p>`:'<p class="desc">아직 자기소개가 없어요.</p>'}${infoRows}<div class="modal-actions" style="flex-wrap:wrap">${friendBtn}<button class="cancel" data-action="block" data-uid="${esc(id)}" data-name="${esc(dispName)}">${blocked?'차단 해제':'차단'}</button><button class="cancel" data-action="report-user" data-uid="${esc(id)}" data-name="${esc(dispName)}">신고</button><button class="confirm" data-close-modal>닫기</button></div>`);
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
    toast('사진을 준비하고 있어요...');
    let data='';
    try{ data=await compressAvatar(file); }catch(e){ console.error(e); }
    if(!data) return toast('사진을 처리하지 못했어요. 다른 사진으로 다시 시도해 주세요.');
    toast('사진을 살펴보는 중이에요...');
    const risk=await analyzeImageSrc(data);
    if(risk.checked && risk.risk){ showProfilePhotoRiskModal(data,risk); return; }
    await saveProfilePhotoData(data,false,risk);
  }
  function showProfilePhotoRiskModal(data,risk){
    state.photoDraft={data,risk};
    openModal(`<h2>주의가 필요한 사진일 수 있어요</h2>
      <p class="desc">자동 검사 결과 <b>${esc(risk.label||'부적절한 내용')}</b> 가능성이 확인됐어요. 그래도 사용하면 프로필에 <b>주의 필요</b> 표시가 함께 보여요.</p>
      <img class="attach-view" src="${data}" alt="프로필 사진 미리보기">
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
  function roomIcon(r){return r.type==='notice'?'📌':r.type==='private'?'◌':'👥';}
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
    const pinned=(state.rooms||[]).filter(r=>isRoomPinned(r.id)).sort((a,b)=>(isRoomPinnedByAdmin(b.id)?1:0)-(isRoomPinnedByAdmin(a.id)?1:0));
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
    const invitesHtml=state.pendingInvites.map(i=>`<div class="list-item" data-invite="${i.id}"><div class="grow"><div class="title">${esc(i.roomName||'채팅방 초대')}</div><div class="meta">${esc(i.inviterName||'사용자')}님이 초대했어요.</div></div><button class="soft-btn" style="flex:0 0 58px" data-action="accept-invite" data-invite="${i.id}">받기</button><button class="soft-btn" style="flex:0 0 58px" data-action="decline-invite" data-invite="${i.id}">거절</button></div>`).join('');
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
    items.push(`<button type="button" data-action="room-pin" data-room-id="${roomId}">${pinned?'고정 해제':'위로 고정'}</button>`);
    items.push(`<button type="button" data-action="mute-room" data-room-id="${roomId}">${muted?'알림 켜기':'알림 끄기'}</button>`);
    if(isAdmin()||r.createdBy===uid()||(r.memberIds||[]).includes(uid())) items.push(`<button type="button" data-action="manage-room" data-room-id="${roomId}">채팅방 설정</button>`);
    if((r.memberIds||[]).includes(uid())&&r.type!=='notice') items.push(`<button type="button" class="danger" data-action="leave-room" data-room-id="${roomId}">채팅방 나가기</button>`);
    showFloatMenu(x,y,`<div class="float-title">${esc(r.name||'채팅방')}</div>${items.join('')}`);
  }
  function roomHtml(r){const unread=state.unread[r.id]?1:0;const lock=isRoomMuted(r.id)?'<span class="share-dot" style="background:#9aa4b2" title="알림을 꺼 둔 채팅방이에요"></span>':'';const pin=isRoomPinned(r.id)?'<span class="pin-mark" title="위로 고정">📌</span>':'';return `<button class="room ${state.room?.id===r.id?'active':''}${unread?' has-unread':''}" data-room-id="${r.id}"><div class="room-icon">${roomIconHtml(r)}</div><div class="room-main"><div class="room-name">${pin}${esc(r.name||'이름 없는 채팅방')}${shareDot(roomShare(r))}${lock}</div><div class="room-sub">${esc(r.lastText || (r.type==='notice'?'선생님이 안내를 올려요.':'메시지가 아직 없어요.'))}</div></div><div class="room-right">${state.unread[r.id]?`<span class="unread">${Math.min(99,state.unread[r.id])}</span>`:''}</div></button>`;}

  // ---------- 탭(카테고리) 저장 ----------
  async function persistGroups(){
    const s={...(state.profile?.settings||{}),fontSize:state.settings.fontSize,theme:state.settings.theme||currentTheme(),notify:state.settings.notify||notifySettings(),roomGroups:state.settings.roomGroups||{},groupOrder:(state.groupNames||[]).slice(),mutedRooms:state.settings.mutedRooms||[],pinnedRooms:state.settings.pinnedRooms||[],collapsedGroups:state.settings.collapsedGroups||[]};
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
    roomDrag=null;
  }
  function beginRoomDrag(el,x,y){
    if(!roomDrag) return;
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
    try{ if(navigator.vibrate) navigator.vibrate(12); }catch(e){}
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
  }
  async function endRoomDrag(){
    const d=roomDrag; if(!d) return;
    const id=d.id, over=d.over;
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
    try{ if(navigator.vibrate) navigator.vibrate(12); }catch(e){}
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
  }
  async function endCatDrag(){
    const d=catDrag; if(!d) return;
    catDrag=null;
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
      let timer=setTimeout(()=>{ if(!beginCatDrag(head,group)){ catDrag=null; } },320);
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
    const queries=roomQueries();
    const load=async()=>{
      try{
        const snaps=await Promise.all(queries.map(q=>q.get()));
        const map=new Map(); snaps.forEach(s=>s.docs.forEach(d=>map.set(d.id,{id:d.id,...d.data()})));
        // 지워진 채팅방은 목록에서 감춘다 (기록은 관리자 도구에서 계속 볼 수 있다)
        state.rooms=[...map.values()].filter(r=>!r.deleted).sort((a,b)=>docTs(b.updatedAt)-docTs(a.updatedAt));
        healStalePrivateRooms();
        if(!(state.knownRoomIds instanceof Set)) state.knownRoomIds=new Set();
        for(const r of state.rooms){
          const known=state.knownRoomIds.has(r.id);
          const old=previous.get(r.id)||0, fresh=docTs(r.lastCreatedAt);
          // 이미 알고 있던 방이면 lastCreatedAt이 0이었더라도(첫 메시지) 알림을 준다
          const isNewMsg = fresh>0 && fresh!==old && (known||old>0);
          if(isNewMsg && r.lastSenderId && r.lastSenderId!==uid() && !summaryBlocked(r)){
            if(r.id!==state.room?.id && !isRoomMuted(r.id)) showNewMessageBanner(r.id,r,{senderName:r.lastSenderName||'사용자',text:r.lastText||''});
            notifyMessage(r.id,r,{senderId:r.lastSenderId,senderName:r.lastSenderName||'사용자',text:r.lastText||'',createdAt:r.lastCreatedAt});
          }
        }
        // compute unread counts only where the channel changed since the last read marker
        const reads=state.profile?.readAt||{};
        const candidates=state.rooms.filter(r=>r.id!==state.room?.id && docTs(r.lastCreatedAt)>docTs(reads[r.id]) && r.lastSenderId!==uid() && !summaryBlocked(r));
        const counts=await Promise.all(candidates.slice(0,30).map(async r=>{try{const s=await db.collection('channels').doc(r.id).collection('messages').orderBy('createdAt','desc').limit(80).get();const cut=docTs(reads[r.id])||0;return [r.id,s.docs.filter(d=>{const m=d.data();return !m.deleted&&m.senderId!==uid()&&docTs(m.createdAt)>cut&&!isBlockedMessage(m)}).length];}catch{return [r.id,1];}}));
        state.unread={};counts.forEach(([id,c])=>state.unread[id]=c);renderRooms(); previous.clear();state.rooms.forEach(r=>{previous.set(r.id,docTs(r.lastCreatedAt));state.knownRoomIds.add(r.id);});
      }catch(e){console.error('room load',e);toast('채팅방을 불러오는 데 잠시 문제가 있었어요.');}
    };
    load();
    const schedule=()=>{clearTimeout(roomLoadTimer);roomLoadTimer=setTimeout(load,120);};
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
  function clearFriendListeners(){
    [friendsUnsub,friendReqUnsub,sentFriendUnsub].forEach(u=>{ try{ if(u) u(); }catch(e){} });
    friendsUnsub=friendReqUnsub=sentFriendUnsub=null;
  }
  const shownFriendCards=new Set();
  function attachFriendListeners(){
    clearFriendListeners();
    friendsUnsub=db.collection('friendships').where('members','array-contains',uid()).limit(200).onSnapshot(async s=>{
      const others=s.docs.map(d=>(d.data().members||[]).find(m=>m!==uid())).filter(Boolean);
      await ensureProfiles(others);
      state.friends=others.map(id=>({uid:id,profile:state.profileCache.get(id)||{}}));
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
      await db.collection('friendships').doc(pairId(uid(),req.from)).set({members:[uid(),req.from].sort(),createdAt:ts()},{merge:true});
      await db.collection('friendRequests').doc(id).update({status:'accepted',handledAt:ts()});
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
    return `<button class="room" data-action="user-profile" data-uid="${esc(f.uid)}" data-name="${esc(name)}"><div class="room-icon">${esc(name.charAt(0)||'?')}</div><div class="room-main"><div class="room-name">${esc(name)}</div><div class="room-sub">${esc(compact?(p.bio||'친구'):(gradeClassPrefix(p)+(p.bio||'친구')))}</div></div></button>`;
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
      <div class="field"><label>내 친구 (${friends.length})</label><div class="list">${friends.map(f=>{const p=f.profile||{};const nm=p.displayName||'친구';return `<div class="list-item" data-uid="${esc(f.uid)}"><div>${avatarHtml(p)}</div><div class="grow"><div class="title">${esc(nm)}</div><div class="meta">${gradeClassPrefix(p)}${esc(p.bio||'')}</div></div><button class="soft-btn" style="flex:0 0 60px" data-action="user-profile" data-uid="${esc(f.uid)}" data-name="${esc(nm)}">프로필</button><button class="soft-btn" style="flex:0 0 48px" data-action="friend-remove" data-uid="${esc(f.uid)}">끊기</button></div>`;}).join('')||'<div class="empty-side">아직 친구가 없어요.</div>'}</div></div>
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
  }
  function showNoticePopup(n){openModal(`<h2>안내가 왔어요</h2><p class="desc">${esc(n.text)}</p><div class="modal-actions"><button class="confirm" data-action="read-notice" data-id="${n.id}">확인</button></div>`,{small:true});}
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
      const patch={ lastLoginAt:ts(), loginCount:firebase.firestore.FieldValue.increment(1), lastUserAgent:String(navigator.userAgent||'').slice(0,300) };
      if(ip){ patch.lastLoginIp=ip; if(first) patch.signupIp=ip; }
      await db.collection('users').doc(uid()).update(patch);
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
        popup:{...DEFAULT_SITE_NOTICE.popup,...(d.popup||{}),updatedAt:d.updatedAt}
      };
      renderSiteBanner();
      maybeShowSiteNoticePopup();
    },e=>console.error('site notice',e));
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
  async function openRoom(id){
    const token=++roomOpenToken;
    let room=state.rooms.find(r=>r.id===id);
    if(!room){ try{ const s=await db.collection('channels').doc(id).get(); if(!s.exists)return; room={id,...s.data()}; state.rooms=[room,...state.rooms]; }catch(e){ console.error(e); return; } }
    if(token!==roomOpenToken) return;   // 그 사이 다른 방을 열었으면 이 호출은 버린다
    state.room=room; state.unread[id]=0; state.replyText=null; state.selectMode=false; state.selected=new Set(); state.revealedAttach=new Set(); closeDrawer(); closeFloatMenu();
    if(window.innerWidth<=820) document.body.classList.add('m-chat-open');
    stopTyping(); state.typingCooldownUntil=0; state.mentionTriedKey='';
    state.searchMode=false; state.searchQuery=''; state.searchHits=[]; state.searchIndex=-1; state.unreadMarkerId=null; state.awayMsgId=null; state.scrollToMarker=false; state.justOpenedRoom=true;
    const focus=(state.reportFocus&&state.reportFocus.roomId===id)?state.reportFocus:null;
    state.reportFocus=null; state.reportTargetId=focus?focus.msgId:null;
    const gb=$('#globalBanner'); if(gb){gb.classList.remove('show');clearTimeout(state.banner.timer);} hideInRoomPill(); renderRooms();
    await markRead(id);
    if(token!==roomOpenToken) return;
    clearRoomListener();
    renderChatFrame(room);
    startLockTick();
    state.seenMsgIds=new Set();
    state.bubbleAnims=new Map();
    const ref=db.collection('channels').doc(id).collection('messages').orderBy('createdAt','asc').limitToLast(300);
    let first=true; roomUnsub=ref.onSnapshot(s=>{
      if(token!==roomOpenToken || state.room?.id!==id) return;   // 다른 방으로 옮겼으면 무시
      const oldCount=state.messages.length;
      state.messages=s.docs.map(d=>({id:d.id,...d.data()}));
      // 메시지가 늘거나 지워지면 검색 결과도 다시 계산한다 (개수 표시가 어긋나지 않게)
      if(state.searchMode) runRoomSearch(state.searchQuery);
      renderMessages(first);
      ensureCurrentProfiles();
      if(!first && state.messages.length>oldCount){
        const latest=state.messages[state.messages.length-1];
        if(latest && latest.senderId!==uid() && !isBlockedMessage(latest)) notifyMessage(id,room,latest);
      }
      // 보고 있는 동안 새 메시지가 오면 읽음 위치를 갱신한다 (읽음 표시 · 안읽음 배지)
      if(!first && state.messages.length>oldCount && !document.hidden && state.atBottom){
        const t=Date.now();
        if(t-(state.readWriteAt||0)>1500){ state.readWriteAt=t; markRead(id); }
      }
      first=false;
    },e=>{console.error(e);toast('채팅을 불러오지 못했어요.');});
    attachTypingListener(id);
    attachReadsListener(id);
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
    desk.push(`<button type="button" class="head-btn" data-action="members" data-room-id="${room.id}" title="참여자 보기"><span class="hb-ico">👥</span><span class="hb-label">참여자</span><span class="hb-count">${count}</span></button>`);
    desk.push(`<button type="button" class="head-btn" data-action="toggle-search" title="메시지 검색"><span class="hb-ico">🔍</span><span class="hb-label">검색</span></button>`);
    if(canInvite) desk.push(`<button type="button" class="head-btn" data-action="invite" data-room-id="${room.id}" title="사람 초대하기"><span class="hb-ico">👤</span><span class="hb-label">사람 초대</span><span class="hb-plus">＋</span></button>`);
    if(isMember) desk.push(`<button type="button" class="icon-btn" data-action="manage-room" data-room-id="${room.id}" title="채팅방 설정" aria-label="채팅방 설정">⚙</button>`);
    const desc=esc(room.description||((room.type==='notice')?'안내와 공지가 올라와요.':'편하게 이야기해 보세요.'));
    $('#chat').innerHTML=`<header class="chat-head"><button type="button" class="icon-btn narrow-only mobile-back" data-action="mobile-back" aria-label="채팅 목록으로" title="채팅 목록으로">←</button><button type="button" class="icon-btn narrow-only" data-action="open-drawer" aria-label="채팅방 목록" title="채팅방 목록">▤</button><div class="chat-head-left"><div class="chat-title">${esc(room.name||'채팅방')}${sharePill(share)}${warnPill}</div><div class="chat-desc">${desc}</div></div><div class="head-actions wide-only">${desk.join('')}</div><button type="button" class="icon-btn narrow-only" data-action="room-menu" data-room-id="${room.id}" aria-label="채팅 메뉴" title="채팅 메뉴">☰</button></header><div class="chat-body${state.memberPanel?' panel-open':''}"><div class="chat-main">${selectBarHtml()}${state.searchMode?searchBarHtml():''}<div id="oldChatBar" class="old-chat-bar hidden">오래전 채팅을 보고 있어요.</div><div class="messages-wrap"><div id="messages" class="messages"></div><div id="newBanner" class="new-banner"></div></div>${composerHtml(room)}<button type="button" id="jumpBottomFab" class="jump-bottom-fab hidden" data-action="jump-bottom" aria-label="맨 아래로">↓</button></div><div class="mp-resizer" id="mpResizer" title="끌어서 폭 조절 (더블클릭하면 기본값)"></div><aside id="memberPanel" class="member-panel${state.memberPanel?' open':''}"><div class="member-panel-inner"><div class="member-panel-head"><strong>참여자 <span id="memberCount">${count}</span>명</strong><button type="button" class="icon-btn" data-action="close-members" aria-label="닫기">✕</button></div><div id="memberList" class="member-list"></div></div></aside></div>`;
    wireMemberResizer();
    observeComposer();
    const cm=$('#chat .chat-main');
    if(cm && !prefersReducedMotion()){ cm.classList.remove('room-enter'); void cm.offsetWidth; cm.classList.add('room-enter'); setTimeout(()=>cm.classList.remove('room-enter'),380); }
    if(state.memberPanel) renderMemberPanel();
  }
  // 입력창이 여러 줄로 커져도 마지막 메시지가 가려지지 않게 실제 높이를 --composer에 반영한다
  let composerRO=null;
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
      <button class="list-item" data-action="members" data-room-id="${room.id}"><div class="grow"><div class="title">참여자 보기</div><div class="meta">${(room.memberIds||[]).length}명이 함께 있어요.</div></div><span>👥</span></button>
      <button class="list-item" data-action="toggle-search"><div class="grow"><div class="title">메시지 검색</div><div class="meta">이 채팅방에서 지난 대화를 찾아요.</div></div><span>🔍</span></button>
      ${canInvite?`<button class="list-item" data-action="invite" data-room-id="${room.id}"><div class="grow"><div class="title">사람 초대하기</div><div class="meta">초대 코드로 사람을 불러요.</div></div><span>👤</span></button>`:''}
      ${isMember?`<button class="list-item" data-action="manage-room" data-room-id="${room.id}"><div class="grow"><div class="title">채팅방 설정</div><div class="meta">알림, 참여자, 나가기 등을 관리해요.</div></div><span>⚙</span></button>`:''}
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
    state.searchHits=state.messages.filter(m=>!m.deleted && !isHiddenMsg(m.id) && !isBlockedMessage(m) && String(m.text||'').toLowerCase().includes(needle)).map(m=>m.id);
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
    $('#chat .chat-body')?.classList.add('panel-open');
    const p=$('#memberPanel'); if(p) p.classList.add('open');
    renderMemberPanel();
  }
  function closeMembersPanel(){
    state.memberPanel=false;
    const body=$('#chat .chat-body'); if(body) body.classList.remove('panel-open');
    const p=$('#memberPanel'); if(p) p.classList.remove('open');
  }
  // 채팅방 참여자 = 명단(memberIds) + 실제로 메시지를 보낸 사람 (학교 전체 공유방 등에서 누락되지 않게)
  function roomParticipantIds(){
    const r=state.room; if(!r) return [];
    const out=[], seen=new Set();
    const push=(id)=>{ if(id && !seen.has(id)){ seen.add(id); out.push(id); } };
    (r.memberIds||[]).forEach(push);
    (state.messages||[]).forEach(m=>{ if(!m.deleted && m.senderId) push(m.senderId); });
    return out;
  }
  async function renderMemberPanel(){
    const r=state.room; if(!r) return;
    const host=$('#memberList'); if(!host) return;
    const ids=roomParticipantIds();
    host.innerHTML='<div class="empty-side">불러오는 중이에요.</div>';
    await ensureProfilesAll(ids);
    // 관리자·교사는 'users' 문서에 역할이 들어 있어서 그걸로 정확히 표시한다
    const roles={};
    await Promise.all(ids.slice(0,60).map(async u=>{
      try{ const s=await db.collection('users').doc(u).get(); if(s.exists) roles[u]=s.data(); }catch(e){}
    }));
    if(!state.room || state.room.id!==r.id) return;
    const staffView=isStaff();
    const visible=ids.filter(id=>{
      const role=(roles[id]||{}).role || (state.profileCache.get(id)||{}).role;
      return staffView || role!=='admin';
    });
    const hidden=ids.length-visible.length;
    const cnt=$('#memberCount'); if(cnt) cnt.textContent=String(ids.length);
    const openNote=r.visibility==='all'?'<div class="empty-side" style="text-align:left">우리 학교 전체에 열려 있는 채팅방이라 아래 목록 말고도 들어올 수 있어요.</div>':(r.visibility==='members'?'<div class="empty-side" style="text-align:left">초대받았거나 참가 코드로 들어온 사람만 있어요.</div>':'');
    host.innerHTML=openNote+(visible.map(id=>{
      const p=state.profileCache.get(id)||{};
      const acct=roles[id]||{};
      const role=acct.role||p.role;
      const nm=acct.displayName||p.displayName||'사용자';
      const st=presenceStateOf(p);
      const owner=id===r.createdBy;
      return `<div class="list-item tappable" data-action="user-profile" data-uid="${esc(id)}" data-name="${esc(nm)}"><div>${avatarHtml(p,'',true)}</div><div class="grow"><div class="title">${esc(nm)}${id===uid()?' (나)':''}${owner?' <span class="admin-chip">방장</span>':''}</div><div class="meta">${gradeClassPrefix({grade:acct.grade||p.grade,classNum:acct.classNum||p.classNum})}${roleLabel(role)}${st?` · ${presenceLabel(st)}`:''}</div></div></div>`;
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
          const patch=softDeletePatch();
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
  function composerHtml(room){
    const canSend = room.type==='notice' ? isTeacher() : (isAdmin() || room.visibility==='all' || (room.memberIds||[]).includes(uid()));
    if(!canSend)return `<div class="composer"><div class="composer-inner centered">${room.type==='notice'?'이 공지방은 선생님이 안내를 올리는 곳이에요.':'이 채팅방에 참여하면 메시지를 보낼 수 있어요.'}</div></div>`;
    const st=lockState();
    if(st.kind==='timeout'){
      const head=st.to.permanent
        ? '채팅 이용이 정지되어 있어요. 선생님이 풀어 줄 때까지 기다려 주세요.'
        : `타임아웃 중이에요 · 남은 시간 <b>${esc(fmtRemain(st.to.ms))}</b>`;
      return `<div class="composer"><div class="composer-inner centered compose-lock">⏳ <span>${head}</span>${st.to.reason?`<span class="lock-reason">사유: ${esc(st.to.reason)}</span>`:''}</div></div>`;
    }
    if(st.kind==='flood') return `<div class="composer"><div class="composer-inner centered compose-lock">메시지를 너무 빠르게 보냈어요<span class="lock-reason"><b>${Math.ceil(st.ms/1000)}초</b> 뒤에 다시 보낼 수 있어요.</span></div></div>`;
    if(st.kind==='chatoff') return `<div class="composer"><div class="composer-inner centered compose-lock">지금은 이 채팅방에서 메시지를 보낼 수 없어요.<span class="lock-reason">선생님이 채팅을 잠시 멈춰 두었어요.</span></div></div>`;
    if(st.kind==='warn') return `<div class="composer"><div class="composer-inner centered compose-lock">경고가 ${warnLimit()}번 쌓여서 메시지를 보낼 수 없어요.<span class="lock-reason">선생님께 이야기해 주세요.</span></div></div>`;
    const rxToggle=(room.type==='notice' && isTeacher())
      ? `<button type="button" class="icon-btn ${state.noReactions?'off':''}" data-action="toggle-reactions" title="${state.noReactions?'이 공지는 공감을 받지 않아요':'이 공지는 공감을 받을 수 있어요'}" aria-label="공감 허용">${state.noReactions?'🚫':'🙂'}</button>`
      : '';
    return `<div class="composer"><div id="mentionBox" class="mention-box hidden"></div><div class="char-count" id="charCount">0 / 1500</div><form id="composerForm" class="composer-inner"><button type="button" class="icon-btn" data-action="attach-file" title="파일·사진 보내기">＋</button>${rxToggle}<textarea id="composerText" name="text" rows="1" maxlength="1500" placeholder="메시지를 입력해 주세요. (최대 1500자)" enterkeyhint="send" autocomplete="off" autocapitalize="sentences"></textarea><button type="submit" class="send" aria-label="전송">↑</button></form><input type="file" id="chatFileInput" accept="image/*,.pdf,.txt,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip" hidden></div>`;
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
    const next=tmp.firstElementChild; if(!next) return;
    cur.replaceWith(next);
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
    if(att && att.data){
      if(att.kind==='image'){
        const src=esc(safeImgSrc(att.data));
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
      else { const href=esc(safeFileHref(att.data)); if(href) head=`<a class="attach-card" href="${href}" download="${esc(att.name||'파일')}" data-action="download-attach"><span class="attach-ico">${attachIcon(att)}</span><span class="grow"><span class="attach-name">${esc(att.name||'파일')}</span><span class="attach-size">${esc(fmtBytes(att.size))}</span></span></a>`; }
    }
    const body=m.text?`<span class="attach-text">${mentionText(m.text)}</span>`:'';
    return head+(head&&body?`<br>`:'')+body;
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
    return att.kind==='image'?'📷 사진':('📎 '+(att.name||'파일'));
  }
  // ---------- 메시지 공감 (이모지) ----------
  const REACTIONS=['👍','❤️','😄','⭐','🎉','😢'];
  function reactionsHtml(m){
    if(m.noReactions) return '';
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
    showFloatMenu(x,y,`<div class="float-title">공감 남기기</div><div class="rx-picker">${REACTIONS.map(e=>`<button type="button" data-action="toggle-reaction" data-msg="${esc(msgId)}" data-emoji="${esc(e)}">${e}</button>`).join('')}</div>`);
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
    const m=state.messages.find(v=>v.id===msgId); if(!m) return;
    const mine=m.senderId===uid();
    const senderName=esc((state.profileCache.get(m.senderId)||{}).displayName||m.senderName||'사용자');
    const items=[];
    items.push(`<button type="button" data-action="reply-message" data-msg="${esc(m.id)}">답장</button>`);
    if(!m.noReactions) items.push(`<button type="button" data-action="react-pick" data-msg="${esc(m.id)}">감정 아이콘</button>`);
    items.push(`<button type="button" data-action="pick-chat" data-msg="${esc(m.id)}">채팅 선택</button>`);
    if(!mine){
      items.push(`<button type="button" data-action="report-message" data-msg="${esc(m.id)}" data-room-id="${esc(state.room?.id||'')}" data-sender-id="${m.senderId}" data-sender-name="${senderName}" data-text="${esc(m.text||'')}">신고</button>`);
      items.push(`<button type="button" data-action="block" data-uid="${m.senderId}" data-name="${senderName}">차단</button>`);
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
  // 관리자·교사도 남의 1:1/그룹 대화는 열람·삭제할 수 없다 (신고된 건만 신고 관리에서 확인).
  // 모두에게서 지우기: 방장이거나 본인 메시지 작성자 (남의 메시지는 방장만)
  function canPurgeMsg(m){ return !!state.room && (state.room.createdBy===uid() || !!(m&&m.senderId===uid())); }
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
    // 가장 아래(최근) 메시지 1개에만 읽음 표시
    let latestVisibleId='';
    for(const m of visible){ if(!m.deleted) latestVisibleId=m.id; }
    const msgTs=(m)=>docTs(m.createdAt)||0;
    for(let i=0;i<visible.length;i++){
      const m=visible[i];
      if(!isInitial && (!seen.has(m.id) || anims.has(m.id))) newIds.push(m.id);
      seen.add(m.id);
      const d=dateText(m.createdAt); if(d&&d!==lastDate){lastDate=d;html+=`<div class="day-sep"><span>${esc(d)}</span></div>`;}
      const dividerHere=state.unreadMarkerId===m.id;
      if(dividerHere) html+=`<div class="read-divider"><span>여기까지 읽었어요</span></div>`;
      if(m.deleted){
        // 지워진 메시지의 원문은 아무도 화면에서 볼 수 없다.
        // 신고가 접수된 경우에만 신고 관리 패널의 스냅샷으로 최소 열람한다.
        html+=`<div class="message-row center" data-msg-id="${esc(m.id)}"><div class="message-content"><div class="deleted-pill">삭제된 메시지예요</div></div></div>`;
        continue;
      }
      const profile=state.profileCache.get(m.senderId)||{displayName:m.senderName||'사용자',photoURL:m.senderPhotoURL||''};
      const mine=m.senderId===uid(); const reply=m.replyToText?`<div style="font-size:11px;color:${mine?'rgba(255,255,255,.75)':'var(--muted)'};margin-bottom:6px;border-left:2px solid currentColor;padding-left:8px">${esc(String(m.replyToText).slice(0,90))}</div>`:'';
      const senderName=esc(profile.displayName||m.senderName||'사용자');
      const t=esc(timeText(m.createdAt));
      const pm=i>0?visible[i-1]:null, nm=(i<visible.length-1)?visible[i+1]:null;
      const ts=msgTs(m);
      // 전송 직후(서버 시간 미확정)에도 묶음이 깜빡이지 않게: 시간·날짜가 비어 있으면 같은 것으로 취급
      const md=dateText(m.createdAt);
      const pd=pm?dateText(pm.createdAt):'', nd=nm?dateText(nm.createdAt):'';
      const diffPrev=(pm&&(ts&&msgTs(pm)))?(ts-msgTs(pm)):0;
      const diffNext=(nm&&(ts&&msgTs(nm)))?(msgTs(nm)-ts):0;
      const samePrev=!!(pm&&!pm.deleted&&pm.senderId===m.senderId&&diffPrev<60000&&state.unreadMarkerId!==pm.id&&(!pd||!md||pd===md));
      const sameNext=!!(nm&&!nm.deleted&&nm.senderId===m.senderId&&diffNext<60000&&!dividerHere&&(!nd||!md||nd===md));
      const groupFirst=!samePrev, groupLast=!sameNext;
      const avBtn=`<button type="button" class="avatar-btn" data-action="user-profile" data-uid="${m.senderId}" data-name="${senderName}" aria-label="프로필 보기">${avatarHtml(profile,'',true)}</button>`;
      const receipt=(m.id===latestVisibleId)?(mine?readReceiptHtml(m):readReceiptOthersHtml(m)):'';
      html+=`<div class="message-row ${mine?'mine':''}${groupFirst?'':' grouped'}${m.id===state.reportTargetId?' report-target':''}" data-msg-id="${esc(m.id)}">${state.selectMode?(canPickMsg(m)?`<button type="button" class="msg-pick ${selSet().has(m.id)?'on':''}" data-action="pick-msg" data-msg="${esc(m.id)}" aria-label="선택">✓</button>`:'<span class="msg-pick blank"></span>'):''}<div class="msg-side">${!mine?(groupFirst?avBtn:'<span class="msg-avatar-spacer"></span>'):''}</div><div class="message-content">${groupFirst?`<div class="message-author"><button type="button" class="author-btn" data-action="user-profile" data-uid="${m.senderId}" data-name="${senderName}">${senderName}</button> · ${roleLabel(profile.role||m.senderRole)} · ${t}${m.id===state.reportTargetId?' <span class="report-badge">신고된 메시지</span>':''}</div>`:''}${reply}<div class="bubble" data-time="${t}">${bubbleInner(m)}</div>${groupLast?'':`<div class="bubble-time">${t}</div>`}${reactionsHtml(m)}${groupLast?`<div class="msg-time">${t}</div>`:''}${receipt}</div>${mine?`<div class="msg-side">${groupFirst?avBtn:'<span class="msg-avatar-spacer"></span>'}</div>`:''}</div>`;
    }
    const pendingId=state.pendingHighlight; state.pendingHighlight=null;
    // 검열로 막힌 내 메시지는 목록 맨 아래에 카드로 남는다 (보낸 사람에게만 보임)
    html+=modBlocksHtml();
    const prevScrollTop=host.scrollTop, prevScrollH=host.scrollHeight;
    host.innerHTML=html || `<div class="empty-side" style="margin-top:30px">아직 메시지가 없어요.<br>첫 메시지를 남겨 보세요.</div>`;
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
        if(el) el.scrollIntoView({block:'start'});
        else scrollMessagesToBottom(host,true);
      });
    } else if(pendingId){
      const row=host.querySelector(`[data-msg-id="${esc(pendingId)}"]`);
      if(row){ row.classList.add('flash'); requestAnimationFrame(()=>row.scrollIntoView({block:'center'})); }
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
    if(!initial && !wasBottom && newIds.length){
      const newSet=new Set(newIds);
      const latest=[...visible].reverse().find(m=>!m.deleted&&newSet.has(m.id)&&m.senderId!==uid());
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
      const unsub=db.collection('publicProfiles').doc(id).onSnapshot(s=>{if(s.exists){state.profileCache.set(id,s.data());scheduleProfileRerender();}},e=>{console.warn('profile listen',id,e?.code||e);});
      state.profileUnsubs.push(unsub);
    });
    // 구독 인원이 많아 잘린 사람들도 이름·사진이 보이도록 한 번에 받아 둔다
    ensureProfilesAll(roomParticipantIds()).catch(()=>{});
    if(!state.profileCache.has(uid()))state.profileCache.set(uid(),state.profile);
  }

  const MSG_MAX_LEN=1500;
  async function sendMessage(form, attachment=null, roomIdArg=null){
    if(!state.room || !state.profile) return;
    if(navigator.onLine===false && !attachment) { toast('인터넷 연결이 끊겼어요. 연결된 뒤에 다시 보내 주세요.'); return; }
    const ta=(form?.querySelector?form.querySelector('#composerText'):null)||$('#composerText');
    const text=(ta?.value||'').trim();
    if(!text && !attachment) return;
    if(text.length>MSG_MAX_LEN){ if(ta) ta.value=text.slice(0,MSG_MAX_LEN); return toast(`메시지는 ${MSG_MAX_LEN}자까지만 보낼 수 있어요.`); }
    const room=state.room;
    // 사진 압축 등으로 시간이 걸리는 동안 사용자가 다른 방으로 옮겼다면 엉뚱한 방에 보내지 않는다
    if(roomIdArg && room.id!==roomIdArg) return toast('채팅방이 바뀌었어요. 다시 시도해 주세요.');
    const allowed = isAdmin() || (room.type==='notice' ? isTeacher() : room.visibility==='all' || (room.memberIds||[]).includes(uid()));
    if(!allowed){toast('이 채팅방에서는 메시지를 보낼 수 없어요.');return;}
    if(!isStaff()){
      const to=timeoutInfo();
      if(to) return toast(to.permanent?'채팅 이용이 정지되어 있어요.':`타임아웃 중이에요. ${fmtRemain(to.ms)} 남았어요.`);
      if(roomChatOff(room)) return toast('지금은 이 채팅방에서 메시지를 보낼 수 없어요.');
      if(state.warnCount>=warnLimit()) return toast('경고가 쌓여 메시지를 보낼 수 없어요. 선생님께 이야기해 주세요.');
      // 관리자가 '예외 단어'로 등록한 말이 들어 있으면 1차 차단을 건너뛴다 (예: 시발역)
      const allowed=findAnyBanned(text,chatCfg().allowWords);
      const hit=allowed?'':findAnyBanned(text,chatCfg().blockWords);
      if(hit) return blockMessage(text,hit,'word');
      // 우회 표기(시1발, ㅅㅂ …)는 관리자 목록에 없어도 막는다
      const byp=allowed?'':findLoose(text,BYPASS_PATTERNS);
      if(byp) return blockMessage(text,byp,'bypass');
    }
    if(!isStaff()){
      const fms=floodBlockMs();
      if(fms>0){ toast(`메시지를 너무 빠르게 보냈어요. ${Math.ceil(fms/1000)}초 뒤에 다시 보내 주세요.`); refreshComposer(); startLockTick(); return; }
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
      if(sendBtn){ sendBtn.disabled=false; sendBtn.classList.remove('sending'); }
      state.replyText=null;
      state.unreadMarkerId=null;
      stopTyping();
      // 카톡처럼 전송 후에도 키보드를 유지하고 입력창이 키보드 위에서 내려오지 않게 한다
      state.atBottom=true;
      if(ta){ ta.value=''; ta.style.height='auto'; ta.placeholder='메시지를 입력해 주세요. (최대 1500자)'; }
      updateCharCount();
      syncComposerHeight();
      const host=$('#messages');
      if(host) scrollMessagesToBottom(host,true);
      requestAnimationFrame(()=>{
        const ta2=$('#composerText');
        if(ta2){ try{ ta2.focus({preventScroll:true}); }catch(fe){ try{ ta2.focus(); }catch(_){} } }
        const host2=$('#messages');
        if(host2 && state.atBottom) host2.scrollTop=host2.scrollHeight-host2.clientHeight;
      });
    }catch(e){console.error(e);try{const sb=form?.querySelector?form.querySelector('.send'):document.querySelector('#composerForm .send'); if(sb){sb.disabled=false;sb.classList.remove('sending');}}catch(_){}toast(errText(e));return;}
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
  const IMG_MAX_SIDE=1280, IMG_MAX_DATA=760*1024, FILE_MAX_BYTES=600*1024;
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
    panel.innerHTML=`<h2>주의가 필요한 사진일 수 있어요</h2>
      <p class="desc">자동 검사 결과 <b>${esc(label||'부적절한 내용')}</b> 가능성이 확인됐어요. 그래도 보내면 상대방 화면에 <b>주의가 필요한 사진</b>으로 표시돼요.</p>
      <p class="desc">${kindWord} 사진이 아닌데도 이 안내가 떴다면, 사진을 보내더라도 아무런 제지를 받지 않아요. (자동 검사는 가끔 실제와 다르게 판단할 수 있어요.)</p>
      ${draft.url?`<img class="attach-view" src="${draft.url}" alt="보낼 사진 미리보기">`:''}
      <div class="warn-box">부적절한 이미지를 여러 번 보낼 시 계정이 정지될 수 있어요.</div>
      <div class="modal-actions"><button type="button" class="cancel" data-close-modal>보내지 않기</button><button type="button" class="danger-btn" data-action="attach-send-risky">그래도 보내기</button></div>`;
    wrapModalHead(panel,true);
  }
  async function sendAttachment(file, screen){
    if(!file) return;
    if(!state.room) return toast('채팅방을 먼저 골라 주세요.');
    const roomId=state.room.id;   // 준비하는 사이에 방이 바뀌어도 원래 방으로만 보낸다
    const isImage=String(file.type||'').startsWith('image/');
    if(!isImage && file.size>FILE_MAX_BYTES) return toast(`파일은 ${Math.round(FILE_MAX_BYTES/1024)}KB까지만 보낼 수 있어요. (지금 ${fmtBytes(file.size)})`);
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
        if(data.length>900*1024) return toast('파일이 너무 커요. 조금 작은 파일로 보내 주세요.');
      }
    }catch(e){ console.error(e); return toast('파일을 읽지 못했어요.'); }
    const flagged=isImage && !!(screen && screen.risk);
    const att={kind:isImage?'image':'file',name,type,size:isImage?Math.round(data.length*0.75):file.size,data};
    if(flagged){ att.risk=true; att.riskScore=Math.min(1,Number(screen.score)||0); }
    await sendMessage(null,att,roomId);
    if(flagged) await logImageFlag('image',screen,'사진');
  }

  function setReply(id){const m=state.messages.find(x=>x.id===id);if(!m)return;state.replyText=m.text||'';const ta=$('#composerText');if(ta){ta.placeholder=`“${(m.text||'').slice(0,28)}”에 답장해 보세요.`;ta.focus();}toast('답장을 준비했어요.');}
  async function deleteMessage(id){
    const m=state.messages.find(x=>x.id===id); if(!m) return;
    const roomId=state.room?.id; if(!roomId) return;
    if(canPurgeMsg(m)){
      // 방장·본인은 모두의 화면에서 숨긴다 (즉시 파기하지 않고 deleted_at 을 남긴다)
      return confirmModal('이 메시지를 지울까요?','모두의 화면에서 사라져요. 30일 뒤 완전히 파기돼요.',async()=>{
        try{ await db.collection('channels').doc(roomId).collection('messages').doc(id).update(softDeletePatch()); await refreshLastTextAfterDelete(roomId,id); }
        catch(e){ console.error(e); return toast(errText(e)); }
        renderMessages(true);
        toast('메시지를 지웠어요.');
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
        renderMessages(true);
        toast('메시지를 지웠어요.');
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
    syncRoomDraftInputs();
    const name=(d.name||'').trim();
    if(!name) return toast('방 이름을 적어 주세요.');
    const shared=d.visibility==='all';
    if(shared && d.targets==='code' && !(d.codes||[]).length) return toast('초대할 코드를 하나 이상 추가해 주세요.');
    const sid=state.profile?.schoolId||''; const ck=myClassKey();
    const data={
      name,
      description:(d.desc||'').trim(),
      type:shared?'group':'private',
      typeLabel:shared?'모둠/동아리':'개인',
      visibility:shared?'members':'private',
      joinCode:shared?randomCode(6):'',
      joinPolicy:d.joinPolicy||'approve',
      createdBy:uid(), memberIds:[uid()],
      createdAt:ts(), updatedAt:ts(), lastText:'',
      ...((sid)?{schoolId:sid,schoolName:state.profile?.schoolName||'',schoolIds:[sid]}:{}),
      ...((ck)?{classKeys:[ck]}:{})
    };
    let ref=null;
    try{ ref=await db.collection('channels').add(data); }
    catch(e){ console.error(e); return toast(errText(e)); }
    const roomId=ref.id;
    state.rooms=[{id:roomId,...data},...state.rooms];
    closeAllModals();
    renderRooms();
    if(!shared){ toast('개인 채팅방을 만들었어요.'); return openRoom(roomId); }
    // 공유 대상 처리
    const invites=[];
    if(d.targets==='friends'){
      (state.friends||[]).forEach(f=>{ if(f.uid&&f.uid!==uid()) invites.push({uid:f.uid,name:(f.profile||{}).displayName||'친구'}); });
    } else if(d.targets==='code'){
      for(const c of (d.codes||[])){
        try{ const found=await findUserByCode(c); if(found&&found.uid!==uid()) invites.push({uid:found.uid,name:(found.profile||{}).displayName||'사용자'}); }
        catch(e){ console.error('share code',e); }
      }
    }
    let sent=0;
    for(const t of invites){
      try{ await sendRoomInvite(roomId,name,t.uid,t.name); sent++; }
      catch(e){ console.error('invite',e); }
    }
    if(d.targets==='school'){
      try{
        await db.collection('shareRequests').add({roomId,roomName:name,requestedBy:uid(),requestedByName:state.profile?.displayName||'',schoolId:sid,schoolName:state.profile?.schoolName||'',status:'pending',createdAt:ts()});
        toast('관리자·선생님께 우리 학교 전체 공유를 요청했어요.');
      }catch(e){ console.error(e); toast('공유 요청을 보내지 못했어요.'); }
    } else {
      toast(sent?`공유 채팅방을 만들고 ${sent}명에게 초대를 보냈어요.`:'공유 채팅방을 만들었어요.');
    }
    await openRoom(roomId);
  }
  async function sendRoomInvite(roomId,roomName,targetUid,targetName){
    const inviteId=`${roomId}_${targetUid}`;
    await db.collection('roomInvites').doc(inviteId).set({roomId,roomName:roomName||'',targetUid,targetName:targetName||'',inviterId:uid(),inviterName:state.profile?.displayName||'',status:'pending',createdAt:ts(),updatedAt:ts()},{merge:true});
  }
  async function deleteRoom(id){
    const r=state.rooms.find(x=>x.id===id)||state.room;
    if(!r||r.createdBy!==uid()) return toast('내가 만든 채팅방만 지울 수 있어요.');
    confirmModal('이 채팅방을 지울까요?','목록에서 사라지고, 30일 뒤 기록이 완전히 파기돼요.',async()=>{
      try{ await db.collection('channels').doc(id).update({...softDeletePatch(),updatedAt:ts()}); }
      catch(e){ console.error(e); return toast(errText(e)); }
      closeAllModals();
      if(state.room?.id===id){ state.room=null; clearRoomListener(); clearChatPane(); }
      state.rooms=state.rooms.filter(x=>x.id!==id);
      renderRooms();
      toast('채팅방을 지웠어요.');
    });
  }
  async function leaveRoom(id){
    const r=state.rooms.find(x=>x.id===id)||state.room||((state.allRooms||[]).find(x=>x.id===id));
    if(!r) return;
    if(!(r.memberIds||[]).includes(uid())) return toast('이미 나와 있는 채팅방이에요.');
    const owner=r.createdBy===uid();
    confirmModal('이 채팅방에서 나갈까요?',
      owner?'내가 만든 방이에요. 나가도 방은 남고, 다시 들어올 수 있어요.':'다시 초대받으면 들어올 수 있어요.',
      async()=>{
        try{ await db.collection('channels').doc(id).update({memberIds:firebase.firestore.FieldValue.arrayRemove(uid()),updatedAt:ts()}); }
        catch(e){ console.error(e); return toast(errText(e)); }
        state.rooms=state.rooms.filter(x=>x.id!==id);
        closeAllModals();
        if(state.room?.id===id){ state.room=null; clearRoomListener(); clearChatPane(); }
        renderRooms();
        toast('채팅방에서 나왔어요.');
      });
  }
  async function leaveManyRooms(list){
    const rooms=(list||[]).filter(r=>r&&(r.memberIds||[]).includes(uid()));
    if(!rooms.length) return toast('나갈 채팅방을 먼저 골라 주세요.');
    try{
      const batch=db.batch();
      rooms.forEach(r=>batch.update(db.collection('channels').doc(r.id),{memberIds:firebase.firestore.FieldValue.arrayRemove(uid()),updatedAt:ts()}));
      await batch.commit();
    }catch(e){ console.error(e); return toast(errText(e)); }
    const ids=new Set(rooms.map(r=>r.id));
    state.rooms=state.rooms.filter(x=>!ids.has(x.id));
    if(state.room&&ids.has(state.room.id)){ state.room=null; clearRoomListener(); clearChatPane(); }
    state.cmSel=new Set();
    closeAllModals(); renderRooms();
    toast(`${rooms.length}개 채팅방에서 나왔어요.`);
  }

  function openRoomManage(id){
    const r=state.rooms.find(x=>x.id===id)||state.room||((state.allRooms||[]).find(x=>x.id===id));
    if(!r) return;
    const isOwner=r.createdBy===uid();
    const canEdit=isOwner||isAdmin();
    const isMember=(r.memberIds||[]).includes(uid());
    const muted=isRoomMuted(r.id);
    const off=!!(chatCfg().chatOffRooms||{})[r.id];
    const shared=r.visibility!=='private';
    const items=[];
    items.push(`<button class="list-item" data-action="members" data-room-id="${r.id}"><div class="grow"><div class="title">참여자 보기</div><div class="meta">지금 ${(r.memberIds||[]).length}명이 함께 있어요.</div></div><span>›</span></button>`);
    items.push(`<button class="list-item" data-action="mute-room" data-room-id="${r.id}"><div class="grow"><div class="title">${muted?'알림 켜기':'알림 끄기'}</div><div class="meta">${muted?'이 채팅방의 새 메시지 소리와 알림을 다시 받아요.':'이 채팅방만 소리와 알림을 받지 않아요.'}</div></div><span>${muted?'🔕':'🔔'}</span></button>`);
    if(canEdit) items.push(`<button class="list-item" data-action="room-icon" data-room-id="${r.id}"><div class="grow"><div class="title">채팅방 아이콘</div><div class="meta">이모지로 바꾸거나 사진으로 지정할 수 있어요.</div></div><span class="room-icon-inline">${roomIconHtml(r)}</span></button>`);
    if(canEdit&&shared) items.push(`<button class="list-item" data-action="join-policy" data-room-id="${r.id}"><div class="grow"><div class="title">코드로 들어오기</div><div class="meta">지금은 <b>${r.joinPolicy==='open'?'코드만 입력하면 바로 입장':'방장이 승인해야 입장'}</b>이에요. 눌러서 바꿔요.</div></div><span>›</span></button>`);
    if(canEdit&&r.joinCode) items.push(`<button class="list-item" data-action="copy-join-code" data-code="${esc(r.joinCode)}"><div class="grow"><div class="title">참가 코드 복사</div><div class="meta">친구에게 이 코드를 알려 주면 들어올 수 있어요.</div></div><span class="code-chip">${esc(r.joinCode)}</span></button>`);
    if(isAdmin()) items.push(`<button class="list-item" data-action="room-chat-off" data-room-id="${r.id}"><div class="grow"><div class="title" style="color:${off?'var(--blue)':'var(--danger)'}">${off?'채팅 정지 풀기':'이 방 채팅 정지'}</div><div class="meta">${off?'학생들이 다시 메시지를 보낼 수 있어요.':'학생들이 이 방에서 메시지를 보낼 수 없게 해요.'}</div></div><span>${off?'▶':'⏸'}</span></button>`);
    if(r.type==='notice'&&isAdmin()) items.push(`<button class="list-item" data-action="audience" data-room-id="${r.id}"><div class="grow"><div class="title">공지 대상 정하기</div><div class="meta">학년이나 반 전체를 선택하면 학생을 자동으로 넣어줘요.</div></div><span>›</span></button>`);
    if(canEdit) items.push(`<button class="list-item" data-action="invite" data-room-id="${r.id}"><div class="grow"><div class="title">사람 초대하기</div><div class="meta">${shared?'친구의 초대 코드를 입력해서 불러요.':'내가 초대한 사람만 들어올 수 있어요.'}</div></div><span>›</span></button>`);
    if(isAdmin()&&!isMember) items.push(`<button class="list-item" data-action="admin-join" data-room-id="${r.id}"><div class="grow"><div class="title">관리자로 참가하기</div><div class="meta">이 채팅방에 관리자 자격으로 들어가요.</div></div><span>›</span></button>`);
    if(canEdit) items.push(`<button class="list-item" data-action="delete-room" data-room-id="${r.id}"><div class="grow"><div class="title" style="color:var(--danger)">채팅방 삭제</div><div class="meta">목록에서 사라지고 기록만 남아요.</div></div></button>`);
    if(isMember&&r.type!=='notice') items.push(`<button class="list-item" data-action="leave-room" data-room-id="${r.id}"><div class="grow"><div class="title">채팅방 나가기</div><div class="meta">다시 초대받으면 들어올 수 있어요.</div></div></button>`);
    openModal(`<h2>채팅방 설정</h2><p class="desc">${esc(r.name)}</p><div class="settings-list">${items.join('')}</div><div id="joinReqHost"></div>`);
    if(canEdit&&shared) renderJoinRequests(r.id);
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
    const ICONS=['📚','🎓','🔬','🎨','🎵','⚽','🎮','💻','🌱','⭐','📌','💬','🧪','🌍','🏫','🐣'];
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
    if(state.room?.id===roomId) renderChatFrame(state.room);
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
  function openJoinByCodeModal(){
    openModal(`<h2>참가 코드로 들어가기</h2><p class="desc">공유 채팅방의 <b>참가 코드</b>를 입력하면 들어갈 수 있어요. 방장이 정한 방식에 따라 바로 들어가거나, 방장의 수락을 기다려요.</p>
      <div class="field"><label>참가 코드</label><div class="row"><input id="joinCodeInput" class="input code-input" maxlength="8" spellcheck="false" autocomplete="off" placeholder="예: K7M3QP"><button type="button" class="soft-btn" style="flex:0 0 78px" data-action="join-by-code">확인</button></div><p id="joinCodeMsg" class="reset-msg"></p></div>
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
    setTimeout(()=>$('#joinCodeInput')?.focus(),60);
  }
  async function joinByRoomCode(raw){
    const msg=$('#joinCodeMsg');
    const say=(t,cls)=>{ if(msg){ msg.textContent=t; msg.className='reset-msg'+(cls?' '+cls:''); } };
    const code=normalizeCode(raw);
    if(code.length<4) return say('참가 코드를 정확히 입력해 주세요.','warn');
    say('코드를 확인하고 있어요…');
    let snap=null;
    try{ snap=await db.collection('channels').where('joinCode','==',code).limit(1).get(); }
    catch(e){ console.error(e); return say('코드를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.','warn'); }
    if(!snap || snap.empty) return say('그 코드의 채팅방을 찾지 못했어요.','warn');
    const ch=snap.docs[0]; const r={id:ch.id,...ch.data()};
    if(r.deleted) return say('지워진 채팅방이에요.','warn');
    if((r.memberIds||[]).includes(uid())){ closeAllModals(); return openRoom(r.id); }
    if(r.joinPolicy==='open'){
      try{ await db.collection('channels').doc(r.id).update({memberIds:firebase.firestore.FieldValue.arrayUnion(uid()),updatedAt:ts()}); }
      catch(e){ console.error(e); return say('채팅방에 들어가지 못했어요.','warn'); }
      state.rooms=[r,...state.rooms];
      closeAllModals();
      toast('채팅방에 들어왔어요.');
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
    if(state.room) renderChatFrame(state.room);
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
    closeAllModals();
    toast('관리자로 참가했어요.');
    renderRooms();
    openRoom(id);
  }
  function openInvite(id){openRoomInviteModal(id);}
  async function openAudienceModal(id){
    if(!isAdmin())return;const r=state.rooms.find(x=>x.id===id);if(!r)return;
    const choices=[['all','전체 학생'],...state.school.grades.map(g=>[`g${g}`,`${g}학년 전체`]),...state.school.grades.flatMap(g=>Array.from({length:Number(state.school.classCounts?.[g]||0)},(_,i)=>[`c${g}-${i+1}`,`${g}학년 ${i+1}반`]))];
    openModal(`<h2>공지 대상을 골라 주세요</h2><p class="desc">여기에 선택한 학생만 공지방에 들어와요.</p><div class="list modal-scroll">${choices.map(([v,l])=>`<label class="list-item"><input type="radio" name="audience" value="${v}" ${v==='all'?'checked':''}><div class="grow"><div class="title">${esc(l)}</div></div></label>`).join('')}</div><div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" id="saveAudience">저장하기</button></div>`);
    const saveBtn=$('#saveAudience'); if(!saveBtn) return;
    saveBtn.onclick=async()=>{try{const v=$('[name="audience"]:checked')?.value||'all';const sid=state.profile?.schoolId||'';const snap=await (sid?db.collection('publicProfiles').where('schoolId','==',sid).limit(500):db.collection('publicProfiles').limit(500)).get();const members=[];snap.docs.forEach(d=>{const u=d.data();if(sid&&u.schoolId!==sid)return;if(u.role==='admin'||u.role==='teacher'||d.id===uid())members.push(d.id);else if(v==='all')members.push(d.id);else if(v.startsWith('g')&&Number(u.grade)===Number(v.slice(1)))members.push(d.id);else if(v.startsWith('c')){const [g,c]=v.slice(1).split('-').map(Number);if(Number(u.grade)===g&&Number(u.classNum)===c)members.push(d.id);}});await db.collection('channels').doc(id).update({visibility:'members',memberIds:[...new Set(members)],audience:v,updatedAt:ts()});closeModal();toast('공지 대상을 바꿨어요.');}catch(e){console.error(e);toast(errText(e));}};
  }

  async function openRoomInviteModal(id){
    const r=state.rooms.find(x=>x.id===id); if(!r) return;
    const inRoom=new Set(r.memberIds||[]);
    const quick=(state.friends||[]).filter(f=>!inRoom.has(f.uid));
    openModal(`<h2>사람 초대하기</h2><p class="desc">친구의 <b>초대 코드</b>를 입력하면 그 사람에게 초대가 가요. 코드는 친구가 프로필에서 확인할 수 있어요.</p>
      <div class="field"><label>초대 코드</label><div class="row" style="align-items:center"><input id="inviteCodeInput" class="input code-input" maxlength="12" autocomplete="off" spellcheck="false" placeholder="예: K7M3QP"><button type="button" class="soft-btn" style="flex:0 0 84px" data-action="invite-by-code" data-room-id="${id}">초대하기</button></div><p id="inviteCodeMsg" class="reset-msg"></p></div>
      <div class="code-row"><div class="grow"><div class="code-label">내 초대 코드</div><div class="code-value" data-my-code>${esc(state.profile?.userCode||'준비 중')}</div></div><button type="button" class="soft-btn" data-action="copy-code">복사</button></div>
      ${quick.length?`<div class="field" style="margin-top:16px"><label>친구 바로 초대 (${quick.length})</label><div class="list">${quick.map(f=>{const nm=(f.profile||{}).displayName||'친구';return `<div class="list-item"><div>${avatarHtml(f.profile)}</div><div class="grow"><div class="title">${esc(nm)}</div><div class="meta">${esc((f.profile||{}).bio||'친구')}</div></div><button class="soft-btn" style="flex:0 0 62px" data-action="invite-by-uid" data-room-id="${id}" data-uid="${esc(f.uid)}" data-name="${esc(nm)}">초대</button></div>`;}).join('')}</div></div>`:''}
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
    await createInvite(roomId,targetUid,targetName||p.displayName||'친구',p.invitePolicy||'ask');
  }
  async function inviteByCode(roomId,raw){
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
    await createInvite(roomId,found.uid,name,p.invitePolicy||'ask');
  }
  async function createInvite(id, targetUid, targetName, policy){
    const r=state.rooms.find(x=>x.id===id);if(!r)return;
    confirmModal(`${targetName}님을 초대할까요?`,policy==='auto'?'상대가 바로 들어와요.':'상대가 확인하면 들어와요.',async()=>{
      if(policy==='block'){toast('이 사용자는 초대를 받지 않도록 설정했어요.');return;}
      const inviteId=`${id}_${targetUid}`;
      await db.collection('roomInvites').doc(inviteId).set({roomId:id,roomName:r.name,targetUid,targetName,inviterId:uid(),inviterName:state.profile.displayName,status:'pending',createdAt:ts(),updatedAt:ts()},{merge:true});
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
      }
      step='초대 상태 변경';
      await ref.update({status:'accepted',handledAt:ts()});
      renderRooms();
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

  function openSettings(){
    const nt=notifySettings();
    const perm=notificationPermission();
    const permText=perm==='granted'?'허용됨':perm==='denied'?'차단됨':perm==='unsupported'?'지원 안 함':'허용 필요';
    const permCls=perm==='granted'?'on':(perm==='denied'||perm==='unsupported')?'warn':'';
    state.soundDraft=nt.soundId;
    openModal(`<h2>설정</h2><p class="desc">에듀톡을 나에게 맞게 바꿔 보세요.</p><form id="settingsForm"><div class="settings-list">
      <div class="setting-row"><div class="setting-label"><strong>화면 테마</strong><span>밝은 화면과 어두운 화면을 고를 수 있어요.</span></div><div class="choice-row">${[['light','밝게'],['dark','어둡게'],['system','시스템']].map(([v,l])=>`<button type="button" class="choice ${currentTheme()===v?'active':''}" data-theme="${v}">${l}</button>`).join('')}</div></div>
      <div class="setting-row"><div class="setting-label"><strong>글자 크기</strong><span>채팅과 메뉴에 적용돼요.</span></div><div class="choice-row">${[['sm','작게'],['md','기본'],['lg','크게'],['xl','더 크게']].map(([v,l])=>`<button type="button" class="choice ${state.settings.fontSize===v?'active':''}" data-setting-font="${v}">${l}</button>`).join('')}</div></div>
      <div class="setting-row"><div class="setting-label"><strong>새 메시지 알림음</strong><span>새 메시지가 오면 소리로 알려드려요.</span></div><label class="choice ${nt.sound?'active':''}"><input type="checkbox" name="notifySound" ${nt.sound?'checked':''} data-sound-toggle> 사용</label></div>
      <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:10px"><div class="setting-label"><strong>알림음 고르기</strong><span>눌러서 바로 들어볼 수 있어요. (10가지)</span></div><div class="sound-list">${SOUNDS.map(s=>`<button type="button" class="sound-item ${s.id===nt.soundId?'on':''}" data-sound="${s.id}"><div class="grow"><div class="title">${esc(s.name)}</div></div><span>▶</span></button>`).join('')}</div></div>
      <div class="setting-row"><div class="setting-label"><strong>기기 알림</strong><span>${DESKTOP?'창을 닫아도 새 메시지가 오면 앱 알림창으로 알려드려요.':'창을 최소화했거나 다른 채팅방을 보고 있을 때 화면 알림으로 알려드려요.'}</span></div><div class="notify-row">${DESKTOP?'':`<span class="perm-badge ${permCls}">${permText}</span>`}<label class="choice ${nt.browser?'active':''}"><input type="checkbox" name="notifyBrowser" ${nt.browser?'checked':''} data-browser-toggle> 사용</label></div></div>
      ${DESKTOP?`<div class="setting-row"><div class="setting-label"><strong>알림창 위치</strong><span>알림창이 나타날 화면 위치를 골라 주세요.</span></div><div class="choice-row">${NOTIFY_POSITIONS.map(([v,l])=>`<button type="button" class="choice" data-notify-pos="${v}">${l}</button>`).join('')}</div></div>`:''}
      <div class="setting-row"><div class="setting-label"><strong>내 초대 코드</strong><span>친구가 이 코드를 입력하면 나를 채팅방에 초대할 수 있어요.</span></div><div class="notify-row"><span class="code-chip" data-my-code>${esc(state.profile?.userCode||'준비 중')}</span><button type="button" class="soft-btn" style="flex:0 0 74px" data-action="copy-code">복사</button></div></div>
      <div class="setting-row"><div class="setting-label"><strong>채팅방 초대</strong><span>원하지 않는 초대가 자동으로 들어오는 걸 막을 수 있어요.</span></div><div class="custom-select" style="width:190px"><button type="button" class="select-button" data-select-open="invitePolicy"><span data-selected="invitePolicy" data-value="${state.settings.invitePolicy}">${state.settings.invitePolicy==='auto'?'자동으로 들어가요':state.settings.invitePolicy==='block'?'초대를 받지 않아요':'초대받으면 확인해요'}</span><span>⌄</span></button></div></div>
      <div class="setting-row"><div class="setting-label"><strong>접속 상태 표시</strong><span>친구들에게 온라인·자리비움·방해금지·오프라인을 보여줄지 정해요.</span></div><div class="custom-select" style="width:210px"><button type="button" class="select-button" data-select-open="presenceMode"><span data-selected="presenceMode" data-value="${state.settings.presenceMode||'auto'}">${presenceModeLabel(state.settings.presenceMode||'auto')}</span><span>⌄</span></button></div></div>
      <div class="setting-row"><div class="setting-label"><strong>입력 중 표시</strong><span>상대가 메시지를 쓰는 동안 말풍선으로 알려줘요. 끄면 서로 표시되지 않아요.</span></div><label class="choice ${state.settings.typingIndicator!==false?'active':''}"><input type="checkbox" name="typingIndicator" ${state.settings.typingIndicator!==false?'checked':''} data-typing-toggle> 사용</label></div>
      <div class="setting-row"><div class="setting-label"><strong>읽음 표시</strong><span>내가 보낸 메시지를 누가 읽었는지 보여줘요. 끄면 서로 표시되지 않아요.</span></div><label class="choice ${state.settings.readReceipts!==false?'active':''}"><input type="checkbox" name="readReceipts" ${state.settings.readReceipts!==false?'checked':''} data-read-toggle> 사용</label></div>
      <div class="setting-row"><div class="setting-label"><strong>차단한 사용자</strong><span>차단했던 사람을 다시 확인할 수 있어요.</span></div><button type="button" class="soft-btn" style="flex:0 0 110px" data-action="blocked-users">보기</button></div>
      <div class="setting-row"><div class="setting-label"><strong>회원 탈퇴</strong><span>계정과 내 정보를 지워요. 되돌릴 수 없어요.</span></div><button type="button" class="soft-btn" style="flex:0 0 110px;color:var(--danger)" data-action="delete-account">탈퇴하기</button></div>
    </div><div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button class="confirm">저장하기</button></div></form>`);
    $$('[data-setting-font]').forEach(b=>b.onclick=()=>{state.settings.fontSize=b.dataset.settingFont;$$('[data-setting-font]').forEach(x=>x.classList.toggle('active',x===b));applyFontSize();});
    $$('[data-theme]').forEach(b=>b.onclick=()=>{setTheme(b.dataset.theme);$$('[data-theme]').forEach(x=>x.classList.toggle('active',x===b));});
    $$('[data-sound]').forEach(b=>b.onclick=()=>{state.soundDraft=b.dataset.sound;$$('[data-sound]').forEach(x=>x.classList.toggle('on',x===b));playSound(state.soundDraft);});
    const ib=$('[data-select-open="invitePolicy"]');if(ib)wireDropdown(ib,[{value:'auto',label:'자동으로 들어가요'},{value:'ask',label:'초대받으면 확인해요'},{value:'block',label:'초대를 받지 않아요'}],(v,l)=>{ib.querySelector('[data-selected]').textContent=l;ib.querySelector('[data-selected]').dataset.value=v;});
    const pb=$('[data-select-open="presenceMode"]');if(pb)wireDropdown(pb,[{value:'auto',label:presenceModeLabel('auto'),dot:'online'},{value:'away',label:presenceModeLabel('away'),dot:'away'},{value:'dnd',label:presenceModeLabel('dnd'),dot:'dnd'},{value:'offline',label:presenceModeLabel('offline'),dot:'offline'},{value:'hidden',label:presenceModeLabel('hidden'),dot:'hidden'}],(v,l)=>{pb.querySelector('[data-selected]').textContent=l;pb.querySelector('[data-selected]').dataset.value=v;});
    const tt=$('[data-typing-toggle]'); if(tt) tt.onchange=()=>{ tt.closest('.choice')?.classList.toggle('active',tt.checked); };
    const rt=$('[data-read-toggle]'); if(rt) rt.onchange=()=>{ rt.closest('.choice')?.classList.toggle('active',rt.checked); };
    const bt=$('[data-browser-toggle]');
    if(bt) bt.onchange=async()=>{
      if(!bt.checked){ bt.closest('.choice')?.classList.remove('active'); return; }
      // 데스크톱 앱은 브라우저 권한이 필요 없어요 (앱 자체 알림창을 씁니다)
      if(DESKTOP){ bt.closest('.choice')?.classList.add('active'); return; }
      if(notificationPermission()==='granted'){ bt.closest('.choice')?.classList.add('active'); return; }
      if(notificationPermission()==='unsupported'){ bt.checked=false; bt.closest('.choice')?.classList.remove('active'); return toast('이 브라우저는 기기 알림을 지원하지 않아요.'); }
      try{
        const r=await Notification.requestPermission();
        if(r==='granted'){ bt.closest('.choice')?.classList.add('active'); toast('기기 알림을 켰어요.'); }
        else { bt.checked=false; bt.closest('.choice')?.classList.remove('active'); toast('브라우저에서 알림이 차단되어 있어요. 주소창 옆 자물쇠에서 허용으로 바꿔 주세요.'); }
      }catch(e){ bt.checked=false; bt.closest('.choice')?.classList.remove('active'); }
      const badge=bt.closest('.setting-row')?.querySelector('.perm-badge');
      if(badge){ const p=notificationPermission(); badge.textContent=p==='granted'?'허용됨':p==='denied'?'차단됨':'허용 필요'; badge.className='perm-badge '+(p==='granted'?'on':(p==='denied'?'warn':'')); }
    };
    if(DESKTOP && window.edutalkDesktop?.getNotificationPosition){
      const markPos=(v)=>$$('[data-notify-pos]').forEach(b=>b.classList.toggle('active',b.dataset.notifyPos===v));
      window.edutalkDesktop.getNotificationPosition().then(markPos).catch(()=>{});
      $$('[data-notify-pos]').forEach(b=>b.onclick=()=>{
        const v=b.dataset.notifyPos;
        markPos(v);
        try{ window.edutalkDesktop.setNotificationPosition(v); }catch(e){}
        // 고른 위치에 미리보기 알림창을 띄워 준다
        try{ window.edutalkDesktop.notify({ title:'알림 미리보기', body:'이 위치에 새 메시지 알림창이 나타나요.', roomId:'' }); }catch(e){}
      });
    }
  }
  function presenceModeLabel(m){
    return m==='away'?'항상 자리비움':m==='dnd'?'방해금지':m==='offline'?'항상 오프라인':m==='hidden'?'표시 안 함':'자동 (창 상태에 따라)';
  }
  // ---- 회원 탈퇴 ----
  function openDeleteAccountModal(){
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
    state.settings.typingIndicator=typingOn;
    state.settings.readReceipts=readOn;
    const nt={sound:!!f.notifySound?.checked,soundId:state.soundDraft||notifySettings().soundId,browser:!!f.notifyBrowser?.checked};
    if(DESKTOP) nt.desktopNotify=!!f.notifyBrowser?.checked;
    state.settings.notify=nt;
    const s={...(state.profile?.settings||{}),fontSize:state.settings.fontSize,theme:state.settings.theme||currentTheme(),roomGroups:state.settings.roomGroups||{},groupOrder:(state.groupNames||[]).slice(),mutedRooms:state.settings.mutedRooms||[],presenceMode:pm,notify:nt,typingIndicator:typingOn,readReceipts:readOn};
    try{await db.collection('users').doc(uid()).update({invitePolicy:p,settings:s,updatedAt:ts()});}catch(e){console.error(e);return toast(errText(e));}
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
    closeModal();renderSidebar();attachInviteListener();
    renderTypingIndicator(); if($('#messages')) renderMessages(false);
    toast('설정을 저장했어요.');
  }
  function openBlockedUsers(){openModal(`<h2>차단한 사용자</h2><p class="desc">차단을 풀어도 차단했던 동안 받은 메시지는 다시 보이지 않아요.</p><div class="list">${(state.profile.blockedUsers||[]).map(id=>`<div class="list-item" data-uid="${id}"><div class="grow"><div class="title">${esc(state.profileCache.get(id)?.displayName||'사용자')}</div></div><button class="soft-btn" style="flex:0 0 90px" data-action="block" data-uid="${id}" data-name="${esc(state.profileCache.get(id)?.displayName||'사용자')}">해제</button></div>`).join('')||'<div class="empty-side">차단한 사용자가 없어요.</div>'}</div>`);}
  // ---------- 채팅 관리 (사이드바 아래 버튼) ----------
  function openChatManager(){
    state.cmSel=new Set();
    openModal(`<h2>채팅 관리</h2><p class="desc">채팅방 목록과 알림을 한 곳에서 관리해요. 여러 채팅방을 골라 한 번에 나갈 수도 있어요.</p>
      <div class="settings-list">
        <button class="list-item" data-action="chat-groups"><div class="grow"><div class="title">목록 탭 관리</div><div class="meta">탭을 만들고 이름을 바꿔요. 탭은 꾹 눌러 순서를 바꿀 수 있어요.</div></div><span>›</span></button>
        <button class="list-item" data-action="room-join-code"><div class="grow"><div class="title">참가 코드로 들어가기</div><div class="meta">공유 채팅방의 코드를 입력해 들어가요.</div></div><span>🔑</span></button>
        <button class="list-item" data-action="my-share-requests"><div class="grow"><div class="title">학교 전체 공유 요청</div><div class="meta">승인을 기다리는 요청을 확인하고 취소할 수 있어요.</div></div><span>🏫</span></button>
      </div>
      <div class="field" style="margin-top:16px"><label>내 채팅방</label>
        <div class="row" style="margin-bottom:8px"><button type="button" class="soft-btn" data-action="cm-select-all">전체 선택</button><button type="button" class="soft-btn" data-action="cm-select-none">선택 해제</button><button type="button" class="danger-btn" style="flex:1;height:42px;border-radius:13px;font-size:14px;font-weight:650" data-action="leave-selected">선택한 채팅방 나가기</button></div>
        <div id="chatManagerRooms" class="list"></div>
      </div>
      <div class="modal-actions"><button class="cancel" data-close-modal>닫기</button></div>`);
    renderChatManagerRooms();
  }
  function renderChatManagerRooms(){
    const host=$('#chatManagerRooms'); if(!host) return;
    const rooms=state.rooms||[];
    if(!(state.cmSel instanceof Set)) state.cmSel=new Set();
    host.innerHTML=rooms.map(r=>{
      const muted=isRoomMuted(r.id);
      return `<div class="list-item"><label class="cm-check"><input type="checkbox" data-cm-pick="${r.id}" ${state.cmSel.has(r.id)?'checked':''}></label><div class="grow"><div class="title"><span class="room-icon-inline">${roomIconHtml(r)}</span> ${esc(r.name||'채팅방')}${isRoomPinned(r.id)?' <span class="admin-chip">고정</span>':''}</div><div class="meta">${(r.memberIds||[]).length}명${r.createdBy===uid()?' · 내가 만든 방':''}${muted?' · 알림 꺼짐':''}</div></div><button type="button" class="soft-btn" style="flex:0 0 44px" data-action="room-pin" data-room-id="${r.id}" title="상단 고정">${isRoomPinned(r.id)?'📌':'📍'}</button><button type="button" class="soft-btn" style="flex:0 0 84px" data-action="mute-room" data-room-id="${r.id}">${muted?'알림 켜기':'알림 끄기'}</button></div>`;
    }).join('')||'<div class="empty-side">채팅방이 없어요.</div>';
  }
  function openGroupManager(){
    state.groupDraft=groupOrderList().map(n=>({orig:n,name:n}));
    openModal(`<h2>목록 탭 관리</h2><p class="desc">탭 이름을 바꾸거나 새 탭을 만들 수 있어요. 채팅방은 목록에서 <b>꾹 눌러 끌어서</b> 옮겨요.</p>
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
    if(state.adminTab==='cross')return renderCrossAdmin(p);
    if(state.adminTab==='rooms')return renderRoomsAdmin(p);
  }
  function richToolbarHtml(id){
    return `<div class="rich-toolbar" data-rich-toolbar="${id}"><button type="button" class="re-btn" data-cmd="bold" title="굵게"><b>B</b></button><button type="button" class="re-btn" data-cmd="italic" title="기울임"><i>I</i></button><button type="button" class="re-btn" data-cmd="underline" title="밑줄"><u>U</u></button><button type="button" class="re-btn" data-cmd="strikeThrough" title="취소선"><s>S</s></button><label class="re-color" title="글자색"><input type="color" value="#3F9BFF" data-cmd-color="1"></label><button type="button" class="re-btn" data-cmd="createLink" title="링크">🔗</button><button type="button" class="re-btn" data-cmd="removeFormat" title="서식 지우기">⌫</button></div>`;
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
    p.innerHTML=`<form id="siteNoticeForm">
      <div class="admin-card"><h3>상단 배너</h3><p class="desc">앱 화면 맨 위에 항상 보이는 공지예요. 로그인한 모든 사용자에게 보여요.</p>
        <div class="setting-row"><div class="setting-label"><strong>표시</strong><span>끄면 즉시 사라져요.</span></div><label class="choice ${b.enabled?'active':''}"><input type="checkbox" name="bannerEnabled" ${b.enabled?'checked':''}> 사용</label></div>
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
        <div class="setting-row"><div class="setting-label"><strong>표시</strong><span>켜면 다음 로그인부터 보여요.</span></div><label class="choice ${n.enabled?'active':''}"><input type="checkbox" name="popupEnabled" ${n.enabled?'checked':''}> 사용</label></div>
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
      <button type="button" class="primary" data-action="save-site-notice">사이트 공지 저장하기</button>
    </form>`;
    wireRichEditors();
    const form=$('#siteNoticeForm');
    form?.addEventListener('input',()=>updateNoticePreview());
    updateNoticePreview();
  }
  // ---- 안내 페이지 (로그인 화면의 개인정보 처리방침 · 문의하기 · 학교 등록) ----
  function rawAuthPages(){
    return (Array.isArray(state.sitePages)&&state.sitePages.length) ? state.sitePages : DEFAULT_AUTH_PAGES;
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
      <div class="admin-card"><h3>로그인 화면 안내 페이지</h3>
        <p class="desc">로그인 화면 아래 링크를 누르면 열리는 페이지예요. 표시를 끄면 링크도 사라져요.</p>
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
              <input class="input" data-page-btn-label="${i}:${bi}" maxlength="24" placeholder="버튼 글자" value="${esc(b.label||'')}">
              <input class="input" data-page-btn-url="${i}:${bi}" placeholder="https://... 또는 mailto:... (비우면 안내만)" value="${esc(b.url||'')}">
              <button type="button" class="soft-btn" style="flex:0 0 66px" data-action="pages-btn-remove" data-idx="${i}" data-bi="${bi}">삭제</button>
            </div>`).join('')}
            ${pg.buttons.length<6?`<button type="button" class="soft-btn" data-action="pages-btn-add" data-idx="${i}">+ 버튼 추가</button>`:''}
          </div>
        </div>`).join('')}
        ${list.length<8?`<button type="button" class="soft-btn" data-action="pages-add">+ 새 페이지 추가</button>`:''}
      </div>
      <button type="button" class="primary" data-action="save-pages">안내 페이지 저장하기</button>
    </form>`;
    wireRichEditors(list.map((_,i)=>'pageEditor'+i));
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
        intervalSec: gv('mockInterval'),
        chatStyle: gv('mockStyle'),
        presets: L.mock.presets.map((p,pi)=>({
          name: gv(`presetName:${pi}`),
          messages: p.messages.map((_,mi)=>({ side:gv(`msgSide:${pi}:${mi}`), avatar:gv(`msgAvatar:${pi}:${mi}`), text:gv(`msgText:${pi}:${mi}`) }))
        }))
      },
      stepsTitle: gv('stepsTitle'), stepsDesc: gv('stepsDesc'),
      steps: L.steps.map((_,i)=>({ title:gv(`stepTitle:${i}`), desc:gv(`stepDesc:${i}`) })),
      ctaTitle: gv('ctaTitle'), ctaDesc: gv('ctaDesc'), ctaButton: gv('ctaButton'), footerText: gv('footerText')
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
        <div class="setting-row"><div class="setting-label"><strong>소개 페이지 사용</strong><span>위쪽 메뉴와 오른쪽 위 로그인 버튼이 스크롤해도 계속 보여요.</span></div><label class="choice ${L.enabled?'active':''}"><input type="checkbox" data-landing="enabled" ${L.enabled?'checked':''}> 사용</label></div>
        <div class="admin-grid">
          <div class="field"><label>로고 글자 (1~2자)</label><input class="input" data-landing="brandMark" maxlength="2" value="${esc(L.brandMark||'E')}" placeholder="E"></div>
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
        <div class="setting-row"><div class="setting-label"><strong>채팅창 표시</strong><span>끄면 채팅창 없이 소개 문구만 보여요.</span></div><label class="choice ${L.mock.enabled?'active':''}"><input type="checkbox" data-landing="mockEnabled" ${L.mock.enabled?'checked':''}> 사용</label></div>
        <div class="admin-grid">
          <div class="field"><label>방 이름</label><input class="input" data-landing="mockTitle" maxlength="24" value="${esc(L.mock.title)}"></div>
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
    try{ await db.collection('siteNotices').doc('main').set({banner,popup,updatedAt:ts(),updatedBy:uid()},{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    state.siteNotice={banner:{...DEFAULT_SITE_NOTICE.banner,...banner},popup:{...DEFAULT_SITE_NOTICE.popup,...popup}};
    renderSiteBanner();
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
    try{ const cs=await db.collection('schoolCodes').limit(300).get(); state.schoolCodes=Object.fromEntries(cs.docs.map(d=>[d.id,d.data().code||''])); }
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
    confirmModal('가입 코드를 새로 만들까요?','기존 코드는 즉시 사용할 수 없게 되고, 학생들은 새 코드로만 가입할 수 있어요.',async()=>{
      const code=makeSchoolCode();
      try{ await db.collection('schoolCodes').doc(sid).set({code,updatedAt:ts(),updatedBy:uid()},{merge:true}); }
      catch(e){ console.error(e); return toast(errText(e)); }
      state.schoolCodes={...(state.schoolCodes||{}),[sid]:code};
      state.schoolEdit={...(state.schoolEdit||{}),code};
      const badge=$('#schoolCodeValue'); if(badge) badge.textContent=code;
      toast(`새 코드: ${code}`);
      renderMySchools();
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
        <div class="setting-row"><div class="setting-label"><strong>가입 코드</strong><span>학생에게 이 코드를 알려 주세요. 코드가 있어야 가입할 수 있어요.</span></div><div style="display:flex;gap:8px;align-items:center"><b id="schoolCodeValue" style="font-size:18px;letter-spacing:2px">${esc(ed.code||'없음')}</b><button type="button" class="soft-btn" style="flex:0 0 72px" data-action="regen-school-code" data-sid="${esc(ed.id)}">재발급</button></div></div>
        <div class="field" style="margin-top:14px"><label>학년</label><div class="check-grid" id="schoolGradeChips">${Array.from({length:6},(_,i)=>i+1).map(g=>`<button type="button" class="check-chip ${grades.includes(g)?'on':''}" data-school-grade="${g}">${g}학년</button>`).join('')}</div></div>
        <div class="admin-grid" id="schoolCounts"></div>
        <div class="setting-row" style="margin-top:8px"><div class="setting-label"><strong>사용</strong><span>끄면 이 학교로 새로 가입할 수 없어요.</span></div><label class="choice ${s.active!==false?'active':''}"><input type="checkbox" name="schoolActive" ${s.active!==false?'checked':''}> 사용</label></div>
        <div class="modal-actions"><button type="button" class="cancel" data-close-modal>닫기</button><button class="confirm">저장하기</button></div>
      </form>
      <div class="divider"></div>
      <div class="admin-toolbar" style="margin:0"><button type="button" class="soft-btn" data-action="link-school-data" data-sid="${esc(ed.id)}">기존 계정·채팅방 연결</button><button type="button" class="soft-btn" data-action="delete-school" data-sid="${esc(ed.id)}">학교 삭제</button></div>`);
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
    try{ await db.collection('schools').doc(sid).update({grades,classCounts,active,updatedAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    state.schoolList=null;
    if(state.profile?.schoolId===sid){ state.school={grades,classCounts}; state.schoolInfo={...(state.schoolInfo||{}),id:sid,grades,classCounts}; }
    closeModal(); toast('학교 설정을 저장했어요.'); renderAdminPanel('school');
  }
  async function deleteSchool(sid){
    if(!sid) return;
    confirmModal('이 학교를 삭제할까요?','학생들이 더 이상 이 학교로 가입할 수 없어요. 이미 가입한 계정은 그대로 남아요.',async()=>{
      try{ await db.collection('schools').doc(sid).delete(); }catch(e){ console.error(e); }
      try{ await db.collection('schoolCodes').doc(sid).delete(); }catch(e){ console.error(e); }
      state.schoolList=null; closeAllModals(); toast('학교를 삭제했어요.'); renderAdminPanel('school');
    });
  }
  async function linkSchoolData(sid){
    if(!sid) return;
    const s=(state.schoolList||[]).find(x=>x.id===sid)||state.schoolEdit?.data||{};
    const name=s.name||'';
    confirmModal('기존 계정·채팅방을 이 학교로 연결할까요?','학교 정보가 없던 계정·프로필·채팅방에 이 학교를 붙여요. 되돌릴 수 없어요.',async()=>{
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
        <div class="setting-row"><div class="setting-label"><strong>전체 채팅 정지</strong><span>${c.chatOffAll?'지금 모든 채팅방에서 학생이 메시지를 보낼 수 없어요.':'학생들이 모든 채팅방에서 자유롭게 대화할 수 있어요.'}</span></div><button type="button" class="soft-btn" style="flex:0 0 110px" data-action="chat-off-all">${c.chatOffAll?'정지 풀기':'전체 정지'}</button></div>
        <div class="setting-row"><div class="setting-label"><strong>채팅방 하나만 정지</strong><span>'채팅방' 탭에서 방을 열고 <b>채팅방 설정 → 이 방 채팅 정지</b>를 누르면 돼요.</span></div></div>
      </div>
      <div class="admin-card" style="margin-top:14px"><h3>전체 타임아웃</h3><p class="desc">정한 시간 동안 모든 학생이 메시지를 보낼 수 없어요. 채팅창에 남은 시간이 표시돼요.</p>
        ${allTo?`<div class="form-error" style="margin:0 0 10px">지금 전체 타임아웃 중이에요 · 남은 시간 ${esc(fmtDurationLeft(c.timeoutAllUntil))}${c.timeoutAllReason?` · 사유: ${esc(c.timeoutAllReason)}`:''}</div>`:''}
        <div class="field"><label>기간</label><div class="custom-select"><button type="button" class="select-button" data-select-open="allTimeout"><span data-selected="allTimeout" data-value="600">10분</span><span>⌄</span></button></div></div>
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
        <div class="field"><label>경고 누적 타임아웃 시간</label><div class="custom-select"><button type="button" class="select-button" data-select-open="warnTimeout"><span data-selected="warnTimeout" data-value="${warnTimeoutMin()*60}">${esc(fmtMinLabel(warnTimeoutMin()))}</span><span>⌄</span></button></div><p class="desc" style="margin:7px 0 0;font-size:12px">한도까지 쌓인 학생은 이 시간 동안 메시지를 보낼 수 없어요. (이용 정지와는 달라요)</p></div>
        <div class="modal-actions" style="margin-top:6px"><button type="button" class="confirm" style="flex:1" data-action="save-chat-words">금지어 저장</button></div>
      </div>
      <div class="admin-card" style="margin-top:14px"><h3>모두에게 상단 고정</h3><p class="desc">고정한 채팅방은 모든 사용자의 목록 맨 위에 나타나요. (사용자가 직접 고정한 방보다 더 위)</p><div id="pinRoomList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>
      <p class="desc" style="margin-top:14px">학생 한 명만 멈추려면 <b>사용자</b> 탭에서 그 학생을 찾아 <b>타임아웃</b>을 눌러 주세요.</p>`;
    const sel=$('[data-select-open="allTimeout"]');
    if(sel) wireDropdown(sel,[{value:60,label:'1분'},{value:300,label:'5분'},{value:600,label:'10분'},{value:1800,label:'30분'},{value:3600,label:'1시간'},{value:10800,label:'3시간'},{value:86400,label:'하루'},{value:604800,label:'일주일'}],(v,l)=>{sel.querySelector('[data-selected]').textContent=l;sel.querySelector('[data-selected]').dataset.value=String(v);});
    const wsel=$('[data-select-open="warnTimeout"]');
    if(wsel) wireDropdown(wsel,WARN_TIMEOUT_OPTIONS,(v,l)=>{wsel.querySelector('[data-selected]').textContent=l;wsel.querySelector('[data-selected]').dataset.value=String(v);});
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
      return `<div class="list-item"><div class="grow"><div class="title">${esc(r.name||'채팅방')}</div><div class="meta">${(r.memberIds||[]).length}명 · ${r.visibility==='all'?'공유':r.visibility==='private'?'개인':'대상 지정'}</div></div><button class="soft-btn" style="flex:0 0 76px" data-action="admin-pin-room" data-room-id="${r.id}">${on?'고정 해제':'위로 고정'}</button></div>`;
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
    const toMin=Math.min(1440,Math.max(5,Math.round((Number($('[data-selected="warnTimeout"]')?.dataset.value)||1800)/60)));
    try{ await db.collection('chatSettings').doc('main').set({blockWords,allowWords,warnWords,flagWords,warnLimit:lim,warnTimeoutMin:toMin,updatedAt:ts()},{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast('금지어를 저장했어요.');
    renderChatAdmin($('#adminPanel'));
  }
  async function applyTimeoutAll(){
    if(!isAdmin()) return;
    const sel=$('[data-selected="allTimeout"]');
    const min=Math.max(1,Math.round(Number(sel?.dataset.value||600)/60));
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
  function openTimeoutModal(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    if(targetUid===uid()) return toast('자기 자신에게는 줄 수 없어요.');
    openModal(`<h2>채팅 타임아웃</h2><p class="desc">${esc(targetName||'사용자')}님이 정한 시간 동안 메시지를 보낼 수 없어요. (이용 정지와는 달라요)</p>
      <div class="field"><label>기간</label><div class="custom-select"><button type="button" class="select-button" data-select-open="toDuration"><span data-selected="toDuration" data-value="1800">30분</span><span>⌄</span></button></div></div>
      <div class="field"><label>사유 (선택)</label><input id="toReason" class="input" maxlength="80" placeholder="예: 같은 말을 반복해서 도배했어요."></div>
      <label class="choice" style="margin-bottom:4px"><input type="checkbox" id="toPermanent"> 내가 풀어 줄 때까지 계속</label>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button><button class="confirm" data-action="timeout-apply" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}">타임아웃 주기</button></div>
      <button type="button" class="soft-btn" style="width:100%;margin-top:8px" data-action="timeout-clear" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}">타임아웃 풀기</button>`);
    const sel=$('[data-select-open="toDuration"]');
    if(sel) wireDropdown(sel,[{value:300,label:'5분'},{value:600,label:'10분'},{value:1800,label:'30분'},{value:3600,label:'1시간'},{value:10800,label:'3시간'},{value:86400,label:'하루'},{value:604800,label:'일주일'}],(v,l)=>{sel.querySelector('[data-selected]').textContent=l;sel.querySelector('[data-selected]').dataset.value=String(v);});
  }
  async function applyTimeout(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    const perm=!!$('#toPermanent')?.checked;
    const ms=Math.max(60,Number($('[data-selected="toDuration"]')?.dataset.value||1800))*1000;
    const reason=($('#toReason')?.value||'').trim();
    const data={reason,permanent:perm,until:perm?null:(Date.now()+ms),by:uid(),byName:state.profile?.displayName||'',updatedAt:ts()};
    try{ await db.collection('chatTimeouts').doc(targetUid).set(data,{merge:true}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    closeAllModals();
    if(state.view==='admin') renderAdminPanel(state.adminTab);
    toast(perm?`${targetName||'사용자'}님을 해제할 때까지 타임아웃했어요.`:`${targetName||'사용자'}님에게 타임아웃을 줬어요.`);
  }
  async function clearTimeoutUser(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    try{ await db.collection('chatTimeouts').doc(targetUid).delete(); }
    catch(e){ console.error(e); return toast(errText(e)); }
    closeAllModals();
    if(state.view==='admin') renderAdminPanel(state.adminTab);
    toast(`${targetName||'사용자'}님의 타임아웃을 풀었어요.`);
  }
  async function resetWarns(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    try{ await db.collection('users').doc(targetUid).update({warnCount:0,updatedAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    closeAllModals();
    if(state.view==='admin') renderAdminPanel(state.adminTab);
    toast(`${targetName||'사용자'}님의 경고를 지웠어요.`);
  }

  function reattachAll(){
    state.listeners.forEach(fn=>{try{fn()}catch{}}); state.listeners=[];
    clearRoomListener(); clearInviteListener(); clearSiteNoticeListener(); clearChatLockListeners(); clearModerationListeners();
    if(noticeUnsub){try{noticeUnsub()}catch{} noticeUnsub=null;}
    state.profileUnsubs.forEach(fn=>{try{fn()}catch{}}); state.profileUnsubs=[]; state.profileListeningKey='';
    attachRoomListeners(); attachInviteListener(); attachNoticeListener(); attachSiteNoticeListener(); attachChatLockListeners(); attachModerationListeners();
    watchSuspension();   // 목록을 다시 붙일 때 정지 감시가 빠지지 않게 다시 건다
  }
  // ---------- 관리자 · 오검열 이의 신청 (검열된 메시지 복구) ----------
  async function renderModAppeals(p){
    if(!p) return;
    if(!(isAdmin() || state.profile?.role==='teacher')) return;
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
        <div class="admin-btns">
          <button type="button" class="soft-btn" data-action="mod-approve" data-id="${esc(x.id)}">복구(승인)</button>
          <button type="button" class="soft-btn" data-action="mod-reject" data-id="${esc(x.id)}">거부</button>
        </div>
      </div></div>`).join('')||'<div class="empty-side">새로 들어온 이의 신청이 없어요.</div>';
  }
  async function resolveModAppeal(appealId,approve){
    if(!(isAdmin() || state.profile?.role==='teacher') || !appealId) return;
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
        // 담당 교사는 자기가 만든 채팅방의 신고만 볼 수 있어요
        const snap=await db.collection('reports').where('roomOwnerId','==',uid()).limit(200).get();
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
    confirmModal(`${targetName||'사용자'}님에게 경고를 줄까요?`,'경고가 쌓이면 채팅을 보낼 수 없게 돼요.',async()=>{
      try{
        const ref=db.collection('users').doc(targetUid);
        const cur=Number((await ref.get()).data()?.warnCount||0);
        await ref.update({warnCount:cur+1,warnUpdatedAt:ts()});
        await markReportResolved(id);
      }catch(e){ console.error(e); return toast(errText(e)); }
      closeAllModals(); toast('경고를 주고 처리 완료로 바꿨어요.'); renderAdminPanel('reports');
    });
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
    p.innerHTML=`<div class="admin-card"><h3>채팅방</h3><p class="desc">내가 만들었거나 우리 학교 전체에 공유된 채팅방이에요. 개인·모둠 대화는 볼 수 없어요.</p><div class="list">${rows.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(r.name||'채팅방')}</div><div class="meta">${(r.memberIds||[]).length}명 · ${r.type==='notice'?'공지':r.type==='private'?'개인':'모둠/동아리'}</div></div><button class="soft-btn" style="flex:0 0 76px" data-action="open-admin-room" data-room-id="${r.id}">열기</button></div>`).join('')||'<div class="empty-side">채팅방이 없어요.</div>'}</div></div>`;
  }
  async function renderUsersAdmin(p){
    if(!isAdmin())return;
    p.innerHTML=`<div class="admin-card"><h3>사용자</h3><p class="desc">마지막 로그인 시각과 IP를 확인할 수 있어요. 이름을 누르면 프로필이 열려요.</p><div class="admin-toolbar"><input id="userSearch" class="input" placeholder="이름, 학년/반, 이메일로 찾기"><button type="button" class="soft-btn" style="flex:0 0 96px" data-action="refresh-admin-users">새로고침</button></div><div id="userList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>`;
    const users=await loadAdminUsers();
    const render=q=>{
      const host=$('#userList'); if(!host) return;
      const list=users.filter(u=>matchUser(u,q));
      host.innerHTML=list.slice(0,300).map(u=>`<div class="list-item"><div class="grow" style="display:flex;align-items:center;gap:10px;cursor:pointer" data-action="user-profile" data-uid="${u.id}" data-name="${esc(u.displayName||'사용자')}"><div>${avatarHtml(u)}</div><div class="grow" style="min-width:0"><div class="title">${esc(u.displayName||'사용자')}${Number(u.warnCount||0)>0?` <span class="timeout-chip">경고 ${Number(u.warnCount)}</span>`:''}</div><div class="meta">${gradeClassPrefix(u)}${roleLabel(u.role)}${u.email?` · ${esc(u.email)}`:''}</div><div class="admin-meta"><span class="admin-chip">로그인 ${Number(u.loginCount||0)}회</span><span class="admin-chip">IP ${esc(u.lastLoginIp||'기록 없음')}</span><span class="admin-chip">${esc(fmtDateTime(u.lastLoginAt))}</span></div></div></div><button class="soft-btn" style="flex:0 0 84px" data-action="timeout-user" data-uid="${u.id}" data-name="${esc(u.displayName||'사용자')}">타임아웃</button></div>`).join('')||'<div class="empty-side">사용자가 없어요.</div>';
    };
    render('');
    $('#userSearch')?.addEventListener('input',e=>render(e.target.value));
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
    if(!isAdmin()) return;
    p.innerHTML=`<div class="admin-card"><h3>학교 간 채팅 요청</h3><p class="desc">다른 학교 학생과 채팅하고 싶다는 요청이에요. 승인하면 두 사람이 서로 초대할 수 있어요.</p><div id="crossList" class="list"><div class="empty-side">불러오는 중이에요.</div></div></div>`;
    let rows=[];
    try{ const s=await db.collection('crossRequests').where('status','==','pending').limit(100).get(); rows=s.docs.map(d=>({id:d.id,...d.data()})); }
    catch(e){ console.error(e); const h=$('#crossList'); if(h) h.innerHTML='<div class="empty-side">불러오지 못했어요.</div>'; return; }
    const host=$('#crossList'); if(!host) return;
    host.innerHTML=rows.map(r=>`<div class="list-item"><div class="grow"><div class="title">${esc(r.fromName||'학생')} · ${esc(r.fromSchoolName||'다른 학교')}</div><div class="meta">→ ${esc(r.toName||'학생')} · ${esc(r.toSchoolName||'우리 학교')} · ${esc(fmtDateTime(r.createdAt))}</div></div><button class="soft-btn" style="flex:0 0 52px" data-action="cross-approve" data-id="${esc(r.id)}">승인</button><button class="soft-btn" style="flex:0 0 52px" data-action="cross-reject" data-id="${esc(r.id)}">거절</button></div>`).join('')||'<div class="empty-side">대기 중인 요청이 없어요.</div>';
  }
  async function handleCross(id,ok){
    if(!isAdmin()||!id) return;
    try{ await db.collection('crossRequests').doc(id).update({status:ok?'approved':'rejected',handledBy:uid(),handledAt:ts()}); }
    catch(e){ console.error(e); return toast(errText(e)); }
    toast(ok?'승인했어요. 이제 서로 초대할 수 있어요.':'요청을 거절했어요.');
    renderCrossAdmin($('#adminPanel'));
  }

  // ---------- 관리자: 사용자 학교 변경 ----------
  async function openUserSchoolPicker(targetUid,targetName){
    if(!isAdmin()||!targetUid) return;
    let list=[];
    try{ list=await loadSchoolList(); }catch(e){ console.error(e); }
    openModal(`<h2>학교 변경</h2><p class="desc">${esc(targetName||'사용자')}님의 학교를 골라 주세요. 바꾸면 그 학교 사람에게만 보여요.</p>
      <div class="list modal-scroll">${(list||[]).map(s=>`<button class="list-item" data-action="admin-set-school-apply" data-uid="${esc(targetUid)}" data-name="${esc(targetName||'')}" data-sid="${esc(s.id)}"><div class="grow"><div class="title">${esc(s.name)}</div><div class="meta">${esc([s.atpt,s.kind].filter(Boolean).join(' · '))}</div></div><span>›</span></button>`).join('')||'<div class="empty-side">등록된 학교가 없어요. 먼저 학교를 등록해 주세요.</div>'}</div>
      <div class="modal-actions"><button class="cancel" data-close-modal>취소</button></div>`);
  }
  async function applyUserSchool(targetUid,targetName,sid){
    if(!isAdmin()||!targetUid||!sid) return;
    const s=(state.schoolList||[]).find(x=>x.id===sid)||{name:''};
    confirmModal(`${targetName||'사용자'}님의 학교를 바꿀까요?`,`'${s.name||sid}'(으)로 바꿔요. 이전 학교의 채팅방은 목록에서 사라져요.`,async()=>{
      await db.collection('users').doc(targetUid).update({schoolId:sid,schoolName:s.name||'',updatedAt:ts()});
      try{ await db.collection('publicProfiles').doc(targetUid).set({schoolId:sid,schoolName:s.name||'',updatedAt:ts()},{merge:true}); }catch(e){ console.error(e); }
      state.profileCache.delete(targetUid);
      state.adminUsers=null;
      closeAllModals();
      if(state.view==='admin') renderAdminPanel(state.adminTab);
      toast('학교를 바꿨어요.');
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
    confirmModal(`${targetName||'사용자'}님의 이용을 정지할까요?`,'그 사람은 로그인해도 채팅을 할 수 없어요.',async()=>{
      await db.collection('users').doc(targetUid).update({suspended:true,suspendReason:reason,suspendedAt:ts(),suspendedBy:uid(),updatedAt:ts()});
      state.profileCache.delete(targetUid); state.adminUsers=null;
      closeAllModals();
      if(state.view==='admin') renderAdminPanel(state.adminTab);
      toast('이용을 정지했어요.');
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
  // ---------- 신고 (신고 시점의 대화 30개를 함께 보관) ----------
  const REPORT_REASONS = [
    { value:'violence', label:'학교폭력 / 언어폭력' },
    { value:'cheat',    label:'부정행위 / 시험지 유출' },
    { value:'etc',      label:'기타' }
  ];
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
        <div class="modal-actions"><button type="button" class="cancel" data-close-modal>취소</button><button class="confirm">신고하기</button></div>
      </form>`);
    const b=$('[data-select-open="reason"]');
    wireDropdown(b,REPORT_REASONS.map(x=>({value:x.value,label:x.label})),(v,l)=>{b.querySelector('[data-selected]').textContent=l;b.querySelector('[data-selected]').dataset.value=v;});
  }
  async function submitReport(f){
    const reason=f.querySelector('[data-selected="reason"]')?.dataset.value||'';
    if(!reason) return toast('신고 사유를 골라 주세요.');
    const roomId=f.roomId.value||'';
    const msgId=f.messageId.value||'';
    const room=(state.rooms||[]).find(r=>r.id===roomId)||(state.room?.id===roomId?state.room:null);
    try{
      await db.collection('reports').add({
        reporterId:uid(), reporterName:state.profile?.displayName||'',
        targetUid:f.targetUid.value||'', targetName:f.targetName?.value||'',
        roomId, roomName:room?.name||'', roomOwnerId:room?.createdBy||'',
        messageId:msgId||null,
        reason, reasonLabel:(REPORT_REASONS.find(x=>x.value===reason)||{}).label||'기타',
        detail:String(f.detail?.value||'').trim().slice(0,600),
        snapshot:reportSnapshot(msgId),
        status:'open', createdAt:ts(), expire_at:expireTs(365)
      });
    }catch(e){ console.error(e); return toast(errText(e)); }
    closeModal(); toast('신고를 접수했어요. 담당 선생님과 관리자가 확인해요.');
  }
  async function resolveReport(id){if(!isAdmin() && state.profile?.role!=='teacher')return;try{await db.collection('reports').doc(id).update({status:'resolved',resolvedAt:ts(),resolvedBy:uid()});}catch(e){console.error(e);return toast(errText(e));}closeAllModals();toast('처리 완료로 바꿨어요.');state.reports=state.reports.map(x=>x.id===id?{...x,status:'resolved'}:x);renderAdminPanel('reports');}

  function openDrawer(){const d=$('#drawer'),p=$('#drawerPanel');if(!d||!p)return;p.innerHTML=sidebarHtml();d.classList.add('open');renderRooms();}
  function closeDrawer(){const d=$('#drawer');if(d)d.classList.remove('open');}

  // Profile cache is populated when messages render.
  // Initial online state is deliberately omitted: users should see a calm, product-like interface.
})();
