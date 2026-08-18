import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFoodSummary, formatPendingFoodAsk, formatSaved, formatFoodUnclear, formatHelp, formatFoodNeedMacros, formatPendingFoodReplace, formatPendingPhotoReplace, formatExpired, formatUndoSaved, formatUndoIdle, foodDisplayNameFromItems, PHOTO_GUIDELINES, formatUnclear, formatConfirmIdle, formatAiReadFail } from "./formatFood.js";
import { parseFoodAnalysisItems } from "@/clients/solidpace.js";
import type { FoodDraft } from "./session.js";

const baseDraft: FoodDraft = {
  food_name: "Sate kambing, Lontong, Soto kuning",
  serving: 350,
  suffix_serving: "gr",
  calories: 700,
  fat: 35.5,
  protein: 39,
  carbo: 56.1,
  category_id: 4,
  category_name: "Snack",
  source: "image",
  disclaimer: "Estimasi nutrisi dari AI berdasarkan analisis visual.",
  items: [
    {
      food_name: "Sate kambing",
      serving: 150,
      suffix_serving: "gr",
      calories: 350,
      fat: 25,
      protein: 30,
      carbo: 1.3,
    },
    {
      food_name: "Lontong",
      serving: 200,
      suffix_serving: "gr",
      calories: 200,
      fat: 0.5,
      protein: 4,
      carbo: 44.9,
    },
    {
      food_name: "Soto kuning",
      serving: 250,
      suffix_serving: "ml",
      calories: 150,
      fat: 10,
      protein: 5,
      carbo: 10,
    },
  ],
};

describe("parseFoodAnalysisItems", () => {
  it("parses valid API items and skips invalid entries", () => {
    const items = parseFoodAnalysisItems([
      {
        food_name: "Sate kambing",
        serving: 150,
        suffix_serving: "gr",
        calories: 350,
        fat: 25,
        protein: 30,
        carbo: 1.3,
        confidence: 0.9,
      },
      { food_name: "" },
      null,
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.food_name, "Sate kambing");
    assert.equal(items[0]?.confidence, 0.9);
    assert.equal(items[0]?.carbo, 1.3);
  });
});

describe("foodDisplayNameFromItems", () => {
  it("joins item names when items exist", () => {
    assert.equal(
      foodDisplayNameFromItems(baseDraft.items, "Sate kambing"),
      "Sate kambing, Lontong, Soto kuning",
    );
  });

  it("falls back when items empty", () => {
    assert.equal(foodDisplayNameFromItems(undefined, "Nasi ayam"), "Nasi ayam");
  });
});

describe("PHOTO_GUIDELINES", () => {
  it("emphasizes top-down angle and full visibility", () => {
    assert.match(PHOTO_GUIDELINES, /dari atas/i);
    assert.match(PHOTO_GUIDELINES, /semua makanan terlihat/i);
  });
});

describe("formatFoodSummary", () => {
  it("includes CTA, labels, breakdown, and watermark", () => {
    const text = formatFoodSummary(baseDraft);
    assert.match(text, /\*BALAS YA UNTUK MENYIMPAN\*/);
    assert.match(text, /Kalori: 700 kcal/);
    assert.match(text, /Protein: 39g/);
    assert.match(text, /Lemak: 35\.5g/);
    assert.match(text, /Karbo: 56\.1g/);
    assert.match(text, /• Sate kambing — 150 gr · 350 kcal · 30P 25L 1\.3K/);
    assert.match(text, /• Soto kuning — 250 ml · 150 kcal/);
    assert.match(text, /Total: 350 gr \(campuran gr\/ml\)/);
    assert.match(text, /Powered by SOLIDPACE/);
  });
});

describe("formatHelp", () => {
  it("lists food, photo, and activity features", () => {
    const text = formatHelp();
    assert.match(text, /3 fungsi/);
    assert.match(text, /makanan \/ minuman/i);
    assert.match(text, /foto/);
    assert.match(text, /aktivitas latihan/i);
    assert.match(text, /ganti/);
    assert.match(text, /ya/);
    assert.match(text, /batal/);
    assert.match(text, /pesan suara/);
    assert.match(text, /undo/);
  });

  it("keeps a pending reminder without resetting copy", () => {
    const text = formatHelp("Nasi ayam");
    assert.match(text, /Nasi ayam/);
    assert.match(text, /masih ada ringkasan/i);
    assert.match(text, /3 fungsi/);
  });
});

describe("formatFoodNeedMacros", () => {
  it("asks for numbers without inventing them", () => {
    const text = formatFoodNeedMacros("Nasi goreng");
    assert.match(text, /Nasi goreng/);
    assert.match(text, /300 kcal/);
  });
});

describe("formatPendingFoodReplace", () => {
  it("shows the incoming preview", () => {
    const text = formatPendingFoodReplace(baseDraft, "ayam bakar 200gr");
    assert.match(text, /ganti/);
    assert.match(text, /ayam bakar 200gr/);
  });
});

describe("formatFoodUnclear", () => {
  it("gives short examples instead of the full menu", () => {
    const text = formatFoodUnclear();
    assert.match(text, /Belum kebaca/);
    assert.match(text, /Nasi ayam 300gr/);
    assert.match(text, /karbo 45/);
  });
});

describe("formatUnclear / formatConfirmIdle / formatAiReadFail", () => {
  it("lists food, photo, and activity without dumping the full welcome", () => {
    const text = formatUnclear();
    assert.match(text, /Belum kebaca/);
    assert.match(text, /Nasi ayam 300gr/);
    assert.match(text, /Lari 40 menit/);
    assert.match(text, /help/);
    assert.doesNotMatch(text, /3 fungsi/);
  });

  it("keeps confirm-idle short", () => {
    const text = formatConfirmIdle();
    assert.match(text, /Tidak ada ringkasan/);
    assert.doesNotMatch(text, /3 fungsi/);
  });

  it("uses athlete copy when AI cannot read food or activity", () => {
    const food = formatAiReadFail("food");
    assert.match(food, /AI sedang sibuk/);
    assert.match(food, /nasi goreng/);
    assert.doesNotMatch(food, /OPENAI/);
    const activity = formatAiReadFail("activity");
    assert.match(activity, /AI sedang sibuk/);
    assert.match(activity, /lari 40 menit/);
    assert.doesNotMatch(activity, /OPENAI/);
  });
});

describe("formatExpired / undo / pending photo replace", () => {
  it("explains TTL expiry without dumping help", () => {
    const text = formatExpired();
    assert.match(text, /kedaluwarsa/);
    assert.match(text, /30 menit/);
    assert.doesNotMatch(text, /3 fungsi/);
  });

  it("points undo to the app", () => {
    assert.match(formatUndoSaved("Nasi ayam"), /Nasi ayam/);
    assert.match(formatUndoSaved("Nasi ayam"), /aplikasi SolidPace/);
    assert.match(formatUndoIdle(), /Tidak ada catatan baru/);
  });

  it("asks ganti before applying a photo over pending", () => {
    const text = formatPendingPhotoReplace("Lari", baseDraft);
    assert.match(text, /Lari/);
    assert.match(text, /Sate kambing/);
    assert.match(text, /ganti/);
  });
});

describe("formatPendingFoodAsk", () => {
  it("asks to confirm, cancel, or send a short correction", () => {
    const text = formatPendingFoodAsk(baseDraft);
    assert.match(text, /belum disimpan/i);
    assert.match(text, /Sate kambing/);
    assert.match(text, /\*ya\*/);
    assert.match(text, /\*batal\*/);
    assert.match(text, /300 kcal/);
    assert.match(text, /ganti/);
  });
});

describe("formatSaved", () => {
  it("shows daily totals from the API when present", () => {
    const text = formatSaved(baseDraft, "Julius Siregar", {
      user_id: 63,
      actual_id: 89,
      category_id: 4,
      food_name: "Pisang",
      serving: 105,
      suffix_serving: "gr",
      calories: 98,
      fat: 0.3,
      protein: 1.2,
      carbo: 22,
      total_actual_calories: 1847,
      total_actual_fatgrams: 62.1,
      total_actual_proteingrams: 88,
      total_actual_carbograms: 310,
      sub_actual_id: 1,
      food_id: 10,
      created_at: "2026-08-13T08:00:00",
    });
    assert.match(text, /Julius Siregar/);
    assert.match(text, /Pisang · 105gr/);
    assert.match(text, /Karbo 22g/);
    assert.match(text, /Lemak 0\.3g/);
    assert.match(text, /Total hari ini: \*1847 kcal\*/);
    assert.match(text, /P 88g/);
    assert.match(text, /F 62\.1g/);
    assert.match(text, /C 310g/);
  });
});
