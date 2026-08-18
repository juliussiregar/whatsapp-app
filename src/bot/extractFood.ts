import OpenAI from "openai";
import { getOpenAiApiKey, getOpenAiModel, getOpenAiTimeoutMs } from "@/config.js";
import { hasStrongFoodSignal } from "@/bot/intent.js";
import type { FoodDraft } from "@/bot/session.js";

export type MealHint = "breakfast" | "lunch" | "dinner" | "snack";

export type ExtractedFood = {
  is_food_log: boolean;
  food_name: string | null;
  serving: number | null;
  suffix_serving: string;
  calories: number | null;
  fat: number | null;
  protein: number | null;
  carbo: number | null;
  category_hint: MealHint | null;
  notes: string | null;
};

export type FoodCorrection = {
  is_correction: boolean;
  food_name: string | null;
  serving: number | null;
  suffix_serving: string | null;
  calories: number | null;
  fat: number | null;
  protein: number | null;
  carbo: number | null;
  category_hint: MealHint | null;
  notes: string | null;
};

export type StatedFoodFields = {
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbo: number | null;
  serving: number | null;
  suffix_serving: string | null;
  category_hint: MealHint | null;
};

const SYSTEM = `Kamu asisten nutrisi SolidPace. Ekstrak catatan makanan/minuman dari chat WhatsApp atlet (Bahasa Indonesia, typo dan campur Inggris OK).

Balas HANYA JSON valid tanpa markdown:
{
  "is_food_log": boolean,
  "food_name": string|null,
  "serving": number|null,
  "suffix_serving": string,
  "calories": number|null,
  "fat": number|null,
  "protein": number|null,
  "carbo": number|null,
  "category_hint": "breakfast"|"lunch"|"dinner"|"snack"|null,
  "notes": string|null
}

Aturan:
1. is_food_log=true jika user MELAPORKAN makanan/minuman yang dikonsumsi (termasuk daftar lauk, minuman, "baru makan", caption foto). False untuk sapaan, pertanyaan gizi umum, atau aktivitas olahraga murni.
2. food_name: gabungkan item yang disebut, singkat, bahasa Indonesia. Jangan mengarang item yang tidak ada di pesan. Contoh: "Nasi putih, ayam goreng, sayur".
3. serving + suffix_serving: pakai angka user. "200gr"/"200 gram" → 200 + "gr". "1 gelas/piring/mangkok/bungkus/botol/potong/porsi" → 1 + unit itu. "setengah piring" → 0.5 + "piring". Minuman tanpa gram → "ml" atau "gelas". Jika tidak disebut: makanan padat 100 "gr".
4. Angka yang user sebut (kcal, protein, lemak, karbo, gram) WAJIB dipakai apa adanya. Jangan ditimpa.
5. Field makro yang tidak disebut: estimasi wajar porsi Indonesia. Semua angka ≥ 0.
6. Konsistensi Atwater: jika user tidak menyebut karbo, isi carbo = max(0, (calories - protein×4 - fat×9) / 4). Jika user menyebut protein+lemak+karbo tanpa kalori, calories = protein×4 + carbo×4 + fat×9.
7. category_hint: sarapan/pagi/breakfast/"tadi pagi" → breakfast; siang/lunch → lunch; malam/dinner → dinner; snack/cemilan/ngemil → snack; else null.
8. notes: 1 kalimat Indonesia jika angka perkiraan, atau null jika user sudah kasih angka lengkap.

Contoh:
- "nasi putih 200gr" → Nasi putih, 200 gr, ~260 kcal, protein ~4, fat ~0.5, carbo rumus Atwater
- "makan malam ayam bakar sama nasi, protein 40 karbo 80" → dinner, protein 40, carbo 80, fat+kalori diestimasi konsisten
- "kopi susu 1 gelas 150 kcal" → pakai 150 kcal
- "lari 5km" → is_food_log false`;

const CORRECTION_SYSTEM = `Kamu asisten nutrisi SolidPace. User mengoreksi ringkasan makanan yang sudah ada.

Balas HANYA JSON valid:
{
  "is_correction": boolean,
  "food_name": string|null,
  "serving": number|null,
  "suffix_serving": string|null,
  "calories": number|null,
  "fat": number|null,
  "protein": number|null,
  "carbo": number|null,
  "category_hint": "breakfast"|"lunch"|"dinner"|"snack"|null,
  "notes": string|null
}

Aturan:
- is_correction=true hanya jika pesan mengoreksi angka/porsi/kategori draft yang sama, termasuk: "kalori jadi 280", "karbo nya 40g", "protein 20 lemak 8", "porsinya 1 piring", "ini sarapan".
- Field yang tidak disebut → null. Jangan menyalin draft.
- Jika user menyebut MAKANAN/MINUMAN LAIN → is_correction=false.
- category_hint: tadi pagi/sarapan → breakfast; siang → lunch; malam → dinner; cemilan → snack.`;

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const CAL_LABELS = String.raw`kkal|kcal|kalori|kal|calorie|calories`;
const PROTEIN_LABELS = String.raw`protein|prot|proteinnya`;
const FAT_LABELS = String.raw`lemak|fat|lemaknya`;
const CARBO_LABELS = String.raw`karbohidrat|karbo|carbo|carbs|carb|cho`;
const WEIGHT_UNIT = String.raw`gr|g|gram|grams|ml`;
const HOUSE_UNIT = String.raw`porsi|piring|gelas|mangkok|mangkuk|bungkus|cup|sendok|potong|buah|botol`;
const BETWEEN = String.raw`(?:\s*(?:nya|jadi|adalah|ke|dikoreksi|diganti))?`;

const CORRECTION_HINT_RE =
  /\b(kcal|kkal|kalori|kal|protein|prot|lemak|fat|karbo|karbohidrat|carbo|carb|carbs|cho|porsi|gram|sarapan|breakfast|siang|lunch|malam|dinner|snack|cemilan|camilan|pagi|tadi|kurang|lebih|jadi|ganti|ubah)\b/i;

function getClient(): OpenAI | null {
  const key = getOpenAiApiKey();
  if (!key) return null;
  return new OpenAI({ apiKey: key, timeout: getOpenAiTimeoutMs() });
}

function toNum(raw: string): number {
  return Number(raw.replace(",", "."));
}

export function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, n) * 10) / 10;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(",", ".")))) {
    return Number(v.replace(",", "."));
  }
  return null;
}

function asCategoryHint(raw: unknown): MealHint | null {
  if (typeof raw !== "string") return null;
  const hintRaw = raw.toLowerCase();
  if (hintRaw === "breakfast" || hintRaw === "lunch" || hintRaw === "dinner" || hintRaw === "snack") {
    return hintRaw;
  }
  return null;
}

export function normalizeSuffix(raw: string | null | undefined, fallback = "gr"): string {
  if (!raw?.trim()) return fallback;
  const s = raw.trim().toLowerCase();
  if (s === "g" || s === "gram" || s === "grams" || s === "gr") return "gr";
  if (s === "mangkuk") return "mangkok";
  return s.slice(0, 16);
}

function labeledNumber(text: string, labels: string): number | null {
  const after = text.match(new RegExp(`(?:^|[^\\p{L}])(?:${labels})${BETWEEN}\\s*[:=]?\\s*${NUM}(?:\\s*(?:${WEIGHT_UNIT}))?\\b`, "iu"));
  if (after?.[1]) return toNum(after[1]);
  const before = text.match(new RegExp(`${NUM}\\s*(?:${WEIGHT_UNIT})?\\s*(?:${labels})\\b`, "iu"));
  if (before?.[1]) return toNum(before[1]);
  return null;
}

function parseCategoryHint(t: string): MealHint | null {
  if (/\b(sarapan|breakfast|pagi)\b/.test(t) || /tadi\s+pagi/.test(t)) return "breakfast";
  if (/\b(siang|lunch)\b/.test(t) || /tadi\s+siang/.test(t)) return "lunch";
  if (/\b(malam|dinner|supper)\b/.test(t) || /tadi\s+malam/.test(t)) return "dinner";
  if (/\b(snack|cemilan|camilan|ngemil)\b/.test(t)) return "snack";
  return null;
}

function stripMacroSpans(t: string): string {
  return t
    .replace(new RegExp(`(?:${CAL_LABELS}|${PROTEIN_LABELS}|${FAT_LABELS}|${CARBO_LABELS}|kh)${BETWEEN}\\s*[:=]?\\s*${NUM}(?:\\s*(?:${WEIGHT_UNIT}))?`, "gi"), " ")
    .replace(new RegExp(`${NUM}\\s*(?:${WEIGHT_UNIT})?\\s*(?:${CAL_LABELS}|${PROTEIN_LABELS}|${FAT_LABELS}|${CARBO_LABELS}|kh)\\b`, "gi"), " ")
    .replace(new RegExp(`${NUM}\\s*[pfc]\\b`, "gi"), " ")
    .replace(/(?:^|\s)[pfc]\s*[:=]\s*\d+(?:[.,]\d+)?/gi, " ");
}

function parseServing(t: string): { serving: number; suffix: string } | null {
  const src = stripMacroSpans(t);
  const half = src.match(new RegExp(`\\bsetengah\\s+(${HOUSE_UNIT})\\b`, "i"));
  if (half?.[1]) return { serving: 0.5, suffix: normalizeSuffix(half[1], "porsi") };

  const weight = src.match(new RegExp(`${NUM}\\s*(${WEIGHT_UNIT})\\b`, "i"));
  if (weight?.[1] && weight[2]) {
    return { serving: toNum(weight[1]), suffix: normalizeSuffix(weight[2]) };
  }

  const house = src.match(new RegExp(`${NUM}\\s*(${HOUSE_UNIT})\\b`, "i"));
  if (house?.[1] && house[2]) {
    return { serving: toNum(house[1]), suffix: normalizeSuffix(house[2], "porsi") };
  }

  return null;
}

function parseShorthandMacros(t: string): { protein: number | null; fat: number | null; carbo: number | null } {
  const out = { protein: null as number | null, fat: null as number | null, carbo: null as number | null };
  const assign = (letter: string, n: number) => {
    if (letter === "p") out.protein = n;
    else if (letter === "f") out.fat = n;
    else out.carbo = n;
  };
  for (const m of t.matchAll(new RegExp(`${NUM}\\s*([pfc])\\b`, "gi"))) {
    assign(m[2].toLowerCase(), toNum(m[1]));
  }
  for (const m of t.matchAll(/(?:^|\s)([pfc])\s*[:=]\s*(\d+(?:[.,]\d+)?)/gi)) {
    assign(m[1].toLowerCase(), toNum(m[2]));
  }
  return out;
}

export function parseStatedFoodFields(text: string): StatedFoodFields {
  const t = text.trim().toLowerCase();
  const serving = parseServing(t);
  const shorthand = parseShorthandMacros(t);
  const kh = t.match(new RegExp(`(?:^|\\s)kh${BETWEEN}\\s*[:=]?\\s*${NUM}\\b`, "i"));
  return {
    calories: labeledNumber(t, CAL_LABELS),
    protein: labeledNumber(t, PROTEIN_LABELS) ?? shorthand.protein,
    fat: labeledNumber(t, FAT_LABELS) ?? shorthand.fat,
    carbo: labeledNumber(t, CARBO_LABELS) ?? (kh?.[1] ? toNum(kh[1]) : null) ?? shorthand.carbo,
    serving: serving?.serving ?? null,
    suffix_serving: serving?.suffix ?? null,
    category_hint: parseCategoryHint(t),
  };
}

function emptyExtracted(): ExtractedFood {
  return {
    is_food_log: false,
    food_name: null,
    serving: null,
    suffix_serving: "gr",
    calories: null,
    fat: null,
    protein: null,
    carbo: null,
    category_hint: null,
    notes: null,
  };
}

function normalizeExtracted(raw: Record<string, unknown>): ExtractedFood {
  const serving = asNumber(raw.serving);
  return {
    is_food_log: Boolean(raw.is_food_log),
    food_name: typeof raw.food_name === "string" && raw.food_name.trim() ? raw.food_name.trim() : null,
    serving: serving != null && serving > 0 ? serving : null,
    suffix_serving: normalizeSuffix(
      typeof raw.suffix_serving === "string" ? raw.suffix_serving : null,
      "gr",
    ),
    calories: asNumber(raw.calories),
    fat: asNumber(raw.fat),
    protein: asNumber(raw.protein),
    carbo: asNumber(raw.carbo),
    category_hint: asCategoryHint(raw.category_hint),
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim() : null,
  };
}

function normalizeCorrection(raw: Record<string, unknown>): FoodCorrection {
  return {
    is_correction: Boolean(raw.is_correction),
    food_name: typeof raw.food_name === "string" && raw.food_name.trim() ? raw.food_name.trim() : null,
    serving: asNumber(raw.serving),
    suffix_serving:
      typeof raw.suffix_serving === "string" && raw.suffix_serving.trim()
        ? normalizeSuffix(raw.suffix_serving, raw.suffix_serving.trim())
        : null,
    calories: asNumber(raw.calories),
    fat: asNumber(raw.fat),
    protein: asNumber(raw.protein),
    carbo: asNumber(raw.carbo),
    category_hint: asCategoryHint(raw.category_hint),
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim() : null,
  };
}

/** Sama dengan fallback BE: (calories − protein×4 − fat×9) / 4, min 0. */
export function estimateCarboGrams(calories: number, protein: number, fat: number): number {
  const n = (calories - protein * 4 - fat * 9) / 4;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return round1(n);
}

export function estimateCaloriesFromMacros(protein: number, fat: number, carbo: number): number {
  return round1(protein * 4 + carbo * 4 + fat * 9);
}

export function resolveCarboGrams(
  calories: number,
  protein: number,
  fat: number,
  carbo?: number | null,
): number {
  if (carbo != null && Number.isFinite(carbo) && carbo >= 0) return round1(carbo);
  return estimateCarboGrams(calories, protein, fat);
}

export function reconcileMacros(
  input: {
    calories: number | null;
    protein: number | null;
    fat: number | null;
    carbo: number | null;
  },
  stated?: Pick<StatedFoodFields, "calories" | "protein" | "fat" | "carbo">,
): { calories: number; protein: number; fat: number; carbo: number } {
  const protein = round1(input.protein ?? 0);
  const fat = round1(input.fat ?? 0);
  const statedCal = stated?.calories != null;
  const statedCarbo = stated?.carbo != null;
  let calories = input.calories != null ? round1(input.calories) : null;
  let carbo = input.carbo != null ? round1(input.carbo) : null;

  if (statedCarbo && !statedCal) {
    carbo = round1(stated.carbo as number);
    calories = estimateCaloriesFromMacros(protein, fat, carbo);
  } else if (statedCal && !statedCarbo) {
    calories = round1(stated.calories as number);
    carbo = estimateCarboGrams(calories, protein, fat);
  } else {
    calories = calories ?? (carbo != null ? estimateCaloriesFromMacros(protein, fat, carbo) : 0);
    carbo = statedCarbo ? (carbo ?? 0) : estimateCarboGrams(calories, protein, fat);
  }

  return { calories, protein, fat, carbo };
}

/** Koreksi cepat tanpa AI: "300 kcal", "250gr", "tadi pagi", "karbo 28g", dll. */
export function parseQuickCorrection(text: string): FoodCorrection | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  const stated = parseStatedFoodFields(t);
  const patch: FoodCorrection = {
    is_correction: true,
    food_name: null,
    serving: stated.serving,
    suffix_serving: stated.suffix_serving,
    calories: stated.calories,
    fat: stated.fat,
    protein: stated.protein,
    carbo: stated.carbo,
    category_hint: stated.category_hint,
    notes: null,
  };

  let touched =
    patch.calories != null ||
    patch.protein != null ||
    patch.fat != null ||
    patch.carbo != null ||
    patch.serving != null ||
    patch.category_hint != null;

  if (!touched && /^\d+(?:[.,]\d+)?$/.test(t)) {
    patch.calories = toNum(t);
    touched = true;
  }

  return touched ? patch : null;
}

const CORRECTION_FILLER = new Set([
  "ya",
  "iya",
  "oke",
  "ok",
  "dong",
  "kak",
  "nya",
  "jadi",
  "buatnya",
  "namanya",
  "bukan",
  "tapi",
  "tolong",
  "koreksi",
  "ganti",
  "ubah",
  "kalo",
  "kalau",
  "makan",
  "minum",
  "yang",
  "aja",
  "saja",
  "sih",
  "deh",
  "mah",
  "dikit",
  "sedikit",
  "kurang",
  "lebih",
  "ke",
  "adalah",
  "habis",
  "baru",
  "udah",
  "ini",
  "itu",
  "yg",
]);

/** Sisa teks setelah token koreksi (kcal/porsi/slot) dibuang. */
export function leftoverAfterFoodCorrection(text: string): string {
  return text
    .toLowerCase()
    .replace(new RegExp(`${NUM}\\s*(?:${CAL_LABELS}|${WEIGHT_UNIT}|${HOUSE_UNIT})\\b`, "gi"), " ")
    .replace(new RegExp(`(?:${CAL_LABELS}|${PROTEIN_LABELS}|${FAT_LABELS}|${CARBO_LABELS}|kh)${BETWEEN}\\s*[:=]?\\s*${NUM}`, "gi"), " ")
    .replace(new RegExp(`${NUM}\\s*(?:${CAL_LABELS}|${PROTEIN_LABELS}|${FAT_LABELS}|${CARBO_LABELS}|kh)\\b`, "gi"), " ")
    .replace(new RegExp(`${NUM}\\s*[pfc]\\b`, "gi"), " ")
    .replace(/(?:^|\s)[pfc]\s*[:=]\s*\d+(?:[.,]\d+)?/gi, " ")
    .replace(/\bsetengah\b/g, " ")
    .replace(
      /\b(sarapan|breakfast|pagi|siang|lunch|malam|dinner|supper|snack|cemilan|camilan|ngemil|tadi|karbohidrat|karbo|carbo|carbs|carb|cho|kh|protein|prot|lemak|fat|kalori|kcal|kkal|kal|calorie|calories|gram|grams)\b/g,
      " ",
    )
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripNya(word: string): string {
  return word.replace(/nya$/u, "");
}

function meaningfulLeftover(text: string): string {
  return leftoverAfterFoodCorrection(text)
    .split(/\s+/)
    .map(stripNya)
    .filter((w) => w && !CORRECTION_FILLER.has(w) && !/^\d+(?:[.,]\d+)?$/.test(w))
    .join(" ");
}

function titleFoodName(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Deskripsi makanan/minuman baru, bukan koreksi angka/porsi/kategori. */
export function looksLikeNewFoodEntry(text: string): boolean {
  return Boolean(meaningfulLeftover(text));
}

/** Koreksi singkat saat ringkasan masih pending. */
export function isFoodCorrectionText(text: string): boolean {
  const quick = parseQuickCorrection(text);
  if (!quick) return false;
  return !looksLikeNewFoodEntry(text);
}

/** Koreksi bernada natural tanpa angka lengkap — boleh ke AI. */
export function isSoftFoodCorrection(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (looksLikeNewFoodEntry(t)) return false;
  if (parseQuickCorrection(t)) return false;
  return CORRECTION_HINT_RE.test(t);
}

export const AI_FALLBACK_DISCLAIMER =
  "AI sedang sibuk. Ringkasan ini disusun dari teks kamu — cek dulu sebelum balas *ya*.";

export const CALORIES_ADJUSTED_NOTE =
  "Kalori disesuaikan biar pas dengan karbo/protein/lemak yang baru.";

export function withAiFallbackNote<T extends { notes: string | null }>(extracted: T): T {
  const notes = extracted.notes?.includes(AI_FALLBACK_DISCLAIMER)
    ? extracted.notes
    : [extracted.notes, AI_FALLBACK_DISCLAIMER].filter(Boolean).join(" ");
  return { ...extracted, notes };
}

export function hasFoodMacros(extracted: {
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbo: number | null;
}): boolean {
  return (
    extracted.calories != null ||
    extracted.protein != null ||
    extracted.fat != null ||
    extracted.carbo != null
  );
}

export function hasCorrectionPatch(patch: FoodCorrection): boolean {
  return (
    patch.is_correction &&
    (patch.food_name != null ||
      patch.serving != null ||
      patch.suffix_serving != null ||
      patch.calories != null ||
      patch.fat != null ||
      patch.protein != null ||
      patch.carbo != null ||
      patch.category_hint != null)
  );
}

export function mergeFoodCorrection(draft: FoodDraft, patch: FoodCorrection): FoodDraft {
  const touchesBreakdown =
    patch.food_name != null ||
    patch.serving != null ||
    patch.suffix_serving != null ||
    patch.calories != null ||
    patch.fat != null ||
    patch.protein != null ||
    patch.carbo != null;

  const protein = patch.protein != null && patch.protein >= 0 ? patch.protein : draft.protein;
  const fat = patch.fat != null && patch.fat >= 0 ? patch.fat : draft.fat;
  const macrosTouched =
    patch.calories != null || patch.fat != null || patch.protein != null || patch.carbo != null;
  const macros = macrosTouched
    ? reconcileMacros(
        {
          calories: patch.calories ?? draft.calories,
          protein,
          fat,
          carbo: patch.carbo ?? draft.carbo,
        },
        {
          calories: patch.calories,
          protein: patch.protein,
          fat: patch.fat,
          carbo: patch.carbo,
        },
      )
    : {
        calories: draft.calories,
        protein: draft.protein,
        fat: draft.fat,
        carbo: draft.carbo,
      };

  const caloriesChanged = macros.calories !== draft.calories;
  const adjustedFromCarbo =
    macrosTouched &&
    patch.calories == null &&
    (patch.carbo != null || patch.protein != null || patch.fat != null) &&
    caloriesChanged;

  const merged: FoodDraft = {
    ...draft,
    food_name: patch.food_name ?? draft.food_name,
    serving: patch.serving != null && patch.serving > 0 ? patch.serving : draft.serving,
    suffix_serving: patch.suffix_serving ?? draft.suffix_serving,
    calories: macros.calories,
    fat: macros.fat,
    protein: macros.protein,
    carbo: macros.carbo,
    caloriesAdjusted: adjustedFromCarbo || draft.caloriesAdjusted,
    disclaimer: patch.notes ?? draft.disclaimer,
  };

  if (draft.items?.length && touchesBreakdown) {
    merged.items = undefined;
  }

  return merged;
}

export function heuristicExtracted(text: string): ExtractedFood | null {
  const stated = parseStatedFoodFields(text);
  const leftover = meaningfulLeftover(text);
  if (!leftover) return null;

  const hasMacros =
    stated.calories != null ||
    stated.protein != null ||
    stated.fat != null ||
    stated.carbo != null;
  const hasServing = stated.serving != null;
  if (!hasMacros && !hasServing && !hasStrongFoodSignal(text) && !hasStrongFoodSignal(leftover)) {
    return null;
  }

  if (!hasMacros) {
    return {
      is_food_log: true,
      food_name: titleFoodName(leftover),
      serving: stated.serving,
      suffix_serving: stated.suffix_serving ?? "gr",
      calories: null,
      fat: null,
      protein: null,
      carbo: null,
      category_hint: stated.category_hint,
      notes: "Nama makanan kebaca, tapi angka gizi belum ada.",
    };
  }

  const macros = reconcileMacros(
    {
      calories: stated.calories,
      protein: stated.protein,
      fat: stated.fat,
      carbo: stated.carbo,
    },
    stated,
  );

  return {
    is_food_log: true,
    food_name: titleFoodName(leftover),
    serving: stated.serving,
    suffix_serving: stated.suffix_serving ?? "gr",
    calories: macros.calories,
    fat: macros.fat,
    protein: macros.protein,
    carbo: macros.carbo,
    category_hint: stated.category_hint,
    notes: null,
  };
}

export function mergeExtractedFood(ai: ExtractedFood, text: string): ExtractedFood {
  const stated = parseStatedFoodFields(text);
  const heuristic = heuristicExtracted(text);
  const base = ai.is_food_log && ai.food_name ? ai : heuristic;
  if (!base?.is_food_log || !base.food_name) {
    return ai.is_food_log ? ai : emptyExtracted();
  }

  const serving = stated.serving ?? base.serving;
  if (!hasFoodMacros(stated) && !hasFoodMacros(base)) {
    return {
      is_food_log: true,
      food_name: base.food_name,
      serving,
      suffix_serving: stated.suffix_serving ?? base.suffix_serving ?? "gr",
      calories: null,
      fat: null,
      protein: null,
      carbo: null,
      category_hint: stated.category_hint ?? base.category_hint,
      notes: base.notes ?? "Nama makanan kebaca, tapi angka gizi belum ada.",
    };
  }

  const macros = reconcileMacros(
    {
      calories: stated.calories ?? base.calories,
      protein: stated.protein ?? base.protein,
      fat: stated.fat ?? base.fat,
      carbo: stated.carbo ?? base.carbo,
    },
    stated,
  );

  return {
    is_food_log: true,
    food_name: base.food_name,
    serving,
    suffix_serving: stated.suffix_serving ?? base.suffix_serving ?? "gr",
    calories: macros.calories,
    fat: macros.fat,
    protein: macros.protein,
    carbo: macros.carbo,
    category_hint: stated.category_hint ?? base.category_hint,
    notes: stated.calories != null || stated.carbo != null || stated.protein != null || stated.fat != null
      ? base.notes
      : (base.notes ?? "Angka gizi perkiraan AI Bot SolidPace, bukan data label."),
  };
}

async function completeJson(system: string, user: string, temperature: number): Promise<Record<string, unknown>> {
  const client = getClient();
  if (!client) {
    throw new Error("OPENAI_API_KEY belum dikonfigurasi di server bot");
  }

  const completion = await client.chat.completions.create({
    model: getOpenAiModel(),
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("Gagal membaca hasil AI");
  }
}

export function emptyCorrection(): FoodCorrection {
  return {
    is_correction: false,
    food_name: null,
    serving: null,
    suffix_serving: null,
    calories: null,
    fat: null,
    protein: null,
    carbo: null,
    category_hint: null,
    notes: null,
  };
}

export async function extractFoodFromText(text: string): Promise<ExtractedFood> {
  const fallback = heuristicExtracted(text);

  const useFallback = (): ExtractedFood => {
    if (!fallback?.is_food_log) return emptyExtracted();
    return withAiFallbackNote(mergeExtractedFood(fallback, text));
  };

  if (!getClient()) return useFallback();

  try {
    const parsed = await completeJson(SYSTEM, text.slice(0, 2000), 0.2);
    return mergeExtractedFood(normalizeExtracted(parsed), text);
  } catch {
    return useFallback();
  }
}

export async function extractFoodCorrection(
  text: string,
  draft: FoodDraft,
): Promise<FoodCorrection> {
  const quick = parseQuickCorrection(text);
  if (quick) return quick;

  if (!getClient()) return emptyCorrection();

  try {
    const parsed = await completeJson(
      CORRECTION_SYSTEM,
      [
        "Draft saat ini:",
        JSON.stringify({
          food_name: draft.food_name,
          serving: draft.serving,
          suffix_serving: draft.suffix_serving,
          calories: draft.calories,
          fat: draft.fat,
          protein: draft.protein,
          carbo: draft.carbo,
          category_name: draft.category_name,
        }),
        "",
        "Pesan koreksi user:",
        text.slice(0, 1000),
      ].join("\n"),
      0.1,
    );
    return normalizeCorrection(parsed);
  } catch {
    return emptyCorrection();
  }
}
