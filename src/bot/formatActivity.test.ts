import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatActivityClarify,
  formatActivitySaved,
  formatActivitySummary,
  formatLoadOverlap,
} from "./formatActivity.js";
import type { ActivityDraft } from "./session.js";

const draft: ActivityDraft = {
  activity_type: "run",
  session_name: "Lari via WA",
  session_date: "2026-07-17T06:00:00",
  duration: 2400,
  distance: 5,
  dateAmbiguous: false,
};

describe("formatActivitySummary", () => {
  it("includes CTA, duration, distance, and watermark", () => {
    const text = formatActivitySummary(draft);
    assert.match(text, /\*BALAS YA UNTUK MENYIMPAN\*/);
    assert.match(text, /Lari/);
    assert.match(text, /40 menit/);
    assert.match(text, /5 km/);
    assert.match(text, /Powered by SOLIDPACE/);
  });

  it("shows elevation and calories when present", () => {
    const text = formatActivitySummary({
      ...draft,
      elevation_gain: 200,
      calories: 480,
      cadence_avg: 170,
    });
    assert.match(text, /Elevasi: 200 m/);
    assert.match(text, /480 kcal/);
    assert.match(text, /Cadence: 170/);
  });

  it("warns when the date is ambiguous", () => {
    const text = formatActivitySummary({ ...draft, dateAmbiguous: true });
    assert.match(text, /ambigu/i);
  });
});

describe("formatActivitySaved", () => {
  it("shows TSS and overlap when present", () => {
    const text = formatActivitySaved(draft, {
      id: 502,
      activity_type: "run",
      session_date: "2026-07-17T06:00:00",
      duration: 2400,
      distance: 5,
      tss: 28.5,
      source: "manual",
      source_label: "WhatsApp",
      import_channel: "whatsapp",
      excluded_from_load: false,
      load_overlap: {
        overlapping: true,
        sessions: [{ session_name: "Garmin run", source_label: "Garmin" }],
      },
    }, "Adi");
    assert.match(text, /Adi/);
    assert.match(text, /TSS: 28\.5/);
    assert.match(text, /Garmin/);
  });

  it("shows session name, elevation, and calories from the draft", () => {
    const text = formatActivitySaved(
      { ...draft, elevation_gain: 200, calories: 480 },
      {
        id: 397,
        activity_type: "bike",
        session_name: "Sepeda (WhatsApp)",
        session_date: "2026-08-13T06:00:00",
        duration: 3600,
        distance: 20,
        tss: null,
        source: "manual",
        source_label: "WhatsApp",
        import_channel: "whatsapp",
        excluded_from_load: false,
      },
    );
    assert.match(text, /Sepeda \(WhatsApp\)/);
    assert.match(text, /Elevasi: 200 m/);
    assert.match(text, /480 kcal/);
    assert.doesNotMatch(text, /TSS/);
  });
});

describe("formatActivityClarify", () => {
  it("asks menit vs detik", () => {
    const text = formatActivityClarify(
      { activity_type: "run", session_date: "2026-08-13T06:00:00", unclearDurationNumber: 40 },
      ["duration_unit"],
    );
    assert.match(text, /menit atau detik/i);
    assert.match(text, /40/);
  });
});

describe("formatLoadOverlap", () => {
  it("returns null when nothing overlaps", () => {
    assert.equal(formatLoadOverlap(null), null);
    assert.equal(formatLoadOverlap({ overlapping: false }), null);
  });
});
