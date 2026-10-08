/**
 * Public API v1 handlers. Each takes its collaborators as `deps` so the route
 * files stay one line and the tests run with fakes (no database, no corpus).
 *
 *   GET /api/v1/search           same query parameters and response as /api/search
 *   GET /api/v1/funders/{id}     one funder profile, `?include=grants,financials,officers,contacts,similar`
 *   GET /api/v1/saved            the key's workspace's saved funders (page, limit)
 *
 * Every route: Team plan or above (`can(plan, "api")` inside requireApiKey),
 * `read` scope, 600 requests per minute per key, no caching, no CORS.
 */
import { z } from "zod";

import type { ApiPrincipal } from "@/lib/api/keys";

import { authenticateV1, searchParamsRecord, v1Error, v1Json, type V1AuthDeps } from "./shared";

/* ----------------------------------------------------------------- search */

export type SearchDeps = V1AuthDeps & {
  /** B1: lib/search/params.ts parseSearchParams. Throws or returns a value; both handled. */
  parseSearchParams: (raw: Record<string, string | string[] | undefined>) => unknown;
  /** B1: lib/queries/corpus/search.ts searchFunders. */
  searchFunders: (params: unknown) => Promise<unknown>;
};

export async function handleV1Search(req: Request, deps: SearchDeps): Promise<Response> {
  const auth = await authenticateV1(req, deps);
  if (!auth.ok) return auth.response;

  let params: unknown;
  try {
    params = deps.parseSearchParams(searchParamsRecord(new URL(req.url)));
  } catch (err) {
    return v1Error(400, "invalid_params", err instanceof Error ? err.message : "Those search parameters are not valid.");
  }

  try {
    const result = await deps.searchFunders(params);
    return v1Json(result);
  } catch (err) {
    return searchFailure(err);
  }
}

function searchFailure(err: unknown): Response {
  const code = (err as { code?: string } | null)?.code;
  if (code === "timeout") {
    return v1Error(504, "search_timeout", "The search took too long. Narrow the query or add a filter and try again.");
  }
  return v1Error(500, "search_failed", "The search could not be completed. Try again in a moment.");
}

/* ----------------------------------------------------------------- funder */

export const FUNDER_INCLUDES = ["grants", "financials", "officers", "contacts", "similar"] as const;
export type FunderInclude = (typeof FUNDER_INCLUDES)[number];

export type FunderDeps = V1AuthDeps & {
  /** B1: lib/queries/corpus/funder.ts. Only getFunder is required; the rest serve `include`. */
  getFunder: (orgId: string) => Promise<unknown | null>;
  getFunderGrants?: (orgId: string) => Promise<unknown>;
  getFunderFinancials?: (orgId: string) => Promise<unknown>;
  getFunderOfficers?: (orgId: string) => Promise<unknown>;
  getFunderContacts?: (orgId: string) => Promise<unknown>;
  getSimilarFunders?: (orgId: string) => Promise<unknown>;
};

const uuid = z.uuid();

/** "grants, financials" → ["grants","financials"]; unknown names are reported, not ignored. */
export function parseIncludes(raw: string | null): { ok: true; includes: FunderInclude[] } | { ok: false; unknown: string[] } {
  if (!raw || raw.trim() === "") return { ok: true, includes: [] };
  const names = Array.from(new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)));
  const unknown = names.filter((n) => !(FUNDER_INCLUDES as readonly string[]).includes(n));
  if (unknown.length > 0) return { ok: false, unknown };
  return { ok: true, includes: names as FunderInclude[] };
}

export async function handleV1Funder(req: Request, rawId: string, deps: FunderDeps): Promise<Response> {
  const auth = await authenticateV1(req, deps);
  if (!auth.ok) return auth.response;

  const id = uuid.safeParse(rawId);
  if (!id.success) return v1Error(400, "invalid_id", "A funder id is a UUID, like the `id` returned by /api/v1/search.");

  const inc = parseIncludes(new URL(req.url).searchParams.get("include"));
  if (!inc.ok) {
    return v1Error(400, "invalid_include", `Unknown include: ${inc.unknown.join(", ")}. Choose from ${FUNDER_INCLUDES.join(", ")}.`);
  }

  let funder: unknown;
  try {
    funder = await deps.getFunder(id.data);
  } catch (err) {
    return searchFailure(err);
  }
  if (funder === null || funder === undefined) {
    return v1Error(404, "not_found", "No funder with that id is in the database.");
  }

  const loaders: Record<FunderInclude, FunderDeps[`getFunder${"Grants" | "Financials" | "Officers" | "Contacts"}`] | FunderDeps["getSimilarFunders"]> = {
    grants: deps.getFunderGrants,
    financials: deps.getFunderFinancials,
    officers: deps.getFunderOfficers,
    contacts: deps.getFunderContacts,
    similar: deps.getSimilarFunders,
  };

  const extras: Record<string, unknown> = {};
  const unavailable: string[] = [];
  await Promise.all(
    inc.includes.map(async (name) => {
      const loader = loaders[name];
      if (!loader) {
        unavailable.push(name);
        return;
      }
      try {
        extras[name] = await loader(id.data);
      } catch {
        extras[name] = null;
        unavailable.push(name);
      }
    }),
  );

  const body: Record<string, unknown> = { funder };
  if (inc.includes.length > 0) body.included = extras;
  if (unavailable.length > 0) body.unavailable = unavailable.sort();
  return v1Json(body);
}

/* ------------------------------------------------------------------ saved */

export type SavedFunderRow = {
  id: string;
  org_id: string;
  snapshot: unknown;
  stage: string;
  tier: number | null;
  owner_id: string | null;
  ask_amount: number | string | null;
  next_action: string | null;
  next_action_due: string | null;
  source_detail: string | null;
  tags: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type SavedPage = { rows: SavedFunderRow[]; total: number };

export type SavedDeps = V1AuthDeps & {
  /**
   * List the workspace's saved funders as `userId` (RLS applies). Returns
   * null when that user is no longer a member of the workspace.
   */
  listSaved: (
    ctx: { userId: string; workspaceId: string },
    page: { limit: number; offset: number; includeArchived: boolean },
  ) => Promise<SavedPage | null>;
};

const savedQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  archived: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
});

export async function handleV1Saved(req: Request, deps: SavedDeps): Promise<Response> {
  const auth = await authenticateV1(req, deps);
  if (!auth.ok) return auth.response;
  const principal: ApiPrincipal = auth.principal;

  const url = new URL(req.url);
  const parsed = savedQuery.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    archived: url.searchParams.get("archived") ?? undefined,
  });
  if (!parsed.success) {
    return v1Error(400, "invalid_params", "page is 1 or more, limit is 1 to 200, archived is true or false.", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    });
  }
  if (!principal.createdBy) {
    return v1Error(403, "key_owner_missing", "The member who created this key no longer exists. Create a new key in Settings.");
  }

  const { page, limit, archived } = parsed.data;
  const result = await deps.listSaved(
    { userId: principal.createdBy, workspaceId: principal.workspaceId },
    { limit, offset: (page - 1) * limit, includeArchived: archived },
  );
  if (result === null) {
    return v1Error(403, "key_owner_not_member", "The member who created this key is no longer in this workspace. Create a new key in Settings.");
  }

  return v1Json({
    data: result.rows,
    page,
    limit,
    total: result.total,
    has_more: page * limit < result.total,
  });
}
