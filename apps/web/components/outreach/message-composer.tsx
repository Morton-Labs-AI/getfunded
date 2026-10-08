"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { polishDraftAction, saveDraftAction } from "@/app/(app)/app/outreach/actions";
import { AiBadge, AiCard } from "@/components/data/ai-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { OUTREACH_COPY } from "@/lib/outreach/copy";
import { findPlaceholders, firstNameOf, renderTemplate, type MergeValues, type Template } from "@/lib/outreach/templates";
import { CHANNELS, CHANNEL_LABELS, type Channel } from "@/lib/outreach/types";

export type ComposerFunder = { id: string; orgId: string; name: string; city: string | null; state: string | null };
export type ComposerContact = { id: string; fullName: string; title: string | null; email: string | null; phone: string | null; source: string };
export type ComposerTemplate = Pick<Template, "key" | "name" | "when" | "subject" | "body" | "builtIn">;

type Claim = { text: string; evidenceId: string };
/** What is in the subject and body boxes, where it came from, and the model's claims when it came from the model. */
type Draft = { subject: string; body: string; source: "template" | "ai"; claims: Claim[] };

const NONE = "__none__";

/**
 * Pick a funder, a contact and a template; fill the merge fields; optionally
 * polish with the model; save as a draft. Nothing here sends. Changing the
 * funder updates the URL so the server re-reads that funder's contacts and
 * its public filing channels.
 */
export function MessageComposer({
  funders,
  selectedFunderId,
  contacts,
  templates,
  initial,
  org,
  senderName,
  ai,
}: {
  funders: ComposerFunder[];
  selectedFunderId: string | null;
  contacts: ComposerContact[];
  templates: ComposerTemplate[];
  initial: { contactId?: string | null; templateKey?: string | null; channel?: Channel | null };
  org: { name: string; mission: string | null; website: string | null };
  senderName: string;
  ai: { enabled: boolean; mock: boolean; creditCost: number };
}) {
  const router = useRouter();
  const funder = funders.find((f) => f.id === selectedFunderId) ?? null;

  const [contactId, setContactId] = React.useState<string>(initial.contactId ?? contacts[0]?.id ?? NONE);
  const [templateKey, setTemplateKey] = React.useState<string>(initial.templateKey ?? templates[0]?.key ?? "introduction");
  const [channel, setChannel] = React.useState<Channel>(initial.channel ?? "email");
  const [programArea, setProgramArea] = React.useState("");
  const [askAmount, setAskAmount] = React.useState("");
  const [senderTitle, setSenderTitle] = React.useState("");
  // null = the draft still follows the template and the fields; set once the
  // person edits the text by hand or the model polishes it.
  const [edited, setEdited] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState<"polish" | "save" | null>(null);
  const baseId = React.useId();
  const id = (name: string) => `${baseId}-${name}`;

  // When the funder changes (URL), the contact list changes with it: keep the
  // choice while it is still valid, else fall back to that funder's first
  // contact. React's "storing information from previous renders" pattern.
  const [seenContacts, setSeenContacts] = React.useState(contacts);
  if (seenContacts !== contacts) {
    setSeenContacts(contacts);
    if (!contacts.some((c) => c.id === contactId)) setContactId(contacts[0]?.id ?? NONE);
  }

  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const template = templates.find((t) => t.key === templateKey) ?? templates[0] ?? null;

  const values: MergeValues = React.useMemo(
    () => ({
      contact_first_name: firstNameOf(contact?.fullName),
      contact_full_name: contact?.fullName ?? "",
      contact_title: contact?.title ?? "",
      funder_name: funder?.name ?? "",
      funder_city: funder?.city ?? "",
      funder_state: funder?.state ?? "",
      org_name: org.name,
      org_mission: org.mission ?? "",
      org_website: org.website ?? "",
      program_area: programArea,
      ask_amount: askAmount.trim() ? formatMoney(askAmount) : "",
      sender_name: senderName,
      sender_title: senderTitle,
    }),
    [contact, funder, org, programArea, askAmount, senderName, senderTitle],
  );

  const rendered = React.useMemo(() => (template ? renderTemplate(template, values) : null), [template, values]);

  // Until the person edits the text by hand, the draft follows the template and the fields.
  const fromTemplate = React.useMemo<Draft>(
    () => ({ subject: rendered?.subject ?? "", body: rendered?.body ?? "", source: "template", claims: [] }),
    [rendered],
  );
  const draft = edited ?? fromTemplate;
  const { subject, body, source, claims } = draft;

  const placeholders = findPlaceholders(`${subject}\n${body}`);

  function chooseFunder(nextId: string) {
    const params = new URLSearchParams();
    params.set("funder", nextId);
    router.replace(`/app/outreach/new?${params.toString()}`);
  }

  /** A hand edit: freeze whatever is on screen, then apply the change. */
  function edit(patch: Partial<Pick<Draft, "subject" | "body">>) {
    setEdited({ ...draft, ...patch });
  }

  function refill() {
    setEdited(null);
  }

  async function polish() {
    if (!funder) return;
    setBusy("polish");
    try {
      const result = await polishDraftAction({ savedFunderId: funder.id, subject, body });
      if (!result.ok) {
        toast.error("Could not polish", { description: result.error });
        return;
      }
      setEdited({ subject: result.subject, body: result.body, source: "ai", claims: result.claims });
      toast.success(result.mock ? "Polished (mock model)" : "Polished", { description: "Read every line before you approve it." });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!funder) {
      toast.error("Pick a funder first");
      return;
    }
    setBusy("save");
    try {
      const result = await saveDraftAction({
        savedFunderId: funder.id,
        contactId: contactId === NONE ? null : contactId,
        channel,
        subject,
        body,
        draftSource: source,
        claims: source === "ai" ? claims : undefined,
      });
      if (!result.ok) {
        toast.error("Could not save", { description: result.error });
        return;
      }
      toast.success("Draft saved", { description: "Approve it from the message page when it is ready." });
      router.push(`/app/outreach/${result.id}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Who and what</CardTitle>
          <CardDescription>Pick the funder, the contact and a template. The fields below fill the template.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("funder")}>Funder</Label>
            <Select value={funder?.id ?? ""} onValueChange={chooseFunder}>
              <SelectTrigger id={id("funder")} className="w-full">
                <SelectValue placeholder={funders.length ? "Choose a saved funder" : "Save a funder first"} />
              </SelectTrigger>
              <SelectContent>
                {funders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                    {f.state ? ` · ${f.state}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-ink-3">Only funders on your saved list appear here.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("contact")}>Contact</Label>
            <Select value={contactId} onValueChange={setContactId} disabled={!funder}>
              <SelectTrigger id={id("contact")} className="w-full">
                <SelectValue placeholder="Choose a contact" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No contact yet</SelectItem>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.fullName}
                    {c.email ? ` · ${c.email}` : c.phone ? ` · ${c.phone}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contact && channel === "email" && !contact.email ? <p className="text-xs text-warning">{OUTREACH_COPY.contacts.noEmail}</p> : null}
            <p className="text-xs text-ink-3">Add or edit contacts in the panel below the form.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("template")}>Template</Label>
              <Select value={templateKey} onValueChange={setTemplateKey}>
                <SelectTrigger id={id("template")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name}
                      {t.builtIn ? "" : " (yours)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {template ? <p className="text-xs text-ink-3">{template.when}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("channel")}>How it goes out</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger id={id("channel")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-ink-3">Email can be sent from the app on Pro. Everything else you send yourself and record here.</p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("program")}>Program you are writing about</Label>
            <Input id={id("program")} value={programArea} onChange={(e) => setProgramArea(e.target.value)} placeholder="e.g. our after-school tutoring program" maxLength={200} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("ask")}>Amount you are asking for (optional)</Label>
              <Input id={id("ask")} inputMode="numeric" value={askAmount} onChange={(e) => setAskAmount(e.target.value)} placeholder="e.g. 25000" maxLength={20} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("title")}>Your title (optional)</Label>
              <Input id={id("title")} value={senderTitle} onChange={(e) => setSenderTitle(e.target.value)} placeholder="e.g. Development Director" maxLength={120} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>The message</CardTitle>
            {source === "ai" ? <AiBadge reason={OUTREACH_COPY.ai.labelReason} /> : null}
          </div>
          <CardDescription>
            {source === "ai"
              ? "This text was rewritten by a model. Read it before you save it."
              : "Edit anything. Marked fields like [add: program area] must be filled before approval."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {channel === "email" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("subject")}>Subject</Label>
              <Input
                id={id("subject")}
                value={subject}
                maxLength={300}
                onChange={(e) => edit({ subject: e.target.value })}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("body")}>Text</Label>
            <Textarea
              id={id("body")}
              value={body}
              rows={16}
              className="min-h-72 font-sans"
              onChange={(e) => edit({ body: e.target.value })}
            />
          </div>
          {placeholders.length ? (
            <p className="rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
              Still to fill in: {placeholders.join(", ")}. Add the field on the left or type it in the text.
            </p>
          ) : null}

          {source === "ai" && claims.length ? (
            <AiCard title="What the model kept, and where it comes from" reason={OUTREACH_COPY.ai.labelReason}>
              <ul className="flex flex-col gap-1.5 text-sm">
                {claims.map((c, i) => (
                  <li key={`${c.evidenceId}-${i}`} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                    <span className="text-ink-2">{c.text}</span>
                    <code className="shrink-0 text-xs text-ink-3">{c.evidenceId}</code>
                  </li>
                ))}
              </ul>
            </AiCard>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={refill} disabled={!template || busy !== null}>
              <Wand2 aria-hidden />
              Fill from template again
            </Button>
            {ai.enabled ? (
              <Button variant="ai" size="sm" onClick={() => void polish()} disabled={!funder || !body.trim() || busy !== null}>
                {busy === "polish" ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                {OUTREACH_COPY.ai.polishLabel} · {ai.creditCost} credits
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button size="sm" onClick={() => void save()} disabled={!funder || busy !== null}>
              {busy === "save" ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              Save draft
            </Button>
          </div>
          {ai.enabled ? <p className="text-xs leading-5 text-ink-3">{OUTREACH_COPY.ai.polishHelp}</p> : null}
          <p className="text-xs leading-5 text-ink-3">Saving does not send anything. {OUTREACH_COPY.approval.explain}</p>
        </CardContent>
      </Card>
    </div>
  );
}
