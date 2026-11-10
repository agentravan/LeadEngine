// Settings page: keys and passwords are sent once to the server, stored encrypted, and never read back.
// Uses globals from app.js: db, $, user, esc, toast.
(function () {
  const IDS = ["zohoEmail", "zohoPassword", "notifyEmail", "smtpHost", "imapHost", "searchProvider", "searchKey", "searchZone", "aiKey", "aiModel"];
  const SECRET = new Set(["zohoPassword", "searchKey", "aiKey"]);
  let loaded = null;

  async function call(method, path, payload) {
    const { data } = await db.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Session khatam ho gaya. Dobara sign in karein.");
    const r = await fetch(path, {
      method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.error || "Server error " + r.status);
    return j;
  }
  const say = (t, ok) => { const m = $("sMsg"); m.textContent = t; m.style.color = ok === false ? "#b42318" : ok ? "#127a5b" : ""; };

  function fill(fields) {
    loaded = fields;
    for (const k of IDS) {
      const el = $("s_" + k), f = fields[k] || {};
      if (!el) continue;
      if (SECRET.has(k)) { el.value = ""; el.placeholder = f.set ? `Saved ${f.hint} · badalne ke liye naya daalein` : el.dataset.ph || el.placeholder; }
      else el.value = f.set ? f.value : "";
    }
  }

  async function drawSettings() {
    for (const k of IDS) { const el = $("s_" + k); if (el && !el.dataset.ph) el.dataset.ph = el.placeholder; }
    const last = user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—";
    let remember = "0"; try { remember = localStorage.getItem("le-remember") || "0"; } catch {}
    $("sSec").innerHTML = `Signed in: <b>${esc(user?.email || "")}</b> · Last sign-in: ${esc(last)} IST<br>Auto sign-out: ${remember === "1" ? "8 ghante" : "30 minute"} tak kuch na karne par. Naye device se login par email alert aata hai (Zoho set hone ke baad).`;
    say("Loading…");
    try {
      const j = await call("GET", "/api/settings");
      fill(j.fields);
      say(j.owner ? "Saved settings load ho gayi." : "Pehli baar Save karte hi ye account is LeadEngine ka owner ban jayega.", true);
    } catch (e) { say(e.message, false); }
  }

  $("sSave").addEventListener("click", async () => {
    const values = {};
    for (const k of IDS) {
      const el = $("s_" + k); if (!el) continue;
      const v = el.value.trim();
      if (SECRET.has(k)) { if (v) values[k] = v; }
      else if (v !== ((loaded?.[k]?.value) || "")) values[k] = v;
    }
    const clear = IDS.filter((k) => !SECRET.has(k) && loaded?.[k]?.set && values[k] === "");
    if (!Object.keys(values).length && !clear.length) return say("Kuch badla nahi.");
    $("sSave").disabled = true; say("Saving…");
    try {
      const j = await call("POST", "/api/settings", { values, clear });
      fill(j.fields); say("Saved. Secret values ab sirf server par hain.", true); toast("Settings saved.");
    } catch (e) { say(e.message, false); }
    $("sSave").disabled = false;
  });

  $("sTest").addEventListener("click", async () => {
    $("sTest").disabled = true; say("Zoho, search aur AI check ho rahe hain… (20–40 sec)");
    try {
      const { test } = await call("POST", "/api/settings?test=1", {});
      const line = (n, r) => `${r?.ok ? "✓" : "✗"} ${n}: ${r?.msg || "—"}`;
      const all = test.zoho?.ok && test.search?.ok && test.ai?.ok;
      say([line("Zoho", test.zoho), line("Search", test.search), line("AI", test.ai)].join("   ·   "), !!all);
    } catch (e) { say(e.message, false); }
    $("sTest").disabled = false;
  });

  $("sLogoutAll").addEventListener("click", () => {
    const b = $("sLogoutAll");
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Pakka? Dobara dabayein"; setTimeout(() => { b.dataset.confirm = ""; b.textContent = "Sab devices se sign out"; }, 4000); return; }
    window.leSignOut ? window.leSignOut("all") : db.auth.signOut({ scope: "global" }).then(() => location.reload());
  });

  window.drawSettings = drawSettings;
})();
