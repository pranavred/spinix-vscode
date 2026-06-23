# Spinix

**Get pinged the moment your AI agent finishes, and turn the wait into free distribution for whatever you're building.**

Spinix does two things while Claude Code or Codex is working. It tells you the instant the agent finishes a turn, so you stop babysitting a spinner that already stopped. And while the agent thinks, it puts one quiet line on that spinner: a product from another indie builder in the cross-promo ring, or a perk from an AI company trying to reach developers. Add your own product to the ring and it rides other builders' spinners too. They see yours, you see theirs.

```
✶ Small Bets: the community for indie hackers ↗
```

That line is the whole footprint. No banners, no popups, no video, nothing near your code.

## Notify-on-done

This is why most people install Spinix. It adds a Claude Code hook that fires a desktop notification the instant your agent finishes a turn, and only for turns long enough that you've probably wandered off. It works in the terminal and in VS Code, it takes effect immediately, and it's fully reversible. Turn it off whenever you want with the `spinix.notify` setting. Your think-time still counts either way.

## The cross-promo ring

The ring is how indie builders hand each other distribution. You add a product (up to three), and Spinix shows it on other members' spinners while their agents are thinking. In return, their products show on yours. The free grant is up to 1,000 impressions a week per member.

It's reciprocal on purpose: your products are eligible to serve only while you're actively running Spinix, proven by a recent heartbeat from the extension. Sign out, disable it, or close the editor for a while and your products quietly pause from the ring, then resume the next time you're running. If you want a bigger push than the free grant gives you, you can buy extra impressions on spinixads.com at $5 per 1,000.

## Perks and offers

Some of the time the line is an offer from an AI company instead of a ring product: extended trials, credits, discounts on developer tools. Five continuous seconds of an offer on your screen counts as an impression and saves that offer to your account, so you can come back and claim it on your own time. Clicking claims it. Claiming is free, for you and for them. Which offers you see depends on your tier and nothing else. There's no interest profiling.

## Think Points and the leaderboard

Every minute your agent spends thinking earns you one Think Point. Points move you up a tier (Bronze, Silver, Gold, then Mythic), and higher tiers unlock deeper offers. Opt in with a handle and you show up on the public "who made the AI think the most" board. It's off by default.

To be clear about what this isn't: Spinix pays no cash, and points are worth nothing but bragging rights. The value is the perks, the free distribution, and never having to watch the spinner. An earlier version tested a revenue-share model. It's gone now, replaced by perks and points.

Signing in is a browser handoff. The extension opens spinixads.com, you sign in with a magic link or Google, and it picks up a token. You never type a credential into the editor.

## Where the line appears

| Surface | How |
| --- | --- |
| Claude Code CLI | The statusline, as a clickable terminal link, plus the spinner verb |
| Claude Code panel in VS Code | A status bar item, shown only while a turn is running and the window is focused |
| Codex CLI | The same status bar item, driven by the same activity detection |

The line only shows while an agent is actually working. When the turn ends, it goes away.

## What this extension changes, exactly

Spinix edits one file outside VS Code: `~/.claude/settings.json`. It sets `statusLine` and `spinnerVerbs`, and for notify-on-done it appends one `Stop` hook and one `UserPromptSubmit` hook that run the bundled `~/.spinix/notify.mjs`. Every edit is surgical JSONC that keeps your comments, key order, formatting, and any hooks you already have. It writes a backup before the first edit, and **Spinix: Restore Claude Code** removes exactly the keys and hooks Spinix added, nothing else. Nothing changes until you accept a consent prompt on first run.

## What it reads, and what it never reads

Spinix never reads your code, your prompts, or your agent transcripts. To know when an agent is busy, it watches file-change timestamps under `~/.claude/projects` and `~/.codex`. It never opens the files themselves. The only data tied to you is your email (for sign-in, and to save the offers your spinner shows), a random device id in `~/.spinix/client-id` that holds no hardware identifiers, and a display handle if you opt into the leaderboard.

Every offer clears an automated content and destination check before it serves, and a server-side killswitch can blank every line within about a minute. If the Spinix backend is unreachable, the line simply turns off. You never get stale or unverified content.

## Diagnostics

The extension sends a small, fixed set of first-party events so we can tell whether installs actually work: activation, consent accepted or declined, whether the settings patch succeeded, the sign-in steps, the first render on each surface, and a few coarse error codes. The list is closed and has no free-form field, so a file path or a snippet of code can't slip through even by accident. The events go only to spinixads.com, never to a third-party analytics service, and they obey VS Code's telemetry setting: turn telemetry off in VS Code and Spinix sends none of it. The companion command-line scripts send nothing at all.

## Commands

| Command | What it does |
| --- | --- |
| Spinix: Sign in | Browser handoff to link this device to your account |
| Spinix: Show status | Your status, with a shortcut to your dashboard |
| Spinix: Enable / Disable | Turn the spinner line on or off |
| Spinix: Restore Claude Code | Remove Spinix's keys and notify hooks from `~/.claude/settings.json` |
| Spinix: Sign out | Revoke this device's token, on the server too |

## FAQ

**Does it slow my terminal down?** No. The statusline script makes no network calls; it reads one cached JSON file and prints a line. Fetching offers and metering happen in a short-lived background process that runs a few times a minute.

**Do minimized windows still collect offers?** In VS Code, no. Focus is checked every second, and an unfocused window shows nothing and saves nothing. A terminal has no focus API, so there the rule is that Claude Code has to be open and rendering, and the daily caps bound the rest.

**Can I be in the ring without carrying other people's products?** No, and that's the point. The ring works because everyone running it carries everyone else. Stop showing the ring and your own products pause too.

**What happens if I uninstall?** Run **Spinix: Restore Claude Code** first. It removes the `statusLine`, `spinnerVerbs`, and notify hook keys, and your backup sits in `~/.spinix/claude-settings.backup.json`. Deactivating also clears the cached line, so nothing stale lingers.

**Is this affiliated with Anthropic, OpenAI, Microsoft, or GitHub?** No. Spinix is an independent project and isn't endorsed by any of them.

---

[spinixads.com](https://spinixads.com) &middot; [Privacy](https://spinixads.com/privacy) &middot; [Terms](https://spinixads.com/terms) &middot; [Source (MIT)](https://github.com/pranavred/spinix-vscode)
