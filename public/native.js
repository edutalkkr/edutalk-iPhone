/* Edutalk Native Bridge — Capacitor 전용 기능 (웹에서는 자동 스킵) */
(function () {
  'use strict';

  // 웹/네이티브 감지 — Capacitor.isNativePlatform() 우선, 없으면 fallback
  function isNative() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
      }
      return !!(window.Capacitor && window.Capacitor.Plugins);
    } catch (e) { return false; }
  }

  function getPlugin(name) {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) {
        return window.Capacitor.Plugins[name];
      }
    } catch (e) {}
    return null;
  }

  // ---------- SecureStorage (iOS Keychain / Android Keystore) ----------
  // NativeBiometric Keychain 우선, 없으면 Capacitor Preferences, 최후 localStorage
  async function secureSet(key, value) {
    const v = String(value ?? '');
    if (!isNative()) {
      try { localStorage.setItem(key, v); } catch (e) {}
      return;
    }
    const NB = getPlugin('NativeBiometric');
    if (NB && NB.setCredentials) {
      try { await NB.setCredentials({ username: key, password: v, server: 'edutalk.lock' }); return; } catch (e) {}
    }
    const Prefs = getPlugin('Preferences');
    if (Prefs && Prefs.set) {
      try { await Prefs.set({ key, value: v }); return; } catch (e) {}
    }
    try { localStorage.setItem(key, v); } catch (e) {}
  }

  async function secureGet(key) {
    if (!isNative()) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    const NB = getPlugin('NativeBiometric');
    if (NB && NB.getCredentials) {
      try {
        const res = await NB.getCredentials({ server: 'edutalk.lock' });
        if (res && res.username === key) return res.password;
        if (res && res.password && !res.username) return res.password;
        // 일부 구현은 username을 무시하고 단일 credential만 반환하므로, password가 있으면 반환
        if (res && res.password) return res.password;
      } catch (e) {}
    }
    const Prefs = getPlugin('Preferences');
    if (Prefs && Prefs.get) {
      try {
        const r = await Prefs.get({ key });
        if (r && typeof r.value === 'string') return r.value;
      } catch (e) {}
    }
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  async function secureRemove(key) {
    if (!isNative()) {
      try { localStorage.removeItem(key); } catch (e) {}
      return;
    }
    const NB = getPlugin('NativeBiometric');
    if (NB && NB.deleteCredentials) {
      try { await NB.deleteCredentials({ server: 'edutalk.lock' }); } catch (e) {}
    }
    const Prefs = getPlugin('Preferences');
    if (Prefs && Prefs.remove) {
      try { await Prefs.remove({ key }); } catch (e) {}
    }
    try { localStorage.removeItem(key); } catch (e) {}
  }

  // ---------- Biometric ----------
  async function isBiometricAvailable() {
    if (!isNative()) return { isAvailable: false, biometryType: null };
    const NB = getPlugin('NativeBiometric');
    if (NB && NB.isAvailable) {
      try {
        const r = await NB.isAvailable();
        return { isAvailable: !!r.isAvailable, biometryType: r.biometryType || r.biometry || null, raw: r };
      } catch (e) { console.warn('biometric isAvailable', e); }
    }
    return { isAvailable: false, biometryType: null };
  }

  async function verifyBiometric(reason) {
    if (!isNative()) return false;
    const NB = getPlugin('NativeBiometric');
    if (!NB || !NB.verifyIdentity) return false;
    try {
      const opts = {
        reason: reason || '앱 잠금을 해제합니다',
        title: '에듀톡 잠금 해제',
        subtitle: '본인 확인',
        description: 'Face ID / Touch ID / PIN으로 인증해 주세요',
        negativeButtonText: '취소',
        useFallback: true
      };
      await NB.verifyIdentity(opts);
      return true;
    } catch (e) {
      // 사용자가 취소하면 false, 그 외도 false로 처리하여 폴백(PIN) 유도
      console.warn('verifyBiometric', e);
      return false;
    }
  }

  async function setBiometricCredentials(username, password) {
    if (!isNative()) return false;
    const NB = getPlugin('NativeBiometric');
    if (!NB || !NB.setCredentials) return false;
    try {
      await NB.setCredentials({ username, password, server: 'edutalk.lock' });
      return true;
    } catch (e) { console.warn('setCredentials', e); return false; }
  }

  // ---------- Haptics ----------
  async function hapticImpactMedium() {
    if (!isNative()) return;
    try {
      const H = getPlugin('Haptics');
      if (H && H.impact) { await H.impact({ style: 'MEDIUM' }); return; }
      if (H && H.vibrate) { await H.vibrate({ duration: 40 }); return; }
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
  }

  async function hapticSuccess() {
    if (!isNative()) return;
    try {
      const H = getPlugin('Haptics');
      if (H && H.notification) { await H.notification({ type: 'SUCCESS' }); return; }
      if (H && H.impact) { await H.impact({ style: 'MEDIUM' }); return; }
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([30, 50, 30]); } catch (e) {}
  }

  async function hapticError() {
    if (!isNative()) return;
    try {
      const H = getPlugin('Haptics');
      if (H && H.notification) { await H.notification({ type: 'ERROR' }); return; }
      if (H && H.vibrate) { await H.vibrate({ duration: 80 }); return; }
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([60, 30, 60]); } catch (e) {}
  }

  // ---------- Push Notifications (FCM) ----------
  async function registerPush() {
    if (!isNative()) return null;
    const PushNotifications = getPlugin('PushNotifications');
    if (!PushNotifications) return null;
    try {

      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        console.log('push permission not granted', perm);
        return null;
      }
      await PushNotifications.register();

      // 리스너는 한 번만 등록
      if (!window.__edutalkPushBound) {
        window.__edutalkPushBound = true;
        PushNotifications.addListener('registration', token => {
          console.log('push registration', token.value);
          // 서버에 토큰 저장 (FCM 토큰을 Firestore에 저장)
          try {
            const uid = window.EduFirebase?.auth?.currentUser?.uid;
            if (uid && token.value) {
              window.EduFirebase.db.collection('pushTokens').doc(uid).set({
                token: token.value,
                platform: window.Capacitor?.getPlatform?.() || 'unknown',
                updatedAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date(),
                enabled: true
              }, { merge: true }).catch(()=>{});
            }
          } catch (e) {}
        });
        PushNotifications.addListener('registrationError', err => {
          console.warn('push registrationError', err);
        });
        PushNotifications.addListener('pushNotificationReceived', notification => {
          console.log('push received', notification);
          // 앱이 포그라운드일 때 인앱 토스트로 표시
          try {
            const title = notification.title || '에듀톡';
            const body = notification.body || '';
            // 기존 알림 시스템 재사용
            if (window.showToast) window.showToast(body || title);
          } catch (e) {}
        });
        PushNotifications.addListener('pushNotificationActionPerformed', action => {
          console.log('push action', action);
          const data = action.notification?.data || {};
          const roomId = data.roomId || data.room_id || '';
          if (roomId && window.openRoom) {
            try { window.openRoom(roomId); } catch (e) {}
          }
        });
      }
      return PushNotifications;
    } catch (e) {
      console.warn('registerPush', e);
      return null;
    }
  }

  // 전역 노출 (웹에서는 no-op)
  window.EdutalkNative = {
    isNative,
    // storage
    secureSet,
    secureGet,
    secureRemove,
    // biometric
    isBiometricAvailable,
    verifyBiometric,
    setBiometricCredentials,
    // haptics
    hapticImpactMedium,
    hapticSuccess,
    hapticError,
    // alias for spec mapping
    haptic: {
      medium: hapticImpactMedium,
      success: hapticSuccess,
      error: hapticError
    },
    // push
    registerPush,
    // helper to check native and fallback
    withFallback: async (nativeFn, fallbackFn) => {
      if (isNative()) {
        try { return await nativeFn(); } catch (e) { console.warn('native fallback', e); }
      }
      if (fallbackFn) return await fallbackFn();
      return null;
    }
  };

  // 자동 초기화: 네이티브면 푸시 등록 시도 (auth 상태와 무관하게, 나중에 uid가 생기면 재등록)
  if (isNative()) {
    // Capacitor가 준비된 뒤
    const init = () => {
      // 약간의 지연 후 등록 (웹뷰 로드 안정화)
      setTimeout(() => { registerPush().catch(()=>{}); }, 1500);
    };
    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
    // document resume 시에도 확인
    try {
      document.addEventListener('resume', () => { // Cordova-style, Capacitor는 App plugin으로 resume 감지하지만 fallback
        registerPush().catch(()=>{});
      });
    } catch (e) {}
    // Capacitor App resume (백그라운드 → 포그라운드)
    try {
      const AppPlugin = getPlugin('App');
      if (AppPlugin && AppPlugin.addListener) {
        AppPlugin.addListener('resume', () => { registerPush().catch(()=>{}); });
      }
    } catch (e) {}
  }

  console.log('[native] EdutalkNative ready, isNative=', isNative());
})();
