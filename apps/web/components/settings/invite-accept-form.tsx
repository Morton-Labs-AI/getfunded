"use client";

import { useActionState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptInviteAction, type ActionState } from "@/lib/settings/actions";

import { FormNotice } from "./form-notice";

const INITIAL: ActionState = { ok: false };

/**
 * One button. Accepting is a POST (a Server Action), never a side effect of
 * opening the link, so a preview fetch or a prefetch can never join a
 * workspace on someone's behalf.
 */
export function InviteAcceptForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, INITIAL);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">You have been invited to a workspace</CardTitle>
        <CardDescription>
          You are signed in as <span className="font-medium text-foreground">{email}</span>. Joining adds this workspace
          to your account; you keep your own workspace too.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <FormNotice state={state} />
          <CardFooter className="flex flex-col-reverse gap-3 px-0 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" asChild>
              <Link href="/app">Not now</Link>
            </Button>
            <Button type="submit" disabled={pending} className="h-10 sm:min-w-44">
              <UserPlus aria-hidden />
              {pending ? "Joining…" : "Join workspace"}
            </Button>
          </CardFooter>
        </form>
      </CardContent>
    </Card>
  );
}
