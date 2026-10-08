/**
 * GET /api/v1/saved?page=&limit=&archived= — the key's workspace's saved
 * funders, read as the member who created the key (RLS applies).
 */
import { requireApiKey } from "@/lib/api/keys";
import { withRateLimit } from "@/lib/ratelimit";

import { handleV1Saved } from "../_lib/handlers";
import { listSavedForApi } from "../_lib/saved-query";

export async function GET(req: Request): Promise<Response> {
  return handleV1Saved(req, { requireApiKey, withRateLimit, listSaved: listSavedForApi });
}
