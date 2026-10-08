import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, GitBranch, Scale, ScrollText, Users } from "lucide-react";

import { CodeBlock } from "@/components/marketing/code-block";
import { HONESTY_RULES } from "@/components/marketing/copy";
import { CtaBand } from "@/components/marketing/cta";
import { LINKS } from "@/components/marketing/links";
import { PageHero, Section, SectionHeading } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Open source",
  description:
    "Why GetFunded is open source, how it is governed, how to contribute, and how the roadmap works. Apache-2.0 code, CC BY 4.0 data.",
  alternates: { canonical: "/open-source" },
};

const WHY_OPEN: Array<{ title: string; body: string }> = [
  {
    title: "The records are already public.",
    body: "Foundations file their returns with the IRS by law. Locking a readable version of them behind a paywall helps nobody. We publish the compilation under CC BY 4.0 and the government records stay public domain.",
  },
  {
    title: "Trust needs a way to check.",
    body: "Every fact points at a hashed file and a record locator. Open code means anyone can re-run the pipeline and compare hashes. That is a stronger claim than “trust us.”",
  },
  {
    title: "Nonprofits should not be locked in.",
    body: "You can take the dataset, run the app yourself, or move to another tool at any time. The hosted service earns its keep by being convenient, not by holding your data hostage.",
  },
  {
    title: "A rule is only a rule if it is enforced.",
    body: "“Unknown is not closed” and “missing is not zero” are written into the governance document. Reviewers block changes that break them. You can read the review.",
  },
];

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
    >
      {children}
      <ArrowUpRight className="size-3" aria-hidden />
    </a>
  );
}

export default function OpenSourcePage() {
  return (
    <>
      <PageHero
        eyebrow="Open source"
        title="Open code. Open data. Open decisions."
        lede={
          <>
            GetFunded is {site.license.code} code and a {site.license.data} dataset, stewarded by {site.builtBy.name}. Everything the
            hosted service runs is in the repository. So is the way decisions get made.
          </>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href={LINKS.github} target="_blank" rel="noreferrer">
              View on GitHub
              <ArrowUpRight aria-hidden />
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/docs/self-install">Self-install guide</Link>
          </Button>
        </div>
      </PageHero>

      <Section id="why">
        <SectionHeading eyebrow="Why open" title="Four reasons, none of them marketing." />
        <ul className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {WHY_OPEN.map((item) => (
            <li key={item.title}>
              <h3 className="font-semibold text-foreground">{item.title}</h3>
              <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="governance" tone="surface">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <SectionHeading
            eyebrow="Governance"
            title="Who decides what."
            lede={
              <>
                The full text is <ExternalLink href={LINKS.governance}>GOVERNANCE.md</ExternalLink>. This is the summary.
              </>
            }
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex gap-3">
              <Users className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <h3 className="font-semibold text-foreground">Roles</h3>
                <p className="mt-1 text-sm text-pretty text-muted-foreground">
                  Users, contributors (a merged change), maintainers (merge rights, listed in{" "}
                  <ExternalLink href={LINKS.maintainers}>MAINTAINERS.md</ExternalLink>), and the steward, {site.builtBy.name},
                  which holds the domain, the hosted service and the trademark.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <GitBranch className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <h3 className="font-semibold text-foreground">Lazy consensus</h3>
                <p className="mt-1 text-sm text-pretty text-muted-foreground">
                  Most decisions happen on pull requests. A maintainer approves, nobody objects within about 72 hours, it
                  merges. Objections are discussed on the thread.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Scale className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <h3 className="font-semibold text-foreground">Maintainer vote</h3>
                <p className="mt-1 text-sm text-pretty text-muted-foreground">
                  Breaking changes to the public schema, API or CLI, adding or removing a maintainer, and changing a license
                  need a simple majority, open for 72 hours, in public.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <ScrollText className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <h3 className="font-semibold text-foreground">RFCs and a Steering Committee</h3>
                <p className="mt-1 text-sm text-pretty text-muted-foreground">
                  Breaking changes start as an RFC (<ExternalLink href={LINKS.rfcTemplate}>template</ExternalLink>) open for a
                  week. When three organizations have active maintainers, a Steering Committee takes over the steward&rsquo;s
                  tie-breaker role for technical decisions.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section id="rules" tone="inset">
        <SectionHeading
          eyebrow="The seven data rules"
          title="Every change, from any contributor or agent, keeps these."
          lede="Reviewers block changes that break them. Changing a rule itself needs an RFC and a maintainer vote."
        />
        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HONESTY_RULES.map((rule, i) => (
            <li key={rule.title} className="rounded-lg border bg-card p-4 shadow-card">
              <p className="tnum font-mono text-xs font-semibold text-primary">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="mt-1 font-semibold text-foreground">{rule.title}</h3>
              <p className="mt-1 text-sm text-pretty text-muted-foreground">{rule.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="contribute">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <SectionHeading
            eyebrow="How to contribute"
            title="Small pull requests, signed off, with a test."
            lede={
              <>
                The full guide is <ExternalLink href={LINKS.contributing}>CONTRIBUTING.md</ExternalLink>. Contributions written with
                AI help are welcome when a person reviews every line and signs off.
              </>
            }
          />
          <div className="flex flex-col gap-4">
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-2 marker:font-medium marker:text-ink-3">
              <li>
                Report wrong data with the <ExternalLink href={LINKS.dataCorrection}>data correction template</ExternalLink>. No code
                needed.
              </li>
              <li>Branch from main. One topic per pull request. Add a test for new behavior.</li>
              <li>Run the checks before you open it:</li>
            </ol>
            <CodeBlock
              lang="bash"
              code={["cd corpus && uv run pytest -q      # if you touched corpus/", "cd apps/web && npm run check       # if you touched apps/web/"].join(
                "\n",
              )}
            />
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-2 marker:font-medium marker:text-ink-3" start={4}>
              <li>Sign off every commit with the Developer Certificate of Origin. There is no CLA.</li>
            </ol>
            <CodeBlock lang="bash" code={'git commit -s -m "fix: render Not available for missing revenue"'} />
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-2 marker:font-medium marker:text-ink-3" start={5}>
              <li>
                List user-facing changes under Unreleased in <ExternalLink href={LINKS.changelogFile}>CHANGELOG.md</ExternalLink>.
                A maintainer reviews within a few days.
              </li>
              <li>
                Security problems go through <ExternalLink href={LINKS.securityPolicy}>SECURITY.md</ExternalLink>, never a public
                issue.
              </li>
            </ol>
          </div>
        </div>
      </Section>

      <Section id="roadmap" tone="surface">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <SectionHeading
            eyebrow="Roadmap process"
            title="Now, Next, Later."
            lede={
              <>
                The roadmap is a public <ExternalLink href={LINKS.roadmap}>GitHub Project</ExternalLink>. If it is not on the board,
                it is not on the roadmap.
              </>
            }
          />
          <ul className="space-y-3 text-sm leading-6 text-ink-2">
            <li>Anyone can propose an item by opening an issue or a Discussion.</li>
            <li>A maintainer adds it to Later when it is clear and in scope.</li>
            <li>
              Maintainers review the board in the first two weeks of January, April, July and October: close what shipped,
              move items, drop items nobody has touched in two quarters, and post a summary in Discussions.
            </li>
            <li>Breaking changes need an accepted RFC before they enter Now.</li>
            <li>
              It is not a promise or a release date. The open-source project has no SLA. Details:{" "}
              <ExternalLink href={LINKS.roadmapProcess}>ROADMAP-PROCESS.md</ExternalLink>.
            </li>
          </ul>
        </div>
      </Section>

      <Section id="licenses">
        <SectionHeading eyebrow="Licenses" title="What you may do." />
        <dl className="mt-8 grid gap-6 sm:grid-cols-3">
          <div>
            <dt className="font-semibold text-foreground">Code: {site.license.code}</dt>
            <dd className="mt-1 text-sm text-pretty text-muted-foreground">
              Use, change and redistribute it, including commercially. <ExternalLink href={LINKS.license}>LICENSE</ExternalLink>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Data: {site.license.data}</dt>
            <dd className="mt-1 text-sm text-pretty text-muted-foreground">
              Share and adapt the compilation with credit. The government records underneath are public domain.{" "}
              <ExternalLink href={LINKS.dataLicense}>DATA-LICENSE.md</ExternalLink>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Name and logo: trademark</dt>
            <dd className="mt-1 text-sm text-pretty text-muted-foreground">
              Say &ldquo;based on GetFunded.&rdquo; Do not present a fork as the official service.{" "}
              <ExternalLink href={LINKS.trademark}>TRADEMARK.md</ExternalLink>
            </dd>
          </div>
        </dl>
      </Section>

      <CtaBand
        title="Clone it, run it, send a pull request."
        body="The repository has everything: the pipeline, the app, the migrations, the tests and the rules."
        primary={{ label: "View on GitHub", href: LINKS.github }}
        secondary={{ label: "Governance and contributing guide", href: "/docs/governance-and-contributing" }}
      />
    </>
  );
}
