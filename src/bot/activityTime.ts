/** Konversi tanggal & durasi untuk API training-session (WIB → ISO, menit/jam → detik). */

export const WIB_TZ = "Asia/Jakarta";
export const DEFAULT_SESSION_HOUR = 6;
export const DEFAULT_SESSION_MINUTE = 0;

export type WibParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type DurationParse = {
  seconds: number | null;
  unitUnclear: boolean;
  rawNumber: number | null;
};

export type SessionDateParse = {
  iso: string | null;
  ambiguous: boolean;
  /** True if the text only mentioned a clock, not a calendar day. */
  clockOnly: boolean;
  hour: number | null;
  minute: number | null;
};

const MONTHS: Record<string, number> = {
  januari: 1,
  jan: 1,
  january: 1,
  februari: 2,
  feb: 2,
  february: 2,
  maret: 3,
  mar: 3,
  march: 3,
  april: 4,
  apr: 4,
  mei: 5,
  may: 5,
  juni: 6,
  jun: 6,
  june: 6,
  juli: 7,
  jul: 7,
  july: 7,
  agustus: 8,
  agu: 8,
  ags: 8,
  aug: 8,
  august: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  oct: 10,
  october: 10,
  november: 11,
  nov: 11,
  desember: 12,
  des: 12,
  dec: 12,
  december: 12,
};

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function wibParts(date = new Date()): WibParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: WIB_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function toSessionDateIso(
  year: number,
  month: number,
  day: number,
  hour = DEFAULT_SESSION_HOUR,
  minute = DEFAULT_SESSION_MINUTE,
): string {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
}

/** Geser kalender WIB tanpa terpengaruh zona lokal proses. */
export function shiftWibDate(date: Date, days: number): Pick<WibParts, "year" | "month" | "day"> {
  const p = wibParts(date);
  const utcNoon = Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0);
  const shifted = wibParts(new Date(utcNoon));
  return { year: shifted.year, month: shifted.month, day: shifted.day };
}

export function todaySessionDateIso(
  now = new Date(),
  hour = DEFAULT_SESSION_HOUR,
  minute = DEFAULT_SESSION_MINUTE,
): string {
  const p = wibParts(now);
  return toSessionDateIso(p.year, p.month, p.day, hour, minute);
}

const SESSION_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2})?$/;

export function normalizeSessionDateIso(raw: string): string | null {
  const t = raw.trim();
  const m = t.match(SESSION_DATE_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return toSessionDateIso(year, month, day, hour, minute);
}

export function applyDurationUnit(
  rawNumber: number,
  unit: "hours" | "minutes" | "seconds",
): number {
  const n = Math.max(0, rawNumber);
  if (unit === "hours") return Math.round(n * 3600);
  if (unit === "minutes") return Math.round(n * 60);
  return Math.round(n);
}

export function parseDurationUnitOnly(
  text: string,
): "hours" | "minutes" | "seconds" | null {
  const t = text.trim().toLowerCase().replace(/[!.?]+$/g, "");
  if (/^(jam|hours?|hrs?|j)$/.test(t)) return "hours";
  if (/^(menit|mnt|mins?|minutes?)$/.test(t)) return "minutes";
  if (/^(detik|dtk|det|secs?|seconds?)$/.test(t)) return "seconds";
  return null;
}

/**
 * Convert durasi natural language → detik.
 * Angka polos tanpa satuan → unitUnclear (bot harus tanya menit vs detik).
 */
export function parseDurationToSeconds(text: string): DurationParse {
  const t = text.trim().toLowerCase().replace(/,/g, ".");
  if (!t) return { seconds: null, unitUnclear: false, rawNumber: null };

  const justNumber = t.match(/^(\d+(?:\.\d+)?)$/);
  if (justNumber) {
    return { seconds: null, unitUnclear: true, rawNumber: Number(justNumber[1]) };
  }

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let matched = false;

  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(?:jam|hours?|hrs?)\b/g)) {
    hours += Number(m[1]);
    matched = true;
  }
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(?:menit|mnt|mins?|minutes?)\b/g)) {
    minutes += Number(m[1]);
    matched = true;
  }
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(?:detik|dtk|seconds?|secs?)\b/g)) {
    seconds += Number(m[1]);
    matched = true;
  }

  if (!matched) {
    const raw = parseUnclearDurationNumber(text);
    if (raw != null) return { seconds: null, unitUnclear: true, rawNumber: raw };
    return { seconds: null, unitUnclear: false, rawNumber: null };
  }

  const total = Math.round(hours * 3600 + minutes * 60 + seconds);
  return { seconds: total > 0 ? total : null, unitUnclear: false, rawNumber: null };
}

/** Angka terisolasi yang bukan tanggal/km/jam — kandidat durasi tanpa satuan. */
export function parseUnclearDurationNumber(text: string): number | null {
  const lower = text.toLowerCase();
  if (/\b\d+(?:[.,]\d+)?\s*(?:jam|hours?|hrs?|menit|mnt|mins?|minutes?|detik|dtk|seconds?|secs?)\b/.test(lower)) {
    return null;
  }

  let t = lower;
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  t = t.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " ");
  t = t.replace(
    /\b\d{1,2}\s+(januari|jan|january|februari|feb|february|maret|mar|march|april|apr|mei|may|juni|jun|june|juli|jul|july|agustus|agu|ags|aug|august|september|sep|sept|oktober|okt|oct|october|november|nov|desember|des|dec|december)\b(?:\s+\d{2,4})?/g,
    " ",
  );
  t = t.replace(/\b\d+(?:[.,]\d+)?\s*(?:km|kilometer|kilometre|m|meter|bpm)\b/g, " ");
  t = t.replace(/\b\d+(?:[.,]\d+)?\s*(?:kkal|kcal|kalori|kal)\b/g, " ");
  t = t.replace(/(?:bakar|terbakar|membakar)\s*(?:sekitar\s*)?\d+(?:[.,]\d+)?/g, " ");
  t = t.replace(/(?:cadence|kadens)\s*[:=]?\s*\d+(?:[.,]\d+)?/g, " ");
  t = t.replace(/(?:elevasi|elevation|gain)\s*[:=]?\s*\d+(?:[.,]\d+)?(?:\s*(?:m|meter))?/g, " ");
  t = t.replace(/\bnaik\s+\d+(?:[.,]\d+)?\s*(?:m|meter)\b/g, " ");
  t = t.replace(/(?:jam|pukul)\s+\d{1,2}(?:[:.]\d{2})?/g, " ");
  t = t.replace(/\b\d{1,2}[:.]\d{2}\b/g, " ");
  t = t.replace(/\b(?:hr|detak)\s*(?:avg|max|maks|rata(?:-rata)?)?\s*[:=]?\s*\d{2,3}\b/g, " ");

  const nums = [...t.matchAll(/\b(\d+(?:[.,]\d+)?)\b/g)].map((m) => Number(String(m[1]).replace(",", ".")));
  if (nums.length === 1 && nums[0] > 0 && nums[0] < 1000) return nums[0];
  return null;
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const t = text.toLowerCase();
  const m =
    t.match(
      /(?:jam|pukul)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam)?/,
    ) ?? t.match(/\b(\d{1,2})[:.](\d{2})\s*(pagi|siang|sore|malam)?\b/);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const period = m[3];
  if (!Number.isFinite(hour) || hour > 24 || minute > 59) return null;

  if (period === "pagi" && hour === 12) hour = 0;
  if (period === "siang" && hour < 12) hour += 12;
  if (period === "sore" && hour < 12) hour += 12;
  if (period === "malam") {
    if (hour === 12) hour = 0;
    else if (hour < 12 && hour !== 0) hour += 12;
  }
  if (hour === 24) hour = 0;
  return { hour, minute };
}

function parseYear(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < 100) return n >= 70 ? 1900 + n : 2000 + n;
  return n;
}

export function applyClockToSessionDate(
  iso: string,
  hour: number,
  minute: number,
): string {
  const normalized = normalizeSessionDateIso(iso);
  if (!normalized) return iso;
  const [date] = normalized.split("T");
  const [year, month, day] = date.split("-").map(Number);
  return toSessionDateIso(year, month, day, hour, minute);
}

function emptyDate(): SessionDateParse {
  return { iso: null, ambiguous: false, clockOnly: false, hour: null, minute: null };
}

function parseTadiPeriod(
  text: string,
  now: Date,
): Pick<WibParts, "year" | "month" | "day"> & { defaultHour: number } | null {
  const p = wibParts(now);
  const today = { year: p.year, month: p.month, day: p.day };

  if (/\btadi\s+malam\b/.test(text) || /\bmalam\s+tadi\b/.test(text)) {
    const day = p.hour < 18 ? shiftWibDate(now, -1) : today;
    return { ...day, defaultHour: 19 };
  }
  if (/\btadi\s+sore\b/.test(text) || /\bsore\s+tadi\b/.test(text)) {
    const day = p.hour < 15 ? shiftWibDate(now, -1) : today;
    return { ...day, defaultHour: 16 };
  }
  if (/\btadi\s+siang\b/.test(text) || /\bsiang\s+tadi\b/.test(text)) {
    const day = p.hour < 11 ? shiftWibDate(now, -1) : today;
    return { ...day, defaultHour: 12 };
  }
  if (/\btadi\s+pagi\b/.test(text) || /\bpagi\s+tadi\b/.test(text)) {
    return { ...today, defaultHour: DEFAULT_SESSION_HOUR };
  }
  return null;
}

/**
 * Parse tanggal natural (ID) → ISO `YYYY-MM-DDTHH:mm:00`.
 * Jam-only (`jam 7 pagi`) tidak mengarang tanggal — `clockOnly=true`.
 */
export function parseSessionDateFromText(text: string, now = new Date()): SessionDateParse {
  const t = text.trim().toLowerCase();
  const today = wibParts(now);
  const clock = parseClock(t);

  const withDay = (
    year: number,
    month: number,
    day: number,
    ambiguous = false,
    defaultHour = DEFAULT_SESSION_HOUR,
  ): SessionDateParse => {
    const hour = clock?.hour ?? defaultHour;
    const minute = clock?.minute ?? DEFAULT_SESSION_MINUTE;
    return {
      iso: toSessionDateIso(year, month, day, hour, minute),
      ambiguous,
      clockOnly: false,
      hour: clock?.hour ?? hour,
      minute: clock?.minute ?? minute,
    };
  };

  const named = t.match(
    /(\d{1,2})\s+(januari|jan|january|februari|feb|february|maret|mar|march|april|apr|mei|may|juni|jun|june|juli|jul|july|agustus|agu|ags|aug|august|september|sep|sept|oktober|okt|oct|october|november|nov|desember|des|dec|december)(?:\s+(\d{2,4}))?/,
  );
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2]] ?? 0;
    const year = parseYear(named[3], today.year);
    if (month && day >= 1 && day <= 31) return withDay(year, month, day);
  }

  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return withDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const numeric = t.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = parseYear(numeric[3], today.year);
    if (a > 12 && b >= 1 && b <= 12) return withDay(year, b, a);
    if (b > 12 && a >= 1 && a <= 12) return withDay(year, a, b, true);
    if (a <= 12 && b <= 12) return withDay(year, b, a, true);
  }

  if (/\b(hari\s+ini|sekarang)\b/.test(t)) {
    return withDay(today.year, today.month, today.day);
  }
  if (/\bkemarin\b/.test(t)) {
    const y = shiftWibDate(now, -1);
    return withDay(y.year, y.month, y.day);
  }
  if (/\bbesok\b/.test(t)) {
    const y = shiftWibDate(now, 1);
    return withDay(y.year, y.month, y.day);
  }

  const tadi = parseTadiPeriod(t, now);
  if (tadi) {
    return withDay(tadi.year, tadi.month, tadi.day, false, tadi.defaultHour);
  }

  if (/\btadi\b/.test(t)) {
    return withDay(today.year, today.month, today.day);
  }

  if (clock) {
    return {
      iso: null,
      ambiguous: false,
      clockOnly: true,
      hour: clock.hour,
      minute: clock.minute,
    };
  }

  return emptyDate();
}

export function parseDistanceKm(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, ".");
  const km = t.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometer|kilometre)\b/);
  if (km) return Number(km[1]);

  const withoutElevation = t
    .replace(/(?:elevasi|elevation|gain)\s*[:=]?\s*\d+(?:\.\d+)?(?:\s*(?:m|meter))?/g, " ")
    .replace(/\bnaik\s+\d+(?:\.\d+)?\s*(?:m|meter)\b/g, " ");

  const meters = withoutElevation.match(/(\d+(?:\.\d+)?)\s*(?:m|meter)\b/);
  if (meters) {
    const n = Number(meters[1]);
    if (n >= 100) return Math.round((n / 1000) * 1000) / 1000;
  }
  return null;
}

export function formatDurationHuman(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} jam`);
  if (m) parts.push(`${m} menit`);
  if (rem && !h) parts.push(`${rem} detik`);
  if (!parts.length) return "0 detik";
  return parts.join(" ");
}

export function formatSessionDateHuman(iso: string): string {
  const normalized = normalizeSessionDateIso(iso) ?? iso;
  const instant = new Date(`${normalized}+07:00`);
  if (Number.isNaN(instant.getTime())) return iso;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}
