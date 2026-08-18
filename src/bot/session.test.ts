import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getSession,
  queueIncomingText,
  resetSession,
  resetSessionsForTests,
  takeQueuedText,
} from "./session.js";

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
});
