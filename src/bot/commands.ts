const CONFIRM_YES_PREFIX = [
  "ya",
  "iya",
  "iy",
  "yes",
  "y",
  "ok",
  "oke",
  "baik",
  "benar",
  "betul",
];

/** Exact only — also used as verbs to start a new log (`catat lari 40 menit`). */
const CONFIRM_YES_EXACT = ["catat", "simpan"];

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

const MENU_COMMANDS = [
  "menu",
  "/menu",
  "/start",
  "help",
  "/help",
  "bantuan",
  "0",
];

const NAME_GREETINGS = ["hai", "halo", "hallo", "hi", "hello"];
const TIME_GREETINGS = ["pagi", "siang", "malam"];
const TEST_GREETINGS = ["test", "tes"];

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

function tokenCount(cmd: string): number {
  return cmd.trim().split(/\s+/).filter(Boolean).length;
}

type MatchWordOpts = {
  /** Izinkan cocokkan kata pertama saja, mis. `iya dong` → `iya`. */
  allowPrefix?: boolean;
};

function matchesWord(cmd: string, words: string[], opts?: MatchWordOpts): boolean {
  const normalized = normalizeCmd(cmd);
  if (!normalized) return false;
  if (words.includes(normalized)) return true;
  if (!opts?.allowPrefix) return false;
  const token = firstToken(normalized);
  return words.includes(token);
}

export function isMenuCommand(cmd: string): boolean {
  const normalized = normalizeCmd(cmd);
  if (!normalized) return false;
  if (MENU_COMMANDS.includes(normalized)) return true;
  if (NAME_GREETINGS.includes(normalized)) return true;
  if (TIME_GREETINGS.includes(normalized)) return true;
  if (TEST_GREETINGS.includes(normalized)) return true;

  const token = firstToken(normalized);
  if (MENU_COMMANDS.includes(token)) return true;
  // "halo kak" — sapaan nama, bukan "malam tadi lari …"
  if (NAME_GREETINGS.includes(token) && tokenCount(normalized) <= 2) return true;
  return false;
}

export function isConfirmYes(cmd: string, opts?: MatchWordOpts): boolean {
  const normalized = normalizeCmd(cmd);
  if (!normalized) return false;
  if (CONFIRM_YES_EXACT.includes(normalized)) return true;
  if (CONFIRM_YES_PREFIX.includes(normalized)) return true;
  if (!opts?.allowPrefix) return false;
  return CONFIRM_YES_PREFIX.includes(firstToken(normalized));
}

export function isConfirmNo(cmd: string, opts?: MatchWordOpts): boolean {
  return matchesWord(cmd, CONFIRM_NO_WORDS, opts);
}

/** Sapaan ringan saat tidak ada draft — mis. `ya`, `oke` tanpa konteks konfirmasi. */
export function isCasualGreeting(cmd: string): boolean {
  const normalized = normalizeCmd(cmd);
  if (TIME_GREETINGS.includes(normalized)) return true;
  if (NAME_GREETINGS.includes(normalized)) return true;
  return matchesWord(cmd, ["ya", "iya", "iy", "ok", "oke"], { allowPrefix: true });
}
