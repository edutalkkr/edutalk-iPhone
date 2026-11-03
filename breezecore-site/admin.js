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
  const changePasswordBtn = $("#changePasswordBtn");
  const passwordState = $("#passwordState");
  const attemptsList = $("#attemptsList");
  const clearAttemptsBtn = $("#clearAttemptsBtn");
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
        setFailedCount(0);
      } catch (err) {
        const code = String((err && err.code) || "");
        const count = getFailedCount() + 1;
        setFailedCount(count);
        let message = "로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.";
        if (code.includes("too-many-requests")) message = "로그인 시도가 많았어요. 잠시 뒤 다시 시도해 주세요.";
        if (code.includes("network-request-failed")) message = "네트워크에 연결하지 못했어요.";
        if (count >= 3) {
          const ip = await fetchClientIp();
          await recordFailedAttempt(ip);
          message = "비정상 접근으로 감지되어 IP 주소(" + ip + ")가 기록되었어요. 관리자가 아니라면 이 페이지를 나가주세요.";
        }
        if (loginError) {
          loginError.textContent = message;
          loginError.hidden = false;
        }
      } finally {
        const pw = field("adminPassword");
        if (pw) pw.value = "";
        loginBtn.disabled = false;
        loginBtn.textContent = "로그인";
      }
    });
  }

  /* ---------- 로그인 실패 추적 ---------- */
  const FAILED_KEY = "breezecore.failedLogins";
  function getFailedCount() {
    try { return Number(localStorage.getItem(FAILED_KEY) || 0); } catch (e) { return 0; }
  }
  function setFailedCount(n) {
    try { localStorage.setItem(FAILED_KEY, String(n)); } catch (e) {}
  }
  async function fetchClientIp() {
    try {
      const res = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
      if (!res.ok) throw new Error("ip");
      const json = await res.json();
      return String(json.ip || "알 수 없음");
    } catch (e) {
      return "알 수 없음";
    }
  }
  async function recordFailedAttempt(ip) {
    try {
      await db.collection("adminLoginAttempts").add({
        ip: ip,
        userAgent: String(navigator.userAgent || "").slice(0, 300),
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {}
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

  async function loadAttempts() {
    if (!attemptsList) return;
    try {
      const snap = await db.collection("adminLoginAttempts").orderBy("createdAt", "desc").limit(50).get();
      if (snap.empty) {
        attemptsList.textContent = "기록이 없어요.";
        return;
      }
      attemptsList.innerHTML = "";
      snap.forEach((doc) => {
        const data = doc.data() || {};
        const when = data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toLocaleString("ko-KR") : "";
        const row = document.createElement("div");
        row.className = "admin-attempt-row";
        row.innerHTML =
          "<span class=\"admin-attempt-ip\">" + String(data.ip || "알 수 없음") + "</span>" +
          "<span class=\"admin-attempt-ua\">" + String(data.userAgent || "") + "</span>" +
          "<span class=\"admin-attempt-time\">" + when + "</span>" +
          "<button class=\"admin-attempt-del\" type=\"button\" data-id=\"" + doc.id + "\">삭제</button>";
        attemptsList.appendChild(row);
      });
      attemptsList.querySelectorAll(".admin-attempt-del").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await db.collection("adminLoginAttempts").doc(btn.getAttribute("data-id")).delete();
            showToast("기록을 삭제했어요.");
            loadAttempts();
          } catch (e) {
            showToast("삭제하지 못했어요.", true);
          }
        });
      });
    } catch (e) {
      attemptsList.textContent = "기록을 불러오지 못했어요.";
    }
  }

  if (changePasswordBtn) {
    changePasswordBtn.addEventListener("click", async () => {
      const user = auth.currentUser;
      if (!user || !user.email) {
        showToast("로그인 상태를 확인해 주세요.", true);
        return;
      }
      const current = String(field("currentPassword").value || "");
      const next = String(field("newPassword").value || "");
      const confirm = String(field("confirmPassword").value || "");
      if (!current || !next) {
        if (passwordState) { passwordState.textContent = "현재/새 비밀번호를 입력해 주세요."; passwordState.classList.add("is-error"); }
        return;
      }
      if (next.length < 6) {
        if (passwordState) { passwordState.textContent = "새 비밀번호는 6자 이상이어야 해요."; passwordState.classList.add("is-error"); }
        return;
      }
      if (next !== confirm) {
        if (passwordState) { passwordState.textContent = "새 비밀번호가 일치하지 않아요."; passwordState.classList.add("is-error"); }
        return;
      }
      changePasswordBtn.disabled = true;
      changePasswordBtn.textContent = "변경 중…";
      if (passwordState) { passwordState.textContent = "변경 중…"; passwordState.classList.remove("is-error"); }
      try {
        const cred = window.firebase.auth.EmailAuthProvider.credential(user.email, current);
        await user.reauthenticateWithCredential(cred);
        await user.updatePassword(next);
        if (passwordState) { passwordState.textContent = "비밀번호를 변경했어요."; passwordState.classList.remove("is-error"); }
        showToast("비밀번호를 변경했어요.");
        ["currentPassword", "newPassword", "confirmPassword"].forEach((id) => { const el = field(id); if (el) el.value = ""; });
      } catch (err) {
        const code = String((err && err.code) || "");
        let message = "비밀번호를 변경하지 못했어요.";
        if (code.includes("wrong-password")) message = "현재 비밀번호가 맞지 않아요.";
        if (code.includes("weak-password")) message = "비밀번호가 너무 약해요.";
        if (code.includes("requires-recent-login")) message = "보안을 위해 다시 로그인한 뒤 시도해 주세요.";
        if (passwordState) { passwordState.textContent = message; passwordState.classList.add("is-error"); }
        showToast(message, true);
      } finally {
        changePasswordBtn.disabled = false;
        changePasswordBtn.textContent = "비밀번호 변경";
      }
    });
  }

  if (clearAttemptsBtn) {
    clearAttemptsBtn.addEventListener("click", async () => {
      try {
        const snap = await db.collection("adminLoginAttempts").get();
        const batch = db.batch();
        snap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        showToast("모든 기록을 삭제했어요.");
        loadAttempts();
      } catch (e) {
        showToast("삭제하지 못했어요.", true);
      }
    });
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      setPanel(loginPanel);
      if (loginError) loginError.hidden = true;
      return;
    }
    const emailField = field("adminEmail");
    const pwField = field("adminPassword");
    if (emailField) emailField.value = "";
    if (pwField) pwField.value = "";
    const admin = await isAdmin(user.uid);
    if (!admin) {
      setPanel(blockedPanel);
      return;
    }
    setPanel(editorPanel);
    await loadConfig();
    loadAttempts();
  });
})();
