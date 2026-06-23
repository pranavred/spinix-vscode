import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression: the killed STATE must persist across the poster's 60s
 * killswitch cache window. The original bug blanked the ad once, then the
 * next run (cache fresh, check skipped) resurrected it via portfolio refresh
 * — ads kept serving and crediting while the network was supposed to be dark.
 * Drives the real script as a child process against a stub backend.
 */
let server: Server;
let port: number;
let killed = true;
let portfolioHits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/v1/killswitch")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ killed }));
      return;
    }
    if (req.url?.startsWith("/v1/portfolio")) {
      portfolioHits++;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ads: [{ ad_id: "a1", campaign_id: "a1", ad_text: "x", click_url: "https://x", view_token: "vt" }] }));
      return;
    }
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

describe("poster killswitch fail-safe", () => {
  it("stays dark across cached runs while killed, recovers after lift", async () => {
    const home = mkdtempSync(join(tmpdir(), "spx-ks-"));
    const dir = join(home, ".spinix");
    cpSync(join(__dirname, "..", "src", "poster.mjs"), join(dir, "poster.mjs"));
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ token: "t", backend_url: `http://127.0.0.1:${port}` }));
    writeFileSync(join(dir, "client-id"), "client-test");
    writeFileSync(join(dir, "cli-ad.json"), JSON.stringify({ ad_id: "a1", ad_text: "x", click_url: "https://x", view_token: "vt" }));

    // Async spawn: spawnSync would block this process's event loop — which is
    // also the stub server — so the child's requests would time out and the
    // fail-safe would mask what we're testing.
    const run = () =>
      new Promise<void>((resolve) => {
        const p = spawn(process.execPath, [join(dir, "poster.mjs")], {
          env: { ...process.env, HOME: home },
        });
        p.on("exit", () => resolve());
      });

    // Run 1: kill detected → ad blanked.
    await run();
    expect(readFileSync(join(dir, "cli-ad.json"), "utf8")).toBe("{}");

    // Run 2: killswitch cache still fresh (check skipped) — the killed state
    // must hold; the portfolio refresh must NOT resurrect the ad.
    await run();
    expect(readFileSync(join(dir, "cli-ad.json"), "utf8")).toBe("{}");
    expect(portfolioHits).toBe(0);

    // Lift + expire the cache → the ad comes back.
    killed = false;
    const meta = JSON.parse(readFileSync(join(dir, "meter-state.json"), "utf8"));
    meta.ks_checked = Date.now() - 120_000;
    writeFileSync(join(dir, "meter-state.json"), JSON.stringify(meta));
    await run();
    expect(portfolioHits).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, "cli-ad.json"), "utf8")).ad_id).toBe("a1");

    rmSync(home, { recursive: true, force: true });
  });
});
