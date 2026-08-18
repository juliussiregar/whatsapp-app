import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapApiError } from "./apiError.js";
import { SolidPaceApiError } from "@/clients/solidpace.js";

describe("mapApiError", () => {
  it("maps duration greater-than-0 to athlete copy", () => {
    const err = new SolidPaceApiError(
      422,
      "duration: Input should be greater than 0",
      { detail: [{ loc: ["body", "duration"], msg: "Input should be greater than 0" }] },
    );
    assert.match(mapApiError(err), /Durasi latihan harus lebih dari 0/);
  });

  it("does not treat a missing duration as greater-than-0", () => {
    const err = new SolidPaceApiError(422, "duration: Field required");
    const text = mapApiError(err);
    assert.match(text, /Data tidak valid/);
    assert.match(text, /Field required/);
    assert.doesNotMatch(text, /harus lebih dari 0/);
  });

  it("does not treat other greater-than-0 fields as duration", () => {
    const err = new SolidPaceApiError(422, "distance: Input should be greater than 0");
    const text = mapApiError(err);
    assert.match(text, /Data tidak valid/);
    assert.doesNotMatch(text, /Durasi latihan/);
  });

  it("does not dump raw technical errors to the athlete", () => {
    const text = mapApiError(new Error("OPENAI_API_KEY belum dikonfigurasi di server bot"));
    assert.match(text, /gangguan/i);
    assert.doesNotMatch(text, /OPENAI_API_KEY/);
  });
});
