import {
  API,
  $,
  busy,
  setBusy,
  fetchJson,
  showFeedback,
  hideFeedback,
  bindTopbarActions,
  requireReady,
  initNavigation,
  showToast,
} from "./shared.js";
import {
  bindComposerEnter,
  normalizePhoneInput,
  saveRecentPhone,
  renderRecentPhonesDatalist,
} from "./ux.js";

initNavigation();
bindTopbarActions();
requireReady();
bindComposerEnter("form-quick-send", "input-quick-msg");
renderRecentPhonesDatalist("recent-phones", "input-phone");

$("form-quick-send")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const phoneInput = $("input-phone");
  const phoneNumber = phoneInput?.value.trim();
  const message = $("input-quick-msg")?.value.trim();
  if (!phoneNumber || !message) return;

  const check = normalizePhoneInput(phoneNumber);
  if (!check.ok) {
    showFeedback($("quick-feedback"), check.message, false);
    showToast(check.message, false);
    return;
  }

  setBusy(true);
  const sendBtn = $("btn-quick-send");
  if (sendBtn) sendBtn.disabled = true;
  hideFeedback($("quick-feedback"));
  try {
    const res = await fetchJson(API.sendMessage, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber, message }),
    });
    saveRecentPhone(phoneNumber);
    renderRecentPhonesDatalist("recent-phones", "input-phone");
    showFeedback($("quick-feedback"), `Terkirim ke ${res.to}`, true, true);
    const msgInput = $("input-quick-msg");
    if (msgInput) msgInput.value = "";
    phoneInput?.focus();
  } catch (err) {
    showFeedback($("quick-feedback"), err.message, false);
    showToast(err.message, false);
  } finally {
    setBusy(false);
    if (sendBtn) sendBtn.disabled = false;
  }
});
