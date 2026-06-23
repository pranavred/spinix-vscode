import { describe, it, expect } from "vitest";
import { shouldNotify, thinkMsFor, notifyEnabled } from "../src/notify.mjs";

describe("shouldNotify", () => {
  it("pings for turns at/over the threshold", () => {
    const start = 1_000_000;
    expect(shouldNotify(start, start + 30_000)).toBe(true);
    expect(shouldNotify(start, start + 120_000)).toBe(true);
  });
  it("stays quiet for short turns", () => {
    const start = 1_000_000;
    expect(shouldNotify(start, start + 5_000)).toBe(false);
    expect(shouldNotify(start, start + 29_999)).toBe(false);
  });
  it("stays quiet with no recorded start", () => {
    expect(shouldNotify(0, 1_000_000)).toBe(false);
    expect(shouldNotify(NaN as unknown as number, 1_000_000)).toBe(false);
  });
});

describe("thinkMsFor", () => {
  it("is the elapsed turn time", () => {
    expect(thinkMsFor(1000, 1000 + 90_000)).toBe(90_000);
  });
  it("clamps a single absurd turn to the per-turn max (30 min)", () => {
    expect(thinkMsFor(1000, 1000 + 999_999_999)).toBe(30 * 60 * 1000);
  });
  it("is zero without a start (no accrual)", () => {
    expect(thinkMsFor(0, 1_000_000)).toBe(0);
  });
});

describe("notifyEnabled", () => {
  it("is silenced only by an explicit notify:false", () => {
    expect(notifyEnabled({ notify: false })).toBe(false);
  });
  it("defaults on when the pref is unset", () => {
    expect(notifyEnabled({})).toBe(true);
    expect(notifyEnabled({ notify: true })).toBe(true);
  });
  it("defaults on when prefs.json is missing", () => {
    expect(notifyEnabled(null)).toBe(true);
    expect(notifyEnabled(undefined)).toBe(true);
  });
});
