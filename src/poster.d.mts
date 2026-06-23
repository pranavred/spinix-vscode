export interface MeterViewState {
  ad_id: string | null;
  campaign_id: string | null;
  view_token: string | null;
  session_start: number;
  last_tick: number;
  threshold_fired: boolean;
  pending: number;
  pending_threshold: boolean;
}

export interface RenderHeartbeat {
  ad_id: string;
  campaign_id: string;
  view_token?: string;
  ts: number;
}

/** A batched flush carries the identity of the ad it accrued for, so units
 *  posted at an ad-change / off-screen boundary bill the PRIOR ad, not the
 *  current heartbeat. */
export interface ViewFlush {
  units: number;
  reachedThreshold: boolean;
  ad_id: string | null;
  campaign_id: string | null;
  view_token: string | null;
}

export function decide(
  state: MeterViewState | null,
  hb: RenderHeartbeat | null,
  now: number,
): { flush: ViewFlush | null; state: MeterViewState };

export function readJson(name: string): unknown;
