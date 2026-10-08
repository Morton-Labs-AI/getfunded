---
title: Security and privacy
description: What we store, how the app is isolated from the data, how AI processing works, and how to report a problem.
group: developers
order: 5
---

# Security and privacy

This page describes how the hosted service and the code protect your data. The legal text is on [Privacy](/privacy) and [Terms](/terms).

## What we store about you

- Your name, email and the time you last signed in.
- Your organization profile, if you filled it in.
- What you create in your workspace: saved funders, stages, tasks, notes, approved facts, drafts, contacts you add, and the verdicts you give on AI output.
- A usage ledger: which AI tool ran, when, how many tokens it used, and how many credits it cost.
- If you connect Gmail: an encrypted refresh token, so the app can send on your behalf. Never your password.
- If you subscribe: a Stripe customer id. Card details stay with Stripe.

We do not store your email content, your browsing history or anything from other services.

## Sign-in

Sign-in is by magic link or 6-digit code, through Supabase Auth. There is no password to leak. The session is a cookie that the app refreshes on each request. Supabase Auth holds the session only; the app never reads data through it.

## How the app is isolated from the data

One Postgres holds two parts: the public corpus and the workspace data.

- The app's database role can **read** the corpus and **cannot write it**. This is a grant on the role, not a convention. A bug in the app cannot change a filing.
- Every workspace table has Row Level Security enabled **and forced**. Each query runs with your user id set on the connection, and the policies only return rows of workspaces you belong to. No user id means zero rows, never someone else's rows.
- Append-only tables (activity, stage history, AI analyses, send outcomes) have no update or delete grant at all.
- The app never runs as the database owner or as Supabase's service role, and the service key is not in the app's environment.
- "Ask the analyst" runs model-written SQL on a separate, read-only role with a 15-second time limit and no access to workspace tables. That role can read only the public views and the summary tables the app's SQL guard allows (migration `getfunded_0010` grants exactly that list), the guard itself allows only those names and a fixed list of ordinary SQL functions, and each query is sent in a way that lets the database refuse a second statement. `npm run db:ping` checks that the role's grants still match the guard.

## AI processing

- Only one file in the codebase can call the model, and only through the meter that reserves credits first. A unit test fails the build if another file imports the SDK.
- Model calls go to Anthropic's API. We send the funder's public record, your organization profile, your approved facts and your question. We do not send your contacts, your messages or your activity log.
- Every output is stored append-only with a fingerprint of its inputs, labelled AI, and never reused for a different workspace.
- A kill switch turns off every model call for everyone during an incident.

## Contact data

- Public contact channels appear only when the source record carries `publishability = 'public'`. The SQL nulls the value otherwise.
- Named people's addresses from filings are never shown, exported or copied into a workspace.
- Vendor contact data is never used. A database trigger makes it impossible to mark as public.
- Messages are sent only after a person approves each one, through the person's own Gmail, within a daily cap, and never to a suppressed address.

## Secrets

Integration tokens are encrypted with AES-256-GCM under a key that lives only in the server environment. The database stores ciphertext. Reading a secret goes through a database function that checks the caller is the owner or a workspace admin.

## Rate limits

Anonymous search is limited to 30 requests a minute per IP address. Signed-in search is limited to 120 a minute per user. API keys are limited to 600 a minute, refilling at ten a second. Limits are enforced in the database so they hold across servers.

## Transport and headers

Everything is served over HTTPS. Responses carry `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict referrer policy and a restrictive permissions policy. Route handlers accept requests from the app's own origin only.

## Deletion

Email us from the address on your account and ask. We delete your user record, your personal workspace and everything in it. Shared workspaces that other members own are not deleted. Usage ledger rows are kept in aggregate for billing records with the user id removed.

## Reporting a vulnerability

Please do not open a public issue.

1. Use GitHub's **Report a vulnerability** on the repository's Security tab, or
2. email security@mortonlabs.ai.

We reply within 5 business days and follow a 90-day coordinated disclosure window. In scope: authentication or authorization bypass, tenant isolation failures, leaks of non-public contact data, bypass of the SQL guard, bypass of quotas or rate limits, exposure of the `internal` schema or raw files. See [SECURITY.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/SECURITY.md).

## Self-install

Everything above applies to a self-install too, because it is the same code and the same migrations. You hold the keys. The `npm run db:ping` check proves the role boundary on your own database.
