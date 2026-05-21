/**
 * Gmail Smart Compose – Content Script
 *
 * Injects Auto-correct and Translate buttons into Gmail compose windows.
 * Uses the Send button as the single anchor point per compose window,
 * and marks the compose container to prevent duplicate injection.
 */

const MARKER = "data-gsc-injected";
let scanTimer = null;

// ---------------------------------------------------------------------------
// Button creation
// ---------------------------------------------------------------------------

function createButton(label, className, icon, onClick) {
  const btn = document.createElement("button");
  btn.className = `gsc-btn ${className}`;
  btn.type = "button";
  btn.innerHTML = `<span class="gsc-icon">${icon}</span> ${label}`;
  btn.addEventListener("click", onClick);
  return btn;
}

// ---------------------------------------------------------------------------
// Compose-body helpers
// ---------------------------------------------------------------------------

function getComposeBody(container) {
  return container.querySelector('[role="textbox"][contenteditable="true"]')
      || container.querySelector('div[aria-label][contenteditable="true"]');
}

function getComposeText(container) {
  const body = getComposeBody(container);
  return body ? body.innerText : "";
}

function setComposeText(container, text) {
  const body = getComposeBody(container);
  if (body) {
    body.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
  }
}

// ---------------------------------------------------------------------------
// Core features
// ---------------------------------------------------------------------------

async function handleAutoCorrect(e) {
  const btn = e.currentTarget;
  const container = btn.closest(`[${MARKER}]`);
  if (!container) return;
  const text = getComposeText(container);
  if (!text.trim()) return;

  btn.classList.add("gsc-loading");
  try {
    const corrected = await chrome.runtime.sendMessage({
      action: "autocorrect",
      text,
    });
    if (corrected && corrected !== text) {
      setComposeText(container, corrected);
    }
  } catch (err) {
    console.error("[GSC] Auto-correct error:", err);
  } finally {
    btn.classList.remove("gsc-loading");
  }
}

async function handleTranslate(e) {
  const btn = e.currentTarget;
  const container = btn.closest(`[${MARKER}]`);
  if (!container) return;
  const text = getComposeText(container);
  if (!text.trim()) return;

  btn.classList.add("gsc-loading");
  try {
    const translated = await chrome.runtime.sendMessage({
      action: "translate",
      text,
    });
    if (translated && translated !== text) {
      setComposeText(container, translated);
    }
  } catch (err) {
    console.error("[GSC] Translate error:", err);
  } finally {
    btn.classList.remove("gsc-loading");
  }
}

// ---------------------------------------------------------------------------
// Injection – one set of buttons per compose window
// ---------------------------------------------------------------------------

function injectButtons(composeContainer, sendBtnRow) {
  // Already injected into this compose window? Skip.
  if (composeContainer.hasAttribute(MARKER)) return;
  composeContainer.setAttribute(MARKER, "true");

  const wrapper = document.createElement("span");
  wrapper.className = "gsc-button-wrapper";

  wrapper.appendChild(
    createButton("Auto-correct", "gsc-btn--autocorrect", "\u270D", handleAutoCorrect)
  );
  wrapper.appendChild(
    createButton("Translate", "gsc-btn--translate", "\uD83C\uDF10", handleTranslate)
  );

  // Insert buttons next to the Send button row
  sendBtnRow.appendChild(wrapper);
}

// ---------------------------------------------------------------------------
// Scanner – finds compose windows via their Send button
// ---------------------------------------------------------------------------

function scanForComposeWindows() {
  // Find all Send buttons in Gmail
  const sendButtons = document.querySelectorAll(
    'div[role="button"][data-tooltip*="Send"], div[role="button"][aria-label*="Send"]'
  );

  sendButtons.forEach((sendBtn) => {
    // Walk up to the compose container (dialog or form)
    const composeContainer =
      sendBtn.closest('[role="dialog"]') ||
      sendBtn.closest("form") ||
      sendBtn.closest(".M9");

    if (!composeContainer) return;
    if (composeContainer.hasAttribute(MARKER)) return;

    // Find the row/cell the Send button lives in
    const sendRow =
      sendBtn.closest("tr") ||
      sendBtn.closest("td") ||
      sendBtn.parentElement;

    if (sendRow) {
      injectButtons(composeContainer, sendRow);
    }
  });
}

// ---------------------------------------------------------------------------
// Debounced MutationObserver
// ---------------------------------------------------------------------------

const observer = new MutationObserver(() => {
  // Debounce: wait for DOM to settle before scanning
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(scanForComposeWindows, 300);
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan
scanForComposeWindows();
