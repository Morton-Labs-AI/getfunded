import Link from "next/link";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NOT_FOUND_HINT, NOT_FOUND_TITLE } from "@/lib/content/copy";

export default function FunderNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6">
      <SearchX className="size-8 text-ink-4" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold text-foreground">{NOT_FOUND_TITLE}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{NOT_FOUND_HINT}</p>
      <Button asChild className="mt-6">
        <Link href="/search">Search funders</Link>
      </Button>
    </div>
  );
}
