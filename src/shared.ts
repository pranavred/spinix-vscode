// Inlined from the Spinix monorepo's @spinix/shared so this extension builds as
// a standalone open-source repo. These mirror values the Spinix backend
// enforces; keep them in sync if the server-side constants change.

/** >= 5s continuously on screen counts as one billable impression. */
export const IMPRESSION_MIN_MS = 5000;

/** Dwell needed before a view/click is counted ("view threshold met"). */
export const VIEW_THRESHOLD_MS = 15000;

/** Per-ping impression cap = PING_WINDOW_MS (25000) / IMPRESSION_MIN_MS (5000) = 5.
 *  Metering is batched: the client accrues 5s impressions locally and pings once
 *  per window carrying a `units` count; the server still credits at most 1 unit
 *  per 5s of real elapsed time, so batching can't exceed the un-batched rate. */
export const IMPRESSIONS_PER_PING = 5;

/** The fixed, exhaustive set of diagnostic events the extension may report.
 *  There are no free-form fields, so code, paths, and prompts can't pass through
 *  this channel. Events are sent only to the Spinix backend. */
export const TELEMETRY_EVENTS = [
  "activated",
  "consent_accepted",
  "consent_declined",
  "integration_installed",
  "claude_missing",
  "signin_started",
  "signin_linked",
  "signin_timeout",
  "first_render",
  "portfolio_empty",
  "watcher_unavailable",
  "restore_run",
  "disabled",
  "error",
] as const;

export type TelemetryEventType = (typeof TELEMETRY_EVENTS)[number];
