import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getUserBySubscriptionToken, listExits } from "../db";
import { makeSubscription } from "../subscriptions";
import { databaseReady } from "../health";
import { managementPathGuard, registerAdminRoutes } from "../adminRoutes";
import { getAdminSettings } from "../adminSettings";
import { assertAdminMutation, isVps } from "../adminSecurity";
import { startVpsListeners } from "../adminRuntime";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerAdminRoutes(app);
  app.get("/api/health", async (_req, res) => {
    const ready = await databaseReady();
    res.set("Cache-Control", "no-store").status(ready ? 200 : 503).json({
      status: ready ? "ok" : "not_ready",
      database: ready ? "ready" : "unavailable",
      worker: process.env.EXITPANEL_WORKER_URL && process.env.EXITPANEL_WORKER_SHARED_SECRET ? "configured" : "not_configured",
    });
  });
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  app.get("/api/subscription/:token", async (req, res) => {
    const token = String(req.params.token || "");
    if (!/^sub_[A-Za-z0-9_-]{20,80}$/.test(token)) return res.status(404).json({ error: "not_found" });
    const owner = await getUserBySubscriptionToken(token);
    if (!owner) return res.status(404).json({ error: "not_found" });
    const rows = await listExits();
    const subscription = makeSubscription(rows as any);
    res.set("Cache-Control", "no-store");
    if (req.query.format === "clash") return res.type("application/json").send(JSON.stringify(subscription.clash, null, 2));
    return res.type("text/plain").send(subscription.base64);
  });
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    (req, res, next) => {
      if (req.method === "POST") {
        try { assertAdminMutation(req); } catch { res.status(403).json({ error: "Invalid administrative request" }); return; }
      }
      next();
    },
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  managementPathGuard(app);
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  if (isVps()) await startVpsListeners(app, await getAdminSettings());
  else server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
