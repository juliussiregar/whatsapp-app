import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyTextIntent, hasActivitySignal, shouldSwitchToFood } from "./intent.js";

describe("classifyTextIntent", () => {
  it("detects activity from sport + duration", () => {
    assert.equal(classifyTextIntent("Lari 5km, 40 menit, tanggal 17 Juli"), "activity");
    assert.equal(classifyTextIntent("catat lari 40 menit"), "activity");
    assert.equal(classifyTextIntent("yoga 30 menit"), "activity");
  });

  it("detects food logs", () => {
    assert.equal(classifyTextIntent("nasi goreng 250gr siang"), "food");
    assert.equal(classifyTextIntent("saya habis makan ayam"), "food");
  });

  it("prefers food when both signals exist", () => {
    assert.equal(classifyTextIntent("habis lari lalu makan nasi ayam"), "food");
  });

  it("returns unknown for greetings", () => {
    assert.equal(classifyTextIntent("halo"), "unknown");
  });
});

describe("shouldSwitchToFood", () => {
  it("switches from pending activity to a food log", () => {
    assert.equal(shouldSwitchToFood("nasi goreng 300 kcal"), true);
    assert.equal(shouldSwitchToFood("saya habis makan ayam"), true);
  });

  it("keeps activity calorie corrections on the activity flow", () => {
    assert.equal(shouldSwitchToFood("420 kcal"), false);
    assert.equal(shouldSwitchToFood("bakar 480 kcal"), false);
    assert.equal(shouldSwitchToFood("50 menit"), false);
  });
});

describe("hasActivitySignal", () => {
  it("is true for duration + distance even without sport word", () => {
    assert.equal(hasActivitySignal("5 km 40 menit"), true);
  });

  it("is false for food-only text", () => {
    assert.equal(hasActivitySignal("nasi goreng 250gr"), false);
  });
});
