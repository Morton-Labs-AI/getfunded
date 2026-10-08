/**
 * Gmail over plain `fetch` against Google's REST endpoints: OAuth consent URL,
 * code exchange, refresh, profile, MIME building, send, and the two metadata
 * reads the runner needs (find a sent message by Message-ID, read a thread's
 * headers). No SDK, no database, no `process.env` reads outside `gmailConfig`.
 * Every function takes a `fetchImpl` so unit tests run against fakes.
 *
 * SCOPES. A person's own mailbox gets exactly two:
 *   gmail.send      put a message in the outbox
 *   gmail.metadata  headers, labels and timestamps of threads the app started
 * `format=metadata` is the most the metadata scope will serve; a body request
 * is refused by Google at the API layer. That is the structural guarantee
 * behind the consent copy ("it cannot read the text of your mail").
 *
 * The metadata scope also forbids the `q` search parameter, so "find the
 * message with this Message-ID" cannot use `rfc822msgid:`. Instead the runner
 * lists the most recent SENT messages (no `q`) and reads each one's
 * Message-ID header until it matches. An interrupted send is always among the
 * last few, so this stays cheap and never needs a wider scope.
 */

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.metadata",
] as const;
export const GMAIL_SCOPE = GMAIL_SCOPES.join(" ");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
/** Every Google call gets a deadline so a hung socket cannot hold a send run open. */
const GOOGLE_TIMEOUT_MS = 20_000;
/** How many recent SENT messages to scan when reconciling by Message-ID. */
export const RECONCILE_SCAN_LIMIT = 25;

export type Env = Record<string, string | undefined>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GmailErrorCode = "unconfigured" | "not_connected" | "reconnect" | "scope" | "rate" | "upstream";

export class GmailError extends Error {
  readonly code: GmailErrorCode;
  readonly status: number;
  constructor(code: GmailErrorCode, message: string, status?: number) {
    super(message);
    this.name = "GmailError";
    this.code = code;
    this.status = status ?? (code === "rate" ? 429 : code === "unconfigured" ? 503 : code === "upstream" ? 502 : 409);
  }
}

export function isGmailConfigured(env: Env = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export type GmailConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** Throws `GmailError('unconfigured')` when the OAuth client is missing. */
export function gmailConfig(env: Env = process.env): GmailConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const appUrl = env.APP_URL?.trim().replace(/\/+$/, "");
  if (!clientId || !clientSecret) {
    throw new GmailError(
      "unconfigured",
      "Gmail is not set up on this server. The operator must add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  if (!appUrl) {
    throw new GmailError("unconfigured", "APP_URL must be set so Google can send the user back to this site.");
  }
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/integrations/gmail/callback` };
}

export function authorizationUrl(state: string, env: Env = process.env): string {
  const { clientId, redirectUri } = gmailConfig(env);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
};

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = (await res.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function tokenRequest(body: Record<string, string>, fetchImpl: FetchLike): Promise<TokenSet> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const data = await readJson(res);
  if (!res.ok || typeof data.access_token !== "string") {
    const error = typeof data.error === "string" ? data.error : "";
    const description = typeof data.error_description === "string" ? data.error_description : "";
    if (error === "invalid_grant") {
      throw new GmailError(
        "reconnect",
        "Google no longer accepts this connection. It was revoked or it expired. Reconnect Gmail in Outreach settings.",
      );
    }
    throw new GmailError("upstream", `Google did not issue a token${description || error ? ` (${description || error})` : ""}.`);
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    scope: typeof data.scope === "string" ? data.scope : "",
  };
}

export async function exchangeCode(code: string, env: Env = process.env, fetchImpl: FetchLike = fetch): Promise<TokenSet> {
  const { clientId, clientSecret, redirectUri } = gmailConfig(env);
  return tokenRequest(
    { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" },
    fetchImpl,
  );
}

export async function refreshAccessToken(
  refreshToken: string,
  env: Env = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<TokenSet> {
  const { clientId, clientSecret } = gmailConfig(env);
  const refreshed = await tokenRequest(
    { refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" },
    fetchImpl,
  );
  return { ...refreshed, refreshToken: refreshed.refreshToken ?? refreshToken };
}

/** True when every scope we need is in the granted set (a user can untick one on the consent screen). */
export function hasRequiredScopes(granted: string | null | undefined): boolean {
  const set = new Set((granted ?? "").split(/\s+/).filter(Boolean));
  return GMAIL_SCOPES.every((s) => set.has(s));
}

/** Best effort. A dead token yields 400 and there is nothing left to revoke. */
export async function revokeToken(token: string, fetchImpl: FetchLike = fetch): Promise<void> {
  try {
    await fetchImpl(REVOKE_URL, {
      method: "POST",
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    /* best effort by design */
  }
}

async function gmailFetch<T>(accessToken: string, path: string, init: RequestInit, fetchImpl: FetchLike): Promise<T> {
  const res = await fetchImpl(`${API}/${path}`, {
    ...init,
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = await readJson(res);
  if (res.ok) return data as T;
  const detail = String((data.error as { message?: string } | undefined)?.message ?? res.status);
  if (res.status === 401) throw new GmailError("reconnect", "Google rejected the saved connection. Reconnect Gmail in Outreach settings.");
  if (res.status === 403) throw new GmailError("scope", `Google refused: ${detail}. Reconnect Gmail and allow both permissions.`);
  if (res.status === 429) throw new GmailError("rate", "Gmail is rate-limiting this mailbox. Wait a minute and try again.");
  throw new GmailError("upstream", `Gmail error: ${detail}`, 502);
}

export async function gmailProfile(accessToken: string, fetchImpl: FetchLike = fetch): Promise<{ emailAddress: string }> {
  const data = await gmailFetch<{ emailAddress?: string }>(accessToken, "profile", {}, fetchImpl);
  if (!data.emailAddress) throw new GmailError("upstream", "Google did not report the mailbox address.");
  return { emailAddress: data.emailAddress.trim().toLowerCase() };
}

/* ----------------------------------------------------------------------------
   MIME
---------------------------------------------------------------------------- */

/** RFC 2047 encoded-word for header values that carry non-ASCII; ASCII passes through unchanged. */
export function encodeHeaderWord(value: string): string {
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Strip CR/LF from a header value: the only defence against header injection. */
function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** `Name <addr>`; the name is sanitised as untrusted input and quoted or encoded when it must be. */
export function formatAddress(displayName: string | null | undefined, address: string): string {
  const addr = headerValue(address);
  const clean = (displayName ?? "")
    .replace(/[\r\n"<>\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return addr;
  if (/[^\x00-\x7F]/.test(clean)) return `${encodeHeaderWord(clean)} <${addr}>`;
  if (/[(),.:;@[\]]/.test(clean)) return `"${clean}" <${addr}>`;
  return `${clean} <${addr}>`;
}

export type MimeInput = {
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
};

/** A plain-text RFC 5322 message with threading headers. Base64 body so any text is safe on the wire. */
export function buildMime(input: MimeInput): string {
  const headers = [
    `From: ${formatAddress(input.fromName, input.from)}`,
    `To: ${headerValue(input.to)}`,
    `Subject: ${encodeHeaderWord(headerValue(input.subject))}`,
    `Message-ID: ${headerValue(input.messageId)}`,
    input.inReplyTo ? `In-Reply-To: ${headerValue(input.inReplyTo)}` : "",
    input.references ? `References: ${headerValue(input.references)}` : "",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = Buffer.from(input.text.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

export function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/* ----------------------------------------------------------------------------
   Send and read
---------------------------------------------------------------------------- */

export type SentRef = { id: string; threadId: string };

export async function gmailSend(
  accessToken: string,
  raw: string,
  threadId: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<SentRef> {
  const data = await gmailFetch<{ id?: string; threadId?: string }>(
    accessToken,
    "messages/send",
    { method: "POST", body: JSON.stringify(threadId ? { raw, threadId } : { raw }) },
    fetchImpl,
  );
  if (!data.id) throw new GmailError("upstream", "Gmail accepted the request but returned no message id.");
  return { id: data.id, threadId: data.threadId ?? data.id };
}

export type MetadataMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
};

export function header(message: MetadataMessage, name: string): string {
  const want = name.toLowerCase();
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === want)?.value ?? "";
}

const METADATA_HEADERS = ["From", "To", "Subject", "Date", "Message-ID", "In-Reply-To", "Auto-Submitted", "X-Failed-Recipients"];

function metadataQuery(): string {
  const params = new URLSearchParams({ format: "metadata" });
  for (const name of METADATA_HEADERS) params.append("metadataHeaders", name);
  return params.toString();
}

export async function gmailMessageMeta(accessToken: string, id: string, fetchImpl: FetchLike = fetch): Promise<MetadataMessage> {
  return gmailFetch<MetadataMessage>(accessToken, `messages/${encodeURIComponent(id)}?${metadataQuery()}`, {}, fetchImpl);
}

export async function gmailThreadMeta(
  accessToken: string,
  threadId: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ id: string; messages?: MetadataMessage[] }> {
  return gmailFetch<{ id: string; messages?: MetadataMessage[] }>(
    accessToken,
    `threads/${encodeURIComponent(threadId)}?${metadataQuery()}`,
    {},
    fetchImpl,
  );
}

/**
 * Find a sent message by its RFC 5322 Message-ID without the `q` parameter
 * (forbidden under gmail.metadata): list the latest SENT ids, then read each
 * one's headers until the id matches. Returns null when none of the recent
 * sends carries it, which the runner reads as "Gmail never got it".
 */
export async function findSentByMessageId(
  accessToken: string,
  messageId: string,
  fetchImpl: FetchLike = fetch,
  scanLimit = RECONCILE_SCAN_LIMIT,
): Promise<SentRef | null> {
  const want = messageId.trim().replace(/^<|>$/g, "").toLowerCase();
  if (!want) return null;
  const params = new URLSearchParams({ labelIds: "SENT", maxResults: String(Math.max(1, Math.min(100, scanLimit))) });
  const list = await gmailFetch<{ messages?: SentRef[] }>(accessToken, `messages?${params.toString()}`, {}, fetchImpl);
  for (const ref of list.messages ?? []) {
    const meta = await gmailMessageMeta(accessToken, ref.id, fetchImpl);
    const got = header(meta, "Message-ID").trim().replace(/^<|>$/g, "").toLowerCase();
    if (got && got === want) return { id: meta.id, threadId: meta.threadId ?? ref.threadId };
  }
  return null;
}

export type ReplyDetection =
  | { kind: "none" }
  | { kind: "replied"; at: Date; from: string; providerMessageId: string }
  | { kind: "bounced"; at: Date; from: string; providerMessageId: string };

/**
 * Did someone other than the sender write in this thread after `sentAt`?
 * Auto-replies (RFC 3834 `Auto-Submitted`) are ignored; delivery failures
 * (`X-Failed-Recipients`, a mailer-daemon sender) are reported as a bounce,
 * never as a reply: a dead address must not read as an engaged funder.
 */
export function detectReply(
  messages: readonly MetadataMessage[],
  sentAt: Date,
  senderEmail: string,
): ReplyDetection {
  const me = senderEmail.trim().toLowerCase();
  const sentMs = sentAt.getTime();
  let bounce: ReplyDetection | null = null;
  for (const m of messages) {
    const at = Number(m.internalDate ?? 0);
    if (!Number.isFinite(at) || at <= sentMs) continue;
    const from = header(m, "From").trim();
    const fromLower = from.toLowerCase();
    if (!from || fromLower.includes(me)) continue;
    const failed = header(m, "X-Failed-Recipients");
    if (failed || /mailer-daemon|postmaster/.test(fromLower)) {
      bounce ??= { kind: "bounced", at: new Date(at), from, providerMessageId: m.id };
      continue;
    }
    const auto = header(m, "Auto-Submitted").toLowerCase();
    if (auto && auto !== "no") continue;
    return { kind: "replied", at: new Date(at), from, providerMessageId: m.id };
  }
  return bounce ?? { kind: "none" };
}
