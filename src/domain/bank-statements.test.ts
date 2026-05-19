import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultPeriod, generateExpectedMonths } from "./bank-statements";

describe("bank-statements period generation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a default period covering the last 12 months", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T12:00:00.000Z"));

    const period = createDefaultPeriod();

    expect(period.start).toBe("2025-06-01");
    expect(period.end).toBe("2026-05-31");
  });

  it("caps the generated monthly documents at 12 items", () => {
    const months = generateExpectedMonths({ start: "2025-01-01", end: "2026-12-31" });

    expect(months).toHaveLength(12);
    expect(months[0]?.monthKey).toBe("2025-01");
    expect(months[11]?.monthKey).toBe("2025-12");
  });
});