/**
 * Guard the host the bearer token may be sent to. Even with the setting locked
 * to application scope, this is defense in depth: the CLI scripts read the URL
 * from ~/.spinix/auth.json, so a tampered file must not redirect the bearer to
 * an attacker. Only the real Spinix host over HTTPS is allowed (localhost is
 * permitted for development).
 *
 * Kept dependency-free (no vscode import) so it is unit-testable and so the
 * same logic can be inlined into the standalone poster.mjs / notify.mjs.
 */
export function isAllowedBackend(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const local = host === "localhost" || host === "127.0.0.1";
    if (!local && u.protocol !== "https:") return false;
    return local || host === "spinixads.com" || host === "www.spinixads.com";
  } catch {
    return false;
  }
}
