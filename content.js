/**
 * Gmail Smart Compose – Content Script
 *
 * Injects Auto-correct and Translate buttons into Gmail compose windows.
 * KEY FIX: uses a data-attribute guard so buttons are never injected twice,
 * even when Gmail's SPA navigation re-triggers the observer.
 */

const MARKER = "data-gsc-injected";

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

function getComposeBody(toolbar) {
  // Walk up from the toolbar to find the editable compose div
  const form = toolbar.closest("form") || toolbar.closest('[role="dialog"]');
  if (!form) return null;
  return form.querySelector('[role="textbox"][contenteditable="true"]')
      || form.querySelector('div[aria-label][contenteditable="true"]');
}

function getComposeText(toolbar) {
  const body = getComposeBody(toolbar);
  return body ? body.innerText : "";
}

function setComposeText(toolbar, text) {
  const body = getComposeBody(toolbar);
  if (body) {
    body.focus();
    // Use execCommand so Gmail registers the change in its internal state
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
  }
}

// ---------------------------------------------------------------------------
// Core features
// ---------------------------------------------------------------------------

async function handleAutoCorrect(e) {
  const btn = e.currentTarget;
  const toolbar = btn.closest("tr") || btn.parentElement;
  const text = getComposeText(toolbar);
  if (!text.trim()) return;

  btn.classList.add("gsc-loading");
  try {
    const corrected = await chrome.runtime.sendMessage({
      action: "autocorrect",
      text,
    });
    if (corrected && corrected !== text) {
      setComposeText(toolbar, corrected);
    }
  } catch (err) {
    console.error("[GSC] Auto-correct error:", err);
  } finally {
    btn.classList.remove("gsc-loading");
  }
}

async function handleTranslate(e) {
  const btn = e.currentTarget;
  const toolbar = btn.closest("tr") || btn.parentElement;
  const text = getComposeText(toolbar);
  if (!text.trim()) return;

  btn.classList.add("gsc-loading");
  try {
    const translated = await chrome.runtime.sendMessage({
      action: "translate",
      text,
    });
    if (translated && translated !== text) {
      setComposeText(toolbar, translated);
    }
  } catch (err) {
    console.error("[GSC] Translate error:", err);
  } finally {
    btn.classList.remove("gsc-loading");
  }
}

// ---------------------------------------------------------------------------
// Injection (with duplicate guard)
// ---------------------------------------------------------------------------

function injectButtons(toolbar) {
  // *** THIS IS THE FIX: skip if we already injected into this toolbar ***
  if (toolbar.hasAttribute(MARKER)) return;
  toolbar.setAttribute(MARKER, "true");

  const container =
    toolbar.querySelector("td.btC") ||  // bottom toolbar cell
    toolbar.querySelector("tr > td:last-child") ||
    toolbar;

  const autocorrectBtn = createButton(
    "Auto-correct", "gsc-btn--autocorrect", "\u270D", handleAutoCorrect
  );
  const translateBtn = createButton(
    "Translate", "gsc-btn--translate", "\uD83C\uDF10", handleTranslate
  );

  container.appendChild(autocorrectBtn);
  container.appendChild(translateBtn);
}

// ---------------------------------------------------------------------------
// Observer – watches for new compose windows
// ---------------------------------------------------------------------------

function scanForToolbars() {
  // Gmail compose bottom toolbar rows
  const toolbars = document.querySelectorAll(
    'tr.btC, div.btC, table.IZ td.gU, div[role="dialog"] .bAK'
  );
  toolbars.forEach(injectButtons);

  // Fallback: look for the Send button's toolbar row
  const sendButtons = document.querySelectorAll('div[role="button"][data-tooltip*="Send"]');
  sendButtons.forEach((btn) => {
    const row = btn.closest("tr") || btn.closest("div.btC");
    if (row) injectButtons(row);
  });
}

const observer = new MutationObserver(() => {
  scanForToolbars();
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan
scanForToolbars();
