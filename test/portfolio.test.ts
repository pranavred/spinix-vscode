import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshPortfolio } from "../src/portfolio";

// The extension dropped its separate killswitch request: refreshPortfolio now
// both serves and enforces the kill (and fails closed on error) by blanking the
// cached ad. These tests pin that behavior.
describe("refreshPortfolio (killswitch fold + fail-closed)", () => {
  let dir: string;
  const cliAd = () => JSON.parse(readFileSync(join(dir, "cli-ad.json"), "utf8"));
  const reply = (body: unknown, status = 200) =>
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spinix-pf-"));
    // Seed a stale cached ad so we can prove it gets replaced or blanked.
    writeFileSync(join(dir, "cli-ad.json"), JSON.stringify({ ad_text: "old", click_url: "https://old" }));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("caches the served ad on a normal response", async () => {
    reply({ ads: [{ ad_id: "a", campaign_id: "a", ad_text: "new", click_url: "https://new" }], killed: false, ttl_seconds: 60, view_threshold_seconds: 15 });
    const pf = await refreshPortfolio("https://b", dir, "tok", "client");
    expect(pf?.killed).toBe(false);
    expect(cliAd().ad_text).toBe("new");
  });

  it("blanks the cached ad when the server reports killed", async () => {
    reply({ ads: [], killed: true, ttl_seconds: 60, view_threshold_seconds: 15 });
    const pf = await refreshPortfolio("https://b", dir, "tok", "client");
    expect(pf?.killed).toBe(true);
    expect(cliAd()).toEqual({});
  });

  it("blanks the cached ad on a non-OK response (fail-closed)", async () => {
    reply({ detail: "boom" }, 500);
    const pf = await refreshPortfolio("https://b", dir, "tok", "client");
    expect(pf).toBe(null);
    expect(cliAd()).toEqual({});
  });

  it("blanks the cached ad on a network error (fail-closed)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network dark");
    });
    const pf = await refreshPortfolio("https://b", dir, "tok", "client");
    expect(pf).toBe(null);
    expect(cliAd()).toEqual({});
  });
});
