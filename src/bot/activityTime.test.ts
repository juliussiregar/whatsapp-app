import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyClockToSessionDate,
  applyDurationUnit,
  formatDurationHuman,
  formatSessionDateHuman,
  normalizeSessionDateIso,
  parseDistanceKm,
  parseDurationToSeconds,
  parseDurationUnitOnly,
  parseSessionDateFromText,
  todaySessionDateIso,
} from "./activityTime.js";

const NOW = new Date("2026-08-13T07:28:00+07:00");

describe("parseDurationToSeconds", () => {
  it("converts minutes to seconds", () => {
    assert.equal(parseDurationToSeconds("40 menit").seconds, 2400);
    assert.equal(parseDurationToSeconds("45 menit").seconds, 2700);
  });

  it("converts hours and mixed units", () => {
    assert.equal(parseDurationToSeconds("1 jam").seconds, 3600);
    assert.equal(parseDurationToSeconds("1 jam 30 menit").seconds, 5400);
    assert.equal(parseDurationToSeconds("1.5 jam").seconds, 5400);
  });

  it("flags a bare number as unit-unclear", () => {
    const parsed = parseDurationToSeconds("40");
    assert.equal(parsed.seconds, null);
    assert.equal(parsed.unitUnclear, true);
    assert.equal(parsed.rawNumber, 40);
  });

  it("flags activity + number without a unit", () => {
    const parsed = parseDurationToSeconds("lari 40");
    assert.equal(parsed.unitUnclear, true);
    assert.equal(parsed.rawNumber, 40);
  });

  it("returns empty when no duration present", () => {
    const parsed = parseDurationToSeconds("lari 5km");
    assert.equal(parsed.seconds, null);
    assert.equal(parsed.unitUnclear, false);
  });

  it("does not treat kcal or cadence as a bare duration", () => {
    assert.equal(parseDurationToSeconds("lari 480 kcal").unitUnclear, false);
    assert.equal(parseDurationToSeconds("lari 480 kcal").rawNumber, null);
    assert.equal(parseDurationToSeconds("lari cadence 170").unitUnclear, false);
  });
});

describe("applyDurationUnit", () => {
  it("applies menit/detik/jam to a raw number", () => {
    assert.equal(applyDurationUnit(40, "minutes"), 2400);
    assert.equal(applyDurationUnit(40, "seconds"), 40);
    assert.equal(applyDurationUnit(1.5, "hours"), 5400);
  });
});

describe("parseDurationUnitOnly", () => {
  it("parses unit replies", () => {
    assert.equal(parseDurationUnitOnly("menit"), "minutes");
    assert.equal(parseDurationUnitOnly("detik"), "seconds");
    assert.equal(parseDurationUnitOnly("jam!"), "hours");
    assert.equal(parseDurationUnitOnly("40 menit"), null);
  });
});

describe("parseSessionDateFromText", () => {
  it("parses relative dates in WIB", () => {
    assert.equal(parseSessionDateFromText("hari ini", NOW).iso, "2026-08-13T06:00:00");
    assert.equal(parseSessionDateFromText("kemarin", NOW).iso, "2026-08-12T06:00:00");
  });

  it("parses named Indonesian dates", () => {
    assert.equal(
      parseSessionDateFromText("tanggal 17 Juli", NOW).iso,
      "2026-07-17T06:00:00",
    );
    assert.equal(
      parseSessionDateFromText("17 juli 2026", NOW).iso,
      "2026-07-17T06:00:00",
    );
  });

  it("parses numeric DMY and ISO", () => {
    assert.equal(parseSessionDateFromText("17-07-2026", NOW).iso, "2026-07-17T06:00:00");
    assert.equal(parseSessionDateFromText("2026-07-17", NOW).iso, "2026-07-17T06:00:00");
  });

  it("marks ambiguous MDY/DMY and still prefers DMY", () => {
    const parsed = parseSessionDateFromText("07/17/26", NOW);
    assert.equal(parsed.iso, "2026-07-17T06:00:00");
    assert.equal(parsed.ambiguous, true);
  });

  it("combines clock with relative day", () => {
    assert.equal(
      parseSessionDateFromText("jam 7 pagi tadi", NOW).iso,
      "2026-08-13T07:00:00",
    );
  });

  it("maps tadi malam in the morning to yesterday evening", () => {
    const parsed = parseSessionDateFromText("tadi malam", NOW);
    assert.equal(parsed.iso, "2026-08-12T19:00:00");
    assert.equal(parsed.clockOnly, false);
  });

  it("keeps a named date even when tadi is present", () => {
    assert.equal(
      parseSessionDateFromText("17 Juli tadi pagi", NOW).iso,
      "2026-07-17T06:00:00",
    );
  });

  it("treats clock-only text as clockOnly without inventing a day", () => {
    const parsed = parseSessionDateFromText("jam 7 pagi", NOW);
    assert.equal(parsed.iso, null);
    assert.equal(parsed.clockOnly, true);
    assert.equal(parsed.hour, 7);
    assert.equal(parsed.minute, 0);
  });

  it("parses jam 12 malam as 00:00", () => {
    const parsed = parseSessionDateFromText("jam 12 malam", NOW);
    assert.equal(parsed.clockOnly, true);
    assert.equal(parsed.hour, 0);
  });
});

describe("applyClockToSessionDate", () => {
  it("changes time without changing the calendar day", () => {
    assert.equal(
      applyClockToSessionDate("2026-07-17T06:00:00", 7, 0),
      "2026-07-17T07:00:00",
    );
  });
});

describe("todaySessionDateIso", () => {
  it("defaults to 06:00 WIB", () => {
    assert.equal(todaySessionDateIso(NOW), "2026-08-13T06:00:00");
  });
});

describe("normalizeSessionDateIso", () => {
  it("strips timezone suffix", () => {
    assert.equal(normalizeSessionDateIso("2026-07-17T06:00:00Z"), "2026-07-17T06:00:00");
    assert.equal(normalizeSessionDateIso("not-a-date"), null);
  });
});

describe("parseDistanceKm", () => {
  it("parses km and meters", () => {
    assert.equal(parseDistanceKm("lari 5km"), 5);
    assert.equal(parseDistanceKm("5000 m"), 5);
  });

  it("does not treat elevation meters as distance", () => {
    assert.equal(parseDistanceKm("Lari 50 menit, elevasi 200m"), null);
    assert.equal(parseDistanceKm("Lari 50 menit naik 200 meter"), null);
    assert.equal(parseDistanceKm("Lari 8km 50 menit, elevasi 200m"), 8);
  });
});

describe("formatDurationHuman / formatSessionDateHuman", () => {
  it("formats duration", () => {
    assert.equal(formatDurationHuman(2400), "40 menit");
    assert.equal(formatDurationHuman(5400), "1 jam 30 menit");
  });

  it("formats ISO as WIB wall clock", () => {
    const text = formatSessionDateHuman("2026-07-17T06:00:00");
    assert.match(text, /17/);
    assert.match(text, /Juli/i);
    assert.match(text, /06\.00|06:00/);
  });
});
