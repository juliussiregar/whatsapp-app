/** Escape HTML, lalu format WhatsApp + Markdown dasar (aman untuk innerHTML). */

const MEDIA_TYPES = new Set([
  "image",
  "video",
  "audio",
  "ptt",
  "document",
  "sticker",
]);

/** WhatsApp Web kadang menyimpan data JPEG/base64 di field body. */
export function isMediaPayloadBody(body) {
  if (!body?.trim()) return false;
  const s = body.trim();
  if (s.length < 80) return false;
  if (s.startsWith("/9j/")) return true;
  if (s.startsWith("iVBORw0KGgo")) return true;
  if (s.startsWith("data:image/") || s.startsWith("data:video/")) return true;
  if (s.length > 400 && /^[A-Za-z0-9+/=]+$/.test(s)) return true;
  return false;
}

export function messageDisplayBody(msg) {
  const raw = (msg.body || "").trim();
  const cap = (msg.caption || "").trim();
  const type = msg.type || "chat";
  const hasMedia = Boolean(msg.hasMedia) || MEDIA_TYPES.has(type);
  if (hasMedia) {
    if (cap && !isMediaPayloadBody(cap)) return cap;
    if (raw && !isMediaPayloadBody(raw)) return raw;
    return "";
  }
  if (raw && isMediaPayloadBody(raw)) return "";
  return raw;
}

export function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

/** Teks polos untuk preview sidebar */
export function stripFormatting(text) {
  if (!text) return "";
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.slice(3, -3).trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/~([^~]+)~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

export function formatMessageHtml(text) {
  if (!text) return "";

  const codeBlocks = [];
  let s = escapeHtml(text);

  // Blok kode ``` ... ```
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(
      `<pre class="msg__pre"><code>${code.trim()}</code></pre>`,
    );
    return `\x00CB${i}\x00`;
  });

  // Inline code `...`
  s = s.replace(/`([^`\n]+)`/g, '<code class="msg__code">$1</code>');

  // Bold markdown **...**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Bold WhatsApp *...*
  s = s.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");

  // Italic markdown __...__
  s = s.replace(/__([^_\n]+)__/g, "<em>$1</em>");
  // Italic WhatsApp _..._
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");

  // Strikethrough ~~...~~ atau ~...~
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  s = s.replace(/~([^~\n]+)~/g, "<del>$1</del>");

  // Link markdown [label](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="msg__link">$1</a>',
  );

  // URL otomatis
  s = s.replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="msg__link">$1</a>',
  );

  // Blockquote markdown >
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote class="msg__quote">$1</blockquote>');

  // Bullet - item
  s = s.replace(/^- (.+)$/gm, '<span class="msg__li">• $1</span>');

  // Restore code blocks
  s = s.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[Number(i)] ?? "");

  // Baris baru
  s = s.replace(/\n/g, "<br>");

  return s;
}

export function formatDayLabel(timestamp) {
  const d = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Hari ini";
  if (d.toDateString() === yesterday.toDateString()) return "Kemarin";
  const opts = {
    weekday: "long",
    day: "numeric",
    month: "long",
  };
  if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("id-ID", opts);
}
