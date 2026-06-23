import { describe, it, expect } from "vitest";
import { ViewTracker } from "../src/view-tracker";

const ad = (id: string) => ({ ad_id: id, campaign_id: id, view_token: `vt-${id}` });

describe("ViewTracker (batched)", () => {
  it("flushes units=5 with the ad's identity after a full 25s window", () => {
    const t = new ViewTracker();
    let now = 1_000_000;
    let flush = t.update(ad("a"), now, now); // session start
    expect(flush).toBeNull();
    // five 5s ticks (one is the 15s threshold) -> flush at the 5th
    for (let i = 0; i < 5; i++) { now += 5000; flush = t.update(ad("a"), now, now); }
    expect(flush).toMatchObject({ ad_id: "a", campaign_id: "a", view_token: "vt-a", units: 5 });
  });

  it("flushes the partial for the OLD ad when the ad changes", () => {
    const t = new ViewTracker();
    let now = 2_000_000;
    t.update(ad("a"), now, now);
    now += 5000; t.update(ad("a"), now, now); // pending=1 for "a"
    now += 5000; t.update(ad("a"), now, now); // pending=2 for "a"
    now += 100; const flush = t.update(ad("b"), now, now); // ad changes -> flush "a"
    expect(flush).toMatchObject({ ad_id: "a", units: 2 });
  });

  it("flushes the partial when the ad goes off-screen", () => {
    const t = new ViewTracker();
    let now = 3_000_000;
    t.update(ad("a"), now, now);
    now += 5000; t.update(ad("a"), now, now); // pending=1
    now += 9000; const flush = t.update(null, 0, now); // stale -> off-screen flush
    expect(flush).toMatchObject({ ad_id: "a", units: 1 });
  });

  it("emits nothing while off-screen with no pending", () => {
    const t = new ViewTracker();
    expect(t.update(null, 0, 4_000_000)).toBeNull();
  });
});
