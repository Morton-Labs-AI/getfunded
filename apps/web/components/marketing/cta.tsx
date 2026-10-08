import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

import { Container } from "./section";

/** The closing band on marketing pages. */
export function CtaBand({
  title = "Start with a search. Sign up when you want to keep what you find.",
  body = "No credit card. Name and email only. The free plan includes every search and a monthly allowance of AI credits.",
  primary = { label: "Start free", href: "/signin" },
  secondary = { label: "Search without an account", href: "/search" },
}: {
  title?: string;
  body?: string;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
}) {
  return (
    <section className="border-t bg-primary-tint/50 py-14 sm:py-20">
      <Container className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <h2 className="font-display text-2xl font-medium tracking-tight text-balance text-foreground sm:text-3xl">{title}</h2>
          <p className="mt-2 text-pretty text-muted-foreground">{body}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button size="lg" asChild>
            <Link href={primary.href}>
              {primary.label}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href={secondary.href}>{secondary.label}</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
