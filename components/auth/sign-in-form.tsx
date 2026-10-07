"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { requestSignInLink } from "@/lib/actions/auth";

/**
 * The email form. Deliberately dumb: it collects an address, calls the action,
 * and navigates to /sign-in/check-email on ANY non-validation outcome.
 *
 * It never learns whether the address was allowed, because the action never
 * tells it. That is not an oversight to be tidied up later — it is the reason
 * this form cannot be used to enumerate the membership of a private community
 * of named nonprofit staff.
 */
export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await requestSignInLink({ email });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.push("/sign-in/check-email");
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
      <label htmlFor="email" className="mono-label">
        email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        autoFocus
        required
        value={email}
        onChange={(ev) => setEmail(ev.target.value)}
        placeholder="you@organization.org"
        aria-describedby={error ? "signin-error" : undefined}
        className="h-10 rounded-[8px] border border-border-1 bg-inset px-3 text-[14.5px] text-ink-1 outline-none transition-colors duration-[90ms] placeholder:text-ink-4 focus:border-accent-border"
      />

      {error ? (
        <p id="signin-error" role="alert" className="text-[13px] leading-5 text-ink-2">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || email.trim().length === 0}
        className="mt-1 inline-flex h-10 items-center justify-center rounded-[8px] border border-accent-border bg-accent px-4 text-[14px] font-medium text-accent-ink transition-colors duration-[90ms] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Sending…" : "Email me a link"}
      </button>
    </form>
  );
}
