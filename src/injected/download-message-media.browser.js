/**
 * Download media for a message ID inside WhatsApp Web. Plain JS only.
 */
export default async function downloadMessageMediaInBrowser(messageId) {
  var store = window.Store;
  var msg =
    store.Msg.get(messageId) ||
    (await store.Msg.getMessagesById([messageId]))?.messages?.[0];

  if (!msg) {
    return { ok: false, error: "Message not found" };
  }

  if (!msg.directPath && !msg.mediaData) {
    return { ok: false, error: "Message has no media" };
  }

  if (msg.mediaData && msg.mediaData.mediaStage === "REUPLOADING") {
    return {
      ok: false,
      error: "Media expired — buka chat di WhatsApp HP untuk memuat ulang",
    };
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

  if (
    msg.mediaData &&
    (msg.mediaData.mediaStage.includes("ERROR") ||
      msg.mediaData.mediaStage === "FETCHING")
  ) {
    return { ok: false, error: "Media tidak dapat diunduh" };
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

    var data = await window.WWebJS.arrayBufferToBase64Async(decryptedMedia);
    var mimetype = msg.mimetype || "application/octet-stream";
    var filename = msg.filename || null;

    return {
      ok: true,
      mimetype: mimetype,
      filename: filename,
      filesize: msg.size || null,
      data: data,
      type: msg.type || "document",
    };
  } catch (e) {
    if (e && e.status === 404) {
      return { ok: false, error: "Media not found (404)" };
    }
    return {
      ok: false,
      error: e && e.message ? e.message : "Download failed",
    };
  }
}
