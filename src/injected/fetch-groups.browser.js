/**
 * Runs inside WhatsApp Web (Puppeteer). Plain JS only.
 */

function serializeChatId(id) {
  if (!id) return null;
  if (typeof id === "string") return id;
  if (id._serialized) return id._serialized;
  if (id.user && id.server) return id.user + "@" + id.server;
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

export default function fetchGroupsInBrowser() {
  var store = window.Store;
  var chats = store.Chat.getModelsArray();
  var groups = [];

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

      groups.push({
        id: id,
        name: name,
        isGroup: true,
        participantsCount: participantsCount,
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
