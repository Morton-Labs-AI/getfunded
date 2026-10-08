import type { Metadata } from "next";

import { SettingsNav } from "@/components/settings/settings-nav";

export const metadata: Metadata = {
  title: { default: "Settings", template: "%s · Settings · GetFunded" },
  robots: { index: false, follow: false },
};

/**
 * Settings chrome: a title, the section tabs (left on desktop, a select on
 * phones) and the active tab's content. No data access here, so this shell
 * prerenders; each tab streams its own data under Suspense.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="mb-5 text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
        <aside className="md:sticky md:top-20 md:self-start">
          <SettingsNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
