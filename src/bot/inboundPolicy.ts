import { activityLabel } from "@/bot/extractActivity.js";
import type { FoodDraft, Session } from "@/bot/session.js";

export function isPendingSessionState(session: Session): boolean {
  return (
    session.state.kind === "pending_confirm" ||
    session.state.kind === "pending_confirm_activity" ||
    session.state.kind === "pending_activity_clarify"
  );
}

export function pendingItemLabel(session: Session): string | null {
  if (session.state.kind === "pending_confirm") return session.state.draft.food_name;
  if (session.state.kind === "pending_confirm_activity") {
    return activityLabel(session.state.draft.activity_type);
  }
  if (session.state.kind === "pending_activity_clarify") {
    const type = session.state.partial.activity_type;
    return type ? activityLabel(type) : "aktivitas";
  }
  return null;
}

export type QueuedReplace =
  | { kind: "food"; draft: FoodDraft }
  | { kind: "text"; text: string }
  | { kind: "none" };

export function pickQueuedReplace(queued: { food?: FoodDraft; text?: string }): QueuedReplace {
  if (queued.food) return { kind: "food", draft: queued.food };
  if (queued.text) return { kind: "text", text: queued.text };
  return { kind: "none" };
}

export function confirmIdleKind(expiredPending: boolean): "expired" | "idle" {
  return expiredPending ? "expired" : "idle";
}
