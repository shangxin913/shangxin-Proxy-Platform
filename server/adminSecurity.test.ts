import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { adminCookieOptions, assertAdminMutation, hashPassword, signAdminSession, validListenAddress, validManagementPath, verifyAdminSession, verifyPassword } from "./adminSecurity";

afterEach(() => vi.unstubAllEnvs());

describe("administrator password security", () => {
  it("salts equal passwords differently and verifies only correct input", async () => {
    const a = await hashPassword("test-password-at-least-12");
    const b = await hashPassword("test-password-at-least-12");
    expect(a).not.toBe(b);
    expect(await verifyPassword("test-password-at-least-12", a)).toBe(true);
    expect(await verifyPassword("incorrect-password", a)).toBe(false);
    expect(await verifyPassword("wrong", "invalid")).toBe(false);
  });
  it("invalidates old sessions by authentication version and project binding", async () => {
    vi.stubEnv("MANUS_JWT_SECRET", "unit-test-secret-32-bytes-or-more-not-production");
    vi.stubEnv("MANUS_PROJECT_ID", "test-project");
    const token = await signAdminSession(1);
    expect(await verifyAdminSession(token, 1)).toBe(true);
    expect(await verifyAdminSession(token, 2)).toBe(false);
    expect(await verifyAdminSession(token + "bad", 1)).toBe(false);
    vi.stubEnv("MANUS_PROJECT_ID", "other-project");
    expect(await verifyAdminSession(token, 1)).toBe(false);
  });
  it("rejects missing session secrets", async () => {
    vi.stubEnv("MANUS_JWT_SECRET", "");
    await expect(signAdminSession(1)).rejects.toThrow();
  });
  it("allows single custom path while rejecting reserved/unsafe paths", () => {
    for (const value of ["/", "/admin_a8V-2"]) expect(validManagementPath(value)).toBe(true);
    for (const value of ["//evil.test", "/api", "/assets", "/__system__", "/a/b", "/?x", "/.."]) expect(validManagementPath(value)).toBe(false);
  });
  it("validates listener addresses", () => {
    for (const value of ["0.0.0.0", "127.0.0.1", "::1", "localhost"]) expect(validListenAddress(value)).toBe(true);
    expect(validListenAddress("0.0.0.0; rm -rf /")).toBe(false);
  });
  it("keeps secure cross-site managed cookies and separates VPS HTTP handling", () => {
    vi.stubEnv("EXITPANEL_RUNTIME", "managed");
    expect(adminCookieOptions({} as Request)).toMatchObject({ secure: true, sameSite: "none", httpOnly: true });
    vi.stubEnv("EXITPANEL_RUNTIME", "vps");
    expect(adminCookieOptions({ secure: false, get: () => "http" } as unknown as Request)).toMatchObject({ secure: false, sameSite: "lax" });
    expect(adminCookieOptions({ secure: false, get: () => "https" } as unknown as Request)).toMatchObject({ secure: true });
  });
  it("rejects browser forms without required non-simple header", () => {
    expect(() => assertAdminMutation({ get: () => undefined, is: () => false } as unknown as Request)).toThrow();
    expect(() => assertAdminMutation({ get: () => "1", is: () => "application/json" } as unknown as Request)).not.toThrow();
  });
});
