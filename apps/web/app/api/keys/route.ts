/**
 * GET  /api/keys                      → { keys: [...] }  (owner/admin; Team and above)
 * POST /api/keys { name, scopes? }    → { id, name, prefix, scopes, plaintext }
 *
 * The plaintext key is in the POST response and nowhere else. Same-origin,
 * signed-in, owner or admin; the plan check (`can(plan, "api")`) happens in
 * the service against the resolved plan, so SELF_HOSTED installs qualify.
 */
import { withUser } from "@/lib/db/app";
import { assertSameOrigin, boundedJson } from "@/lib/security";
import { ok, requireAdminContext, settingsErrorResponse } from "@/lib/settings/http";
import { apiKeyCreateSchema } from "@/lib/settings/schemas";
import { createApiKey, listApiKeys } from "@/lib/settings/service";

export async function GET(): Promise<Response> {
  const pre = await requireAdminContext();
  if ("response" in pre) return pre.response;
  const { user, workspace } = pre.ctx;
  try {
    const keys = await withUser(user.id, (sql) => listApiKeys(sql, workspace.id));
    return ok({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.key_prefix,
        scopes: k.scopes,
        createdAt: k.created_at.toISOString(),
        lastUsedAt: k.last_used_at?.toISOString() ?? null,
        revokedAt: k.revoked_at?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    const res = settingsErrorResponse(error);
    if (res) return res;
    throw error;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);
    const pre = await requireAdminContext();
    if ("response" in pre) return pre.response;
    const { user, workspace } = pre.ctx;
    const body = await boundedJson(req, apiKeyCreateSchema, 4_000);
    const key = await withUser(user.id, (sql) =>
      createApiKey(sql, { workspaceId: workspace.id, name: body.name, scopes: body.scopes, createdBy: user.id }),
    );
    return ok({ id: key.id, name: key.name, prefix: key.prefix, scopes: key.scopes, plaintext: key.plaintext }, 201);
  } catch (error) {
    const res = settingsErrorResponse(error);
    if (res) return res;
    throw error;
  }
}
