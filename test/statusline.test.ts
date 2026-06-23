import { describe, it, expect } from "vitest";
import { agentBusy, isEntrypoint } from "../src/statusline.mjs";

describe("isEntrypoint (cross-platform entry guard)", () => {
  it("matches a posix entrypoint path", () => {
    expect(isEntrypoint("/Users/x/.spinix/statusline.mjs", "file:///Users/x/.spinix/statusline.mjs")).toBe(true);
  });
  it("matches a Windows backslash path (the bug this fixes)", () => {
    // argv[1] is backslash-separated on Windows; import.meta.url is forward-slash.
    expect(isEntrypoint("C:\\Users\\x\\.spinix\\statusline.mjs", "file:///C:/Users/x/.spinix/statusline.mjs")).toBe(true);
  });
  it("does not match when imported (argv1 is the test runner) or absent", () => {
    expect(isEntrypoint("/usr/local/bin/vitest", "file:///Users/x/.spinix/statusline.mjs")).toBe(false);
    expect(isEntrypoint(undefined, "file:///x/statusline.mjs")).toBe(false);
    expect(isEntrypoint("/x/xstatusline.mjs", "file:///x/statusline.mjs")).toBe(false); // suffix-safe
  });
});

describe("agentBusy (statusline metering gate)", () => {
  const now = 1_000_000_000;
  const W = 600_000; // 10-minute window (explicit so the test is window-agnostic)
  it("stays busy through sparse writes during an active turn", () => {
    expect(agentBusy(now - 1_000, now, W)).toBe(true);
    expect(agentBusy(now - 120_000, now, W)).toBe(true); // 2-min transcript gap mid-turn
    expect(agentBusy(now - (W - 1), now, W)).toBe(true);
  });
  it("is idle once the session has been quiet past the window", () => {
    expect(agentBusy(now - (W + 1), now, W)).toBe(false);
    expect(agentBusy(now - 3_600_000, now, W)).toBe(false); // open + idle for an hour
  });
  it("is idle with no/invalid activity timestamp", () => {
    expect(agentBusy(0, now, W)).toBe(false);
    expect(agentBusy(NaN as unknown as number, now, W)).toBe(false);
  });
  it("uses a generous default window so active turns are never dropped", () => {
    expect(agentBusy(now - 120_000, now)).toBe(true);
  });
});
