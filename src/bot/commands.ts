const CONFIRM_YES_WORDS = [
  "ya",
  "iya",
  "iy",
  "yes",
  "y",
  "ok",
  "oke",
  "baik",
  "simpan",
  "catat",
  "benar",
  "betul",
];

const CONFIRM_NO_WORDS = [
  "batal",
  "cancel",
  "tidak",
  "tdk",
  "ga",
  "gak",
  "nggak",
  "enggak",
  "no",
  "n",
];

const MENU_WORDS = [
  "menu",
  "/menu",
  "/start",
  "help",
  "/help",
  "bantuan",
  "0",
  "hai",
  "halo",
  "hallo",
  "hi",
  "hello",
  "pagi",
  "siang",
  "malam",
  "test",
  "tes",
];

/** Normalisasi teks perintah: trim, lowercase, buang tanda baca di ujung. */
export function normalizeCmd(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function firstToken(cmd: string): string {
  const t = cmd.split(/\s+/)[0] ?? "";
  return normalizeCmd(t);
}

function matchesWord(cmd: string, words: string[]): boolean {
  const normalized = normalizeCmd(cmd);
  if (!normalized) return false;
  if (words.includes(normalized)) return true;
  const token = firstToken(normalized);
  return words.includes(token);
}

export function isMenuCommand(cmd: string): boolean {
  return matchesWord(cmd, MENU_WORDS);
}

export function isConfirmYes(cmd: string): boolean {
  return matchesWord(cmd, CONFIRM_YES_WORDS);
}

export function isConfirmNo(cmd: string): boolean {
  return matchesWord(cmd, CONFIRM_NO_WORDS);
}

/** Sapaan ringan saat tidak ada draft — mis. `ya`, `oke` tanpa konteks konfirmasi. */
export function isCasualGreeting(cmd: string): boolean {
  return matchesWord(cmd, ["ya", "iya", "iy", "ok", "oke"]);
}
