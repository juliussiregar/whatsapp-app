import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLoadOverlap, parseSolidPaceErrorDetail } from "./solidpace.js";

describe("parseSolidPaceErrorDetail", () => {
  it("reads a string detail", () => {
    assert.equal(
      parseSolidPaceErrorDetail({
        detail: "Pengguna dengan nomor telepon ini tidak ditemukan.",
      }),
      "Pengguna dengan nomor telepon ini tidak ditemukan.",
    );
  });

  it("joins pydantic 422 array details", () => {
    assert.equal(
      parseSolidPaceErrorDetail({
        detail: [
          { type: "missing", loc: ["body", "duration"], msg: "Field required" },
          { type: "greater_than", loc: ["body", "duration"], msg: "Input should be greater than 0" },
        ],
      }),
      "duration: Field required; duration: Input should be greater than 0",
    );
  });

  it("reads category and image messages", () => {
    assert.equal(
      parseSolidPaceErrorDetail({ detail: "Category is not Found" }),
      "Category is not Found",
    );
    assert.equal(
      parseSolidPaceErrorDetail({
        detail: "Format gambar ditolak OpenAI. Coba unggah JPEG/PNG/WebP asli.",
      }),
      "Format gambar ditolak OpenAI. Coba unggah JPEG/PNG/WebP asli.",
    );
  });
});

describe("parseLoadOverlap", () => {
  it("returns null when overlap is omitted", () => {
    assert.equal(parseLoadOverlap(undefined), null);
    assert.equal(parseLoadOverlap(null), null);
  });
});
