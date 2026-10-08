import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabasePublicEnv } from "./env";

/**
 * Supabase is the SESSION layer and nothing else.
 *
 * The client is built per request, only `auth.*` is ever called on it, and
 * PostgREST is never touched: `anon` and `authenticated` hold no grants in
 * `getfunded.*`, so even a stray `.from()` would return nothing. The
 * `auth.users` row is a KEY (`getfunded.users.id`), not a data source. All data
 * access stays on postgres.js (lib/db/*).
 *
 * `cookies()` is async in Next.js 16. Writing cookies is allowed in Route
 * Handlers and Server Actions and throws during a Server Component render;
 * swallowing that throw is correct ONLY because proxy.ts refreshes the session
 * BEFORE render, so a Server Component never needs to persist a rotated token.
 * Remove the proxy and this becomes a silent sign-out one hour after sign-in.
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = supabasePublicEnv();
  const store = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            store.set(name, value, options);
          }
        } catch {
          /* Server Component render: read-only cookies. See the note above. */
        }
      },
    },
  });
}
