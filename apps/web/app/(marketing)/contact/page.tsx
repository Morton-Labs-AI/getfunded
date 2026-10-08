import type { Metadata } from "next";
import { ArrowUpRight, Bug, Building2, FileWarning, Mail, MessageSquare, ShieldAlert } from "lucide-react";

import { CONTACT, LINKS, mailto } from "@/components/marketing/links";
import { Note, PageHero, Section } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach us: GitHub Discussions for questions, email for account matters, private channels for security.",
  alternates: { canonical: "/contact" },
};

type Channel = {
  icon: typeof Mail;
  title: string;
  body: string;
  href: string;
  label: string;
  external?: boolean;
};

const CHANNELS: Channel[] = [
  {
    icon: MessageSquare,
    title: "Questions and ideas",
    body: "GitHub Discussions is the front door. Answers there help the next person too.",
    href: LINKS.discussions,
    label: "Open Discussions",
    external: true,
  },
  {
    icon: Mail,
    title: "Hosted-service and account matters",
    body: "Billing and deletion requests. Write from the address on your account.",
    href: mailto(CONTACT.general),
    label: CONTACT.general,
  },
  {
    icon: Building2,
    title: "Enterprise plans",
    body: "You do not need an account to ask. Tell us about your team and what you send today. A person replies.",
    href: mailto(CONTACT.general, "Enterprise plan"),
    label: CONTACT.general,
  },
  {
    icon: FileWarning,
    title: "Wrong data about a funder",
    body: "Use the data correction template. Give the funder name, the EIN, the profile link, what is wrong and what you checked.",
    href: LINKS.dataCorrection,
    label: "Report a data problem",
    external: true,
  },
  {
    icon: Bug,
    title: "Bugs and feature requests",
    body: "Open an issue with the matching template.",
    href: LINKS.issues,
    label: "Open an issue",
    external: true,
  },
  {
    icon: ShieldAlert,
    title: "Security problems",
    body: "Please do not open a public issue. Use GitHub's private report form or email the security address. We reply within 5 business days.",
    href: mailto(CONTACT.security),
    label: CONTACT.security,
  },
];

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title="No form. Just the right channel." lede="Most questions are best asked in public, where the answer helps everyone. Account matters go by email." />
      <Section className="py-10 sm:py-14">
        <ul className="grid gap-4 sm:grid-cols-2">
          {CHANNELS.map((c) => (
            <li key={c.title} className="flex gap-4 rounded-lg border bg-card p-5 shadow-card">
              <c.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0">
                <h2 className="font-semibold text-foreground">{c.title}</h2>
                <p className="mt-1 text-sm text-pretty text-muted-foreground">{c.body}</p>
                <a
                  href={c.href}
                  target={c.external ? "_blank" : undefined}
                  rel={c.external ? "noreferrer" : undefined}
                  className="mt-3 inline-flex max-w-full items-center gap-1 text-sm font-medium break-all text-primary underline underline-offset-4 hover:text-primary-hover"
                >
                  {c.label}
                  {c.external ? <ArrowUpRight className="size-3.5 shrink-0" aria-hidden /> : null}
                </a>
              </div>
            </li>
          ))}
        </ul>
        <Note className="mt-8 max-w-2xl">
          The open-source project has no service-level agreement. Maintainers answer when they can. Hosted-service account
          holders get email support. Conduct reports go to {CONTACT.conduct}.
        </Note>
      </Section>
    </>
  );
}
