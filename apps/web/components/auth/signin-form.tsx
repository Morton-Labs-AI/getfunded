"use client";

import { KeyRound, MailCheck } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SignupMode } from "@/lib/admin/flags";
import { createSupabaseBrowserClient } from "@/lib/auth/supabase-browser";

/**
 * Name + email, then "Check your email". The same form signs in and creates an
 * account; there is no password. Two ways to finish:
 *  - the link in the email, which lands on /auth/callback?code=...;
 *  - the 6-digit code from the same email, for people whose mail filters
 *    rewrite or block links. verifyOtp() sets the session cookies in the
 *    browser, then a full navigation to /auth/callback provisions the account.
 *
 * `signupMode` is the steward flag read on the server. It decides
 * `shouldCreateUser` (so the auth server does not mint accounts the app will
 * refuse) and the copy. The RULE is enforced server-side in
 * lib/auth/signup-gate.ts when the account would be provisioned; this is the
 * courtesy layer. In `invite` mode the auth user must still be creatable,
 * because an invited person is new by definition; the gate then checks the
 * invitation.
 */

type Stage = "form" | "sent";

type AuthErrorLike = { code?: string; status?: number; message?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The sign-in form's heading and description, by sign-up mode. */
export const SIGNIN_COPY: Record<SignupMode, { title: string; description: string }> = {
  open: {
    title: "Sign in",
    description: "New here? This same form creates your free account. There is no password: we email you a link and a code.",
  },
  invite: {
    title: "Sign in",
    description:
      "New accounts are by invitation right now. If you were invited, use the email address the invitation was sent to. There is no password: we email you a link and a code.",
  },
  closed: {
    title: "Sign in",
    description: "New accounts are paused right now. If you already have one, sign in with your email. There is no password: we email you a link and a code.",
  },
};

export function friendlyAuthError(error: unknown, signupMode: SignupMode = "open"): string {
  const e = (error ?? {}) as AuthErrorLike;
  const code = e.code ?? "";
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || e.status === 429) {
    return "Too many sign-in emails were sent to that address. Wait a few minutes and try again.";
  }
  if (code === "otp_expired") return "That code has expired. Request a new email and use the new code.";
  // The auth server answers "Signups not allowed for otp" (code otp_disabled)
  // when shouldCreateUser is false and the address has no account: that is our
  // own sign-up mode speaking, not a server misconfiguration.
  if (code === "signup_disabled" || (code === "otp_disabled" && /signup/i.test(message))) {
    return signupMode === "invite"
      ? "No account exists for that address and new accounts are by invitation. Use the address your invitation was sent to."
      : "New accounts are paused right now. If you already have one, check your email address.";
  }
  if (code === "otp_disabled") return "Code sign-in is turned off on this server. Use the link in the email.";
  if (code === "email_address_invalid" || code === "validation_failed") return "Enter a valid email address.";
  if (/not configured/i.test(message)) {
    return "Sign-in is not set up on this server yet.";
  }
  return "Something went wrong. Try again in a moment.";
}

export function SignInForm({
  next,
  appUrl,
  initialError = null,
  signupMode = "open",
}: {
  /** Already validated by `safeNextPath` on the server. */
  next: string;
  /** `APP_URL` from the server, or "" to use the browser's origin. */
  appUrl: string;
  initialError?: string | null;
  /** The steward flag, read on the server. */
  signupMode?: SignupMode;
}) {
  const ids = { name: useId(), email: useId(), code: useId(), error: useId() };
  const [stage, setStage] = useState<Stage>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);

  const callbackUrl = `${appUrl || (typeof window !== "undefined" ? window.location.origin : "")}/auth/callback?next=${encodeURIComponent(next)}`;
  const copy = SIGNIN_COPY[signupMode];
  const headingClass = "text-2xl leading-none font-semibold tracking-tight";

  async function sendEmail(): Promise<boolean> {
    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        // closed: never mint an auth user. open and invite: the server gate decides.
        shouldCreateUser: signupMode !== "closed",
        data: { display_name: name.trim() },
        emailRedirectTo: callbackUrl,
      },
    });
    if (authError) {
      setError(friendlyAuthError(authError, signupMode));
      return false;
    }
    return true;
  }

  async function onRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (name.trim().length < 1) return setError("Enter your name so we know what to call you.");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      if (await sendEmail()) setStage("sent");
    } catch (caught) {
      setError(friendlyAuthError(caught, signupMode));
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (await sendEmail()) setNotice("We sent another email. The newest code is the one that works.");
    } catch (caught) {
      setError(friendlyAuthError(caught, signupMode));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) return setError("The code has 6 digits.");
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: "email",
      });
      if (authError) {
        setError(friendlyAuthError(authError, signupMode));
        return;
      }
      // Full navigation so the server sees the new cookies and provisions the account.
      window.location.assign(new URL(`/auth/callback?next=${encodeURIComponent(next)}`, window.location.origin).toString());
    } catch (caught) {
      setError(friendlyAuthError(caught, signupMode));
      setBusy(false);
    }
  }

  const errorBlock = error ? (
    <p
      id={ids.error}
      role="alert"
      className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger"
    >
      {error}
    </p>
  ) : null;

  if (stage === "sent") {
    return (
      <Card>
        <CardHeader>
          <div className="mb-1 inline-flex size-9 items-center justify-center rounded-md bg-primary-tint text-primary">
            <MailCheck className="size-5" aria-hidden />
          </div>
          <h1 data-slot="card-title" className={headingClass}>
            Check your email
          </h1>
          <CardDescription>
            We sent a sign-in link to <span className="font-medium text-foreground">{email.trim()}</span>. Open it
            on this device to finish.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-md border bg-inset px-3 py-2.5 text-sm text-ink-2">
            Links blocked where you work? The same email has a 6-digit code. Type it here instead.
          </div>
          <form onSubmit={onVerify} className="flex flex-col gap-3" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.code}>6-digit code</Label>
              <Input
                id={ids.code}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? ids.error : undefined}
                className="h-11 font-mono text-lg tracking-[0.3em] tnum"
                autoFocus
              />
            </div>
            {errorBlock}
            {notice ? (
              <p role="status" className="text-sm text-ink-3">
                {notice}
              </p>
            ) : null}
            <Button type="submit" disabled={busy || code.length !== 6} className="h-10">
              <KeyRound aria-hidden />
              {busy ? "Checking…" : "Sign in with the code"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t text-sm">
          <Button type="button" variant="ghost" size="sm" onClick={onResend} disabled={busy}>
            Send another email
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              setStage("form");
              setCode("");
              setError(null);
              setNotice(null);
            }}
          >
            Use a different email
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h1 data-slot="card-title" className={headingClass}>
          {copy.title}
        </h1>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onRequest} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.name}>Your name</Label>
            <Input
              id={ids.name}
              name="name"
              autoComplete="name"
              placeholder="Jordan Rivera"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.email}>Work email</Label>
            <Input
              id={ids.email}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@yournonprofit.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ids.error : undefined}
              required
            />
          </div>
          {errorBlock}
          <Button type="submit" disabled={busy} className="h-10">
            {busy ? "Sending…" : "Email me a sign-in link"}
          </Button>
          <p className="text-xs leading-5 text-ink-3">
            We use your email to sign you in and to send account notices. We never sell it or share it with funders.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
