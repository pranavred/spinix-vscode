#!/usr/bin/env node
// Spinix notify-on-done (installed to ~/.spinix/notify.mjs).
// Wired as Claude Code hooks: UserPromptSubmit -> `node notify.mjs start`,
// Stop -> `node notify.mjs done`. On "done" it (1) fires a desktop notification
// when a turn ran long enough that you probably walked away, and (2) reports the
// turn's thinking time to the backend (signed-in only) for the "who made the AI
// think the most" board. Metadata only: it drains and discards the hook's stdin
// payload — it never reads your code, prompts, or transcript.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto"; // explicit: the `crypto` global is unreliable on Node 18

const DIR = join(homedir(), ".spinix");
const TURN = join(DIR, "turn.json");
const PREFS = join(DIR, "prefs.json");
const NOTIFY_MIN_MS = 30_000; // don't ping for sub-30s turns
const THINK_PER_TURN_MAX_MS = 30 * 60 * 1000;

export function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/** Notify only for turns long enough that you likely stepped away. Pure. */
export function shouldNotify(startMs, nowMs, min = NOTIFY_MIN_MS) {
  return Number.isFinite(startMs) && startMs > 0 && nowMs - startMs >= min;
}

/** Think time to credit for a turn: 0 without a start, else elapsed clamped. Pure. */
export function thinkMsFor(startMs, nowMs, max = THINK_PER_TURN_MAX_MS) {
  if (!Number.isFinite(startMs) || startMs <= 0) return 0;
  return Math.max(0, Math.min(nowMs - startMs, max));
}

/**
 * Whether the desktop notification should fire, given ~/.spinix/prefs.json.
 * Default-on: only an explicit `{ notify: false }` silences the popup. The
 * Stop hook stays installed regardless, so think-time always still accrues. Pure.
 */
export function notifyEnabled(prefs) {
  return !prefs || prefs.notify !== false;
}

function winToast(title, message) {
  const t = String(title).replace(/'/g, "''");
  const m = String(message).replace(/'/g, "''");
  // Best-effort, untested on CI: BurntToast if present, else a tray balloon.
  return `try { Import-Module BurntToast -ErrorAction Stop; New-BurntToastNotification -Text '${t}','${m}' } ` +
    `catch { Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; ` +
    `$n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; ` +
    `$n.ShowBalloonTip(4000,'${t}','${m}',[System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 4; $n.Dispose() }`;
}

function fireNotification(title, message) {
  const p = platform();
  // Spawn ENOENT (missing notifier binary, e.g. headless Linux) is emitted as an
  // async 'error' event, NOT caught by try/catch — without a handler it crashes
  // the hook and drops the think-time report. Swallow it on every child.
  const spawnSafe = (cmd, args) => {
    try {
      const c = spawn(cmd, args, { stdio: "ignore", detached: true });
      c.on("error", () => {});
      c.unref();
    } catch { /* best-effort */ }
  };
  if (p === "darwin") {
    spawnSafe("osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
  } else if (p === "linux") {
    spawnSafe("notify-send", ["-a", "Spinix", title, message]);
  } else if (p === "win32") {
    spawnSafe("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", winToast(title, message)]);
  }
}

async function drainStdin() {
  try { for await (const chunk of process.stdin) { void chunk; } } catch { /* ignore */ }
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

async function reportThinkTime(ms) {
  const auth = readJson(join(DIR, "auth.json"));
  if (!auth || !auth.token || !auth.backend_url) return; // not signed in → no accrual
  if (!allowedBackend(auth.backend_url)) return; // never send the bearer off-host
  let clientId = "";
  try { clientId = readFileSync(join(DIR, "client-id"), "utf8").trim(); } catch { /* optional */ }
  try {
    await fetch(`${String(auth.backend_url).replace(/\/$/, "")}/v1/think`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ think_ms: ms, client_id: clientId, nonce: randomUUID() }),
      signal: AbortSignal.timeout(2500),
    });
  } catch { /* best-effort */ }
}

async function main(mode) {
  await drainStdin(); // consume (and discard) the hook payload
  if (mode === "start") {
    try { writeFileSync(TURN, JSON.stringify({ start: Date.now() })); } catch { /* ignore */ }
    return;
  }
  // mode === "done"
  const turn = readJson(TURN);
  const now = Date.now();
  const startMs = turn && Number.isFinite(turn.start) ? turn.start : 0;
  try { rmSync(TURN, { force: true }); } catch { /* ignore */ }

  // The popup is independently toggleable (~/.spinix/prefs.json {notify}); the
  // Stop hook stays installed regardless, so think-time always accrues below.
  if (shouldNotify(startMs, now) && notifyEnabled(readJson(PREFS))) {
    fireNotification("✶ Spinix", "Your agent finished thinking — come on back.");
  }
  const ms = thinkMsFor(startMs, now);
  if (ms > 0) await reportThinkTime(ms);
}

// True when this file is the process entrypoint. Robust to Windows backslash
// paths (the old `split("/")` never matched a "C:\\...\\notify.mjs" basename, so
// notify + think-time reporting silently never ran on Windows). Exported for a test.
export function isEntrypoint(argv1, metaUrl) {
  if (!argv1) return false;
  const base = argv1.split(/[/\\]/).pop() ?? "";
  return base !== "" && metaUrl.endsWith("/" + base);
}

// Run only when executed directly; tests import the pure helpers above.
if (isEntrypoint(process.argv[1], import.meta.url)) {
  main(process.argv[2] === "start" ? "start" : "done").catch(() => {});
}
