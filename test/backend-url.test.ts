import { describe, it, expect } from "vitest";
import { isAllowedBackend } from "../src/backend-url";

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
