import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPhoneNumber,
  buildPhoneLookupIds,
  sendCandidateIds,
  pickParticipantApiId,
} from "./phone.service.js";

describe("formatPhoneNumber", () => {
  it("normalizes 08xx to 62", () => {
    assert.equal(formatPhoneNumber("08112152555"), "628112152555");
  });

  it("keeps 62 prefix", () => {
    assert.equal(formatPhoneNumber("+62 811-215-2555"), "628112152555");
  });

  it("strips non-digits", () => {
    assert.equal(formatPhoneNumber("62811 215 255"), "62811215255");
  });
});

describe("sendCandidateIds", () => {
  it("prefers @c.us before @lid for delivery", () => {
    const ids = sendCandidateIds("999@lid", [
      "999@lid",
      "62811@c.us",
      "62811@s.whatsapp.net",
    ]);
    assert.equal(ids[0], "62811@c.us");
    assert.ok(ids.includes("999@lid"));
    assert.ok(ids.indexOf("62811@c.us") < ids.indexOf("999@lid"));
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("looksLikeLidUser", () => {
  it("flags long non-62 ids", async () => {
    const { looksLikeLidUser } = await import("./phone.service.js");
    assert.equal(looksLikeLidUser("274083405140014"), true);
    assert.equal(looksLikeLidUser("628112152555"), false);
  });
});

describe("buildPhoneLookupIds / pickParticipantApiId", () => {
  it("includes c.us and s.whatsapp.net", () => {
    const ids = buildPhoneLookupIds("62811", "999@lid");
    assert.ok(ids.includes("62811@c.us"));
    assert.ok(ids.includes("62811@s.whatsapp.net"));
    assert.ok(ids.includes("999@lid"));
  });

  it("picks phone id over lid", () => {
    assert.equal(
      pickParticipantApiId("999@lid", ["999@lid", "62811@c.us"]),
      "62811@c.us",
    );
  });
});
