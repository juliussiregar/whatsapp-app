import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedFoodImageMime } from "./media.js";

describe("isAllowedFoodImageMime", () => {
  it("allows common formats", () => {
    assert.equal(isAllowedFoodImageMime("image/jpeg"), true);
    assert.equal(isAllowedFoodImageMime("image/png"), true);
    assert.equal(isAllowedFoodImageMime("image/webp"), true);
  });

  it("rejects heic", () => {
    assert.equal(isAllowedFoodImageMime("image/heic"), false);
  });
});
