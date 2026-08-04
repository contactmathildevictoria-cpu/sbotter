import { describe, expect, it } from "vitest";
import { DATA_STALE_AFTER_MS, isDataStale } from "@/lib/format";

const NOW = Date.parse("2026-08-04T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe("isDataStale", () => {
  it("is fresh right after a nightly run", () => {
    expect(isDataStale(hoursAgo(3), NOW)).toBe(false);
  });

  it("is fresh at 47h — one missed run is a slow day, not a dead pipeline", () => {
    expect(isDataStale(hoursAgo(47), NOW)).toBe(false);
  });

  it("is stale past 48h", () => {
    expect(isDataStale(hoursAgo(49), NOW)).toBe(true);
  });

  it("treats exactly 48h as still fresh", () => {
    expect(isDataStale(new Date(NOW - DATA_STALE_AFTER_MS).toISOString(), NOW)).toBe(
      false,
    );
  });

  it("treats 'nothing ingested' as stale, not as healthy", () => {
    // The whole point of the indicator is spotting a dead pipeline in two
    // seconds; an empty table must not render in the calm colour.
    expect(isDataStale(null, NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as stale", () => {
    expect(isDataStale("not-a-date", NOW)).toBe(true);
  });
});
