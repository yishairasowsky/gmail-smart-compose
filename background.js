/**
 * Gmail Smart Compose – Background Service Worker
 *
 * Handles messages from the content script and calls the AI API
 * for auto-correction and translation.
 */

// Load settings from storage (users configure their API key in the popup)
async function getSettings() {
  const data = await chrome.storage.sync.get({
    apiKey: "",
    targetLanguage: "en",
    model: "claude-haiku-4-5-20251001",
  });
  return data;
}

// ---------------------------------------------------------------------------
// AI call helper
// ---------------------------------------------------------------------------

async function callAI(systemPrompt, userText) {
  const { apiKey, model } = await getSettings();

  if (!apiKey) {
    throw new Error(
      "No API key configured. Click the extension icon to add your Anthropic API key."
    );
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API error ${resp.status}: ${err}`);
  }

  const json = await resp.json();
  return json.content[0].text;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "autocorrect") {
    const threadHint = msg.threadContext
      ? `\n\nHere is the prior conversation thread for tone context (DO NOT include any of this in your output):\n---\n${msg.threadContext}\n---`
      : "";
    callAI(
      "You are an expert email editor. Your job is to polish the user's draft email. " +
        "Fix all spelling and grammar mistakes. " +
        "Make the tone diplomatic, tactful, and professional. " +
        "Mirror the tone and style of the conversation thread — if the thread is brief and direct, keep it brief and direct; if formal, stay formal. " +
        "Preserve the original language (don't translate). " +
        "Preserve the user's intent and key points exactly. " +
        "Return ONLY the polished text, nothing else. No greetings or sign-offs unless the user included them.",
      msg.text + threadHint
    )
      .then(sendResponse)
      .catch((e) => {
        console.error("[GSC background]", e);
        sendResponse(null);
      });
    return true; // keep channel open for async response
  }

  if (msg.action === "translate") {
    getSettings().then(({ targetLanguage }) => {
      callAI(
        `You are a translator. Translate the following text to ${targetLanguage}. ` +
          "Return ONLY the translated text, nothing else.",
        msg.text
      )
        .then(sendResponse)
        .catch((e) => {
          console.error("[GSC background]", e);
          sendResponse(null);
        });
    });
    return true;
  }
});
