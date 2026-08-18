import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConfirmNo, isConfirmYes, isMenuCommand, isReplaceCommand, normalizeCmd } from "./commands.js";

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

  it("allows prefix match only for short acknowledgements", () => {
    assert.equal(isConfirmYes("iya dong", { allowPrefix: true }), true);
    assert.equal(isConfirmYes("simpan nasi ayam", { allowPrefix: true }), false);
    assert.equal(isConfirmYes("catat lari 40 menit", { allowPrefix: true }), false);
    assert.equal(isConfirmYes("catat"), true);
    assert.equal(isConfirmYes("simpan"), true);
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
    assert.equal(isMenuCommand("help dong"), true);
  });

  it("does not treat time-of-day activity logs as menu", () => {
    assert.equal(isMenuCommand("malam tadi lari 40 menit"), false);
    assert.equal(isMenuCommand("pagi tadi gowes 1 jam"), false);
    assert.equal(isMenuCommand("pagi"), true);
  });
});

describe("isReplaceCommand", () => {
  it("accepts ganti exact", () => {
    assert.equal(isReplaceCommand("ganti"), true);
    assert.equal(isReplaceCommand("Ganti."), true);
    assert.equal(isReplaceCommand("ganti makanan"), false);
  });
});
