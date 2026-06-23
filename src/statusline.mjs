#!/usr/bin/env node
// Spinix statusline script (installed to ~/.spinix/statusline.mjs).
// Claude Code runs this on each statusline refresh and prints stdout verbatim.
// It reads the current cached ad and renders it as a single OSC 8 hyperlink,
// and — ONLY while a turn is actually in flight — drops a render heartbeat used
// to meter on-screen time and (throttled) spawns the detached headless meter.
// Rendering is always on (the line shows in the status bar); METERING is gated
// on real agent activity so an idle, open editor never bills anyone.
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".spinix");
const POSTER_EVERY_MS = 4500;
// We meter only while the session looks ACTIVE, judged by how recently Claude
// Code wrote the session transcript. Validated against a live session: those
// writes are sparse (batched around turns, ~1-2 min apart), and a single agent
// turn can run several minutes with no write — so a tight window would mark an
// actively-working session "idle" and UNDER-count real impressions. There is no
// precise "spinner is spinning now" signal for a one-shot CLI statusline, so
// this is deliberately a coarse "is the session abandoned?" gate: a window wide
// enough to never drop during active use, which still stops the real waste
// (an editor left open and idle for a long time). The backend (per-impression
// counters off KV + the daily cap) is the actual cost guarantee; this just
// trims egregious idle. Fails open if the signal is unavailable.
const ACTIVITY_WINDOW_MS = 600_000; // 10 minutes

/** Pure freshness gate (unit-tested): a recent transcript write = active turn. */
export function agentBusy(transcriptMtimeMs, nowMs, windowMs = ACTIVITY_WINDOW_MS) {
  return Number.isFinite(transcriptMtimeMs) && transcriptMtimeMs > 0 && nowMs - transcriptMtimeMs <= windowMs;
}

/**
 * Is an agent turn actually in flight right now? Claude Code pipes its
 * statusLine JSON (with `transcript_path`) on stdin; we stat that file's mtime.
 * Fail-open (return true) only when we genuinely cannot tell — e.g. no stdin or
 * no transcript_path — so metering is never silently broken; the per-impression
 * cost is already off KV and bounded by the server-side cap.
 */
function turnInFlight(now) {
  try {
    if (process.stdin.isTTY) return true; // run without piped input: can't tell
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    const p = input && typeof input.transcript_path === "string" ? input.transcript_path : null;
    if (!p) return true; // older Claude Code without the field: don't break metering
    try {
      return agentBusy(statSync(p).mtimeMs, now);
    } catch {
      return false; // path provided but unreadable/missing => treat as idle
    }
  } catch {
    return true; // unreadable stdin => fail open
  }
}

function spawnPosterThrottled() {
  const tsFile = join(DIR, "poster-spawn.json");
  const poster = join(DIR, "poster.mjs");
  try {
    if (!existsSync(join(DIR, "auth.json")) || !existsSync(poster)) return;
    const last = existsSync(tsFile) ? JSON.parse(readFileSync(tsFile, "utf8")).ts ?? 0 : 0;
    if (Date.now() - last < POSTER_EVERY_MS) return;
    writeFileSync(tsFile, JSON.stringify({ ts: Date.now() }));
    spawn(process.execPath, [poster], { detached: true, stdio: "ignore" }).unref();
  } catch {}
}

function osc8(url, text) {
  const ESC = "]8;;";
  const BEL = "";
  return `${ESC}${url}${BEL}${text}${ESC}${BEL}`;
}

// True when this file is the process entrypoint. Robust to Windows backslash
// paths: the old `split("/")` never matched a "C:\\...\\statusline.mjs" basename
// against the forward-slash import.meta.url, so the whole script silently
// no-opped on Windows (no statusline, no metering). Exported for a test.
export function isEntrypoint(argv1, metaUrl) {
  if (!argv1) return false;
  const base = argv1.split(/[/\\]/).pop() ?? "";
  return base !== "" && metaUrl.endsWith("/" + base);
}

// Run only when executed directly (vitest imports the pure helpers above).
if (isEntrypoint(process.argv[1], import.meta.url)) {
  const busy = turnInFlight(Date.now());
  try {
    const ad = JSON.parse(readFileSync(join(DIR, "cli-ad.json"), "utf8"));
    if (ad && ad.ad_text && ad.click_url) {
      // Meter ONLY during an active turn: the heartbeat is what the poster reads
      // to credit an impression. An idle editor renders the line but bills nothing.
      if (busy) {
        try {
          writeFileSync(
            join(DIR, "render.json"),
            JSON.stringify({ ad_id: ad.ad_id, campaign_id: ad.campaign_id, view_token: ad.view_token, ts: Date.now(), surface: "statusline" }),
          );
        } catch {}
        spawnPosterThrottled();
      }
      const brand = ad.brand ? `${ad.brand} — ` : "";
      process.stdout.write(osc8(ad.click_url, `✶ ${brand}${ad.ad_text} ↗`));
      process.exit(0);
    }
  } catch {
    // No ad cached — print nothing so Claude Code shows its normal status.
  }
  // No ad rendered — still let the headless meter refresh the cache/killswitch
  // while a turn is active (it no-ops without auth.json).
  if (busy) spawnPosterThrottled();
  process.exit(0);
}
