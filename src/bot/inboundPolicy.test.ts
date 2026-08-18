import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmIdleKind, pendingItemLabel, pickQueuedReplace } from "./inboundPolicy.js";
import type { FoodDraft, Session } from "./session.js";

const foodDraft: FoodDraft = {
  food_name: "Nasi ayam",
  serving: 300,
  suffix_serving: "gr",
  calories: 450,
  fat: 10,
  protein: 20,
  carbo: 55,
  category_id: 4,
  category_name: "Dinner",
  source: "image",
};

describe("inboundPolicy", () => {
  it("labels pending food, activity, and clarify", () => {
    const food: Session = {
      state: { kind: "pending_confirm", draft: foodDraft },
      updatedAt: Date.now(),
    };
    assert.equal(pendingItemLabel(food), "Nasi ayam");

    const activity: Session = {
      state: {
        kind: "pending_confirm_activity",
        draft: {
          activity_type: "run",
          session_name: "Lari via WA",
          session_date: "2026-08-13T06:00:00",
          duration: 2400,
        },
      },
      updatedAt: Date.now(),
    };
    assert.equal(pendingItemLabel(activity), "Lari");

    const clarify: Session = {
      state: {
        kind: "pending_activity_clarify",
        partial: { activity_type: "bike" },
        needs: ["duration"],
      },
      updatedAt: Date.now(),
    };
    assert.equal(pendingItemLabel(clarify), "Sepeda");
    assert.equal(pendingItemLabel({ state: { kind: "idle" }, updatedAt: Date.now() }), null);
  });

  it("prefers queued photo draft over text when applying ganti", () => {
    assert.equal(pickQueuedReplace({}).kind, "none");
    assert.deepEqual(pickQueuedReplace({ text: "nasi goreng" }), {
      kind: "text",
      text: "nasi goreng",
    });
    assert.equal(pickQueuedReplace({ food: foodDraft, text: "ignore" }).kind, "food");
  });

  it("routes idle confirm to expired copy when the pending TTL elapsed", () => {
    assert.equal(confirmIdleKind(true), "expired");
    assert.equal(confirmIdleKind(false), "idle");
  });
});
