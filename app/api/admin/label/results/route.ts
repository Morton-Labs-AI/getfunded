import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { adminRoute } from "@/lib/admin/db";
import { JOB } from "@/lib/admin/labeling";
import { results } from "@/lib/admin/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The verification-suite view. Served ONLY to /admin/label/results — the
 * labeling screen has no link, key, or fetch that reaches this route.
 */
export async function GET(req: Request) {
  return adminRoute(req, async () => {
    const seedFile = path.join(process.cwd(), `.labeling-seed-${JOB}`);
    const seed = existsSync(seedFile) ? readFileSync(seedFile, "utf8").trim() : null;
    return Response.json(await results(seed));
  });
}
