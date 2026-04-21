import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRateLimit, requestLog } from "../rateLimit";

beforeEach(() => {
  requestLog.clear();
  vi.restoreAllMocks();
});

describe("rateLimit cleanup", () => {
  it("old entries are cleaned from the Map after window passes", () => {
    const windowMs = 1_000;
    const limit = 5;

    // Simulate requests from 10 different IPs at t=0
    const t0 = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(t0);

    for (let i = 0; i < 10; i++) {
      checkRateLimit(`ip-${i}`, limit, windowMs);
    }
    expect(requestLog.size).toBe(10);

    // Advance time past the window so all entries are stale
    vi.spyOn(Date, "now").mockReturnValue(t0 + windowMs + 1);

    // A single call from a new IP triggers cleanup of all old entries
    checkRateLimit("ip-new", limit, windowMs);

    // Only the new IP should remain
    expect(requestLog.size).toBe(1);
    expect(requestLog.has("ip-new")).toBe(true);
  });

  it("rate-limited IP can make requests again after window resets", () => {
    const windowMs = 1_000;
    const limit = 2;

    const t0 = 2_000_000;
    vi.spyOn(Date, "now").mockReturnValue(t0);

    // Exhaust the limit
    expect(checkRateLimit("ip-a", limit, windowMs).allowed).toBe(true);
    expect(checkRateLimit("ip-a", limit, windowMs).allowed).toBe(true);
    expect(checkRateLimit("ip-a", limit, windowMs).allowed).toBe(false);

    // Advance past the window
    vi.spyOn(Date, "now").mockReturnValue(t0 + windowMs + 1);

    // Should be allowed again
    const result = checkRateLimit("ip-a", limit, windowMs);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });
});
