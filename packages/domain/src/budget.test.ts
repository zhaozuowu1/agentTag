import { describe, expect, it } from "vitest";
import { canStartSession, tokensToUsd } from "./budget.ts";

describe("canStartSession", () => {
  it("allows a new session while usage is below the tenant monthly limit", () => {
    expect(canStartSession(9.99, 10)).toBe(true);
  });

  it("blocks a new session when used is at or above the limit", () => {
    expect(canStartSession(10, 10)).toBe(false);
    expect(canStartSession(12, 10)).toBe(false);
  });

  it("treats a non-positive limit as unlimited", () => {
    expect(canStartSession(100, 0)).toBe(true);
    expect(canStartSession(100, -1)).toBe(true);
  });
});

describe("tokensToUsd", () => {
  it("converts Anthropic usage into USD for the tenant counter", () => {
    expect(tokensToUsd(1_000_000, 1_000_000)).toBeCloseTo(18);
  });
});
