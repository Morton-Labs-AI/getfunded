import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";

import { LINKS } from "@/components/marketing/links";
import { Markdown } from "@/components/marketing/markdown";
import { Container, PageHero } from "@/components/marketing/section";
import { readChangelog } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Every notable change to GetFunded, from the repository CHANGELOG.md.",
  alternates: { canonical: "/changelog" },
};

export default function ChangelogPage() {
  const changelog = readChangelog();
  return (
    <>
      <PageHero
        eyebrow="Changelog"
        title="What changed, and when."
        lede={
          <>
            Read straight from the repository&rsquo;s CHANGELOG.md. Releases are tagged on{" "}
            <a href={LINKS.releases} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              GitHub
            </a>
            .
          </>
        }
      />
      <Container className="py-10 sm:py-14">
        <div className="max-w-2xl">
          {changelog ? (
            <Markdown body={changelog} hideTitle />
          ) : (
            <p className="text-sm text-ink-2">
              The changelog was not included in this build. Read it on{" "}
              <a
                href={LINKS.changelogFile}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-4"
              >
                GitHub
                <ArrowUpRight className="size-3" aria-hidden />
              </a>
              .
            </p>
          )}
        </div>
      </Container>
    </>
  );
}
