import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark, ChevronsUpDown, Database, Landmark, Mail, Search, Sparkles, Users } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { AiBadge, AiCard } from "@/components/data/ai-badge";
import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { IrsRevokedNotice, IrsStandingChip } from "@/components/data/irs-standing-chip";
import { Posture } from "@/components/data/posture";
import { ProvenanceSeal } from "@/components/data/provenance-seal";
import { SourceChip, SourceValue } from "@/components/data/source-chip";
import { StatTile } from "@/components/data/stat-tile";
import { YoursBlock, YoursTag } from "@/components/data/yours-tag";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SkipLink } from "@/components/ui/skip-link";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatEin } from "@/lib/format";
import type { IrsStanding } from "@/lib/queries/corpus/standing-types";

import { CommandDemo, ToastDemo } from "./demos";

export const metadata: Metadata = {
  title: "Styleguide",
  description: "Tokens, type, primitives and the three data classes.",
};

/* ----------------------------------------------------------------------------
   Token tables
---------------------------------------------------------------------------- */

const SWATCH_GROUPS: { title: string; note?: string; tokens: string[] }[] = [
  {
    title: "Evergreen (brand)",
    tokens: [
      "evergreen-50",
      "evergreen-100",
      "evergreen-200",
      "evergreen-300",
      "evergreen-400",
      "evergreen-500",
      "evergreen-600",
      "evergreen-700",
      "evergreen-800",
      "evergreen-900",
      "evergreen-950",
    ],
  },
  { title: "Primary", tokens: ["primary", "primary-hover", "primary-foreground", "primary-tint", "primary-border"] },
  { title: "Surfaces", tokens: ["canvas", "surface", "surface-raised", "inset", "overlay", "scrim"] },
  { title: "Ink", note: "ink-4 is decorative only", tokens: ["ink", "ink-2", "ink-3", "ink-4"] },
  { title: "Lines", tokens: ["border", "border-strong", "input", "ring"] },
  {
    title: "Data classes",
    note: "AI is violet on purpose: outside the brand palette",
    tokens: ["source", "source-tint", "source-border", "ai", "ai-tint", "ai-border", "yours", "yours-tint", "yours-border"],
  },
  { title: "Status", tokens: ["success", "success-tint", "warning", "warning-tint", "danger", "danger-tint", "destructive"] },
  {
    title: "Sidebar",
    tokens: ["sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-accent", "sidebar-border"],
  },
  { title: "Charts", tokens: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6"] },
];

const RADII = [
  { token: "radius-badge", px: "6px", use: "badges, chips" },
  { token: "radius-control", px: "8px", use: "buttons, inputs, menus" },
  { token: "radius-card", px: "10px", use: "cards, popovers" },
  { token: "radius-modal", px: "12px", use: "dialogs, sheets" },
];

const PROVENANCE = {
  source: "IRS 990-PF e-file",
  filingYear: 2023,
  sha256: "3f1a9c0e7b2d4e6f8a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f",
  href: "https://apps.irs.gov/app/eos/",
  license: "Public domain",
  retrievedAt: "2026-09-14",
};

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-12 rounded-md border border-border-strong/40"
        style={{ background: `var(--${token})` }}
        role="img"
        aria-label={`Swatch for --${token}`}
      />
      <code className="text-[11px] text-ink-3">--{token}</code>
    </div>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-b py-10 last:border-0">
      <div className="mb-6 max-w-2xl">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Demo({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h3 className="eyebrow mb-3 text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   The three data classes, side by side (reused for the dark panel)
---------------------------------------------------------------------------- */

function DataClassTriad() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="gap-4 py-5">
        <CardHeader className="px-5">
          <CardTitle className="flex items-center gap-2 text-source">
            <SourceChip label="Source" />
          </CardTitle>
          <CardDescription>Verified from public filings. Teal, document glyph, dotted underline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-5 text-sm">
          <p>
            Total assets{" "}
            <SourceValue provenance={<ProvenanceSeal {...PROVENANCE} />}>
              <Money value={48_215_930} mono={false} />
            </SourceValue>{" "}
            reported for FY2023.
          </p>
          <SourceChip label="IRS 990-PF · FY2023" provenance={<ProvenanceSeal {...PROVENANCE} />} />
          <p className="text-xs text-muted-foreground">Click either to open the provenance popover.</p>
        </CardContent>
      </Card>

      <Card className="gap-4 py-5">
        <CardHeader className="px-5">
          <CardTitle className="flex items-center gap-2">
            <AiBadge reason="Inferred from 14 grants to youth mental-health programs since 2021." />
          </CardTitle>
          <CardDescription>Machine-suggested. Violet, dashed border, sparkle, and the literal word AI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-5 text-sm">
          <AiCard title="Why this may fit" reason="Compared your program description with this funder's last three years of grants.">
            <p className="text-sm text-ink-2">Strong Pacific Northwest youth-services giving at a scale that matches your ask.</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm">Accept</Button>
              <Button size="sm" variant="outline">
                Edit
              </Button>
              <Button size="sm" variant="ghost">
                Dismiss
              </Button>
            </div>
          </AiCard>
          <p>
            Suggested ask <AiBadge label="AI · $100K–$250K" reason="Median of this funder's grants to similar organizations." />
          </p>
        </CardContent>
      </Card>

      <Card className="gap-4 py-5">
        <CardHeader className="px-5">
          <CardTitle className="flex items-center gap-2">
            <YoursTag />
          </CardTitle>
          <CardDescription>Your workspace data. Brand green with a solid left rule.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-5 text-sm">
          <YoursBlock title="Relationship">
            <p className="flex flex-wrap items-center gap-1.5">
              Owner <YoursTag>Elise</YoursTag> Priority <YoursTag>Tier 1</YoursTag> Ask{" "}
              <YoursTag>
                <Money value={250_000} compact mono={false} />
              </YoursTag>
            </p>
          </YoursBlock>
          <p className="text-xs text-muted-foreground">Only this class is editable in the product.</p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Placeholder IRS standings, one per state. The EINs are not real organizations. */
const IRS_STANDING_BASE: IrsStanding = {
  orgId: "00000000-0000-4000-8000-000000000000",
  ein: "000000001",
  standing: "listed",
  inBmf: true,
  bmfAsOf: "2026-07-25",
  bmfAsOfKind: "retrieved",
  bmfRulingDate: "1998-04-01",
  masterFileAsOf: "2026-07-25",
  onPub78: true,
  pub78Codes: ["PF"],
  pub78AsOf: "2026-09-10",
  pub78AsOfKind: "irs_file_date",
  revocationDate: null,
  effectiveRevocationDate: null,
  postingDate: null,
  reinstatementDate: null,
  reinstated: false,
  revocationListAsOf: "2026-09-30",
  revocationListAsOfKind: "irs_file_date",
  provenance: {
    source: "IRS master file (Exempt Organizations BMF)",
    filingYear: null,
    objectId: "row:EIN=000000001",
    sha256: "3f9a1c2b7d5e4f60718293a4b5c6d7e8f9011223344556677889900aabbccdde",
    href: null,
    license: "U.S. Government public domain",
  },
};

const IRS_NOT_IN_MASTER_FILE = { inBmf: false, bmfAsOf: null, bmfAsOfKind: null, bmfRulingDate: null } as const;
const IRS_REVOCATION_SOURCE = "IRS Automatic Revocation of Exemption List";

const IRS_STANDING_DEMOS: IrsStanding[] = [
  IRS_STANDING_BASE,
  {
    ...IRS_STANDING_BASE,
    ...IRS_NOT_IN_MASTER_FILE,
    ein: "000000002",
    standing: "revoked",
    onPub78: false,
    pub78Codes: [],
    revocationDate: "2020-05-15",
    effectiveRevocationDate: "2020-07-15",
    postingDate: "2020-11-09",
    provenance: { ...IRS_STANDING_BASE.provenance, source: IRS_REVOCATION_SOURCE, objectId: "row:EIN=000000002;rev=2020-05-15" },
  },
  {
    ...IRS_STANDING_BASE,
    ein: "000000003",
    standing: "revoked_then_relisted",
    revocationDate: "2017-11-15",
    effectiveRevocationDate: "2017-11-15",
    postingDate: "2018-03-12",
    reinstatementDate: "2017-11-15",
    reinstated: true,
    provenance: { ...IRS_STANDING_BASE.provenance, source: IRS_REVOCATION_SOURCE, objectId: "row:EIN=000000003;rev=2017-11-15" },
  },
  {
    ...IRS_STANDING_BASE,
    ein: "000000004",
    standing: "lists_disagree",
    onPub78: false,
    pub78Codes: [],
    revocationDate: "2023-05-15",
    effectiveRevocationDate: "2023-05-15",
    postingDate: "2023-08-14",
    provenance: { ...IRS_STANDING_BASE.provenance, source: IRS_REVOCATION_SOURCE, objectId: "row:EIN=000000004;rev=2023-05-15" },
  },
  {
    ...IRS_STANDING_BASE,
    ...IRS_NOT_IN_MASTER_FILE,
    ein: "000000005",
    standing: "not_listed",
    onPub78: false,
    pub78Codes: [],
    provenance: { ...IRS_STANDING_BASE.provenance, source: "IRS Publication 78 data", objectId: "absent:EIN=000000005" },
  },
];

function HonestyStates() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Demo title="Missing (never $0, never N/A)">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">bare</dt>
          <dd>
            <Missing bare />
          </dd>
          <dt className="text-muted-foreground">not-available</dt>
          <dd>
            <Missing />
          </dd>
          <dt className="text-muted-foreground">not-verified</dt>
          <dd>
            <Missing kind="not-verified" />
          </dd>
          <dt className="text-muted-foreground">no-public-data</dt>
          <dd>
            <Missing kind="no-public-data" />
          </dd>
          <dt className="text-muted-foreground">Money null</dt>
          <dd>
            <Money value={null} />
          </dd>
          <dt className="text-muted-foreground">Money 0</dt>
          <dd>
            <Money value={0} />
          </dd>
        </dl>
      </Demo>
      <Demo title="Posture (the word closed never renders)">
        <div className="flex flex-wrap items-center gap-2">
          <Posture value="open" />
          <Posture value="preselected" />
          <Posture value="unknown" />
          <Posture value={null} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Hover the third one: an absent statement is explained, not hidden.</p>
      </Demo>
      <Demo title="IRS standing (never revoked on one list alone)" className="md:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          {IRS_STANDING_DEMOS.map((standing) => (
            <IrsStandingChip key={standing.ein} standing={standing} />
          ))}
          <IrsStandingChip standing={null} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {IRS_STANDING_DEMOS.map((standing) => (
            <IrsStandingChip key={standing.ein} standing={standing} compact />
          ))}
        </div>
        <IrsRevokedNotice standing={IRS_STANDING_DEMOS[1]} fy={2022} className="mt-3" />
        <p className="mt-3 text-xs text-muted-foreground">
          Click a chip for the dated IRS statement. The sixth chip has no data and renders nothing: until both IRS lists are loaded the
          page says nothing, never &quot;listed&quot;. The last state is a neutral outline, not a warning. Placeholder EINs and dates.
        </p>
      </Demo>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Page
---------------------------------------------------------------------------- */

export default function StyleguidePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-8">
        <div>
          <Logo size="lg" />
          <h1 className="mt-5 font-display text-4xl font-medium tracking-tight">Styleguide</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Tokens, type, every primitive, and the three data classes. Everything here renders from tokens in{" "}
            <code>app/globals.css</code>; switch the theme to check both modes.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 py-4 text-sm">
        {[
          ["tokens", "Tokens"],
          ["type", "Type"],
          ["data-classes", "Data classes"],
          ["honesty", "Honesty"],
          ["stats", "Stats & provenance"],
          ["primitives", "Primitives"],
          ["shell", "App shell"],
          ["dark", "Dark"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="text-ink-3 hover:text-foreground">
            {label}
          </a>
        ))}
      </nav>

      {/* Tokens */}
      <Section id="tokens" title="Tokens" description="Every colour is a CSS custom property on :root, re-defined under .dark, mapped through @theme inline.">
        <div className="space-y-8">
          {SWATCH_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className="text-sm font-semibold">{group.title}</h3>
                {group.note ? <span className="text-xs text-muted-foreground">{group.note}</span> : null}
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
                {group.tokens.map((token) => (
                  <Swatch key={token} token={token} />
                ))}
              </div>
            </div>
          ))}

          <div className="grid gap-6 md:grid-cols-2">
            <Demo title="Radius">
              <div className="flex flex-wrap items-end gap-4">
                {RADII.map((r) => (
                  <div key={r.token} className="flex flex-col items-center gap-1.5 text-center">
                    <div className="size-14 border-2 border-primary bg-primary-tint" style={{ borderRadius: `var(--${r.token})` }} />
                    <code className="text-[11px] text-ink-3">{r.px}</code>
                    <span className="text-[11px] text-muted-foreground">{r.use}</span>
                  </div>
                ))}
              </div>
            </Demo>
            <Demo title="Motion">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="font-mono text-xs text-ink-3">--motion-fast</dt>
                <dd>150ms · hover, focus</dd>
                <dt className="font-mono text-xs text-ink-3">--motion-base</dt>
                <dd>200ms · open, close, collapse</dd>
                <dt className="font-mono text-xs text-ink-3">reduced motion</dt>
                <dd>all animation and transitions disabled globally</dd>
              </dl>
            </Demo>
          </div>
        </div>
      </Section>

      {/* Type */}
      <Section id="type" title="Type" description="Inter for UI, Fraunces for marketing display, JetBrains Mono for numbers, EINs and SQL. Tabular numerals wherever a number sits.">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <p className="font-display text-5xl font-medium tracking-tight">Find the funders who already fund work like yours.</p>
            <p className="font-display text-3xl font-medium tracking-tight">Display 30 · Fraunces</p>
            <p className="text-2xl font-semibold">Heading 24 · Inter semibold</p>
            <p className="text-xl font-semibold">Heading 20</p>
            <p className="text-lg font-medium">Heading 18</p>
            <p className="text-base">Body 16 · The quick brown fox jumps over the lazy dog.</p>
            <p className="text-sm">Body 14 · The quick brown fox jumps over the lazy dog.</p>
            <p className="text-xs text-muted-foreground">Caption 12 · Secondary and helper text.</p>
            <p className="eyebrow text-muted-foreground">Eyebrow 11 · mono-caps voice</p>
          </div>
          <div className="space-y-3 rounded-lg border bg-card p-5">
            <h3 className="eyebrow text-muted-foreground">Numbers, EINs, SQL</h3>
            <p className="tnum font-mono text-2xl">$48,215,930</p>
            <p className="tnum font-mono text-sm">EIN {formatEin("930386902")}</p>
            <pre className="overflow-x-auto rounded-md bg-inset p-3 font-mono text-xs leading-relaxed text-ink-2">
              {`select name, total_assets\nfrom funders\nwhere state = 'OR'\norder by total_assets desc\nlimit 25;`}
            </pre>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">proportional</p>
                <p>1,111,111</p>
                <p>8,888,888</p>
              </div>
              <div className="tnum">
                <p className="text-xs text-muted-foreground">tabular (.tnum)</p>
                <p>1,111,111</p>
                <p>8,888,888</p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Data classes */}
      <Section
        id="data-classes"
        title="The three data classes"
        description="Every value belongs to exactly one class. Colour is never the only signal: source gets a dotted underline, AI gets a dashed border and a sparkle plus the word AI, yours gets a solid left rule."
      >
        <DataClassTriad />
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="data-source w-fit text-sm">.data-source</div>
          <div className="data-ai p-3 text-sm">.data-ai container</div>
          <div className="data-yours p-3 text-sm">.data-yours container</div>
        </div>
      </Section>

      {/* Honesty */}
      <Section id="honesty" title="Honesty states" description="Primitives that make the honest answer the easy one.">
        <HonestyStates />
      </Section>

      {/* Stats & provenance */}
      <Section id="stats" title="Stat tiles and provenance seals" description="A number with no context is decoration; every tile carries a hint or a trend. Every sourced fact can show its chain of custody.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Funders matched" value="1,284" hint="in Oregon and Washington" icon={Landmark} trend={{ value: 12, label: "vs last run" }} />
          <StatTile label="Total giving (FY2023)" value={<Money value={412_300_000} compact />} hint="sum of reported grants" icon={Database} />
          <StatTile label="Open to applications" value="38%" hint="of matched funders" icon={Users} trend={{ value: -4, label: "vs FY2022", goodDirection: "up" }} />
          <StatTile label="Median grant" value={null} hint="not reported for this set" href="/search" />
        </div>
        <div className="mt-6 flex flex-col items-start gap-3">
          <ProvenanceSeal {...PROVENANCE} />
          <ProvenanceSeal source="IRS Exempt Orgs BMF" filingYear={null} sha256={null} />
          <ProvenanceSeal source="IRS 990 e-file" filingYear="2022-06-30" sha256="9b2c" href="https://apps.irs.gov/app/eos/" />
        </div>
      </Section>

      {/* Primitives */}
      <Section id="primitives" title="Primitives" description="shadcn new-york, adapted to the tokens. Controls 8px, cards 10px, modals 12px.">
        <div className="space-y-10">
          <Demo title="Buttons">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button variant="destructive">Remove</Button>
              <Button variant="ai">
                <Sparkles />
                Suggest funders
              </Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="Save">
                <Bookmark />
              </Button>
              <Button size="icon-sm" variant="outline" aria-label="Search">
                <Search />
              </Button>
            </div>
          </Demo>

          <Demo title="Skip link">
            <p className="mb-3 text-sm text-muted-foreground">
              The first thing a keyboard user tabs to on every shell page. It is visually hidden until focused; shown
              here in its focused look. Every shell renders it before the sidebar and points it at{" "}
              <code>&lt;main id=&quot;main&quot; tabIndex=&#123;-1&#125;&gt;</code>.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <SkipLink href="#primitives" className="not-sr-only static rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-overlay" />
              <span className="text-xs text-muted-foreground">Tab from the page top to see the real one appear.</span>
            </div>
          </Demo>

          <Demo title="Badges">
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="source">Source</Badge>
              <Badge variant="ai">AI</Badge>
              <Badge variant="yours">Yours</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="danger">Danger</Badge>
            </div>
          </Demo>

          <div className="grid gap-8 md:grid-cols-2">
            <Demo title="Form controls">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="sg-name">Organization name</Label>
                  <Input id="sg-name" placeholder="Oregon Community Foundation" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sg-ein">EIN</Label>
                  <Input id="sg-ein" className="font-mono" defaultValue="93-0386902" aria-invalid />
                  <p className="text-xs text-danger">Shown in the invalid state.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sg-notes">Notes</Label>
                  <Textarea id="sg-notes" placeholder="What did the program officer say?" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sg-state">State</Label>
                  <Select defaultValue="or">
                    <SelectTrigger id="sg-state" className="w-full">
                      <SelectValue placeholder="Choose a state" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="or">Oregon</SelectItem>
                      <SelectItem value="wa">Washington</SelectItem>
                      <SelectItem value="ca">California</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox defaultChecked /> Accepts applications only
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch defaultChecked /> Email digests
                  </label>
                </div>
              </div>
            </Demo>

            <Demo title="Card, tabs, progress, avatar, skeleton">
              <Card>
                <CardHeader>
                  <CardTitle>Oregon Community Foundation</CardTitle>
                  <CardDescription>
                    Portland, OR · EIN <span className="font-mono">{formatEin("930386902")}</span>
                  </CardDescription>
                  <CardAction>
                    <Posture value="open" />
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Tabs defaultValue="overview">
                    <TabsList>
                      <TabsTrigger value="overview">Overview</TabsTrigger>
                      <TabsTrigger value="grants">Grants</TabsTrigger>
                      <TabsTrigger value="people">People</TabsTrigger>
                    </TabsList>
                    <TabsContent value="overview" className="pt-3 text-sm text-ink-2">
                      Total assets <Money value={2_950_000_000} compact mono={false} /> · 4,120 grants in FY2023.
                    </TabsContent>
                    <TabsContent value="grants" className="pt-3 text-sm text-ink-2">
                      Grants tab.
                    </TabsContent>
                    <TabsContent value="people" className="pt-3 text-sm text-ink-2">
                      People tab.
                    </TabsContent>
                  </Tabs>
                  <div>
                    <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                      <span>Fit review</span>
                      <span className="tnum">64%</span>
                    </div>
                    <Progress value={64} aria-label="Fit review progress" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>EK</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="gap-2">
                  <Button size="sm">Save funder</Button>
                  <Button size="sm" variant="outline">
                    Open profile
                  </Button>
                </CardFooter>
              </Card>
            </Demo>
          </div>

          <Demo title="Table">
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Funder</TableHead>
                    <TableHead>EIN</TableHead>
                    <TableHead>Posture</TableHead>
                    <TableHead className="text-right">Total giving</TableHead>
                    <TableHead>Fit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Oregon Community Foundation</TableCell>
                    <TableCell className="font-mono">{formatEin("930386902")}</TableCell>
                    <TableCell>
                      <Posture value="open" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={171_400_000} compact />
                    </TableCell>
                    <TableCell>
                      <AiBadge label="AI · 87" reason="Fit score from program overlap and grant size." />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Meyer Memorial Trust</TableCell>
                    <TableCell className="font-mono">{formatEin("930806316")}</TableCell>
                    <TableCell>
                      <Posture value="preselected" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={42_900_000} compact />
                    </TableCell>
                    <TableCell>
                      <AiBadge label="AI · 61" reason="Fit score from program overlap and grant size." />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Example Family Foundation</TableCell>
                    <TableCell className="font-mono">{formatEin("000000000")}</TableCell>
                    <TableCell>
                      <Posture value="unknown" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={null} />
                    </TableCell>
                    <TableCell>
                      <Missing bare />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Demo>

          <Demo title="Overlays">
            <div className="flex flex-wrap items-center gap-2">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    Dialog
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Save to pipeline</DialogTitle>
                    <DialogDescription>Pick a stage. You can change it later from the board.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-1.5">
                    <Label htmlFor="sg-stage">Stage</Label>
                    <Select defaultValue="research">
                      <SelectTrigger id="sg-stage" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="research">Research</SelectItem>
                        <SelectItem value="outreach">Outreach</SelectItem>
                        <SelectItem value="applied">Applied</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm">
                    Sheet
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Funder details</SheetTitle>
                    <SheetDescription>Slides in from the right on desktop, full width on mobile.</SheetDescription>
                  </SheetHeader>
                  <div className="px-4 text-sm text-ink-2">Sheet body.</div>
                </SheetContent>
              </Sheet>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Dropdown
                    <ChevronsUpDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <Bookmark />
                    Save
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Mail />
                    Draft outreach
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">Remove from pipeline</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    Popover
                  </Button>
                </PopoverTrigger>
                <PopoverContent>
                  <p className="text-sm">Popovers use the card radius and the lift shadow.</p>
                </PopoverContent>
              </Popover>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm">
                    Tooltip
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Short, inverted, no interaction.</TooltipContent>
              </Tooltip>

              <HoverCard>
                <HoverCardTrigger asChild>
                  <Button variant="link" size="sm">
                    Hover card
                  </Button>
                </HoverCardTrigger>
                <HoverCardContent>
                  <p className="text-sm font-medium">Meyer Memorial Trust</p>
                  <p className="mt-1 text-xs text-muted-foreground">Portland, OR · private foundation</p>
                </HoverCardContent>
              </HoverCard>
            </div>
            <div className="mt-4">
              <ToastDemo />
            </div>
          </Demo>

          <div className="grid gap-8 md:grid-cols-2">
            <Demo title="Command">
              <CommandDemo />
            </Demo>

            <Demo title="Collapsible, separator, scroll area">
              <Collapsible className="rounded-lg border bg-card">
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium">
                    Grant history
                    <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Separator />
                  <ScrollArea className="h-36">
                    <ul className="divide-y px-4 text-sm">
                      {Array.from({ length: 8 }, (_, i) => (
                        <li key={i} className="flex justify-between py-2">
                          <span>Grant {i + 1}</span>
                          <Money value={25_000 * (i + 1)} />
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            </Demo>
          </div>
        </div>
      </Section>

      {/* App shell */}
      <Section id="shell" title="App shell" description="Collapsible sidebar, top bar with search trigger and user menu, mobile sheet navigation. Framed here; it fills the viewport in the product.">
        <div className="h-[560px] overflow-hidden rounded-lg border shadow-card">
          <AppShell
            embedded
            title="Dashboard"
            user={{ name: "Elise Kim", email: "elise@example.org" }}
            usage={{ used: 42, limit: 100, plan: "Starter" }}
          >
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatTile label="Saved funders" value="24" hint="3 added this week" />
              <StatTile label="Open tasks" value="7" hint="2 due today" />
              <StatTile label="Outreach sent" value="12" trend={{ value: 20, label: "vs last month" }} />
            </div>
          </AppShell>
        </div>
      </Section>

      {/* Dark */}
      <Section id="dark" title="Dark mode" description="Tokens re-defined under .dark; this panel forces it so both themes can be checked at once.">
        <div className="dark rounded-lg border border-border bg-background p-6 text-foreground">
          <div className="space-y-8">
            <DataClassTriad />
            <HonestyStates />
            <div className="flex flex-wrap items-center gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Remove</Button>
              <Button variant="ai">
                <Sparkles />
                Suggest funders
              </Button>
              <Badge variant="source">Source</Badge>
              <Badge variant="ai">AI</Badge>
              <Badge variant="yours">Yours</Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Funders matched" value="1,284" hint="in Oregon and Washington" trend={{ value: 12, label: "vs last run" }} />
              <StatTile label="Total giving" value={<Money value={412_300_000} compact />} hint="FY2023" />
              <StatTile label="Median grant" value={null} hint="not reported" />
            </div>
          </div>
        </div>
      </Section>

      <p className="pt-8 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Back to the landing page
        </Link>
      </p>
    </div>
  );
}
