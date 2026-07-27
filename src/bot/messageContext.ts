import type { Message } from "whatsapp-web.js";
import { waLogInfo, waLogWarn } from "@/bot/waLog.js";
import { whatsAppClient } from "@/clients/whatsapp.js";
import {
  digitsToSolidPacePhone,
  waJidToSolidPacePhone,
} from "@/utils/phone.js";

/**
 * Session key stabil per chat.
 * Chat `@c.us`: pakai JID langsung.
 * Chat `@lid`: resolve ke contact id jika memungkinkan.
 */
export async function stableSessionKeyForMessage(message: Message): Promise<string> {
  if (message.from.endsWith("@c.us")) return message.from;
  try {
    const c = await message.getContact();
    return c.id?._serialized ?? message.from;
  } catch {
    return message.from;
  }
}

/**
 * Nomor untuk SolidPace API (`+62…`).
 * Untuk `@lid`, wajib lewat `getContactLidAndPhone` → field `pn`.
 */
export async function resolveUserPhoneForSolidPace(message: Message): Promise<string> {
  if (message.from.endsWith("@c.us")) {
    return waJidToSolidPacePhone(message.from);
  }

  if (message.from.endsWith("@lid")) {
    try {
      const rows = await whatsAppClient.getContactLidAndPhone([message.from]);
      const pn = rows?.[0]?.pn;
      if (pn && pn.endsWith("@c.us")) {
        waLogInfo("phone_resolved_lid", { lid: message.from, pn });
        return waJidToSolidPacePhone(pn);
      }
      waLogWarn("getContactLidAndPhone_empty_pn", { from: message.from, rows });
    } catch (e) {
      waLogWarn("getContactLidAndPhone_error", {
        from: message.from,
        err: e instanceof Error ? e.message : String(e),
      });
    }
    throw new Error(
      "Tidak bisa memetakan chat ke nomor HP. Pastikan percakapan 1:1 sudah aktif.",
    );
  }

  const c = await message.getContact();
  const raw = (c.number ?? "").replace(/\D/g, "");
  if (!raw) {
    throw new Error("Kontak tanpa nomor (format chat tidak dikenali)");
  }
  return digitsToSolidPacePhone(raw);
}
