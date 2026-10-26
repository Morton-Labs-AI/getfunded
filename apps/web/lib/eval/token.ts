import "server-only";

/**
 * The search eval suite (evals/search) runs hundreds of searches against a
 * deployment. When the operator sets EVAL_TOKEN on THAT deployment (for a
 * preview: `vercel deploy --env EVAL_TOKEN=...`, never a project setting),
 * a request carrying the same value in `x-eval-token` skips the search rate
 * limit and may read /api/eval/*. With EVAL_TOKEN unset, which is how
 * production runs, this always answers false and those routes are 404.
 */
import { timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export const EVAL_TOKEN_HEADER = "x-eval-token";
const MIN_TOKEN_CHARS = 24;

export function evalEnabled(env: Env = process.env): boolean {
  return (env.EVAL_TOKEN?.trim().length ?? 0) >= MIN_TOKEN_CHARS;
}

export function evalTokenOk(req: Request, env: Env = process.env): boolean {
  if (!evalEnabled(env)) return false;
  const expected = Buffer.from(env.EVAL_TOKEN!.trim());
  const given = Buffer.from(req.headers.get(EVAL_TOKEN_HEADER)?.trim() ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
