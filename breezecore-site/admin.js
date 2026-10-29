/* 브리즈코어 소개 사이트 관리자.
 * Firebase Auth로 로그인한 뒤 users/{uid} 역할이 admin인지 확인하고,
 * siteConfig/breezecore 문서만 읽고 씁니다. (Firestore 규칙이 같은 조건을 강제해요.) */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const defaults = window.BREEZE_SITE_DEFAULTS || {};
  const conf = window.BREEZE_FIREBASE_CONFIG || null;

  const loginPanel = $("#loginPanel");
  const editorPanel = $("#editorPanel");
  const blockedPanel = $("#blockedPanel");
  const configPanel = $("#configPanel");
  const loginForm = $("#loginForm");
  const siteForm = $("#siteForm");
  const loginError = $("#loginError");
  const loginBtn = $("#loginBtn");
  const logoutBtn = $("#logoutBtn");
  const saveState = $("#saveState");
  const saveBtn = $("#saveBtn");
  const adminToast = $("#adminToast");
  let toastTimer = 0;

  function showToast(message, isError) {
    if (!adminToast) return;
    adminToast.textContent = String(message || "");
    adminToast.className = "admin-toast show" + (isError ? " is-error" : "");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      adminToast.className = "admin-toast";
    }, 3600);
  }

  function setPanel(which) {
    [loginPanel, editorPanel, blockedPanel, configPanel].forEach((el) => {
      if (el) el.hidden = el !== which;
    });
    if (logoutBtn) logoutBtn.hidden = which !== editorPanel;
  }

  function field(id) {
    return document.getElementById(id);
  }

  function setValue(id, value) {
    const el = field(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value == null ? "" : String(value);
  }

  function getValue(id) {
    const el = field(id);
    if (!el) return "";
    return el.type === "checkbox" ? el.checked : String(el.value || "").trim();
  }

  function setSaveState(text, isError) {
    if (!saveState) return;
    saveState.textContent = text || "";
    saveState.classList.toggle("is-error", !!isError);
  }

  function toDateText(value) {
    try {
      if (!value) return "";
      if (typeof value.toDate === "function") return value.toDate().toISOString().slice(0, 10);
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
    } catch (e) {
      return "";
    }
  }

  function fillForm(data) {
    const cfg = Object.assign({}, defaults, data || {});
    setValue("siteTitle", cfg.siteTitle);
    setValue("siteDescription", cfg.siteDescription);
    setValue("heroDesc", cfg.heroDesc);
    setValue("breezeLabel", cfg.breezeLabel);
    setValue("breezeUrl", cfg.breezeUrl);
    setValue("popupEnabled", cfg.popupEnabled !== false);
    setValue("popupTitle", cfg.popupTitle);
    setValue("popupBody", cfg.popupBody);
    setValue("popupLinkLabel", cfg.popupLinkLabel);
    setValue("popupLinkUrl", cfg.popupLinkUrl);
    setValue("popupHideDays", String(cfg.popupHideDays || 1));
    setValue("popupStart", toDateText(cfg.popupStart));
    setValue("popupEnd", toDateText(cfg.popupEnd));
  }

  function readForm() {
    const url = getValue("breezeUrl") || "/breeze";
    const popupUrl = getValue("popupLinkUrl") || "#adopt";
    return {
      siteTitle: getValue("siteTitle").slice(0, 100),
      siteDescription: getValue("siteDescription").slice(0, 220),
      heroDesc: getValue("heroDesc").slice(0, 320),
      breezeLabel: getValue("breezeLabel").slice(0, 40) || "Breeze",
      breezeUrl: url.slice(0, 300),
      popupEnabled: !!getValue("popupEnabled"),
      popupTitle: getValue("popupTitle").slice(0, 80),
      popupBody: getValue("popupBody").slice(0, 600),
      popupLinkLabel: getValue("popupLinkLabel").slice(0, 40) || "자세히 보기",
      popupLinkUrl: popupUrl.slice(0, 300),
      popupHideDays: Math.max(1, Number(getValue("popupHideDays")) || 1),
      popupStart: getValue("popupStart"),
      popupEnd: getValue("popupEnd"),
    };
  }

  if (!conf || !conf.apiKey || !conf.projectId) {
    setPanel(configPanel);
    return;
  }
  if (!window.firebase || !window.firebase.initializeApp) {
    setPanel(configPanel);
    return;
  }

  try {
    if (!window.firebase.apps.length) window.firebase.initializeApp(conf);
  } catch (e) {
    setPanel(configPanel);
    return;
  }

  const auth = window.firebase.auth();
  const db = window.firebase.firestore();
  const docRef = db.collection("siteConfig").doc("breezecore");

  async function isAdmin(uid) {
    try {
      const snap = await db.collection("users").doc(uid).get();
      if (!snap.exists) return false;
      const role = String((snap.data() || {}).role || "").toLowerCase();
      return role === "admin";
    } catch (e) {
      return false;
    }
  }

  async function loadConfig() {
    try {
      const snap = await docRef.get();
      fillForm(snap.exists ? snap.data() : {});
      setSaveState("불러왔어요.");
    } catch (e) {
      fillForm({});
      setSaveState("기본값으로 열었어요. 저장 권한을 확인해 주세요.", true);
    }
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (loginError) loginError.hidden = true;
      const email = String(field("adminEmail").value || "").trim();
      const password = String(field("adminPassword").value || "");
      if (!email || !password) {
        if (loginError) {
          loginError.textContent = "이메일과 비밀번호를 입력해 주세요.";
          loginError.hidden = false;
        }
        return;
      }
      loginBtn.disabled = true;
      loginBtn.textContent = "로그인 중…";
      try {
        await auth.signInWithEmailAndPassword(email, password);
      } catch (err) {
        const code = String((err && err.code) || "");
        let message = "로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.";
        if (code.includes("too-many-requests")) message = "로그인 시도가 많았어요. 잠시 뒤 다시 시도해 주세요.";
        if (code.includes("network-request-failed")) message = "네트워크에 연결하지 못했어요.";
        if (loginError) {
          loginError.textContent = message;
          loginError.hidden = false;
        }
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = "로그인";
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => auth.signOut());
  }
  const blockedLogout = $("#blockedLogout");
  if (blockedLogout) {
    blockedLogout.addEventListener("click", () => auth.signOut());
  }

  if (siteForm) {
    siteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = readForm();
      if (!data.siteTitle) return showToast("브라우저 제목을 입력해 주세요.", true);
      if (!data.breezeUrl) return showToast("Breeze 주소를 입력해 주세요.", true);
      saveBtn.disabled = true;
      saveBtn.textContent = "저장 중…";
      setSaveState("저장 중…");
      try {
        await docRef.set(
          Object.assign({}, data, {
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
          }),
          { merge: true }
        );
        setSaveState("저장했어요. 방문자 화면에 곧 반영돼요.");
        showToast("사이트 설정을 저장했어요.");
      } catch (err) {
        setSaveState("저장하지 못했어요. 관리자 권한을 확인해 주세요.", true);
        showToast("저장하지 못했어요. 관리자 권한을 확인해 주세요.", true);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "저장하기";
      }
    });
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      setPanel(loginPanel);
      if (loginError) loginError.hidden = true;
      return;
    }
    const admin = await isAdmin(user.uid);
    if (!admin) {
      setPanel(blockedPanel);
      return;
    }
    setPanel(editorPanel);
    await loadConfig();
  });
})();
