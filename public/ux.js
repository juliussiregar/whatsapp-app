import { escapeHtml } from "./message-format.js";

const STATE_LABELS_UI = {
  initializing: "Inisialisasi",
  waiting_qr: "Scan QR",
  authenticated: "Memverifikasi",
  loading: "Memuat WhatsApp",
  ready: "Siap",
  disconnected: "Terputus",
  error: "Error",
};

const LAST_PAGE_KEY = "wa-last-page";
const LAST_CHAT_PREFIX = "wa-last-chat-";

export function saveLastPage() {
  const path = window.location.pathname.replace(/\/$/, "") || "/app";
  if (path !== "/app") {
    try {
      localStorage.setItem(LAST_PAGE_KEY, path);
    } catch {
      /* ignore */
    }
  }
}

export function getLastPage() {
  try {
    return localStorage.getItem(LAST_PAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastChatId(scope, chatId) {
  try {
    localStorage.setItem(`${LAST_CHAT_PREFIX}${scope}`, chatId);
  } catch {
    /* ignore */
  }
}

export function getLastChatId(scope) {
  try {
    return localStorage.getItem(`${LAST_CHAT_PREFIX}${scope}`);
  } catch {
    return null;
  }
}

let toastRoot = null;

function ensureToastRoot() {
  if (toastRoot) return toastRoot;
  toastRoot = document.createElement("div");
  toastRoot.id = "toast-root";
  toastRoot.className = "toast-root";
  toastRoot.setAttribute("aria-live", "polite");
  document.body.appendChild(toastRoot);
  return toastRoot;
}

export function showToast(message, ok = true, ms = 3200) {
  const root = ensureToastRoot();
  const el = document.createElement("div");
  el.className = `toast ${ok ? "toast--ok" : "toast--err"}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--visible"));
  setTimeout(() => {
    el.classList.remove("toast--visible");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function bindComposerEnter(formId, textareaId) {
  const form = document.getElementById(formId);
  const ta = document.getElementById(textareaId);
  if (!form || !ta) return;
  ta.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (!ta.disabled && form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { cancelable: true }));
  });
}

export function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.loading) {
      btn.dataset.loading = "1";
      btn.dataset.prevDisabled = btn.disabled ? "1" : "0";
      btn.disabled = true;
      btn.classList.add("btn--loading");
      if (btn.classList.contains("btn--icon")) {
        btn.dataset.prevLabel = btn.textContent;
        btn.textContent = "…";
      }
    }
  } else {
    if (btn.dataset.loading) {
      btn.disabled = btn.dataset.prevDisabled === "1";
      btn.classList.remove("btn--loading");
      if (btn.dataset.prevLabel !== undefined) {
        btn.textContent = btn.dataset.prevLabel;
        delete btn.dataset.prevLabel;
      }
      delete btn.dataset.loading;
      delete btn.dataset.prevDisabled;
    }
  }
}

export function renderChatListSkeleton(container, count = 8) {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `<li class="skeleton-chat-item">
      <span class="skeleton skeleton--avatar"></span>
      <span class="skeleton-chat-item__lines">
        <span class="skeleton skeleton--line skeleton--w80"></span>
        <span class="skeleton skeleton--line skeleton--w55"></span>
      </span>
    </li>`;
  }
  container.innerHTML = html;
}

export function renderMessagesSkeleton(container, count = 5) {
  let html = "";
  for (let i = 0; i < count; i++) {
    const out = i % 3 === 1;
    html += `<div class="skeleton-msg ${out ? "skeleton-msg--out" : "skeleton-msg--in"}">
      <span class="skeleton skeleton--bubble"></span>
    </div>`;
  }
  container.innerHTML = html;
}

function highlightHtml(text, query) {
  const safe = escapeHtml(text);
  const q = query.trim();
  if (!q) return safe;
  const re = new RegExp(
    `(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  return safe.replace(re, '<mark class="chat-list__mark">$1</mark>');
}

export function highlightSearchName(name, query) {
  return highlightHtml(name, query);
}

export const LIVE_REFRESH_MS = 10000;

/**
 * Polling otomatis saat tab/halaman chat terbuka (visibility API).
 * @returns {{ stop: () => void, refreshNow: () => Promise<void> }}
 */
export function startLiveRefresh({ intervalMs = LIVE_REFRESH_MS, shouldRun, onTick }) {
  let timer = null;
  let running = false;

  async function tick() {
    if (document.hidden || running) return;
    if (!shouldRun()) return;
    running = true;
    try {
      await onTick();
    } catch (err) {
      console.warn("[live-refresh]", err);
    } finally {
      running = false;
    }
  }

  function onVisibility() {
    if (!document.hidden && shouldRun()) void tick();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", stop);
  }

  timer = setInterval(tick, intervalMs);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", stop);

  return { stop, refreshNow: tick };
}

export function setLiveIndicator(active) {
  const el = document.getElementById("live-indicator");
  if (el) el.hidden = !active;
}

export function initScrollToBottom(messagesEl, btn) {
  if (!messagesEl || !btn) return () => {};

  const update = () => {
    const gap =
      messagesEl.scrollHeight -
      messagesEl.scrollTop -
      messagesEl.clientHeight;
    btn.hidden = gap < 100 || messagesEl.scrollHeight <= messagesEl.clientHeight;
  };

  messagesEl.addEventListener("scroll", update, { passive: true });
  btn.addEventListener("click", () => {
    messagesEl.scrollTo({
      top: messagesEl.scrollHeight,
      behavior: "smooth",
    });
  });

  return update;
}

export function initMobileChat(workspaceSelector) {
  const workspace = document.querySelector(workspaceSelector);
  const backBtn = document.getElementById("btn-chat-back");
  if (!workspace) return { openChat: () => {}, closeChat: () => {} };

  const mq = window.matchMedia("(max-width: 720px)");

  const closeChat = () => {
    workspace.classList.remove("workspace--chat-open");
  };

  const openChat = () => {
    if (mq.matches) workspace.classList.add("workspace--chat-open");
  };

  backBtn?.addEventListener("click", closeChat);
  mq.addEventListener("change", () => {
    if (!mq.matches) workspace.classList.remove("workspace--chat-open");
  });

  return { openChat, closeChat };
}

export function initBottomNav() {
  if (document.querySelector(".bottom-nav")) return;

  const path = window.location.pathname.replace(/\/$/, "") || "/app";
  const items = [
    { href: "/app", label: "Koneksi", icon: "⚡" },
    { href: "/app/groups", label: "Grup", icon: "👥" },
    { href: "/app/personal", label: "Pribadi", icon: "💬" },
    { href: "/app/send", label: "Kirim", icon: "✉️" },
  ];

  const nav = document.createElement("nav");
  nav.className = "bottom-nav";
  nav.setAttribute("aria-label", "Menu mobile");
  nav.innerHTML = items
    .map(
      (it) => `
    <a href="${it.href}" class="bottom-nav__link${path === it.href ? " bottom-nav__link--active" : ""}">
      <span class="bottom-nav__icon" aria-hidden="true">${it.icon}</span>
      <span class="bottom-nav__label">${it.label}</span>
    </a>`,
    )
    .join("");

  document.querySelector(".app")?.appendChild(nav);
  document.body.classList.add("has-bottom-nav");
}

export function updateMetaLabels(status) {
  const metaState = document.getElementById("meta-state");
  if (metaState) {
    metaState.textContent = status.ready
      ? STATE_LABELS_UI.ready
      : STATE_LABELS_UI[status.state] || status.state;
  }
}

const RECENT_PHONES_KEY = "wa-recent-phones";
const MAX_RECENT = 5;

export function normalizePhoneInput(value) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return { ok: false, message: "Nomor tidak boleh kosong" };
  if (digits.length < 9 || digits.length > 15) {
    return { ok: false, message: "Panjang nomor tidak valid (9–15 digit)" };
  }
  if (/^08/.test(digits) || /^628/.test(digits) || /^62/.test(digits)) {
    return { ok: true, digits };
  }
  return { ok: false, message: "Gunakan format 08xx atau 628xx" };
}

export function saveRecentPhone(phone) {
  try {
    const list = getRecentPhones().filter((p) => p !== phone);
    list.unshift(phone);
    localStorage.setItem(
      RECENT_PHONES_KEY,
      JSON.stringify(list.slice(0, MAX_RECENT)),
    );
  } catch {
    /* ignore */
  }
}

export function getRecentPhones() {
  try {
    const raw = localStorage.getItem(RECENT_PHONES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function renderRecentPhonesDatalist(listId, inputId) {
  const list = document.getElementById(listId);
  const input = document.getElementById(inputId);
  if (!list || !input) return;
  list.innerHTML = getRecentPhones()
    .map((p) => `<option value="${escapeHtml(p)}"></option>`)
    .join("");
}
