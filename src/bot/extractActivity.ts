import OpenAI from "openai";
import {
  applyClockToSessionDate,
  applyDurationUnit,
  DEFAULT_SESSION_HOUR,
  DEFAULT_SESSION_MINUTE,
  normalizeSessionDateIso,
  parseDistanceKm,
  parseDurationToSeconds,
  parseDurationUnitOnly,
  parseSessionDateFromText,
  todaySessionDateIso,
  wibParts,
  type DurationParse,
} from "@/bot/activityTime.js";
import { withAiFallbackNote } from "@/bot/extractFood.js";
import { hasStrongFoodSignal, shouldSwitchToFood } from "@/bot/intent.js";
import { getOpenAiApiKey, getOpenAiModel, getOpenAiTimeoutMs } from "@/config.js";
import type { ActivityClarifyNeed, ActivityDraft, ActivityPartial } from "@/bot/session.js";

export const ACTIVITY_LABELS: Record<string, string> = {
  run: "Lari",
  bike: "Sepeda",
  swim: "Renang",
  strength: "Latihan beban",
  walk: "Jalan kaki",
  yoga: "Yoga",
};

const ACTIVITY_ALIASES: Record<string, string[]> = {
  run: ["run", "running", "lari", "berlari", "jogging", "joging", "jog"],
  bike: ["bike", "cycling", "cycle", "sepeda", "bersepeda", "gowes"],
  swim: ["swim", "swimming", "renang", "berenang"],
  strength: ["strength", "gym", "weight", "beban", "angkat beban", "fitness", "latihan beban"],
  walk: ["walk", "walking", "jalan kaki", "jalan pagi", "jalan", "hiking", "hike"],
  yoga: ["yoga"],
};

function textHasAlias(text: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
}

export type ExtractedActivity = {
  is_activity_log: boolean;
  activity_type: string | null;
  session_name: string | null;
  session_date: string | null;
  duration_seconds: number | null;
  duration_unit_unclear: boolean;
  unclear_duration_number: number | null;
  date_ambiguous: boolean;
  distance_km: number | null;
  elevation_gain: number | null;
  hr_avg: number | null;
  hr_max: number | null;
  cadence_avg: number | null;
  calories: number | null;
  notes: string | null;
};

export type ActivityCorrection = {
  is_correction: boolean;
  activity_type: string | null;
  session_name: string | null;
  session_date: string | null;
  duration_seconds: number | null;
  duration_unit_unclear: boolean;
  unclear_duration_number: number | null;
  date_ambiguous: boolean;
  distance_km: number | null;
  elevation_gain: number | null;
  hr_avg: number | null;
  hr_max: number | null;
  cadence_avg: number | null;
  calories: number | null;
  notes: string | null;
  clock_hour: number | null;
  clock_minute: number | null;
};

function getClient(): OpenAI | null {
  const key = getOpenAiApiKey();
  if (!key) return null;
  return new OpenAI({ apiKey: key, timeout: getOpenAiTimeoutMs() });
}

function parseElevationMeters(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, ".");
  const labeled = t.match(
    /(?:elevasi|elevation|gain)\s*[:=]?\s*(\d+(?:\.\d+)?)(?:\s*(?:m|meter))?/,
  );
  if (labeled) return Number(labeled[1]);
  const naik = t.match(/\bnaik\s+(\d+(?:\.\d+)?)\s*(?:m|meter)\b/);
  if (naik) return Number(naik[1]);
  return null;
}

function parseCaloriesBurned(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, ".");
  const burned = t.match(
    /(?:bakar|terbakar|membakar)\s*(?:sekitar\s*)?(\d+(?:\.\d+)?)\s*(?:kkal|kcal|kalori)?/,
  );
  if (burned) return Number(burned[1]);
  const trailing = t.match(/(\d+(?:\.\d+)?)\s*(?:kkal|kcal|kalori)\s*(?:terbakar|dibakar)?/);
  if (trailing) return Number(trailing[1]);
  return null;
}

function parseCadence(text: string): number | null {
  const m = text.toLowerCase().match(/(?:cadence|kadens)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(",", ".")) : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const NOT_ACTIVITY_TOKENS = new Set([
  "menit",
  "mnt",
  "min",
  "mins",
  "minute",
  "minutes",
  "jam",
  "hour",
  "hours",
  "detik",
  "dtk",
  "sec",
  "secs",
  "second",
  "seconds",
  "km",
  "ya",
  "iya",
  "ok",
  "oke",
  "batal",
  "kemarin",
  "besok",
  "pagi",
  "siang",
  "sore",
  "malam",
  "tadi",
  "hari",
]);

export function normalizeActivityType(raw?: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  for (const [canonical, aliases] of Object.entries(ACTIVITY_ALIASES)) {
    if (t === canonical || aliases.some((a) => textHasAlias(t, a))) return canonical;
  }
  if (t.length > 24 || /\s/.test(t) || /^\d/.test(t) || NOT_ACTIVITY_TOKENS.has(t)) return null;
  const slug = t.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return slug || null;
}

export function defaultSessionName(activityType: string): string {
  const label = ACTIVITY_LABELS[activityType] ?? activityType.replace(/_/g, " ");
  const titled = label.charAt(0).toUpperCase() + label.slice(1);
  return `${titled} via WA`;
}

export function activityLabel(activityType: string): string {
  return ACTIVITY_LABELS[activityType] ?? activityType.replace(/_/g, " ");
}

function durationFromLlm(raw: Record<string, unknown>): DurationParse {
  const unitUnclear = Boolean(raw.duration_unit_unclear);
  const unclear = asNumber(raw.unclear_duration_number);
  const hours = asNumber(raw.duration_hours) ?? 0;
  const minutes = asNumber(raw.duration_minutes) ?? 0;
  const seconds = asNumber(raw.duration_seconds) ?? 0;
  const total = Math.round(hours * 3600 + minutes * 60 + seconds);
  if (unitUnclear && unclear != null) {
    return { seconds: null, unitUnclear: true, rawNumber: unclear };
  }
  if (total > 0) return { seconds: total, unitUnclear: false, rawNumber: null };
  return { seconds: null, unitUnclear, rawNumber: unclear };
}

function mergeDuration(heuristic: DurationParse, llm: DurationParse): DurationParse {
  if (heuristic.seconds != null && heuristic.seconds > 0) return heuristic;
  if (heuristic.unitUnclear && heuristic.rawNumber != null) {
    if (llm.seconds != null && llm.seconds > 0) return llm;
    return heuristic;
  }
  if (llm.seconds != null && llm.seconds > 0) return llm;
  return llm.unitUnclear ? llm : heuristic;
}

function mergeDate(
  heuristic: { iso: string | null; ambiguous: boolean },
  llmIso: string | null,
  llmAmbiguous: boolean,
  now: Date,
): { iso: string; ambiguous: boolean } {
  const llmNorm = llmIso ? normalizeSessionDateIso(llmIso) : null;
  if (heuristic.iso && !heuristic.ambiguous) {
    return { iso: heuristic.iso, ambiguous: false };
  }
  if (llmNorm) {
    return { iso: llmNorm, ambiguous: heuristic.ambiguous || llmAmbiguous };
  }
  if (heuristic.iso) {
    return { iso: heuristic.iso, ambiguous: heuristic.ambiguous || llmAmbiguous };
  }
  return { iso: todaySessionDateIso(now), ambiguous: false };
}

export function parseActivityHeuristic(text: string, now = new Date()): ExtractedActivity {
  const duration = parseDurationToSeconds(text);
  const date = parseSessionDateFromText(text, now);
  const type = normalizeActivityType(text);
  const distance = parseDistanceKm(text);

  const hrAvg = text.match(/(?:hr|detak|bpm)\s*(?:avg|rata(?:-rata)?)?\s*[:=]?\s*(\d{2,3})/i);
  const hrMax = text.match(/(?:hr|detak|bpm)\s*(?:max|maks)\s*[:=]?\s*(\d{2,3})/i);

  const isActivity =
    Boolean(type) && (duration.seconds != null || duration.unitUnclear || distance != null);

  let session_date = date.iso;
  if (!session_date && date.clockOnly && date.hour != null) {
    session_date = todaySessionDateIso(now, date.hour, date.minute ?? 0);
  }

  return {
    is_activity_log: isActivity,
    activity_type: type,
    session_name: type ? defaultSessionName(type) : null,
    session_date,
    duration_seconds: duration.seconds,
    duration_unit_unclear: duration.unitUnclear,
    unclear_duration_number: duration.rawNumber,
    date_ambiguous: date.ambiguous,
    distance_km: distance,
    elevation_gain: parseElevationMeters(text),
    hr_avg: hrAvg ? Number(hrAvg[1]) : null,
    hr_max: hrMax ? Number(hrMax[1]) : null,
    cadence_avg: parseCadence(text),
    calories: parseCaloriesBurned(text),
    notes: null,
  };
}

function normalizeExtracted(raw: Record<string, unknown>, text: string, now: Date): ExtractedActivity {
  const heuristic = parseActivityHeuristic(text, now);
  const llmDuration = durationFromLlm(raw);
  const duration = mergeDuration(
    {
      seconds: heuristic.duration_seconds,
      unitUnclear: heuristic.duration_unit_unclear,
      rawNumber: heuristic.unclear_duration_number,
    },
    llmDuration,
  );
  const type =
    normalizeActivityType(typeof raw.activity_type === "string" ? raw.activity_type : null) ??
    heuristic.activity_type;
  const llmDate =
    typeof raw.session_date === "string" ? normalizeSessionDateIso(raw.session_date) : null;
  const date = mergeDate(
    { iso: heuristic.session_date, ambiguous: heuristic.date_ambiguous },
    llmDate,
    Boolean(raw.date_ambiguous),
    now,
  );
  const sessionName =
    typeof raw.session_name === "string" && raw.session_name.trim()
      ? raw.session_name.trim().slice(0, 120)
      : type
        ? defaultSessionName(type)
        : null;

  const isLog = Boolean(raw.is_activity_log) || heuristic.is_activity_log || Boolean(type && duration.seconds);

  return {
    is_activity_log: Boolean(isLog && (type || duration.seconds || duration.unitUnclear)),
    activity_type: type,
    session_name: sessionName,
    session_date: date.iso,
    duration_seconds: duration.seconds,
    duration_unit_unclear: duration.unitUnclear && duration.seconds == null,
    unclear_duration_number: duration.rawNumber,
    date_ambiguous: date.ambiguous,
    distance_km: asNumber(raw.distance_km) ?? heuristic.distance_km,
    elevation_gain: asNumber(raw.elevation_gain) ?? heuristic.elevation_gain,
    hr_avg: asNumber(raw.hr_avg) ?? heuristic.hr_avg,
    hr_max: asNumber(raw.hr_max) ?? heuristic.hr_max,
    cadence_avg: asNumber(raw.cadence_avg) ?? heuristic.cadence_avg,
    calories: asNumber(raw.calories) ?? heuristic.calories,
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim().slice(0, 2000) : null,
  };
}

function normalizeCorrection(raw: Record<string, unknown>, text: string, now: Date): ActivityCorrection {
  const heuristic = parseActivityHeuristic(text, now);
  const unitOnly = parseDurationUnitOnly(text);
  const duration = parseDurationToSeconds(text);
  const llmDuration = durationFromLlm(raw);

  let durationSeconds: number | null = duration.seconds ?? llmDuration.seconds;
  let unitUnclear = duration.unitUnclear || (Boolean(raw.duration_unit_unclear) && durationSeconds == null);
  let unclearNumber = duration.rawNumber ?? llmDuration.rawNumber;

  if (unitOnly && heuristic.unclear_duration_number == null && duration.seconds == null) {
    // "menit" saja — ditangani di clarify, bukan koreksi penuh
    unitUnclear = false;
  }

  const type =
    normalizeActivityType(typeof raw.activity_type === "string" ? raw.activity_type : null) ??
    (heuristic.activity_type && ACTIVITY_ALIASES[heuristic.activity_type]?.some((a) =>
      text.toLowerCase().includes(a),
    )
      ? heuristic.activity_type
      : null);

  const date = parseSessionDateFromText(text, now);
  const llmDate =
    typeof raw.session_date === "string" ? normalizeSessionDateIso(raw.session_date) : null;

  const touched =
    Boolean(raw.is_correction) ||
    type != null ||
    durationSeconds != null ||
    unitUnclear ||
    date.iso != null ||
    date.clockOnly ||
    (!date.clockOnly && llmDate != null) ||
    heuristic.distance_km != null ||
    asNumber(raw.distance_km) != null ||
    heuristic.elevation_gain != null ||
    asNumber(raw.elevation_gain) != null ||
    asNumber(raw.hr_avg) != null ||
    asNumber(raw.hr_max) != null ||
    heuristic.cadence_avg != null ||
    asNumber(raw.cadence_avg) != null ||
    heuristic.calories != null ||
    asNumber(raw.calories) != null;

  return {
    is_correction: touched,
    activity_type: type,
    session_name:
      typeof raw.session_name === "string" && raw.session_name.trim() ? raw.session_name.trim() : null,
    session_date: date.clockOnly ? null : date.iso ?? llmDate,
    duration_seconds: durationSeconds,
    duration_unit_unclear: unitUnclear && durationSeconds == null,
    unclear_duration_number: unclearNumber,
    date_ambiguous: date.ambiguous || Boolean(raw.date_ambiguous),
    distance_km: asNumber(raw.distance_km) ?? heuristic.distance_km,
    elevation_gain: asNumber(raw.elevation_gain) ?? heuristic.elevation_gain,
    hr_avg: asNumber(raw.hr_avg) ?? heuristic.hr_avg,
    hr_max: asNumber(raw.hr_max) ?? heuristic.hr_max,
    cadence_avg: asNumber(raw.cadence_avg) ?? heuristic.cadence_avg,
    calories: asNumber(raw.calories) ?? heuristic.calories,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    clock_hour: date.clockOnly ? date.hour : null,
    clock_minute: date.clockOnly ? date.minute : null,
  };
}

function todayPrompt(now: Date): string {
  const p = wibParts(now);
  const human = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return `Hari ini (WIB): ${human} (${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}). Default jam jika user tidak sebut jam: ${String(DEFAULT_SESSION_HOUR).padStart(2, "0")}:${String(DEFAULT_SESSION_MINUTE).padStart(2, "0")}.`;
}

const SYSTEM = `Kamu asisten latihan SolidPace. Tugasmu mengekstrak log aktivitas yang SUDAH SELESAI dari pesan WhatsApp atlet (Bahasa Indonesia).

Balas HANYA JSON valid tanpa markdown, dengan skema:
{
  "is_activity_log": boolean,
  "activity_type": "run"|"bike"|"swim"|"strength"|"walk"|string|null,
  "session_name": string|null,
  "session_date": string|null,
  "date_ambiguous": boolean,
  "duration_hours": number|null,
  "duration_minutes": number|null,
  "duration_seconds": number|null,
  "duration_unit_unclear": boolean,
  "unclear_duration_number": number|null,
  "distance_km": number|null,
  "elevation_gain": number|null,
  "hr_avg": number|null,
  "hr_max": number|null,
  "cadence_avg": number|null,
  "calories": number|null,
  "notes": string|null
}

Aturan:
- is_activity_log=true hanya jika pesan jelas mencatat aktivitas olahraga yang sudah dilakukan.
- Bukan aktivitas: makanan/minuman, sapaan, pertanyaan umum, rencana workout, file jam (.fit/.gpx) → is_activity_log=false.
- activity_type canonical: lari/jogging → run; sepeda/gowes → bike; renang → swim; gym/beban → strength; jalan kaki → walk; yoga → yoga.
- session_date ISO tanpa zona: "YYYY-MM-DDTHH:mm:00". "hari ini"/"kemarin" relatif ke tanggal WIB yang diberi. Jika user tidak sebut jam, pakai 06:00.
- JANGAN mengarang durasi. Jika tidak disebut → duration_* null.
- Jika user hanya angka tanpa satuan (contoh "40") → duration_unit_unclear=true, unclear_duration_number=angka itu, duration_* yang lain null.
- "40 menit" → duration_minutes=40. "1 jam 30 menit" → duration_hours=1, duration_minutes=30.
- distance_km dalam kilometer. "5km" → 5. HR hanya jika disebut.
- elevation_gain dalam meter jika disebut (elevasi/naik 200m). calories = kalori terbakar jika disebut.
- cadence_avg jika disebut.
- date_ambiguous=true jika format tanggal bisa dibaca dua cara (mis. 07/17/26).
- Jangan mengarang activity_type yang tidak ada di pesan.`;

const CORRECTION_SYSTEM = `Kamu asisten latihan SolidPace. User sedang mengoreksi ringkasan aktivitas yang sudah ada.

Balas HANYA JSON valid tanpa markdown, dengan skema:
{
  "is_correction": boolean,
  "activity_type": "run"|"bike"|"swim"|"strength"|"walk"|string|null,
  "session_name": string|null,
  "session_date": string|null,
  "date_ambiguous": boolean,
  "duration_hours": number|null,
  "duration_minutes": number|null,
  "duration_seconds": number|null,
  "duration_unit_unclear": boolean,
  "unclear_duration_number": number|null,
  "distance_km": number|null,
  "elevation_gain": number|null,
  "hr_avg": number|null,
  "hr_max": number|null,
  "cadence_avg": number|null,
  "calories": number|null,
  "notes": string|null
}

Aturan:
- is_correction=true jika pesan mengubah durasi, jarak, tanggal, jam, jenis aktivitas, HR, elevasi, cadence, atau kalori.
- Field yang TIDAK disebut → null.
- Durasi: "50 menit" → duration_minutes=50. Jangan isi field yang tidak disebut.`;

export function mergeActivityCorrection(
  draft: ActivityDraft,
  patch: ActivityCorrection,
): ActivityDraft {
  const activityType = patch.activity_type ?? draft.activity_type;
  let session_date = patch.session_date ?? draft.session_date;
  if (!patch.session_date && patch.clock_hour != null) {
    session_date = applyClockToSessionDate(
      draft.session_date,
      patch.clock_hour,
      patch.clock_minute ?? 0,
    );
  }
  return {
    ...draft,
    activity_type: activityType,
    session_name: patch.session_name ?? (patch.activity_type ? defaultSessionName(activityType) : draft.session_name),
    session_date,
    duration:
      patch.duration_seconds != null && patch.duration_seconds > 0
        ? patch.duration_seconds
        : draft.duration,
    distance: patch.distance_km != null && patch.distance_km > 0 ? patch.distance_km : draft.distance,
    elevation_gain:
      patch.elevation_gain != null && patch.elevation_gain > 0 ? patch.elevation_gain : draft.elevation_gain,
    hr_avg: patch.hr_avg != null && patch.hr_avg > 0 ? patch.hr_avg : draft.hr_avg,
    hr_max: patch.hr_max != null && patch.hr_max > 0 ? patch.hr_max : draft.hr_max,
    cadence_avg: patch.cadence_avg != null && patch.cadence_avg > 0 ? patch.cadence_avg : draft.cadence_avg,
    calories: patch.calories != null && patch.calories > 0 ? patch.calories : draft.calories,
    notes: patch.notes ?? draft.notes,
    dateAmbiguous: patch.session_date ? patch.date_ambiguous : draft.dateAmbiguous,
  };
}

export function activityDraftToPartial(draft: ActivityDraft): ActivityPartial {
  return {
    activity_type: draft.activity_type,
    session_name: draft.session_name,
    session_date: draft.session_date,
    duration: draft.duration,
    distance: draft.distance,
    elevation_gain: draft.elevation_gain,
    hr_avg: draft.hr_avg,
    hr_max: draft.hr_max,
    cadence_avg: draft.cadence_avg,
    calories: draft.calories,
    notes: draft.notes,
    dateAmbiguous: draft.dateAmbiguous,
  };
}

export function applyActivityCorrection(
  draft: ActivityDraft,
  patch: ActivityCorrection,
):
  | { kind: "confirm"; draft: ActivityDraft }
  | { kind: "clarify"; partial: ActivityPartial; needs: ActivityClarifyNeed[] } {
  if (
    patch.duration_unit_unclear &&
    patch.unclear_duration_number != null &&
    (patch.duration_seconds == null || patch.duration_seconds <= 0)
  ) {
    const merged = mergeActivityCorrection(draft, { ...patch, duration_seconds: null });
    const partial: ActivityPartial = {
      ...activityDraftToPartial(merged),
      duration: undefined,
      unclearDurationNumber: patch.unclear_duration_number,
    };
    return { kind: "clarify", partial, needs: clarifyNeeds(partial) };
  }
  return { kind: "confirm", draft: mergeActivityCorrection(draft, patch) };
}

export function mergeActivityPartial(
  partial: ActivityPartial,
  extracted: ExtractedActivity,
): ActivityPartial {
  const duration =
    extracted.duration_seconds != null && extracted.duration_seconds > 0
      ? extracted.duration_seconds
      : partial.duration;
  const type = extracted.activity_type ?? partial.activity_type;
  return {
    ...partial,
    activity_type: type,
    session_name:
      extracted.session_name ??
      (type ? defaultSessionName(type) : partial.session_name),
    session_date: extracted.session_date ?? partial.session_date,
    duration,
    distance: extracted.distance_km ?? partial.distance,
    elevation_gain: extracted.elevation_gain ?? partial.elevation_gain,
    hr_avg: extracted.hr_avg ?? partial.hr_avg,
    hr_max: extracted.hr_max ?? partial.hr_max,
    cadence_avg: extracted.cadence_avg ?? partial.cadence_avg,
    calories: extracted.calories ?? partial.calories,
    notes: extracted.notes ?? partial.notes,
    dateAmbiguous: extracted.date_ambiguous || partial.dateAmbiguous,
    unclearDurationNumber: extracted.duration_unit_unclear
      ? extracted.unclear_duration_number ?? partial.unclearDurationNumber
      : duration
        ? undefined
        : partial.unclearDurationNumber,
  };
}

export function extractedToPartial(extracted: ExtractedActivity, now = new Date()): ActivityPartial {
  return {
    activity_type: extracted.activity_type ?? undefined,
    session_name: extracted.session_name ?? undefined,
    session_date: extracted.session_date ?? todaySessionDateIso(now),
    duration: extracted.duration_seconds ?? undefined,
    distance: extracted.distance_km ?? undefined,
    elevation_gain: extracted.elevation_gain ?? undefined,
    hr_avg: extracted.hr_avg ?? undefined,
    hr_max: extracted.hr_max ?? undefined,
    cadence_avg: extracted.cadence_avg ?? undefined,
    calories: extracted.calories ?? undefined,
    notes: extracted.notes ?? undefined,
    dateAmbiguous: extracted.date_ambiguous || undefined,
    unclearDurationNumber: extracted.duration_unit_unclear
      ? extracted.unclear_duration_number ?? undefined
      : undefined,
  };
}

export function activityDraftFromPartial(partial: ActivityPartial): ActivityDraft | null {
  if (!partial.activity_type || !partial.session_date) return null;
  if (partial.duration == null || partial.duration <= 0) return null;
  return {
    activity_type: partial.activity_type,
    session_name: partial.session_name ?? defaultSessionName(partial.activity_type),
    session_date: partial.session_date,
    duration: partial.duration,
    distance: partial.distance,
    elevation_gain: partial.elevation_gain,
    hr_avg: partial.hr_avg,
    hr_max: partial.hr_max,
    cadence_avg: partial.cadence_avg,
    calories: partial.calories,
    notes: partial.notes,
    dateAmbiguous: partial.dateAmbiguous,
  };
}

export function clarifyNeeds(partial: ActivityPartial): ActivityClarifyNeed[] {
  const needs: ActivityClarifyNeed[] = [];
  if (!partial.activity_type) needs.push("activity_type");
  if (partial.unclearDurationNumber != null && (partial.duration == null || partial.duration <= 0)) {
    needs.push("duration_unit");
  } else if (partial.duration == null || partial.duration <= 0) {
    needs.push("duration");
  }
  return needs;
}

export function applyActivityClarifyText(
  partial: ActivityPartial,
  text: string,
  now = new Date(),
): ActivityPartial {
  const next: ActivityPartial = { ...partial };
  const unit = parseDurationUnitOnly(text);
  if (unit && next.unclearDurationNumber != null) {
    next.duration = applyDurationUnit(next.unclearDurationNumber, unit);
    next.unclearDurationNumber = undefined;
  }

  const duration = parseDurationToSeconds(text);
  if (duration.seconds != null && duration.seconds > 0) {
    next.duration = duration.seconds;
    next.unclearDurationNumber = undefined;
  } else if (duration.unitUnclear && duration.rawNumber != null) {
    next.unclearDurationNumber = duration.rawNumber;
  }

  const trimmed = text.trim();
  if (!unit) {
    const type = normalizeActivityType(trimmed.length < 48 ? trimmed : text);
    if (type && (trimmed.length < 48 || ACTIVITY_ALIASES[type]?.some((a) => trimmed.toLowerCase().includes(a)))) {
      next.activity_type = type;
      next.session_name = defaultSessionName(type);
    }
  }

  const date = parseSessionDateFromText(text, now);
  if (date.iso) {
    next.session_date = date.iso;
    next.dateAmbiguous = date.ambiguous;
  } else if (date.clockOnly && date.hour != null) {
    if (next.session_date) {
      next.session_date = applyClockToSessionDate(
        next.session_date,
        date.hour,
        date.minute ?? 0,
      );
    } else {
      next.session_date = todaySessionDateIso(now, date.hour, date.minute ?? 0);
    }
  }
  if (!next.session_date) next.session_date = todaySessionDateIso(now);

  const dist = parseDistanceKm(text);
  if (dist != null) next.distance = dist;

  const elevation = parseElevationMeters(text);
  if (elevation != null) next.elevation_gain = elevation;
  const cadence = parseCadence(text);
  if (cadence != null) next.cadence_avg = cadence;
  const calories = parseCaloriesBurned(text);
  if (calories != null) next.calories = calories;

  return next;
}

export function parseQuickActivityCorrection(
  text: string,
  now = new Date(),
): ActivityCorrection | null {
  const t = text.trim();
  if (!t) return null;
  if (shouldSwitchToFood(t)) return null;

  const duration = parseDurationToSeconds(t);
  const date = parseSessionDateFromText(t, now);
  const type = normalizeActivityType(t);
  const distance = parseDistanceKm(t);
  const elevation = parseElevationMeters(t);
  const cadence = parseCadence(t);
  const calories = parseCaloriesBurned(t);
  const hrAvg = t.match(/(?:hr|detak|bpm)\s*(?:avg|rata(?:-rata)?)?\s*[:=]?\s*(\d{2,3})/i);
  const hrMax = t.match(/(?:hr|detak|bpm)\s*(?:max|maks)\s*[:=]?\s*(\d{2,3})/i);

  const typeMentioned = Boolean(
    type && Object.values(ACTIVITY_ALIASES).some((aliases) => aliases.some((a) => textHasAlias(t, a))),
  );

  const touched =
    duration.seconds != null ||
    duration.unitUnclear ||
    date.iso != null ||
    date.clockOnly ||
    typeMentioned ||
    distance != null ||
    elevation != null ||
    cadence != null ||
    calories != null ||
    hrAvg != null ||
    hrMax != null;

  if (!touched) return null;

  return {
    is_correction: true,
    activity_type: typeMentioned ? type : null,
    session_name: null,
    session_date: date.iso,
    duration_seconds: duration.seconds,
    duration_unit_unclear: duration.unitUnclear,
    unclear_duration_number: duration.rawNumber,
    date_ambiguous: date.ambiguous,
    distance_km: distance,
    elevation_gain: elevation,
    hr_avg: hrAvg ? Number(hrAvg[1]) : null,
    hr_max: hrMax ? Number(hrMax[1]) : null,
    cadence_avg: cadence,
    calories: calories,
    notes: null,
    clock_hour: date.clockOnly ? date.hour : null,
    clock_minute: date.clockOnly ? date.minute : null,
  };
}

const ACTIVITY_SOFT_HINT_RE =
  /\b(menit|jam|km|kilometer|kemarin|besok|tadi|elevasi|cadence|durasi|detik|jarak|lebih\s+lama|kurang|salah)\b/i;

/** Koreksi natural saat ringkasan aktivitas masih pending — boleh ke AI. */
export function isSoftActivityCorrection(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (shouldSwitchToFood(t) || hasStrongFoodSignal(t)) return false;
  if (parseQuickActivityCorrection(t)) return false;
  return ACTIVITY_SOFT_HINT_RE.test(t);
}

function emptyExtractedActivity(): ExtractedActivity {
  return {
    is_activity_log: false,
    activity_type: null,
    session_name: null,
    session_date: null,
    duration_seconds: null,
    duration_unit_unclear: false,
    unclear_duration_number: null,
    date_ambiguous: false,
    distance_km: null,
    elevation_gain: null,
    hr_avg: null,
    hr_max: null,
    cadence_avg: null,
    calories: null,
    notes: null,
  };
}

export function emptyActivityCorrection(): ActivityCorrection {
  return {
    is_correction: false,
    activity_type: null,
    session_name: null,
    session_date: null,
    duration_seconds: null,
    duration_unit_unclear: false,
    unclear_duration_number: null,
    date_ambiguous: false,
    distance_km: null,
    elevation_gain: null,
    hr_avg: null,
    hr_max: null,
    cadence_avg: null,
    calories: null,
    notes: null,
    clock_hour: null,
    clock_minute: null,
  };
}

export function hasActivityCorrectionPatch(patch: ActivityCorrection): boolean {
  return (
    patch.is_correction &&
    (patch.activity_type != null ||
      patch.session_name != null ||
      patch.session_date != null ||
      patch.duration_seconds != null ||
      patch.duration_unit_unclear ||
      patch.distance_km != null ||
      patch.elevation_gain != null ||
      patch.hr_avg != null ||
      patch.hr_max != null ||
      patch.cadence_avg != null ||
      patch.calories != null ||
      patch.clock_hour != null)
  );
}

export async function extractActivityFromText(
  text: string,
  now = new Date(),
): Promise<ExtractedActivity> {
  const heuristic = parseActivityHeuristic(text, now);
  const useFallback = (): ExtractedActivity => {
    if (!heuristic.is_activity_log) return emptyExtractedActivity();
    return withAiFallbackNote({
      ...heuristic,
      session_date: heuristic.session_date ?? todaySessionDateIso(now),
    });
  };

  const client = getClient();
  if (!client) return useFallback();

  try {
    const completion = await client.chat.completions.create({
      model: getOpenAiModel(),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${SYSTEM}\n\n${todayPrompt(now)}` },
        { role: "user", content: text.slice(0, 2000) },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return useFallback();
    }
    return normalizeExtracted(parsed, text, now);
  } catch {
    return useFallback();
  }
}

export async function extractActivityCorrection(
  text: string,
  draft: ActivityDraft,
  now = new Date(),
): Promise<ActivityCorrection> {
  const quick = parseQuickActivityCorrection(text, now);
  if (quick) return quick;

  const client = getClient();
  if (!client) return emptyActivityCorrection();

  try {
    const completion = await client.chat.completions.create({
      model: getOpenAiModel(),
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${CORRECTION_SYSTEM}\n\n${todayPrompt(now)}` },
        {
          role: "user",
          content: [
            "Draft saat ini:",
            JSON.stringify({
              activity_type: draft.activity_type,
              session_name: draft.session_name,
              session_date: draft.session_date,
              duration: draft.duration,
              distance: draft.distance,
              elevation_gain: draft.elevation_gain,
              hr_avg: draft.hr_avg,
              hr_max: draft.hr_max,
              cadence_avg: draft.cadence_avg,
              calories: draft.calories,
            }),
            "",
            "Pesan koreksi user:",
            text.slice(0, 1000),
          ].join("\n"),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return emptyActivityCorrection();
    }

    return normalizeCorrection(parsed, text, now);
  } catch {
    return emptyActivityCorrection();
  }
}
