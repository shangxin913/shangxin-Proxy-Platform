import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "./adminSecurity";

const fixtures = vi.hoisted(() => ({ passwordHash: "", path: "/secret-entry", authVersion: 1 }));
vi.mock("./adminAuth", () => ({ authenticateAdminRequest: async () => null }));
vi.mock("./adminSettings", () => ({
  getAdminSettings: async () => ({ passwordHash: fixtures.passwordHash, authVersion: fixtures.authVersion, managementPath: fixtures.path }),
  getLocalAdminUser: async () => ({ id: 1, role: "admin" }),
  reserveLoginAttempt: async () => {},
  safeSettings: (row: unknown) => row,
  settingsInput: {},
  updateAdminSettings: async () => ({}),
}));
import { managementPathGuard, registerAdminRoutes } from "./adminRoutes";

let server: Server;
let origin = "";
beforeAll(async () => {
  vi.stubEnv("MANUS_JWT_SECRET", "test-signing-secret-not-a-production-value");
  vi.stubEnv("EXITPANEL_RUNTIME", "managed");
  fixtures.passwordHash = await hashPassword("correct-admin-password");
  const app = express();
  app.use(express.json());
  registerAdminRoutes(app);
  managementPathGuard(app);
  app.get("*", (_req, res) => res.send("management-page"));
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });

const login = (password: string, action = true) => fetch(`${origin}/api/admin/login`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(action ? { "x-exitpanel-action": "1" } : {}) }, body: JSON.stringify({ password }),
});
describe("administrator REST access", () => {
  it("blocks cross-site simple requests", async () => { expect((await login("correct-admin-password", false)).status).toBe(403); });
  it("rejects wrong passwords without issuing a cookie", async () => {
    const response = await login("incorrect-password");
    expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("accepts correct password and issues a secure HttpOnly app session", async () => {
    const response = await login("correct-admin-password");
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") || "";
    expect(cookie).toContain("exitpanel_admin_session="); expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=None");
    expect(await response.json()).toEqual({ ok: true });
  });
  it("blocks unauthorized settings reads and writes", async () => {
    expect((await fetch(`${origin}/api/admin/settings`)).status).toBe(403);
    expect((await fetch(`${origin}/api/admin/settings`, { method: "POST", headers: { "Content-Type": "application/json", "x-exitpanel-action": "1" }, body: "{}" })).status).toBe(403);
  });
  it("serves only the configured management path without revealing it at root", async () => {
    expect((await fetch(`${origin}/`)).status).toBe(404);
    expect((await fetch(`${origin}/another-entry`)).status).toBe(404);
    expect((await fetch(`${origin}/secret-entry`)).status).toBe(200);
  });
});
