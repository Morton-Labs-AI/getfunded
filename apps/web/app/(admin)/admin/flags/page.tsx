import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/admin/bits";
import { FlagsForm } from "@/components/admin/flags-form";
import { getFlags } from "@/lib/admin/flags-server";
import { requireSteward } from "@/lib/admin/gate";

export const metadata: Metadata = { title: "Flags" };

export default function FlagsPage() {
  return (
    <Suspense fallback={null}>
      <FlagsContent />
    </Suspense>
  );
}

async function FlagsContent() {
  await requireSteward();
  const flags = await getFlags();
  return (
    <>
      <PageHeader
        title="Flags"
        description="Service-wide switches. They take effect for everyone; there is no per-workspace version of these."
      />
      <div className="max-w-2xl">
        <FlagsForm flags={flags} />
      </div>
    </>
  );
}
