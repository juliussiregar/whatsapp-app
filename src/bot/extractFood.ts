import OpenAI from "openai";
import { getOpenAiApiKey, getOpenAiModel, getOpenAiTimeoutMs } from "@/config.js";
import type { FoodDraft } from "@/bot/session.js";

export type ExtractedFood = {
  is_food_log: boolean;
  food_name: string | null;
  serving: number | null;
  suffix_serving: string;
  calories: number | null;
  fat: number | null;
  protein: number | null;
  category_hint: "breakfast" | "lunch" | "dinner" | "snack" | null;
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
  category_hint: "breakfast" | "lunch" | "dinner" | "snack" | null;
  notes: string | null;
};

const SYSTEM = `Kamu asisten nutrisi SolidPace. Tugasmu mengekstrak log makanan dari pesan WhatsApp atlet (Bahasa Indonesia).

Balas HANYA JSON valid tanpa markdown, dengan skema:
{
  "is_food_log": boolean,
  "food_name": string|null,
  "serving": number|null,
  "suffix_serving": string,
  "calories": number|null,
  "fat": number|null,
  "protein": number|null,
  "category_hint": "breakfast"|"lunch"|"dinner"|"snack"|null,
  "notes": string|null
}

Aturan:
- is_food_log=true hanya jika pesan jelas mencatat makanan/minuman yang dimakan.
- Jika bukan log makanan (sapaan, pertanyaan umum, aktivitas olahraga, dll) → is_food_log=false, field lain null.
- serving default 1 porsi jika tidak disebutkan; suffix_serving default "gr" (atau "ml"/"porsi" jika jelas).
- calories/fat/protein: estimasi wajar jika tidak disebut. Semua angka ≥ 0; serving > 0.
- category_hint jika user menyebut sarapan/pagi/breakfast, siang/lunch, malam/dinner, snack/cemilan, atau "tadi pagi/siang/malam".
- Jangan mengarang nama makanan yang tidak ada di pesan.`;

const CORRECTION_SYSTEM = `Kamu asisten nutrisi SolidPace. User sedang mengoreksi ringkasan makanan yang sudah ada.

Balas HANYA JSON valid tanpa markdown, dengan skema:
{
  "is_correction": boolean,
  "food_name": string|null,
  "serving": number|null,
  "suffix_serving": string|null,
  "calories": number|null,
  "fat": number|null,
  "protein": number|null,
  "category_hint": "breakfast"|"lunch"|"dinner"|"snack"|null,
  "notes": string|null
}

Aturan:
- is_correction=true jika pesan mengubah/mengoreksi draft (kalori, porsi, kategori, nama, protein, lemak).
- Contoh koreksi: "300 kcal", "250gr", "tadi pagi", "sarapan", "protein 20", "buatnya bubur ayam".
- Field yang TIDAK disebut di pesan → null (jangan diisi ulang dari draft).
- category_hint: "tadi pagi"/"sarapan" → breakfast; "siang" → lunch; "malam" → dinner; "cemilan" → snack.
- Jika pesan sama sekali tidak relevan dengan koreksi makanan → is_correction=false.`;

function getClient(): OpenAI | null {
  const key = getOpenAiApiKey();
  if (!key) return null;
  return new OpenAI({ apiKey: key, timeout: getOpenAiTimeoutMs() });
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asCategoryHint(
  raw: unknown,
): ExtractedFood["category_hint"] {
  if (typeof raw !== "string") return null;
  const hintRaw = raw.toLowerCase();
  if (
    hintRaw === "breakfast" ||
    hintRaw === "lunch" ||
    hintRaw === "dinner" ||
    hintRaw === "snack"
  ) {
    return hintRaw;
  }
  return null;
}

function normalizeExtracted(raw: Record<string, unknown>): ExtractedFood {
  return {
    is_food_log: Boolean(raw.is_food_log),
    food_name: typeof raw.food_name === "string" && raw.food_name.trim() ? raw.food_name.trim() : null,
    serving: asNumber(raw.serving),
    suffix_serving:
      typeof raw.suffix_serving === "string" && raw.suffix_serving.trim()
        ? raw.suffix_serving.trim()
        : "gr",
    calories: asNumber(raw.calories),
    fat: asNumber(raw.fat),
    protein: asNumber(raw.protein),
    category_hint: asCategoryHint(raw.category_hint),
    notes: typeof raw.notes === "string" ? raw.notes : null,
  };
}

function normalizeCorrection(raw: Record<string, unknown>): FoodCorrection {
  return {
    is_correction: Boolean(raw.is_correction),
    food_name: typeof raw.food_name === "string" && raw.food_name.trim() ? raw.food_name.trim() : null,
    serving: asNumber(raw.serving),
    suffix_serving:
      typeof raw.suffix_serving === "string" && raw.suffix_serving.trim()
        ? raw.suffix_serving.trim()
        : null,
    calories: asNumber(raw.calories),
    fat: asNumber(raw.fat),
    protein: asNumber(raw.protein),
    category_hint: asCategoryHint(raw.category_hint),
    notes: typeof raw.notes === "string" ? raw.notes : null,
  };
}

/** Koreksi cepat tanpa AI: "300 kcal", "250gr", "tadi pagi", dll. */
export function parseQuickCorrection(text: string): FoodCorrection | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  let touched = false;
  const patch: FoodCorrection = {
    is_correction: true,
    food_name: null,
    serving: null,
    suffix_serving: null,
    calories: null,
    fat: null,
    protein: null,
    category_hint: null,
    notes: null,
  };

  const cal = t.match(/(\d+(?:[.,]\d+)?)\s*(?:kkal|kcal|kalori|kal)\b/);
  if (cal) {
    patch.calories = Number(cal[1].replace(",", "."));
    touched = true;
  } else if (/^\d+(?:[.,]\d+)?$/.test(t)) {
    // Angka polos saat pending biasanya koreksi kalori
    patch.calories = Number(t.replace(",", "."));
    touched = true;
  }

  const serving = t.match(/(\d+(?:[.,]\d+)?)\s*(gr|g|ml|porsi)\b/);
  if (serving) {
    patch.serving = Number(serving[1].replace(",", "."));
    patch.suffix_serving = serving[2] === "g" ? "gr" : serving[2];
    touched = true;
  }

  const protein = t.match(/(?:protein|prot|p)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/);
  if (protein) {
    patch.protein = Number(protein[1].replace(",", "."));
    touched = true;
  }

  const fat = t.match(/(?:lemak|fat|f)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/);
  if (fat) {
    patch.fat = Number(fat[1].replace(",", "."));
    touched = true;
  }

  if (/\b(sarapan|breakfast|pagi)\b/.test(t) || /tadi\s+pagi/.test(t)) {
    patch.category_hint = "breakfast";
    touched = true;
  } else if (/\b(siang|lunch)\b/.test(t) || /tadi\s+siang/.test(t)) {
    patch.category_hint = "lunch";
    touched = true;
  } else if (/\b(malam|dinner|supper)\b/.test(t) || /tadi\s+malam/.test(t)) {
    patch.category_hint = "dinner";
    touched = true;
  } else if (/\b(snack|cemilan|camilan|ngemil)\b/.test(t)) {
    patch.category_hint = "snack";
    touched = true;
  }

  return touched ? patch : null;
}

export function mergeFoodCorrection(draft: FoodDraft, patch: FoodCorrection): FoodDraft {
  return {
    ...draft,
    food_name: patch.food_name ?? draft.food_name,
    serving: patch.serving != null && patch.serving > 0 ? patch.serving : draft.serving,
    suffix_serving: patch.suffix_serving ?? draft.suffix_serving,
    calories: patch.calories != null && patch.calories >= 0 ? patch.calories : draft.calories,
    fat: patch.fat != null && patch.fat >= 0 ? patch.fat : draft.fat,
    protein: patch.protein != null && patch.protein >= 0 ? patch.protein : draft.protein,
    disclaimer: patch.notes ?? draft.disclaimer,
  };
}

export async function extractFoodFromText(text: string): Promise<ExtractedFood> {
  const client = getClient();
  if (!client) {
    throw new Error("OPENAI_API_KEY belum dikonfigurasi di server bot");
  }

  const completion = await client.chat.completions.create({
    model: getOpenAiModel(),
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: text.slice(0, 2000) },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("Gagal membaca hasil ekstraksi makanan");
  }

  return normalizeExtracted(parsed);
}

export async function extractFoodCorrection(
  text: string,
  draft: FoodDraft,
): Promise<FoodCorrection> {
  const quick = parseQuickCorrection(text);
  if (quick) return quick;

  const client = getClient();
  if (!client) {
    throw new Error("OPENAI_API_KEY belum dikonfigurasi di server bot");
  }

  const completion = await client.chat.completions.create({
    model: getOpenAiModel(),
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CORRECTION_SYSTEM },
      {
        role: "user",
        content: [
          "Draft saat ini:",
          JSON.stringify({
            food_name: draft.food_name,
            serving: draft.serving,
            suffix_serving: draft.suffix_serving,
            calories: draft.calories,
            fat: draft.fat,
            protein: draft.protein,
            category_name: draft.category_name,
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
    throw new Error("Gagal membaca koreksi makanan");
  }

  return normalizeCorrection(parsed);
}
