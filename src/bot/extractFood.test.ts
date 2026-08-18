import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateCaloriesFromMacros,
  estimateCarboGrams,
  heuristicExtracted,
  isFoodCorrectionText,
  isSoftFoodCorrection,
  looksLikeNewFoodEntry,
  leftoverAfterFoodCorrection,
  mergeExtractedFood,
  mergeFoodCorrection,
  parseQuickCorrection,
  parseStatedFoodFields,
  reconcileMacros,
} from "./extractFood.js";
import type { FoodDraft } from "./session.js";

const baseDraft: FoodDraft = {
  food_name: "bubur",
  serving: 1,
  suffix_serving: "porsi",
  calories: 150,
  fat: 2,
  protein: 4,
  carbo: 29,
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

  it("parses karbo correction", () => {
    const patch = parseQuickCorrection("karbo 28");
    assert.equal(patch?.carbo, 28);
    assert.equal(patch?.calories, null);
  });

  it("parses karbo with gram unit and number-first forms", () => {
    assert.equal(parseQuickCorrection("karbo 28g")?.carbo, 28);
    assert.equal(parseQuickCorrection("karbo 28g")?.serving, null);
    assert.equal(parseQuickCorrection("karbo nya 40")?.carbo, 40);
    assert.equal(parseQuickCorrection("28 gram karbo")?.carbo, 28);
    assert.equal(parseQuickCorrection("carbs 30")?.carbo, 30);
    assert.equal(parseQuickCorrection("kh 25")?.carbo, 25);
  });

  it("parses kalori before the number", () => {
    assert.equal(parseQuickCorrection("kalori 300")?.calories, 300);
    assert.equal(parseQuickCorrection("kalori jadi 280")?.calories, 280);
  });

  it("parses serving in gram and household units", () => {
    assert.equal(parseQuickCorrection("250 gram")?.serving, 250);
    assert.equal(parseQuickCorrection("250 gram")?.suffix_serving, "gr");
    assert.equal(parseQuickCorrection("1 gelas")?.serving, 1);
    assert.equal(parseQuickCorrection("1 gelas")?.suffix_serving, "gelas");
    assert.equal(parseQuickCorrection("setengah piring")?.serving, 0.5);
    assert.equal(parseQuickCorrection("setengah piring")?.suffix_serving, "piring");
  });

  it("parses shorthand p/f/c macros", () => {
    const patch = parseQuickCorrection("20p 10f 28c");
    assert.equal(patch?.protein, 20);
    assert.equal(patch?.fat, 10);
    assert.equal(patch?.carbo, 28);
  });

  it("parses carbo with protein in one message", () => {
    const patch = parseQuickCorrection("protein 20 karbo 28");
    assert.equal(patch?.protein, 20);
    assert.equal(patch?.carbo, 28);
  });

  it("parses protein and fat together", () => {
    const patch = parseQuickCorrection("protein 20 lemak 8");
    assert.equal(patch?.protein, 20);
    assert.equal(patch?.fat, 8);
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
    assert.equal(looksLikeNewFoodEntry("karbo 28"), false);
    assert.equal(looksLikeNewFoodEntry("karbo 28g"), false);
    assert.equal(looksLikeNewFoodEntry("protein 20 lemak 8"), false);
    assert.equal(looksLikeNewFoodEntry("kalori jadi 280"), false);
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
    assert.equal(isFoodCorrectionText("karbo 28"), true);
    assert.equal(isFoodCorrectionText("karbo 28g"), true);
    assert.equal(isFoodCorrectionText("protein 20 lemak 8"), true);
    assert.equal(isFoodCorrectionText("20p 10f 28c"), true);
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
    assert.equal(leftoverAfterFoodCorrection("karbo 28"), "");
    assert.equal(leftoverAfterFoodCorrection("karbo 28g"), "");
    assert.equal(leftoverAfterFoodCorrection("protein 20 lemak 8"), "");
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
      carbo: null,
      category_hint: "breakfast",
      notes: null,
    });
    assert.equal(merged.calories, 300);
    assert.equal(merged.food_name, "bubur");
    assert.equal(merged.protein, 4);
    assert.equal(merged.carbo, estimateCarboGrams(300, 4, 2));
  });

  it("uses explicit karbo when provided", () => {
    const merged = mergeFoodCorrection(baseDraft, {
      is_correction: true,
      food_name: null,
      serving: null,
      suffix_serving: null,
      calories: null,
      fat: null,
      protein: null,
      carbo: 28,
      category_hint: null,
      notes: null,
    });
    assert.equal(merged.carbo, 28);
    assert.equal(merged.calories, estimateCaloriesFromMacros(4, 2, 28));
    assert.equal(merged.protein, 4);
    assert.equal(merged.caloriesAdjusted, true);
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
          carbo: 5,
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
      carbo: null,
      category_hint: null,
      notes: null,
    });
    assert.equal(merged.calories, 300);
    assert.equal(merged.items, undefined);
  });
});

describe("estimateCarboGrams", () => {
  it("matches BE fallback formula", () => {
    assert.equal(estimateCarboGrams(130, 2.7, 0.3), 29.1);
    assert.equal(estimateCarboGrams(100, 0, 0), 25);
    assert.equal(estimateCarboGrams(0, 10, 10), 0);
  });
});

describe("parseStatedFoodFields", () => {
  it("reads a full Indonesian food line", () => {
    const stated = parseStatedFoodFields("Nasi putih 200gr, protein 4 karbo 45 makan malam");
    assert.equal(stated.serving, 200);
    assert.equal(stated.suffix_serving, "gr");
    assert.equal(stated.protein, 4);
    assert.equal(stated.carbo, 45);
    assert.equal(stated.category_hint, "dinner");
  });
});

describe("heuristicExtracted", () => {
  it("extracts a dish with stated macros without calling AI", () => {
    const extracted = heuristicExtracted("nasi putih 200gr protein 4 karbo 45");
    assert.equal(extracted?.is_food_log, true);
    assert.match(extracted?.food_name ?? "", /nasi putih/i);
    assert.equal(extracted?.serving, 200);
    assert.equal(extracted?.protein, 4);
    assert.equal(extracted?.carbo, 45);
    assert.equal(extracted?.calories, estimateCaloriesFromMacros(4, 0, 45));
  });

  it("does not invent plate defaults when macros are missing", () => {
    const extracted = heuristicExtracted("nasi goreng");
    assert.equal(extracted?.is_food_log, true);
    assert.equal(extracted?.calories, null);
    assert.equal(extracted?.carbo, null);
  });

  it("does not treat a greeting as food", () => {
    assert.equal(heuristicExtracted("halo kak"), null);
  });
});

describe("mergeExtractedFood", () => {
  it("prefers user-stated macros over AI estimates", () => {
    const merged = mergeExtractedFood(
      {
        is_food_log: true,
        food_name: "Nasi putih",
        serving: 100,
        suffix_serving: "gr",
        calories: 400,
        fat: 10,
        protein: 20,
        carbo: 50,
        category_hint: null,
        notes: null,
      },
      "nasi putih 200gr karbo 45 protein 4",
    );
    assert.equal(merged.food_name, "Nasi putih");
    assert.equal(merged.serving, 200);
    assert.equal(merged.protein, 4);
    assert.equal(merged.carbo, 45);
    assert.equal(merged.calories, estimateCaloriesFromMacros(4, 10, 45));
  });
});

describe("reconcileMacros", () => {
  it("fills carbo from calories when user did not state carbo", () => {
    const macros = reconcileMacros(
      { calories: 130, protein: 2.7, fat: 0.3, carbo: 99 },
      { calories: 130, protein: 2.7, fat: 0.3, carbo: null },
    );
    assert.equal(macros.carbo, 29.1);
  });
});

describe("isSoftFoodCorrection", () => {
  it("accepts natural phrasing without a full number parse", () => {
    assert.equal(isSoftFoodCorrection("kalori kurang dikit"), true);
    assert.equal(isSoftFoodCorrection("Ayam goreng dan nasi"), false);
    assert.equal(isSoftFoodCorrection("karbo 28"), false);
  });
});
