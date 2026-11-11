import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { getSessionCookieOptions } from "./_core/cookies";
import { createExit, createNode, deleteExit, deleteNode, ensureSubscriptionToken, getExit, getExitCredential, getNode, getNodeSecret, listChecks, listEvents, listExitPlans, listExits, listNodes, setExitCheck, updateExit, updateNode, type SafeExit } from "./db";
import { databaseReady } from "./health";
import { makeSubscription } from "./subscriptions";
import { applyWorkerXray, checkWorker, validateWorkerUrl, workerHealth, type WorkerConfig } from "./workerClient";

const port = z.coerce.number().int().min(1).max(65535);
const dateInput = z.string().datetime().nullable().optional();

const exitInput = z.object({
  nodeId: z.string().nullable().optional(),
  type: z.enum(["direct", "socks5"]).default("socks5"),
  displayName: z.string().trim().min(1).max(160),
  providerName: z.string().trim().max(120).optional(),
  upstreamHost: z.string().trim().max(255).optional(),
  upstreamPort: port.optional(),
  username: z.string().trim().max(160).optional(),
  password: z.string().max(300).optional(),
  expectedCountry: z.string().trim().max(80).optional(),
  expectedCity: z.string().trim().max(120).optional(),
  entryHost: z.string().trim().min(1).max(255),
  entryPort: port,
  expiresAt: dateInput,
  subscribeEnabled: z.boolean().default(true),
});

function toDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function summarize(exits: SafeExit[]) {
  const now = Date.now();
  const soon = now + 7 * 24 * 60 * 60 * 1000;
  return {
    total: exits.length,
    healthy: exits.filter((e) => e.status === "passed" && e.enabled).length,
    checking: exits.filter((e) => e.status === "checking").length,
    faulted: exits.filter((e) => e.status === "failed" || e.status === "unknown").length,
    expired: exits.filter((e) => e.status === "expired" || (e.expiresAt && e.expiresAt.getTime() < now)).length,
    soon: exits.filter((e) => e.expiresAt && e.expiresAt.getTime() >= now && e.expiresAt.getTime() <= soon).length,
    subscribed: exits.filter((e) => e.subscribeEnabled && e.enabled && e.status === "passed" && (!e.expiresAt || e.expiresAt.getTime() > now)).length,
    entries: exits.filter((e) => e.enabled).length,
  };
}

async function nodeWorkerConfig(nodeId: string): Promise<WorkerConfig> {
  const node = await getNode(nodeId);
  if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "VPS 节点不存在" });
  const secret = await getNodeSecret(nodeId);
  if (!secret) throw new TRPCError({ code: "BAD_REQUEST", message: "该节点没有配置 worker 共享密钥" });
  const baseUrl = /^https?:\/\//.test(node.endpoint) ? node.endpoint : `https://${node.endpoint}:${node.agentPort}`;
  return { baseUrl: validateWorkerUrl(baseUrl), secret };
}

export const appRouter = router({
  system: router({
    health: publicProcedure.query(async () => ({ ok: await databaseReady(), mode: "production" as const })),
    worker: adminProcedure.query(async () => {
      try {
        const result = await workerHealth();
        return { configured: true, reachable: Boolean(result.ok), detail: result.capabilities?.join(", ") || result.service };
      } catch (error) {
        return { configured: Boolean(process.env.EXITPANEL_WORKER_URL && process.env.EXITPANEL_WORKER_SHARED_SECRET), reachable: false, detail: error instanceof Error ? error.message : "worker_unavailable" };
      }
    }),
  }),
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  exits: router({
    list: adminProcedure.query(async () => listExits()),
    summary: adminProcedure.query(async () => summarize(await listExits())),
    detail: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
      const exit = await getExit(input.id);
      if (!exit) throw new TRPCError({ code: "NOT_FOUND", message: "出口不存在" });
      const [checks, events] = await Promise.all([listChecks(input.id), listEvents(input.id)]);
      const { passwordEncrypted: _password, ...safe } = exit;
      return { ...safe, hasPassword: Boolean(_password), checks, events };
    }),
    create: adminProcedure.input(exitInput).mutation(async ({ input }) => {
      if (input.type === "socks5" && (!input.upstreamHost || !input.upstreamPort)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "第三方 SOCKS5 需要填写上游地址和端口" });
      }
      const created = await createExit({ ...input, expiresAt: toDate(input.expiresAt) });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建出口失败" });
      const { passwordEncrypted: _password, ...safe } = created;
      return { ...safe, hasPassword: Boolean(_password) };
    }),
    update: adminProcedure.input(z.object({ id: z.string(), data: exitInput.partial().extend({ enabled: z.boolean().optional() }) })).mutation(async ({ input }) => {
      const updated = await updateExit(input.id, { ...input.data, expiresAt: input.data.expiresAt === undefined ? undefined : toDate(input.data.expiresAt) });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "出口不存在" });
      const { passwordEncrypted: _password, ...safe } = updated;
      return { ...safe, hasPassword: Boolean(_password) };
    }),
    toggle: adminProcedure.input(z.object({ id: z.string(), enabled: z.boolean() })).mutation(async ({ input }) => {
      const updated = await updateExit(input.id, { enabled: input.enabled, status: input.enabled ? "unknown" : "disabled" });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "出口不存在" });
      return { ok: true };
    }),
    remove: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      await deleteExit(input.id);
      return { ok: true };
    }),
    check: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      const exit = await getExit(input.id);
      if (!exit) throw new TRPCError({ code: "NOT_FOUND", message: "出口不存在" });
      if (!exit.enabled || (exit.expiresAt && exit.expiresAt.getTime() <= Date.now())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "停用或已过期出口不能检测，请先启用或续期" });
      }
      if (exit.type !== "socks5") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "当前 worker 尚未支持本机直出探测；不会生成模拟通过结果" });
      }
      if (!exit.upstreamHost || !exit.upstreamPort) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先配置上游 SOCKS5 地址和端口" });
      }
      if (!exit.nodeId && !(process.env.EXITPANEL_WORKER_URL && process.env.EXITPANEL_WORKER_SHARED_SECRET)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "尚未接入 VPS worker，无法执行真实检测" });
      }
      const config = exit.nodeId ? await nodeWorkerConfig(exit.nodeId) : undefined;
      await updateExit(input.id, { status: "checking" });
      try {
        const result = await checkWorker({ host: exit.upstreamHost, port: exit.upstreamPort, username: exit.username || undefined, password: await getExitCredential(exit.id) }, config);
        const { status, observedIp, country, city, latencyMs, errorCode, errorMessage } = result;
        const checked = await setExitCheck(input.id, { status, observedIp, country, city, latencyMs, errorCode, errorMessage });
        if (!checked) throw new Error("Exit no longer exists");
        const { passwordEncrypted: _password, ...safe } = checked;
        return { ...safe, hasPassword: Boolean(_password) };
      } catch {
        await setExitCheck(input.id, { status: "failed", errorCode: "worker_check_failed", errorMessage: "VPS worker 无法完成真实检测，请检查地址、TLS证书和共享密钥" });
        throw new TRPCError({ code: "BAD_GATEWAY", message: "真实检测失败，没有生成可用节点" });
      }
    }),
  }),
  subscriptions: router({
    links: adminProcedure.query(async ({ ctx }) => {
      const token = await ensureSubscriptionToken(ctx.user.id);
      return { base64: `/api/subscription/${token}`, clash: `/api/subscription/${token}?format=clash` };
    }),
    preview: adminProcedure.query(async () => makeSubscription(await listExits())),
  }),
  nodes: router({
    list: adminProcedure.query(() => listNodes()),
    create: adminProcedure.input(z.object({ displayName: z.string().trim().min(1).max(120), endpoint: z.string().trim().min(1).max(255), agentPort: port.default(18443), tunnelMode: z.enum(["direct", "reverse"]).default("direct"), publicEntryHost: z.string().trim().max(255).optional(), sharedSecret: z.string().min(32).max(160).optional() })).mutation(async ({ input }) => ({ id: await createNode(input) })),
    update: adminProcedure.input(z.object({ id: z.string(), data: z.object({ displayName: z.string().trim().min(1).max(120).optional(), endpoint: z.string().trim().min(1).max(255).optional(), agentPort: port.optional(), tunnelMode: z.enum(["direct", "reverse"]).optional(), publicEntryHost: z.string().trim().max(255).optional(), sharedSecret: z.string().min(32).max(160).optional(), status: z.string().max(24).optional() }) })).mutation(async ({ input }) => { await updateNode(input.id, input.data); return { ok: true }; }),
    remove: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      await deleteNode(input.id);
      return { ok: true };
    }),
    applyConfig: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      const config = await nodeWorkerConfig(input.id);
      const result = await applyWorkerXray(config, await listExitPlans(input.id));
      await updateNode(input.id, { status: result.status === "applied" ? "online" : "error" });
      return { ...result, nodeId: input.id };
    }),
  }),
});

export type AppRouter = typeof appRouter;
