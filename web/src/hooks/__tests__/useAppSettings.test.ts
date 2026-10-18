import { describe, it, expect } from "vitest";
import { serverStringToBrowserString } from "../useAppSettings";

// serverStringToBrowserString converts server wall-clock strings into the
// browser zone. Tests pin the target zone explicitly so they don't depend on
// the machine the suite runs on.
describe("serverStringToBrowserString", () => {
  it("returns the input unchanged when the server zone is unknown", () => {
    expect(serverStringToBrowserString("2026-03-08 01:30:00", "")).toBe("2026-03-08 01:30:00");
  });

  it("returns unparseable input unchanged", () => {
    expect(serverStringToBrowserString("not-a-date", "UTC", "America/New_York")).toBe("not-a-date");
  });

  it("is the identity when server and browser zones match", () => {
    expect(serverStringToBrowserString("2026-03-08 01:30:00", "UTC", "UTC")).toBe("2026-03-08 01:30:00");
  });

  it("converts UTC to America/New_York across the 2026-03-08 spring-forward boundary", () => {
    // Before the 02:00 EST → 03:00 EDT jump: NY is on EST (UTC-5).
    expect(serverStringToBrowserString("2026-03-08 01:30:00", "UTC", "America/New_York")).toBe("2026-03-07 20:30:00");
    // After the jump: NY is on EDT (UTC-4).
    expect(serverStringToBrowserString("2026-03-08 07:30:00", "UTC", "America/New_York")).toBe("2026-03-08 03:30:00");
  });

  it("converts UTC to America/New_York across the 2026-11-01 fall-back boundary", () => {
    // 05:30 UTC is still EDT (UTC-4); 06:30 UTC is EST (UTC-5). Both land on
    // the repeated 01:30 wall clock — correct for a wall-clock display.
    expect(serverStringToBrowserString("2026-11-01 05:30:00", "UTC", "America/New_York")).toBe("2026-11-01 01:30:00");
    expect(serverStringToBrowserString("2026-11-01 06:30:00", "UTC", "America/New_York")).toBe("2026-11-01 01:30:00");
  });

  it("converts in the other direction (New York server → UTC) across DST", () => {
    // 01:30 EST (before the jump) = 06:30 UTC.
    expect(serverStringToBrowserString("2026-03-08 01:30:00", "America/New_York", "UTC")).toBe("2026-03-08 06:30:00");
    // 03:30 EDT (after the jump) = 07:30 UTC.
    expect(serverStringToBrowserString("2026-03-08 03:30:00", "America/New_York", "UTC")).toBe("2026-03-08 07:30:00");
  });

  it("handles ISO-shaped input with a T separator", () => {
    expect(serverStringToBrowserString("2026-03-08T01:30:00", "UTC", "America/New_York")).toBe("2026-03-07 20:30:00");
  });
});
