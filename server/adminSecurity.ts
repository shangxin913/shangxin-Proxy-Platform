import crypto from "node:crypto";
import { isIP } from "node:net";
import { SignJWT, jwtVerify } from "jose";
import type { CookieOptions, Request } from "express";
import { ENV } from "./_core/env";

export const ADMIN_COOKIE = "exitpanel_admin_session";
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
export const isVps = () => process.env.EXITPANEL_RUNTIME === "vps";

export function sessionKey() {
  const secret = process.env.MANUS_JWT_SECRET;
  if (!secret) throw new Error("Administrator session secret is unavailable");
  return new TextEncoder().encode(secret);
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded || password.length > 256) return false;
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const key = await derive(password, parts[1]);
  return crypto.timingSafeEqual(key, Buffer.from(parts[2], "hex"));
}

export async function signAdminSession(authVersion: number) {
  return new SignJWT({ appId: ENV.appId || "standalone", authVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("exitpanel-local-admin")
    .setAudience("exitpanel-admin")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(sessionKey());
}

export async function verifyAdminSession(token: string, authVersion: number) {
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"], audience: "exitpanel-admin" });
    return payload.sub === "exitpanel-local-admin" && payload.appId === (ENV.appId || "standalone") && payload.authVersion === authVersion;
  } catch { return false; }
}

export function adminCookieOptions(req: Request): CookieOptions {
  if (!isVps()) return { httpOnly: true, path: "/", sameSite: "none", secure: true };
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  return { httpOnly: true, path: "/", sameSite: "lax", secure };
}

export function validManagementPath(path: string) {
  if (path === "/") return true;
  return /^\/[A-Za-z0-9_-]{1,80}$/.test(path) && !/^\/(api|assets|404|favicon|manus|__)/i.test(path);
}

export function validListenAddress(address: string) { return address === "localhost" || isIP(address) !== 0; }

export function adminClientAddress(req: Request) {
  // Public TCP clients cannot supply their own source address through headers.
  const remote = req.socket.remoteAddress;
  if (remote) return remote;
  // Only our configured local Unix socket accepts nginx's overwritten header.
  const realIp = req.get("x-real-ip");
  if (isVps() && process.env.EXITPANEL_ADMIN_SOCKET && realIp && isIP(realIp)) return realIp;
  return "unknown";
}

// Non-simple JSON requests cannot be made by cross-site forms. Cross-site fetch
// requires a CORS preflight, which this application does not authorize.
export function assertAdminMutation(req: Request) {
  if (req.get("x-exitpanel-action") !== "1" || !req.is("application/json")) {
    throw Object.assign(new Error("请求校验失败，请从管理页面提交"), { status: 403 });
  }
}
