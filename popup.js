// Load saved settings
chrome.storage.sync.get({ apiKey: "", targetLanguage: "en" }, (data) => {
  document.getElementById("apiKey").value = data.apiKey;
  document.getElementById("targetLanguage").value = data.targetLanguage;
});

// Save settings
document.getElementById("save").addEventListener("click", () => {
  const apiKey = document.getElementById("apiKey").value.trim();
  const targetLanguage = document.getElementById("targetLanguage").value;

  chrome.storage.sync.set({ apiKey, targetLanguage }, () => {
    const status = document.getElementById("status");
    status.textContent = "Saved!";
    setTimeout(() => (status.textContent = ""), 2000);
  });
});
