/**
 * Ambil image terbaru di chat, lalu decrypt media. Plain JS only (Puppeteer evaluate).
 */
export default async function downloadLatestChatImageInBrowser(chatId, aroundTimestamp) {
  var store = window.Store;
  var WWebJS = window.WWebJS;

  var chat = store.Chat.get(chatId);
  if (!chat) {
    try {
      chat = await store.Chat.find(chatId);
    } catch (e) {
      chat = null;
    }
  }
  if (!chat && WWebJS && WWebJS.getChat) {
    try {
      chat = await WWebJS.getChat(chatId, { getAsModel: false });
    } catch (e) {
      chat = null;
    }
  }
  if (!chat) {
    return { ok: false, error: "chat_not_found" };
  }

  var models = [];
  try {
    models = chat.msgs && chat.msgs.getModelsArray ? chat.msgs.getModelsArray() : [];
  } catch (e) {
    models = [];
  }

  var images = models
    .filter(function (m) {
      return m && m.type === "image" && (m.directPath || m.hasMedia);
    })
    .sort(function (a, b) {
      return (b.t || 0) - (a.t || 0);
    });

  var msg = images[0] || null;
  if (aroundTimestamp != null && images.length) {
    var nearest = null;
    var best = Infinity;
    for (var i = 0; i < images.length; i++) {
      var diff = Math.abs((images[i].t || 0) - aroundTimestamp);
      if (diff < best) {
        best = diff;
        nearest = images[i];
      }
    }
    if (nearest && best <= 10) msg = nearest;
  }

  if (!msg) {
    return { ok: false, error: "no_image_in_chat" };
  }

  if (
    msg.mediaData &&
    msg.mediaData.mediaStage &&
    msg.mediaData.mediaStage !== "RESOLVED"
  ) {
    try {
      await msg.downloadMedia({
        downloadEvenIfExpensive: true,
        rmrReason: 1,
      });
    } catch (e) {
      /* ignore */
    }
  }

  try {
    var mockQpl = {
      addAnnotations: function () {
        return this;
      },
      addPoint: function () {
        return this;
      },
    };
    var decryptedMedia = await store.DownloadManager.downloadAndMaybeDecrypt({
      directPath: msg.directPath,
      encFilehash: msg.encFilehash,
      filehash: msg.filehash,
      mediaKey: msg.mediaKey,
      mediaKeyTimestamp: msg.mediaKeyTimestamp,
      type: msg.type,
      signal: new AbortController().signal,
      downloadQpl: mockQpl,
    });
    var data = await WWebJS.arrayBufferToBase64Async(decryptedMedia);
    return {
      ok: true,
      data: data,
      mimetype: msg.mimetype || "image/jpeg",
      filename: msg.filename || null,
      msgId: (msg.id && msg.id._serialized) || null,
    };
  } catch (e) {
    return {
      ok: false,
      error: e && e.message ? e.message : "Download failed",
    };
  }
}
