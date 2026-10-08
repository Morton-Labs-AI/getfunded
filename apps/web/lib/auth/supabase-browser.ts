import { createBrowserClient } from "@supabase/ssr";

import { supabasePublicEnv } from "./env";

/**
 * The browser-side Supabase client, for the sign-in form only
 * (`signInWithOtp` and `verifyOtp`). It persists the session in cookies so the
 * server (proxy.ts, lib/auth/session.ts) can read it on the next request.
 *
 * Kept in its own module because lib/auth/supabase.ts imports `next/headers`,
 * which cannot be bundled into a client component. `createBrowserClient` is a
 * singleton, so calling this on every render is fine.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = supabasePublicEnv();
  return createBrowserClient(url, anonKey);
}
