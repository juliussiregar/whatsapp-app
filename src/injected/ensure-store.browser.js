/**
 * Runs inside WhatsApp Web (Puppeteer). Plain JS only.
 * Re-binds critical Store modules if WhatsApp wiped/renamed them after ready.
 */

export default function ensureStoreInBrowser() {
  function tryRequire(name) {
    try {
      if (typeof window.require === "function") return window.require(name);
    } catch (e) {}
    return null;
  }

  function findModule(predicateOrName) {
    try {
      if (!window.mR || !window.mR.findModule) return null;
      var mods =
        typeof predicateOrName === "string"
          ? window.mR.findModule(predicateOrName)
          : window.mR.findModule(predicateOrName);
      return mods && mods.length ? mods[0] : null;
    } catch (e) {
      return null;
    }
  }

  if (!window.Store || typeof window.Store !== "object") {
    var collections = tryRequire("WAWebCollections");
    window.Store = collections ? Object.assign({}, collections) : {};
  }

  if (!window.Store.WidFactory || typeof window.Store.WidFactory.createWid !== "function") {
    var widFactory = tryRequire("WAWebWidFactory");
    if (!widFactory) widFactory = findModule("createWid");
    if (widFactory) window.Store.WidFactory = widFactory;
  }

  if (typeof window.Store.QueryExist !== "function") {
    var q = tryRequire("WAWebQueryExistsJob");
    if (q && q.queryWidExists) window.Store.QueryExist = q.queryWidExists;
  }

  if (!window.Store.FindOrCreateChat) {
    var findChat = tryRequire("WAWebFindChatAction");
    if (findChat) window.Store.FindOrCreateChat = findChat;
  }

  if (!window.Store.SendMessage) {
    var send = tryRequire("WAWebSendMsgChatAction");
    if (send) window.Store.SendMessage = send;
  }

  if (!window.Store.Chat) {
    var cols = tryRequire("WAWebCollections");
    if (cols && cols.Chat) window.Store.Chat = cols.Chat;
  }

  if (!window.Store.MsgKey) {
    var msgKey = tryRequire("WAWebMsgKey");
    if (msgKey) window.Store.MsgKey = msgKey;
  }

  if (!window.Store.User) {
    var user = tryRequire("WAWebUserPrefsMeUser");
    if (user) window.Store.User = user;
  }

  if (!window.Store.LidUtils) {
    var lid = tryRequire("WAWebApiContact");
    if (lid) window.Store.LidUtils = lid;
  }

  var ok = Boolean(
    window.Store &&
      window.Store.WidFactory &&
      typeof window.Store.WidFactory.createWid === "function",
  );

  return {
    ok: ok,
    hasStore: Boolean(window.Store),
    hasWidFactory: Boolean(window.Store && window.Store.WidFactory),
    hasQueryExist: typeof (window.Store && window.Store.QueryExist) === "function",
    hasChat: Boolean(window.Store && window.Store.Chat),
    hasSendMessage: Boolean(window.Store && window.Store.SendMessage),
    hasWWebJS: Boolean(window.WWebJS),
  };
}
