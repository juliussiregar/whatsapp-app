/**
 * Log terstruktur untuk debug bot WA.
 * Set `WA_BOT_QUIET=1` untuk hanya log skip/error.
 */

const quiet = (): boolean => process.env.WA_BOT_QUIET === "1";

function line(event: string, data: Record<string, unknown>): string {
  return `[WA-BOT] ${new Date().toISOString()} ${event} ${JSON.stringify(data)}`;
}

export function waLogInfo(event: string, data: Record<string, unknown> = {}): void {
  if (quiet()) return;
  console.info(line(event, data));
}

export function waLogWarn(event: string, data: Record<string, unknown> = {}): void {
  console.warn(line(event, data));
}

export function waLogError(event: string, data: Record<string, unknown> = {}): void {
  console.error(line(event, data));
}

export function waLogTrace(event: string, data: Record<string, unknown> = {}): void {
  console.info(`[WA-BOT] ${new Date().toISOString()} ${event}`, data);
}
