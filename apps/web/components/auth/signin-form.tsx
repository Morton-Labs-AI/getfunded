"use client";

import { KeyRound, MailCheck } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/auth/supabase-browser";

/**
 * Name + email, then "Check your email". The same form signs in and creates an
 * account; there is no password. Two ways to finish:
 *  - the link in the email, which lands on /auth/callback?code=...;
 *  - the 6-digit code from the same email, for people whose mail filters
 *    rewrite or block links. verifyOtp() sets the session cookies in the
 *    browser, then a full navigation to /auth/callback provisions the account.
 */

type Stage = "form" | "sent";

type AuthErrorLike = { code?: string; status?: number; message?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function friendlyAuthError(error: unknown): string {
  const e = (error ?? {}) as AuthErrorLike;
  const code = e.code ?? "";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || e.status === 429) {
    return "Too many sign-in emails were sent to that address. Wait a few minutes and try again.";
  }
  if (code === "otp_expired") return "That code has expired. Request a new email and use the new code.";
  if (code === "otp_disabled") return "Code sign-in is turned off on this server. Use the link in the email.";
  if (code === "email_address_invalid" || code === "validation_failed") return "Enter a valid email address.";
  if (code === "signup_disabled") return "New accounts are closed right now. If you already have one, check your email address.";
  if (typeof e.message === "string" && /not configured/i.test(e.message)) {
    return "Sign-in is not set up on this server yet.";
  }
  return "Something went wrong. Try again in a moment.";
}

export function SignInForm({
  next,
  appUrl,
  initialError = null,
}: {
  /** Already validated by `safeNextPath` on the server. */
  next: string;
  /** `APP_URL` from the server, or "" to use the browser's origin. */
  appUrl: string;
  initialError?: string | null;
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

  async function sendEmail(): Promise<boolean> {
    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        data: { display_name: name.trim() },
        emailRedirectTo: callbackUrl,
      },
    });
    if (authError) {
      setError(friendlyAuthError(authError));
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
      setError(friendlyAuthError(caught));
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
      setError(friendlyAuthError(caught));
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
        setError(friendlyAuthError(authError));
        return;
      }
      // Full navigation so the server sees the new cookies and provisions the account.
      window.location.assign(new URL(`/auth/callback?next=${encodeURIComponent(next)}`, window.location.origin).toString());
    } catch (caught) {
      setError(friendlyAuthError(caught));
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
          <CardTitle className="text-2xl font-semibold tracking-tight">Check your email</CardTitle>
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
        <CardTitle className="text-2xl font-semibold tracking-tight">Sign in</CardTitle>
        <CardDescription>
          New here? This same form creates your free account. There is no password: we email you a link and a code.
        </CardDescription>
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
