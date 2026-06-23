import { describe, it, expect } from "vitest";
// poster.mjs is plain ESM (it ships to ~/.spinix); vitest imports it directly.
// Only the pure `decide` state machine is under test — main() is guarded.
import { decide } from "../src/poster.mjs";

const mk = (adId: string, ts: number) => ({
  ad_id: adId,
  campaign_id: `c-${adId}`,
  view_token: `vt-${adId}`,
  ts,
});

describe("poster decide (batched headless CLI metering)", () => {
  it("a fresh ad starts a session without flushing", () => {
    const r = decide(null, mk("a", 1000), 1000);
    expect(r.flush).toBeNull();
    expect(r.state).toMatchObject({ ad_id: "a", session_start: 1000, pending: 0, threshold_fired: false });
  });

  it("accrues units and flushes at IMPRESSIONS_PER_PING with the ad identity", () => {
    let now = 1_000_000;
    let state = null;
    const hb = (ts: number) => ({ ad_id: "a1", campaign_id: "c1", view_token: "vt1", ts });
    ({ state } = decide(state, hb(now), now)); // session start
    let flush = null;
    for (let i = 0; i < 5; i++) { now += 5000; ({ flush, state } = decide(state, hb(now), now)); }
    expect(flush).toMatchObject({ ad_id: "a1", campaign_id: "c1", view_token: "vt1", units: 5 });
  });

  it("accrues silently below the window (no flush until the 5th unit)", () => {
    let now = 500_000;
    let state = null;
    const hb = (ts: number) => ({ ad_id: "a1", campaign_id: "c1", view_token: "vt1", ts });
    ({ state } = decide(state, hb(now), now));
    let flush = null;
    for (let i = 0; i < 4; i++) { now += 5000; ({ flush, state } = decide(state, hb(now), now)); }
    expect(flush).toBeNull();
    expect(state.pending).toBe(4);
  });

  it("flushes the partial when on-screen ends (heartbeat goes stale)", () => {
    let now = 2_000_000;
    let state = null;
    const hb = (ts: number) => ({ ad_id: "a1", campaign_id: "c1", view_token: "vt1", ts });
    ({ state } = decide(state, hb(now), now));
    now += 5000; ({ state } = decide(state, hb(now), now)); // pending=1
    now += 9000; const r = decide(state, hb(now - 9000), now); // stale heartbeat
    expect(r.flush).toMatchObject({ ad_id: "a1", units: 1 });
    expect(r.state.ad_id).toBeNull();
  });

  it("flushes the OLD ad's pending when the ad changes", () => {
    let now = 3_000_000;
    let state = null;
    ({ state } = decide(state, mk("a", now), now));
    now += 5000; ({ state } = decide(state, mk("a", now), now)); // pending=1 for "a"
    const r = decide(state, mk("b", now + 100), now + 100);     // ad changes
    expect(r.flush).toMatchObject({ ad_id: "a", units: 1 });
    expect(r.state).toMatchObject({ ad_id: "b", pending: 0 });
  });

  it("a missing heartbeat flushes pending then resets cleanly", () => {
    let now = 4_000_000;
    let state = null;
    ({ state } = decide(state, mk("a", now), now));
    now += 5000; ({ state } = decide(state, mk("a", now), now)); // pending=1
    const r = decide(state, null, now + 1000);
    expect(r.flush).toMatchObject({ ad_id: "a", units: 1 });
    expect(r.state.ad_id).toBeNull();
  });
});
