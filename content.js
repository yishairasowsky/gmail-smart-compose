/**
 * Gmail Smart Compose – Content Script
 *
 * Injects Polish and Translate buttons into Gmail compose windows.
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
  // Use mousedown — Gmail intercepts click events on injected elements
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(e);
  }, true);
  return btn;
}

// ---------------------------------------------------------------------------
// Compose-body helpers
// ---------------------------------------------------------------------------

function getComposeBody(container) {
  return container.querySelector('[role="textbox"][contenteditable="true"]')
      || container.querySelector('div[aria-label][contenteditable="true"]');
}

/**
 * Extracts only the user's own text from the compose body,
 * stopping before any quoted/forwarded thread content.
 * Returns { userText, userNodes } where userNodes are the DOM nodes
 * containing the user's text (so we can replace just those).
 */
function getUserText(container) {
  const body = getComposeBody(container);
  if (!body) return { userText: "", userNodes: [] };

  const children = Array.from(body.childNodes);
  const userParts = [];
  const userNodes = [];

  for (const node of children) {
    const text = node.textContent || "";
    const tag = node.nodeName ? node.nodeName.toLowerCase() : "";

    // Stop at Gmail's quoted-reply container
    if (node.nodeType === 1) {
      const el = /** @type {Element} */ (node);
      // Gmail wraps quoted content in a div with class "gmail_quote"
      if (el.classList && el.classList.contains("gmail_quote")) break;
      // Also stop at forwarded message markers
      if (el.querySelector && el.querySelector('.gmail_quote')) break;
    }

    // Stop at "---------- Forwarded message ---------" or "On ... wrote:"
    if (/^-{5,}\s*(Forwarded message|הודעה שהועברה)/.test(text.trim())) break;
    if (/^On .+ wrote:\s*$/.test(text.trim())) break;

    // Stop at blockquote elements (another way Gmail shows quoted text)
    if (tag === "blockquote") break;

    userParts.push(text);
    userNodes.push(node);
  }

  // Collect the rest as thread context
  const threadParts = [];
  let inThread = false;
  for (const node of children) {
    if (inThread) {
      threadParts.push(node.textContent || "");
    } else if (!userNodes.includes(node)) {
      inThread = true;
      threadParts.push(node.textContent || "");
    }
  }

  return {
    userText: userParts.join("\n").trim(),
    threadContext: threadParts.join("\n").trim().slice(0, 2000),
    userNodes,
  };
}

function setUserText(container, newText, userNodes) {
  const body = getComposeBody(container);
  if (!body || userNodes.length === 0) return;

  body.focus();

  // Select only the user's nodes (not the quoted thread)
  const range = document.createRange();
  range.setStartBefore(userNodes[0]);
  range.setEndAfter(userNodes[userNodes.length - 1]);

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  // Replace just the selected range, preserving spacing before thread
  document.execCommand("insertText", false, newText + "\n\n");

  // Place cursor at the end of the user's text (not the thread)
  const newSel = window.getSelection();
  if (newSel.rangeCount > 0) {
    const r = newSel.getRangeAt(0);
    r.collapse(false);
    newSel.removeAllRanges();
    newSel.addRange(r);
  }
}

// ---------------------------------------------------------------------------
// Core features
// ---------------------------------------------------------------------------

function showError(btn, msg) {
  const origText = btn.innerHTML;
  btn.innerHTML = `<span style="color:#fff">${msg}</span>`;
  btn.style.backgroundColor = "#d93025";
  setTimeout(() => {
    btn.innerHTML = origText;
    btn.style.backgroundColor = "";
  }, 4000);
}

async function handleAutoCorrect(e) {
  const btn = e.currentTarget;
  const container = btn.closest(`[${MARKER}]`);
  if (!container) { showError(btn, "No container found"); return; }
  const { userText, threadContext, userNodes } = getUserText(container);
  if (!userText.trim()) { showError(btn, "No text found"); return; }

  btn.classList.add("gsc-loading");
  btn.innerHTML = `<span class="gsc-icon">\u270D</span> Working...`;
  try {
    const corrected = await chrome.runtime.sendMessage({
      action: "autocorrect",
      text: userText,
      threadContext: threadContext || "",
    });
    if (corrected && corrected !== userText) {
      setUserText(container, corrected, userNodes);
      btn.innerHTML = `<span class="gsc-icon">\u270D</span> Done!`;
    } else if (corrected) {
      btn.innerHTML = `<span class="gsc-icon">\u270D</span> Already correct`;
    } else {
      showError(btn, "API error - check key");
    }
  } catch (err) {
    showError(btn, err.message.slice(0, 30));
  } finally {
    btn.classList.remove("gsc-loading");
    setTimeout(() => {
      btn.innerHTML = `<span class="gsc-icon">\u270D</span> Polish`;
    }, 2000);
  }
}

async function handleTranslate(e) {
  const btn = e.currentTarget;
  const container = btn.closest(`[${MARKER}]`);
  if (!container) { showError(btn, "No container found"); return; }
  const { userText, threadContext, userNodes } = getUserText(container);
  if (!userText.trim()) { showError(btn, "No text found"); return; }

  btn.classList.add("gsc-loading");
  btn.innerHTML = `<span class="gsc-icon">\uD83C\uDF10</span> Working...`;
  try {
    const translated = await chrome.runtime.sendMessage({
      action: "translate",
      text: userText,
      threadContext: threadContext || "",
    });
    if (translated && translated !== userText) {
      setUserText(container, translated, userNodes);
      btn.innerHTML = `<span class="gsc-icon">\uD83C\uDF10</span> Done!`;
    } else if (translated) {
      btn.innerHTML = `<span class="gsc-icon">\uD83C\uDF10</span> Same text`;
    } else {
      showError(btn, "API error - check key");
    }
  } catch (err) {
    showError(btn, err.message.slice(0, 30));
  } finally {
    btn.classList.remove("gsc-loading");
    setTimeout(() => {
      btn.innerHTML = `<span class="gsc-icon">\uD83C\uDF10</span> Translate`;
    }, 2000);
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
    createButton("Polish", "gsc-btn--polish", "\u270D", handleAutoCorrect)
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
