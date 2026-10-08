import "server-only";
/**
 * The ONLY file in lib/outreach that imports another builder's module. Every
 * cross-team dependency is adapted here so the composer, the pages and the
 * actions can be read without knowing the other modules' exact shapes, and so
 * the integrator has one place to fix a signature.
 *
 * Contracts (from the build brief):
 *   lib/ai/draft.ts               polishDraft(ctx, { template, funder, dossier?, orgProfile })
 *   lib/queries/corpus/funder.ts  getFunder(orgId), getFunderContacts(orgId)
 *   lib/queries/corpus/types.ts   FunderRecord
 *
 * While those files are still landing, lib/outreach/contracts.d.ts declares
 * the same signatures as ambient modules so this app typechecks. TypeScript
 * prefers a real file over an ambient declaration, so the shim goes inert the
 * moment the real modules exist; delete it at integration.
 */
import { polishDraft as polishDraftImpl } from "@/lib/ai/draft";
import { getFunder as getFunderImpl, getFunderContacts as getFunderContactsImpl } from "@/lib/queries/corpus/funder";
import type { FunderRecord } from "@/lib/queries/corpus/types";

import type { FilingChannel } from "./contacts";

export type { FunderRecord };

export type PolishResult = {
  subject: string;
  body: string;
  claims: Array<{ text: string; evidenceId: string }>;
};

export async function polishDraft(
  ctx: { userId: string; workspaceId: string },
  input: { template: string; funder: FunderRecord; dossier?: unknown; orgProfile: unknown },
): Promise<PolishResult> {
  const out = await polishDraftImpl(ctx, input);
  return {
    subject: String(out.subject ?? ""),
    body: String(out.body ?? ""),
    claims: Array.isArray(out.claims)
      ? out.claims.map((c) => ({ text: String(c.text ?? ""), evidenceId: String(c.evidenceId ?? "") }))
      : [],
  };
}

export async function getFunder(orgId: string): Promise<FunderRecord | null> {
  return getFunderImpl(orgId);
}

/**
 * Public, role-based channels from the funder's filing, normalised for the
 * "Use this contact" picker. Accepts the `public.contact_channels` view shape
 * (`channel_type`, `value`, `is_role_based`, `source_url`, `source_dataset`)
 * and the camelCase form a query module may return. Personal channels never
 * reach this function: the view nulls them.
 */
export async function getFilingChannels(orgId: string): Promise<FilingChannel[]> {
  const raw = (await getFunderContactsImpl(orgId)) as unknown;
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { channels?: unknown }).channels)
      ? ((raw as { channels: unknown[] }).channels ?? [])
      : [];
  const out: FilingChannel[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const value = String(r.value ?? r.address ?? "").trim();
    if (!value) continue;
    const type = String(r.channel_type ?? r.channelType ?? r.kind ?? r.type ?? "").toLowerCase();
    const kind: FilingChannel["kind"] = type.includes("mail") || value.includes("@") ? "email" : type.includes("phone") || type.includes("tel") ? "phone" : "other";
    if (kind === "other") continue;
    const isRoleBased = Boolean(r.is_role_based ?? r.isRoleBased ?? true);
    out.push({
      id: String(r.id ?? `${kind}:${value}`),
      kind,
      value,
      label: kind === "email" ? "Email listed in filing" : "Phone listed in filing",
      sourceUrl: typeof (r.source_url ?? r.sourceUrl) === "string" ? String(r.source_url ?? r.sourceUrl) : null,
      sourceDataset: typeof (r.source_dataset ?? r.sourceDataset) === "string" ? String(r.source_dataset ?? r.sourceDataset) : null,
      isRoleBased,
    });
  }
  return out;
}
