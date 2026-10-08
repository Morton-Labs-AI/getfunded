/**
 * The OpenAPI 3.1 description of the public API v1, served at
 * GET /api/v1/openapi.json. Pure; the docs (B5) render it. Shapes that belong
 * to the corpus query layer (a search result, a funder profile) are described
 * loosely on purpose: /api/v1/search returns exactly what /api/search returns,
 * and the funder profile is the same record the public /funder/{id} page uses.
 */

export const OPENAPI_VERSION = "3.1.0";
export const API_VERSION = "1.0.0";

export const V1_PATHS = ["/api/v1/search", "/api/v1/funders/{id}", "/api/v1/saved", "/api/v1/openapi.json"] as const;

type Schema = Record<string, unknown>;

const errorSchema: Schema = {
  type: "object",
  required: ["error", "message"],
  properties: {
    error: { type: "string", description: "A short, stable code, e.g. unauthorized, forbidden, rate_limited, not_found." },
    message: { type: "string", description: "Plain-language explanation." },
  },
  additionalProperties: true,
};

function errorResponse(description: string, extra: Record<string, unknown> = {}): Schema {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    ...extra,
  };
}

const commonErrors: Record<string, Schema> = {
  "401": errorResponse("No key, or a key that is not valid or was revoked. The `WWW-Authenticate` header is set.", {
    headers: { "WWW-Authenticate": { schema: { type: "string" } } },
  }),
  "403": errorResponse("The key's workspace is below the Team plan, or the key lacks the `read` scope."),
  "429": errorResponse("More than 600 requests in a minute for this key. `Retry-After` is in seconds.", {
    headers: { "Retry-After": { schema: { type: "integer" } } },
  }),
};

export function buildOpenApiDocument(baseUrl: string): Record<string, unknown> {
  const server = baseUrl.replace(/\/+$/, "");
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: "GetFunded API",
      version: API_VERSION,
      summary: "Funder search and profiles from public IRS filings, plus your workspace's saved funders.",
      description:
        "Available on the Team plan and above. Create a key under Settings → API; send it as " +
        "`Authorization: Bearer gf_live_...`. Search never costs AI credits. Facts come from public " +
        "filings (CC BY 4.0); missing values are null, never 0, and application posture uses the " +
        "values `open`, `preselected_only` and `unknown` (unknown means the filing does not say).",
      license: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
    },
    servers: [{ url: server || "/" }],
    security: [{ apiKey: [] }],
    tags: [
      { name: "Funders", description: "The open corpus: 2.3M organizations from IRS 990 / 990-PF and BMF data." },
      { name: "Workspace", description: "Your workspace's own data." },
    ],
    paths: {
      "/api/v1/search": {
        get: {
          operationId: "searchFunders",
          tags: ["Funders"],
          summary: "Search funders",
          description:
            "Takes the same query parameters as the public /api/search endpoint and returns the same JSON. " +
            "Typical parameters: `q` (words or a sentence), `type` (org type), `state`, `posture` " +
            "(`open`, `preselected_only`, `unknown`), `min_distributions`, `page`.",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Name, EIN, or a description of the work you do." },
            { name: "type", in: "query", schema: { type: "string" }, description: "Organization type filter.", style: "form", explode: true },
            { name: "state", in: "query", schema: { type: "string", minLength: 2, maxLength: 2 }, description: "Two-letter state." },
            { name: "posture", in: "query", schema: { type: "string", enum: ["open", "preselected_only", "unknown"] } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          ],
          responses: {
            "200": {
              description: "The search result object, identical to /api/search.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/SearchResult" } } },
            },
            "400": errorResponse("A parameter is not valid."),
            ...commonErrors,
            "504": errorResponse("The search timed out. Narrow the query."),
          },
        },
      },
      "/api/v1/funders/{id}": {
        get: {
          operationId: "getFunder",
          tags: ["Funders"],
          summary: "One funder profile",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "The funder's id from a search result." },
            {
              name: "include",
              in: "query",
              schema: { type: "string" },
              description: "Comma-separated extras: grants, financials, officers, contacts, similar. Contacts are public role-based channels only.",
              example: "grants,financials",
            },
          ],
          responses: {
            "200": {
              description: "The profile, with any included sections under `included`.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/FunderResponse" } } },
            },
            "400": errorResponse("The id is not a UUID or `include` names an unknown section."),
            ...commonErrors,
            "404": errorResponse("No funder with that id."),
          },
        },
      },
      "/api/v1/saved": {
        get: {
          operationId: "listSavedFunders",
          tags: ["Workspace"],
          summary: "Saved funders in the key's workspace",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
            { name: "archived", in: "query", schema: { type: "boolean", default: false }, description: "Include archived rows." },
          ],
          responses: {
            "200": {
              description: "A page of saved funders.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/SavedPage" } } },
            },
            "400": errorResponse("A parameter is out of range."),
            ...commonErrors,
          },
        },
      },
      "/api/v1/openapi.json": {
        get: {
          operationId: "getOpenApi",
          summary: "This document",
          security: [],
          responses: { "200": { description: "The OpenAPI 3.1 document.", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "gf_live_...",
          description: "A workspace API key (Team plan and above). 600 requests per minute per key.",
        },
      },
      schemas: {
        Error: errorSchema,
        SearchResult: {
          type: "object",
          description: "Identical to the public /api/search response: the matched funders plus paging and the filters that applied.",
          additionalProperties: true,
        },
        FunderSnapshot: {
          type: "object",
          properties: {
            orgId: { type: "string", format: "uuid" },
            name: { type: "string" },
            ein: { type: ["string", "null"] },
            orgType: { type: ["string", "null"] },
            city: { type: ["string", "null"] },
            state: { type: ["string", "null"] },
            website: { type: ["string", "null"] },
          },
        },
        FunderResponse: {
          type: "object",
          required: ["funder"],
          properties: {
            funder: { type: "object", description: "The funder record the public profile page renders. Missing values are null.", additionalProperties: true },
            included: { type: "object", description: "One key per requested include.", additionalProperties: true },
            unavailable: { type: "array", items: { type: "string" }, description: "Includes that could not be loaded." },
          },
        },
        SavedFunder: {
          type: "object",
          required: ["id", "org_id", "snapshot", "stage", "created_at"],
          properties: {
            id: { type: "string", format: "uuid" },
            org_id: { type: "string", format: "uuid", description: "Corpus organization id (soft reference)." },
            snapshot: { $ref: "#/components/schemas/FunderSnapshot" },
            stage: {
              type: "string",
              enum: ["identified", "researching", "qualified", "cultivating", "loi_submitted", "proposal_submitted", "awarded", "declined", "parked"],
            },
            tier: { type: ["integer", "null"], minimum: 1, maximum: 3 },
            owner_id: { type: ["string", "null"], format: "uuid" },
            ask_amount: { type: ["integer", "null"], description: "Whole dollars." },
            next_action: { type: ["string", "null"] },
            next_action_due: { type: ["string", "null"], format: "date" },
            source_detail: { type: ["string", "null"] },
            tags: { type: "array", items: { type: "string" } },
            archived_at: { type: ["string", "null"], format: "date-time" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            version: { type: "integer" },
          },
        },
        SavedPage: {
          type: "object",
          required: ["data", "page", "limit", "total", "has_more"],
          properties: {
            data: { type: "array", items: { $ref: "#/components/schemas/SavedFunder" } },
            page: { type: "integer" },
            limit: { type: "integer" },
            total: { type: "integer" },
            has_more: { type: "boolean" },
          },
        },
      },
    },
  };
}
