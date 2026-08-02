/**
 * Runs inside WhatsApp Web (Puppeteer). Must stay plain JS — no TypeScript compile.
 * Helpers must live INSIDE the default export — page.evaluate only serializes that function.
 */

export default async function fetchMessagesInBrowser(chatId, targetLimit) {
  function isMediaPayloadBody(body) {
    if (!body || typeof body !== "string") return false;
    var s = body.trim();
    if (s.length < 80) return false;
    if (s.indexOf("/9j/") === 0) return true;
    if (s.indexOf("iVBORw0KGgo") === 0) return true;
    if (s.indexOf("data:image/") === 0 || s.indexOf("data:video/") === 0)
      return true;
    if (s.length > 400 && /^[A-Za-z0-9+/=]+$/.test(s)) return true;
    return false;
  }

  var skipTypes = {
    e2e_notification: true,
    gp2: true,
    notification: true,
    protocol: true,
    ciphertext: true,
    revoked: true,
    poll_creation: true,
    unknown: true,
    group_notification: true,
    call_log: true,
  };

  var mediaTypes = {
    image: true,
    video: true,
    audio: true,
    ptt: true,
    document: true,
    sticker: true,
  };

  function serializeAuthor(author) {
    if (!author) return null;
    if (typeof author === "string") return author;
    if (author._serialized) return author._serialized;
    if (author.$1) return author.$1;
    if (author.user && author.server) return author.user + "@" + author.server;
    if (author.id) return serializeAuthor(author.id);
    try {
      var s = String(author);
      return s === "[object Object]" ? null : s;
    } catch (e) {
      return null;
    }
  }

  function pickContactName(c) {
    if (!c) return null;
    return (
      c.pushname ||
      c.name ||
      c.formattedName ||
      c.shortName ||
      c.verifiedName ||
      null
    );
  }

  function buildParticipantMap(chat) {
    var map = {};
    if (!chat || !chat.groupMetadata) return map;
    try {
      var parts = chat.groupMetadata.participants;
      var models =
        parts && parts.getModelsArray
          ? parts.getModelsArray()
          : parts && parts._models
            ? parts._models
            : Array.isArray(parts)
              ? parts
              : [];
      for (var i = 0; i < models.length; i++) {
        var p = models[i];
        var pid =
          serializeAuthor(p.id) ||
          serializeAuthor(p.contact && p.contact.id) ||
          serializeAuthor(p.wid);
        var name =
          pickContactName(p.contact) ||
          p.notifyName ||
          p.name ||
          p.pushname;
        if (pid && name) {
          map[pid] = name;
          map[pid.split("@")[0]] = name;
        }
      }
    } catch (e) {
      /* ignore */
    }
    return map;
  }

  function resolveAuthorDisplayName(m, authorId, participantMap) {
    if (!authorId || authorId.indexOf("@g.us") !== -1) return null;

    if (m.notifyName && typeof m.notifyName === "string") return m.notifyName;

    if (participantMap && participantMap[authorId]) {
      return participantMap[authorId];
    }

    var fromMsg = pickContactName(m.senderObj) || pickContactName(m.contact);
    if (fromMsg) return fromMsg;

    try {
      if (store.MsgGetters && typeof store.MsgGetters.getSender === "function") {
        var sender = store.MsgGetters.getSender(m);
        var senderName = pickContactName(sender);
        if (senderName) return senderName;
      }
    } catch (e) {
      /* ignore */
    }

    try {
      var wid = store.WidFactory.createWid(authorId);
      var c = store.Contact.get(wid);
      var cn = pickContactName(c);
      if (cn) return cn;

      if (authorId.indexOf("@lid") !== -1 && store.LidUtils) {
        var alt =
          (typeof store.LidUtils.getAlternateWid === "function" &&
            store.LidUtils.getAlternateWid(wid)) ||
          (typeof store.LidUtils.getPhoneNumber === "function" &&
            store.LidUtils.getPhoneNumber(wid));
        if (alt) {
          var altWid =
            typeof alt === "string" ? store.WidFactory.createWid(alt) : alt;
          var c2 = store.Contact.get(altWid);
          cn = pickContactName(c2);
          if (cn) return cn;
        }
      }
    } catch (e) {
      /* ignore */
    }

    if (participantMap && authorId.indexOf("@lid") !== -1) {
      var lidKey = authorId.split("@")[0];
      if (participantMap[lidKey]) return participantMap[lidKey];
    }

    if (
      authorId.indexOf("@c.us") !== -1 ||
      authorId.indexOf("@s.whatsapp.net") !== -1
    ) {
      var phone = authorId.split("@")[0];
      if (phone && /^\d{8,15}$/.test(phone)) {
        try {
          var pwid = store.WidFactory.createWid(phone + "@c.us");
          var pc = store.Contact.get(pwid);
          var pn = pickContactName(pc);
          if (pn) return pn;
        } catch (e2) {
          /* ignore */
        }
        return "+" + phone;
      }
    }

    return null;
  }

  function shouldIncludeMessage(m, body, hasMedia, type) {
    if (m.isNotification) return false;
    if (skipTypes[type]) return false;
    if (hasMedia || mediaTypes[type]) return true;
    if (type === "chat" && body) return true;
    if (
      (type === "vcard" ||
        type === "location" ||
        type === "multi_vcard" ||
        type === "order") &&
      body
    ) {
      return true;
    }
    return false;
  }

  function resolveMessageBody(m, hasMedia, type) {
    var cap = (m.caption || "").trim();
    var raw = (m.body || "").trim();
    var mediaTypes = {
      image: true,
      video: true,
      audio: true,
      ptt: true,
      document: true,
      sticker: true,
    };
    if (hasMedia || mediaTypes[type]) {
      if (cap && !isMediaPayloadBody(cap)) return cap;
      if (raw && !isMediaPayloadBody(raw)) return raw;
      return "";
    }
    if (raw && isMediaPayloadBody(raw)) return "";
    return raw;
  }

  const store = window.Store;
  const req = window.require;

  const wid = store.WidFactory.createWid(chatId);
  let chat = store.Chat.get(wid);

  if (!chat) {
    return {
      ok: false,
      chatName: null,
      isGroup: chatId.endsWith("@g.us"),
      messages: [],
      loadedCount: 0,
    };
  }

  const isGroup = chatId.endsWith("@g.us") || Boolean(chat.groupMetadata);
  const chatName =
    chat.name || chat.formattedTitle || chat.contact?.formattedName || chatId;

  const getChatMsgs = function (c) {
    try {
      var raw = [];
      if (c.msgs && typeof c.msgs.getModelsArray === "function") {
        raw = c.msgs.getModelsArray();
      } else if (c.msgs && c.msgs._models) {
        raw = c.msgs._models;
      }
      var out = [];
      for (var i = 0; i < raw.length; i++) {
        var m = raw[i];
        if (m && !m.isNotification) out.push(m);
      }
      return out;
    } catch (e) {
      return [];
    }
  };

  const loadEarlierBatch = async function (c) {
    var loaders = [store.ConversationMsgs, null];
    try {
      loaders[1] = req("WAWebChatLoadMessages");
    } catch (e) {
      loaders[1] = null;
    }

    for (var j = 0; j < loaders.length; j++) {
      try {
        var loader = loaders[j];
        if (loader && typeof loader.loadEarlierMsgs === "function") {
          await loader.loadEarlierMsgs({ chat: c });
          return true;
        }
      } catch (e) {
        /* continue */
      }
    }

    try {
      var msgFindLocal =
        store.MsgFindLocal ||
        req("WAWebDBMessageFindLocal") ||
        (window.mR && window.mR.findModule
          ? window.mR.findModule("msgFindBefore")[0]
          : null);
      if (msgFindLocal && typeof msgFindLocal.msgFindBefore === "function") {
        var msgs = getChatMsgs(c);
        var sorted = msgs.slice().sort(function (a, b) {
          return (a.t || a.timestamp || 0) - (b.t || b.timestamp || 0);
        });
        var earliest = sorted[0];
        var batch = Math.min(50, targetLimit);
        await msgFindLocal.msgFindBefore(c.id, earliest ? earliest.id : undefined, batch);
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  };

  var msgs = getChatMsgs(chat);
  var iterations = 0;
  var maxIterations = Math.min(80, Math.ceil(targetLimit / 15) + 10);

  while (msgs.length < targetLimit && iterations < maxIterations) {
    iterations++;
    var countBefore = msgs.length;
    await loadEarlierBatch(chat);
    msgs = getChatMsgs(chat);
    if (msgs.length <= countBefore) break;
  }

  msgs.sort(function (a, b) {
    return (a.t || a.timestamp || 0) - (b.t || b.timestamp || 0);
  });

  var sliced = msgs.slice(-targetLimit);
  var messages = [];
  var participantMap = isGroup ? buildParticipantMap(chat) : {};

  for (var k = 0; k < sliced.length; k++) {
    var m = sliced[k];
    var type = m.type || "chat";
    var hasMedia = Boolean(m.directPath) || Boolean(mediaTypes[type]);
    var body = resolveMessageBody(m, hasMedia, type);

    if (!shouldIncludeMessage(m, body, hasMedia, type)) continue;

    var fromMe = Boolean((m.id && m.id.fromMe) || m.fromMe);
    var authorId =
      serializeAuthor(m.author) ||
      serializeAuthor(m.from) ||
      serializeAuthor(m.sender) ||
      null;
    var authorDisplay = null;
    if (isGroup) {
      if (fromMe) {
        authorDisplay = "Anda";
      } else {
        authorDisplay = resolveAuthorDisplayName(m, authorId, participantMap);
      }
    }

    messages.push({
      id: (m.id && (m.id._serialized || m.id.$1)) || String(m.id),
      body: body,
      fromMe: fromMe,
      author: authorDisplay,
      timestamp: m.t || m.timestamp || 0,
      type: type,
      hasMedia: hasMedia,
      mimetype: m.mimetype || null,
      filename: m.filename || null,
    });
  }

  return {
    ok: true,
    chatName: chatName,
    isGroup: isGroup,
    messages: messages,
    loadedCount: messages.length,
  };
}
