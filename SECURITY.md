# Security Policy

## Report a vulnerability

Please do not open a public issue for security problems.

Report privately in one of two ways:

1. GitHub: open the repository's **Security** tab and click
   **Report a vulnerability**
   (https://github.com/Morton-Labs-AI/getfunded/security/advisories/new).
2. Email: security@mortonlabs.ai

Include what you found, how to reproduce it, and what you think the impact
is. We will reply within 5 business days.

## Coordinated disclosure

We follow a 90-day coordinated disclosure window.

- We confirm the report and agree on severity with you.
- We aim to ship a fix well inside 90 days.
- We publish an advisory and credit you when the fix is out, unless you ask
  us not to.
- If a fix needs more than 90 days, we will tell you why and agree on a new
  date.

## Supported versions

We support the latest minor release only. Fixes land on `main` and ship in
the next release. Older releases do not get backports.

## What counts

Reports in these areas are in scope:

- Authentication or authorization bypass
- Tenant isolation failures (one organization sees another's data)
- Leaks of contact data that is not marked `publishability = 'public'`
- Bypass of the SQL guard that limits what queries can run
- Bypass of usage quotas or rate limits
- Exposure of the `internal` schema or of raw source files

Out of scope: errors in public government filings (use the data correction
issue template), and findings that need physical access to a user's device.

## Hosted service

Reports about getfunded.ai go to the same channels.
