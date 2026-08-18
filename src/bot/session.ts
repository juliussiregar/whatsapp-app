import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type FoodDraftItem = {
  food_name: string;
  serving: number;
  suffix_serving: string;
  calories: number;
  fat: number;
  protein: number;
  carbo: number;
};

export type FoodDraft = {
  food_name: string;
  serving: number;
  suffix_serving: string;
  calories: number;
  fat: number;
  protein: number;
  carbo: number;
  category_id: number;
  category_name: string;
  source: "text" | "image";
  disclaimer?: string;
  caloriesAdjusted?: boolean;
  /** Breakdown per item dari analisis foto (jika ada). */
  items?: FoodDraftItem[];
};

export type ActivityDraft = {
  activity_type: string;
  session_name: string;
  session_date: string;
  duration: number;
  distance?: number;
  elevation_gain?: number;
  hr_avg?: number;
  hr_max?: number;
  cadence_avg?: number;
  calories?: number;
  notes?: string;
  dateAmbiguous?: boolean;
};

export type ActivityClarifyNeed = "activity_type" | "duration" | "duration_unit";

export type ActivityPartial = Partial<ActivityDraft> & {
  unclearDurationNumber?: number;
};

export type SessionState =
  | { kind: "idle" }
  | { kind: "pending_confirm"; draft: FoodDraft }
  | { kind: "pending_confirm_activity"; draft: ActivityDraft }
  | { kind: "pending_activity_clarify"; partial: ActivityPartial; needs: ActivityClarifyNeed[] };

export type Session = {
  state: SessionState;
  /** Cache singkat hasil resolve user */
  userId?: number;
  fullName?: string;
  categories?: Array<{ category_id: number; name: string }>;
  /** Pesan baru yang menunggu *ganti*. */
  queuedText?: string;
  updatedAt: number;
};

export const SESSION_TTL_MS = 30 * 60 * 1000;
const store = new Map<string, Session>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;

function persistPath(): string | null {
  if (process.env.BOT_SESSION_STORE_PATH === "") return null;
  if (process.env.BOT_SESSION_STORE_PATH) return process.env.BOT_SESSION_STORE_PATH;
  if (process.env.NODE_TEST_CONTEXT) return null;
  return path.join(process.cwd(), "data", "bot-sessions.json");
}

function prune(): void {
  const now = Date.now();
  for (const [k, s] of store) {
    if (now - s.updatedAt > SESSION_TTL_MS) store.delete(k);
  }
}

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;
  const file = persistPath();
  if (!file) return;
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, Session>;
    const now = Date.now();
    for (const [k, s] of Object.entries(parsed)) {
      if (s && typeof s.updatedAt === "number" && now - s.updatedAt <= SESSION_TTL_MS) {
        store.set(k, s);
      }
    }
  } catch {
    // file belum ada / rusak — mulai kosong
  }
}

function schedulePersist(): void {
  const file = persistPath();
  if (!file) return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      prune();
      writeFileSync(file, JSON.stringify(Object.fromEntries(store), null, 0), "utf8");
    } catch {
      // persist gagal tidak boleh ganggu chat
    }
  }, 250);
}

export function getSession(key: string): Session {
  loadFromDisk();
  prune();
  const existing = store.get(key);
  if (existing && Date.now() - existing.updatedAt <= SESSION_TTL_MS) return existing;
  const fresh: Session = { state: { kind: "idle" }, updatedAt: Date.now() };
  store.set(key, fresh);
  return fresh;
}

export function setSession(key: string, session: Session): void {
  session.updatedAt = Date.now();
  store.set(key, session);
  schedulePersist();
}

export function resetSession(key: string): void {
  const prev = getSession(key);
  setSession(key, {
    state: { kind: "idle" },
    userId: prev.userId,
    fullName: prev.fullName,
    categories: prev.categories,
    updatedAt: Date.now(),
  });
}

export function queueIncomingText(key: string, text: string): Session {
  const session = getSession(key);
  session.queuedText = text.trim();
  setSession(key, session);
  return session;
}

export function takeQueuedText(key: string): string | undefined {
  const session = getSession(key);
  const queued = session.queuedText?.trim();
  session.queuedText = undefined;
  setSession(key, session);
  return queued || undefined;
}

export function resetSessionsForTests(): void {
  store.clear();
  loaded = true;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
