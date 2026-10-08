import { describe, expect, it } from "vitest";

import { API_VERSION, OPENAPI_VERSION, V1_PATHS, buildOpenApiDocument } from "@/app/api/v1/_lib/openapi";

type Doc = ReturnType<typeof buildOpenApiDocument> & {
  paths: Record<string, Record<string, { operationId: string; responses: Record<string, unknown>; security?: unknown[] }>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, { type: string; scheme: string }> };
  servers: Array<{ url: string }>;
};

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument("https://getfunded.ai/") as Doc;

  it("is OpenAPI 3.1 with the four v1 paths and a bearer key scheme", () => {
    expect(doc.openapi).toBe(OPENAPI_VERSION);
    expect(OPENAPI_VERSION).toBe("3.1.0");
    expect((doc.info as { version: string }).version).toBe(API_VERSION);
    expect(Object.keys(doc.paths).sort()).toEqual([...V1_PATHS].sort());
    expect(doc.components.securitySchemes.apiKey).toMatchObject({ type: "http", scheme: "bearer" });
    expect(doc.security).toEqual([{ apiKey: [] }]);
  });

  it("trims the trailing slash from the server url and falls back to / when empty", () => {
    expect(doc.servers).toEqual([{ url: "https://getfunded.ai" }]);
    expect((buildOpenApiDocument("") as Doc).servers).toEqual([{ url: "/" }]);
  });

  it("every keyed operation documents 401, 403 and 429 with the shared Error schema; openapi.json needs no key", () => {
    for (const path of ["/api/v1/search", "/api/v1/funders/{id}", "/api/v1/saved"]) {
      const op = doc.paths[path].get;
      expect(op.operationId).toBeTruthy();
      for (const status of ["200", "401", "403", "429"]) expect(op.responses[status], `${path} ${status}`).toBeDefined();
      const err = op.responses["401"] as { content: { "application/json": { schema: { $ref: string } } } };
      expect(err.content["application/json"].schema.$ref).toBe("#/components/schemas/Error");
    }
    expect(doc.paths["/api/v1/openapi.json"].get.security).toEqual([]);
    expect(doc.paths["/api/v1/funders/{id}"].get.responses["404"]).toBeDefined();
  });

  it("describes the saved funder with the stage vocabulary and nullable fields, never a zero default", () => {
    const saved = doc.components.schemas.SavedFunder as { properties: Record<string, { enum?: string[]; type?: unknown; default?: unknown }> };
    expect(saved.properties.stage.enum).toEqual([
      "identified", "researching", "qualified", "cultivating", "loi_submitted", "proposal_submitted", "awarded", "declined", "parked",
    ]);
    expect(saved.properties.ask_amount.type).toEqual(["integer", "null"]);
    expect(saved.properties.ask_amount.default).toBeUndefined();
    expect(Object.keys(doc.components.schemas).sort()).toEqual(["Error", "FunderResponse", "FunderSnapshot", "SavedFunder", "SavedPage", "SearchResult"]);
  });

  it("serialises to JSON without cycles", () => {
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(JSON.stringify(doc)).not.toMatch(/closed/);
  });
});
