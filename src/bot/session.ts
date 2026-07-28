export type FoodDraftItem = {
  food_name: string;
  serving: number;
  suffix_serving: string;
  calories: number;
  fat: number;
  protein: number;
};

export type FoodDraft = {
  food_name: string;
  serving: number;
  suffix_serving: string;
  calories: number;
  fat: number;
  protein: number;
  category_id: number;
  category_name: string;
  source: "text" | "image";
  disclaimer?: string;
  /** Breakdown per item dari analisis foto (jika ada). */
  items?: FoodDraftItem[];
};

export type SessionState =
  | { kind: "idle" }
  | { kind: "pending_confirm"; draft: FoodDraft };

export type Session = {
  state: SessionState;
  /** Cache singkat hasil resolve user */
  userId?: number;
  fullName?: string;
  categories?: Array<{ category_id: number; name: string }>;
  updatedAt: number;
};

const TTL_MS = 30 * 60 * 1000;
const store = new Map<string, Session>();

function prune(): void {
  const now = Date.now();
  for (const [k, s] of store) {
    if (now - s.updatedAt > TTL_MS) store.delete(k);
  }
}

export function getSession(key: string): Session {
  prune();
  const existing = store.get(key);
  if (existing && Date.now() - existing.updatedAt <= TTL_MS) return existing;
  const fresh: Session = { state: { kind: "idle" }, updatedAt: Date.now() };
  store.set(key, fresh);
  return fresh;
}

export function setSession(key: string, session: Session): void {
  session.updatedAt = Date.now();
  store.set(key, session);
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
