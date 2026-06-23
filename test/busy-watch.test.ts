import { describe, it, expect } from "vitest";
import { isBusy } from "../src/busy-watch";

describe("isBusy", () => {
  it("is busy within the freshness window", () => {
    expect(isBusy(1000, 3000)).toBe(true);
    expect(isBusy(1000, 4000)).toBe(true); // exactly at the 3s boundary
  });
  it("is idle past the window or with no activity", () => {
    expect(isBusy(1000, 4001)).toBe(false);
    expect(isBusy(null, 4000)).toBe(false);
  });
  it("honors a custom window", () => {
    expect(isBusy(0, 9000, 10_000)).toBe(true);
    expect(isBusy(0, 11_000, 10_000)).toBe(false);
  });
});
