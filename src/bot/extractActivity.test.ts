import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activityDraftFromPartial,
  applyActivityClarifyText,
  applyActivityCorrection,
  clarifyNeeds,
  defaultSessionName,
  mergeActivityCorrection,
  normalizeActivityType,
  parseActivityHeuristic,
  parseQuickActivityCorrection,
  isSoftActivityCorrection,
} from "./extractActivity.js";
import type { ActivityDraft } from "./session.js";

const NOW = new Date("2026-08-13T07:28:00+07:00");

const baseDraft: ActivityDraft = {
  activity_type: "run",
  session_name: "Lari via WA",
  session_date: "2026-07-17T06:00:00",
  duration: 2400,
  distance: 5,
};

describe("normalizeActivityType", () => {
  it("maps Indonesian aliases", () => {
    assert.equal(normalizeActivityType("lari"), "run");
    assert.equal(normalizeActivityType("bersepeda"), "bike");
    assert.equal(normalizeActivityType("renang"), "swim");
    assert.equal(normalizeActivityType("gym"), "strength");
    assert.equal(normalizeActivityType("jalan kaki"), "walk");
    assert.equal(normalizeActivityType("yoga"), "yoga");
    assert.equal(normalizeActivityType("berlari 40 menit"), "run");
  });

  it("does not treat perjalanan as walk", () => {
    assert.equal(normalizeActivityType("perjalanan 5km 40 menit"), null);
  });

  it("does not slugify a full sentence", () => {
    assert.equal(normalizeActivityType("40 menit tanggal 17 Juli"), null);
  });

  it("does not treat duration units as activity types", () => {
    assert.equal(normalizeActivityType("menit"), null);
    assert.equal(normalizeActivityType("detik"), null);
  });
});

describe("parseActivityHeuristic", () => {
  it("parses the handoff example", () => {
    const extracted = parseActivityHeuristic(
      "Lari 5km, 40 menit, tanggal 17 Juli",
      NOW,
    );
    assert.equal(extracted.is_activity_log, true);
    assert.equal(extracted.activity_type, "run");
    assert.equal(extracted.duration_seconds, 2400);
    assert.equal(extracted.distance_km, 5);
    assert.equal(extracted.session_date, "2026-07-17T06:00:00");
    assert.equal(extracted.session_name, "Lari via WA");
  });

  it("parses elevation, calories, and cadence", () => {
    const extracted = parseActivityHeuristic(
      "Lari 8km 50 menit, elevasi 200m, cadence 170, bakar 480 kcal",
      NOW,
    );
    assert.equal(extracted.elevation_gain, 200);
    assert.equal(extracted.cadence_avg, 170);
    assert.equal(extracted.calories, 480);
  });

  it("does not turn elevation meters into distance", () => {
    const extracted = parseActivityHeuristic("Lari 50 menit, elevasi 200m", NOW);
    assert.equal(extracted.elevation_gain, 200);
    assert.equal(extracted.distance_km, null);
    assert.equal(extracted.duration_seconds, 3000);
  });

  it("does not treat kcal as an unclear duration", () => {
    const extracted = parseActivityHeuristic("lari 480 kcal", NOW);
    assert.equal(extracted.calories, 480);
    assert.equal(extracted.duration_unit_unclear, false);
    assert.equal(extracted.unclear_duration_number, null);
  });

  it("flags bare duration numbers", () => {
    const extracted = parseActivityHeuristic("lari 40", NOW);
    assert.equal(extracted.activity_type, "run");
    assert.equal(extracted.duration_unit_unclear, true);
    assert.equal(extracted.unclear_duration_number, 40);
  });
});

describe("parseQuickActivityCorrection / merge", () => {
  it("updates duration only", () => {
    const patch = parseQuickActivityCorrection("50 menit", NOW);
    assert.equal(patch?.is_correction, true);
    assert.equal(patch?.duration_seconds, 3000);
    const merged = mergeActivityCorrection(baseDraft, patch!);
    assert.equal(merged.duration, 3000);
    assert.equal(merged.distance, 5);
    assert.equal(merged.activity_type, "run");
  });

  it("updates date and type", () => {
    const patch = parseQuickActivityCorrection("kemarin jadi sepeda", NOW);
    assert.equal(patch?.session_date, "2026-08-12T06:00:00");
    assert.equal(patch?.activity_type, "bike");
    const merged = mergeActivityCorrection(baseDraft, patch!);
    assert.equal(merged.activity_type, "bike");
    assert.equal(merged.session_name, "Sepeda via WA");
  });

  it("applies clock-only correction to the existing date", () => {
    const patch = parseQuickActivityCorrection("jam 7 pagi", NOW);
    assert.equal(patch?.session_date, null);
    assert.equal(patch?.clock_hour, 7);
    const merged = mergeActivityCorrection(baseDraft, patch!);
    assert.equal(merged.session_date, "2026-07-17T07:00:00");
    assert.equal(merged.duration, 2400);
  });

  it("asks for a unit when the correction is a bare number", () => {
    const patch = parseQuickActivityCorrection("50", NOW);
    assert.equal(patch?.duration_unit_unclear, true);
    assert.equal(patch?.unclear_duration_number, 50);
    const applied = applyActivityCorrection(baseDraft, patch!);
    assert.equal(applied.kind, "clarify");
    if (applied.kind === "clarify") {
      assert.deepEqual(applied.needs, ["duration_unit"]);
      assert.equal(applied.partial.unclearDurationNumber, 50);
      assert.equal(applied.partial.activity_type, "run");
    }
  });

  it("updates elevation and calories", () => {
    const patch = parseQuickActivityCorrection("elevasi 180m 420 kcal", NOW);
    assert.equal(patch?.elevation_gain, 180);
    assert.equal(patch?.calories, 420);
    const merged = mergeActivityCorrection(baseDraft, patch!);
    assert.equal(merged.elevation_gain, 180);
    assert.equal(merged.calories, 420);
    assert.equal(merged.duration, 2400);
  });

  it("does not treat a food log as an activity calorie correction", () => {
    assert.equal(parseQuickActivityCorrection("nasi goreng 300 kcal", NOW), null);
  });

  it("still accepts kcal as an activity correction", () => {
    const patch = parseQuickActivityCorrection("420 kcal", NOW);
    assert.equal(patch?.calories, 420);
    assert.equal(patch?.duration_unit_unclear, false);
  });
});

describe("clarify flow", () => {
  it("asks for unit then completes the draft", () => {
    const extracted = parseActivityHeuristic("lari 40", NOW);
    const partial = {
      activity_type: extracted.activity_type ?? undefined,
      session_date: extracted.session_date ?? "2026-08-13T06:00:00",
      unclearDurationNumber: extracted.unclear_duration_number ?? undefined,
    };
    assert.deepEqual(clarifyNeeds(partial), ["duration_unit"]);
    assert.equal(activityDraftFromPartial(partial), null);

    const next = applyActivityClarifyText(partial, "menit", NOW);
    assert.equal(next.duration, 2400);
    assert.deepEqual(clarifyNeeds(next), []);
    const draft = activityDraftFromPartial(next);
    assert.equal(draft?.duration, 2400);
    assert.equal(draft?.activity_type, "run");
  });
});

describe("defaultSessionName", () => {
  it("uses Indonesian label", () => {
    assert.equal(defaultSessionName("run"), "Lari via WA");
  });
});

describe("isSoftActivityCorrection", () => {
  it("accepts natural phrasing that is not a quick parse or a new food log", () => {
    assert.equal(isSoftActivityCorrection("durasinya kurang"), true);
    assert.equal(isSoftActivityCorrection("50 menit"), false);
    assert.equal(isSoftActivityCorrection("nasi ayam 300gr"), false);
  });
});
