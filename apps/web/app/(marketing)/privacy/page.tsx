import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT, mailto } from "@/components/marketing/links";
import { Note, PageHero, Section } from "@/components/marketing/section";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What GetFunded stores, what it never does with your data, how AI processing works, and how to delete your account.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "2026-10-07";

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-24 text-xl font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h2>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <PageHero eyebrow="Privacy" title="What we store, and what we never do with it." lede="Short on purpose. If something here is unclear, ask and we will fix the wording.">
        <Note className="max-w-xl">
          Draft for counsel review. This page describes how the service is built and operated today; it has not yet been
          reviewed by a lawyer. Last updated <time dateTime={UPDATED}>October 7, 2026</time>.
        </Note>
      </PageHero>

      <Section className="py-10 sm:py-14">
        <div className="max-w-2xl text-[15px] leading-7 text-ink-2 [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
          <H id="who">Who we are</H>
          <p>
            {site.name} ({site.url}) is operated by {site.builtBy.name}, the steward of the open-source project. This page
            covers the hosted service. If you self-install, you are the operator and this page does not apply to your copy.
          </p>

          <H id="what-we-store">What we store</H>
          <ul>
            <li>Your name, your email address and the time you last signed in. There is no password.</li>
            <li>Your organization profile, if you fill it in: mission, state, counties, program areas, budget, who you serve.</li>
            <li>
              What you create in your workspace: saved funders, stages, tasks, notes, approved facts, outreach drafts, contacts
              you add, your suppression list, and the verdicts you give on AI output.
            </li>
            <li>
              A usage ledger: which AI tool ran, when, how many tokens it used and how many credits it cost. We keep it to
              enforce plan limits and to show you your own usage.
            </li>
            <li>If you connect Gmail: an encrypted token that lets the app send mail as you. Never your Google password.</li>
            <li>If you subscribe: a Stripe customer id. Your card details are held by Stripe, not by us.</li>
            <li>Product telemetry: event names such as &ldquo;search run&rdquo; with a workspace id, kept for 12 months.</li>
          </ul>

          <H id="what-we-do-not-store">What we do not store</H>
          <ul>
            <li>The content of your email inbox. The Gmail connection sends; it does not read.</li>
            <li>Your browsing history on other sites.</li>
            <li>Anything about people who have not signed up, beyond the public filing data on funder pages.</li>
          </ul>

          <H id="cookies">Cookies</H>
          <p>
            We use cookies for your session only: one set from Supabase Auth that keeps you signed in, and one that
            remembers which workspace you have open. We do not use advertising cookies or third-party trackers. Your theme
            choice is kept in your browser&rsquo;s local storage, not sent to us.
          </p>

          <H id="selling">We do not sell your data</H>
          <p>
            We do not sell, rent or share your workspace data with anyone. We do not sell contact lists. Public filing data
            on funder pages is already public and is published under CC BY 4.0; nothing you add to your workspace is ever
            part of that dataset.
          </p>

          <H id="ai">AI processing</H>
          <p>
            When you use an AI tool, we send a request to Anthropic&rsquo;s API. The request contains the funder&rsquo;s public
            record, your organization profile, your approved facts and your question. We do not send your contacts, your
            messages or your activity log. The output is stored in your workspace, labelled as AI, with a fingerprint of its
            inputs. We do not use your data to train models.
          </p>

          <H id="processors">Who else handles data</H>
          <ul>
            <li>Supabase: authentication and the database.</li>
            <li>Vercel: hosting.</li>
            <li>Anthropic: language-model requests, as described above.</li>
            <li>Stripe: payments.</li>
            <li>Google: only if you connect Gmail, and only to send mail you approved.</li>
          </ul>

          <H id="security">Security</H>
          <p>
            The database itself checks every request. You can only read rows that belong to a workspace you are a member
            of, even if the app had a bug. The app&rsquo;s database account cannot change the public filing data. The token
            that connects your Gmail is stored encrypted. Details are on the{" "}
            <Link href="/docs/security-and-privacy" className="font-medium text-primary underline underline-offset-4">
              security and privacy guide
            </Link>
            .
          </p>

          <H id="retention">Retention and deletion</H>
          <p>
            We keep your data while your account exists. To delete your account, email{" "}
            <a href={mailto(CONTACT.general, "Delete my account")} className="font-medium text-primary underline underline-offset-4">
              {CONTACT.general}
            </a>{" "}
            from the address on your account. We delete your user record, your personal workspace and everything in it.
            Shared workspaces that other members own are not deleted. Usage ledger rows are kept in aggregate for billing
            records with the user id removed. Backups age out within 30 days.
          </p>

          <H id="your-rights">Your rights</H>
          <p>
            You can see and export your workspace data from the app at any time. You can ask us to correct or delete your
            personal data. If you are in a jurisdiction that grants additional rights, we will honor them; tell us where you
            are when you write.
          </p>

          <H id="children">Children</H>
          <p>The service is for organizations and their staff. It is not directed at children under 16.</p>

          <H id="changes">Changes</H>
          <p>
            When this page changes, the date at the top changes and the change is listed in the project&rsquo;s{" "}
            <Link href="/changelog" className="font-medium text-primary underline underline-offset-4">
              changelog
            </Link>
            . Because the project is open source, the history of this page is public.
          </p>

          <H id="contact">Contact</H>
          <p>
            Privacy questions:{" "}
            <a href={mailto(CONTACT.general, "Privacy question")} className="font-medium text-primary underline underline-offset-4">
              {CONTACT.general}
            </a>
            . Security reports:{" "}
            <a href={mailto(CONTACT.security)} className="font-medium text-primary underline underline-offset-4">
              {CONTACT.security}
            </a>
            .
          </p>
        </div>
      </Section>
    </>
  );
}
