/**
 * Runs inside WhatsApp Web (Puppeteer). Plain JS only.
 * Tries each candidate chat id once; stops on first confirmed send.
 * Distinguishes chat_not_found (try next) from send failures.
 */

export default async function sendMessageInBrowser(candidateIds, message) {
  function ser(id) {
    if (!id) return null;
    if (typeof id === "string") return id;
    try {
      if (id._serialized) return id._serialized;
    } catch (e) {}
    try {
      if (id.$1) return id.$1;
    } catch (e) {}
    try {
      if (typeof id.toString === "function") {
        var ts = id.toString();
        if (ts && ts !== "[object Object]" && ts.indexOf("@") !== -1) return ts;
      }
    } catch (e) {}
    try {
      if (id.user && id.server) return id.user + "@" + id.server;
    } catch (e) {}
    return null;
  }

  var errors = [];
  var ids = Array.isArray(candidateIds) ? candidateIds : [candidateIds];

  for (var i = 0; i < ids.length; i++) {
    var chatId = ids[i];
    if (!chatId) continue;

    try {
      var chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
      if (!chat) {
        errors.push(chatId + ": chat_not_found");
        continue;
      }

      var msg = await window.WWebJS.sendMessage(chat, message, {
        waitUntilMsgSent: true,
      });

      if (msg) {
        var msgId = ser(msg.id) || ser(msg) || "sent";
        return { ok: true, via: chatId, msgId: String(msgId) };
      }

      // Msg.get may fail after $1 rename even when addAndSendMsgToChat succeeded.
      // If we got here without throw and waitUntilMsgSent finished, treat as sent.
      return { ok: true, via: chatId, msgId: "sent-no-id", soft: true };
    } catch (e) {
      errors.push(chatId + ": " + (e && e.message ? e.message : String(e)));
    }
  }

  return { ok: false, errors: errors };
}
