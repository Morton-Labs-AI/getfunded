"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { markNotificationsReadAction } from "@/lib/workspace/notification-actions";

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markNotificationsReadAction({ all: true });
          router.refresh();
        })
      }
    >
      <Check aria-hidden />
      Mark all read
    </Button>
  );
}
