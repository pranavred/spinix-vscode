# Spinix

**Get pinged when your agent's done. Perks for the wait.** Spinix tells you the moment Claude Code or Codex finishes thinking — stop babysitting a spinner that already stopped. And while the agent works, its spinner shows one subtle line: a perk or offer from an AI company trying to reach developers — extended trials, credits, discounts on dev tools. Every offer your spinner shows is saved to your account on spinixads.com — claiming costs you nothing.

```
✶ Warp — 3 months of Pro for Spinix devs ↗
```

That line is the whole thing. No banners, no popups, no video, nothing in your code.

## Notify-on-done

Spinix installs a Claude Code hook that fires a desktop notification the instant your agent finishes a turn (only for turns long enough that you've probably stepped away). It works in the terminal and in VS Code, it's fully reversible, and it's the reason most people install Spinix. Turn it off any time with the `spinix.notify` setting.

## Where the offer appears

| Surface | How |
| --- | --- |
| Claude Code CLI | The statusline, as a clickable terminal hyperlink, plus the spinner verb |
| Claude Code panel in VS Code | A status bar item, shown only while a turn is in flight and the window is focused |
| Codex CLI | The same status bar item, driven by the same activity detection |

The offer only appears while an agent is actually working. When the turn ends, it goes away.

## How offers and XP work

1. The AI companies pay for impressions; you never do. An impression is 5 continuous seconds of the offer on your screen, and it saves that offer to your account.
2. Clicking an offer claims it. Clicks are free for them and for you; a claim just redeems the deal.
3. You rack up **Think Points** — one point per minute you made the AI think — and a tier (Bronze, Silver, Gold, Mythic) that quietly unlocks deeper offers.
4. If you opt in with a handle, you appear on the **"who made the AI think the most"** leaderboard. Opting out is the default.

To be clear about what this is not: Spinix does not pay cash, and points have no monetary value — they're bragging rights. The value to you is the perks, and never having to watch the spinner. (Earlier versions tested a revenue-share model; it was replaced with perks and points.)

Sign-in is a browser handoff: the extension opens spinixads.com, you sign in with a magic link or Google, and the extension picks up its token. You never type a credential into the editor.

## What this extension changes, exactly

Honesty section. Spinix edits one file outside VS Code: `~/.claude/settings.json`. It sets `statusLine` and `spinnerVerbs`, and — for notify-on-done — appends one `Stop` and one `UserPromptSubmit` hook that run the bundled `~/.spinix/notify.mjs`. All edits are surgical JSONC that preserve your comments, key order, formatting, and any hooks you already have. Before the first edit it saves a backup, and **Spinix: Restore Claude Code** removes exactly the Spinix-managed keys and the Spinix hooks — your own hooks and keys are untouched. Nothing changes until you accept a consent prompt on first run.

## What it reads, and what it never reads

Spinix never reads your code, your prompts, or your agent transcripts. To know when an agent is busy, it watches file-change *timestamps* under `~/.claude/projects` and `~/.codex`; the contents are never opened. The data tied to you is your email (to save the offers your spinner shows, and for sign-in), a random device id stored in `~/.spinix/client-id` that contains no hardware identifiers, and a display handle only if you opt into the leaderboard. There is no interest profiling: offers are gated by tier, nothing else.

Every offer clears an automated content and destination screen before serving, and a server-side killswitch can blank every offer surface within about a minute. If the Spinix backend is unreachable, offers simply turn off; failures never show stale or unverified content.

## Diagnostics

The extension sends a small set of first-party diagnostic events so we can tell whether installs actually work: activated, consent accepted or declined, settings patch succeeded or failed, sign-in started/completed/timed out, first render per surface, and a handful of coarse error codes. These events are a fixed list; there is no free-form field, so a file path or code snippet cannot leak through them even by accident. They go only to spinixads.com, never to a third-party analytics service, and they respect VS Code's global telemetry setting: if you've turned telemetry off in VS Code, Spinix sends none of this. The CLI scripts send no diagnostics at all.

## Commands

| Command | What it does |
| --- | --- |
| Spinix: Sign in | Browser handoff to link this device to your account |
| Spinix: Show status | Your status, with a shortcut to your dashboard |
| Spinix: Enable / Disable | Turn the offer surfaces on or off |
| Spinix: Restore Claude Code | Remove the Spinix keys + notify hooks from `~/.claude/settings.json` |
| Spinix: Sign out | Revoke this device's token, server-side too |

## FAQ

**Does it slow my terminal down?** The statusline script does no network I/O; it reads one cached JSON file and prints one line. Offer fetching and metering happen in a short-lived background process that runs a few times a minute.

**Do minimized windows collect offers?** In VS Code, no: focus is checked every second and an unfocused window shows nothing and saves nothing. A terminal has no visibility API, so there the rule is that Claude Code must be open and rendering; the daily XP and impression caps bound the rest.

**What happens if I uninstall?** Run **Spinix: Restore Claude Code** first (it removes the `statusLine`, `spinnerVerbs`, and notify hook keys; the backup sits in `~/.spinix/claude-settings.backup.json`). Deactivating also blanks the offer cache so nothing stale lingers.

**Is this affiliated with Anthropic, OpenAI, Microsoft, or GitHub?** No. Spinix is an independent project and is not endorsed by any of them.

## Build from source

This repository is the complete source of the Spinix VS Code extension — the client only; the Spinix backend is separate. It's open so you can verify the claims above for yourself (for example, that the busy-watcher reads file-change *timestamps* and never opens file contents — see `src/busy-watch.ts`).

```bash
npm install
npm run build      # esbuild → dist/extension.js
npm test           # vitest
npm run package    # vsce → spinix-<version>.vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

---

[spinixads.com](https://spinixads.com) &middot; [Privacy](https://spinixads.com/privacy) &middot; [Terms](https://spinixads.com/terms)
