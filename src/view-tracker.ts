import { IMPRESSION_MIN_MS, VIEW_THRESHOLD_MS, IMPRESSIONS_PER_PING } from "./shared";

export interface AdRef {
  ad_id: string;
  campaign_id: string;
  view_token?: string;
}
export type ViewFlush = (AdRef & { units: number; reachedThreshold: boolean }) | null;

/**
 * Batched view-time accumulator for the statusline / status-bar surface. Accrues
 * one unit per 5s of on-screen time (the 15s threshold also counts as a unit) and
 * returns a flush — carrying the identity of the ad it accrued for — when the
 * buffer reaches IMPRESSIONS_PER_PING or the ad changes / goes off-screen.
 */
export class ViewTracker {
  private current: AdRef | null = null;
  private sessionStart = 0;
  private lastTick = 0;
  private thresholdFired = false;
  private pending = 0;
  private pendingThreshold = false;

  update(adRef: AdRef | null, renderTs: number, now: number, staleMs = 2500): ViewFlush {
    const onScreen = adRef !== null && renderTs > 0 && now - renderTs <= staleMs;

    // Off-screen, or the ad changed → flush whatever we accrued for the prior ad.
    if (!onScreen || (adRef && this.current && adRef.ad_id !== this.current.ad_id)) {
      const flush = this.flushPending();
      if (!onScreen) {
        this.reset();
        return flush;
      }
      // Start the new ad's session (flush above carried the old ad's units).
      this.current = adRef!;
      this.sessionStart = now;
      this.lastTick = now;
      this.thresholdFired = false;
      return flush;
    }

    if (!this.current) {
      // First on-screen frame for this ad.
      this.current = adRef!;
      this.sessionStart = now;
      this.lastTick = now;
      this.thresholdFired = false;
      return null;
    }

    const elapsed = now - this.sessionStart;
    let accrued = false;
    if (!this.thresholdFired && elapsed >= VIEW_THRESHOLD_MS) {
      this.thresholdFired = true;
      this.lastTick = now;
      this.pending += 1;
      this.pendingThreshold = true;
      accrued = true;
    } else if (elapsed >= IMPRESSION_MIN_MS && now - this.lastTick >= IMPRESSION_MIN_MS) {
      this.lastTick = now;
      this.pending += 1;
      accrued = true;
    }
    if (accrued && this.pending >= IMPRESSIONS_PER_PING) return this.flushPending();
    return null;
  }

  private flushPending(): ViewFlush {
    if (this.pending <= 0 || !this.current) {
      this.pending = 0;
      this.pendingThreshold = false;
      return null;
    }
    const f = { ...this.current, units: this.pending, reachedThreshold: this.pendingThreshold };
    this.pending = 0;
    this.pendingThreshold = false;
    return f;
  }

  reset() {
    this.current = null;
    this.sessionStart = 0;
    this.lastTick = 0;
    this.thresholdFired = false;
    this.pending = 0;
    this.pendingThreshold = false;
  }
}
