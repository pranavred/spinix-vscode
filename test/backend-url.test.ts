import { describe, it, expect } from "vitest";
import { isAllowedBackend, sanitizeBackendUrl, DEFAULT_BACKEND } from "../src/backend-url";

describe("isAllowedBackend (token-exfil guard)", () => {
  it("allows the real Spinix host over https", () => {
    expect(isAllowedBackend("https://spinixads.com")).toBe(true);
    expect(isAllowedBackend("https://www.spinixads.com")).toBe(true);
    expect(isAllowedBackend("https://spinixads.com/")).toBe(true);
  });
  it("allows localhost in dev", () => {
    expect(isAllowedBackend("http://localhost:8787")).toBe(true);
    expect(isAllowedBackend("http://127.0.0.1:8787")).toBe(true);
  });
  it("rejects an attacker-controlled host", () => {
    expect(isAllowedBackend("https://evil.example")).toBe(false);
    expect(isAllowedBackend("https://spinixads.com.evil.example")).toBe(false);
    expect(isAllowedBackend("https://evilspinixads.com")).toBe(false);
  });
  it("rejects non-https for a non-local host (cleartext bearer)", () => {
    expect(isAllowedBackend("http://spinixads.com")).toBe(false);
  });
  it("rejects garbage", () => {
    expect(isAllowedBackend("not a url")).toBe(false);
    expect(isAllowedBackend("")).toBe(false);
  });
});

describe("sanitizeBackendUrl (cfg() chokepoint guard)", () => {
  it("keeps an allowed host and strips one trailing slash", () => {
    expect(sanitizeBackendUrl("https://spinixads.com/")).toBe("https://spinixads.com");
    expect(sanitizeBackendUrl(" https://www.spinixads.com ")).toBe("https://www.spinixads.com");
  });
  it("preserves the localhost dev loop", () => {
    expect(sanitizeBackendUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(sanitizeBackendUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
  });
  it("falls back to production for a non-allowlisted host", () => {
    expect(sanitizeBackendUrl("https://evil.example.com")).toBe(DEFAULT_BACKEND);
    expect(sanitizeBackendUrl("https://spinixads.com.evil.example")).toBe(DEFAULT_BACKEND);
  });
  it("falls back to production for empty/undefined/garbage", () => {
    expect(sanitizeBackendUrl("")).toBe(DEFAULT_BACKEND);
    expect(sanitizeBackendUrl(undefined)).toBe(DEFAULT_BACKEND);
    expect(sanitizeBackendUrl(null)).toBe(DEFAULT_BACKEND);
    expect(sanitizeBackendUrl("not a url")).toBe(DEFAULT_BACKEND);
  });
  it("rejects cleartext http to the production host (downgrade attempt)", () => {
    expect(sanitizeBackendUrl("http://spinixads.com")).toBe(DEFAULT_BACKEND);
  });
});
