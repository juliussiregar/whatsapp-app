function optionalEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v === "" ? undefined : v;
}

function requiredEnv(name: string): string {
  const v = optionalEnv(name);
  if (!v) throw new Error(`Env ${name} wajib diisi`);
  return v;
}

export function isSolidPaceBotEnabled(): boolean {
  const raw = (optionalEnv("SOLIDPACE_BOT_ENABLED") ?? "true").toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function getSolidPaceApiBaseUrl(): string {
  return (
    optionalEnv("SOLIDPACE_API_BASE_URL") ??
    "https://api-solid.aluesagd.com/api/v1"
  ).replace(/\/$/, "");
}

export function getSolidPaceApiKey(): string {
  return requiredEnv("WHATSAPP_BOT_API_KEY");
}

export function getSolidPaceFetchTimeoutMs(): number {
  const n = Number(optionalEnv("SOLIDPACE_FETCH_TIMEOUT_MS") ?? "30000");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 120_000) : 30_000;
}

export function getOpenAiApiKey(): string | undefined {
  return optionalEnv("OPENAI_API_KEY");
}

export function getOpenAiModel(): string {
  return optionalEnv("OPENAI_MODEL_FAST") ?? optionalEnv("OPENAI_MODEL") ?? "gpt-4.1-mini";
}

export function getOpenAiTimeoutMs(): number {
  const n = Number(optionalEnv("OPENAI_TIMEOUT_MS") ?? "45000");
  return Number.isFinite(n) && n > 0 ? n : 45_000;
}

/** Validasi env wajib saat startup — gagal cepat sebelum bot menerima pesan. */
export function validateSolidPaceBotEnv(): void {
  if (!isSolidPaceBotEnabled()) return;

  const missing: string[] = [];
  if (!optionalEnv("WHATSAPP_BOT_API_KEY")) missing.push("WHATSAPP_BOT_API_KEY");
  if (!optionalEnv("OPENAI_API_KEY")) missing.push("OPENAI_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `SolidPace bot aktif tetapi env belum lengkap: ${missing.join(", ")}`,
    );
  }
}
