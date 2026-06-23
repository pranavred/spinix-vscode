import * as vscode from "vscode";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyAdSettings, applyHookSettings, restoreSettings, parsesAsObject, priorAdSettings } from "./settings-edit";
import { refreshPortfolio } from "./portfolio";
import { postMetric } from "./metrics";
import { ViewTracker } from "./view-tracker";
import { AgentActivityWatcher } from "./busy-watch";
import { Telemetry } from "./telemetry";
import {
  startDeviceLink,
  pollDeviceLink,
  getToken,
  setToken,
  clearToken,
  exportCliAuth,
  clearCliAuth,
} from "./auth";

const SPINIX_DIR = join(homedir(), ".spinix");
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");
const SETTINGS_BACKUP = join(SPINIX_DIR, "claude-settings.backup.json");
const CLIENT_ID_FILE = join(SPINIX_DIR, "client-id");

let statusBar: vscode.StatusBarItem;
let adBar: vscode.StatusBarItem;
let timers: NodeJS.Timeout[] = [];
let isDeactivating = false;
let tel: Telemetry;
const tracker = new ViewTracker();
const activity = new AgentActivityWatcher();

function cfg() {
  const c = vscode.workspace.getConfiguration("spinix");
  return {
    backendUrl: (c.get<string>("backendUrl") ?? "").replace(/\/$/, ""),
    enabled: c.get<boolean>("enabled") ?? true,
    notify: c.get<boolean>("notify") ?? true,
  };
}

function ensureDir() {
  // Best-effort + private (0700): a read-only/full home must not abort activation.
  try {
    if (!existsSync(SPINIX_DIR)) mkdirSync(SPINIX_DIR, { recursive: true, mode: 0o700 });
  } catch {}
}

/** Mirror the `spinix.notify` setting into ~/.spinix/prefs.json so notify.mjs
 *  (a standalone Stop hook, no VS Code API) can read it live. The Stop hook
 *  itself stays installed regardless — only the desktop popup is toggled. */
function writePrefs() {
  ensureDir();
  try {
    writeFileSync(join(SPINIX_DIR, "prefs.json"), JSON.stringify({ notify: cfg().notify }));
  } catch {}
}

function clientId(): string {
  ensureDir();
  if (existsSync(CLIENT_ID_FILE)) return readFileSync(CLIENT_ID_FILE, "utf8").trim();
  const id = `client_${crypto.randomUUID()}`;
  writeFileSync(CLIENT_ID_FILE, id);
  return id;
}

/** Install the statusline script and patch Claude Code settings (reversible). */
function installIntegration(ctx: vscode.ExtensionContext) {
  ensureDir();
  writePrefs(); // keep prefs.json in sync with the notify setting
  // Copy the bundled statusline script next to the cache.
  const scriptSrc = join(ctx.extensionPath, "dist", "statusline.mjs");
  const scriptDst = join(SPINIX_DIR, "statusline.mjs");
  const notifyDst = join(SPINIX_DIR, "notify.mjs");
  try {
    if (existsSync(scriptSrc)) copyFileSync(scriptSrc, scriptDst);
    const posterSrc = join(ctx.extensionPath, "dist", "poster.mjs");
    if (existsSync(posterSrc)) copyFileSync(posterSrc, join(SPINIX_DIR, "poster.mjs"));
    const notifySrc = join(ctx.extensionPath, "dist", "notify.mjs");
    if (existsSync(notifySrc)) copyFileSync(notifySrc, notifyDst);
  } catch {}

  if (!existsSync(join(homedir(), ".claude"))) {
    tel?.send("claude_missing", { once: "claude_missing" });
    // Tell the user once, instead of a silent no-op that reads as "broken".
    if (!ctx.globalState.get<boolean>("spinix.claudeMissingShown")) {
      void ctx.globalState.update("spinix.claudeMissingShown", true);
      void vscode.window.showInformationMessage(
        'Spinix didn\'t find Claude Code (~/.claude). The desktop ping and the spinner line need Claude Code installed and run once — install it, then run "Spinix: Enable".',
      );
    }
    return; // Claude Code not installed
  }
  try {
    const raw = existsSync(CLAUDE_SETTINGS) ? readFileSync(CLAUDE_SETTINGS, "utf8") : "{}";
    // Never mutate a settings.json we can't parse: a half-saved or hand-broken
    // file would be turned into a worse, fully-broken one with no rollback.
    if (!parsesAsObject(raw)) {
      tel?.send("error", { code: "settings_unparseable", once: "settings_unparseable" });
      return;
    }
    if (!existsSync(SETTINGS_BACKUP)) writeFileSync(SETTINGS_BACKUP, raw);

    let next = applyAdSettings(raw, {
      // Quote the path: an unquoted `node ${scriptDst}` breaks the moment the
      // home dir has a space (common on Windows), matching the notify commands.
      statusLineCommand: `node "${scriptDst}"`,
      // Speak to the audience watching the spinner — indie builders shipping
      // products — and lead with what the ring gives them: free distribution.
      verbs: ["Spinix — free reach for the thing you shipped ↗"],
    });
    // Notify-on-done: the Stop hook reports the turn's thinking time for the
    // "made the AI think the most" board and fires a desktop ping when you've
    // likely walked away. The hook stays installed whenever Spinix is enabled
    // so think-time always accrues; the popup itself is toggled live via the
    // `spinix.notify` setting (mirrored to ~/.spinix/prefs.json, read by the hook).
    next = applyHookSettings(next, {
      startCommand: `node "${notifyDst}" start`,
      doneCommand: `node "${notifyDst}" done`,
    });
    // Final guard: only write if the result still parses cleanly.
    if (!parsesAsObject(next)) {
      tel?.send("error", { code: "settings_write_unsafe", once: "settings_write_unsafe" });
      return;
    }
    writeFileSync(CLAUDE_SETTINGS, next);
    tel?.send("integration_installed", { once: "integration_installed" });
  } catch {
    tel?.send("error", { code: "settings_write_failed" });
  }
}

function restoreIntegration() {
  // Must never throw out of disable/restore/activate. Restore the user's prior
  // statusLine/spinnerVerbs (captured in the backup at first install) rather
  // than deleting them.
  try {
    if (!existsSync(CLAUDE_SETTINGS)) return;
    const raw = readFileSync(CLAUDE_SETTINGS, "utf8");
    let prior: { statusLine?: unknown; spinnerVerbs?: unknown } | undefined;
    if (existsSync(SETTINGS_BACKUP)) {
      try {
        prior = priorAdSettings(readFileSync(SETTINGS_BACKUP, "utf8"));
      } catch {}
    }
    writeFileSync(CLAUDE_SETTINGS, restoreSettings(raw, prior));
  } catch {
    tel?.send("error", { code: "settings_write_failed" });
  }
}

function readRenderHeartbeat(): { ad_id: string; campaign_id: string; view_token?: string; ts: number; surface?: string } | null {
  try {
    return JSON.parse(readFileSync(join(SPINIX_DIR, "render.json"), "utf8"));
  } catch {
    return null;
  }
}

function readCachedAd(): { ad_id: string; campaign_id: string; ad_text: string; click_url: string; brand?: string | null; view_token?: string } | null {
  try {
    const ad = JSON.parse(readFileSync(join(SPINIX_DIR, "cli-ad.json"), "utf8"));
    return ad && ad.ad_text && ad.click_url ? ad : null;
  } catch {
    return null;
  }
}

/**
 * Render surface for agents with no statusline hook: the Claude Code VS Code
 * panel (ignores statusLine entirely) and Codex CLI (no custom status-line
 * command). While the busy-watcher sees a turn in flight and this window is
 * focused, show the ad in the VS Code status bar and write the same render
 * heartbeat the metering pipeline already consumes — unless the real
 * statusline just wrote one (terminal session in front).
 */
function adBarLoop() {
  if (isDeactivating) return;
  const { enabled } = cfg();
  const now = Date.now();
  const source = activity.activeSource(now);
  const ad = readCachedAd();
  if (!enabled || !source || !ad || !vscode.window.state.focused) {
    adBar.hide();
    return;
  }
  const brand = ad.brand ? `${ad.brand} — ` : "";
  adBar.text = `✶ ${brand}${ad.ad_text} ↗`;
  adBar.tooltip = `Sponsored · ${ad.click_url}`;
  adBar.command = "spinix.openAd";
  adBar.show();

  const hb = readRenderHeartbeat();
  if (!hb || now - hb.ts > 1500) {
    try {
      writeFileSync(
        join(SPINIX_DIR, "render.json"),
        JSON.stringify({
          ad_id: ad.ad_id,
          campaign_id: ad.campaign_id,
          view_token: ad.view_token,
          ts: now,
          surface: source === "codex" ? "codex-vscode" : "claude-panel",
        }),
      );
    } catch {}
  }
}

async function openAd(ctx: vscode.ExtensionContext) {
  const ad = readCachedAd();
  if (!ad) return;
  await vscode.env.openExternal(vscode.Uri.parse(ad.click_url));
  const token = await getToken(ctx);
  void postMetric(cfg().backendUrl, token, {
    event_type: "click",
    ad_id: ad.ad_id,
    campaign_id: ad.campaign_id,
    client_id: clientId(),
    ts: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    session_token: ad.view_token,
    surface: "vscode-statusbar",
  });
}

async function setStatus(ctx: vscode.ExtensionContext) {
  const { backendUrl } = cfg();
  const token = await getToken(ctx);
  if (!token) {
    statusBar.text = "$(rss) Spinix: Sign in";
    statusBar.tooltip = "Sign in to rank on the think-time board and promote your product in the ring — click to link this editor.";
    statusBar.command = "spinix.signIn";
    return;
  }
  void backendUrl;
  statusBar.text = "$(rss) Spinix: on";
  statusBar.tooltip = "Perks from AI companies during the wait · we ping you when your agent's done — click for status.";
  statusBar.command = "spinix.status";
}

async function meterLoop(ctx: vscode.ExtensionContext) {
  if (isDeactivating) return;
  const { backendUrl, enabled } = cfg();
  if (!enabled) return;
  const token = await getToken(ctx);
  const hb = readRenderHeartbeat();
  const renderTs = hb?.ts ?? 0;
  if (hb?.surface && Date.now() - renderTs <= 2500) {
    tel?.send("first_render", { surface: hb.surface, once: `fr:${hb.surface}` });
  }
  const adRef = hb && hb.ad_id ? { ad_id: hb.ad_id, campaign_id: hb.campaign_id, view_token: hb.view_token } : null;
  const flush = tracker.update(adRef, renderTs, Date.now());
  if (flush) {
    await postMetric(backendUrl, token, {
      event_type: "view_tick",
      ad_id: flush.ad_id,
      campaign_id: flush.campaign_id,
      client_id: clientId(),
      ts: new Date().toISOString(),
      nonce: crypto.randomUUID(),
      units: flush.units, // signed view token bound this ad to (user,campaign)
      session_token: flush.view_token,
      surface: hb?.surface ?? "statusline",
    });
  }
}

async function portfolioLoop(ctx: vscode.ExtensionContext) {
  if (isDeactivating) return;
  const { backendUrl, enabled } = cfg();
  ensureDir();
  if (!enabled) {
    writeFileSync(join(SPINIX_DIR, "cli-ad.json"), JSON.stringify({}));
    return;
  }
  // The killswitch is enforced server-side now (/v1/portfolio returns no ads and
  // a killed flag when tripped; /v1/metrics refuses to bill), so we no longer
  // make a separate killswitch request each cycle. One fetch covers both serving
  // and the kill, and refreshPortfolio blanks the cache on killed/empty/error.
  const token = await getToken(ctx);
  const pf = await refreshPortfolio(backendUrl, SPINIX_DIR, token, clientId());
  if (pf && (pf.killed || pf.ads.length === 0)) {
    tel?.send("portfolio_empty", { once: "portfolio_empty" });
  }
}

async function signIn(ctx: vscode.ExtensionContext) {
  const { backendUrl } = cfg();
  tel?.send("signin_started");
  const start = await startDeviceLink(backendUrl, clientId());
  if (!start) {
    tel?.send("error", { code: "devicelink_start_failed" });
    vscode.window.showErrorMessage("Spinix: could not reach the backend.");
    return;
  }
  // Show the code the user must type on /link after signing in. Linking only
  // succeeds for a code THIS extension generated, so a phished page can't link
  // an attacker's code; the verifier (held here) gates token retrieval.
  const shown = start.user_code.replace(/(.{4})(.{4})/, "$1-$2");
  void vscode.env.clipboard.writeText(shown);
  vscode.window
    .showInformationMessage(`Spinix: sign in, then enter this code to link your editor — ${shown} (copied).`, "Copy code")
    .then((a) => { if (a === "Copy code") void vscode.env.clipboard.writeText(shown); });
  await vscode.env.openExternal(vscode.Uri.parse(start.verify_url));
  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Spinix: enter code ${shown} in your browser to link…` },
    async () => {
      // Poll for the full server code lifetime (600s). A shorter window than the
      // server's TTL stranded users who took the sign-in detour: the web said
      // "linked" while the editor had already given up and never fetched the token.
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const token = await pollDeviceLink(backendUrl, start.code, start.verifier);
        if (token) {
          await setToken(ctx, token);
          exportCliAuth(token, backendUrl); // headless CLI meter (~/.spinix/poster.mjs)
          void portfolioLoop(ctx); // fetch the first ad now, not on the next 120s tick
          await postMetric(backendUrl, token, {
            event_type: "prompt_view",
            ad_id: "consent",
            campaign_id: "consent",
            client_id: clientId(),
            ts: new Date().toISOString(),
            nonce: crypto.randomUUID(),
          }).catch(() => null);
          await setStatus(ctx);
          tel?.send("signin_linked");
          vscode.window.showInformationMessage("Spinix: signed in — your think-time now counts on the board, and you can promote your product in the ring.");
          return;
        }
      }
      tel?.send("signin_timeout");
      vscode.window.showWarningMessage("Spinix: sign-in timed out. Try again.");
    },
  );
}

export async function activate(ctx: vscode.ExtensionContext) {
  // Diagnostics: closed-enum lifecycle events, first-party only, and silent
  // whenever the user has telemetry off in VS Code. See src/telemetry.ts.
  tel = new Telemetry({
    backendUrl: () => cfg().backendUrl,
    clientId,
    version: String(ctx.extension.packageJSON.version ?? "0.0.0"),
    platform: process.platform,
    enabled: () => vscode.env.isTelemetryEnabled,
    // No diagnostics before the user accepts the first-run consent.
    consented: () => ctx.globalState.get<boolean>("spinix.consented") === true,
  });
  tel.send("activated");

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = "$(rss) Spinix";
  statusBar.show();
  ctx.subscriptions.push(statusBar);

  // Register commands BEFORE the consent gate below. That gate can return early
  // (a remembered decline, or anything other than "Agree"); registration used to
  // live after those returns, so a user who declined got NO commands at all —
  // including "Spinix: Enable", the documented way back in. They're always live now.
  ctx.subscriptions.push(
    vscode.commands.registerCommand("spinix.signIn", () => signIn(ctx)),
    vscode.commands.registerCommand("spinix.signOut", async () => {
      await clearToken(ctx);
      clearCliAuth();
      await setStatus(ctx);
      vscode.window.showInformationMessage("Spinix: signed out.");
    }),
    vscode.commands.registerCommand("spinix.openAd", () => void openAd(ctx)),
    vscode.commands.registerCommand("spinix.restore", () => {
      restoreIntegration();
      tel.send("restore_run");
      vscode.window.showInformationMessage("Spinix: restored Claude Code settings.");
    }),
    vscode.commands.registerCommand("spinix.status", async () => {
      const signedIn = !!(await getToken(ctx));
      const action = await vscode.window.showInformationMessage(
        signedIn
          ? "Spinix — on. We ping you when your agent's done, and your think-time ranks on the board. Perks appear in the spinner as advertisers come online."
          : "Spinix — sign in to rank on the board and promote your product in the ring.",
        signedIn ? "Open dashboard" : "Sign in",
      );
      if (action === "Open dashboard") {
        void vscode.env.openExternal(vscode.Uri.parse(`${cfg().backendUrl}/dashboard`));
      } else if (action === "Sign in") {
        void signIn(ctx);
      }
    }),
    vscode.commands.registerCommand("spinix.enable", async () => {
      // Explicitly enabling IS consent — also the recovery path after a decline.
      await ctx.globalState.update("spinix.consented", true);
      await ctx.globalState.update("spinix.declined", false);
      await vscode.workspace.getConfiguration("spinix").update("enabled", true, true);
      installIntegration(ctx);
      await setStatus(ctx);
    }),
    vscode.commands.registerCommand("spinix.disable", async () => {
      await vscode.workspace.getConfiguration("spinix").update("enabled", false, true);
      restoreIntegration();
      clearCliAuth();
      adBar?.hide(); // may run before adBar is created on a very slow activation
      tel.send("disabled");
    }),
    // Live settings: flip the notify popup or the whole integration without a reload.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("spinix.notify")) {
        writePrefs(); // the Stop hook reads this on its next "done" — no reinstall needed
      }
      if (e.affectsConfiguration("spinix.enabled")) {
        if (cfg().enabled) {
          installIntegration(ctx);
        } else {
          restoreIntegration();
          clearCliAuth();
          adBar?.hide();
        }
      }
    }),
  );

  // First-run consent before touching any settings.
  const consented = ctx.globalState.get<boolean>("spinix.consented") === true;
  const declined = ctx.globalState.get<boolean>("spinix.declined") === true;
  // A prior decline is remembered — never nag on every launch, and never install
  // without consent. The user can opt in later via "Spinix: Enable".
  if (declined && !consented) {
    statusBar.text = "$(rss) Spinix: disabled";
    return;
  }
  let justAgreed = false;
  if (!consented) {
    let choice: string | undefined;
    // Reading the privacy page must NOT count as declining — re-ask afterward.
    for (;;) {
      choice = await vscode.window.showInformationMessage(
        "Spinix pings you the moment your agent finishes — and fills the wait with one subtle line of perks & offers from the AI companies trying to reach developers. It never reads your code or prompts. Continue?",
        "Agree",
        "Privacy",
      );
      if (choice === "Privacy") {
        void vscode.env.openExternal(vscode.Uri.parse(`${cfg().backendUrl}/privacy`));
        continue;
      }
      break;
    }
    if (choice !== "Agree") {
      // Remember the decline so we don't re-prompt every launch; the telemetry
      // gate keeps `consented` false, so we emit no beacon for an opt-out.
      await ctx.globalState.update("spinix.declined", true);
      statusBar.text = "$(rss) Spinix: disabled";
      return;
    }
    // Record consent BEFORE the first send so the gate lets consent_accepted
    // (and every later event) through — otherwise the very signal that the user
    // agreed would itself be suppressed.
    await ctx.globalState.update("spinix.consented", true);
    await ctx.globalState.update("spinix.declined", false);
    tel.send("consent_accepted");
    justAgreed = true;
  }

  // Respect a disabled state across restarts. Re-patching Claude settings on
  // every activation regardless of `enabled` silently re-enabled Spinix after
  // the user turned it off (and re-mutated ~/.claude/settings.json).
  if (cfg().enabled) installIntegration(ctx);
  else restoreIntegration();
  await setStatus(ctx);

  // First run: notify works now; nudge sign-in (the path to the board + the
  // ring) and warn about the one-time Claude Code restart. Only when just
  // agreed and still signed out, so it's never a recurring nag.
  if (justAgreed && !(await getToken(ctx))) {
    void vscode.window
      .showInformationMessage(
        "Spinix is on — you'll get a desktop ping when a long turn finishes. Sign in to rank on the think-time board and promote your product in the ring. If Claude Code is already running, restart it once so the notifier loads.",
        "Sign in",
        "Later",
      )
      .then((a) => {
        if (a === "Sign in") void signIn(ctx);
      });
  }

  // Status-bar ad surface for agents without a statusline hook
  // (Claude Code VS Code panel, Codex CLI) — driven by the busy-watcher.
  adBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1000);
  ctx.subscriptions.push(adBar);
  activity.start();
  for (const source of activity.unavailableSources()) {
    tel.send("watcher_unavailable", { code: source, once: `wu:${source}` });
  }

  // Re-export the CLI auth file on every activation (it may have been wiped, or
  // the secret store may hold a token from a previous session) — but only while
  // enabled, so a disabled extension keeps the at-rest token cleared.
  const existing = await getToken(ctx);
  if (existing && cfg().enabled) exportCliAuth(existing, cfg().backendUrl);

  // Loops: portfolio refresh (120s), metering (1s), ad surface (1s), status (30s).
  // Portfolio polls at 120s (was 60s) and no longer makes a separate killswitch
  // request, cutting idle request volume ~4x so the free-tier ceiling moves from
  // a few dozen developers to several hundred.
  timers.push(setInterval(() => void portfolioLoop(ctx), 120000));
  timers.push(setInterval(() => void meterLoop(ctx), 1000));
  timers.push(setInterval(() => adBarLoop(), 1000));
  timers.push(setInterval(() => void setStatus(ctx), 30000));
  void portfolioLoop(ctx);
}

export function deactivate() {
  isDeactivating = true; // any in-flight loop body bails before re-writing state
  for (const t of timers) clearInterval(t);
  timers = [];
  activity.stop();
  // Leave settings as-is; the user explicitly restores via the command.
  // Blank the cached ad AND the render heartbeat so nothing lingers to meter
  // after the editor closes (a stale-but-fresh heartbeat could otherwise let a
  // detached poster cycle credit one impression for a session that's over).
  try {
    if (existsSync(SPINIX_DIR)) {
      writeFileSync(join(SPINIX_DIR, "cli-ad.json"), JSON.stringify({}));
      writeFileSync(join(SPINIX_DIR, "render.json"), JSON.stringify({}));
    }
  } catch {}
}
