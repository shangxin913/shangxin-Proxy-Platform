import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { adminLoginBuckets, panelSettings, type PanelSettings } from "../drizzle/schema";
import { getDb, getUserByOpenId, upsertUser } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { hashPassword, isVps, sessionKey, validListenAddress, validManagementPath, verifyPassword } from "./adminSecurity";

export const APP_VERSION = "v1.0.4";
const LOCAL_ADMIN = "exitpanel:password-admin";

export const settingsInput = z.object({
  adminPort: z.number().int().min(1024).max(65535),
  listenAddress: z.string().max(64).refine(validListenAddress, "监听地址必须是 IP 地址或 localhost"),
  managementPath: z.string().max(96).refine(validManagementPath, "管理路径须为 / 或单段字母、数字、下划线、短横线，且不能使用系统保留路径"),
  currentPassword: z.string().max(256).default(""),
  newPassword: z.string().max(256).refine(value => !value || value.length >= 12, "新密码至少需要 12 个字符").default(""),
  revision: z.number().int().positive(),
});

export function safeSettings(row: PanelSettings) {
  return {
    adminPort: row.adminPort, listenAddress: row.listenAddress, managementPath: row.managementPath,
    passwordConfigured: Boolean(row.passwordHash), revision: row.revision,
    runtime: isVps() ? "vps" as const : "managed" as const,
    networkEditable: isVps(), version: APP_VERSION,
    proxyEnabled: Boolean(process.env.EXITPANEL_PUBLIC_ORIGIN),
  };
}

async function requireDb() { const db = await getDb(); if (!db) throw new Error("Database is unavailable"); return db; }

export async function getAdminSettings() {
  const db = await requireDb();
  const [existing] = await db.select().from(panelSettings).where(eq(panelSettings.id, 1)).limit(1);
  if (existing) return existing;
  const initialPassword = process.env.EXITPANEL_INITIAL_PASSWORD || "";
  const adminPort = Number(process.env.EXITPANEL_ADMIN_PORT || "8899");
  const listenAddress = process.env.EXITPANEL_ADMIN_LISTEN || "0.0.0.0";
  const managementPath = process.env.EXITPANEL_ADMIN_PATH || "/";
  if (!Number.isInteger(adminPort) || adminPort < 1024 || adminPort > 65535 || !validListenAddress(listenAddress) || !validManagementPath(managementPath)) throw new Error("Invalid administrator startup settings");
  if (isVps() && initialPassword.length < 12) throw new Error("VPS initial administrator password is required");
  await db.insert(panelSettings).values({ id: 1, adminPort, listenAddress, managementPath, passwordHash: initialPassword ? await hashPassword(initialPassword) : null, passwordEncrypted: initialPassword && isVps() ? encryptSecret(initialPassword) : null }).onDuplicateKeyUpdate({ set: { id: 1 } });
  const [row] = await db.select().from(panelSettings).where(eq(panelSettings.id, 1)).limit(1);
  if (!row) throw new Error("Administrator configuration initialization failed");
  return row;
}

export async function getLocalAdminUser() {
  await upsertUser({ openId: LOCAL_ADMIN, name: "管理员", loginMethod: "password", role: "admin", lastSignedIn: new Date() });
  const user = await getUserByOpenId(LOCAL_ADMIN);
  if (!user) throw new Error("Administrator account initialization failed");
  return user;
}

export async function reserveLoginAttempt(address: string) {
  const db = await requireDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 15 * 60_000);
  const keys = [crypto.createHash("sha256").update("global-login-budget").digest("hex"), crypto.createHmac("sha256", sessionKey()).update(address).digest("hex")];
  for (const [index, keyHash] of keys.entries()) {
    await db.insert(adminLoginBuckets).values({ keyHash, attempts: 1, windowStart: now }).onDuplicateKeyUpdate({ set: {
      attempts: sql`IF(${adminLoginBuckets.windowStart} < ${cutoff}, 1, ${adminLoginBuckets.attempts} + 1)`,
      windowStart: sql`IF(${adminLoginBuckets.windowStart} < ${cutoff}, ${now}, ${adminLoginBuckets.windowStart})`,
    } });
    const [bucket] = await db.select().from(adminLoginBuckets).where(eq(adminLoginBuckets.keyHash, keyHash)).limit(1);
    if (!bucket || bucket.attempts > (index === 0 ? 60 : 10)) throw Object.assign(new Error("登录尝试过多，请 15 分钟后重试"), { status: 429 });
  }
  // Bound storage without retaining network-address identifiers indefinitely.
  await db.delete(adminLoginBuckets).where(sql`${adminLoginBuckets.windowStart} < ${new Date(now.getTime() - 24 * 60 * 60_000)}`);
}

export type NetworkPreparation = { commit: () => void; rollback: () => Promise<void> };
let prepareNetwork: ((settings: Pick<PanelSettings, "adminPort" | "listenAddress">) => Promise<NetworkPreparation>) | undefined;
export function setNetworkPreparer(callback: NonNullable<typeof prepareNetwork>) { prepareNetwork = callback; }

export async function updateAdminSettings(input: z.infer<typeof settingsInput>) {
  const db = await requireDb();
  const old = await getAdminSettings();
  if (old.revision !== input.revision) throw Object.assign(new Error("设置已更新，请重新加载后再保存"), { status: 409 });
  if (old.passwordHash && !(await verifyPassword(input.currentPassword, old.passwordHash))) throw Object.assign(new Error("当前管理密码不正确"), { status: 403 });
  if (!old.passwordHash && !input.newPassword) throw Object.assign(new Error("首次设置请填写至少 12 位的新管理密码"), { status: 400 });
  const networkChanged = old.adminPort !== input.adminPort || old.listenAddress !== input.listenAddress;
  if (!isVps() && networkChanged) throw Object.assign(new Error("托管网站端口和监听地址由平台管理，不能在此修改"), { status: 400 });
  const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : old.passwordHash;
  const passwordEncrypted = input.newPassword && isVps() ? encryptSecret(input.newPassword) : old.passwordEncrypted;
  let prepared: NetworkPreparation | undefined;
  try {
    await db.transaction(async tx => {
      const [current] = await tx.select().from(panelSettings).where(eq(panelSettings.id, 1)).for("update");
      if (!current || current.revision !== input.revision) throw Object.assign(new Error("设置已更新，请重新加载"), { status: 409 });
      if (networkChanged) {
        if (!prepareNetwork) throw Object.assign(new Error("当前运行实例不能应用网络设置"), { status: 503 });
        prepared = await prepareNetwork(input);
      }
      await tx.update(panelSettings).set({ adminPort: input.adminPort, listenAddress: input.listenAddress, managementPath: input.managementPath, passwordHash, passwordEncrypted, authVersion: current.authVersion + (input.newPassword ? 1 : 0), revision: current.revision + 1, updatedAt: new Date() }).where(eq(panelSettings.id, 1));
    });
    prepared?.commit();
  } catch (error) {
    await prepared?.rollback();
    throw error;
  }
  return { settings: safeSettings(await getAdminSettings()), sessionInvalidated: Boolean(input.newPassword), networkChanged, managementPath: input.managementPath };
}

export async function resetAdminPassword() {
  const db = await requireDb();
  const password = crypto.randomBytes(24).toString("base64url");
  const row = await getAdminSettings();
  await db.update(panelSettings).set({ passwordHash: await hashPassword(password), passwordEncrypted: isVps() ? encryptSecret(password) : null, authVersion: sql`${panelSettings.authVersion} + 1`, revision: sql`${panelSettings.revision} + 1`, updatedAt: new Date() }).where(eq(panelSettings.id, row.id));
  return password;
}

export function rootVisiblePassword(row: PanelSettings) { return row.passwordEncrypted ? decryptSecret(row.passwordEncrypted) : null; }

export function managementUrl(row: Pick<PanelSettings, "adminPort" | "managementPath">) {
  const origin = process.env.EXITPANEL_PUBLIC_ORIGIN;
  if (origin) return `${origin.replace(/\/$/, "")}${row.managementPath}`;
  const rawHost = process.env.EXITPANEL_PUBLIC_HOST || "VPS_IP";
  const host = rawHost.includes(":") && !rawHost.startsWith("[") ? `[${rawHost}]` : rawHost;
  return `http://${host}:${row.adminPort}${row.managementPath}`;
}
