import "server-only";
/**
 * The do-not-contact list: `getfunded.suppressions` (kind 'email' | 'domain').
 * Checked at approve time and again at send time (lib/outreach/suppress.ts).
 */
import { iso, str, withUser, type Ctx } from "./db";
import { isValidEmail, normalizeDomain, normalizeEmail, type SuppressionEntry } from "./suppress";
import type { Suppression } from "./types";

export async function listSuppressions(ctx: Ctx): Promise<Suppression[]> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql`
      select workspace_id, kind, value, reason, created_by, created_at
      from getfunded.suppressions
      where workspace_id = ${ctx.workspaceId}::uuid
      order by created_at desc`;
    return rows.map((r) => ({
      workspaceId: String(r.workspace_id),
      kind: r.kind as "email" | "domain",
      value: String(r.value),
      reason: str(r.reason),
      createdBy: str(r.created_by),
      createdAt: iso(r.created_at) ?? "",
    }));
  });
}

export async function suppressionEntries(ctx: Ctx): Promise<SuppressionEntry[]> {
  const rows = await listSuppressions(ctx);
  return rows.map((r) => ({ kind: r.kind, value: r.value, reason: r.reason }));
}

export type AddSuppressionResult = { ok: true; value: string } | { ok: false; error: string };

export async function addSuppression(ctx: Ctx, input: { kind: "email" | "domain"; value: string; reason: string }): Promise<AddSuppressionResult> {
  const value = input.kind === "email" ? normalizeEmail(input.value) : normalizeDomain(input.value);
  if (input.kind === "email" && !isValidEmail(value)) return { ok: false, error: "Enter a full email address, like grants@example.org." };
  if (input.kind === "domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return { ok: false, error: "Enter a domain, like example.org." };
  await withUser(ctx.userId, async (sql) => {
    await sql`
      insert into getfunded.suppressions (workspace_id, kind, value, reason, created_by)
      values (${ctx.workspaceId}::uuid, ${input.kind}, ${value}, ${input.reason || null}, ${ctx.userId}::uuid)
      on conflict (workspace_id, kind, value) do nothing`;
  });
  return { ok: true, value };
}

export async function removeSuppression(ctx: Ctx, input: { kind: "email" | "domain"; value: string }): Promise<void> {
  await withUser(ctx.userId, async (sql) => {
    await sql`
      delete from getfunded.suppressions
      where workspace_id = ${ctx.workspaceId}::uuid and kind = ${input.kind} and value = ${input.value}`;
  });
}
