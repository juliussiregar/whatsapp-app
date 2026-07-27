import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMessageSerializedId } from "./downloadMedia.js";
import type { Message } from "whatsapp-web.js";

function fakeMessage(id: unknown, from = "628111@c.us"): Message {
  return { id, from } as Message;
}

describe("resolveMessageSerializedId", () => {
  it("uses _serialized when present", () => {
    const id = resolveMessageSerializedId(
      fakeMessage({ _serialized: "false_628111@c.us_ABC", fromMe: false, remote: "628111@c.us", id: "ABC" }),
    );
    assert.equal(id, "false_628111@c.us_ABC");
  });

  it("reconstructs from parts when _serialized missing", () => {
    const id = resolveMessageSerializedId(
      fakeMessage({ fromMe: false, remote: "123@lid", id: "3EB0XYZ" }),
    );
    assert.equal(id, "false_123@lid_3EB0XYZ");
  });

  it("uses message.from when remote object missing serialized", () => {
    const id = resolveMessageSerializedId(
      fakeMessage({ fromMe: false, remote: {}, id: "KEY1" }, "999@lid"),
    );
    assert.equal(id, "false_999@lid_KEY1");
  });

  it("returns null when insufficient data", () => {
    assert.equal(resolveMessageSerializedId(fakeMessage(undefined)), null);
  });
});
