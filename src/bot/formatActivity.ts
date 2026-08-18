import {
  formatDurationHuman,
  formatSessionDateHuman,
} from "@/bot/activityTime.js";
import { activityLabel } from "@/bot/extractActivity.js";
import { formatQty, POWERED_BY_SOLIDPACE } from "@/bot/formatFood.js";
import type { ActivityClarifyNeed, ActivityDraft, ActivityPartial } from "@/bot/session.js";
import type { TrainingSessionOverlap, TrainingSessionResult } from "@/clients/solidpace.js";

export function formatActivitySummary(draft: ActivityDraft): string {
  const lines = [
    "*📋 Ringkasan aktivitas*",
    "",
    "*BALAS YA UNTUK MENYIMPAN*",
    "Atau balas *batal* untuk membatalkan.",
    "",
    `🏃 ${activityLabel(draft.activity_type)}`,
    `📅 ${formatSessionDateHuman(draft.session_date)} WIB`,
    `⏱ ${formatDurationHuman(draft.duration)}`,
  ];

  if (draft.distance != null && draft.distance > 0) {
    lines.push(`📏 ${formatQty(draft.distance)} km`);
  }
  if (draft.elevation_gain != null && draft.elevation_gain > 0) {
    lines.push(`⛰ Elevasi: ${formatQty(draft.elevation_gain)} m`);
  }
  if (draft.calories != null && draft.calories > 0) {
    lines.push(`🔥 ${formatQty(draft.calories)} kcal`);
  }
  if (draft.hr_avg != null) lines.push(`❤️ HR rata-rata: ${draft.hr_avg}`);
  if (draft.hr_max != null) lines.push(`❤️ HR maks: ${draft.hr_max}`);
  if (draft.cadence_avg != null) lines.push(`🔁 Cadence: ${formatQty(draft.cadence_avg)}`);
  if (draft.notes) lines.push(`💬 ${draft.notes}`);

  if (draft.dateAmbiguous) {
    lines.push(
      "",
      "⚠️ Tanggal mungkin ambigu. Pastikan tanggal & jam di atas sudah benar sebelum balas *ya*.",
    );
  }

  lines.push(
    "",
    "Kalau salah, kirim koreksi singkat, contoh:",
    "_50 menit_ · _5 km_ · _kemarin_ · _jam 7 pagi_ · _elevasi 200m_",
    "",
    POWERED_BY_SOLIDPACE,
  );
  return lines.join("\n");
}

export function formatPendingActivityReplace(draft: ActivityDraft, incoming: string): string {
  const preview = incoming.trim().slice(0, 80);
  return [
    `Masih ada *${activityLabel(draft.activity_type)}* yang belum disimpan.`,
    "",
    `Balas *ganti* untuk buang itu dan catat: _${preview}_`,
    "Atau *ya* untuk simpan yang lama, *batal* untuk buang semua.",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

export function formatPendingActivityAsk(draft: ActivityDraft): string {
  return [
    `Masih ada aktivitas yang belum disimpan: *${activityLabel(draft.activity_type)}* · ${formatDurationHuman(draft.duration)}.`,
    "",
    "*ya* — simpan · *ganti* — buang ini, pakai pesan baru · *batal* — buang",
    "",
    "Kalau mau koreksi, kirim singkat: _50 menit_ · _5 km_ · _kemarin_",
    "",
    POWERED_BY_SOLIDPACE,
  ].join("\n");
}

function overlapIsPresent(overlap?: TrainingSessionOverlap | null): boolean {
  if (!overlap) return false;
  if (overlap.overlapping === true || overlap.has_overlap === true) return true;
  if (overlap.sessions && overlap.sessions.length > 0) return true;
  if (overlap.message?.trim()) return true;
  return false;
}

export function formatLoadOverlap(overlap?: TrainingSessionOverlap | null): string | null {
  if (!overlapIsPresent(overlap)) return null;
  const lines = [
    "⚠️ Ada sesi lain di waktu yang sama (mis. Garmin/stopwatch). Sesi WhatsApp ini tetap tercatat.",
  ];
  if (overlap?.message?.trim()) {
    lines.push(overlap.message.trim());
  }
  if (overlap?.sessions?.length) {
    for (const s of overlap.sessions.slice(0, 3)) {
      const name = s.session_name || s.activity_type || s.source_label || s.source || "sesi lain";
      lines.push(`• ${name}`);
    }
  }
  return lines.join("\n");
}

export function formatActivitySaved(
  draft: ActivityDraft,
  result?: TrainingSessionResult | null,
  fullName?: string,
): string {
  const who = fullName ? `, ${fullName}` : "";
  const duration = result?.duration ?? draft.duration;
  const distance = result?.distance ?? draft.distance;
  const date = result?.session_date ?? draft.session_date;
  const type = result?.activity_type ?? draft.activity_type;

  const lines = [
    `✅ Aktivitas tersimpan${who}!`,
    `🏃 ${activityLabel(type)} · ${formatDurationHuman(duration)}`,
    `📅 ${formatSessionDateHuman(date)} WIB`,
  ];

  const name = result?.session_name ?? draft.session_name;
  if (name) lines.push(`🏷 ${name}`);

  if (distance != null && Number(distance) > 0) {
    lines.push(`📏 ${formatQty(Number(distance))} km`);
  }
  if (draft.elevation_gain != null && draft.elevation_gain > 0) {
    lines.push(`⛰ Elevasi: ${formatQty(draft.elevation_gain)} m`);
  }
  if (draft.calories != null && draft.calories > 0) {
    lines.push(`🔥 ${formatQty(draft.calories)} kcal`);
  }
  if (draft.hr_avg != null) lines.push(`❤️ HR rata-rata: ${draft.hr_avg}`);
  if (draft.hr_max != null) lines.push(`❤️ HR maks: ${draft.hr_max}`);
  if (draft.cadence_avg != null) lines.push(`🔁 Cadence: ${formatQty(draft.cadence_avg)}`);
  if (result?.tss != null) {
    lines.push(`📈 TSS: ${formatQty(result.tss)}`);
  }
  if (result?.source_label) {
    lines.push(`🔗 Sumber: ${result.source_label}`);
  }

  const overlap = formatLoadOverlap(result?.load_overlap);
  if (overlap) {
    lines.push("", overlap);
  }

  lines.push("", "Langsung kirim makanan, foto, atau aktivitas berikutnya.", "", POWERED_BY_SOLIDPACE);
  return lines.join("\n");
}

export function formatActivityClarify(
  partial: ActivityPartial,
  needs: ActivityClarifyNeed[],
): string {
  const lines = ["*📋 Aktivitas hampir lengkap*", ""];

  if (partial.activity_type) {
    lines.push(`🏃 ${activityLabel(partial.activity_type)}`);
  }
  if (partial.session_date) {
    lines.push(`📅 ${formatSessionDateHuman(partial.session_date)} WIB`);
  }
  if (partial.duration) {
    lines.push(`⏱ ${formatDurationHuman(partial.duration)}`);
  }
  if (partial.distance) {
    lines.push(`📏 ${partial.distance} km`);
  }
  if (partial.elevation_gain) {
    lines.push(`⛰ Elevasi: ${formatQty(partial.elevation_gain)} m`);
  }
  if (partial.calories) {
    lines.push(`🔥 ${formatQty(partial.calories)} kcal`);
  }

  lines.push("");

  if (needs.includes("duration_unit") && partial.unclearDurationNumber != null) {
    lines.push(
      `Durasi *${partial.unclearDurationNumber}* — menit atau detik?`,
      "",
      "Balas *menit* atau *detik*. Contoh: _40 menit_",
    );
  } else if (needs.includes("duration")) {
    lines.push("Berapa *durasinya*? Contoh: _40 menit_ / _1 jam 30 menit_");
  }

  if (needs.includes("activity_type")) {
    lines.push("Aktivitas apa? Contoh: _lari_ / _sepeda_ / _renang_ / _gym_ / _jalan kaki_");
  }

  lines.push("", "Atau ketik *batal* untuk membatalkan.", "", POWERED_BY_SOLIDPACE);
  return lines.join("\n");
}
