import type { Client } from "whatsapp-web.js";
import ensureStoreInBrowser from "../injected/ensure-store.browser.js";
import resolveNumberInBrowser from "../injected/resolve-number.browser.js";

type PupPage = {
  evaluate: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>;
};

function getPupPage(client: Client): PupPage | null {
  return (client as { pupPage?: PupPage }).pupPage ?? null;
}

export type StoreHealth = {
  ok: boolean;
  hasStore?: boolean;
  hasWidFactory?: boolean;
  hasQueryExist?: boolean;
  hasChat?: boolean;
  hasSendMessage?: boolean;
  hasWWebJS?: boolean;
};

/** Heal + wait until Store.WidFactory is usable. */
export async function ensureWhatsAppStore(
  client: Client,
  {
    retries = 15,
    delayMs = 1000,
  }: { retries?: number; delayMs?: number } = {},
): Promise<StoreHealth> {
  const page = getPupPage(client);
  if (!page) return { ok: false };

  let last: StoreHealth = { ok: false };
  for (let i = 0; i < retries; i++) {
    try {
      last = (await page.evaluate(
        ensureStoreInBrowser as (...args: unknown[]) => unknown,
      )) as StoreHealth;
      if (last?.ok) {
        if (i > 0) console.info(`[WA Store] Ready after ${i + 1} attempt(s)`);
        return last;
      }
      console.warn(
        `[WA Store] not ready yet (${i + 1}/${retries}): widFactory=${last?.hasWidFactory} queryExist=${last?.hasQueryExist}`,
      );
    } catch (err) {
      console.warn("[WA Store] ensure failed:", err);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }

  console.warn("[WA Store] WidFactory still unavailable:", last);
  return last;
}

export type ResolvedNumber =
  | {
      ok: true;
      contactId: string;
      lookupIds: string[];
      unverified?: boolean;
    }
  | { ok: false; error: string; phone?: string };

export async function resolveNumberOnPage(
  client: Client,
  phoneDigits: string,
): Promise<ResolvedNumber> {
  const health = await ensureWhatsAppStore(client, { retries: 8, delayMs: 750 });
  if (!health.ok) {
    return {
      ok: false,
      error:
        "WhatsApp Store belum siap (WidFactory missing). Tunggu beberapa detik atau POST /whatsapp/reconnect.",
    };
  }

  const page = getPupPage(client);
  if (!page) return { ok: false, error: "WhatsApp page tidak tersedia" };

  const result = (await page.evaluate(
    resolveNumberInBrowser as (...args: unknown[]) => unknown,
    phoneDigits,
  )) as ResolvedNumber;

  return result;
}
