import type { TelemetryEventType } from "./shared";

export interface TelemetryDeps {
  backendUrl: () => string;
  clientId: () => string;
  version: string;
  platform: string;
  /** VS Code's global telemetry switch (vscode.env.isTelemetryEnabled). */
  enabled: () => boolean;
  /** Whether the user has accepted Spinix's first-run consent. */
  consented: () => boolean;
}

/**
 * First-party diagnostics sender. Fire-and-forget, never throws, and sends
 * nothing at all when the user has telemetry disabled in VS Code. Events are a
 * closed enum with coarse properties — no paths, no URLs, no message text —
 * and they go only to the Spinix backend, never a third party. The CLI scripts
 * (statusline.mjs / poster.mjs) deliberately have no telemetry.
 */
export class Telemetry {
  private oncePerSession = new Set<string>();

  constructor(private deps: TelemetryDeps) {}

  send(
    event: TelemetryEventType,
    opts: { surface?: string; code?: string; once?: string } = {},
  ): void {
    try {
      if (!this.deps.enabled() || !this.deps.consented()) return;
      if (opts.once) {
        if (this.oncePerSession.has(opts.once)) return;
        this.oncePerSession.add(opts.once);
      }
      const p = this.deps.platform;
      void fetch(`${this.deps.backendUrl()}/v1/telemetry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event,
          client_id: this.deps.clientId(),
          ext_version: this.deps.version,
          platform: p === "darwin" || p === "linux" || p === "win32" ? p : "other",
          surface: opts.surface,
          code: opts.code,
        }),
      }).catch(() => {});
    } catch {
      // diagnostics must never break the product
    }
  }
}
