---
title: API
description: The Team and Enterprise API: keys, endpoints, limits and the honesty rules that apply to every response.
group: developers
order: 2
---

# API

Team and Enterprise workspaces can read search results, funder records and their saved list over HTTPS. The API returns the same data as the app, with the same rules: unknown is not closed, missing is not zero, every fact carries its source, AI output is labelled.

## Keys

1. Go to **Settings → API** in a Team or Enterprise workspace.
2. Create a key and give it a name. The key is shown once. Copy it.
3. Keys start with `gf_live_`. They are stored hashed; we cannot show them again.
4. Revoke a key from the same page. Revocation is immediate.

A key belongs to a workspace, not a person. It has scopes: `read` (default) and `write`.

Send the key as a bearer token:

```bash
curl -H "Authorization: Bearer gf_live_..." https://getfunded.ai/api/v1/search?q=food+bank
```

## Endpoints

### `GET /api/v1/search`

The same search as the app. Query parameters match the search page URL.

| Parameter | Meaning |
|---|---|
| `q` | Name, EIN, or a sentence about your work |
| `type` | `private_foundation`, `public_charity`, `company`, `investment_adviser`, `fund`, `gov_agency` |
| `state` | Two-letter state |
| `posture` | `open`, `preselected`, `unknown` |
| `page` | 1-based page number |

Returns a page of funder summaries: id, name, EIN, type, city, state, posture, latest assets and latest grants paid, each with a `source` object.

### `GET /api/v1/funders/{id}`

One funder record: identity, posture and how-to-apply text, latest financials and the year series, grants paid, officers, public contact channels, and provenance for each section.

Contact values are present only when the record is `publishability = 'public'`. Otherwise the field is `null`, never a guess.

### `GET /api/v1/saved` and `POST /api/v1/saved`

Your workspace's saved funders. `GET` lists them with stage, tier, owner and tags. `POST` with `{ "org_id": "<uuid>" }` saves one; it needs the `write` scope.

## Response shape

Every response is JSON. Missing values are `null`. We never return `0` for a missing number and never return the string `"closed"` for posture. Posture values are `open`, `preselected` and `unknown`.

Errors look like:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests. Try again in 12 seconds." } }
```

| Status | Code | Meaning |
|---|---|---|
| 401 | `unauthorized` | Missing or invalid key |
| 403 | `plan_forbidden` | The workspace's plan does not include the API |
| 403 | `scope_forbidden` | The key lacks the needed scope |
| 404 | `not_found` | No such funder |
| 429 | `rate_limited` | Slow down; see `Retry-After` |

## Limits

- 60 requests a minute per key, refilling at one a second.
- Responses carry `Cache-Control: no-store`. Cache on your side if you need to.
- The API reads the same read-only corpus role as the app. It cannot write the corpus.

## Attribution

Data you take out through the API is covered by [CC BY 4.0](/docs/data-sources-and-license). Credit GetFunded and keep a link to the license when you republish it.

## Free alternatives

You do not need the API to use the data. Every public table is exported as a versioned CSV dataset by `funderdb export public`, and a self-install gives you direct SQL access to the `public.*` views. See [Self-install](/docs/self-install).
