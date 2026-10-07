"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { communitySql } from "@/lib/community/db";
import { supabaseServer } from "@/lib/supabase/server";
import { COMMUNITY_MODE } from "@/lib/community/posture";

/**
 * Request a sign-in link.
 *
 * Server Actions are the mutation surface for everything member-facing.
 * lib/admin/guard.ts had to hand-roll a sec-fetch-site check because HTTP
 * handlers accept cross-site form POSTs; actions get framework origin checking
 * for free, and community writes come from signed-in strangers rather than a
 * local operator. Route handlers stay reserved for cookie-setting redirects
 * and machine callers.
 *
 * THE ENUMERATION PROPERTY, which is the whole security content of this file:
 * the return value is IDENTICAL whether or not the address is allowed. An
 * uninvited address simply never receives mail. Do not add a "you're not
 * invited" branch to the UI — that turns this form into an oracle telling any
 * stranger who is a member of a private community of named nonprofit staff.
 */
const EmailSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();

export type SignInResult = { ok: true } | { error: string };

export async function requestSignInLink(input: unknown): Promise<SignInResult> {
  if (COMMUNITY_MODE === "off") {
    return { error: "Sign-in is not enabled." };
  }

  const parsed = EmailSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Enter a valid email address." };
  }
  const { email } = parsed.data;

  // Ask Postgres, not the app: community.may_sign_up() reads signup_mode,
  // community.invites and community.allowlist_domains behind a SECURITY
  // DEFINER boundary, because community_app holds no SELECT on the invite list
  // and must never be able to render or enumerate it.
  let allowed = false;
  try {
    const [row] = await communitySql<{ allowed: boolean }[]>`
      select community.may_sign_up(${email}) as allowed`;
    allowed = Boolean(row?.allowed);
  } catch (e) {
    console.error("[requestSignInLink] may_sign_up failed", e);
    return { error: "Sign-in is temporarily unavailable." };
  }

  if (allowed) {
    const h = await headers();
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ??
      (h.get("origin") || `https://${h.get("host") ?? "localhost:3010"}`);

    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // TRUE is correct and required here, and the reason is worth stating
        // because the opposite looks safer: the invite lives in OUR table, not
        // in Supabase, so a genuinely invited person signing in for the first
        // time has no auth.users row yet. With false they would silently never
        // receive mail. The gate is may_sign_up() above — this flag is not a
        // gate and must not be mistaken for one.
        shouldCreateUser: true,
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });
    if (error) {
      console.error("[requestSignInLink] signInWithOtp failed", error.message);
      // Still fall through to the generic success below: a mail-provider
      // failure must not become an enumeration signal either.
    }
  }

  // Identical for allowed and refused. On purpose. See above.
  return { ok: true };
}
