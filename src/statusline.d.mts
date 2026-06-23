/** Pure freshness gate: a recent session-transcript write means a turn is in
 *  flight, so metering should run; an idle window means it should not. */
export function agentBusy(transcriptMtimeMs: number, nowMs: number, windowMs?: number): boolean;

/** True when this file is the process entrypoint, robust to Windows paths. */
export function isEntrypoint(argv1: string | undefined, metaUrl: string): boolean;
