/** Chat 1:1 ke user (bukan grup/status). Termasuk @lid (WhatsApp baru). */
export function isDirectUserChat(from: string): boolean {
  if (!from) return false;
  if (from.endsWith("@g.us")) return false;
  if (from.includes("newsletter")) return false;
  if (from === "status@broadcast") return false;
  return from.endsWith("@c.us") || from.endsWith("@lid");
}

/** Digit nomor mentah dari JID @c.us (biasanya 62…). */
export function digitsFromWaJid(from: string): string {
  return from.replace(/@c\.us$/i, "").replace(/\D/g, "");
}

/**
 * Format nomor untuk SolidPace WhatsApp Integration API.
 * Prefer `+62…` — BE menormalisasi otomatis.
 */
export function toSolidPacePhone(digitsOrJid: string): string {
  let d = digitsOrJid.replace(/\D/g, "");
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  if (!d.startsWith("62")) d = `62${d}`;
  return `+${d}`;
}

export function digitsToSolidPacePhone(digitsRaw: string): string {
  return toSolidPacePhone(digitsRaw);
}

export function waJidToSolidPacePhone(from: string): string {
  return toSolidPacePhone(digitsFromWaJid(from));
}
