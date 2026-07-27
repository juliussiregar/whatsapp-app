import type { Message, MessageMedia } from "whatsapp-web.js";
import { whatsAppClient } from "@/clients/whatsapp.js";
import {
  downloadLatestChatImageFromStore,
  downloadMessageMediaFromStore,
} from "@/utils/whatsapp-store.js";
import { waLogInfo, waLogWarn } from "@/bot/waLog.js";

export type DownloadedInboundMedia = {
  data: string;
  mimetype: string;
  filename: string | null;
  via: "downloadMedia" | "reload" | "store" | "chat_latest";
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errDetail(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return {
      message: e.message,
      name: e.name,
      stack: e.stack?.split("\n").slice(0, 4).join(" | "),
    };
  }
  return { raw: String(e) };
}

type RawMsgId = {
  _serialized?: string;
  fromMe?: boolean;
  remote?: string | { _serialized?: string };
  id?: string;
};

/**
 * Ambil message id serialized dari berbagai bentuk ID WhatsApp (termasuk @lid).
 * Tidak hardcode nomor user — berlaku untuk semua chat.
 */
export function resolveMessageSerializedId(message: Message): string | null {
  const id = message.id as unknown as RawMsgId | string | null | undefined;
  if (!id) return null;
  if (typeof id === "string" && id.trim()) return id.trim();

  if (typeof id === "object") {
    if (typeof id._serialized === "string" && id._serialized.trim()) {
      return id._serialized.trim();
    }

    const remote =
      typeof id.remote === "string"
        ? id.remote
        : typeof id.remote === "object" && id.remote?._serialized
          ? id.remote._serialized
          : message.from || null;
    const key = typeof id.id === "string" ? id.id : null;
    if (remote && key) {
      return `${Boolean(id.fromMe)}_${remote}_${key}`;
    }
  }

  return null;
}

function asDownloaded(
  media: MessageMedia,
  via: DownloadedInboundMedia["via"],
): DownloadedInboundMedia {
  return {
    data: media.data,
    mimetype: media.mimetype || "image/jpeg",
    filename: media.filename ?? null,
    via,
  };
}

async function tryDirectDownload(message: Message): Promise<MessageMedia | null> {
  const media = await message.downloadMedia();
  return media?.data ? media : null;
}

async function tryReloadAndDownload(msgId: string): Promise<MessageMedia | null> {
  const fresh = await whatsAppClient.getMessageById(msgId);
  if (!fresh?.hasMedia) return null;
  const media = await fresh.downloadMedia();
  return media?.data ? media : null;
}

/**
 * Unduh media inbound untuk SEMUA user.
 * Urutan: retry downloadMedia → reload message → Store by id → latest image in chat.
 */
export async function downloadInboundMedia(
  message: Message,
  opts?: { retries?: number; delayMs?: number },
): Promise<DownloadedInboundMedia> {
  const retries = opts?.retries ?? 3;
  const delayMs = opts?.delayMs ?? 1500;
  const from = message.from;
  const msgId = resolveMessageSerializedId(message);
  const rawId = message.id as unknown;

  waLogInfo("download_media_start", {
    from,
    msgId,
    type: message.type,
    hasMedia: message.hasMedia,
    timestamp: message.timestamp ?? null,
    rawIdPreview: (() => {
      try {
        return JSON.stringify(rawId)?.slice(0, 240) ?? String(rawId);
      } catch {
        return String(rawId);
      }
    })(),
  });

  let lastErr: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        waLogInfo("download_media_retry", { from, msgId, attempt, delayMs });
        await sleep(delayMs);
      }
      const media = await tryDirectDownload(message);
      if (media) {
        waLogInfo("download_media_ok", { from, msgId, attempt, via: "downloadMedia" });
        return asDownloaded(media, "downloadMedia");
      }
      waLogWarn("download_media_empty", { from, msgId, attempt });
    } catch (e) {
      lastErr = e;
      waLogWarn("download_media_attempt_fail", { from, msgId, attempt, ...errDetail(e) });
    }
  }

  if (msgId) {
    try {
      waLogInfo("download_media_reload", { from, msgId });
      await sleep(800);
      const media = await tryReloadAndDownload(msgId);
      if (media) {
        waLogInfo("download_media_ok", { from, msgId, via: "reload" });
        return asDownloaded(media, "reload");
      }
    } catch (e) {
      lastErr = e;
      waLogWarn("download_media_reload_fail", { from, msgId, ...errDetail(e) });
    }

    try {
      waLogInfo("download_media_store_fallback", { from, msgId });
      await sleep(800);
      const store = await downloadMessageMediaFromStore(msgId);
      if (store.ok && store.data) {
        waLogInfo("download_media_ok", { from, msgId, via: "store" });
        return {
          data: store.data,
          mimetype: store.mimetype || "image/jpeg",
          filename: store.filename ?? null,
          via: "store",
        };
      }
      waLogWarn("download_media_store_fail", {
        from,
        msgId,
        error: store.error ?? "empty",
      });
    } catch (e) {
      lastErr = e;
      waLogWarn("download_media_store_error", { from, msgId, ...errDetail(e) });
    }
  } else {
    waLogWarn("download_media_no_msgid", { from, rawIdType: typeof rawId });
  }

  try {
    waLogInfo("download_media_chat_latest", {
      from,
      timestamp: message.timestamp ?? null,
    });
    await sleep(800);
    const latest = await downloadLatestChatImageFromStore(from, message.timestamp);
    if (latest.ok && latest.data) {
      waLogInfo("download_media_ok", { from, via: "chat_latest" });
      return {
        data: latest.data,
        mimetype: latest.mimetype || "image/jpeg",
        filename: latest.filename ?? null,
        via: "chat_latest",
      };
    }
    waLogWarn("download_media_chat_latest_fail", {
      from,
      error: latest.error ?? "empty",
    });
  } catch (e) {
    lastErr = e;
    waLogWarn("download_media_chat_latest_error", { from, ...errDetail(e) });
  }

  const detail = lastErr ? errDetail(lastErr) : { message: "media empty" };
  throw new Error(
    `Gagal mengunduh media setelah semua fallback: ${String(detail.message ?? detail.raw ?? "unknown")}`,
  );
}
