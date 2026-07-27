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
    assert.equal(isConfirmYes("iya dong"), true);
    assert.equal(isConfirmYes("oke kak"), true);
  });

  it("rejects unrelated text", () => {
    assert.equal(isConfirmYes("nasi ayam"), false);
  });
});

describe("isConfirmNo", () => {
  it("accepts cancel variants", () => {
    assert.equal(isConfirmNo("batal"), true);
    assert.equal(isConfirmNo("Batal."), true);
    assert.equal(isConfirmNo("gak jadi"), true);
  });
});

describe("isMenuCommand", () => {
  it("accepts help aliases", () => {
    assert.equal(isMenuCommand("help"), true);
    assert.equal(isMenuCommand("Halo!"), true);
  });
});
