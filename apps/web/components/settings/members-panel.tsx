"use client";

import * as React from "react";
import { useActionState, useId } from "react";
import { LogOut, Mail, UserMinus, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  createInviteAction,
  leaveWorkspaceAction,
  removeMemberAction,
  revokeInviteAction,
  type ActionState,
  type InviteState,
} from "@/lib/settings/actions";
import { SETTINGS_COPY } from "@/lib/settings/copy";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, canRemoveMember, type MemberRole } from "@/lib/settings/roles";

import { CopyField } from "./copy-button";
import { FormNotice } from "./form-notice";
import { Notice } from "./settings-section";

export type MemberView = {
  user_id: string;
  role: MemberRole;
  email: string | null;
  display_name: string | null;
  last_seen_at: string | null;
  joined_at: string;
};

export type InviteView = {
  id: string;
  email: string;
  role: "member" | "admin";
  expires_at: string;
  created_at: string;
};

export type SeatView = { limit: number | null; used: number; remaining: number | null; full: boolean; planName: string };

const INITIAL: ActionState = { ok: false };
const INITIAL_INVITE: InviteState = { ok: false };

function initials(name: string | null, email: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "?";
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function RoleBadge({ role }: { role: MemberRole }) {
  const variant = role === "owner" ? "default" : role === "admin" ? "secondary" : "outline";
  return <Badge variant={variant}>{ROLE_LABELS[role]}</Badge>;
}

/* ----------------------------------------------------------------------------
   Invite
---------------------------------------------------------------------------- */

function InviteForm({ seats, assignable }: { seats: SeatView; assignable: ("member" | "admin")[] }) {
  const [state, formAction, pending] = useActionState(createInviteAction, INITIAL_INVITE);
  const formRef = React.useRef<HTMLFormElement>(null);
  const baseId = useId();
  const errors = state.fieldErrors ?? {};

  React.useEffect(() => {
    if (state.ok && state.invite) formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite someone</CardTitle>
        <CardDescription>{SETTINGS_COPY.members.inviteHelp}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form ref={formRef} action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor={`${baseId}-email`}>Email</Label>
            <Input
              id={`${baseId}-email`}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="colleague@example.org"
              required
              disabled={seats.full || pending}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? `${baseId}-email-error` : undefined}
            />
            {errors.email ? (
              <p id={`${baseId}-email-error`} className="text-sm text-danger">
                {errors.email}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 sm:w-40">
            <Label htmlFor={`${baseId}-role`}>Role</Label>
            <Select name="role" defaultValue="member" disabled={seats.full || pending}>
              <SelectTrigger id={`${baseId}-role`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignable.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={seats.full || pending} className="sm:shrink-0">
            <Mail aria-hidden />
            {pending ? "Creating…" : "Create invite link"}
          </Button>
        </form>

        <FormNotice state={state} />

        {state.ok && state.invite ? (
          <div className="flex flex-col gap-2 rounded-md border border-primary-border bg-primary-tint/50 p-3">
            <p className="text-sm text-ink-2">
              Link for <span className="font-medium text-foreground">{state.invite.email}</span> as{" "}
              {ROLE_LABELS[state.invite.role].toLowerCase()}. Expires {formatDate(state.invite.expiresAt, "long")}.
            </p>
            <CopyField value={state.invite.url} label="Invitation link" />
            <p className="text-xs text-ink-3">Send it by email or chat yourself. This page will not show the link again.</p>
          </div>
        ) : null}

        <p className="text-xs text-ink-3">
          {seats.limit === null
            ? `${seats.used} ${seats.used === 1 ? "seat" : "seats"} in use. The ${seats.planName} plan has no seat limit.`
            : `${seats.used} of ${seats.limit} ${seats.limit === 1 ? "seat" : "seats"} in use on the ${seats.planName} plan. Pending invitations count.`}
        </p>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------------------------
   Rows
---------------------------------------------------------------------------- */

function RemoveMemberForm({ member }: { member: MemberView }) {
  const [state, formAction, pending] = useActionState(removeMemberAction, INITIAL);
  const who = member.display_name || member.email || "this person";
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${who}`}>
          <UserMinus aria-hidden />
          <span className="hidden sm:inline">Remove</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {who}?</DialogTitle>
          <DialogDescription>
            They lose access to this workspace right away. Saved funders, notes and tasks they created stay here.
          </DialogDescription>
        </DialogHeader>
        <FormNotice state={state} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Keep
            </Button>
          </DialogClose>
          <form action={formAction}>
            <input type="hidden" name="user_id" value={member.user_id} />
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Removing…" : "Remove"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeInviteForm({ invite }: { invite: InviteView }) {
  const [state, formAction, pending] = useActionState(revokeInviteAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="invite_id" value={invite.id} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending} aria-label={`Revoke invitation for ${invite.email}`}>
        <X aria-hidden />
        <span className="hidden sm:inline">{pending ? "Revoking…" : "Revoke"}</span>
      </Button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function LeaveWorkspaceForm({ workspaceName }: { workspaceName: string }) {
  const [state, formAction, pending] = useActionState(leaveWorkspaceAction, INITIAL);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <LogOut aria-hidden />
          Leave workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave {workspaceName}?</DialogTitle>
          <DialogDescription>You will need a new invitation to come back. Your work stays in the workspace.</DialogDescription>
        </DialogHeader>
        <FormNotice state={state} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Stay
            </Button>
          </DialogClose>
          <form action={formAction}>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Leaving…" : "Leave"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------------------
   Panel
---------------------------------------------------------------------------- */

export function MembersPanel({
  workspaceName,
  me,
  members,
  invites,
  seats,
  canManage,
  assignable,
}: {
  workspaceName: string;
  me: { id: string; role: MemberRole };
  members: MemberView[];
  invites: InviteView[];
  seats: SeatView;
  canManage: boolean;
  assignable: ("member" | "admin")[];
}) {
  return (
    <div className="flex flex-col gap-5">
      {canManage ? <InviteForm seats={seats} assignable={assignable} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            {members.length} {members.length === 1 ? "member" : "members"}.{" "}
            <span className="text-ink-3">
              Owner: {ROLE_DESCRIPTIONS.owner} Admin: {ROLE_DESCRIPTIONS.admin} Member: {ROLE_DESCRIPTIONS.member}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <ul className="divide-y">
            {members.map((m) => {
              const isMe = m.user_id === me.id;
              const removable =
                canManage &&
                canRemoveMember({ actorRole: me.role, actorId: me.id, targetRole: m.role, targetId: m.user_id }).ok;
              return (
                <li key={m.user_id} className="flex items-center gap-3 px-6 py-3">
                  <Avatar>
                    <AvatarFallback>{initials(m.display_name, m.email)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {m.display_name || m.email || "Member"}
                      {isMe ? <span className="ml-1.5 text-xs font-normal text-ink-3">(you)</span> : null}
                    </p>
                    <p className="truncate text-xs text-ink-3">
                      {m.email ?? "Email not available"}
                      {m.last_seen_at ? ` · Last seen ${formatDateTime(m.last_seen_at)}` : ""}
                    </p>
                  </div>
                  <RoleBadge role={m.role} />
                  {removable ? <RemoveMemberForm member={m} /> : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>
              {invites.length === 0 ? "No invitations waiting." : "Links already created. Revoke one to stop it from working."}
            </CardDescription>
          </CardHeader>
          {invites.length > 0 ? (
            <CardContent className="px-0">
              <ul className="divide-y">
                {invites.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 px-6 py-3">
                    <Mail className="size-4 shrink-0 text-ink-3" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{inv.email}</p>
                      <p className="text-xs text-ink-3">
                        {ROLE_LABELS[inv.role]} · Expires {formatDate(inv.expires_at)}
                      </p>
                    </div>
                    <RevokeInviteForm invite={inv} />
                  </li>
                ))}
              </ul>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {me.role !== "owner" ? (
        <Card>
          <CardHeader>
            <CardTitle>Leave this workspace</CardTitle>
            <CardDescription>You can leave at any time. Nothing you created is deleted.</CardDescription>
          </CardHeader>
          <CardContent>
            <LeaveWorkspaceForm workspaceName={workspaceName} />
          </CardContent>
        </Card>
      ) : (
        <Notice tone="info">
          As the owner you cannot leave. To close this workspace, use Settings → Data → Delete workspace.
        </Notice>
      )}
    </div>
  );
}
