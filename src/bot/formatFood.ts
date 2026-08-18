import { formatWibClock } from "@/bot/category.js";
import { CALORIES_ADJUSTED_NOTE } from "@/bot/extractFood.js";
import type { FoodDraft, FoodDraftItem } from "@/bot/session.js";
import type { FoodLogResult } from "@/clients/solidpace.js";

export function formatQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

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
      "_300 kcal_ · _250gr_ · _tadi pagi_ · _karbo 28_ · _protein 20_",
    ].join("\n");
  }
  return [
    "ℹ️ *Catatan:* angka di atas adalah *perkiraan AI Bot SolidPace*, bukan data pasti dari database.",
    "Kalau salah, kirim koreksi singkat, contoh:",
    "_300 kcal_ · _250gr_ · _tadi pagi_ · _karbo 28_ · _protein 20 lemak 8_",
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
  return `   • ${item.food_name} — ${portion} · ${formatQty(item.calories)} kcal · ${formatQty(item.protein)}P ${formatQty(item.fat)}L ${formatQty(item.carbo)}K`;
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
    `🔥 Kalori: ${formatQty(draft.calories)} kcal`,
    `🥩 Protein: ${formatQty(draft.protein)}g`,
    `🧈 Lemak: ${formatQty(draft.fat)}g`,
    `🍞 Karbo: ${formatQty(draft.carbo)}g`,
    `🏷 Kategori: *${draft.category_name}* (jam WIB ${formatWibClock()})`,
  );

  if (draft.disclaimer) {
    lines.push("", `💬 ${draft.disclaimer}`);
  }
  if (draft.caloriesAdjusted) {
    lines.push("", `ℹ️ ${CALORIES_ADJUSTED_NOTE}`);
  }

  lines.push("", aiEstimateNote(draft));

  lines.push("", POWERED_BY_SOLIDPACE);
  return lines.join("\n");
}

export function formatPendingFoodAsk(draft: FoodDraft): string {
  return [
    `Masih ada ringkasan yang belum disimpan: *${draft.food_name}* (${formatQty(draft.calories)} kcal · karbo ${formatQty(draft.carbo)}g).`,
    "",
    "*ya* — simpan · *ganti* — buang ini, pakai pesan baru · *batal* — buang",
    "",
    "Koreksi singkat: _300 kcal_ · _250gr_ · _tadi pagi_ · _karbo 28_ · _protein 20 lemak 8_",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatPendingFoodReplace(draft: FoodDraft, incoming: string): string {
  const preview = incoming.trim().slice(0, 80);
  return [
    `Masih ada *${draft.food_name}* yang belum disimpan.`,
    "",
    `Balas *ganti* untuk buang itu dan catat: _${preview}_`,
    "Atau *ya* untuk simpan yang lama, *batal* untuk buang semua.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatFoodNeedMacros(foodName: string): string {
  return [
    `Kebaca *${foodName}*, tapi angka gizinya belum jelas.`,
    "",
    "Kirim perkiraan, contoh:",
    "• _300 kcal karbo 40_",
    "• _protein 20 lemak 8 karbo 50_",
    "Atau kirim *foto* makanannya dari atas.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatHelp(): string {
  return [
    "*Bot SolidPace* 👋",
    "",
    "*Makanan:* tulis apa yang dimakan, atau kirim foto dari atas.",
    "Contoh: _nasi ayam 300gr malam_ · _nasi putih 200gr karbo 45_",
    "",
    "*Latihan:* tulis jenis + durasi (file jam tidak lewat WA).",
    "Contoh: _lari 5km 40 menit_ · _gowes 1 jam kemarin_",
    "",
    "*ya* simpan · *batal* buang · *ganti* pakai pesan baru",
    "",
    "Nomor WA harus sudah ada di profil SolidPace.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatFoodUnclear(): string {
  return [
    "Belum kebaca sebagai catatan makanan.",
    "",
    "Coba tulis seperti ini:",
    "• _Nasi ayam 300gr makan malam_",
    "• _Kopi susu 1 gelas, 150 kcal_",
    "• _Nasi putih 200gr, protein 4 karbo 45_",
    "",
    "Atau kirim *foto* makanan dari atas. Ketik *help* untuk panduan.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatSaved(
  draft: FoodDraft,
  fullName?: string,
  result?: FoodLogResult | null,
): string {
  const who = fullName ? `, ${fullName}` : "";
  const calories = result?.calories ?? draft.calories;
  const protein = result?.protein ?? draft.protein;
  const fat = result?.fat ?? draft.fat;
  const carbo = result?.carbo ?? draft.carbo;
  const serving = result?.serving ?? draft.serving;
  const suffix = result?.suffix_serving ?? draft.suffix_serving;
  const foodName = result?.food_name ?? draft.food_name;

  const lines = [
    `✅ Tersimpan${who}!`,
    `🍽 ${foodName} · ${formatQty(serving)}${suffix}`,
    `🔥 ${formatQty(calories)} kcal · Protein ${formatQty(protein)}g · Lemak ${formatQty(fat)}g · Karbo ${formatQty(carbo)}g`,
    `🏷 *${draft.category_name}*`,
  ];

  const dayCal = result?.total_actual_calories;
  if (dayCal != null) {
    const dayP = result?.total_actual_proteingrams;
    const dayF = result?.total_actual_fatgrams;
    const dayC = result?.total_actual_carbograms;
    const extras = [
      dayP != null ? `P ${formatQty(dayP)}g` : null,
      dayF != null ? `F ${formatQty(dayF)}g` : null,
      dayC != null ? `C ${formatQty(dayC)}g` : null,
    ].filter(Boolean);
    lines.push(
      "",
      extras.length
        ? `📊 Total hari ini: *${formatQty(dayCal)} kcal* · ${extras.join(" · ")}`
        : `📊 Total hari ini: *${formatQty(dayCal)} kcal*`,
    );
  }

  lines.push("", "Langsung kirim makanan, foto, atau aktivitas berikutnya.", "", POWERED_BY_SOLIDPACE);
  return lines.join("\n");
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
