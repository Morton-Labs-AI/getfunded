import type { Metadata } from "next";
import Link from "next/link";

import { PRICING_FAQ } from "@/components/marketing/copy";
import { CtaBand } from "@/components/marketing/cta";
import { Faq } from "@/components/marketing/faq";
import { CreditTable, PlanCards, PlanCompareTable } from "@/components/marketing/pricing-cards";
import { Note, PageHero, Section, SectionHeading } from "@/components/marketing/section";
import { formatNumber } from "@/lib/format";
import { PLANS, formatPlanPrice } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Search is free for everyone. Plans from Free to Enterprise add AI credits, seats, export, outreach and an API. Self-install has no limits.",
  alternates: { canonical: "/pricing" },
};

const HOW_LIMITS_WORK: string[] = [
  "Every model call goes through one server function that reserves credits before the call and refunds them if it fails.",
  "The monthly period starts on your billing day. Free workspaces reset on the first of the month.",
  "When a workspace reaches its limit the call is refused with a clear message and an upgrade link. There is no silent overage.",
  "A daily soft cap of one third of the monthly credits spreads use across the month. Team and Enterprise can turn it off.",
  "Plan changes take effect at once. Credits are prorated on upgrade. Cancel any time from Settings; your data stays.",
];

export default function PricingPage() {
  const free = PLANS.free;
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Search is free. Credits pay for the AI."
        lede={
          <>
            Every plan includes unlimited funder search, profiles with provenance and application posture. Only calls to a
            language model cost credits. The free plan is free for good, with {formatNumber(free.monthly_credits)} credits a
            month.
          </>
        }
      />

      <Section id="plans" className="py-10 sm:py-14">
        <PlanCards />
        <p className="mt-6 text-sm text-ink-3">
          Prices are per workspace per month in US dollars. Hosted at getfunded.ai by the project steward. Self-install is
          free with no plan limits;{" "}
          <Link href="/docs/self-install" className="underline underline-offset-4 hover:text-foreground">
            read how
          </Link>
          .
        </p>
      </Section>

      <Section id="credits" tone="surface">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:items-start">
          <SectionHeading
            eyebrow="What a credit buys"
            title="One credit is a small, metered amount of model work."
            lede="About 4,000 input tokens and 1,000 output tokens on a mid-size model. The app records the real token counts on every call, so the price of a feature can be tuned without surprising you."
          />
          <div className="rounded-lg border bg-card shadow-card">
            <CreditTable />
          </div>
        </div>
      </Section>

      <Section id="compare">
        <SectionHeading eyebrow="Compare plans" title="Every limit, side by side." />
        <div className="mt-8 rounded-lg border bg-card shadow-card">
          <PlanCompareTable />
        </div>
        <p className="mt-4 text-sm text-ink-3">
          {PLANS.enterprise.name} is {formatPlanPrice(PLANS.enterprise)} a month and pays for a person&rsquo;s time, not just
          compute: managed campaigns, sender domains and warm-up, deliverability monitoring, onboarding and an SLA.
        </p>
      </Section>

      <Section id="limits" tone="inset">
        <SectionHeading eyebrow="How limits work" title="No surprise bills. Ever." />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2">
          {HOW_LIMITS_WORK.map((item, i) => (
            <li key={item} className="flex gap-3 text-sm text-ink-2">
              <span aria-hidden className="tnum font-mono font-semibold text-primary">
                {i + 1}
              </span>
              <span className="text-pretty">{item}</span>
            </li>
          ))}
        </ol>
        <Note className="mt-6 max-w-2xl">
          Anonymous search is rate limited to 30 requests a minute per IP address, signed-in search to 120 a minute per
          user. A kill switch can disable all model calls for everyone during an incident; nothing is charged while it is on.
        </Note>
      </Section>

      <Section id="faq">
        <SectionHeading eyebrow="Questions" title="Frequently asked." />
        <Faq className="mt-8 max-w-3xl" items={PRICING_FAQ} />
        <p className="mt-4 text-sm text-ink-3">
          More in the{" "}
          <Link href="/docs/faq" className="underline underline-offset-4 hover:text-foreground">
            FAQ
          </Link>{" "}
          and{" "}
          <Link href="/docs/ai-and-credits" className="underline underline-offset-4 hover:text-foreground">
            AI and credits
          </Link>
          .
        </p>
      </Section>

      <CtaBand
        title="Start free. Upgrade when you need more credits."
        body="Name and email only. No credit card. Every search and every profile is included on every plan."
        secondary={{ label: "Talk to us about Enterprise", href: "/contact" }}
      />
    </>
  );
}
