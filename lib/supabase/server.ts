import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Supabase is the SESSION layer and nothing else.
 *
 * The client is constructed per request, only auth.* is ever called, and
 * PostgREST is never touched. The auth.users row is a KEY, not a data source:
 * lib/auth/viewer.ts takes the verified auth.users.id and does one indexed
 * lookup on community.members over postgres.js. That is the whole integration.
 *
 * Two consequences worth stating, because both are easy to undo by accident:
 *  - No @supabase/supabase-js query builder anywhere in this app. All data
 *    access stays on the two postgres.js pools (lib/db.ts, lib/community/db.ts).
 *  - `anon` and `authenticated` hold no privileges in the community schema, so
 *    even if someone did reach for PostgREST it would return nothing.
 */
export async function supabaseServer() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          // Writable in Route Handlers and Server Actions; throws in a Server
          // Component. Swallowing is CORRECT here only because proxy.ts
          // refreshes the session BEFORE render, so a Server Component never
          // needs to persist a rotated cookie. Remove that proxy and this
          // becomes a silent logout bug an hour after every sign-in.
          try {
            for (const { name, value, options } of toSet) {
              store.set(name, value, options);
            }
          } catch {
            /* Server Component render — see above. */
          }
        },
      },
    }
  );
}

/**
 * The verified identity, or null.
 *
 * getUser(), NEVER getSession(). getSession() decodes and trusts the cookie;
 * the cookie is attacker-controllable input. getUser() revalidates the JWT
 * against the auth server. This distinction is the difference between an auth
 * system and a suggestion, and it must survive every future refactor of this
 * file — which is why it is written down here rather than assumed.
 */
export async function supabaseAuthUser(): Promise<{ id: string; email: string } | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}
