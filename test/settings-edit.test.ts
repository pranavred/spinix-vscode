import { describe, it, expect } from "vitest";
import { parse } from "jsonc-parser";
import {
  applyAdSettings,
  applyHookSettings,
  restoreSettings,
  parsesAsObject,
  priorAdSettings,
} from "../src/settings-edit";

const HOOKS = { startCommand: 'node "~/.spinix/notify.mjs" start', doneCommand: 'node "~/.spinix/notify.mjs" done' };

describe("applyAdSettings", () => {
  it("adds statusLine + spinnerVerbs to an empty file", () => {
    const out = applyAdSettings("", { statusLineCommand: "node sl.mjs", verbs: ["Ad text"] });
    const parsed = parse(out);
    expect(parsed.statusLine).toMatchObject({ type: "command", command: "node sl.mjs", padding: 0, refreshInterval: 1 });
    expect(parsed.spinnerVerbs).toEqual({ mode: "replace", verbs: ["Ad text"] });
  });

  it("preserves existing user keys and comments", () => {
    const raw = `{
  // user's own settings
  "model": "claude-sonnet-4-6",
  "permissions": { "allow": ["Bash"] }
}`;
    const out = applyAdSettings(raw, { statusLineCommand: "node sl.mjs", verbs: ["Buy X"] });
    expect(out).toContain("// user's own settings");
    const parsed = parse(out);
    expect(parsed.model).toBe("claude-sonnet-4-6");
    expect(parsed.permissions.allow).toEqual(["Bash"]);
    expect(parsed.spinnerVerbs.verbs).toEqual(["Buy X"]);
  });

  it("updates an existing statusLine instead of duplicating", () => {
    const raw = `{ "statusLine": { "type": "command", "command": "old" } }`;
    const out = applyAdSettings(raw, { statusLineCommand: "new", verbs: ["v"] });
    const parsed = parse(out);
    expect(parsed.statusLine.command).toBe("new");
    expect(out.match(/"statusLine"/g)!.length).toBe(1);
  });
});

describe("restoreSettings", () => {
  it("removes exactly the Spinix-managed keys, keeping the rest", () => {
    const raw = `{ "model": "x", "statusLine": { "type": "command", "command": "c" }, "spinnerVerbs": { "mode": "replace", "verbs": ["a"] } }`;
    const out = restoreSettings(raw);
    const parsed = parse(out);
    expect(parsed.model).toBe("x");
    expect(parsed.statusLine).toBeUndefined();
    expect(parsed.spinnerVerbs).toBeUndefined();
  });

  it("apply then restore round-trips to the original keys", () => {
    const raw = `{ "model": "claude" }`;
    const applied = applyAdSettings(raw, { statusLineCommand: "node sl.mjs", verbs: ["ad"] });
    const restored = parse(restoreSettings(applied));
    expect(restored).toEqual({ model: "claude" });
  });
});

describe("applyHookSettings (notify-on-done)", () => {
  it("installs Stop + UserPromptSubmit hooks on an empty file", () => {
    const parsed = parse(applyHookSettings("", HOOKS));
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe(HOOKS.doneCommand);
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toBe(HOOKS.startCommand);
  });

  it("preserves the user's existing hooks and keys", () => {
    const raw = `{
  "model": "claude",
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "my-own-stop.sh" }] }],
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "guard.sh" }] }]
  }
}`;
    const parsed = parse(applyHookSettings(raw, HOOKS));
    expect(parsed.model).toBe("claude");
    // user's Stop hook still there, ours appended
    const stopCmds = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(stopCmds).toContain("my-own-stop.sh");
    expect(stopCmds).toContain(HOOKS.doneCommand);
    // unrelated event untouched
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe("guard.sh");
  });

  it("is idempotent — re-applying does not stack duplicate Spinix hooks", () => {
    const once = applyHookSettings("{}", HOOKS);
    const twice = parse(applyHookSettings(once, HOOKS));
    expect(twice.hooks.Stop).toHaveLength(1);
    expect(twice.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("restore removes only Spinix hooks, keeping the user's", () => {
    const raw = `{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "my-own-stop.sh" }] }],
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "guard.sh" }] }]
  }
}`;
    const restored = parse(restoreSettings(applyHookSettings(raw, HOOKS)));
    const stopCmds = restored.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(stopCmds).toEqual(["my-own-stop.sh"]); // ours gone, user's kept
    expect(restored.hooks.UserPromptSubmit).toBeUndefined(); // only Spinix was there
    expect(restored.hooks.PreToolUse[0].hooks[0].command).toBe("guard.sh");
  });

  it("apply ads+hooks then restore round-trips to the original", () => {
    const raw = `{ "model": "claude" }`;
    let out = applyAdSettings(raw, { statusLineCommand: "node sl.mjs", verbs: ["ad"] });
    out = applyHookSettings(out, HOOKS);
    expect(parse(restoreSettings(out))).toEqual({ model: "claude" });
  });
});

describe("parsesAsObject", () => {
  it("accepts a plain object, with or without comments/trailing commas", () => {
    expect(parsesAsObject(`{ "a": 1 }`)).toBe(true);
    expect(parsesAsObject(`{ /* c */ "a": 1, }`)).toBe(true);
    expect(parsesAsObject("")).toBe(true); // empty file is treated as {}
    expect(parsesAsObject("   ")).toBe(true);
  });

  it("rejects a non-object root (array, scalar) and malformed JSON", () => {
    expect(parsesAsObject(`[1, 2, 3]`)).toBe(false);
    expect(parsesAsObject(`"a string"`)).toBe(false);
    expect(parsesAsObject(`42`)).toBe(false);
    expect(parsesAsObject(`null`)).toBe(false);
    expect(parsesAsObject(`{ "a": }`)).toBe(false); // syntax error
    expect(parsesAsObject(`{ unterminated`)).toBe(false);
  });
});

describe("settings safety", () => {
  it("leaves a non-object (array-rooted) settings file untouched on restore", () => {
    const raw = `[{ "not": "an object" }]`;
    expect(restoreSettings(raw)).toBe(raw);
  });

  it("leaves a malformed settings file untouched on restore", () => {
    const raw = `{ "model": "claude", `; // truncated / unparseable
    expect(restoreSettings(raw)).toBe(raw);
  });

  it("does NOT strip a user hook that merely mentions notify.mjs", () => {
    // A user's own hook whose command contains the substring but isn't our
    // exact `node "...notify.mjs" start|done` invocation must survive.
    const raw = `{
  "hooks": {
    "Stop": [{ "hooks": [
      { "type": "command", "command": "echo ran notify.mjs by hand" },
      { "type": "command", "command": "cat ~/.spinix/notify.mjs.log" }
    ] }]
  }
}`;
    const restored = parse(restoreSettings(applyHookSettings(raw, HOOKS)));
    const stopCmds = restored.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(stopCmds).toContain("echo ran notify.mjs by hand");
    expect(stopCmds).toContain("cat ~/.spinix/notify.mjs.log");
    // and our own exact hook is gone
    expect(stopCmds).not.toContain(HOOKS.doneCommand);
  });

  it("restores the user's prior statusLine/spinnerVerbs instead of deleting them", () => {
    const raw = `{
  "model": "claude",
  "statusLine": { "type": "command", "command": "my-own-statusline.sh" },
  "spinnerVerbs": { "mode": "append", "verbs": ["Pondering"] }
}`;
    const prior = priorAdSettings(raw);
    const applied = applyAdSettings(raw, { statusLineCommand: "node sl.mjs", verbs: ["Ad"] });
    // Spinix has overwritten both keys at this point.
    const mid = parse(applied);
    expect(mid.statusLine.command).toBe("node sl.mjs");
    // On uninstall we hand back the captured prior, which must be put back.
    const restored = parse(restoreSettings(applied, prior));
    expect(restored.statusLine).toEqual({ type: "command", command: "my-own-statusline.sh" });
    expect(restored.spinnerVerbs).toEqual({ mode: "append", verbs: ["Pondering"] });
    expect(restored.model).toBe("claude");
  });

  it("deletes the Spinix keys when there was no prior to restore", () => {
    const raw = `{ "model": "claude" }`;
    const prior = priorAdSettings(raw); // {} — user had neither key
    const applied = applyAdSettings(raw, { statusLineCommand: "node sl.mjs", verbs: ["Ad"] });
    const restored = parse(restoreSettings(applied, prior));
    expect(restored.statusLine).toBeUndefined();
    expect(restored.spinnerVerbs).toBeUndefined();
    expect(restored.model).toBe("claude");
  });

  it("priorAdSettings captures only the two keys we overwrite", () => {
    const raw = `{
  "model": "claude",
  "statusLine": { "type": "command", "command": "x" },
  "spinnerVerbs": { "verbs": ["a"] }
}`;
    expect(priorAdSettings(raw)).toEqual({
      statusLine: { type: "command", command: "x" },
      spinnerVerbs: { verbs: ["a"] },
    });
    expect(priorAdSettings(`{ "model": "c" }`)).toEqual({
      statusLine: undefined,
      spinnerVerbs: undefined,
    });
  });

  it("does not clobber a user-authored non-array hooks event on restore", () => {
    // Some users write hooks.Stop as an object shape; we must not touch it.
    const raw = `{
  "hooks": { "Stop": { "weird": "shape" } }
}`;
    const out = restoreSettings(raw);
    const parsed = parse(out);
    expect(parsed.hooks.Stop).toEqual({ weird: "shape" });
  });
});
