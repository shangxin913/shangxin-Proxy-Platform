import { sql } from "drizzle-orm";
import { getDb } from "./db";

export async function databaseReady(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    // Verify connectivity AND the migrated schema needed by login/resources.
    await db.execute(sql`SELECT id, openId, role, subscriptionToken FROM users LIMIT 0`);
    await db.execute(sql`SELECT id, nodeId, passwordEncrypted FROM exits LIMIT 0`);
    await db.execute(sql`SELECT id, endpoint, sharedSecretEncrypted FROM nodes LIMIT 0`);
    await db.execute(sql`SELECT id, authVersion, revision FROM panelSettings LIMIT 0`);
    await db.execute(sql`SELECT keyHash, attempts FROM adminLoginBuckets LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}
