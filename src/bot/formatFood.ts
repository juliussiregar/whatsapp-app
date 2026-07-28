import { formatWibClock } from "@/bot/category.js";
import type { FoodDraft, FoodDraftItem } from "@/bot/session.js";

export const POWERED_BY_SOLIDPACE = "Powered by SOLIDPACE";

export const PHOTO_GUIDELINES = [
  "*Panduan foto makanan:*",
  "• Ambil foto *dari atas* (top-down) — posisi kamera tegak lurus di atas makanan",
  "• Pastikan *semua makanan terlihat* di frame (jangan ada yang terpotong atau tertutup)",
  "• Pencahayaan cukup — hindari blur atau jarak terlalu jauh",
  "• Tambahkan caption porsi jika perlu (_setengah piring_, _makan siang_)",
].join("\n");

/** Ringkasan singkat — dipakai sebelum/sesudah analisis foto. */
export const PHOTO_GUIDELINES_SHORT =
  "📷 Tips: foto *dari atas*, pastikan *semua makanan terlihat* jelas di frame.";

function aiEstimateNote(draft: FoodDraft): string {
  if (draft.source === "image") {
    return [
      "ℹ️ Beberapa item mungkin tidak terdeteksi. Kalau kurang tepat, kirim koreksi singkat, contoh:",
      "_300 kcal_ · _250gr_ · _tadi pagi_ · _bubur ayam 250gr 320 kcal_",
    ].join("\n");
  }
  return [
    "ℹ️ *Catatan:* angka di atas adalah *perkiraan AI Bot SolidPace*, bukan data pasti dari database.",
    "Kalau salah, kirim koreksi singkat, contoh:",
    "_300 kcal_ · _250gr_ · _tadi pagi_ · _bubur ayam 250gr 320 kcal_",
  ].join("\n");
}

function formatTotalServing(draft: FoodDraft): string {
  const items = draft.items;
  if (items?.length) {
    const units = new Set(items.map((item) => item.suffix_serving));
    if (units.size > 1) {
      return `⚖️ Total: ${draft.serving} ${draft.suffix_serving} (campuran gr/ml)`;
    }
  }
  return `⚖️ ${draft.serving} ${draft.suffix_serving}`;
}

function formatItemLine(item: FoodDraftItem): string {
  const portion =
    item.serving > 0
      ? `${item.serving} ${item.suffix_serving}`
      : "porsi tidak diketahui";
  return `   • ${item.food_name} — ${portion} · ${item.calories} kcal`;
}

export function formatFoodSummary(draft: FoodDraft): string {
  const lines = [
    "*📋 Ringkasan makanan*",
    "",
    "*BALAS YA UNTUK MENYIMPAN*",
    "Atau balas *batal* untuk membatalkan.",
    "",
    `🍽 ${draft.food_name}`,
  ];

  if (draft.items?.length) {
    for (const item of draft.items) {
      lines.push(formatItemLine(item));
    }
  }

  lines.push(
    formatTotalServing(draft),
    `🔥 Calorie: ${draft.calories} kcal`,
    `🥩 Protein: ${draft.protein}g`,
    `🧈 Fat: ${draft.fat}g`,
    `🏷 Kategori: *${draft.category_name}* (jam WIB ${formatWibClock()})`,
  );

  if (draft.disclaimer) {
    lines.push("", `💬 ${draft.disclaimer}`);
  }

  lines.push("", aiEstimateNote(draft));

  lines.push("", POWERED_BY_SOLIDPACE);
  return lines.join("\n");
}

export function formatSaved(draft: FoodDraft, fullName?: string): string {
  const who = fullName ? `, ${fullName}` : "";
  return [
    `✅ Tersimpan${who}!`,
    `🍽 ${draft.food_name} · ${draft.serving}${draft.suffix_serving}`,
    `🔥 Calorie: ${draft.calories} kcal · Protein: ${draft.protein}g · Fat: ${draft.fat}g`,
    `🏷 *${draft.category_name}*`,
    "",
    "Kirim makanan/foto berikutnya, atau ketik *help*.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function foodDisplayNameFromItems(
  items: FoodDraft["items"],
  fallback: string,
): string {
  if (items?.length) {
    return items.map((i) => i.food_name).join(", ");
  }
  return fallback;
}
