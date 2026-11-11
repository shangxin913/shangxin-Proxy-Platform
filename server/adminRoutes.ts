import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticateAdminRequest } from "./adminAuth";
import { getAdminSettings, getLocalAdminUser, reserveLoginAttempt, safeSettings, settingsInput, updateAdminSettings } from "./adminSettings";
import { ADMIN_COOKIE, ADMIN_SESSION_MS, adminClientAddress, adminCookieOptions, assertAdminMutation, isVps, signAdminSession, verifyPassword } from "./adminSecurity";

const handle = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  res.set("Cache-Control", "no-store");
  handler(req, res).catch(error => {
    const status = error instanceof z.ZodError ? 400 : Number(error?.status) || 500;
    const message = error instanceof z.ZodError ? error.issues[0]?.message : status < 500 ? error.message : "管理服务暂不可用，请检查配置";
    res.status(status).json({ error: message });
  });
};

export function registerAdminRoutes(app: Express) {
  app.get("/api/admin/status", handle(async (_req, res) => {
    const row = await getAdminSettings();
    res.json({ configured: Boolean(row.passwordHash), runtime: isVps() ? "vps" : "managed" });
  }));
  app.post("/api/admin/login", handle(async (req, res) => {
    assertAdminMutation(req);
    const { password } = z.object({ password: z.string().min(1).max(256) }).parse(req.body);
    await reserveLoginAttempt(adminClientAddress(req));
    const row = await getAdminSettings();
    if (!row.passwordHash || !await verifyPassword(password, row.passwordHash)) return res.status(401).json({ error: "管理密码不正确" });
    await getLocalAdminUser();
    res.cookie(ADMIN_COOKIE, await signAdminSession(row.authVersion), { ...adminCookieOptions(req), maxAge: ADMIN_SESSION_MS });
    return res.json({ ok: true });
  }));
  app.get("/api/admin/settings", handle(async (req, res) => {
    const user = await authenticateAdminRequest(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "仅管理员可以读取设置" });
    return res.json(safeSettings(await getAdminSettings()));
  }));
  app.post("/api/admin/settings", handle(async (req, res) => {
    assertAdminMutation(req);
    const user = await authenticateAdminRequest(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "仅管理员可以修改设置" });
    const input = settingsInput.parse(req.body);
    await reserveLoginAttempt(adminClientAddress(req));
    const result = await updateAdminSettings(input);
    if (result.sessionInvalidated) res.clearCookie(ADMIN_COOKIE, adminCookieOptions(req));
    return res.json(result);
  }));
}

export function managementPathGuard(app: Express) {
  app.use(async (req, res, next) => {
    if (req.method !== "GET") return next();
    const pagePath = req.path;
    if (pagePath !== "/" && !/^\/[A-Za-z0-9_-]+\/?$/.test(pagePath)) return next();
    try {
      const settings = await getAdminSettings();
      const normalized = pagePath === "/" ? "/" : pagePath.replace(/\/$/, "");
      if (normalized !== settings.managementPath) return res.status(404).type("text/plain").send("Not found");
      next();
    } catch { res.status(503).type("text/plain").send("Administrator setup unavailable"); }
  });
}
