import { parse } from "cookie";
import type { Request } from "express";
import type { User } from "../drizzle/schema";
import { getUserByOpenId } from "./db";
import { getAdminSettings, getLocalAdminUser } from "./adminSettings";
import { ADMIN_COOKIE, isVps, verifyAdminSession } from "./adminSecurity";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";

export async function authenticateAdminRequest(req: Request): Promise<User | null> {
  const row = await getAdminSettings();
  const token = parse(req.headers.cookie || "")[ADMIN_COOKIE];
  if (token && row.passwordHash && await verifyAdminSession(token, row.authVersion)) {
    const user = await getUserByOpenId("exitpanel:password-admin");
    return user ?? getLocalAdminUser();
  }
  // OAuth is only the authenticated owner's first-password setup route.
  if (row.passwordHash || isVps()) return null;
  if (!ENV.ownerOpenId) return null;
  try {
    const owner = await sdk.authenticateRequest(req);
    return owner.openId === ENV.ownerOpenId && owner.role === "admin" ? owner : null;
  } catch { return null; }
}
