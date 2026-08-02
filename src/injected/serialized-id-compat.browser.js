/**
 * Runs inside WhatsApp Web (Puppeteer). Plain JS only.
 * Restores id._serialized from id.$1 after WhatsApp Web's mid-2026 rename,
 * and soft-fails individual chats so Client.getChats() does not die on one bad model.
 */

export default function applySerializedIdCompatInBrowser() {
  if (window.__wwebjsSerializedCompatApplied) return { applied: false, reason: "already" };
  window.__wwebjsSerializedCompatApplied = true;

  function ensureSerialized(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (obj._serialized == null && obj.$1 != null) {
      try {
        obj._serialized = obj.$1;
      } catch (e) {
        return Object.assign({}, obj, { _serialized: obj.$1 });
      }
    }
    return obj;
  }

  function ser(id) {
    if (!id) return undefined;
    if (typeof id === "string") return id;
    ensureSerialized(id);
    if (id._serialized) return id._serialized;
    if (id.$1) return id.$1;
    if (id.user && id.server) return id.user + "@" + id.server;
    return undefined;
  }

  if (window.WWebJS && window.WWebJS.getMessageModel) {
    var origMsg = window.WWebJS.getMessageModel.bind(window.WWebJS);
    window.WWebJS.getMessageModel = function (message) {
      var model = origMsg(message);
      if (model && model.id) ensureSerialized(model.id);
      if (model && model.id && model.id.remote && typeof model.id.remote === "object") {
        ensureSerialized(model.id.remote);
        model.id = Object.assign({}, model.id, {
          remote: ser(model.id.remote) || model.id.remote,
        });
      }
      return model;
    };
  }

  if (window.WWebJS && window.WWebJS.getChatModel) {
    var origChat = window.WWebJS.getChatModel.bind(window.WWebJS);
    window.WWebJS.getChatModel = async function (chat, opts) {
      try {
        if (chat && chat.id) ensureSerialized(chat.id);
        if (chat && chat.lastReceivedKey) ensureSerialized(chat.lastReceivedKey);
        return await origChat(chat, opts || {});
      } catch (err) {
        try {
          var model = chat && chat.serialize ? chat.serialize() : {};
          var idStr = ser(chat && chat.id);
          if (chat && chat.id) {
            model.id = ensureSerialized(
              typeof chat.id === "object" ? Object.assign({}, chat.id) : { _serialized: idStr },
            );
            if (!model.id._serialized && idStr) model.id._serialized = idStr;
          }
          model.isGroup =
            Boolean(chat && chat.groupMetadata) ||
            Boolean(idStr && idStr.indexOf("@g.us") === idStr.length - 5);
          model.formattedTitle = chat && chat.formattedTitle;
          model.name = (chat && chat.name) || model.formattedTitle || idStr;
          model.lastMessage = null;
          model.unreadCount = (chat && chat.unreadCount) || 0;
          model.timestamp = (chat && (chat.t || chat.timestamp)) || null;
          delete model.msgs;
          delete model.msgUnsyncedButtonReplyMsgs;
          delete model.unsyncedButtonReplies;
          return model;
        } catch (e2) {
          return null;
        }
      }
    };
  }

  if (window.WWebJS && window.WWebJS.getContactModel) {
    var origContact = window.WWebJS.getContactModel.bind(window.WWebJS);
    window.WWebJS.getContactModel = function (contact) {
      var model = origContact(contact);
      if (model && model.id) ensureSerialized(model.id);
      return model;
    };
  }

  if (window.WWebJS && window.WWebJS.getChat) {
    var origGetChat = window.WWebJS.getChat.bind(window.WWebJS);
    window.WWebJS.getChat = async function (chatId, opts) {
      var id = typeof chatId === "string" ? chatId : ser(chatId);
      if (!id) return null;
      return await origGetChat(id, opts || {});
    };
  }

  return { applied: true };
}
