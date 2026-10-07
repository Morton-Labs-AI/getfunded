"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "getfunded:persisted-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

/**
 * A boolean persisted in localStorage, read through useSyncExternalStore so
 * the server render uses `fallback` and the client catches up after hydration
 * without a setState-in-effect.
 */
export function usePersistedBoolean(key: string, fallback: boolean) {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const stored = window.localStorage.getItem(key);
        return stored === null ? fallback : stored === "1";
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );

  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* private mode or quota: state simply does not persist */
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  return [value, set] as const;
}
