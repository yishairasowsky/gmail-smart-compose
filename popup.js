const SERVER = "https://gmail-smart-compose-api.onrender.com";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mode = "login"; // "login" | "register"

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function showStatus(id, msg, ok = true) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = "status " + (ok ? "ok" : "err");
  if (ok) setTimeout(() => (el.textContent = ""), 2500);
}

function renderUsage(data) {
  const section = document.getElementById("usage-section");
  if (data.plan === "paid") {
    section.innerHTML = `<div class="usage-label">Unlimited uses ✓</div>`;
    document.getElementById("upgrade-btn").style.display = "none";
    document.getElementById("plan-badge").textContent = "Pro";
    document.getElementById("plan-badge").className = "plan-badge paid";
  } else {
    const used = data.polish || 0;
    const limit = data.limit || 20;
    const pct = Math.min(100, Math.round((used / limit) * 100));
    section.innerHTML = `
      <div class="usage-bar"><div class="usage-bar-fill" style="width:${pct}%"></div></div>
      <div class="usage-label">${used} / ${limit} free polishes used this month</div>
    `;
    document.getElementById("upgrade-btn").style.display =
      used >= limit * 0.8 ? "block" : "none";
    document.getElementById("plan-badge").textContent = "Free";
    document.getElementById("plan-badge").className = "plan-badge free";
  }
}

// ---------------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------------

document.getElementById("tab-login").addEventListener("click", () => {
  mode = "login";
  document.getElementById("auth-btn").textContent = "Log in";
  document.getElementById("tab-login").style.background = "#e8f0fe";
  document.getElementById("tab-register").style.background = "#fff";
});

document.getElementById("tab-register").addEventListener("click", () => {
  mode = "register";
  document.getElementById("auth-btn").textContent = "Sign up";
  document.getElementById("tab-register").style.background = "#e8f0fe";
  document.getElementById("tab-login").style.background = "#fff";
});

document.getElementById("auth-btn").addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) {
    document.getElementById("auth-error").textContent = "Please fill in both fields";
    return;
  }

  const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
  try {
    const resp = await fetch(SERVER + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      document.getElementById("auth-error").textContent = data.error;
      return;
    }
    await chrome.storage.sync.set({ token: data.token, plan: data.plan });
    showLoggedIn(data.plan);
    fetchUsage(data.token);
  } catch (e) {
    document.getElementById("auth-error").textContent = "Could not connect to server";
  }
});

// ---------------------------------------------------------------------------
// Logged-in flow
// ---------------------------------------------------------------------------

async function fetchUsage(token) {
  try {
    const resp = await fetch(SERVER + "/api/usage", {
      headers: { Authorization: "Bearer " + token },
    });
    if (resp.ok) renderUsage(await resp.json());
  } catch {}
}

function showLoggedIn(plan) {
  document.getElementById("logged-out").style.display = "none";
  document.getElementById("logged-in").style.display = "block";
}

function showLoggedOut() {
  document.getElementById("logged-out").style.display = "block";
  document.getElementById("logged-in").style.display = "none";
}

document.getElementById("save-lang").addEventListener("click", () => {
  const lang = document.getElementById("targetLanguage").value;
  chrome.storage.sync.set({ targetLanguage: lang }, () =>
    showStatus("save-status", "Saved!")
  );
});

document.getElementById("logout-btn").addEventListener("click", () => {
  chrome.storage.sync.remove(["token", "plan"], showLoggedOut);
});

document.getElementById("upgrade-btn").addEventListener("click", async () => {
  const { token } = await chrome.storage.sync.get("token");
  const resp = await fetch(SERVER + "/stripe/checkout", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  if (data.url) chrome.tabs.create({ url: data.url });
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

chrome.storage.sync.get(["token", "plan", "targetLanguage"], async (data) => {
  if (data.targetLanguage)
    document.getElementById("targetLanguage").value = data.targetLanguage;

  if (data.token) {
    showLoggedIn(data.plan);
    fetchUsage(data.token);
  } else {
    showLoggedOut();
  }
});
