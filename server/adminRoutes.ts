import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticateAdminRequest } from "./adminAuth";
import { getAdminSettings, getLocalAdminUser, reserveLoginAttempt, safeSettings, settingsInput, updateAdminSettings } from "./adminSettings";
import { ADMIN_COOKIE, ADMIN_SESSION_MS, adminClientAddress, adminCookieOptions, assertAdminMutation, isVps, signAdminSession, verifyPassword } from "./adminSecurity";
import { checkForUpdate, startUpdate, updateStatus } from "./updateService";

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
  app.get("/api/admin/update/check", handle(async (req, res) => {
    const user = await authenticateAdminRequest(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "仅管理员可以检查更新" });
    const [info, status] = await Promise.all([checkForUpdate(), isVps() ? updateStatus().catch(() => ({ status: "unavailable" })) : Promise.resolve({ status: "managed" })]);
    return res.json({ ...info, status: status.status, message: status.message });
  }));
  app.post("/api/admin/update/install", handle(async (req, res) => {
    assertAdminMutation(req);
    const user = await authenticateAdminRequest(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "仅管理员可以安装更新" });
    if (!isVps()) return res.status(409).json({ error: "托管网站不能直接更新 VPS，请在 VPS 上安装 v1.0.6 更新代理" });
    const version = z.object({ version: z.string().regex(/^v\d+\.\d+\.\d+$/) }).parse(req.body).version;
    const latest = await checkForUpdate();
    if (version !== latest.latest || !latest.updateAvailable) return res.status(409).json({ error: "版本不是当前可安装的新版本，请重新检查更新" });
    return res.status(202).json(await startUpdate(version));
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
