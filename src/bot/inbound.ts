import type { Message } from "whatsapp-web.js";
import { pickCategory } from "@/bot/category.js";
import { isCasualGreeting, isConfirmNo, isConfirmYes, isMenuCommand } from "@/bot/commands.js";
import {
  activityDraftFromPartial,
  applyActivityClarifyText,
  applyActivityCorrection,
  clarifyNeeds,
  extractActivityFromText,
  extractedToPartial,
  mergeActivityPartial,
  parseQuickActivityCorrection,
} from "@/bot/extractActivity.js";
import { extractFoodFromText, isFoodCorrectionText, mergeFoodCorrection, parseQuickCorrection } from "@/bot/extractFood.js";
import {
  formatActivityClarify,
  formatActivitySaved,
  formatActivitySummary,
  formatPendingActivityAsk,
} from "@/bot/formatActivity.js";
import {
  formatFoodSummary,
  formatPendingFoodAsk,
  formatSaved,
  foodDisplayNameFromItems,
  PHOTO_GUIDELINES,
  PHOTO_GUIDELINES_SHORT,
} from "@/bot/formatFood.js";
import { mapApiError } from "@/bot/apiError.js";
import { classifyTextIntent, hasActivitySignal } from "@/bot/intent.js";
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
  type ActivityDraft,
  type ActivityPartial,
  type FoodDraft,
  type Session,
} from "@/bot/session.js";
import { waLogError, waLogInfo, waLogWarn } from "@/bot/waLog.js";
import {
  analyzeFoodImage,
  logFood,
  logTrainingSession,
  parseFoodAnalysisItems,
  resolveUserByPhone,
  type SolidPaceUser,
} from "@/clients/solidpace.js";
import { isSolidPaceBotEnabled } from "@/config.js";
import { isDirectUserChat } from "@/utils/phone.js";

const WELCOME_TEXT = `*Halo! Selamat datang di Bot SolidPace* 👋

Bot ini punya *3 fungsi utama*:

*1. Melaporkan habis makan/minum apa*
Anda bisa langsung kirim *teks* makanan atau minuman yang baru dikonsumsi, lalu bot akan bantu siapkan catatannya untuk disimpan ke SolidPace.

Contoh:
• _Saya habis makan nasi ayam 300gr untuk makan malam_
• _Baru minum susu protein 1 botol_

*2. Melaporkan makanan lewat foto*
Kalau Anda belum tahu perkiraan kalori atau porsinya, cukup kirim *foto makanan*. Bot akan bantu analisis dulu, lalu tampilkan ringkasannya sebelum disimpan.

${PHOTO_GUIDELINES}

Contoh:
• Kirim foto makanan
• Tambahkan caption seperti _setengah piring_ atau _makan siang_ jika perlu

*3. Mencatat aktivitas latihan (teks)*
Setelah selesai latihan, tulis jenis, durasi, dan tanggalnya. Bot siapkan ringkasan dulu, baru disimpan setelah Anda balas *ya*.

Contoh:
• _Lari 5km, 40 menit, tanggal 17 Juli_
• _Gowes 1 jam kemarin_
• _Renang 45 menit tadi pagi_
• _Yoga 30 menit_ / _Lari 8km 50 menit, elevasi 200m_

📦 File jam (.fit / .tcx / .gpx) *tidak* bisa diunggah lewat WhatsApp — silakan lewat aplikasi SolidPace.

*Perintah:*
*menu* / *help* — tampilkan panduan ini
*batal* — batalkan konfirmasi yang sedang aktif

⏱ Kategori makanan seperti *sarapan / siang / snack / malam* bisa disebutkan di pesan, atau akan dipilih otomatis dari jam *WIB*.

Jika nomor WhatsApp Anda belum terdaftar di SolidPace, silakan hubungi *admin* dan pastikan nomor WA sudah tersimpan di profil Anda.`;

const ACTIVITY_EXT = /\.(fit|tcx|gpx)$/i;

function isPendingSession(session: Session): boolean {
  return (
    session.state.kind === "pending_confirm" ||
    session.state.kind === "pending_confirm_activity" ||
    session.state.kind === "pending_activity_clarify"
  );
}

function canConfirmSave(session: Session): boolean {
  return (
    session.state.kind === "pending_confirm" ||
    session.state.kind === "pending_confirm_activity"
  );
}

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
  items?: FoodDraft["items"],
): FoodDraft {
  return {
    food_name: foodDisplayNameFromItems(items, totals.food_name),
    serving: totals.serving,
    suffix_serving: totals.suffix_serving ?? "gr",
    calories: totals.calories,
    fat: totals.fat,
    protein: totals.protein,
    category_id: category.category_id,
    category_name: category.name,
    source,
    disclaimer,
    items,
  };
}

async function handleConfirmYes(
  message: Message,
  key: string,
  session: Session,
  phone: string,
): Promise<void> {
  if (session.state.kind === "pending_activity_clarify") {
    await safeReply(
      message,
      formatActivityClarify(session.state.partial, session.state.needs),
      "confirm_clarify",
    );
    return;
  }

  if (!canConfirmSave(session)) {
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

  if (session.state.kind === "pending_confirm_activity") {
    const draft = session.state.draft;
    try {
      const result = await logTrainingSession({
        phone,
        activity_type: draft.activity_type,
        session_date: draft.session_date,
        duration: draft.duration,
        session_name: draft.session_name,
        distance: draft.distance,
        elevation_gain: draft.elevation_gain,
        hr_avg: draft.hr_avg,
        hr_max: draft.hr_max,
        cadence_avg: draft.cadence_avg,
        calories: draft.calories,
        notes: draft.notes,
      });
      resetSession(key);
      await safeReply(
        message,
        formatActivitySaved(draft, result, session.fullName),
        "activity_saved",
      );
    } catch (e) {
      waLogWarn("log_activity_fail", { from: message.from, err: errMsg(e) });
      await safeReply(message, mapApiError(e), "log_activity_fail");
    }
    return;
  }

  if (session.state.kind !== "pending_confirm") {
    await safeReply(
      message,
      "Tidak ada ringkasan yang menunggu konfirmasi.\n\nKetik *help* untuk panduan.",
      "confirm_idle",
    );
    return;
  }

  const draft = session.state.draft;
  try {
    const saved = await logFood({
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
    await safeReply(message, formatSaved(draft, session.fullName, saved), "saved");
  } catch (e) {
    waLogWarn("log_food_fail", { from: message.from, err: errMsg(e) });
    await safeReply(message, mapApiError(e), "log_food_fail");
  }
}

async function settleActivityPartial(
  message: Message,
  key: string,
  session: Session,
  partial: ActivityPartial,
  ctx: string,
): Promise<void> {
  const needs = clarifyNeeds(partial);
  if (needs.length) {
    session.state = { kind: "pending_activity_clarify", partial, needs };
    setSession(key, session);
    await safeReply(message, formatActivityClarify(partial, needs), ctx);
    return;
  }

  const draft = activityDraftFromPartial(partial);
  if (!draft) {
    await safeReply(message, WELCOME_TEXT, "activity_incomplete");
    return;
  }

  session.state = { kind: "pending_confirm_activity", draft };
  setSession(key, session);
  await safeReply(message, formatActivitySummary(draft), ctx);
}

async function handleActivityClarify(
  message: Message,
  key: string,
  session: Session,
  text: string,
): Promise<void> {
  if (session.state.kind !== "pending_activity_clarify") return;

  let partial = applyActivityClarifyText(session.state.partial, text);
  let needs = clarifyNeeds(partial);
  if (needs.length === 0) {
    await settleActivityPartial(message, key, session, partial, "activity_clarify_done");
    return;
  }

  if (!allowApiCall(key)) {
    await safeReply(
      message,
      "🚦 Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
      "rate_limit",
    );
    return;
  }

  await safeReply(message, "⏳ Melengkapi data aktivitas…", "activity_clarify_busy");

  try {
    const extracted = await extractActivityFromText(text);
    if (extracted.is_activity_log || extracted.activity_type || extracted.duration_seconds) {
      partial = mergeActivityPartial(partial, extracted);
      partial = applyActivityClarifyText(partial, text);
    }
  } catch (e) {
    waLogWarn("activity_clarify_fail", { from: message.from, err: errMsg(e) });
  }

  needs = clarifyNeeds(partial);
  if (needs.length) {
    session.state = { kind: "pending_activity_clarify", partial, needs };
    setSession(key, session);
    await safeReply(message, formatActivityClarify(partial, needs), "activity_clarify");
    return;
  }

  await settleActivityPartial(message, key, session, partial, "activity_clarify_done");
}

async function handleActivityText(
  message: Message,
  key: string,
  session: Session,
  user: SolidPaceUser,
  text: string,
  existingDraft?: ActivityDraft,
): Promise<void> {
  if (existingDraft) {
    const quick = parseQuickActivityCorrection(text);
    if (quick) {
      const applied = applyActivityCorrection(existingDraft, quick);
      if (applied.kind === "clarify") {
        session.state = {
          kind: "pending_activity_clarify",
          partial: applied.partial,
          needs: applied.needs,
        };
        setSession(key, session);
        await safeReply(
          message,
          formatActivityClarify(applied.partial, applied.needs),
          "activity_correct_clarify",
        );
        return;
      }
      session.state = { kind: "pending_confirm_activity", draft: applied.draft };
      setSession(key, session);
      await safeReply(message, formatActivitySummary(applied.draft), "activity_confirm_corrected");
      return;
    }

    await safeReply(message, formatPendingActivityAsk(existingDraft), "activity_pending_ask");
    return;
  }

  if (!allowApiCall(key)) {
    await safeReply(
      message,
      "🚦 Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
      "rate_limit",
    );
    return;
  }

  await safeReply(message, "⏳ Membaca aktivitas Anda…", "activity_extract_busy");

  let extracted;
  try {
    extracted = await extractActivityFromText(text);
  } catch (e) {
    waLogWarn("activity_extract_fail", { from: message.from, err: errMsg(e) });
    await safeReply(
      message,
      `⚠️ Gagal membaca pesan aktivitas: ${errMsg(e)}\n\nCoba tulis ulang, contoh: _lari 40 menit tanggal 17 Juli_`,
      "activity_extract_fail",
    );
    return;
  }

  if (!extracted.is_activity_log && !extracted.activity_type) {
    if (existingDraft) {
      await safeReply(
        message,
        [
          "Belum mengerti koreksinya.",
          "",
          "Kirim singkat seperti: *50 menit* / *5 km* / *kemarin*",
          "Atau balas *ya* untuk menyimpan / *batal* untuk membatalkan.",
          "",
          formatActivitySummary(existingDraft),
        ].join("\n"),
        "activity_correct_unclear",
      );
      return;
    }
    await safeReply(message, WELCOME_TEXT, "not_activity");
    return;
  }

  await settleActivityPartial(
    message,
    key,
    getSession(key),
    extractedToPartial(extracted),
    "activity_confirm",
  );
}

async function handleFoodText(
  message: Message,
  key: string,
  session: Session,
  user: SolidPaceUser,
  text: string,
  existingDraft?: FoodDraft,
): Promise<void> {
  if (existingDraft) {
    if (isFoodCorrectionText(text)) {
      const correction = parseQuickCorrection(text);
      if (correction) {
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
    }

    await safeReply(message, formatPendingFoodAsk(existingDraft), "food_pending_ask");
    return;
  }

  if (!allowApiCall(key)) {
    await safeReply(
      message,
      "🚦 Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
      "rate_limit",
    );
    return;
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
    if (hasActivitySignal(text)) {
      await handleActivityText(message, key, getSession(key), user, text);
      return;
    }
    await safeReply(message, WELCOME_TEXT, "not_food");
    return;
  }

  const serving = extracted.serving && extracted.serving > 0 ? extracted.serving : 100;
  const calories = Math.max(0, extracted.calories ?? 0);
  const fat = Math.max(0, extracted.fat ?? 0);
  const protein = Math.max(0, extracted.protein ?? 0);

  const category = pickCategory(user.categories, extracted.category_hint, extracted.food_name);
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
      "⚠️ Gagal mengunduh foto. Tunggu beberapa detik lalu kirim ulang.\n\n" + PHOTO_GUIDELINES_SHORT,
      "download_fail",
    );
    return;
  }

  const base64 = media.data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  const mimeType = media.mimetype || "image/jpeg";
  const filename = media.filename || `food-${Date.now()}.jpg`;
  const portionHint = (message.body ?? "").trim() || undefined;

  if (!isAllowedFoodImageMime(mimeType)) {
    await safeReply(message, foodImageMimeErrorMessage(), "unsupported_image_mime");
    return;
  }

  await safeReply(
    message,
    ["📸 Menganalisis foto makanan…", "", PHOTO_GUIDELINES_SHORT].join("\n"),
    "analyze_busy",
  );

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
        [
          "⚠️ Foto tidak dikenali sebagai makanan. Coba foto yang lebih jelas, atau tulis makanannya.",
          "",
          PHOTO_GUIDELINES,
        ].join("\n"),
        "analyze_empty",
      );
      return;
    }

    const items = parseFoodAnalysisItems(result.analysis.items).map((item) => ({
      food_name: item.food_name,
      serving: item.serving > 0 ? item.serving : 0,
      suffix_serving: item.suffix_serving ?? "gr",
      calories: item.calories,
      fat: item.fat,
      protein: item.protein,
    }));

    const displayName = foodDisplayNameFromItems(
      items.length ? items : undefined,
      totals.food_name,
    );
    const category = pickCategory(user.categories, portionHint, displayName);

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
        suffix_serving: totals.suffix_serving,
        calories: Math.max(0, totals.calories ?? 0),
        fat: Math.max(0, totals.fat ?? 0),
        protein: Math.max(0, totals.protein ?? 0),
      },
      category,
      "image",
      result.analysis.disclaimer,
      items.length ? items : undefined,
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
    !isPendingSession(session) &&
    isCasualGreeting(cmd)
  ) {
    await safeReply(message, WELCOME_TEXT, "welcome");
    return;
  }

  if (isTextOnly && isConfirmNo(cmd, { allowPrefix: isPendingSession(session) })) {
    if (isPendingSession(session)) {
      resetSession(key);
      await safeReply(
        message,
        "❌ Dibatalkan. Kirim makanan, foto, atau aktivitas baru, atau ketik *help*.",
        "cancelled",
      );
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
        "⚠️ Format ini belum didukung.\n\nKirim *foto makanan*, *tulis* makanannya, atau *catat aktivitas* (contoh: _lari 40 menit_). Ketik *help* untuk panduan.",
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
  if (isTextOnly && isConfirmYes(cmd, { allowPrefix: canConfirmSave(session) })) {
    if (canConfirmSave(session) || session.state.kind === "pending_activity_clarify") {
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

  const live = getSession(key);
  const intent = classifyTextIntent(cmd);

  if (live.state.kind === "pending_activity_clarify") {
    await handleActivityClarify(message, key, live, cmd);
    return;
  }

  if (live.state.kind === "pending_confirm_activity") {
    await handleActivityText(message, key, live, user, cmd, live.state.draft);
    return;
  }

  if (live.state.kind === "pending_confirm") {
    await handleFoodText(message, key, live, user, cmd, live.state.draft);
    return;
  }

  if (intent === "activity") {
    await handleActivityText(message, key, live, user, cmd);
    return;
  }

  await handleFoodText(
    message,
    key,
    getSession(key),
    user,
    message.body ?? "",
  );
}
