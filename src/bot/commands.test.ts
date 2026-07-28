import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConfirmNo, isConfirmYes, isMenuCommand, normalizeCmd } from "./commands.js";

describe("normalizeCmd", () => {
  it("trims and lowercases", () => {
    assert.equal(normalizeCmd("  Ya  "), "ya");
  });

  it("strips trailing punctuation", () => {
    assert.equal(normalizeCmd("Ya."), "ya");
    assert.equal(normalizeCmd("oke!"), "oke");
  });
});

describe("isConfirmYes", () => {
  it("accepts common variants", () => {
    assert.equal(isConfirmYes("ya"), true);
    assert.equal(isConfirmYes("Ya."), true);
    assert.equal(isConfirmYes("iya dong", { allowPrefix: true }), true);
    assert.equal(isConfirmYes("oke kak", { allowPrefix: true }), true);
  });

  it("rejects unrelated text", () => {
    assert.equal(isConfirmYes("nasi ayam"), false);
    assert.equal(isConfirmYes("simpan nasi ayam"), false);
    assert.equal(isConfirmYes("catat makan siang"), false);
  });

  it("allows prefix match only when enabled", () => {
    assert.equal(isConfirmYes("simpan nasi ayam", { allowPrefix: true }), true);
  });
});

describe("isConfirmNo", () => {
  it("accepts cancel variants", () => {
    assert.equal(isConfirmNo("batal"), true);
    assert.equal(isConfirmNo("Batal."), true);
    assert.equal(isConfirmNo("gak jadi", { allowPrefix: true }), true);
  });

  it("rejects unrelated text without prefix mode", () => {
    assert.equal(isConfirmNo("gak jadi makan nasi"), false);
  });
});

describe("isMenuCommand", () => {
  it("accepts help aliases", () => {
    assert.equal(isMenuCommand("help"), true);
    assert.equal(isMenuCommand("Halo!"), true);
  });
});
