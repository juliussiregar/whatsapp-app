import OpenAI from "openai";
import { getOpenAiApiKey, getOpenAiTimeoutMs } from "@/config.js";

export function voiceFilename(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("mpeg") || mime.includes("mp3")) return "voice.mp3";
  if (mime.includes("wav")) return "voice.wav";
  if (mime.includes("m4a") || mime.includes("mp4") || mime.includes("aac")) return "voice.m4a";
  return "voice.ogg";
}

export async function transcribeVoice(buffer: Buffer, mimeType: string): Promise<string | null> {
  const key = getOpenAiApiKey();
  if (!key || buffer.length < 32) return null;

  const client = new OpenAI({ apiKey: key, timeout: getOpenAiTimeoutMs() });
  const file = new File([new Uint8Array(buffer)], voiceFilename(mimeType), {
    type: mimeType || "audio/ogg",
  });

  try {
    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "id",
    });
    const text = typeof result === "string" ? result : result.text;
    const trimmed = text?.trim() ?? "";
    return trimmed || null;
  } catch {
    return null;
  }
}
