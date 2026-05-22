import { escapeHtml } from "./message-format.js";

let lightboxReady = false;

function mediaTypeLabel(type, mimetype) {
  if (type === "image" || (mimetype && mimetype.startsWith("image/"))) return "Gambar";
  if (type === "video" || (mimetype && mimetype.startsWith("video/"))) return "Video";
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

function getFilename(data, msg) {
  return (
    data.filename ||
    msg.filename ||
    mediaTypeLabel(data.type || msg.type, data.mimetype || msg.mimetype) ||
    "download"
  );
}

function mediaKind(type, mimetype, filename) {
  const mime = mimetype || "";
  const t = type || "";
  const fn = filename || "";
  if (t === "image" || t === "sticker" || mime.startsWith("image/")) return "image";
  if (t === "video" || mime.startsWith("video/")) return "video";
  if (t === "audio" || t === "ptt" || mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || /\.pdf$/i.test(fn)) return "pdf";
  return "file";
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename.replace(/[/\\?%*:|"<>]/g, "_") || "download";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ensureLightbox() {
  if (lightboxReady) return;
  lightboxReady = true;

  const el = document.createElement("div");
  el.id = "media-lightbox";
  el.className = "media-lightbox";
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="media-lightbox__backdrop" data-close></div>
    <div class="media-lightbox__panel" role="dialog" aria-modal="true" aria-labelledby="media-lightbox-title">
      <header class="media-lightbox__header">
        <p id="media-lightbox-title" class="media-lightbox__title"></p>
        <div class="media-lightbox__toolbar">
          <button type="button" id="media-lightbox-download" class="btn btn--sm btn--primary">Unduh</button>
          <button type="button" id="media-lightbox-close" class="btn btn--sm btn--ghost btn--lightbox-close" aria-label="Tutup">✕</button>
        </div>
      </header>
      <div id="media-lightbox-body" class="media-lightbox__body"></div>
    </div>
  `;
  document.body.appendChild(el);

  const close = () => closeMediaPreview();
  el.querySelector("[data-close]")?.addEventListener("click", close);
  el.querySelector("#media-lightbox-close")?.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) close();
  });
}

let currentPreview = null;

export function openMediaPreview({ dataUrl, filename, type, mimetype }) {
  ensureLightbox();
  const box = document.getElementById("media-lightbox");
  const title = document.getElementById("media-lightbox-title");
  const body = document.getElementById("media-lightbox-body");
  const btnDl = document.getElementById("media-lightbox-download");
  if (!box || !body) return;

  const name = filename || "Media";
  const kind = mediaKind(type, mimetype, name);
  currentPreview = { dataUrl, filename: name };

  if (title) title.textContent = name;

  let inner = "";
  if (kind === "image") {
    inner = `<img class="media-lightbox__img" src="${dataUrl}" alt="${escapeHtml(name)}" />`;
  } else if (kind === "video") {
    inner = `<video class="media-lightbox__video" src="${dataUrl}" controls playsinline autoplay></video>`;
  } else if (kind === "audio") {
    inner = `<audio class="media-lightbox__audio" src="${dataUrl}" controls autoplay></audio>`;
  } else if (kind === "pdf") {
    inner = `<iframe class="media-lightbox__pdf" src="${dataUrl}" title="${escapeHtml(name)}"></iframe>`;
  } else {
    inner = `
      <div class="media-lightbox__file-placeholder">
        <span class="media-lightbox__file-icon" aria-hidden="true">📎</span>
        <p>${escapeHtml(name)}</p>
        <p class="hint">Pratinjau tidak tersedia untuk tipe file ini. Gunakan tombol Unduh.</p>
      </div>`;
  }

  body.innerHTML = inner;
  if (btnDl) {
    btnDl.onclick = () => {
      if (currentPreview)
        downloadDataUrl(currentPreview.dataUrl, currentPreview.filename);
    };
  }

  box.hidden = false;
  box.setAttribute("aria-hidden", "false");
  document.body.classList.add("media-lightbox-open");
}

export function closeMediaPreview() {
  const box = document.getElementById("media-lightbox");
  const body = document.getElementById("media-lightbox-body");
  if (!box) return;
  box.hidden = true;
  box.setAttribute("aria-hidden", "true");
  document.body.classList.remove("media-lightbox-open");
  if (body) {
    const v = body.querySelector("video");
    const a = body.querySelector("audio");
    if (v) {
      v.pause();
      v.removeAttribute("src");
    }
    if (a) {
      a.pause();
      a.removeAttribute("src");
    }
    body.innerHTML = "";
  }
  currentPreview = null;
}

function mediaActionBar(filename) {
  const safe = escapeHtml(filename);
  return `
    <div class="msg__media-bar">
      <button type="button" class="msg__media-action" data-action="preview" title="Pratinjau">🔍 Preview</button>
      <button type="button" class="msg__media-action" data-action="download" title="Unduh ${safe}">⬇ Unduh</button>
    </div>`;
}

export function buildMediaMarkup(data, msg) {
  const mime = data.mimetype || msg.mimetype || "";
  const type = data.type || msg.type || "";
  const url = data.dataUrl;
  const filename = getFilename(data, msg);
  const name = escapeHtml(filename);
  const kind = mediaKind(type, mime, filename);
  const bar = mediaActionBar(filename);

  if (kind === "image") {
    return `
      <div class="msg__media-card" data-media-kind="image">
        <button type="button" class="msg__media-hit" data-action="preview" aria-label="Pratinjau gambar">
          <img class="msg__img" src="${url}" alt="${name}" loading="lazy" />
        </button>
        ${bar}
      </div>`;
  }
  if (kind === "video") {
    return `
      <div class="msg__media-card" data-media-kind="video">
        <video class="msg__video" src="${url}" controls playsinline preload="metadata"></video>
        ${bar}
      </div>`;
  }
  if (kind === "audio") {
    return `
      <div class="msg__media-card" data-media-kind="audio">
        <audio class="msg__audio" src="${url}" controls preload="metadata"></audio>
        ${bar}
      </div>`;
  }
  return `
    <div class="msg__media-card" data-media-kind="file">
      <button type="button" class="msg__file msg__media-hit" data-action="preview">
        <span class="msg__file-icon" aria-hidden="true">📎</span>
        <span class="msg__file-name">${name}</span>
      </button>
      ${bar}
    </div>`;
}

export function bindMediaSlot(slotEl, data, msg) {
  ensureLightbox();
  initMediaDelegation();
  const payload = {
    dataUrl: data.dataUrl,
    filename: getFilename(data, msg),
    type: data.type || msg.type,
    mimetype: data.mimetype || msg.mimetype,
  };

  slotEl._mediaPayload = payload;

  const openPreview = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMediaPreview(payload);
  };
  const doDownload = (e) => {
    e.preventDefault();
    e.stopPropagation();
    downloadDataUrl(payload.dataUrl, payload.filename);
  };

  slotEl.querySelectorAll("[data-action='preview']").forEach((btn) => {
    btn.addEventListener("click", openPreview);
  });

  slotEl.querySelectorAll("[data-action='download']").forEach((btn) => {
    btn.addEventListener("click", doDownload);
  });
}

/** Delegasi klik — cadangan jika slot di-render ulang */
let mediaDelegationReady = false;

export function initMediaDelegation() {
  if (mediaDelegationReady) return;
  mediaDelegationReady = true;

  document.addEventListener(
    "click",
    (e) => {
      const actionBtn = e.target.closest("[data-action]");
      if (!actionBtn) return;
      const card = actionBtn.closest(".msg__media-card");
      if (!card) return;
      const slot = card.closest(".msg__media");
      if (!slot?._mediaPayload) return;

      const action = actionBtn.getAttribute("data-action");
      const payload = slot._mediaPayload;
      if (action === "preview") {
        e.preventDefault();
        e.stopPropagation();
        openMediaPreview(payload);
      } else if (action === "download") {
        e.preventDefault();
        e.stopPropagation();
        downloadDataUrl(payload.dataUrl, payload.filename);
      }
    },
    true,
  );
}
