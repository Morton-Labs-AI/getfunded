import "server-only";
/**
 * Public API keys (Team and above). A key is `gf_live_` + 32 random base62
 * characters, shown once; the database keeps only its SHA-256 and a display
 * prefix. Verification goes through the SECURITY DEFINER door
 * `getfunded.verify_api_key(hash)` (migrations/getfunded_0008_billing_webhook.sql),
 * because an API request has no signed-in user for RLS to see.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { appDb, type Db } from "@/lib/billing/db";
import { can, planFor } from "@/lib/plans";

export const API_KEY_PREFIX = "gf_live_";
export const API_KEY_RANDOM_LENGTH = 32;
/** Characters of the key kept in `api_keys.key_prefix` for display: `gf_live_` + 8. */
export const API_KEY_DISPLAY_LENGTH = API_KEY_PREFIX.length + 8;
export const API_KEY_PATTERN = /^gf_live_[0-9A-Za-z]{32}$/;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Unbiased random base62: rejection-sample bytes (62 * 4 = 248 accepted values). */
export function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (const b of bytes) {
      if (b >= 248) continue;
      out += BASE62[b % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export type GeneratedApiKey = { plaintext: string; prefix: string; hash: string };

/** Mint a key. Store `prefix` and `hash`; show `plaintext` once and never again. */
export function generateApiKey(): GeneratedApiKey {
  const plaintext = API_KEY_PREFIX + randomBase62(API_KEY_RANDOM_LENGTH);
  return { plaintext, prefix: plaintext.slice(0, API_KEY_DISPLAY_LENGTH), hash: hashApiKey(plaintext) };
}

/** Accepts `Authorization: Bearer gf_live_...` or a bare key; null when absent or malformed. */
export function parseApiKeyHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  const bearer = /^bearer\s+(.+)$/i.exec(trimmed);
  const candidate = (bearer ? bearer[1] : trimmed).trim();
  return API_KEY_PATTERN.test(candidate) ? candidate : null;
}

export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export type ApiPrincipal = {
  keyId: string;
  workspaceId: string;
  name: string;
  scopes: ApiScope[];
  /** The member who created the key; API routes run `withUser(createdBy, ...)` so RLS applies. */
  createdBy: string | null;
  plan: string;
};

export type ApiKeyDeps = { sql?: Db; env?: Record<string, string | undefined> };

export type ApiKeyLookup =
  | { status: "ok"; principal: ApiPrincipal }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "plan_forbidden"; principal: ApiPrincipal };

const RowSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  name: z.string().nullish(),
  scopes: z.array(z.string()).nullish(),
  created_by: z.uuid().nullish(),
  plan: z.string().nullish(),
});

/** Full lookup with the reason a key was rejected. */
export async function lookupApiKey(header: string | null | undefined, deps: ApiKeyDeps = {}): Promise<ApiKeyLookup> {
  const key = parseApiKeyHeader(header);
  if (!key) return header?.trim() ? { status: "invalid" } : { status: "missing" };
  const sql = deps.sql ?? appDb;
  const rows = await sql`select * from getfunded.verify_api_key(${hashApiKey(key)})`;
  if (rows.length === 0) return { status: "invalid" };
  const parsed = RowSchema.safeParse(rows[0]);
  if (!parsed.success) return { status: "invalid" };
  const row = parsed.data;
  const principal: ApiPrincipal = {
    keyId: row.id,
    workspaceId: row.workspace_id,
    name: row.name ?? "",
    scopes: (row.scopes ?? ["read"]).filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s)),
    createdBy: row.created_by ?? null,
    plan: row.plan ?? "free",
  };
  // planFor, not the raw column: SELF_HOSTED puts every workspace on the
  // internal unlimited plan (which includes the API) whatever the column says.
  if (!can(planFor({ plan: principal.plan }, null, deps.env ?? process.env), "api")) return { status: "plan_forbidden", principal };
  return { status: "ok", principal };
}

/** Workspace and scopes for a valid key on a plan with API access; null otherwise. */
export async function verifyApiKey(header: string | null | undefined, deps: ApiKeyDeps = {}): Promise<ApiPrincipal | null> {
  const result = await lookupApiKey(header, deps);
  return result.status === "ok" ? result.principal : null;
}

function unauthorized(message: string, status: 401 | 403): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 401) headers["WWW-Authenticate"] = 'Bearer realm="getfunded", error="invalid_token"';
  return Response.json({ error: status === 401 ? "unauthorized" : "forbidden", message }, { status, headers });
}

export type RequireApiKeyResult = { ok: true; principal: ApiPrincipal } | { ok: false; response: Response };

/**
 * For /api/v1 route handlers:
 *   const auth = await requireApiKey(req, { scope: "read" });
 *   if (!auth.ok) return auth.response;
 */
export async function requireApiKey(
  req: Request,
  opts: { scope?: ApiScope } = {},
  deps: ApiKeyDeps = {},
): Promise<RequireApiKeyResult> {
  const result = await lookupApiKey(req.headers.get("authorization"), deps);
  switch (result.status) {
    case "missing":
      return { ok: false, response: unauthorized("Send your API key as `Authorization: Bearer gf_live_...`.", 401) };
    case "invalid":
      return { ok: false, response: unauthorized("This API key is not valid or has been revoked.", 401) };
    case "plan_forbidden":
      return { ok: false, response: unauthorized("API access is included in the Team plan and above.", 403) };
    case "ok": {
      const scope = opts.scope ?? "read";
      if (!result.principal.scopes.includes(scope)) {
        return { ok: false, response: unauthorized(`This API key does not have the "${scope}" scope.`, 403) };
      }
      return { ok: true, principal: result.principal };
    }
  }
}
