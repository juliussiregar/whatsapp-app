import {
  $,
  updateTopbar,
  updateMeta,
  bindTopbarActions,
  startStatusPolling,
  initNavigation,
} from "./shared.js";
import { getLastPage } from "./ux.js";

const panels = {
  qr: $("panel-qr"),
  loading: $("panel-loading"),
  error: $("panel-error"),
  ready: $("panel-ready-hint"),
};

let didRedirect = false;

function showPanel(name) {
  for (const [key, el] of Object.entries(panels)) {
    if (el) el.hidden = key !== name;
  }
}

function maybeRedirectWhenReady() {
  if (didRedirect) return;
  const last = getLastPage();
  if (last && last !== "/app") {
    didRedirect = true;
    window.location.replace(last);
  }
}

function updateConnectUI(status) {
  const { state, ready, message, lastError } = status;
  updateTopbar(status);
  updateMeta(status);

  if (ready) {
    showPanel("ready");
    maybeRedirectWhenReady();
    return;
  }

  if (state === "waiting_qr") {
    showPanel("qr");
    return;
  }
  if (
    state === "initializing" ||
    state === "authenticated" ||
    state === "loading"
  ) {
    showPanel("loading");
    const title = $("loading-title");
    const msg = $("loading-message");
    if (title) {
      title.textContent =
        state === "authenticated"
          ? "Terverifikasi"
          : state === "loading"
            ? "Memuat WhatsApp Web"
            : "Menghubungkan…";
    }
    if (msg) msg.textContent = message;
    return;
  }
  if (state === "disconnected" || state === "error") {
    showPanel("error");
    const errEl = $("error-message");
    if (errEl) {
      errEl.textContent = lastError
        ? `${message} (${lastError})`
        : message;
    }
    return;
  }
  showPanel("loading");
  const msg = $("loading-message");
  if (msg) msg.textContent = message;
}

initNavigation();
bindTopbarActions();
startStatusPolling(updateConnectUI);
