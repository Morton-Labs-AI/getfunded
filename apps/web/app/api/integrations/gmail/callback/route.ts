/**
 * GET /api/integrations/gmail/callback?code=&state=  (or ?error=access_denied)
 *
 * Verifies the signed state, requires that the person who came back is the
 * person who left (same user, same active workspace), exchanges the code,
 * checks that both scopes were granted, reads the mailbox address from
 * Google, seals the refresh token with SECRETS_KEY into getfunded.secrets and
 * marks the sender identity connected. Every failure lands on the settings
 * page with a short reason code; no token or code is ever echoed back.
 */
import { connection, NextResponse } from "next/server";

import { secretsKey, SecretsKeyError } from "@/lib/email/crypto";
import { exchangeCode, GmailError } from "@/lib/email/gmail";
import { verifyState } from "@/lib/email/oauth-state";
import { outreachAbilities } from "@/lib/outreach/gate";
import { connectGmail, verifiedProfile } from "@/lib/outreach/senders";
import { requireWorkspace } from "@/lib/workspace/context";

function back(req: Request, status: "connected" | "error", reason?: string): Response {
  const url = new URL("/app/outreach/settings", req.url);
  url.searchParams.set("gmail", status);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(req: Request): Promise<Response> {
  await connection();
  const { user, workspace } = await requireWorkspace();
  const params = new URL(req.url).searchParams;

  if (params.get("error")) return back(req, "error", params.get("error") === "access_denied" ? "denied" : "google");
  const code = params.get("code");
  if (!code || code.length > 2048) return back(req, "error", "missing_code");

  let key: Buffer;
  try {
    key = secretsKey();
  } catch {
    return back(req, "error", "secrets_key");
  }
  const state = verifyState(params.get("state"), key);
  if (!state) return back(req, "error", "bad_state");
  if (state.userId !== user.id || state.workspaceId !== workspace.id) return back(req, "error", "wrong_user");
  if (!outreachAbilities({ plan: workspace.plan }).sendGmail) return back(req, "error", "plan");

  try {
    const token = await exchangeCode(code);
    if (!token.refreshToken) return back(req, "error", "no_refresh_token");
    const profile = await verifiedProfile(token.accessToken, token.scope);
    await connectGmail(
      { userId: user.id, workspaceId: workspace.id },
      { email: profile.emailAddress, displayName: user.displayName, refreshToken: token.refreshToken },
    );
    return back(req, "connected");
  } catch (error) {
    if (error instanceof GmailError) return back(req, "error", error.code);
    if (error instanceof SecretsKeyError) return back(req, "error", "secrets_key");
    console.error("[gmail/callback] failed", { error: error instanceof Error ? error.message : String(error) });
    return back(req, "error", "unknown");
  }
}
