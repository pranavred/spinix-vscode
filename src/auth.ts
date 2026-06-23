import * as vscode from "vscode";
import { writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { isAllowedBackend } from "./backend-url";

const TOKEN_KEY = "spinix.bearer";
const CLI_AUTH_FILE = join(homedir(), ".spinix", "auth.json");

/**
 * Export the bearer for the headless CLI meter (~/.spinix/poster.mjs), so a
 * pure-terminal Claude Code session earns without VS Code running. Plain file
 * at mode 0600 — the same model gh/npm/wrangler use; the token can only
 * credit ad views and read earnings, and is revocable server-side.
 */
export function exportCliAuth(token: string, backendUrl: string): void {
  // Never write the bearer alongside a host we would not send it to.
  if (!isAllowedBackend(backendUrl)) return;
  try {
    writeFileSync(CLI_AUTH_FILE, JSON.stringify({ token, backend_url: backendUrl }), { mode: 0o600 });
  } catch {}
}

export function clearCliAuth(): void {
  try {
    rmSync(CLI_AUTH_FILE, { force: true });
  } catch {}
}

export interface DeviceStart {
  code: string; // poll handle
  user_code: string; // short code the user types in the browser
  client_id: string;
  verify_url: string;
  verifier: string; // PKCE secret — stays in the extension, never sent to the browser
}

/**
 * Begin the device-code flow. We generate a PKCE verifier and send only its
 * sha256 challenge to the server; the verifier stays here so only this extension
 * can later retrieve the token. The server returns a short user_code the user
 * types on the /link page after signing in (explicit, phishing-resistant consent).
 */
export async function startDeviceLink(
  backendUrl: string,
  clientId: string,
): Promise<DeviceStart | null> {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("hex");
  try {
    const res = await fetch(
      `${backendUrl}/v1/auth/extension/start?client_id=${encodeURIComponent(clientId)}&challenge=${challenge}`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { code: string; user_code: string; client_id: string; verify_url: string };
    return { ...j, verifier };
  } catch {
    return null;
  }
}

/** Poll for the linked bearer token, presenting the PKCE verifier. */
export async function pollDeviceLink(
  backendUrl: string,
  code: string,
  verifier: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${backendUrl}/v1/auth/extension/poll?code=${encodeURIComponent(code)}&verifier=${encodeURIComponent(verifier)}`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { status: string; token?: string };
    return j.status === "linked" && j.token ? j.token : null;
  } catch {
    return null;
  }
}

export async function getToken(ctx: vscode.ExtensionContext): Promise<string | null> {
  return (await ctx.secrets.get(TOKEN_KEY)) ?? null;
}

export async function setToken(ctx: vscode.ExtensionContext, token: string): Promise<void> {
  await ctx.secrets.store(TOKEN_KEY, token);
}

export async function clearToken(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.secrets.delete(TOKEN_KEY);
}
