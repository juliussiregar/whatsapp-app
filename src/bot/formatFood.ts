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

export function formatHelp(pendingLabel?: string | null): string {
  const lines = [
    "*Halo! Selamat datang di Bot SolidPace* 👋",
    "",
    "Bot ini punya *3 fungsi*:",
    "",
    "*1. Catat makanan / minuman (teks)*",
    "Tulis apa yang baru dimakan atau diminum. Bot siapkan ringkasan (kalori, protein, lemak, karbo), lalu simpan setelah Anda balas *ya*.",
    "Contoh:",
    "• _Saya habis makan nasi ayam 300gr untuk makan malam_",
    "• _Nasi putih 200gr, protein 4 karbo 45_",
    "• _Baru minum susu protein 1 botol_",
    "",
    "*2. Catat makanan lewat foto*",
    "Kirim *foto dari atas*, semua makanan kelihatan. Boleh kasih caption porsi, contoh _setengah piring_ atau _makan siang_.",
    "",
    "*3. Catat aktivitas latihan (teks)*",
    "Tulis jenis, durasi, dan tanggalnya. Bot siapkan ringkasan dulu, baru disimpan setelah *ya*.",
    "Contoh:",
    "• _Lari 5km, 40 menit, tanggal 17 Juli_",
    "• _Gowes 1 jam kemarin_ · _Renang 45 menit tadi pagi_ · _Yoga 30 menit_",
    "",
    "📦 File jam (.fit / .tcx / .gpx) *tidak* lewat WhatsApp — unggah di aplikasi SolidPace.",
    "",
    "*Perintah:*",
    "• *ya* — simpan ringkasan",
    "• *batal* — buang ringkasan",
    "• *ganti* — buang yang lama, pakai pesan/foto baru",
    "• *help* / *menu* — tampilkan panduan ini (ringkasan pending tidak terbuang)",
    "• *salah* / *undo* — yang sudah *ya* hapus di aplikasi SolidPace",
    "",
    "Boleh kirim *pesan suara* — bot ubah jadi teks lalu proses seperti biasa.",
    "",
    "⏱ Slot makan (sarapan / siang / snack / malam) bisa disebut di pesan, atau dipilih dari jam *WIB*.",
    "Target kalori harian ada di aplikasi SolidPace.",
    "",
    "Nomor WhatsApp harus sudah terdaftar di profil SolidPace. Kalau belum, hubungi *admin*.",
    "",
    POWERED_BY_SOLIDPACE,
  ];
  if (pendingLabel) {
    lines.push(
      "",
      `ℹ️ Masih ada ringkasan *${pendingLabel}* yang menunggu. Balas *ya* / *batal* / *ganti*.`,
    );
  }
  return lines.join("\n");
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

/** Intent tidak jelas — contoh singkat makanan, foto, dan latihan. */
export function formatUnclear(): string {
  return [
    "Belum kebaca. Coba salah satu:",
    "",
    "• Makanan: _Nasi ayam 300gr makan malam_",
    "• Foto makanan dari atas",
    "• Latihan: _Lari 40 menit_",
    "",
    "Ketik *help* untuk panduan lengkap.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatConfirmIdle(): string {
  return [
    "Tidak ada ringkasan yang menunggu konfirmasi.",
    "",
    "Kirim makanan, foto, atau latihan. Ketik *help* untuk panduan.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatExpired(): string {
  return [
    "Ringkasan sebelumnya sudah kedaluwarsa (lebih dari 30 menit).",
    "",
    "Kirim ulang makanannya, fotonya, atau latihannya.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatUndoSaved(label: string): string {
  return [
    `*${label}* sudah tersimpan di SolidPace.`,
    "",
    "Bot belum bisa menghapus catatan yang sudah masuk. Hapus lewat aplikasi SolidPace.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatUndoIdle(): string {
  return [
    "Tidak ada catatan baru dari chat ini.",
    "",
    "Yang sudah tersimpan hapus lewat aplikasi SolidPace.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatPendingPhotoReplace(pendingLabel: string, draft: FoodDraft): string {
  return [
    `Masih ada *${pendingLabel}* yang belum disimpan.`,
    "",
    `Foto ini kebaca *${draft.food_name}* (${formatQty(draft.calories)} kcal).`,
    "Balas *ganti* untuk buang yang lama dan pakai foto ini.",
    "*ya* — simpan yang lama · *batal* — buang semua",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatVoiceUnclear(): string {
  return [
    "Pesan suara belum kebaca. Coba ketik, atau kirim ulang suaranya lebih jelas.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatAiReadFail(kind: "food" | "activity"): string {
  if (kind === "activity") {
    return [
      "AI sedang sibuk, belum kebaca sebagai latihan.",
      "",
      "Coba tulis jenis dan durasi, contoh: _lari 40 menit_ / _gowes 1 jam kemarin_.",
      "Kalau mau catat makanan: _nasi ayam 300gr_.",
      "",
      POWERED_BY_SOLIDPACE,
    ].join("\n");
  }
  return [
    "AI sedang sibuk, belum kebaca sebagai makanan.",
    "",
    "Coba tulis ulang, contoh: _nasi goreng 250gr siang_ atau _nasi putih 200gr karbo 45_.",
    "Kalau mau catat latihan: _lari 40 menit_.",
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
