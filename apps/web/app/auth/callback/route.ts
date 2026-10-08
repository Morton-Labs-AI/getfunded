import { NextResponse, type NextRequest } from "next/server";

import { displayNameFromMetadata } from "@/lib/auth/identity";
import { safeNextPath } from "@/lib/auth/next-path";
import { ensureProvisioned } from "@/lib/auth/provision";
import { createSupabaseServerClient } from "@/lib/auth/supabase";

/**
 * The auth callback. A Route Handler because the session cookies must be
 * written onto a redirect response, which a Server Component cannot do.
 *
 * Accepts every shape Supabase can send, so a dashboard setting outside this
 * repo cannot break sign-in:
 *   ?code=...                 PKCE magic link (the @supabase/ssr default)
 *   ?token_hash=..&type=..    the {{ .TokenHash }} email template
 *   (nothing)                 the 6-digit code path: the browser client already
 *                             verified the code and set the cookies
 * In every case the session is re-read from the auth server, the account is
 * provisioned, and the user lands on `next` (first-timers go to /welcome).
 */

const EMAIL_OTP_TYPES = new Set(["magiclink", "email", "signup", "invite", "recovery", "email_change"]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNextPath(searchParams.get("next"));

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/signin?error=${reason}&next=${encodeURIComponent(next)}`, request.url), {
      status: 303,
    });

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("link_invalid");
  } else if (tokenHash && type) {
    if (!EMAIL_OTP_TYPES.has(type)) return fail("link_invalid");
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "email" });
    if (error) return fail("link_invalid");
  }

  // Fresh from the auth server, never from the cookie's user object.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return fail(code || tokenHash ? "no_session" : "link_missing");

  let isNew: boolean;
  try {
    const provisioned = await ensureProvisioned({
      id: data.user.id,
      email: data.user.email,
      displayName: displayNameFromMetadata(data.user.user_metadata),
    });
    isNew = provisioned.isNew;
  } catch (cause) {
    console.error("[auth/callback] provisioning failed", cause instanceof Error ? cause.message : cause);
    return fail("provisioning_failed");
  }

  const destination = isNew ? `/welcome?next=${encodeURIComponent(next)}` : next;
  return NextResponse.redirect(new URL(destination, request.url), { status: 303 });
}
