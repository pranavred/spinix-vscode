#!/usr/bin/env node
// Spinix headless meter (installed to ~/.spinix/poster.mjs).
// Spawned (detached) by statusline.mjs so pure-CLI users — no VS Code open —
// still get killswitch checks, fresh ads/view-tokens, and credited views.
// State machine mirrors the extension's ViewTracker: one view_tick per 5s of
// continuous on-screen time, one view_threshold_met at 15s per ad session.
// The server's cooldown gate dedupes if the VS Code extension is also posting.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto"; // explicit: the `crypto` global is unreliable on Node 18

const DIR = join(homedir(), ".spinix");
const IMPRESSION_MIN_MS = 5000;
const VIEW_THRESHOLD_MS = 15000;
const HEARTBEAT_STALE_MS = 2500;
const IMPRESSIONS_PER_PING = 5; // = PING_WINDOW_MS / IMPRESSION_MIN_MS (kept in sync with @spinix/shared)
const PORTFOLIO_TTL_MS = 60_000;
const KILLSWITCH_TTL_MS = 60_000;

export function readJson(name) {
  try {
    return JSON.parse(readFileSync(join(DIR, name), "utf8"));
  } catch {
    return null;
  }
}

function writeJson(name, value) {
  try {
    writeFileSync(join(DIR, name), JSON.stringify(value));
  } catch {}
}

/**
 * Pure batched metering decision. state: {ad_id, campaign_id, view_token,
 * session_start, last_tick, threshold_fired, pending, pending_threshold}
 * hb: render heartbeat {ad_id, campaign_id, view_token, ts}. Returns
 * {flush: {units, reachedThreshold, ad_id, campaign_id, view_token} | null, state}.
 */
export function decide(state, hb, now) {
  const onScreen = hb && hb.ad_id && Number.isFinite(hb.ts) && now - hb.ts <= HEARTBEAT_STALE_MS;
  const flushOf = (s) =>
    s && s.pending > 0
      ? { units: s.pending, reachedThreshold: !!s.pending_threshold, ad_id: s.ad_id, campaign_id: s.campaign_id, view_token: s.view_token }
      : null;
  const empty = { ad_id: null, campaign_id: null, view_token: null, session_start: 0, last_tick: 0, threshold_fired: false, pending: 0, pending_threshold: false };

  if (!onScreen) {
    return { flush: flushOf(state), state: empty };
  }
  if (!state || state.ad_id !== hb.ad_id) {
    const flush = state && state.ad_id !== hb.ad_id ? flushOf(state) : null;
    return {
      flush,
      state: { ad_id: hb.ad_id, campaign_id: hb.campaign_id, view_token: hb.view_token, session_start: now, last_tick: now, threshold_fired: false, pending: 0, pending_threshold: false },
    };
  }
  const s = { ...state };
  const elapsed = now - s.session_start;
  let accrued = false;
  if (!s.threshold_fired && elapsed >= VIEW_THRESHOLD_MS) {
    s.threshold_fired = true; s.last_tick = now; s.pending += 1; s.pending_threshold = true; accrued = true;
  } else if (elapsed >= IMPRESSION_MIN_MS && now - s.last_tick >= IMPRESSION_MIN_MS) {
    s.last_tick = now; s.pending += 1; accrued = true;
  }
  if (accrued && s.pending >= IMPRESSIONS_PER_PING) {
    const flush = flushOf(s);
    return { flush, state: { ...s, pending: 0, pending_threshold: false } };
  }
  return { flush: null, state: s };
}

/** Only ever send the bearer to the real Spinix host over https (localhost ok
 *  in dev). Mirrors src/backend-url.ts; the auth.json we read could be tampered. */
function allowedBackend(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const local = host === "localhost" || host === "127.0.0.1";
    if (!local && u.protocol !== "https:") return false;
    return local || host === "spinixads.com" || host === "www.spinixads.com";
  } catch { return false; }
}

async function main() {
  const auth = readJson("auth.json");
  if (!auth || !auth.token || !auth.backend_url) return;
  if (!allowedBackend(auth.backend_url)) return; // never send the bearer off-host
  const backend = String(auth.backend_url).replace(/\/$/, "");
  const meta = readJson("meter-state.json") ?? {};
  const now = Date.now();

  // 1 — killswitch (cached 60s; fail-safe: any error counts as killed).
  // The killed STATE must be remembered, not just the check timestamp —
  // otherwise the next run skips the cached check and its portfolio refresh
  // resurrects the ad while the network is supposed to be dark.
  if (!meta.ks_checked || now - meta.ks_checked > KILLSWITCH_TTL_MS) {
    meta.ks_checked = now;
    try {
      const r = await fetch(`${backend}/v1/killswitch`, { signal: AbortSignal.timeout(3000) });
      const j = await r.json();
      meta.killed = !r.ok || j.killed === true;
    } catch {
      meta.killed = true;
    }
  }
  if (meta.killed) {
    writeJson("cli-ad.json", {});
    writeJson("meter-state.json", meta);
    return;
  }

  // 2 — refresh the cached ad + view token when stale (CLI-only users have no
  // extension portfolio loop; an expired view token earns nothing).
  const ad = readJson("cli-ad.json");
  if (!meta.pf_fetched || now - meta.pf_fetched > PORTFOLIO_TTL_MS || !ad?.view_token) {
    try {
      const clientId = readFileSync(join(DIR, "client-id"), "utf8").trim();
      const r = await fetch(`${backend}/v1/portfolio?client_id=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        const j = await r.json();
        writeJson("cli-ad.json", j.ads?.[0] ?? {});
        meta.pf_fetched = now;
      } else {
        writeJson("cli-ad.json", {}); // non-OK: fail closed, no stale ad
      }
    } catch {
      writeJson("cli-ad.json", {}); // network dark: fail closed (matches the extension)
    }
  }

  // 3 — meter the render heartbeat into BATCHED billable pings.
  const hb = readJson("render.json");
  const { flush, state } = decide(meta.view ?? null, hb, now);
  meta.view = state;
  writeJson("meter-state.json", meta);
  if (!flush) return;

  try {
    const clientId = readFileSync(join(DIR, "client-id"), "utf8").trim();
    await fetch(`${backend}/v1/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({
        event_type: "view_tick",
        ad_id: flush.ad_id,
        campaign_id: flush.campaign_id,
        client_id: clientId,
        ts: new Date().toISOString(),
        nonce: randomUUID(),
        units: flush.units,
        session_token: flush.view_token,
        surface: "statusline-cli",
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {}
}

// True when this file is the process entrypoint. Robust to Windows backslash
// paths (the old `split("/")` never matched a "C:\\...\\poster.mjs" basename, so
// the meter silently never ran on Windows). Exported for a test.
export function isEntrypoint(argv1, metaUrl) {
  if (!argv1) return false;
  const base = argv1.split(/[/\\]/).pop() ?? "";
  return base !== "" && metaUrl.endsWith("/" + base);
}

// Only run the loop when executed directly (vitest imports the pure parts).
if (isEntrypoint(process.argv[1], import.meta.url)) {
  main().catch(() => {});
}
