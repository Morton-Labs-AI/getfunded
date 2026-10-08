/**
 * Soft-fail for optional panels on workspace pages. A dashboard must still
 * render when one side query (momentum, owner load) fails or times out; the
 * panel shows its empty or problem state instead. The error is logged, never
 * swallowed silently. Next.js control flow (redirect, notFound) is rethrown
 * untouched.
 */
import { unstable_rethrow } from "next/navigation";

export async function softFail<T>(what: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    unstable_rethrow(err);
    console.warn(`[workspace] ${what} unavailable:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}
