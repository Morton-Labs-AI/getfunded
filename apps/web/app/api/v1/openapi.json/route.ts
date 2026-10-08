/**
 * GET /api/v1/openapi.json — the OpenAPI 3.1 document for the public API.
 * No key needed. `servers[0].url` follows APP_URL at request time.
 */
import { connection } from "next/server";

import { appUrl } from "@/lib/auth/env";

import { buildOpenApiDocument } from "../_lib/openapi";

export async function GET(): Promise<Response> {
  await connection();
  return Response.json(buildOpenApiDocument(appUrl()), {
    headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "application/json; charset=utf-8" },
  });
}
