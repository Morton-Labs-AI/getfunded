import type { Metadata } from "next";
import Link from "next/link";

import { PLAN_ORDER } from "@/components/marketing/copy";
import { CONTACT, LINKS, mailto } from "@/components/marketing/links";
import { Note, PageHero, Section } from "@/components/marketing/section";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { PLANS, formatPlanPrice } from "@/lib/plans";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for the hosted GetFunded service: accounts, plans and limits, fair use, outreach rules, the data license and liability.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "2026-10-07";

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-24 text-xl font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h2>
  );
}

function limit(v: number | null): string {
  return v === null ? "Unlimited" : formatNumber(v);
}

export default function TermsPage() {
  return (
    <>
      <PageHero eyebrow="Terms" title="Terms for the hosted service." lede="Plain language, no surprises. The code and the data have their own licenses, linked below.">
        <Note className="max-w-xl">
          Draft for counsel review. These terms describe how the hosted service works today; they have not yet been
          reviewed by a lawyer. Last updated <time dateTime={UPDATED}>October 7, 2026</time>.
        </Note>
      </PageHero>

      <Section className="py-10 sm:py-14">
        <div className="max-w-2xl text-[15px] leading-7 text-ink-2 [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
          <H id="scope">1. What these terms cover</H>
          <p>
            These terms apply to the hosted service at {site.url}, operated by {site.builtBy.name}. The open-source code is
            licensed separately under {site.license.code} and the dataset under {site.license.data}; those licenses, not
            these terms, govern a self-install.
          </p>

          <H id="accounts">2. Accounts</H>
          <ul>
            <li>You sign up with a name and an email address. You are responsible for the email account you use.</li>
            <li>An account is for a person. A workspace is for an organization and can have members according to its plan.</li>
            <li>You must be 16 or older and acting for an organization or for yourself, not for a child.</li>
            <li>We may suspend an account that breaks these terms. We will tell you why.</li>
          </ul>

          <H id="plans">3. Plans, prices and limits</H>
          <p>
            Plan prices and limits are those on the{" "}
            <Link href="/pricing" className="font-medium text-primary underline underline-offset-4">
              pricing page
            </Link>{" "}
            at the time you buy. At the date above they are:
          </p>
          <div className="mt-3 rounded-lg border bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Price / month</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">AI credits / month</TableHead>
                  <TableHead className="text-right">Saved funders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PLAN_ORDER.map((id) => {
                  const p = PLANS[id];
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                      <TableCell className="text-right font-mono">{formatPlanPrice(p)}</TableCell>
                      <TableCell className="text-right">{limit(p.members)}</TableCell>
                      <TableCell className="text-right">{limit(p.monthly_credits)}</TableCell>
                      <TableCell className="text-right">{limit(p.saved_funders_limit)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <ul>
            <li>Search and funder profiles are free and need no account. Only calls to a language model use credits.</li>
            <li>
              When a workspace reaches its monthly or daily credit limit, further AI calls are refused until the next period or
              an upgrade. There is no overage charge.
            </li>
            <li>Paid plans are billed monthly through Stripe. Plan changes take effect at once; credits are prorated on upgrade.</li>
            <li>
              You can cancel any time from Settings. The plan runs to the end of the paid period and then drops to Free. Your
              data stays.
            </li>
            <li>We may change prices with at least 30 days&rsquo; notice by email. Changes apply from your next billing period.</li>
          </ul>

          <H id="fair-use">4. Fair use</H>
          <p>The service is shared. To keep it fast and affordable:</p>
          <ul>
            <li>Anonymous search is limited to 30 requests a minute per IP address, signed-in search to 120 a minute per user.</li>
            <li>Do not scrape the site. The dataset is available under CC BY 4.0 as a download and through a self-install.</li>
            <li>Do not share one account between people. Add members instead.</li>
            <li>Do not use the service to build a competing contact-data product from non-public contact data.</li>
            <li>Do not try to bypass plan limits, rate limits or workspace isolation. Report a way to do it instead; see below.</li>
          </ul>

          <H id="outreach">5. Outreach</H>
          <ul>
            <li>Every message is sent only after you approve it, through your own Gmail account, as you.</li>
            <li>You are the sender. You are responsible for what you send and for complying with applicable law, including CAN-SPAM and similar rules.</li>
            <li>Honor requests not to be contacted. The suppression list exists for that.</li>
            <li>We may disable sending for a workspace that generates spam complaints or bounces at a rate that threatens other users.</li>
          </ul>

          <H id="ai">6. AI output</H>
          <p>
            AI output is a suggestion, labelled as such. It can be wrong. It never claims a funder is interested in you. Check
            it against the cited evidence before you rely on it. You own what you write; we claim no rights in your drafts.
          </p>

          <H id="data">7. The data</H>
          <ul>
            <li>
              Funder data comes from public government filings and is published as filed. We filter superseded filings; we do
              not correct the record. It can be late, amended or wrong.
            </li>
            <li>
              The compilation is licensed {site.license.data} (
              <a href={LINKS.dataLicense} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">
                DATA-LICENSE.md
              </a>
              ). The government records underneath are public domain.
            </li>
            <li>Your workspace data is yours. We do not sell it and we do not add it to the public dataset.</li>
          </ul>

          <H id="availability">8. Availability</H>
          <p>
            We aim to keep the service up and will post incidents in the changelog, but the Free, Starter, Pro and Team plans
            come with no service-level agreement. Enterprise agreements may include one in writing.
          </p>

          <H id="warranty">9. No warranty and limits on liability</H>
          <p>
            The service and the data are provided &ldquo;as is&rdquo; without warranty of any kind. To the extent the law allows, {site.builtBy.name}{" "}
            is not liable for indirect or consequential loss, and its total liability for any claim is limited to the amount you
            paid for the service in the twelve months before the claim.
          </p>

          <H id="termination">10. Ending the agreement</H>
          <p>
            You can delete your account at any time by emailing{" "}
            <a href={mailto(CONTACT.general, "Delete my account")} className="font-medium text-primary underline underline-offset-4">
              {CONTACT.general}
            </a>
            . We may end the agreement for a serious or repeated breach of these terms, with notice and a chance to export
            your data unless the breach makes that unsafe.
          </p>

          <H id="changes">11. Changes to these terms</H>
          <p>
            When these terms change, the date at the top changes and the change is listed in the{" "}
            <Link href="/changelog" className="font-medium text-primary underline underline-offset-4">
              changelog
            </Link>
            . Material changes are announced by email at least 30 days before they take effect.
          </p>

          <H id="contact">12. Contact</H>
          <p>
            Questions about these terms:{" "}
            <a href={mailto(CONTACT.general, "Terms question")} className="font-medium text-primary underline underline-offset-4">
              {CONTACT.general}
            </a>
            . Security reports:{" "}
            <a href={mailto(CONTACT.security)} className="font-medium text-primary underline underline-offset-4">
              {CONTACT.security}
            </a>
            . The GetFunded name and logo are trademarks of {site.builtBy.name}; see{" "}
            <a href={LINKS.trademark} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">
              TRADEMARK.md
            </a>
            .
          </p>
        </div>
      </Section>
    </>
  );
}
