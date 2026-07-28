import type { NutritionCategory } from "@/clients/solidpace.js";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

const NAME_ALIASES: Record<MealSlot, string[]> = {
  breakfast: ["breakfast", "sarapan", "pagi"],
  lunch: ["lunch", "makan siang", "siang"],
  dinner: ["dinner", "makan malam", "malam", "supper"],
  snack: ["snack", "snacks", "cemilan", "ngemil", "camilan"],
};

/** Jam WIB → slot makan. */
export function mealSlotFromWib(date = new Date()): MealSlot {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      hour: "numeric",
      hour12: false,
    }).format(date),
  );

  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 16 && hour < 18) return "snack";
  return "dinner";
}

export function normalizeMealSlot(raw?: string | null): MealSlot | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  for (const [slot, aliases] of Object.entries(NAME_ALIASES) as Array<
    [MealSlot, string[]]
  >) {
    if (aliases.some((a) => t === a || t.includes(a))) return slot;
  }
  return null;
}

function categoryMatchesSlot(cat: NutritionCategory, slot: MealSlot): boolean {
  const name = cat.name.trim().toLowerCase();
  return NAME_ALIASES[slot].some((a) => name === a || name.includes(a));
}

/**
 * Pilih category_id dari daftar user.
 * Prioritas: hint teks user → kata kunci di nama makanan → jam WIB → kategori pertama.
 */
export function pickCategory(
  categories: NutritionCategory[],
  hint?: string | null,
  foodName?: string | null,
): NutritionCategory | null {
  if (!categories.length) return null;

  const hintSlot = normalizeMealSlot(hint);
  if (hintSlot) {
    const byHint = categories.find((c) => categoryMatchesSlot(c, hintSlot));
    if (byHint) return byHint;
  }

  const foodSlot = normalizeMealSlot(foodName);
  if (foodSlot) {
    const byFood = categories.find((c) => categoryMatchesSlot(c, foodSlot));
    if (byFood) return byFood;
  }

  const wibSlot = mealSlotFromWib();
  const byWib = categories.find((c) => categoryMatchesSlot(c, wibSlot));
  if (byWib) return byWib;

  return categories[0] ?? null;
}

export function formatWibClock(date = new Date()): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
