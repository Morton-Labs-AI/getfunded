import Link from "next/link";
import { notFound } from "next/navigation";

import { OpenRing } from "@/components/open-ring";
import { SignInForm } from "@/components/auth/sign-in-form";
import { COMMUNITY_MODE, memberRobots } from "@/lib/community/posture";

export const metadata = {
  title: "Sign in — Open Funder Database",
  robots: memberRobots,
};

/** Errors the callback route can hand back. Never says whether an address exists. */
const REASONS: Record<string, string> = {
  link_invalid: "That link has expired or was already used. Request a new one.",
  link_missing: "That link was incomplete. Request a new one.",
  no_session: "We could not complete the sign-in. Try again.",
  not_invited: "That address is not on the list for this beta.",
  provisioning_failed: "Something went wrong setting up your account. Try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  // With the community layer off there is nothing to sign in to, and a live
  // sign-in form would be a promise the app cannot keep. 404, matching how
  // app/admin/layout.tsx hides a surface that is not enabled.
  if (COMMUNITY_MODE === "off") notFound();

  const { e } = await searchParams;
  const error = e ? (REASONS[e] ?? "Sign-in failed. Try again.") : null;

  return (
    <div className="page-enter mx-auto flex w-full max-w-[420px] flex-col px-6 pb-24 pt-20">
      <OpenRing size={30} />

      <h1 className="mt-5 text-[24px] font-[650] tracking-[-0.02em] text-ink-1">
        Sign in
      </h1>

      <p className="mt-2 text-[14.5px] leading-6 text-ink-2">
        {COMMUNITY_MODE === "invite" ? (
          <>
            The community is invite-only while the review loop is proven. If
            you have an invitation, enter the address it was sent to and we
            will email you a link — no password.
          </>
        ) : (
          <>
            Enter your email and we will send you a sign-in link. No password.
          </>
        )}
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-[8px] border border-border-2 bg-inset px-3 py-2.5 text-[13.5px] leading-5 text-ink-2"
        >
          {error}
        </p>
      ) : null}

      <SignInForm />

      <p className="mt-8 text-[13px] leading-5 text-ink-4">
        The funder data stays open to everyone, signed in or not.{" "}
        <Link href="/browse" className="text-ink-3 underline hover:text-ink-1">
          Browse without an account
        </Link>
        .
      </p>
    </div>
  );
}
