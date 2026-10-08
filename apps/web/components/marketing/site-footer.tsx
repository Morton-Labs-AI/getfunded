import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { site } from "@/lib/site";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Search funders", href: "/search" },
      { label: "Pricing", href: "/pricing" },
      { label: "Docs", href: "/docs" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    heading: "Open source",
    links: [
      { label: "GitHub", href: site.github, external: true },
      { label: "Why open source", href: "/open-source" },
      { label: "The data", href: "/data" },
      { label: "Open Foundation List", href: "/foundations" },
      { label: "Data license", href: "/docs/data-sources-and-license" },
      { label: "Self-install", href: "/docs/self-install" },
      { label: "Contributing", href: "/docs/governance-and-contributing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Security", href: "/docs/security-and-privacy" },
    ],
  },
];

function FooterAnchor({ link }: { link: FooterLink }) {
  const className =
    "inline-flex items-center gap-1 text-sm text-ink-3 transition-colors duration-150 hover:text-foreground";
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noreferrer" className={className}>
        {link.label}
        <ArrowUpRight className="size-3 text-ink-4" aria-hidden />
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-sm text-ink-3">{site.tagline}</p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h2 className="eyebrow text-muted-foreground">{col.heading}</h2>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <FooterAnchor link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t pt-6 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Code {site.license.code} <span aria-hidden>·</span> Data {site.license.data}
          </p>
          <p>
            Built by{" "}
            <a href={site.builtBy.url} target="_blank" rel="noreferrer" className="font-medium text-ink-2 hover:text-foreground">
              {site.builtBy.name}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
