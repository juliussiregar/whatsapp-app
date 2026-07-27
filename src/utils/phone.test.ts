import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  digitsToSolidPacePhone,
  isDirectUserChat,
  toSolidPacePhone,
  waJidToSolidPacePhone,
} from "./phone.js";

describe("toSolidPacePhone", () => {
  it("normalizes 08 prefix", () => {
    assert.equal(toSolidPacePhone("081234567890"), "+6281234567890");
  });

  it("normalizes 62 prefix", () => {
    assert.equal(toSolidPacePhone("6281234567890"), "+6281234567890");
  });
});

describe("waJidToSolidPacePhone", () => {
  it("extracts from JID", () => {
    assert.equal(waJidToSolidPacePhone("6281234567890@c.us"), "+6281234567890");
  });
});

describe("digitsToSolidPacePhone", () => {
  it("delegates to toSolidPacePhone", () => {
    assert.equal(digitsToSolidPacePhone("81234567890"), "+6281234567890");
  });
});

describe("isDirectUserChat", () => {
  it("accepts private chats", () => {
    assert.equal(isDirectUserChat("6281234567890@c.us"), true);
    assert.equal(isDirectUserChat("1234567890@lid"), true);
  });

  it("rejects groups", () => {
    assert.equal(isDirectUserChat("123@g.us"), false);
  });
});
