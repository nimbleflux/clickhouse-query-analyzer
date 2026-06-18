import { describe, it, expect } from "vitest";
import { formatDuration, formatBytes, formatNumber, durationColor, memoryColor, categorizeEvent, queryStatus, isException } from "../utils";

describe("formatDuration", () => {
  it("returns 0ms for zero", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("formats sub-millisecond", () => {
    expect(formatDuration(0.5)).toBe("0.50ms");
  });

  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500.0ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1500)).toBe("1.50s");
  });

  it("formats minutes", () => {
    expect(formatDuration(90000)).toBe("1m 30.0s");
  });

  it("handles NaN", () => {
    expect(formatDuration(NaN)).toBe("0ms");
  });
});

describe("formatBytes", () => {
  it("returns 0 B for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512.0 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GB");
  });

  it("formats negative", () => {
    expect(formatBytes(-1024)).toBe("-1.0 KB");
  });

  it("handles NaN", () => {
    expect(formatBytes(NaN)).toBe("0 B");
  });
});

describe("formatNumber", () => {
  it("returns 0 for zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats numbers under 1000", () => {
    expect(formatNumber(42)).toBe("42");
  });

  it("formats thousands", () => {
    expect(formatNumber(1500)).toBe("1.5K");
  });

  it("formats millions", () => {
    expect(formatNumber(1500000)).toBe("1.5M");
  });

  it("formats billions", () => {
    expect(formatNumber(1500000000)).toBe("1.50B");
  });
});

describe("durationColor", () => {
  it("returns success for fast", () => {
    expect(durationColor(50)).toContain("success");
  });

  it("returns warning for medium", () => {
    expect(durationColor(500)).toContain("warning");
  });

  it("returns error for slow", () => {
    expect(durationColor(2000)).toContain("error");
  });
});

describe("memoryColor", () => {
  it("returns success for low memory", () => {
    expect(memoryColor(1024)).toContain("success");
  });

  it("returns warning for medium memory", () => {
    expect(memoryColor(50 * 1024 * 1024)).toContain("warning");
  });

  it("returns error for high memory", () => {
    expect(memoryColor(500 * 1024 * 1024)).toContain("error");
  });
});

describe("categorizeEvent", () => {
  it("categorizes CPU events", () => {
    expect(categorizeEvent("UserTimeMicroseconds")).toBe("CPU");
  });

  it("categorizes I/O events", () => {
    expect(categorizeEvent("DiskReadElapsedMicroseconds")).toBe("I/O");
  });

  it("categorizes Memory events", () => {
    expect(categorizeEvent("MemoryTrackingAllocation")).toBe("Memory");
  });

  it("categorizes Network events", () => {
    expect(categorizeEvent("NetworkSendBytes")).toBe("Network");
  });

  it("categorizes Cache events", () => {
    expect(categorizeEvent("CacheHit")).toBe("Cache");
  });

  it("returns Other for unknown", () => {
    expect(categorizeEvent("SomethingElse")).toBe("Other");
  });
});

describe("queryStatus", () => {
  it("maps QueryStart to Running/warning", () => {
    expect(queryStatus("QueryStart")).toEqual({ label: "Running", variant: "warning" });
  });

  it("maps QueryFinish to Complete/success", () => {
    expect(queryStatus("QueryFinish")).toEqual({ label: "Complete", variant: "success" });
  });

  it("maps ExceptionBeforeStart to Exception/error", () => {
    expect(queryStatus("ExceptionBeforeStart")).toEqual({ label: "Exception", variant: "error" });
  });

  it("maps ExceptionWhileProcessing to Exception/error", () => {
    expect(queryStatus("ExceptionWhileProcessing")).toEqual({ label: "Exception", variant: "error" });
  });

  it("falls back to outline for unknown types", () => {
    expect(queryStatus("QueryViewsStarted")).toEqual({ label: "QueryViewsStarted", variant: "outline" });
  });
});

describe("isException", () => {
  it("returns true for exception types", () => {
    expect(isException("ExceptionBeforeStart")).toBe(true);
    expect(isException("ExceptionWhileProcessing")).toBe(true);
  });

  it("returns false for non-exception types", () => {
    expect(isException("QueryFinish")).toBe(false);
    expect(isException("QueryStart")).toBe(false);
  });
});
