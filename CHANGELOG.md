# Changelog

## 0.5.0

- **Notify-on-done is now live-toggleable.** `spinix.notify` flips the desktop ping on or off without a reload, and your think-time still counts on the board either way. The Stop hook stays installed whenever Spinix is enabled, so think-time always accrues.
- **Metering only counts active sessions.** The sponsored line still shows whenever your agent works, but Spinix now only meters an impression while a session is actually in use — an editor left open and idle no longer reports views. (Heuristic based on recent session activity; the line always renders.)
- **Batched metering.** The client now buffers view units and reports them once per ~25s window instead of pinging on every impression, for far more network headroom. An impression is still 5 continuous seconds on screen.
- **Cleaner shutdown.** Closing the editor clears the render state immediately, so nothing lingers to meter after you're done.
- Joins the indie cross-promo ring on spinixads.com: add your product, and it rides other builders' spinners while their agents think.

## 0.4.0

- **Notify-on-done.** Spinix now pings you the moment your agent finishes a turn — stop watching a spinner that already stopped. It installs a reversible Claude Code `Stop` hook (plus `UserPromptSubmit` to time the turn); only turns longer than ~30s notify. Toggle with `spinix.notify`. Works in the terminal and the VS Code panel.
- **"Who made the AI think the most."** Every minute your agent spends thinking earns a point. The public leaderboard now ranks think-time, not impressions — it's bragging rights, never cash. The `Stop` hook reports each turn's thinking time (clamped per turn, capped per day).
- **Copy:** the sponsored line is framed as perks & offers from the AI companies trying to reach developers — not "ads."
- The settings installer is merge-safe: it preserves any hooks you already have, and **Spinix: Restore Claude Code** removes only Spinix's keys and hooks.

## 0.3.0

- The offers pivot. Spinix no longer pays cash; the revenue-share model is retired. Impressions now save the sponsored offer to your account on spinixads.com, and clicking claims it free.
- XP and tiers: +1 XP per impression (daily cap), +100 XP on a first claim. Tiers are Bronze, Silver (500), Gold (2,500), Mythic (10,000); some offers are tier-gated.
- Optional public leaderboard with a display handle (off by default).
- New icon and copy matching the spinixads.com redesign.
- Old earnings endpoints are deprecated server-side; 0.2.x installs keep working but show $0 and should update.
- First-party diagnostics: a closed enum of lifecycle events (activation, consent, sign-in funnel, first render, coarse error codes), sent only to spinixads.com and only when VS Code's telemetry setting is on. No third-party SDK; the CLI scripts send nothing.

## 0.2.0

- Ads now work across three surfaces: the Claude Code CLI statusline, the Claude Code VS Code panel, and Codex CLI (the latter two via a focus-aware status bar item driven by agent-activity detection).
- Headless meter (`poster.mjs`) so pure-terminal users participate without VS Code open: killswitch checks, portfolio refresh, and view metering in a short-lived detached process.
- Killswitch state now persists across the poster's cache window (a network-dark period can no longer resurrect a cached ad).
- First Marketplace release: icon, listing, license.

## 0.1.0

- Initial release: consent-gated setup, reversible `~/.claude/settings.json` integration (`statusLine` + `spinnerVerbs`), device-link sign-in, signed view tokens, 5s/15s view metering.
