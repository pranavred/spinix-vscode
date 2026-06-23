import { applyEdits, modify, parse, type ModificationOptions, type ParseError } from "jsonc-parser";

const FMT: ModificationOptions = {
  formattingOptions: { insertSpaces: true, tabSize: 2 },
};

/** True iff `text` parses as a JSON(C) object with no syntax errors. Used to
 *  refuse mutating a settings.json we can't safely round-trip (so a half-saved
 *  or hand-broken file is never made worse). */
export function parsesAsObject(text: string): boolean {
  const errors: ParseError[] = [];
  const v = parse(text.trim() === "" ? "{}" : text, errors, { allowTrailingComma: true });
  return errors.length === 0 && typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The user's statusLine/spinnerVerbs (the keys we overwrite), so they can be
 *  stashed at install time and restored on uninstall instead of deleted. */
export function priorAdSettings(text: string): { statusLine?: unknown; spinnerVerbs?: unknown } {
  try {
    const v = parse(text.trim() === "" ? "{}" : text, [], { allowTrailingComma: true }) as
      | { statusLine?: unknown; spinnerVerbs?: unknown }
      | undefined;
    return { statusLine: v?.statusLine, spinnerVerbs: v?.spinnerVerbs };
  } catch {
    return {};
  }
}

export interface AdSettings {
  statusLineCommand: string;
  verbs: string[];
}

export interface HookSettings {
  /** Command run on UserPromptSubmit (turn start). */
  startCommand: string;
  /** Command run on Stop (turn done) — fires the notification. */
  doneCommand: string;
}

/**
 * A hook is Spinix's only if its command is EXACTLY our installed invocation:
 * an interpreter (bare `node` or a quoted absolute path) running a quoted
 * `.../notify.mjs` with a `start` or `done` argument. Matching a loose
 * "notify.mjs" substring would wrongly strip a user's own hook that merely
 * mentions the file.
 */
const SPINIX_HOOK_RE = /^(?:"[^"]*"|\S+)\s+"[^"]*[/\\]notify\.mjs"\s+(?:start|done)$/;

/**
 * Add (or update) the Spinix statusLine + spinnerVerbs keys in a Claude Code
 * settings.json while preserving the user's existing keys, comments, and
 * formatting. JSONC-tolerant (comments are fine). Returns the new text.
 */
export function applyAdSettings(raw: string, s: AdSettings): string {
  const base = raw.trim() === "" ? "{}" : raw;
  let out = base;
  out = applyEdits(
    out,
    modify(
      out,
      ["statusLine"],
      { type: "command", command: s.statusLineCommand, padding: 0, refreshInterval: 1 },
      FMT,
    ),
  );
  out = applyEdits(
    out,
    modify(out, ["spinnerVerbs"], { mode: "replace", verbs: s.verbs }, FMT),
  );
  return out;
}

type HookGroup = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };

/** Drop only Spinix-owned hook entries from a hooks-event array, keeping the rest. */
function stripSpinix(groups: unknown): HookGroup[] {
  if (!Array.isArray(groups)) return [];
  return (groups as HookGroup[])
    .map((g) => ({
      ...g,
      hooks: (g.hooks ?? []).filter((h) => !SPINIX_HOOK_RE.test(String(h?.command ?? ""))),
    }))
    .filter((g) => (g.hooks ?? []).length > 0);
}

/**
 * Install the Spinix notify-on-done hooks (Stop = done, UserPromptSubmit =
 * start) while preserving any hooks the user already has. Idempotent: re-running
 * replaces the Spinix entries rather than stacking duplicates.
 */
export function applyHookSettings(raw: string, s: HookSettings): string {
  const base = raw.trim() === "" ? "{}" : raw;
  const root = (parse(base) as { hooks?: Record<string, unknown> }) ?? {};
  const hooks = root.hooks ?? {};

  const stop = stripSpinix(hooks.Stop);
  stop.push({ hooks: [{ type: "command", command: s.doneCommand }] });
  const ups = stripSpinix(hooks.UserPromptSubmit);
  ups.push({ hooks: [{ type: "command", command: s.startCommand }] });

  let out = base;
  out = applyEdits(out, modify(out, ["hooks", "Stop"], stop, FMT));
  out = applyEdits(out, modify(out, ["hooks", "UserPromptSubmit"], ups, FMT));
  return out;
}

/**
 * Remove the Spinix-managed keys + notify hooks, restoring the file otherwise.
 * `prior` (the user's statusLine/spinnerVerbs captured at install time) is put
 * back rather than deleted, so we don't destroy a user's own status line.
 */
export function restoreSettings(
  raw: string,
  prior?: { statusLine?: unknown; spinnerVerbs?: unknown },
): string {
  const base = raw.trim() === "" ? "{}" : raw;
  // If the file isn't a JSON object, there are no Spinix keys to remove and
  // modify() would throw on a non-object root — leave it untouched.
  if (!parsesAsObject(base)) return raw;
  let out = base;

  out = applyEdits(out, modify(out, ["statusLine"], prior?.statusLine ?? undefined, FMT));
  out = applyEdits(out, modify(out, ["spinnerVerbs"], prior?.spinnerVerbs ?? undefined, FMT));

  const root = (parse(out) as { hooks?: Record<string, unknown> }) ?? {};
  if (root.hooks) {
    for (const ev of ["Stop", "UserPromptSubmit"]) {
      // Only touch an event we recognise as an array of hook groups; never
      // clobber a user-authored non-array shape.
      if (Array.isArray(root.hooks[ev])) {
        const cleaned = stripSpinix(root.hooks[ev]);
        out = applyEdits(
          out,
          modify(out, ["hooks", ev], cleaned.length ? cleaned : undefined, FMT),
        );
      }
    }
    // If we emptied the hooks object entirely, drop it too.
    const after = (parse(out) as { hooks?: Record<string, unknown> }) ?? {};
    if (after.hooks && Object.keys(after.hooks).length === 0) {
      out = applyEdits(out, modify(out, ["hooks"], undefined, FMT));
    }
  }
  return out;
}
