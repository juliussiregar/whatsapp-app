/** Rate limit pemanggilan SolidPace / OpenAI per kunci (biasanya JID WhatsApp). */

const buckets = new Map<string, number[]>();

function getMaxHits(): number {
  const n = Number(process.env.SOLIDPACE_RATE_LIMIT_MAX);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 30;
}

function getWindowMs(): number {
  const n = Number(process.env.SOLIDPACE_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300_000) : 60_000;
}

export function allowApiCall(key: string): boolean {
  const now = Date.now();
  const windowMs = getWindowMs();
  const max = getMaxHits();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}
