/* Breeze 역할 이원화 — Desktop 100% vs 외부 라이트 웹 (Web/Mobile Sub-Client) */
(function () {
  'use strict';
  function isDesktop() {
    try { return !!(window.edutalkDesktop && window.edutalkDesktop.isDesktop); } catch (e) { return false; }
  }
  function isLite() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('lite') === '1') return true;
      if (window.__EDUTALK_FORCE_LITE__) return true;
      // 외부망 + 모바일 폭이면 라이트 권장 (수신 전용 모드)
      if (!isDesktop() && Math.min(screen.width || 9999, window.innerWidth || 9999) < 720) return true;
    } catch (e) {}
    return false;
  }
  // 라이트 모드: OS 접근 불필요, 비민감 수신 전용, 백그라운드 연산 차단, 경량
  function applyLiteMode() {
    if (!isLite() || isDesktop()) return false;
    try { document.documentElement.setAttribute('data-edutalk-mode', 'lite'); } catch (e) {}
    // 무거운 실시간 리스너는 끄고, 공지/쪽지 조회 + 가벼운 답장만 허용
    window.__EDUTALK_LITE__ = { receiveOnly: true, noBackgroundCompute: true };
    return true;
  }
  // 데스크톱 모드 배지
  async function desktopBadge() {
    if (!isDesktop()) return null;
    try {
      const net = await window.edutalkDesktop.getNetMode().catch(() => ({ mode: 'external' }));
      return { kind: 'full', net: (net && net.mode) || 'external' };
    } catch (e) { return { kind: 'full', net: 'external' }; }
  }
  window.EduRole = { isDesktop, isLite, applyLiteMode, desktopBadge };
  try { applyLiteMode(); } catch (e) {}
})();
