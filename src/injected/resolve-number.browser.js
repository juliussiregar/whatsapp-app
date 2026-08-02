/**
 * Runs inside WhatsApp Web (Puppeteer). Plain JS only.
 * Resolves a phone number to a WhatsApp wid without relying on Client.getNumberId.
 */

export default async function resolveNumberInBrowser(phoneDigits) {
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

  if (!window.Store || !window.Store.WidFactory || typeof window.Store.WidFactory.createWid !== "function") {
    return { ok: false, error: "store_not_ready" };
  }

  var number = String(phoneDigits || "").replace(/\D/g, "");
  if (!number) return { ok: false, error: "invalid_number" };
  var chatId = number.indexOf("@") !== -1 ? number : number + "@c.us";

  try {
    var wid = window.Store.WidFactory.createWid(chatId);
    var hasQuery = typeof window.Store.QueryExist === "function";
    var result = null;

    if (hasQuery) {
      result = await window.Store.QueryExist(wid);
      if (!result || result.wid === undefined) {
        return { ok: false, error: "not_registered", phone: number };
      }
    }

    var primary = ser(result && result.wid) || ser(wid) || chatId;
    var lookupIds = [primary, chatId, number + "@s.whatsapp.net"];

    try {
      if (window.Store.LidUtils) {
        var lidWid =
          window.Store.LidUtils.getCurrentLid &&
          window.Store.LidUtils.getCurrentLid(result && result.wid ? result.wid : wid);
        var lid = ser(lidWid);
        if (lid) lookupIds.push(lid);
        var pnWid =
          window.Store.LidUtils.getPhoneNumber &&
          window.Store.LidUtils.getPhoneNumber(result && result.wid ? result.wid : wid);
        var pn = ser(pnWid);
        if (pn) lookupIds.push(pn);
      }
    } catch (e) {}

    var unique = [];
    for (var i = 0; i < lookupIds.length; i++) {
      if (lookupIds[i] && unique.indexOf(lookupIds[i]) === -1) unique.push(lookupIds[i]);
    }

    return {
      ok: true,
      contactId: primary,
      lookupIds: unique,
      unverified: !hasQuery,
    };
  } catch (e) {
    return {
      ok: false,
      error: e && e.message ? e.message : String(e),
    };
  }
}
