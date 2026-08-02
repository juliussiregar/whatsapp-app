/**
 * Runs inside WhatsApp Web (Puppeteer). Plain JS only.
 * Helpers must live INSIDE the default export — page.evaluate only serializes that function.
 */

export default function fetchChatsInBrowser() {
  var MEDIA_TYPES = {
    image: true,
    video: true,
    audio: true,
    ptt: true,
    document: true,
    sticker: true,
  };

  function serializeChatId(id) {
    if (!id) return null;
    if (typeof id === "string") return id;
    if (id._serialized) return id._serialized;
    if (id.$1) return id.$1;
    if (id.user && id.server) return id.user + "@" + id.server;
    return null;
  }

  function isMediaPayloadBody(body) {
    if (!body || !String(body).trim()) return false;
    var s = String(body).trim();
    if (s.length < 80) return false;
    if (s.indexOf("/9j/") === 0) return true;
    if (s.indexOf("iVBORw0KGgo") === 0) return true;
    if (s.indexOf("data:image/") === 0 || s.indexOf("data:video/") === 0) return true;
    if (s.length > 400 && /^[A-Za-z0-9+/=]+$/.test(s)) return true;
    return false;
  }

  function formatBody(lm) {
    if (!lm) return "";
    var type = lm.type || "chat";
    var hasMedia = Boolean(lm.directPath) || Boolean(MEDIA_TYPES[type]);
    var cap = (lm.caption || "").trim();
    var raw = (lm.body || "").trim();
    if (hasMedia || MEDIA_TYPES[type]) {
      if (cap && !isMediaPayloadBody(cap)) return cap;
      if (raw && !isMediaPayloadBody(raw)) return raw;
    } else if (raw && !isMediaPayloadBody(raw)) {
      return raw;
    }
    var labels = {
      image: "[Gambar]",
      video: "[Video]",
      audio: "[Audio]",
      ptt: "[Voice note]",
      document: "[Dokumen]",
      sticker: "[Stiker]",
      location: "[Lokasi]",
      contact_card: "[Kontak]",
      poll: "[Poll]",
    };
    return labels[type] || (type && type !== "chat" ? "[" + type + "]" : "");
  }

  var store = window.Store;
  if (!store || !store.Chat || !store.Chat.getModelsArray) return [];

  var chats = store.Chat.getModelsArray();
  var items = [];

  for (var i = 0; i < chats.length; i++) {
    var chat = chats[i];
    try {
      var id = serializeChatId(chat.id);
      if (!id || typeof id !== "string") continue;
      if (id.indexOf("@broadcast") !== -1) continue;

      var isNewsletter =
        (store.ChatGetters &&
          store.ChatGetters.getIsNewsletter &&
          store.ChatGetters.getIsNewsletter(chat)) ||
        id.indexOf("@newsletter") !== -1;
      if (isNewsletter) continue;

      var isGroup =
        id.indexOf("@g.us") === id.length - 5 ||
        Boolean(chat.groupMetadata) ||
        (typeof chat.id?.isGroup === "function" && chat.id.isGroup()) ||
        chat.kind === "group";

      var name =
        chat.name ||
        chat.formattedTitle ||
        (chat.contact && (chat.contact.formattedName || chat.contact.pushname)) ||
        id;

      var participantsCount = 0;
      if (isGroup && chat.groupMetadata && chat.groupMetadata.participants) {
        var p = chat.groupMetadata.participants;
        participantsCount =
          (p._models && p._models.length) || (Array.isArray(p) ? p.length : 0);
      }

      var lm = chat.lastMessage || (chat.msgs && chat.msgs.last && chat.msgs.last());
      var lastMessage = null;
      if (lm) {
        lastMessage = {
          body: formatBody(lm) || "[Pesan]",
          fromMe: Boolean((lm.id && lm.id.fromMe) || lm.fromMe),
          timestamp: lm.t || lm.timestamp || 0,
        };
      }

      items.push({
        id: id,
        name: name,
        isGroup: isGroup,
        participantsCount: participantsCount,
        unreadCount: chat.unreadCount || 0,
        timestamp: chat.t || chat.timestamp || (lastMessage && lastMessage.timestamp) || null,
        lastMessage: lastMessage,
      });
    } catch (e) {
      /* skip broken chat */
    }
  }

  return items;
}
