import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ageSessionForTests,
  getSession,
  queueFoodDraft,
  queueIncomingText,
  rememberLastSaved,
  resetSession,
  resetSessionsForTests,
  SESSION_TTL_MS,
  takeExpiredPending,
  takeQueuedReplace,
  takeQueuedText,
} from "./session.js";
import type { FoodDraft } from "./session.js";

const foodDraft: FoodDraft = {
  food_name: "Bubur",
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

describe("session queue", () => {
  it("stores and consumes queued replacement text", () => {
    resetSessionsForTests();
    const key = "test-user";
    getSession(key).state = { kind: "idle" };
    queueIncomingText(key, " nasi goreng 200gr ");
    assert.equal(takeQueuedText(key), "nasi goreng 200gr");
    assert.equal(takeQueuedText(key), undefined);
  });

  it("reset keeps user cache and drops the queue", () => {
    resetSessionsForTests();
    const key = "test-user-2";
    const session = getSession(key);
    session.userId = 9;
    session.fullName = "Ada";
    queueIncomingText(key, "bubur");
    resetSession(key);
    const next = getSession(key);
    assert.equal(next.userId, 9);
    assert.equal(next.fullName, "Ada");
    assert.equal(next.state.kind, "idle");
    assert.equal(next.queuedText, undefined);
  });

  it("photo queue wins over text and is consumed by ganti", () => {
    resetSessionsForTests();
    const key = "test-photo-queue";
    queueIncomingText(key, "nasi goreng");
    queueFoodDraft(key, foodDraft);
    const queued = takeQueuedReplace(key);
    assert.equal(queued.text, undefined);
    assert.equal(queued.food?.food_name, "Bubur");
    assert.equal(takeQueuedReplace(key).food, undefined);
  });

  it("marks expired pending instead of silently dropping it", () => {
    resetSessionsForTests();
    const key = "test-ttl";
    const session = getSession(key);
    session.state = { kind: "pending_confirm", draft: foodDraft };
    session.userId = 63;
    session.updatedAt = Date.now();
    ageSessionForTests(key, SESSION_TTL_MS + 50);
    const next = getSession(key);
    assert.equal(next.state.kind, "idle");
    assert.equal(next.expiredPending, true);
    assert.equal(next.userId, 63);
    assert.equal(takeExpiredPending(key), true);
    assert.equal(takeExpiredPending(key), false);
  });

  it("keeps lastSaved across reset", () => {
    resetSessionsForTests();
    const key = "test-last-saved";
    rememberLastSaved(key, { kind: "food", label: "Bubur", savedAt: Date.now() });
    resetSession(key);
    assert.equal(getSession(key).lastSaved?.label, "Bubur");
  });
});
