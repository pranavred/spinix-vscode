import { describe, it, expect, vi, beforeEach } from "vitest";
import { Telemetry } from "../src/telemetry";

function makeTel(enabled: boolean, consented = true) {
  return new Telemetry({
    backendUrl: () => "https://x",
    clientId: () => "client_test",
    version: "0.3.0",
    platform: "darwin",
    enabled: () => enabled,
    consented: () => consented,
  });
}

describe("Telemetry", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("sends nothing when VS Code telemetry is disabled", () => {
    makeTel(false).send("activated");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends nothing before the user has consented", () => {
    makeTel(true, false).send("activated");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the event with coarse properties when enabled", () => {
    makeTel(true).send("first_render", { surface: "statusline" });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x/v1/telemetry");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      event: "first_render",
      client_id: "client_test",
      ext_version: "0.3.0",
      platform: "darwin",
      surface: "statusline",
    });
  });

  it("deduplicates once-per-session events", () => {
    const tel = makeTel(true);
    tel.send("portfolio_empty", { once: "portfolio_empty" });
    tel.send("portfolio_empty", { once: "portfolio_empty" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps unknown platforms to 'other'", () => {
    new Telemetry({
      backendUrl: () => "https://x",
      clientId: () => "c",
      version: "0.3.0",
      platform: "freebsd",
      enabled: () => true,
      consented: () => true,
    }).send("activated");
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(body.platform).toBe("other");
  });

  it("never throws when fetch rejects", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(() => makeTel(true).send("activated")).not.toThrow();
  });
});
