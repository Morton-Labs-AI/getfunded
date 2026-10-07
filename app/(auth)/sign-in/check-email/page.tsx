import Link from "next/link";

import { OpenRing } from "@/components/open-ring";
import { memberRobots } from "@/lib/community/posture";

export const metadata = {
  title: "Check your email — Open Funder Database",
  robots: memberRobots,
};

/**
 * Static, and says the SAME thing whether or not the address was allowed —
 * this page is the visible half of the enumeration property enforced in
 * lib/actions/auth.ts. Do not add "we sent it to X" or any conditional copy.
 */
export default function CheckEmailPage() {
  return (
    <div className="page-enter mx-auto flex w-full max-w-[420px] flex-col px-6 pb-24 pt-20">
      <OpenRing size={30} />
      <h1 className="mt-5 text-[24px] font-[650] tracking-[-0.02em] text-ink-1">
        Check your email
      </h1>
      <p className="mt-2 text-[14.5px] leading-6 text-ink-2">
        If that address is on the list, a sign-in link is on its way. The link
        works once and expires shortly.
      </p>
      <p className="mt-6 text-[13px] leading-5 text-ink-4">
        Nothing arrived?{" "}
        <Link href="/sign-in" className="text-ink-3 underline hover:text-ink-1">
          Request another link
        </Link>
        .
      </p>
    </div>
  );
}
