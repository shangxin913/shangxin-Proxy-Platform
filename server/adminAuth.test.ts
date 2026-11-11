import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const fixture = vi.hoisted(() => ({ passwordHash: null as string | null, user: { openId: "owner-id", role: "admin" }, sdkCalls: 0 }));
vi.mock("./adminSettings", () => ({ getAdminSettings: async () => ({ passwordHash: fixture.passwordHash, authVersion: 1 }), getLocalAdminUser: async () => null }));
vi.mock("./db", () => ({ getUserByOpenId: async () => null }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: async () => { fixture.sdkCalls++; return fixture.user; } } }));
import { authenticateAdminRequest } from "./adminAuth";
const request = { headers: {} } as Request;
afterEach(() => { vi.unstubAllEnvs(); fixture.passwordHash = null; fixture.user = { openId: "owner-id", role: "admin" }; fixture.sdkCalls = 0; });

describe("first-password ownership", () => {
  it("admits only the configured OAuth owner before first password", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "owner-id");
    expect((await authenticateAdminRequest(request))?.openId).toBe("owner-id");
    fixture.user = { openId: "other-admin", role: "admin" };
    expect(await authenticateAdminRequest(request)).toBeNull();
  });
  it("refuses OAuth initialization without a configured owner", async () => {
    vi.stubEnv("OWNER_OPEN_ID", "");
    expect(await authenticateAdminRequest(request)).toBeNull();
    expect(fixture.sdkCalls).toBe(0);
  });
  it("does not accept an OAuth session once password is configured", async () => {
    fixture.passwordHash = "configured";
    vi.stubEnv("OWNER_OPEN_ID", "owner-id");
    expect(await authenticateAdminRequest(request)).toBeNull();
    expect(fixture.sdkCalls).toBe(0);
  });
  it("refuses OAuth fallback on standalone VPS", async () => {
    vi.stubEnv("EXITPANEL_RUNTIME", "vps");
    vi.stubEnv("OWNER_OPEN_ID", "owner-id");
    expect(await authenticateAdminRequest(request)).toBeNull();
  });
});
