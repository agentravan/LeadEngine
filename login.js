// Sign-in screen, "Forgot password" with an emailed 6-digit code, and smart sign-out.
// Uses globals from app.js: db, $, user, toast, showSignedOut.
(function () {
  const IDLE_SHORT = 30 * 60 * 1000;      // 30 min without activity, normal sign-in
  const IDLE_LONG = 8 * 60 * 60 * 1000;   // 8 h when "remember this device" is ticked
  const WARN = 60 * 1000;                 // warning shown for the last minute
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const chan = "BroadcastChannel" in window ? new BroadcastChannel("leadengine-auth") : null;
  let resetEmail = "", resetCode = "", resendTimer = null, lockTimer = null;

  /* ---------- small helpers ---------- */
  const forms = ["leLogin", "leForgot", "leCode", "leNewPass"];
  function show(id) {
    forms.forEach((f) => $(f).classList.toggle("hidden", f !== id));
    const step = { leLogin: 0, leForgot: 1, leCode: 2, leNewPass: 3 }[id];
    $("leSteps").classList.toggle("hidden", id === "leLogin");
    [...$("leSteps").children].forEach((b, i) => b.classList.toggle("on", i < step));
    const first = $(id).querySelector("input:not([type=checkbox])");
    if (first) setTimeout(() => first.focus(), 30);
  }
  function msg(id, text, kind = "err") {
    const el = $(id);
    if (!text) { el.classList.add("hidden"); return; }
    el.className = "le-msg " + kind; el.textContent = text;
  }
  function busy(btn, on, label) {
    btn.disabled = on;
    if (on) { btn.dataset.label = btn.textContent; btn.innerHTML = '<i class="spin"></i>' + (label || "Please wait"); }
    else btn.textContent = btn.dataset.label || btn.textContent;
  }
  async function api(action, payload) {
    const r = await fetch("/api/auth?action=" + action, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    let j = {};
    try { j = await r.json(); } catch {}
    return { status: r.status, ...j };
  }
  const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

  /* ---------- show / hide password, caps lock ---------- */
  document.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", () => {
    const i = $(b.dataset.eye), vis = i.type === "password";
    i.type = vis ? "text" : "password"; b.textContent = vis ? "Hide" : "Show";
    b.setAttribute("aria-label", vis ? "Hide password" : "Show password");
  }));
  $("authPassword").addEventListener("keyup", (e) => {
    if (e.getModifierState) $("leCaps").classList.toggle("hidden", !e.getModifierState("CapsLock"));
  });

  /* ---------- sign in ---------- */
  const remembered = store.get("le-email");
  if (remembered) { $("authEmail").value = remembered; $("leRemember").checked = store.get("le-remember") === "1"; }
  const reason = store.get("le-signout-reason");
  if (reason) { msg("leLoginMsg", reason, "info"); store.del("le-signout-reason"); }

  function lockCountdown(minutes) {
    clearInterval(lockTimer);
    let left = minutes * 60;
    const btn = $("signInBtn"); btn.disabled = true;
    const tick = () => {
      if (left <= 0) { clearInterval(lockTimer); btn.disabled = false; btn.textContent = "Sign in"; msg("leLoginMsg", ""); return; }
      btn.textContent = `Locked · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`; left--;
    };
    tick(); lockTimer = setInterval(tick, 1000);
  }

  $("leLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("authEmail").value.trim().toLowerCase(), password = $("authPassword").value;
    if (!validEmail(email) || !password) return msg("leLoginMsg", "Email aur password dono daalein.");
    msg("leLoginMsg", ""); busy($("signInBtn"), true, "Signing in");
    try {
      let r;
      try { r = await api("login", { email, password }); } catch { r = { status: 0, fallback: true }; }
      if (r.ok && r.session) {
        const { error } = await db.auth.setSession(r.session);
        if (error) throw error;
      } else if (r.fallback || r.status === 404 || r.status === 0) {
        // Server login not set up yet: fall back to Supabase directly (no lockout in this mode).
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw new Error(/confirm/i.test(error.message) ? "Pehle apna email confirm karein." : "Email ya password galat hai.");
      } else {
        busy($("signInBtn"), false);
        if (r.status === 429) { msg("leLoginMsg", r.error); return lockCountdown(r.lockedMinutes || 15); }
        let t = r.error || "Sign in nahi ho paya. Dobara try karein.";
        if (typeof r.attemptsLeft === "number" && r.attemptsLeft <= 2) t += ` ${r.attemptsLeft} try bache hain.`;
        return msg("leLoginMsg", t);
      }
      store.set("le-email", email);
      store.set("le-remember", $("leRemember").checked ? "1" : "0");
      $("authPassword").value = "";
      busy($("signInBtn"), false);
    } catch (err) {
      busy($("signInBtn"), false);
      msg("leLoginMsg", err.message || "Sign in nahi ho paya.");
    }
  });

  /* ---------- forgot password: email → code → new password ---------- */
  $("leForgotLink").addEventListener("click", () => {
    $("leFEmail").value = $("authEmail").value.trim(); msg("leForgotMsg", ""); show("leForgot");
  });
  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => { msg("leLoginMsg", ""); show("leLogin"); }));

  function startResend(sec) {
    clearInterval(resendTimer);
    const b = $("leResend"); let left = sec; b.disabled = true;
    const tick = () => {
      if (left <= 0) { clearInterval(resendTimer); b.disabled = false; b.textContent = "Naya code bhejein"; return; }
      b.textContent = `Naya code (${left}s)`; left--;
    };
    tick(); resendTimer = setInterval(tick, 1000);
  }
  async function requestCode(btn, msgId) {
    busy(btn, true, "Sending");
    try {
      const r = await api("forgot", { email: resetEmail });
      busy(btn, false);
      if (!r.ok) { msg(msgId, r.error || "Code nahi bhej paye. Thodi der baad try karein."); return false; }
      $("leCodeSub").textContent = `${resetEmail} par 6 digit code bheja gaya hai (agar is email ka account hai). 10 minute tak valid hai. Spam folder bhi dekhein.`;
      startResend(r.resendIn || 60);
      return true;
    } catch {
      busy(btn, false); msg(msgId, "Network problem. Dobara try karein."); return false;
    }
  }
  $("leForgot").addEventListener("submit", async (e) => {
    e.preventDefault();
    resetEmail = $("leFEmail").value.trim().toLowerCase();
    if (!validEmail(resetEmail)) return msg("leForgotMsg", "Sahi email daalein.");
    msg("leForgotMsg", "");
    if (await requestCode($("leSendCode"), "leForgotMsg")) { clearOtp(); msg("leCodeMsg", ""); show("leCode"); }
  });
  $("leResend").addEventListener("click", async () => {
    msg("leCodeMsg", "");
    if (await requestCode($("leResend"), "leCodeMsg")) { clearOtp(); msg("leCodeMsg", "Naya code bhej diya. Purana code ab kaam nahi karega.", "ok"); }
  });

  // six single-digit boxes: auto-advance, backspace, paste of the whole code
  const digits = [...document.querySelectorAll("#leOtp input")];
  function clearOtp() { digits.forEach((d) => (d.value = "")); }
  const codeValue = () => digits.map((d) => d.value).join("");
  digits.forEach((d, i) => {
    d.addEventListener("input", () => {
      d.value = d.value.replace(/\D/g, "").slice(-1);
      if (d.value && i < 5) digits[i + 1].focus();
      if (codeValue().length === 6) $("leCode").requestSubmit();
    });
    d.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !d.value && i > 0) digits[i - 1].focus();
      if (e.key === "ArrowLeft" && i > 0) digits[i - 1].focus();
      if (e.key === "ArrowRight" && i < 5) digits[i + 1].focus();
    });
    d.addEventListener("paste", (e) => {
      const t = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      if (!t) return;
      e.preventDefault();
      t.split("").forEach((c, k) => { if (digits[k]) digits[k].value = c; });
      digits[Math.min(t.length, 5)].focus();
      if (t.length === 6) $("leCode").requestSubmit();
    });
  });
  $("leCode").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = codeValue();
    if (code.length !== 6) return msg("leCodeMsg", "Poore 6 digit daalein.");
    busy($("leVerify"), true, "Checking");
    try {
      const r = await api("reset", { email: resetEmail, code, checkOnly: true });
      busy($("leVerify"), false);
      if (!r.ok) { msg("leCodeMsg", r.error || "Code galat hai."); clearOtp(); digits[0].focus(); return; }
      resetCode = code; msg("leNewMsg", ""); show("leNewPass");
    } catch { busy($("leVerify"), false); msg("leCodeMsg", "Network problem. Dobara try karein."); }
  });

  function strength(p) {
    let s = 0;
    if (p.length >= 8) s++; if (p.length >= 12) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
    return s;
  }
  $("leP1").addEventListener("input", () => {
    const s = strength($("leP1").value), m = $("leMeter");
    m.style.width = (s / 5) * 100 + "%";
    m.style.background = s <= 2 ? "var(--danger)" : s === 3 ? "var(--amber)" : "var(--ok)";
  });
  $("leNewPass").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = $("leP1").value, p2 = $("leP2").value;
    if (p1.length < 8 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1)) return msg("leNewMsg", "Kam se kam 8 characters, letters aur numbers dono.");
    if (p1 !== p2) return msg("leNewMsg", "Dono password same nahi hain.");
    busy($("leSavePass"), true, "Saving");
    try {
      const r = await api("reset", { email: resetEmail, code: resetCode, password: p1 });
      busy($("leSavePass"), false);
      if (!r.ok) {
        msg("leNewMsg", r.error || "Password save nahi hua.");
        if (r.expired) setTimeout(() => show("leForgot"), 1500);
        return;
      }
      $("leP1").value = $("leP2").value = ""; resetCode = "";
      $("authEmail").value = resetEmail; $("authPassword").value = "";
      show("leLogin"); msg("leLoginMsg", "Password badal gaya. Naye password se sign in karein.", "ok");
    } catch { busy($("leSavePass"), false); msg("leNewMsg", "Network problem. Dobara try karein."); }
  });

  /* ---------- smart sign-out ---------- */
  let idleTimer = null, warnTimer = null, warnBox = null, lastWrite = 0;
  const idleLimit = () => (store.get("le-remember") === "1" ? IDLE_LONG : IDLE_SHORT);
  const lastActive = () => Number(store.get("le-last") || Date.now());
  function touch() {
    const now = Date.now();
    if (now - lastWrite < 15000) return;   // shared across tabs, written at most every 15 s
    lastWrite = now; store.set("le-last", String(now));
    if (warnBox) closeWarn();
  }
  ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"].forEach((ev) => addEventListener(ev, touch, { passive: true }));

  function closeWarn() { clearInterval(warnTimer); warnBox?.remove(); warnBox = null; }
  function openWarn() {
    if (warnBox) return;
    warnBox = document.createElement("div");
    warnBox.className = "le-idle"; warnBox.setAttribute("role", "alertdialog");
    warnBox.innerHTML = `<div class="box"><h3>Aap wahan hain?</h3><p>Kuch der se koi activity nahi hui. Security ke liye aap apne aap sign out ho jayenge.</p><div class="count" id="leIdleCount">60</div><div class="row"><button class="le-btn ghost" id="leIdleOut">Sign out</button><button class="le-btn" id="leIdleStay">Signed in rahein</button></div></div>`;
    document.body.appendChild(warnBox);
    $("leIdleStay").onclick = () => { lastWrite = 0; touch(); closeWarn(); };
    $("leIdleOut").onclick = () => leSignOut("manual");
    $("leIdleStay").focus();
    warnTimer = setInterval(() => {
      const left = Math.max(0, Math.ceil((lastActive() + idleLimit() - Date.now()) / 1000));
      if ($("leIdleCount")) $("leIdleCount").textContent = left;
    }, 500);
  }
  function check() {
    if (!user) return;
    const idle = Date.now() - lastActive();
    if (idle >= idleLimit()) return leSignOut("idle");
    if (idle >= idleLimit() - WARN) openWarn(); else closeWarn();
  }
  function startIdle() {
    clearInterval(idleTimer);
    lastWrite = 0; touch();
    idleTimer = setInterval(check, 5000);
    const h = $("leIdleHint");
    if (h) h.textContent = store.get("le-remember") === "1" ? "Auto sign-out: 8 ghante" : "Auto sign-out: 30 min";
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });

  async function leSignOut(why) {
    clearInterval(idleTimer); closeWarn();
    if (why === "idle") store.set("le-signout-reason", "Aap kaafi der inactive the, isliye security ke liye sign out kar diya. Dobara sign in karein.");
    try { await db.auth.signOut({ scope: why === "all" ? "global" : "local" }); } catch {}
    chan?.postMessage({ type: "signout" });
    store.del("le-last");
    location.reload(); // wipes every lead from memory and shows the sign-in screen
  }
  chan && (chan.onmessage = (e) => { if (e.data?.type === "signout" && user) location.reload(); });
  addEventListener("storage", (e) => { if (e.key === "le-last" && warnBox && Date.now() - lastActive() < idleLimit() - WARN) closeWarn(); });

  window.leSignOut = leSignOut;
  window.leOnSignedIn = () => { startIdle(); show("leLogin"); msg("leLoginMsg", ""); };

  // A tab reopened after the idle limit must not slip back in on an old session.
  db.auth.getSession().then(({ data }) => {
    if (data.session && store.get("le-last") && Date.now() - lastActive() >= idleLimit()) leSignOut("idle");
  });
})();
