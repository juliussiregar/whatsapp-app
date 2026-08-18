import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transcribeVoice, voiceFilename } from "./transcribeVoice.js";

describe("voiceFilename", () => {
  it("picks an extension from the mime type", () => {
    assert.equal(voiceFilename("audio/ogg; codecs=opus"), "voice.ogg");
    assert.equal(voiceFilename("audio/mpeg"), "voice.mp3");
    assert.equal(voiceFilename("audio/mp4"), "voice.m4a");
    assert.equal(voiceFilename("audio/wav"), "voice.wav");
  });
});

describe("transcribeVoice", () => {
  it("returns null for tiny buffers without calling a model", async () => {
    assert.equal(await transcribeVoice(Buffer.from("xx"), "audio/ogg"), null);
  });
});
