import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { beginSave, endSave, isSaving, resetSaveLocksForTests } from "./saveLock.js";

describe("saveLock", () => {
  it("blocks a second save until the first ends", () => {
    resetSaveLocksForTests();
    assert.equal(beginSave("u1"), true);
    assert.equal(isSaving("u1"), true);
    assert.equal(beginSave("u1"), false);
    assert.equal(beginSave("u2"), true);
    endSave("u1");
    assert.equal(isSaving("u1"), false);
    assert.equal(beginSave("u1"), true);
    resetSaveLocksForTests();
  });
});
