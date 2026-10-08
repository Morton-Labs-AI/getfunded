/**
 * GET /api/integrations/gmail/connect → 302 to Google's consent screen.
 *
 * Signed in, Pro and above, SECRETS_KEY and the OAuth client configured. The
 * `state` is signed and bound to the signed-in user and the active workspace,
 * so the callback can refuse a token for anyone else. Scopes: gmail.send and
 * gmail.metadata, nothing more.
 */
import { connection, NextResponse } from "next/server";

import { isSecretsConfigured, secretsKey } from "@/lib/email/crypto";
import { authorizationUrl, GmailError, isGmailConfigured } from "@/lib/email/gmail";
import { signState } from "@/lib/email/oauth-state";
import { outreachAbilities } from "@/lib/outreach/gate";
import { requireWorkspace } from "@/lib/workspace/context";

function back(req: Request, reason: string): Response {
  const url = new URL("/app/outreach/settings", req.url);
  url.searchParams.set("gmail", "error");
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(req: Request): Promise<Response> {
  await connection();
  const { user, workspace } = await requireWorkspace();
  const abilities = outreachAbilities({ plan: workspace.plan });
  if (!abilities.sendGmail) return back(req, "plan");
  if (!isGmailConfigured()) return back(req, "unconfigured");
  if (!isSecretsConfigured()) return back(req, "secrets_key");
  try {
    const state = signState({ userId: user.id, workspaceId: workspace.id }, secretsKey());
    return NextResponse.redirect(authorizationUrl(state), { status: 303 });
  } catch (error) {
    if (error instanceof GmailError) return back(req, error.code);
    throw error;
  }
}
