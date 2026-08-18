import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFoodCorrectionText,
  looksLikeNewFoodEntry,
  leftoverAfterFoodCorrection,
  mergeFoodCorrection,
  parseQuickCorrection,
} from "./extractFood.js";
import type { FoodDraft } from "./session.js";

const baseDraft: FoodDraft = {
  food_name: "bubur",
  serving: 1,
  suffix_serving: "porsi",
  calories: 150,
  fat: 2,
  protein: 4,
  category_id: 2,
  category_name: "Lunch",
  source: "text",
};

describe("parseQuickCorrection", () => {
  it("parses kcal correction", () => {
    const patch = parseQuickCorrection("300 kcal");
    assert.equal(patch?.is_correction, true);
    assert.equal(patch?.calories, 300);
  });

  it("parses bare number as calories", () => {
    const patch = parseQuickCorrection("300");
    assert.equal(patch?.calories, 300);
  });

  it("parses tadi pagi as breakfast", () => {
    const patch = parseQuickCorrection("tadi pagi makan buburnya");
    assert.equal(patch?.category_hint, "breakfast");
  });

  it("parses serving", () => {
    const patch = parseQuickCorrection("250gr");
    assert.equal(patch?.serving, 250);
    assert.equal(patch?.suffix_serving, "gr");
  });
});

describe("looksLikeNewFoodEntry", () => {
  it("treats a different dish as a new log, not a name-only correction", () => {
    assert.equal(looksLikeNewFoodEntry("Ayam goreng dan nasi dengan jukut goreng"), true);
    assert.equal(looksLikeNewFoodEntry("Usus bakar"), true);
    assert.equal(looksLikeNewFoodEntry("Kulit goreng chili oil"), true);
    assert.equal(looksLikeNewFoodEntry("Bebek goreng bumbu hitam pakai nasi dan kol goreng"), true);
    assert.equal(looksLikeNewFoodEntry("Milk tea zero sugar"), true);
  });

  it("keeps short numeric/slot replies as corrections", () => {
    assert.equal(looksLikeNewFoodEntry("300 kcal"), false);
    assert.equal(looksLikeNewFoodEntry("250gr"), false);
    assert.equal(looksLikeNewFoodEntry("tadi pagi"), false);
    assert.equal(looksLikeNewFoodEntry("300"), false);
  });

  it("treats food name plus macros as a new log", () => {
    assert.equal(looksLikeNewFoodEntry("bubur ayam 250gr 320 kcal"), true);
  });
});

describe("isFoodCorrectionText", () => {
  it("accepts short numeric and slot corrections", () => {
    assert.equal(isFoodCorrectionText("300 kcal"), true);
    assert.equal(isFoodCorrectionText("250gr"), true);
    assert.equal(isFoodCorrectionText("tadi pagi"), true);
    assert.equal(isFoodCorrectionText("300"), true);
  });

  it("rejects a different dish so the bot can ask again", () => {
    assert.equal(isFoodCorrectionText("Ayam goreng dan nasi"), false);
    assert.equal(isFoodCorrectionText("Usus bakar"), false);
    assert.equal(isFoodCorrectionText("Milk tea zero sugar"), false);
    assert.equal(isFoodCorrectionText("Ini"), false);
  });
});

describe("leftoverAfterFoodCorrection", () => {
  it("strips kcal and serving tokens", () => {
    assert.equal(leftoverAfterFoodCorrection("300 kcal"), "");
    assert.match(leftoverAfterFoodCorrection("bubur ayam 250gr 320 kcal"), /bubur ayam/);
  });
});

describe("mergeFoodCorrection", () => {
  it("updates only provided fields", () => {
    const merged = mergeFoodCorrection(baseDraft, {
      is_correction: true,
      food_name: null,
      serving: null,
      suffix_serving: null,
      calories: 300,
      fat: null,
      protein: null,
      category_hint: "breakfast",
      notes: null,
    });
    assert.equal(merged.calories, 300);
    assert.equal(merged.food_name, "bubur");
    assert.equal(merged.protein, 4);
  });

  it("clears photo breakdown when totals change", () => {
    const photoDraft: FoodDraft = {
      ...baseDraft,
      source: "image",
      items: [
        {
          food_name: "Sate kambing",
          serving: 150,
          suffix_serving: "gr",
          calories: 350,
          fat: 25,
          protein: 30,
        },
      ],
    };
    const merged = mergeFoodCorrection(photoDraft, {
      is_correction: true,
      food_name: null,
      serving: null,
      suffix_serving: null,
      calories: 300,
      fat: null,
      protein: null,
      category_hint: null,
      notes: null,
    });
    assert.equal(merged.calories, 300);
    assert.equal(merged.items, undefined);
  });
});
