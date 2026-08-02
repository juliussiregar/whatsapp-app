/**
 * Runs inside WhatsApp Web (Puppeteer). Plain JS only.
 * Helpers must live INSIDE the default export — page.evaluate only serializes that function.
 */

export default function fetchGroupsInBrowser() {
  function serializeChatId(id) {
    if (!id) return null;
    if (typeof id === "string") return id;
    try {
      if (typeof id.toString === "function") {
        var ts = id.toString();
        if (ts && ts !== "[object Object]" && ts.indexOf("@") !== -1) return ts;
      }
    } catch (e) {}
    try {
      if (id.$1) return id.$1;
    } catch (e) {}
    try {
      if (id._serialized) return id._serialized;
    } catch (e) {}
    try {
      if (id.user && id.server) return id.user + "@" + id.server;
    } catch (e) {}
    return null;
  }

  function isGroupChat(chat, id) {
    if (!id || id.includes("@broadcast") || id.includes("@newsletter")) return false;
    try {
      var store = window.Store;
      if (store.ChatGetters && store.ChatGetters.getIsNewsletter) {
        if (store.ChatGetters.getIsNewsletter(chat)) return false;
      }
    } catch (e) {
      /* ignore */
    }
    if (id.endsWith("@g.us")) return true;
    if (chat.groupMetadata) return true;
    if (typeof chat.id?.isGroup === "function" && chat.id.isGroup()) return true;
    if (chat.kind === "group") return true;
    return false;
  }

  function getBotIdLookup() {
    var lookup = {};
    try {
      var user = window.Store.User;
      var me = user.getMaybeMePnUser && user.getMaybeMePnUser();
      if (me) {
        var sid = serializeChatId(me);
        if (sid) lookup[sid] = true;
        if (me.user) lookup[me.user] = true;
      }
      var lid = user.getMaybeMeLidUser && user.getMaybeMeLidUser();
      if (lid) {
        var lidSid = serializeChatId(lid);
        if (lidSid) lookup[lidSid] = true;
      }
    } catch (e) {
      /* ignore */
    }
    return lookup;
  }

  function isBotGroupMember(participants, botIds) {
    if (!participants || !botIds) return false;
    var models = participants._models || (Array.isArray(participants) ? participants : []);
    for (var i = 0; i < models.length; i++) {
      var pid = serializeChatId(models[i].id);
      if (!pid && models[i].id && models[i].id.user) {
        pid = models[i].id.user + "@" + (models[i].id.server || "c.us");
      }
      if (!pid) continue;
      if (botIds[pid]) return true;
      var user = pid.split("@")[0];
      if (botIds[user]) return true;
    }
    return false;
  }

  var store = window.Store;
  if (!store || !store.Chat) {
    return [];
  }

  var chats = store.Chat.getModelsArray();
  var groups = [];
  var botIds = getBotIdLookup();

  for (var i = 0; i < chats.length; i++) {
    var chat = chats[i];
    try {
      var id = serializeChatId(chat.id);
      if (!id || !isGroupChat(chat, id)) continue;

      var name =
        chat.name ||
        chat.formattedTitle ||
        (chat.groupMetadata && chat.groupMetadata.subject) ||
        chat.contact?.formattedName ||
        chat.contact?.pushname ||
        id;

      var participantsCount = 0;
      if (chat.groupMetadata && chat.groupMetadata.participants) {
        var p = chat.groupMetadata.participants;
        participantsCount =
          (p._models && p._models.length) || (Array.isArray(p) ? p.length : 0);
      }

      var lm = chat.lastMessage || (chat.msgs && chat.msgs.last && chat.msgs.last());
      var lastMessage = null;
      if (lm) {
        lastMessage = {
          body: lm.body || lm.caption || "[Pesan]",
          fromMe: Boolean((lm.id && lm.id.fromMe) || lm.fromMe),
          timestamp: lm.t || lm.timestamp || 0,
        };
      }

      var botIsMember = isBotGroupMember(
        chat.groupMetadata && chat.groupMetadata.participants,
        botIds,
      );

      groups.push({
        id: id,
        name: name,
        isGroup: true,
        participantsCount: participantsCount,
        botIsMember: botIsMember,
        unreadCount: chat.unreadCount || 0,
        timestamp: chat.t || chat.timestamp || (lastMessage && lastMessage.timestamp) || null,
        lastMessage: lastMessage,
      });
    } catch (e) {
      /* skip */
    }
  }

  return groups;
}
