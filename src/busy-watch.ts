import { watch, existsSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AgentSource = "claude" | "codex";

/** Pure freshness decision (unit-tested): activity within the window = busy. */
export function isBusy(lastActivityMs: number | null, nowMs: number, windowMs = 3000): boolean {
  return lastActivityMs !== null && nowMs - lastActivityMs <= windowMs;
}

/**
 * Detects "an AI agent is thinking" by watching the session files coding
 * agents stream to while they work:
 *  - Claude Code (CLI **and** the VS Code panel, which doesn't run statusLine)
 *    appends to ~/.claude/projects/**\/*.jsonl
 *  - Codex CLI writes under ~/.codex (history.jsonl / log / sessions)
 * A write in the last few seconds means a turn is in flight — exactly the
 * window the spinner ad is sold for. Read-only; file contents are never read.
 */
export class AgentActivityWatcher {
  private last: Partial<Record<AgentSource, number>> = {};
  private watchers: FSWatcher[] = [];
  private failed: AgentSource[] = [];

  start(): void {
    const roots: Array<[AgentSource, string]> = [
      ["claude", join(homedir(), ".claude", "projects")],
      ["codex", join(homedir(), ".codex")],
    ];
    for (const [source, root] of roots) {
      if (!existsSync(root)) continue;
      try {
        const w = watch(root, { recursive: true }, () => {
          this.last[source] = Date.now();
        });
        w.on("error", () => {});
        this.watchers.push(w);
      } catch {
        // recursive watch unavailable — this source simply won't report busy
        this.failed.push(source);
      }
    }
  }

  /** Sources whose root exists but whose watcher could not start (e.g. Linux). */
  unavailableSources(): AgentSource[] {
    return [...this.failed];
  }

  stop(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {}
    }
    this.watchers = [];
  }

  /** The busy source with the freshest activity, or null when idle. */
  activeSource(nowMs: number, windowMs = 3000): AgentSource | null {
    let best: AgentSource | null = null;
    let bestTs = -1;
    for (const source of ["claude", "codex"] as AgentSource[]) {
      const ts = this.last[source];
      if (ts !== undefined && isBusy(ts, nowMs, windowMs) && ts > bestTs) {
        best = source;
        bestTs = ts;
      }
    }
    return best;
  }
}
