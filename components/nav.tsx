import Link from "next/link";
import { OpenRing } from "./open-ring";
import { ThemeToggle } from "./theme-toggle";
import { Omnibox } from "./omnibox";

const links = [
  { href: "/browse", label: "Browse" },
  { href: "/programs", label: "Programs" },
  { href: "/data", label: "Data" },
];

export function Nav() {
  return (
    <header
      className="sticky top-0 z-40 border-b border-border-1 backdrop-blur-[12px]"
      style={{ background: "var(--topbar-bg)" }}
    >
      <div className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-6 px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <OpenRing size={22} />
          <span className="text-[15px] font-[620] tracking-[-0.01em]">
            <span className="text-ink-1">Open Funder</span>{" "}
            <span className="text-ink-3">Database</span>
          </span>
        </Link>

        <div className="hidden flex-1 justify-center md:flex">
          <Omnibox />
        </div>

        <nav className="flex shrink-0 items-center gap-5">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[13.5px] font-medium text-ink-3 transition-colors duration-[90ms] hover:text-ink-1"
            >
              {l.label}
            </Link>
          ))}
          <span className="mono-label hidden rounded-[5px] border border-border-1 px-2 py-1 lg:inline">
            read-only · local
          </span>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
