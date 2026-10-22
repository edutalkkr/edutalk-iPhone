/* ============================================================
   브리즈코어 소개 사이트 — 상호작용
   외부 라이브러리 없이, 접근성과 모션 최소화를 지켜요.
   ============================================================ */
(function () {
  "use strict";

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 테마 ---------- */
  const THEME_KEY = "breezecore-theme";
  const themeBtn = $("#themeBtn");
  const metaTheme = $('meta[name="theme-color"]');

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function readTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (e) {}
    return systemTheme();
  }

  function applyTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    if (themeBtn) {
      const isDark = next === "dark";
      themeBtn.setAttribute("aria-pressed", String(isDark));
      themeBtn.setAttribute("aria-label", isDark ? "라이트 모드로 바꾸기" : "다크 모드로 바꾸기");
    }
    if (metaTheme) metaTheme.setAttribute("content", next === "dark" ? "#0c1b20" : "#f4f8f6");
  }

  applyTheme(readTheme());

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {}
    });
  }

  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      try {
        if (!localStorage.getItem(THEME_KEY)) applyTheme(systemTheme());
      } catch (e) {
        applyTheme(systemTheme());
      }
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------- 날짜 ---------- */
  const consoleDate = $("#consoleDate");
  if (consoleDate) {
    try {
      consoleDate.textContent = new Intl.DateTimeFormat("ko-KR", {
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(new Date());
    } catch (e) {
      consoleDate.textContent = "오늘의 학교";
    }
  }

  /* ---------- 헤더 / 모바일 메뉴 ---------- */
  const header = $("#siteHeader");
  const menuBtn = $("#menuBtn");
  const mainNav = $("#mainNav");

  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 10);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  function closeMenu() {
    if (!mainNav || !menuBtn) return;
    mainNav.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-label", "메뉴 열기");
  }

  if (menuBtn && mainNav) {
    menuBtn.addEventListener("click", () => {
      const open = mainNav.classList.toggle("is-open");
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    });
    $$("a", mainNav).forEach((a) => a.addEventListener("click", closeMenu));
    document.addEventListener("click", (e) => {
      if (!mainNav.classList.contains("is-open")) return;
      if (mainNav.contains(e.target) || menuBtn.contains(e.target)) return;
      closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  }

  /* ---------- 스마트 배너 ---------- */
  const bannerTrack = $("#bannerTrack");
  const bannerDots = $("#bannerDots");
  const banner = $("#smartBanner");
  const bannerPause = $("#bannerPause");
  const bannerHint = $("#bannerHint");
  const bannerPages = [
    {
      kicker: "학생 문의",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10H9l-4.5 3v-3H4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>',
      title: "학생 문의 3건이 도착했어요",
      meta: "3단원 5번 문제가 궁금해요 · 2분 전",
    },
    {
      kicker: "오늘 할 일",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 2.5 2.5L16 9"/></svg>',
      title: "오늘 할 일 2건이 남았어요",
      meta: "안전 점검 결과 정리 · 오늘까지",
    },
    {
      kicker: "점심 시간",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16a8 8 0 0 1-16 0Z"/><path d="M6 12c0-3 2.5-5.5 6-5.5s6 2.5 6 5.5"/><path d="M9 4.5c.6.8.6 1.7 0 2.5M13 4c.6.8.6 1.7 0 2.5M17 4.5c.6.8.6 1.7 0 2.5"/></svg>',
      title: "오늘 점심은 보리밥과 닭갈비예요",
      meta: "11:50 ~ 13:00 · 1학년 2반",
    },
    {
      kicker: "다음 일정",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="15" rx="3"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/><path d="M8 14h2M14 14h2M8 17.5h2"/></svg>',
      title: "4교시 수학, 1학년 2반",
      meta: "12:40 시작 · 준비물: 학습지",
    },
  ];

  let bannerIndex = 0;
  let bannerTimer = null;
  let bannerPaused = false;
  let userPaused = false;

  function renderBanner() {
    if (!bannerTrack || !bannerDots) return;
    bannerTrack.innerHTML = bannerPages
      .map(
        (page, i) =>
          '<article class="banner-page' +
          (i === 0 ? " is-active" : "") +
          '" data-banner-page="' +
          i +
          '" aria-hidden="' +
          (i === 0 ? "false" : "true") +
          '">' +
          '<span class="banner-ico" aria-hidden="true">' +
          page.icon +
          "</span>" +
          '<div class="banner-copy">' +
          '<span class="banner-kicker">' +
          page.kicker +
          "</span>" +
          "<strong>" +
          page.title +
          "</strong>" +
          "<p>" +
          page.meta +
          "</p>" +
          "</div>" +
          "</article>"
      )
      .join("");

    bannerDots.innerHTML = bannerPages
      .map(
        (page, i) =>
          '<button class="banner-dot' +
          (i === 0 ? " is-active" : "") +
          '" type="button" aria-current="' +
          (i === 0 ? "true" : "false") +
          '" aria-label="' +
          page.kicker +
          ' 배너 보기" data-banner-dot="' +
          i +
          '"></button>'
      )
      .join("");

    $$("[data-banner-dot]", bannerDots).forEach((dot) => {
      dot.addEventListener("click", () => {
        setBanner(Number(dot.getAttribute("data-banner-dot")));
        restartBannerTimer();
      });
    });
  }

  function setBanner(index) {
    if (!bannerPages.length) return;
    bannerIndex = ((index % bannerPages.length) + bannerPages.length) % bannerPages.length;
    $$("[data-banner-page]", bannerTrack).forEach((page, i) => {
      const active = i === bannerIndex;
      page.classList.toggle("is-active", active);
      page.setAttribute("aria-hidden", String(!active));
    });
    $$("[data-banner-dot]", bannerDots).forEach((dot, i) => {
      const active = i === bannerIndex;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-current", String(active));
    });
  }

  function nextBanner() {
    if (bannerPaused || userPaused || document.hidden) return;
    setBanner(bannerIndex + 1);
  }

  function restartBannerTimer() {
    if (bannerTimer) clearInterval(bannerTimer);
    bannerTimer = null;
    if (reduceMotion || userPaused) return;
    bannerTimer = setInterval(nextBanner, 5200);
  }

  function updatePauseUi() {
    if (!bannerPause) return;
    const paused = reduceMotion || userPaused;
    bannerPause.textContent = paused ? "▶" : "Ⅱ";
    bannerPause.setAttribute("aria-pressed", String(paused));
    bannerPause.setAttribute("aria-label", paused ? "자동 넘김 다시 시작" : "자동 넘김 멈추기");
    if (bannerHint) bannerHint.textContent = reduceMotion ? "모션 줄임 설정" : paused ? "자동 넘김 멈춤" : "자동으로 넘어가요";
  }

  renderBanner();
  updatePauseUi();
  restartBannerTimer();

  if (bannerPause) {
    bannerPause.addEventListener("click", () => {
      if (reduceMotion) return;
      userPaused = !userPaused;
      updatePauseUi();
      restartBannerTimer();
    });
  }

  if (banner) {
    banner.addEventListener("pointerenter", () => {
      bannerPaused = true;
    });
    banner.addEventListener("pointerleave", () => {
      bannerPaused = false;
    });
    banner.addEventListener("focusin", () => {
      bannerPaused = true;
    });
    banner.addEventListener("focusout", () => {
      bannerPaused = false;
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) restartBannerTimer();
  });

  /* ---------- 선생님의 하루 탭 ---------- */
  const dayData = {
    morning: {
      time: "08:10",
      title: "문을 열면, 오늘 할 일이 먼저 보여요.",
      desc: "안 읽은 학생 문의와 오늘 일정, 아직 끝내지 못한 할 일을 한 장의 배너로 정리해요. 화살표로 넘기면 필요한 것만 빠르게 확인할 수 있어요.",
      list: ["학생 문의 3건 · 아직 답장 전", "오늘 4교시 수학 · 1학년 2반", "제출 마감 · 안전 점검 결과"],
      bubbles: [
        { icon: "💬", title: "학생 문의 3건", meta: "3단원 5번 문제가 궁금해요", tone: "" },
        { icon: "📅", title: "오늘 4교시", meta: "수학 · 1학년 2반", tone: "alt" },
        { icon: "✅", title: "할 일 2건", meta: "안전 점검 결과 정리", tone: "soft" },
      ],
    },
    lunch: {
      time: "12:20",
      title: "점심시간이 가까워지면, 급식 메뉴가 먼저 떠요.",
      desc: "11시 30분부터 1시 30분 사이에는 오늘의 급식과 학급 안내가 배너에 자연스럽게 올라와요. 따로 찾지 않아도 점심 흐름이 보여요.",
      list: ["오늘 급식 · 보리밥과 닭갈비", "1학년 2반 · 12:20 배식", "오후 일정 · 5교시 과학"],
      bubbles: [
        { icon: "🍱", title: "오늘의 급식", meta: "보리밥 · 닭갈비 · 미역국", tone: "" },
        { icon: "🕐", title: "12:20 배식", meta: "1학년 2반 · 급식실", tone: "alt" },
        { icon: "📚", title: "5교시 과학", meta: "준비물 · 실험 노트", tone: "soft" },
      ],
    },
    afternoon: {
      time: "15:30",
      title: "수업이 끝나면, 보안 인쇄를 확인해요.",
      desc: "시험지와 성적표는 바로 출력되지 않아요. 인쇄 대기열에서 내용을 확인하고 승인한 순간에만 종이로 나가요. 누가 승인했는지도 기록에 남아요.",
      list: ["보안 인쇄 대기 · 2건", "승인 전에는 본문이 내려가지 않아요", "출력 기록 · 승인자와 시각 저장"],
      bubbles: [
        { icon: "🖨️", title: "보안 인쇄 2건", meta: "승인을 기다리고 있어요", tone: "" },
        { icon: "🔐", title: "승인자 기록", meta: "누가·언제 출력했는지", tone: "alt" },
        { icon: "📝", title: "감사 기록", meta: "서버에 차곡차곡", tone: "soft" },
      ],
    },
    evening: {
      time: "18:00",
      title: "하루의 기록은 서버에 차곡차곡 남아요.",
      desc: "쪽지 발송, 권한 변경, 클라우드 정리, 인쇄 승인 같은 주요 행동이 서버 PC의 텍스트 로그에 남아요. 비밀번호와 쪽지 본문은 기록하지 않아요.",
      list: ["오늘 활동 로그 · 텍스트로 저장", "민감한 본문·토큰은 남기지 않아요", "필요하면 관리자 콘솔에서 확인"],
      bubbles: [
        { icon: "🗂️", title: "활동 로그", meta: "activity-YYYY-MM-DD.log", tone: "" },
        { icon: "🛡️", title: "민감정보 제외", meta: "비밀번호·토큰·본문 없음", tone: "alt" },
        { icon: "🌙", title: "오늘도 수고했어요", meta: "내일의 브리즈가 기다려요", tone: "soft" },
      ],
    },
  };

  const dayTabs = $$(".day-tab");
  const dayPanel = $("#dayPanel");
  const dayTime = $("#dayTime");
  const dayTitle = $("#dayTitle");
  const dayDesc = $("#dayDesc");
  const dayList = $("#dayList");
  const dayVisual = $("#dayVisual");
  const dayCopy = $(".day-copy");

  function bubbleHtml(bubble) {
    return (
      '<div class="day-bubble ' +
      (bubble.tone || "") +
      '"><span aria-hidden="true">' +
      bubble.icon +
      "</span><div><b>" +
      bubble.title +
      "</b><small>" +
      bubble.meta +
      "</small></div></div>"
    );
  }

  function setDay(key, focusTab) {
    const data = dayData[key] || dayData.morning;
    if (dayTime) dayTime.textContent = data.time;
    if (dayTitle) dayTitle.textContent = data.title;
    if (dayDesc) dayDesc.textContent = data.desc;
    if (dayList) {
      dayList.innerHTML = data.list.map((item) => "<li>" + item + "</li>").join("");
    }
    if (dayVisual) {
      dayVisual.innerHTML = data.bubbles.map(bubbleHtml).join("");
    }
    dayTabs.forEach((tab) => {
      const active = tab.getAttribute("data-day") === key;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    if (!reduceMotion) {
      [dayCopy, dayVisual].forEach((el) => {
        if (!el) return;
        el.style.animation = "none";
        void el.offsetWidth;
        el.style.animation = "";
      });
    }
  }

  dayTabs.forEach((tab) => {
    tab.addEventListener("click", () => setDay(tab.getAttribute("data-day")));
    tab.addEventListener("keydown", (e) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      const current = dayTabs.indexOf(tab);
      let next = current;
      if (e.key === "ArrowLeft") next = (current - 1 + dayTabs.length) % dayTabs.length;
      if (e.key === "ArrowRight") next = (current + 1) % dayTabs.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = dayTabs.length - 1;
      setDay(dayTabs[next].getAttribute("data-day"), true);
    });
  });

  if (dayTabs.length) setDay("morning");

  /* ---------- FAQ: 한 번에 하나만 열기 ---------- */
  const faqItems = $$(".faq-item");
  faqItems.forEach((item) => {
    item.addEventListener("toggle", () => {
      if (!item.open) return;
      faqItems.forEach((other) => {
        if (other !== item) other.open = false;
      });
    });
  });

  /* ---------- 정책 대화상자 ---------- */
  const policyDialog = $("#policyDialog");
  const policyTitle = $("#policyTitle");
  const policyBody = $("#policyBody");
  const policyClose = $("#policyClose");
  const policyOk = $("#policyOk");
  let lastPolicyTrigger = null;

  const policyContent = {
    privacy: {
      title: "개인정보 처리방침",
      body:
        "<h3>1. 이 페이지에서 수집하는 정보</h3>" +
        "<p>브리즈코어 소개 페이지는 회원가입, 문의 접수, 결제 기능을 제공하지 않습니다. 이름, 이메일, 전화번호 같은 개인정보를 입력받지 않으며, 방문 기록을 분석하는 추적 도구도 사용하지 않습니다.</p>" +
        "<h3>2. 브라우저에 저장되는 정보</h3>" +
        "<p>화면 테마를 기억하기 위해 브라우저의 로컬 저장소에 라이트·다크 모드 설정만 저장합니다. 이 값은 서버로 전송되지 않으며 브라우저 저장소를 지우면 함께 삭제됩니다.</p>" +
        "<h3>3. 실제 학교 서비스의 개인정보</h3>" +
        "<p>브리즈코어를 학교에 도입한 경우, 학생·교직원 계정과 쪽지·출결·인쇄 기록은 학교가 운영하는 교내 서버에 저장됩니다. 해당 정보의 처리 목적과 보관 기간은 학교의 개인정보 처리방침과 관리자 정책을 따릅니다.</p>" +
        "<h3>4. 문의</h3>" +
        "<p>이 소개 페이지의 운영 또는 개인정보 처리에 관한 문의는 학교 관리자 또는 브리즈코어 도입 담당자에게 전달해 주십시오.</p>" +
        '<p class="formal-note">본 방침은 소개 페이지 운영을 위한 요약본입니다. 실제 학교 서비스 도입 시에는 학교의 법적 검토를 거친 개인정보 처리방침을 별도로 마련하셔야 합니다.</p>',
    },
    terms: {
      title: "이용약관",
      body:
        "<h3>1. 목적</h3>" +
        "<p>본 약관은 브리즈코어 소개 페이지의 이용 조건과 책임 범위를 정하기 위해 마련되었습니다. 이 페이지는 제품 정보를 안내하기 위한 목적으로 운영됩니다.</p>" +
        "<h3>2. 정보의 성격</h3>" +
        "<p>이 페이지에 표시된 기능, 화면, 운영 방식은 제품 소개를 위한 예시입니다. 실제 학교에 적용되는 기능과 정책은 설치된 서버 버전, 이용권, 학교 설정에 따라 달라질 수 있습니다.</p>" +
        "<h3>3. 책임의 범위</h3>" +
        "<p>소개 페이지의 정보는 정확성을 위해 노력하지만, 법적 효력이나 특정 목적에 대한 적합성을 보증하지 않습니다. 실제 도입과 운영에 관한 결정은 학교의 검토와 책임 아래 이루어져야 합니다.</p>" +
        "<h3>4. 지식재산권</h3>" +
        "<p>이 페이지의 디자인, 문구, 그래픽은 브리즈코어 프로젝트의 자산입니다. 사전 동의 없이 복제하거나 상업적으로 재배포할 수 없습니다.</p>" +
        "<h3>5. 약관의 변경</h3>" +
        "<p>페이지 운영상 필요하면 본 약관을 변경할 수 있습니다. 변경된 내용은 이 페이지에 게시한 시점부터 적용됩니다.</p>" +
        '<p class="formal-note">본 약관은 소개 페이지용 요약본입니다. 실제 서비스 제공 계약에서는 학교와 공급자 간의 별도 계약이 우선합니다.</p>',
    },
    contact: {
      title: "도입 문의 안내",
      body:
        "<h3>이 페이지는 문의를 직접 접수하지 않습니다</h3>" +
        "<p>브리즈코어 소개 페이지는 제품을 살펴보기 위한 데모입니다. 실제 도입 상담, 견적, 설치 일정은 학교 관리자 또는 브리즈코어 도입 담당자에게 문의해 주십시오.</p>" +
        "<h3>도입 전에 준비하면 좋은 것</h3>" +
        "<ul>" +
        "<li>학교 서버로 사용할 학교 PC와 고정 내부 IP</li>" +
        "<li>교직원·학생 계정 명단(엑셀)</li>" +
        "<li>학교 코드로 사용할 영문·숫자 조합</li>" +
        "<li>백업 폴더와 관리자 계정을 맡을 담당자</li>" +
        "<li>듀얼망 여부와 외부 API 사용 계획</li>" +
        "</ul>" +
        "<h3>문의할 때 알려 주세요</h3>" +
        "<p>학교명, 예상 사용 인원, 서버 PC 운영 환경, 현재 사용 중인 메신저를 함께 알려 주시면 도입 순서를 더 빠르게 안내할 수 있습니다.</p>" +
        '<p class="formal-note">실제 문의처는 학교 관리자 또는 도입 담당자에게 확인해 주십시오. 이 데모 페이지에는 연락처가 포함되어 있지 않습니다.</p>',
    },
  };

  function openPolicy(key) {
    const content = policyContent[key] || policyContent.privacy;
    if (!policyDialog || !policyTitle || !policyBody) return;
    lastPolicyTrigger = document.activeElement;
    policyTitle.textContent = content.title;
    policyBody.innerHTML = content.body;
    if (typeof policyDialog.showModal === "function") {
      if (!policyDialog.open) policyDialog.showModal();
    } else {
      policyDialog.setAttribute("open", "");
    }
    document.body.style.overflow = "hidden";
    if (policyClose) policyClose.focus();
  }

  function closePolicy() {
    if (!policyDialog) return;
    if (typeof policyDialog.close === "function" && policyDialog.open) policyDialog.close();
    else policyDialog.removeAttribute("open");
    document.body.style.overflow = "";
    if (lastPolicyTrigger && typeof lastPolicyTrigger.focus === "function") lastPolicyTrigger.focus();
  }

  $$("[data-open-policy]").forEach((btn) => {
    btn.addEventListener("click", () => openPolicy(btn.getAttribute("data-open-policy")));
  });

  if (policyClose) policyClose.addEventListener("click", closePolicy);
  if (policyOk) policyOk.addEventListener("click", closePolicy);

  if (policyDialog) {
    policyDialog.addEventListener("click", (e) => {
      if (e.target === policyDialog) closePolicy();
    });
    policyDialog.addEventListener("close", () => {
      document.body.style.overflow = "";
    });
    policyDialog.addEventListener("cancel", () => {
      document.body.style.overflow = "";
    });
  }

  /* ---------- 스크롤 등장 ---------- */
  const revealEls = $$(".reveal");
  revealEls.forEach((el, index) => {
    el.style.transitionDelay = Math.min(index % 6, 5) * 55 + "ms";
  });

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          io.unobserve(entry.target);
          window.setTimeout(() => {
            entry.target.style.transitionDelay = "";
          }, 900);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- 카드 기울기 (마우스가 있는 환경에서만) ---------- */
  const finePointer = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  if (finePointer && !reduceMotion) {
    $$(".tilt").forEach((card) => {
      let frame = 0;
      card.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch") return;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          card.style.transitionDelay = "0ms";
          const rect = card.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width - 0.5;
          const py = (e.clientY - rect.top) / rect.height - 0.5;
          card.style.setProperty("--rx", (-py * 3.2).toFixed(2) + "deg");
          card.style.setProperty("--ry", (px * 4.2).toFixed(2) + "deg");
          card.classList.add("is-tilting");
        });
      });
      card.addEventListener("pointerleave", () => {
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        card.classList.remove("is-tilting");
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
    });
  }

  /* ---------- 연도 ---------- */
  const year = $("#year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
