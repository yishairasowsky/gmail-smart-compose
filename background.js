/**
 * Gmail Smart Compose – Background Service Worker
 * Proxies AI requests through our backend (auth + usage tracking).
 */

const SERVER = "https://gmail-smart-compose-api.onrender.com";

async function getToken() {
  const data = await chrome.storage.sync.get("token");
  return data.token || null;
}

async function callBackend(endpoint, body) {
  const token = await getToken();
  if (!token) throw new Error("Please log in via the extension popup.");

  const resp = await fetch(SERVER + endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();

  if (resp.status === 402) {
    throw new Error(data.error + " Click the extension icon to upgrade.");
  }
  if (!resp.ok) {
    throw new Error(data.error || "Server error");
  }

  return data.result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "polish") {
    callBackend("/api/polish", {
      text: msg.text,
      threadContext: msg.threadContext || "",
    })
      .then(sendResponse)
      .catch((e) => {
        console.error("[GSC background]", e);
        sendResponse({ error: e.message });
      });
    return true;
  }

  if (msg.action === "translate") {
    chrome.storage.sync.get({ targetLanguage: "en" }, (settings) => {
      callBackend("/api/translate", {
        text: msg.text,
        targetLanguage: settings.targetLanguage,
      })
        .then(sendResponse)
        .catch((e) => {
          console.error("[GSC background]", e);
          sendResponse({ error: e.message });
        });
    });
    return true;
  }
});
