import Link from "next/link";
import { OpenRing } from "./open-ring";
import { ThemeToggle } from "./theme-toggle";
import { Omnibox } from "./omnibox";
import { CommandPalette } from "./command-palette";
import { AccountSlot } from "./community/account-slot";
import { PostureBadge } from "./community/posture-badge";

const links = [
  { href: "/browse", label: "Browse" },
  { href: "/programs", label: "Programs" },
  { href: "/data", label: "Data" },
];

/**
 * async because <AccountSlot> reads the session. With COMMUNITY_MODE unset the
 * slot returns null and the badge returns today's copy, so the header renders
 * byte-identically to before the community layer existed.
 */
export async function Nav() {
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
          <PostureBadge />
          <ThemeToggle />
          <AccountSlot />
        </nav>
      </div>
      <CommandPalette />
    </header>
  );
}
