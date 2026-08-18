import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFoodSummary, formatPendingFoodAsk, formatSaved, foodDisplayNameFromItems, PHOTO_GUIDELINES } from "./formatFood.js";
import { parseFoodAnalysisItems } from "@/clients/solidpace.js";
import type { FoodDraft } from "./session.js";

const baseDraft: FoodDraft = {
  food_name: "Sate kambing, Lontong, Soto kuning",
  serving: 350,
  suffix_serving: "gr",
  calories: 700,
  fat: 35.5,
  protein: 39,
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
    },
    {
      food_name: "Lontong",
      serving: 200,
      suffix_serving: "gr",
      calories: 200,
      fat: 0.5,
      protein: 4,
    },
    {
      food_name: "Soto kuning",
      serving: 250,
      suffix_serving: "ml",
      calories: 150,
      fat: 10,
      protein: 5,
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
        confidence: 0.9,
      },
      { food_name: "" },
      null,
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.food_name, "Sate kambing");
    assert.equal(items[0]?.confidence, 0.9);
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
    assert.match(text, /Calorie: 700 kcal/);
    assert.match(text, /Protein: 39g/);
    assert.match(text, /Fat: 35\.5g/);
    assert.match(text, /• Sate kambing — 150 gr · 350 kcal/);
    assert.match(text, /• Soto kuning — 250 ml · 150 kcal/);
    assert.match(text, /Total: 350 gr \(campuran gr\/ml\)/);
    assert.match(text, /Powered by SOLIDPACE/);
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
    assert.match(text, /makanan baru/);
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
      total_actual_calories: 1847,
      total_actual_fatgrams: 62.1,
      total_actual_proteingrams: 88,
      sub_actual_id: 1,
      food_id: 10,
      created_at: "2026-08-13T08:00:00",
    });
    assert.match(text, /Julius Siregar/);
    assert.match(text, /Pisang · 105gr/);
    assert.match(text, /Total hari ini: \*1847 kcal\*/);
    assert.match(text, /P 88g/);
    assert.match(text, /F 62\.1g/);
  });
});
