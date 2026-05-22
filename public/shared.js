import {
  escapeHtml,
  stripFormatting,
  formatMessageHtml,
  formatDayLabel,
  messageDisplayBody,
} from "./message-format.js";
import {
  buildMediaMarkup,
  bindMediaSlot,
  initMediaDelegation,
} from "./media-preview.js";
import {
  saveLastPage,
  initBottomNav,
  updateMetaLabels,
  renderMessagesSkeleton,
  showToast,
  highlightSearchName,
} from "./ux.js";

initMediaDelegation();

export {
  escapeHtml,
  stripFormatting,
  formatMessageHtml,
  formatDayLabel,
  messageDisplayBody,
};

export { showToast } from "./ux.js";

export const API = {
  status: "/whatsapp/status",
  qr: "/whatsapp/qr",
  reconnect: "/whatsapp/reconnect",
  logout: "/whatsapp/logout",
  groups: "/whatsapp/groups",
  chats: "/whatsapp/chats",
  messages: "/whatsapp/messages",
  messageMedia: "/whatsapp/message-media",
  sendMessage: "/whatsapp/send-message",
  sendGroupMessage: "/whatsapp/send-group-message",
};

export const STATUS_POLL_MS = 3000;
export const QR_POLL_MS = 2500;

export const STATE_LABELS = {
  initializing: "Inisialisasi",
  waiting_qr: "Scan QR",
  authenticated: "Terverifikasi",
  loading: "Memuat",
  ready: "Siap",
  disconnected: "Terputus",
  error: "Error",
};

export let busy = false;
let statusTimer = null;
let qrTimer = null;

export const mediaCache = new Map();
export let mediaLoadQueue = Promise.resolve();

export function $(id) {
  return document.getElementById(id);
}

export function setBusy(value) {
  busy = value;
  const reconnect = $("btn-reconnect");
  const logout = $("btn-logout");
  if (reconnect) reconnect.disabled = value;
  if (logout) logout.disabled = value;
}

export function initNavigation() {
  saveLastPage();
  initBottomNav();
  const path = window.location.pathname.replace(/\/$/, "") || "/app";
  document.querySelectorAll(".sidebar-nav__link, .bottom-nav__link").forEach((link) => {
    const href = (link.getAttribute("href") || "").replace(/\/$/, "");
    const active =
      path === href ||
      (href === "/app/groups" && path.startsWith("/app/groups")) ||
      (href === "/app/personal" && path.startsWith("/app/personal")) ||
      (href === "/app/send" && path.startsWith("/app/send"));
    link.classList.toggle("sidebar-nav__link--active", active);
  });
}

export function updateTopbar(status) {
  const badge = $("status-badge");
  const btnReconnect = $("btn-reconnect");
  const btnLogout = $("btn-logout");
  if (!badge) return;

  const { state, ready } = status;
  badge.textContent = ready
    ? STATE_LABELS.ready
    : STATE_LABELS[state] || state;
  badge.className = "badge";
  if (ready) badge.classList.add("badge--ready");
  else if (state === "waiting_qr") badge.classList.add("badge--qr");
  else if (state === "error" || state === "disconnected")
    badge.classList.add("badge--error");

  const showReconnect =
    state === "disconnected" || state === "error" || state === "waiting_qr";
  if (btnReconnect) btnReconnect.hidden = !showReconnect;
  if (btnLogout) btnLogout.hidden = state !== "ready";
}

export function updateMeta(status) {
  const { message, uptime, stateChangedAt } = status;
  updateMetaLabels(status);
  const metaUptime = $("meta-uptime");
  const metaChanged = $("meta-changed");
  const metaMessage = $("meta-message");
  if (metaUptime) metaUptime.textContent = formatUptime(uptime);
  if (metaChanged) metaChanged.textContent = formatTime(stateChangedAt);
  if (metaMessage) metaMessage.textContent = message;
}

export function formatUptime(seconds) {
  if (seconds < 60) return `${seconds} detik`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} menit ${s} detik` : `${m} menit`;
}

export function formatTime(isoOrUnix) {
  try {
    const d =
      typeof isoOrUnix === "number"
        ? new Date(isoOrUnix * 1000)
        : new Date(isoOrUnix);
    return d.toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(isoOrUnix);
  }
}

/** Nama penulis grup dari field author (string atau object legacy) */
const SKIP_MESSAGE_TYPES = new Set([
  "e2e_notification",
  "gp2",
  "notification",
  "protocol",
  "ciphertext",
  "revoked",
  "poll_creation",
  "unknown",
  "group_notification",
  "call_log",
]);

const MEDIA_MSG_TYPES = new Set([
  "image",
  "video",
  "audio",
  "ptt",
  "document",
  "sticker",
]);

export function isDisplayableMessage(msg) {
  if (!msg) return false;
  if (SKIP_MESSAGE_TYPES.has(msg.type)) return false;
  if (msg.hasMedia || MEDIA_MSG_TYPES.has(msg.type)) return true;
  const body = (msg.body || "").trim();
  if (msg.type === "chat" && body) return true;
  return false;
}

export function formatMessageAuthor(author) {
  if (author == null || author === "") return "";
  if (typeof author === "string") {
    if (author.includes("@g.us")) return "";
    if (author === "Anda") return author;
    const short = author.split("@")[0];
    if (/^\d{10,}$/.test(short) && !author.startsWith("+")) return "";
    return author;
  }
  if (typeof author === "object") {
    const id =
      author._serialized ||
      (author.user && author.server
        ? `${author.user}@${author.server}`
        : null);
    if (id) return formatMessageAuthor(id);
  }
  return "Anggota";
}

export function formatMsgTime(ts) {
  try {
    return new Date(ts * 1000).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function chatIdToPhone(chatId) {
  return chatId.replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "");
}

export function showFeedback(el, text, ok, toastAlso = false) {
  if (!el) return;
  el.hidden = false;
  el.textContent = text;
  el.className = `feedback ${ok ? "feedback--ok" : "feedback--err"}`;
  if (toastAlso) showToast(text, ok);
}

export function hideFeedback(el) {
  if (el) el.hidden = true;
}

export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.details || data.error || res.statusText);
  }
  return data;
}

export function getInitials(name) {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function setAvatar(el, name, isGroup) {
  if (!el) return;
  el.hidden = false;
  el.textContent = getInitials(name);
  el.className = `avatar${isGroup ? " avatar--group" : ""}`;
}

export function filterItems(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.name.toLowerCase().includes(q));
}

export function mediaTypeLabel(type, mimetype) {
  if (type === "image" || (mimetype && mimetype.startsWith("image/")))
    return "Gambar";
  if (type === "video" || (mimetype && mimetype.startsWith("video/")))
    return "Video";
  if (
    type === "audio" ||
    type === "ptt" ||
    (mimetype && mimetype.startsWith("audio/"))
  )
    return "Audio";
  if (type === "sticker") return "Stiker";
  if (type === "document") return "Dokumen";
  return "File";
}

export function applyMediaToSlot(slotEl, data, msg) {
  if (!data?.dataUrl) {
    slotEl.innerHTML = `<span class="msg__media-err">${escapeHtml(data?.error || data?.details || "Media tidak tersedia")}</span>`;
    return;
  }
  slotEl.innerHTML = buildMediaMarkup(data, msg);
  bindMediaSlot(slotEl, data, msg);
}

export function resetMediaState() {
  mediaCache.clear();
  mediaLoadQueue = Promise.resolve();
}

export function queueMediaLoad(msg, slotEl) {
  mediaLoadQueue = mediaLoadQueue.then(async () => {
    if (mediaCache.has(msg.id)) {
      applyMediaToSlot(slotEl, mediaCache.get(msg.id), msg);
      return;
    }
    try {
      const data = await fetchJson(
        `${API.messageMedia}?messageId=${encodeURIComponent(msg.id)}`,
      );
      mediaCache.set(msg.id, data);
      applyMediaToSlot(slotEl, data, msg);
    } catch (err) {
      slotEl.innerHTML = `<span class="msg__media-err">${escapeHtml(err.message)}</span>`;
    }
  });
}

export function renderMessages(container, messages, isGroup, scrollOpts = {}) {
  const preserveScroll = Boolean(scrollOpts.preserveScroll);
  const prevTop = preserveScroll ? container.scrollTop : 0;
  const prevHeight = preserveScroll ? container.scrollHeight : 0;
  const stickBottom =
    scrollOpts.stickBottom !== false &&
    (!preserveScroll ||
      container.scrollHeight - container.scrollTop - container.clientHeight <
        120);

  container.innerHTML = "";
  if (!messages.length) {
    container.innerHTML = `
      <p class="messages__empty">
        <strong>Belum ada pesan</strong>
        Pesan mungkin belum dimuat di server. Buka chat ini di WhatsApp HP,
        scroll riwayat sedikit, lalu klik ↻ di atas.
      </p>`;
    return;
  }
  let lastDay = null;

  const visible = messages.filter(isDisplayableMessage);
  if (!visible.length) {
    container.innerHTML = `
      <p class="messages__empty">
        <strong>Belum ada pesan tampil</strong>
        Hanya pesan teks/media yang ditampilkan. Buka chat di WhatsApp HP lalu klik ↻.
      </p>`;
    return;
  }

  for (const msg of visible) {
    const dayKey = new Date(msg.timestamp * 1000).toDateString();
    if (dayKey !== lastDay) {
      const sep = document.createElement("div");
      sep.className = "msg-date";
      sep.textContent = formatDayLabel(msg.timestamp);
      container.appendChild(sep);
      lastDay = dayKey;
    }

    const div = document.createElement("div");
    div.className = `msg ${msg.fromMe ? "msg--out" : "msg--in"}`;

    let authorHtml = "";
    if (isGroup) {
      const authorLabel = msg.fromMe
        ? "Anda"
        : formatMessageAuthor(msg.author);
      if (authorLabel) {
        const cls = msg.fromMe ? "msg__author msg__author--me" : "msg__author";
        authorHtml = `<div class="${cls}">${escapeHtml(authorLabel)}</div>`;
      }
    }

    const tick = msg.fromMe
      ? '<span class="msg__tick" aria-hidden="true">✓✓</span>'
      : "";

    const mediaHtml = msg.hasMedia
      ? `<div class="msg__media"><span class="msg__media-loading">Memuat ${escapeHtml(mediaTypeLabel(msg.type, msg.mimetype || ""))}…</span></div>`
      : "";

    const displayBody = messageDisplayBody(msg);
    const bodyHtml = displayBody
      ? `<div class="msg__body msg__body--caption">${formatMessageHtml(displayBody)}</div>`
      : "";

    div.innerHTML = `
      ${authorHtml}
      ${mediaHtml}
      ${bodyHtml}
      <div class="msg__footer">
        <span class="msg__time">${formatMsgTime(msg.timestamp)}</span>
        ${tick}
      </div>
    `;
    container.appendChild(div);

    if (msg.hasMedia) {
      const slot = div.querySelector(".msg__media");
      if (slot) queueMediaLoad(msg, slot);
    }
  }
  if (stickBottom) {
    container.scrollTop = container.scrollHeight;
  } else if (preserveScroll) {
    container.scrollTop = prevTop + (container.scrollHeight - prevHeight);
  }
  container._scrollUpdate?.();
}

export function renderChatList(container, items, selectedId, onSelect, searchQuery = "") {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML =
      '<li class="chat-list__empty">Tidak ada data. Klik ↻ untuk muat ulang.</li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-list__item";
    if (item.id === selectedId) btn.classList.add("chat-list__item--active");

    const lm = item.lastMessage;
    const preview = lm
      ? `${lm.fromMe ? "Anda: " : ""}${
          lm.hasMedia
            ? `📎 ${mediaTypeLabel(lm.type, lm.mimetype || "")}${
                messageDisplayBody(lm)
                  ? ": " + stripFormatting(messageDisplayBody(lm))
                  : ""
              }`
            : stripFormatting(messageDisplayBody(lm) || lm.body || "")
        }`
      : "Belum ada pesan";

    const avatarClass = item.isGroup ? "avatar avatar--group" : "avatar";
    btn.innerHTML = `
      <span class="${avatarClass}">${escapeHtml(getInitials(item.name))}</span>
      <span class="chat-list__item-inner">
        <span class="chat-list__name-row">
          <span class="chat-list__name">${highlightSearchName(item.name, searchQuery)}</span>
          ${item.unreadCount > 0 ? `<span class="chat-list__unread">${item.unreadCount > 99 ? "99+" : item.unreadCount}</span>` : ""}
        </span>
        <span class="chat-list__preview">${escapeHtml(preview)}</span>
        <span class="chat-list__meta">${
          item.isGroup
            ? `${item.participantsCount || 0} anggota`
            : item.timestamp
              ? formatTime(item.timestamp)
              : "Chat pribadi"
        }</span>
      </span>
    `;
    btn.addEventListener("click", () => onSelect(item));
    li.appendChild(btn);
    container.appendChild(li);
  }
}

export async function loadMessages(
  chatId,
  container,
  isGroup,
  metaEl,
  options = {},
) {
  if (!container) return null;
  const { silent = false, preserveScroll = false } = options;

  if (!silent) renderMessagesSkeleton(container);

  try {
    const data = await fetchJson(
      `${API.messages}?chatId=${encodeURIComponent(chatId)}&limit=100`,
    );
    renderMessages(container, data.messages, isGroup, {
      preserveScroll: silent && preserveScroll,
    });
    if (metaEl) {
      const base = metaEl.textContent?.split("·")[0]?.trim() || "";
      metaEl.textContent = base
        ? `${base} · ${data.total} pesan`
        : `${data.total} pesan dimuat`;
    }
    return data;
  } catch (err) {
    if (!silent) {
      container.innerHTML = `<p class="messages__empty"><strong>Gagal memuat</strong> ${escapeHtml(err.message)}</p>`;
    }
    return null;
  }
}

export async function pollQr() {
  const qrImage = $("qr-image");
  const qrPlaceholder = $("qr-placeholder");
  const qrUpdated = $("qr-updated");
  if (!qrImage) return;

  try {
    const qr = await fetchJson(API.qr);
    if (qr.available && qr.dataUrl) {
      qrImage.src = qr.dataUrl;
      qrImage.hidden = false;
      if (qrPlaceholder) qrPlaceholder.hidden = true;
      if (qrUpdated)
        qrUpdated.textContent = qr.updatedAt
          ? `Diperbarui: ${formatTime(qr.updatedAt)}`
          : "";
    } else {
      qrImage.hidden = true;
      if (qrPlaceholder) {
        qrPlaceholder.hidden = false;
        const p = qrPlaceholder.querySelector("p");
        if (p) p.textContent = qr.message || "Menunggu QR…";
      }
    }
  } catch (err) {
    console.error("QR poll:", err);
  }
}

function manageQrPolling(state) {
  if (state === "waiting_qr" || state === "initializing") {
    if (!qrTimer) {
      pollQr();
      qrTimer = setInterval(pollQr, QR_POLL_MS);
    }
  } else if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = null;
  }
}

export async function doReconnect() {
  if (busy) return;
  setBusy(true);
  try {
    await fetchJson(API.reconnect, { method: "POST" });
    window.location.href = "/app";
  } catch (err) {
    alert(`Reconnect gagal: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

export async function doLogout() {
  if (busy) return;
  if (
    !confirm(
      "Logout dari WhatsApp?\n\nSession akan dihapus dan perlu scan QR lagi.",
    )
  )
    return;
  setBusy(true);
  try {
    await fetchJson(API.logout, { method: "POST" });
    mediaCache.clear();
    mediaLoadQueue = Promise.resolve();
    window.location.href = "/app";
  } catch (err) {
    alert(`Logout gagal: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

export function bindTopbarActions() {
  $("btn-reconnect")?.addEventListener("click", doReconnect);
  $("btn-reconnect-error")?.addEventListener("click", doReconnect);
  $("btn-logout")?.addEventListener("click", doLogout);
}

export function startStatusPolling(onStatus) {
  const run = async () => {
    try {
      const status = await fetchJson(API.status);
      updateTopbar(status);
      updateMeta(status);
      manageQrPolling(status.state);
      onStatus(status);
    } catch {
      updateTopbar({ state: "error", ready: false });
      onStatus({ state: "error", ready: false, message: "Server tidak terjangkau" });
    }
  };
  run();
  statusTimer = setInterval(run, STATUS_POLL_MS);
}

/** State yang memang harus scan / reconnect — bukan fase loading sementara */
const NEEDS_CONNECT_PAGE = new Set([
  "initializing",
  "waiting_qr",
  "disconnected",
  "error",
]);

const NEEDS_CONNECT_STATES = new Set([
  "initializing",
  "waiting_qr",
  "disconnected",
  "error",
]);

/** Tunggu WhatsApp ready sebelum memuat chat/grup */
export function whenReady(onReady, { pollMs = 1500, maxWaitMs = 120000 } = {}) {
  const started = Date.now();
  const tick = async () => {
    try {
      const status = await fetchJson(API.status);
      if (status.ready) {
        onReady(status);
        return;
      }
      if (NEEDS_CONNECT_STATES.has(status.state)) {
        return;
      }
    } catch {
      /* retry */
    }
    if (Date.now() - started < maxWaitMs) {
      setTimeout(tick, pollMs);
    }
  };
  tick();
}

export function requireReady(redirectTo = "/app") {
  let redirectPending = false;
  startStatusPolling((status) => {
    if (status.ready) {
      redirectPending = false;
      return;
    }
    // Masih loading setelah auth — tunggu, jangan redirect bolak-balik ke /app
    if (status.state === "authenticated" || status.state === "loading") {
      return;
    }
    if (NEEDS_CONNECT_PAGE.has(status.state) && !redirectPending) {
      redirectPending = true;
      window.location.href = redirectTo;
    }
  });
}
