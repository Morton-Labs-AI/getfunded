import { NextResponse, type NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { ensureMember } from "@/lib/community/provision";

/**
 * The auth callback. A Route Handler because exchangeCodeForSession() must
 * WRITE cookies onto a redirect response, which a Server Component cannot do.
 *
 * Handles BOTH shapes Supabase can send, deliberately:
 *   ?code=...                 PKCE (the @supabase/ssr default)
 *   ?token_hash=..&type=..    the {{ .TokenHash }} email template
 * Which one arrives depends on a setting in the Supabase dashboard that lives
 * outside this repo. Supporting both removes a config trap whose symptom is an
 * unreadable "invalid flow state" in production and nothing at all locally.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = url.searchParams.get("next");

  // Only ever redirect to a path on this origin. An open redirect on the auth
  // callback is a phishing primitive: it lets a link that genuinely signs you
  // in also land you on an attacker's page.
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/sign-in?e=${reason}`, url.origin));

  const supabase = await supabaseServer();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("link_invalid");
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "magiclink" | "email" | "signup" | "invite" | "recovery",
      token_hash: tokenHash,
    });
    if (error) return fail("link_invalid");
  } else {
    return fail("link_missing");
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return fail("no_session");

  // The allowlist, enforced a SECOND time. The first check happens at OTP
  // request, but Supabase's dashboard invite UI creates auth.users rows out of
  // band and would otherwise walk straight past it.
  let provisioned;
  try {
    provisioned = await ensureMember(data.user.id, data.user.email);
  } catch (e) {
    console.error("[auth/callback] provisioning failed", e);
    await supabase.auth.signOut();
    return fail("provisioning_failed");
  }

  if (!provisioned.ok) {
    await supabase.auth.signOut();
    return fail("not_invited");
  }

  // status 'invited' means the member exists but has not chosen a handle or
  // granted CC0. /onboarding lands in a later phase; until then they arrive
  // signed in, which is the honest state.
  return NextResponse.redirect(new URL(dest, url.origin));
}
