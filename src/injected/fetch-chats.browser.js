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

  function safeGet(obj, key) {
    try {
      return obj[key];
    } catch (e) {
      return undefined;
    }
  }

  function serializeChatId(id) {
    if (!id) return null;
    if (typeof id === "string") return id;

    // Wid.toString() usually still returns "user@server" even after the $1 rename.
    try {
      if (typeof id.toString === "function") {
        var ts = id.toString();
        if (ts && ts !== "[object Object]" && ts.indexOf("@") !== -1) return ts;
      }
    } catch (e) {}

    var dollar1 = safeGet(id, "$1");
    if (typeof dollar1 === "string" && dollar1.indexOf("@") !== -1) return dollar1;

    var serialized = safeGet(id, "_serialized");
    if (typeof serialized === "string" && serialized.indexOf("@") !== -1) return serialized;

    var user = safeGet(id, "user");
    var server = safeGet(id, "server");
    if (user && server) return user + "@" + server;

    try {
      var keys = Object.getOwnPropertyNames(id);
      for (var k = 0; k < keys.length; k++) {
        var v = safeGet(id, keys[k]);
        if (typeof v === "string" && v.indexOf("@") !== -1 && v.indexOf(" ") === -1) {
          return v;
        }
      }
    } catch (e) {}

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
    var cap = String(lm.caption || "").trim();
    var raw = String(lm.body || "").trim();
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
  if (!store || !store.Chat || !store.Chat.getModelsArray) {
    return { items: [], debug: { reason: "no_store_chat", rawCount: 0 } };
  }

  var chats = store.Chat.getModelsArray() || [];
  var items = [];
  var skippedNoId = 0;
  var skippedNewsletter = 0;
  var skippedError = 0;
  var sampleIdKeys = null;

  for (var i = 0; i < chats.length; i++) {
    var chat = chats[i];
    try {
      if (!sampleIdKeys && chat && chat.id && typeof chat.id === "object") {
        try {
          sampleIdKeys = Object.getOwnPropertyNames(chat.id).slice(0, 12);
        } catch (e) {
          sampleIdKeys = ["<unreadable>"];
        }
      }

      var id = serializeChatId(chat.id);
      if (!id || typeof id !== "string") {
        skippedNoId++;
        continue;
      }
      if (id.indexOf("@broadcast") !== -1) continue;

      var isNewsletter = false;
      try {
        isNewsletter =
          (store.ChatGetters &&
            store.ChatGetters.getIsNewsletter &&
            store.ChatGetters.getIsNewsletter(chat)) ||
          id.indexOf("@newsletter") !== -1;
      } catch (e) {
        isNewsletter = id.indexOf("@newsletter") !== -1;
      }
      if (isNewsletter) {
        skippedNewsletter++;
        continue;
      }

      var isGroup =
        id.slice(-5) === "@g.us" ||
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

      var lm = null;
      try {
        lm = chat.lastMessage || (chat.msgs && chat.msgs.last && chat.msgs.last());
      } catch (e) {
        lm = null;
      }

      var lastMessage = null;
      if (lm) {
        try {
          lastMessage = {
            body: formatBody(lm) || "[Pesan]",
            fromMe: Boolean((lm.id && lm.id.fromMe) || lm.fromMe),
            timestamp: lm.t || lm.timestamp || 0,
          };
        } catch (e) {
          lastMessage = {
            body: "[Pesan]",
            fromMe: false,
            timestamp: 0,
          };
        }
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
      skippedError++;
    }
  }

  return {
    items: items,
    debug: {
      rawCount: chats.length,
      itemCount: items.length,
      skippedNoId: skippedNoId,
      skippedNewsletter: skippedNewsletter,
      skippedError: skippedError,
      sampleIdKeys: sampleIdKeys,
      compat: Boolean(window.__wwebjsSerializedCompatApplied),
    },
  };
}
