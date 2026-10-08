import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/auth/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security";
import { WORKSPACE_COOKIE } from "@/lib/workspace/context";

/**
 * POST only. A GET sign-out is CSRF-able by any <img> on any page, and link
 * prefetching would fire it on hover. Same-origin is enforced on top.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
  } catch (refusal) {
    if (refusal instanceof Response) return refusal;
    throw refusal;
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });

  const store = await cookies();
  store.delete(WORKSPACE_COOKIE);

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export function GET() {
  const response = jsonError(405, "method_not_allowed", "Sign out with a POST request.");
  response.headers.set("Allow", "POST");
  return response;
}
