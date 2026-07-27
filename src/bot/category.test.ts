import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mealSlotFromWib, pickCategory } from "./category.js";

const categories = [
  { category_id: 1, name: "Breakfast" },
  { category_id: 2, name: "Lunch" },
  { category_id: 3, name: "Dinner" },
  { category_id: 4, name: "Snack" },
];

describe("mealSlotFromWib", () => {
  it("maps morning to breakfast", () => {
    const slot = mealSlotFromWib(new Date("2026-07-01T02:00:00.000Z")); // 09:00 WIB
    assert.equal(slot, "breakfast");
  });

  it("maps afternoon to snack window", () => {
    const slot = mealSlotFromWib(new Date("2026-07-01T08:30:00.000Z")); // 15:30 WIB
    assert.equal(slot, "snack");
  });
});

describe("pickCategory", () => {
  it("prefers hint over WIB", () => {
    const picked = pickCategory(categories, "makan malam");
    assert.equal(picked?.category_id, 3);
  });

  it("matches snack category", () => {
    const picked = pickCategory(categories, "cemilan");
    assert.equal(picked?.category_id, 4);
  });
});
