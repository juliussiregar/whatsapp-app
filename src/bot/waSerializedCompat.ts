import type { Client } from "whatsapp-web.js";
import applySerializedIdCompatInBrowser from "../injected/serialized-id-compat.browser.js";

/**
 * WhatsApp Web (mid-2026) renamed WID/message id getter `_serialized` → `$1`.
 * whatsapp-web.js 1.34.x still reads `_serialized`, which becomes undefined and
 * surfaces as the opaque puppeteer error `r: r` in getChats / getChatById / etc.
 */
export async function applySerializedIdCompat(client: Client): Promise<void> {
  const page = (
    client as {
      pupPage?: {
        evaluate: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>;
      };
    }
  ).pupPage;
  if (!page) {
    console.warn("[WA Compat] pupPage not available — skip _serialized/$1 patch");
    return;
  }

  try {
    const result = (await page.evaluate(
      applySerializedIdCompatInBrowser as (...args: unknown[]) => unknown,
    )) as { applied?: boolean; reason?: string } | undefined;
    if (result?.applied) {
      console.info("[WA Compat] Applied _serialized/$1 fallback patch");
    } else {
      console.info(
        `[WA Compat] Patch skipped (${result?.reason || "unknown"})`,
      );
    }
  } catch (err) {
    console.warn("[WA Compat] Failed to apply patch:", err);
  }
}
