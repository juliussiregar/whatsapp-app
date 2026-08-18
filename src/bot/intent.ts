export type TextIntent = "food" | "activity" | "unknown";

const FOOD_RE =
  /\b(makan|minum|sarapan|ngemil|cemilan|camilan|nasi|ayam|bubur|roti|susu|kopi|teh|snack|lauk|porsi|kkal|kcal|kalori|goreng|soto|sate|bakso|mie|indomie|protein\s+shake|pisang|donat|tempe|tahu|telur|ikan|udang|yogurt|oatmeal|smoothie|burger|pizza|pasta|salad|sandwich|bakwan|pempek|siomay|lontong|rendang|pecel|gado|jus|boba|latte|omelet|croissant|pancake|cereal|steak|sop|gudeg|ketoprak|matcha|buah|sayur|kentang|jagung|oatmeal)\b/i;

/** Nama/aksi makanan — tanpa kkal, supaya "400 kcal" saat konfirmasi aktivitas tetap koreksi latihan. */
const STRONG_FOOD_RE =
  /\b(makan|minum|sarapan|ngemil|cemilan|camilan|nasi|ayam|bubur|roti|susu|kopi|teh|snack|lauk|porsi|goreng|soto|sate|bakso|mie|indomie|protein\s+shake|pisang|donat|tempe|tahu|telur|ikan|udang|yogurt|oatmeal|smoothie|burger|pizza|pasta|salad|sandwich|bakwan|pempek|siomay|lontong|rendang|pecel|gado|jus|boba|latte|omelet|croissant|pancake|cereal|steak|sop|gudeg|ketoprak|matcha|buah|sayur|kentang|jagung)\b/i;

const ACTIVITY_TYPE_RE =
  /\b(lari|jogging|joging|running|run|sepeda|bersepeda|gowes|cycling|bike|renang|berenang|swim|swimming|gym|beban|strength|workout|latihan|olahraga|jalan\s+kaki|jalan\s+pagi|walk|walking|hiking|hike|yoga|pilates|hiit|cardio|rowing|dayung|boxing|tinju|zumba|triathlon|bersepeda)\b/i;

const ACTIVITY_VERB_RE =
  /\b(catat|log)\s+(aktivitas|latihan|sesi|olahraga|lari|sepeda|renang)\b/i;

const DURATION_RE = /\b\d+(?:[.,]\d+)?\s*(?:jam|menit|mnt|min)\b/i;
const DISTANCE_RE = /\b\d+(?:[.,]\d+)?\s*(?:km|kilometer)\b/i;

export function hasActivitySignal(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (ACTIVITY_VERB_RE.test(t) || ACTIVITY_TYPE_RE.test(t)) return true;
  return DURATION_RE.test(t) && DISTANCE_RE.test(t);
}

export function hasFoodSignal(text: string): boolean {
  return FOOD_RE.test(text.trim());
}

export function hasStrongFoodSignal(text: string): boolean {
  return STRONG_FOOD_RE.test(text.trim());
}

/** Laporan makanan baru yang harus mengganti konfirmasi aktivitas. */
export function shouldSwitchToFood(text: string): boolean {
  if (!hasStrongFoodSignal(text)) return false;
  if (!hasActivitySignal(text)) return true;
  return /\b(makan|minum|sarapan|ngemil)\b/i.test(text);
}

export function classifyTextIntent(text: string): TextIntent {
  const food = hasFoodSignal(text);
  const activity = hasActivitySignal(text);
  if (food && !activity) return "food";
  if (activity && !food) return "activity";
  if (food && activity) {
    if (/\b(makan|minum|sarapan|ngemil)\b/i.test(text)) return "food";
    return "activity";
  }
  return "unknown";
}
