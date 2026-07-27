import type { Message } from "whatsapp-web.js";
import { pickCategory, formatWibClock } from "@/bot/category.js";
import { isCasualGreeting, isConfirmNo, isConfirmYes, isMenuCommand } from "@/bot/commands.js";
import { extractFoodCorrection, extractFoodFromText, mergeFoodCorrection } from "@/bot/extractFood.js";
import {
  foodImageMimeErrorMessage,
  isAllowedFoodImageMime,
} from "@/bot/media.js";
import { downloadInboundMedia } from "@/bot/downloadMedia.js";
import {
  resolveUserPhoneForSolidPace,
  stableSessionKeyForMessage,
} from "@/bot/messageContext.js";
import { allowApiCall } from "@/bot/rateLimit.js";
import {
  getSession,
  resetSession,
  setSession,
  type FoodDraft,
  type Session,
} from "@/bot/session.js";
import { waLogError, waLogInfo, waLogWarn } from "@/bot/waLog.js";
import {
  SolidPaceApiError,
  analyzeFoodImage,
  logFood,
  resolveUserByPhone,
  type SolidPaceUser,
} from "@/clients/solidpace.js";
import { isSolidPaceBotEnabled } from "@/config.js";
import { isDirectUserChat } from "@/utils/phone.js";

const WELCOME_TEXT = `*Halo! Selamat datang di Bot SolidPace* 👋

Bot ini punya *2 fungsi utama*:

*1. Melaporkan habis makan/minum apa*
Anda bisa langsung kirim *teks* makanan atau minuman yang baru dikonsumsi, lalu bot akan bantu siapkan catatannya untuk disimpan ke SolidPace.

Contoh:
• _Saya habis makan nasi ayam 300gr untuk makan malam_
• _Baru minum susu protein 1 botol_

*2. Melaporkan makanan lewat foto*
Kalau Anda belum tahu perkiraan kalori atau porsinya, cukup kirim *foto makanan*. Bot akan bantu analisis dulu, lalu tampilkan ringkasannya sebelum disimpan.

Contoh:
• Kirim foto makanan
• Tambahkan caption seperti _setengah piring_ atau _makan siang_ jika perlu

*Perintah:*
*menu* / *help* — tampilkan panduan ini
*batal* — batalkan konfirmasi yang sedang aktif

⏱ Kategori seperti *sarapan / siang / snack / malam* bisa disebutkan di pesan, atau akan dipilih otomatis dari jam *WIB*.

Jika nomor WhatsApp Anda belum terdaftar di SolidPace, silakan hubungi *admin* dan pastikan nomor WA sudah tersimpan di profil Anda.`;

const ACTIVITY_EXT = /\.(fit|tcx|gpx)$/i;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function safeReply(message: Message, text: string, ctx = "inbound"): Promise<void> {
  try {
    await message.reply(text);
    waLogInfo("reply_ok", { ctx, from: message.from, via: "reply" });
    return;
  } catch (e1) {
    waLogWarn("reply_fail", { ctx, from: message.from, via: "reply", err: errMsg(e1) });
    try {
      const chat = await message.getChat();
      await chat.sendMessage(text, { sendSeen: false });
      waLogInfo("reply_ok", { ctx, from: message.from, via: "chat.sendMessage" });
    } catch (e2) {
      waLogError("reply_fail", {
        ctx,
        from: message.from,
        via: "chat.sendMessage",
        err: errMsg(e2),
      });
    }
  }
}

function aiEstimateNote(draft: FoodDraft): string {
  if (draft.source === "image") {
    return [
      "ℹ️ *Catatan:* angka di atas adalah *perkiraan AI* dari analisis foto (SolidPace).",
      "Kalau kurang tepat, kirim koreksi singkat, contoh:",
      "_300 kcal_ · _250gr_ · _tadi pagi_ · _bubur ayam 250gr 320 kcal_",
    ].join("\n");
  }
  return [
    "ℹ️ *Catatan:* angka di atas adalah *perkiraan AI Bot SolidPace*, bukan data pasti dari database.",
    "Kalau salah, kirim koreksi singkat, contoh:",
    "_300 kcal_ · _250gr_ · _tadi pagi_ · _bubur ayam 250gr 320 kcal_",
  ].join("\n");
}

function formatFoodSummary(draft: FoodDraft): string {
  const lines = [
    "*📋 Ringkasan makanan*",
    `🍽 ${draft.food_name}`,
    `⚖️ ${draft.serving} ${draft.suffix_serving}`,
    `🔥 ${draft.calories} kcal · 🥩 P ${draft.protein}g · 🧈 F ${draft.fat}g`,
    `🏷 Kategori: *${draft.category_name}* (jam WIB ${formatWibClock()})`,
    "",
    aiEstimateNote(draft),
  ];
  if (draft.disclaimer) {
    lines.push("", `💬 ${draft.disclaimer}`);
  }
  lines.push(
    "",
    "Balas *ya* untuk menyimpan, atau *batal* untuk membatalkan.",
  );
  return lines.join("\n");
}

function formatSaved(draft: FoodDraft, fullName?: string): string {
  const who = fullName ? `, ${fullName}` : "";
  return [
    `✅ Tersimpan${who}!`,
    `🍽 ${draft.food_name} · ${draft.serving}${draft.suffix_serving}`,
    `🔥 ${draft.calories} kcal · *${draft.category_name}*`,
    "",
    "Kirim makanan/foto berikutnya, atau ketik *help*.",
  ].join("\n");
}

function mapApiError(e: unknown): string {
  if (e instanceof SolidPaceApiError) {
    if (e.status === 404) {
      return "Nomor WhatsApp Anda belum terdaftar di SolidPace.\n\nSilakan hubungi *admin* terkait pendaftaran, dan pastikan nomor WA sudah diisi di profil SolidPace.";
    }
    if (e.status === 401) {
      const msg = e.message.toLowerCase();
      if (msg.includes("api key") || msg.includes("api-key") || msg.includes("x-api-key")) {
        return "Layanan bot belum dikonfigurasi dengan benar (API key). Hubungi admin teknis.";
      }
      return e.message || "Akun ini tidak berhak memakai bot. Hubungi *admin* jika menurut Anda ini kekeliruan.";
    }
    if (e.status === 400) {
      return `Data tidak valid: ${e.message}`;
    }
    if (e.status === 503) {
      return "Layanan SolidPace sedang tidak siap. Hubungi admin teknis.";
    }
    if (e.name === "TimeoutError" || e.message.includes("aborted")) {
      return "Permintaan ke SolidPace terlalu lama. Coba lagi dalam beberapa saat.";
    }
    return `Gagal ke SolidPace (${e.status}): ${e.message}`;
  }
  if (e instanceof Error && (e.name === "TimeoutError" || e.message.includes("aborted"))) {
    return "Permintaan ke SolidPace terlalu lama. Coba lagi dalam beberapa saat.";
  }
  return `Terjadi kesalahan: ${errMsg(e)}`;
}

async function ensureUser(
  message: Message,
  session: Session,
  phone: string,
  key: string,
): Promise<SolidPaceUser | null> {
  if (session.userId && session.categories?.length) {
    return {
      user_id: session.userId,
      full_name: session.fullName ?? "",
      phone,
      categories: session.categories,
    };
  }

  try {
    const user = await resolveUserByPhone(phone);
    session.userId = user.user_id;
    session.fullName = user.full_name;
    session.categories = user.categories;
    setSession(key, session);
    return user;
  } catch (e) {
    await safeReply(message, mapApiError(e), "resolve_user");
    return null;
  }
}

function draftFromTotals(
  totals: {
    food_name: string;
    serving: number;
    calories: number;
    fat: number;
    protein: number;
    suffix_serving?: string;
  },
  category: { category_id: number; name: string },
  source: FoodDraft["source"],
  disclaimer?: string,
): FoodDraft {
  return {
    food_name: totals.food_name,
    serving: totals.serving,
    suffix_serving: totals.suffix_serving ?? "gr",
    calories: totals.calories,
    fat: totals.fat,
    protein: totals.protein,
    category_id: category.category_id,
    category_name: category.name,
    source,
    disclaimer,
  };
}

async function handleConfirmYes(
  message: Message,
  key: string,
  session: Session,
  phone: string,
): Promise<void> {
  if (session.state.kind !== "pending_confirm") {
    await safeReply(
      message,
      "Tidak ada ringkasan yang menunggu konfirmasi.\n\nKetik *help* untuk panduan.",
      "confirm_idle",
    );
    return;
  }

  if (!allowApiCall(key)) {
    await safeReply(
      message,
      "🚦 Terlalu banyak permintaan. Tunggu sebentar lalu balas *ya* lagi.",
      "rate_limit",
    );
    return;
  }

  const draft = session.state.draft;
  try {
    await logFood({
      phone,
      category_id: draft.category_id,
      food_name: draft.food_name,
      serving: draft.serving,
      suffix_serving: draft.suffix_serving,
      calories: draft.calories,
      fat: draft.fat,
      protein: draft.protein,
    });
    resetSession(key);
    await safeReply(message, formatSaved(draft, session.fullName), "saved");
  } catch (e) {
    waLogWarn("log_food_fail", { from: message.from, err: errMsg(e) });
    await safeReply(message, mapApiError(e), "log_food_fail");
  }
}

async function handleFoodText(
  message: Message,
  key: string,
  session: Session,
  user: SolidPaceUser,
  text: string,
  existingDraft?: FoodDraft,
): Promise<void> {
  if (!allowApiCall(key)) {
    await safeReply(
      message,
      "🚦 Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
      "rate_limit",
    );
    return;
  }

  // Koreksi draft yang sedang menunggu konfirmasi
  if (existingDraft) {
    await safeReply(message, "⏳ Memperbarui ringkasan…", "correct_busy");

    let correction;
    try {
      correction = await extractFoodCorrection(text, existingDraft);
    } catch (e) {
      waLogWarn("correct_fail", { from: message.from, err: errMsg(e) });
      await safeReply(
        message,
        [
          "⚠️ Belum berhasil membaca koreksi.",
          "",
          "Coba kirim singkat, contoh: *300 kcal* / *tadi pagi* / *250gr*",
          "",
          formatFoodSummary(existingDraft),
        ].join("\n"),
        "correct_fail",
      );
      return;
    }

    if (correction.is_correction) {
      let draft = mergeFoodCorrection(existingDraft, correction);
      if (correction.category_hint) {
        const category = pickCategory(user.categories, correction.category_hint);
        if (category) {
          draft = {
            ...draft,
            category_id: category.category_id,
            category_name: category.name,
          };
        }
      }
      session.state = { kind: "pending_confirm", draft };
      setSession(key, session);
      await safeReply(message, formatFoodSummary(draft), "confirm_corrected");
      return;
    }

    // Bukan koreksi — coba sebagai laporan makanan baru
  }

  await safeReply(message, "⏳ Membaca makanan Anda…", "extract_busy");

  let extracted;
  try {
    extracted = await extractFoodFromText(text);
  } catch (e) {
    waLogWarn("extract_fail", { from: message.from, err: errMsg(e) });
    await safeReply(
      message,
      `⚠️ Gagal membaca pesan makanan: ${errMsg(e)}\n\nCoba tulis ulang, contoh: _nasi goreng 250gr siang_`,
      "extract_fail",
    );
    return;
  }

  if (!extracted.is_food_log || !extracted.food_name) {
    if (existingDraft) {
      await safeReply(
        message,
        [
          "Belum mengerti koreksinya.",
          "",
          "Kirim singkat seperti: *300 kcal* / *tadi pagi* / *250gr*",
          "Atau balas *ya* untuk menyimpan / *batal* untuk membatalkan.",
          "",
          formatFoodSummary(existingDraft),
        ].join("\n"),
        "correct_unclear",
      );
      return;
    }
    await safeReply(message, WELCOME_TEXT, "not_food");
    return;
  }

  const serving = extracted.serving && extracted.serving > 0 ? extracted.serving : 100;
  const calories = Math.max(0, extracted.calories ?? 0);
  const fat = Math.max(0, extracted.fat ?? 0);
  const protein = Math.max(0, extracted.protein ?? 0);

  const category = pickCategory(user.categories, extracted.category_hint);
  if (!category) {
    await safeReply(
      message,
      "Akun Anda belum punya kategori nutrisi. Hubungi *admin*.",
      "no_category",
    );
    return;
  }

  const draft = draftFromTotals(
    {
      food_name: extracted.food_name,
      serving,
      suffix_serving: extracted.suffix_serving || "gr",
      calories,
      fat,
      protein,
    },
    category,
    "text",
    extracted.notes ?? undefined,
  );

  session.state = { kind: "pending_confirm", draft };
  setSession(key, session);
  await safeReply(message, formatFoodSummary(draft), "confirm_text");
}

async function handleFoodImage(
  message: Message,
  key: string,
  session: Session,
  user: SolidPaceUser,
  phone: string,
): Promise<void> {
  if (!allowApiCall(key)) {
    await safeReply(
      message,
      "🚦 Terlalu banyak permintaan. Tunggu sebentar lalu kirim foto lagi.",
      "rate_limit",
    );
    return;
  }

  // Unduh dulu sebelum balas "sedang menganalisis" — reply/chat action
  // kadang memicu error Puppeteer "r:r" pada downloadMedia.
  let media;
  try {
    media = await downloadInboundMedia(message);
  } catch (e: unknown) {
    const err = e instanceof Error
      ? { message: e.message, name: e.name, stack: e.stack?.split("\n").slice(0, 4).join(" | ") }
      : { raw: JSON.stringify(e) };
    waLogWarn("download_media_fail", {
      from: message.from,
      type: message.type,
      msgId: (message.id as { _serialized?: string } | undefined)?._serialized ?? null,
      ...err,
    });
    await safeReply(
      message,
      "⚠️ Gagal mengunduh foto. Tunggu beberapa detik lalu kirim ulang.",
      "download_fail",
    );
    return;
  }

  await safeReply(message, "📸 Menganalisis foto makanan…", "analyze_busy");

  const base64 = media.data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  const mimeType = media.mimetype || "image/jpeg";
  const filename = media.filename || `food-${Date.now()}.jpg`;
  const portionHint = (message.body ?? "").trim() || undefined;

  if (!isAllowedFoodImageMime(mimeType)) {
    await safeReply(message, foodImageMimeErrorMessage(), "unsupported_image_mime");
    return;
  }

  try {
    const result = await analyzeFoodImage({
      phone,
      file: buffer,
      filename,
      mimeType,
      portionHint,
      save: false,
    });

    const totals = result.analysis?.totals;
    if (!totals?.food_name) {
      await safeReply(
        message,
        "⚠️ Foto tidak dikenali sebagai makanan. Coba foto yang lebih jelas, atau tulis makanannya.",
        "analyze_empty",
      );
      return;
    }

    const category = pickCategory(user.categories, portionHint);
    if (!category) {
      await safeReply(
        message,
        "Akun Anda belum punya kategori nutrisi. Hubungi *admin*.",
        "no_category",
      );
      return;
    }

    const draft = draftFromTotals(
      {
        food_name: totals.food_name,
        serving: totals.serving > 0 ? totals.serving : 100,
        calories: Math.max(0, totals.calories ?? 0),
        fat: Math.max(0, totals.fat ?? 0),
        protein: Math.max(0, totals.protein ?? 0),
      },
      category,
      "image",
      result.analysis.disclaimer,
    );

    session.state = { kind: "pending_confirm", draft };
    setSession(key, session);
    await safeReply(message, formatFoodSummary(draft), "confirm_image");
  } catch (e) {
    waLogWarn("analyze_fail", { from: message.from, err: errMsg(e) });
    await safeReply(message, mapApiError(e), "analyze_fail");
  }
}

function looksLikeActivityFile(message: Message): boolean {
  const body = (message.body ?? "").trim();
  if (ACTIVITY_EXT.test(body)) return true;
  // Document messages often carry filename in body for whatsapp-web.js
  return message.type === "document" && ACTIVITY_EXT.test(body);
}

export async function handleInboundMessage(message: Message): Promise<void> {
  if (!isSolidPaceBotEnabled()) return;
  if (message.fromMe) return;
  if (!isDirectUserChat(message.from)) return;

  const key = await stableSessionKeyForMessage(message);
  const session = getSession(key);
  const bodyText = message.body ?? "";
  const cmd = bodyText.trim();
  const isTextOnly = !message.hasMedia;

  waLogInfo("inbound", {
    from: message.from,
    type: message.type,
    hasMedia: message.hasMedia,
    preview: bodyText.slice(0, 80),
    state: session.state.kind,
  });

  // Global commands & sapaan
  if (isMenuCommand(cmd)) {
    resetSession(key);
    await safeReply(message, WELCOME_TEXT, "welcome");
    return;
  }

  if (
    isTextOnly &&
    session.state.kind !== "pending_confirm" &&
    isCasualGreeting(cmd)
  ) {
    await safeReply(message, WELCOME_TEXT, "welcome");
    return;
  }

  if (isTextOnly && isConfirmNo(cmd)) {
    if (session.state.kind === "pending_confirm") {
      resetSession(key);
      await safeReply(message, "❌ Dibatalkan. Kirim makanan/foto baru, atau ketik *help*.", "cancelled");
    } else {
      await safeReply(message, "Tidak ada proses yang dibatalkan.\n\nKetik *help* untuk panduan.", "cancel_idle");
    }
    return;
  }

  let phone: string;
  try {
    phone = await resolveUserPhoneForSolidPace(message);
  } catch (e) {
    await safeReply(
      message,
      `⚠️ ${errMsg(e)}\n\nHubungi *admin* jika masalah berlanjut.`,
      "phone_resolve_fail",
    );
    return;
  }

  // Activity files (explicitly out of scope)
  if (looksLikeActivityFile(message)) {
    await safeReply(
      message,
      "📦 Upload aktivitas (.fit / .tcx / .gpx) *belum didukung* lewat WhatsApp.\n\nSilakan upload lewat aplikasi SolidPace.",
      "activity_unsupported",
    );
    return;
  }

  // Media routing — sebelum konfirmasi teks agar foto+caption tidak salah dibaca sebagai "ya"
  if (message.hasMedia) {
    if (message.type === "image") {
      const user = await ensureUser(message, session, phone, key);
      if (!user) return;
      await handleFoodImage(message, key, getSession(key), user, phone);
      return;
    }

    if (message.type === "sticker" || message.type === "video" || message.type === "ptt" || message.type === "audio") {
      await safeReply(
        message,
        "⚠️ Format ini belum didukung.\n\nKirim *foto makanan* atau *tulis* makanannya. Ketik *help* untuk panduan.",
        "unsupported_media",
      );
      return;
    }

    if (message.type === "document") {
      await safeReply(
        message,
        "📄 Dokumen tidak diproses di bot ini.\n\nKirim *foto makanan* (JPEG/PNG) atau tulis makanannya. File aktivitas silakan lewat aplikasi SolidPace.",
        "document_unsupported",
      );
      return;
    }
  }

  // Konfirmasi hanya untuk pesan teks tanpa media
  if (isTextOnly && isConfirmYes(cmd)) {
    if (session.state.kind === "pending_confirm") {
      if (!session.fullName) {
        await ensureUser(message, session, phone, key);
      }
      await handleConfirmYes(message, key, getSession(key), phone);
      return;
    }
    await safeReply(
      message,
      "Tidak ada ringkasan yang menunggu konfirmasi.\n\n" + WELCOME_TEXT,
      "confirm_idle",
    );
    return;
  }

  // Empty body (e.g. contact share)
  if (!cmd.trim()) {
    await safeReply(message, WELCOME_TEXT, "empty");
    return;
  }

  const user = await ensureUser(message, session, phone, key);
  if (!user) return;

  const pendingDraft =
    session.state.kind === "pending_confirm" ? session.state.draft : undefined;

  await handleFoodText(
    message,
    key,
    getSession(key),
    user,
    message.body ?? "",
    pendingDraft,
  );
}
