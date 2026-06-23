/** Notify only for turns long enough that you likely stepped away. Pure. */
export function shouldNotify(startMs: number, nowMs: number, min?: number): boolean;

/** Think time to credit for a turn: 0 without a start, else elapsed clamped. Pure. */
export function thinkMsFor(startMs: number, nowMs: number, max?: number): number;

/** Whether the desktop notification should fire, given ~/.spinix/prefs.json. Pure. */
export function notifyEnabled(prefs: { notify?: boolean } | null | undefined): boolean;

export function readJson(path: string): unknown;
