import "server-only";
/**
 * Health probe pieces for GET /api/health: a bounded `select 1` against the
 * app pool and the AI mode label. Kept out of the route file because Next.js
 * route modules may only export HTTP handlers.
 */
import { aiMode } from "./meter";
import { appDb } from "./db";

export const DB_TIMEOUT_MS = 2_000;

export type DbHealth = "ok" | "down";
export type AiHealth = "enabled" | "disabled" | "mock";

/** "ok" when the database answers within `timeoutMs`, "down" on error or timeout. */
export async function dbStatus(timeoutMs = DB_TIMEOUT_MS): Promise<DbHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`database did not answer within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([appDb`select 1 as ok`, timeout]);
    return "ok";
  } catch {
    return "down";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function aiHealth(env: Record<string, string | undefined> = process.env): AiHealth {
  const mode = aiMode(env);
  return mode === "live" ? "enabled" : mode;
}

export type HealthReport = { ok: boolean; version: string; db: DbHealth; ai: AiHealth };

export async function healthReport(version: string, timeoutMs = DB_TIMEOUT_MS): Promise<HealthReport> {
  const db = await dbStatus(timeoutMs);
  return { ok: db === "ok", version, db, ai: aiHealth() };
}
