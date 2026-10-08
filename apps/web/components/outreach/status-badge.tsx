import { Check, CircleDashed, Clock, Loader2, PenLine, Send, X, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { statusLabel, type MessageStatus } from "@/lib/outreach/state";

type Variant = "outline" | "secondary" | "success" | "warning" | "danger" | "yours";

const LOOK: Record<MessageStatus, { variant: Variant; icon: LucideIcon }> = {
  draft: { variant: "outline", icon: PenLine },
  approved: { variant: "yours", icon: Check },
  sending: { variant: "secondary", icon: Loader2 },
  sent: { variant: "success", icon: Send },
  failed: { variant: "danger", icon: X },
  canceled: { variant: "secondary", icon: CircleDashed },
  recorded: { variant: "success", icon: Clock },
};

/** One badge per message status; the word is always present, never colour alone. */
export function StatusBadge({ status, className }: { status: MessageStatus; className?: string }) {
  const { variant, icon: Icon } = LOOK[status];
  return (
    <Badge variant={variant} className={className} data-status={status}>
      <Icon aria-hidden className={status === "sending" ? "animate-spin" : undefined} />
      {statusLabel(status)}
    </Badge>
  );
}

export function RepliedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="source" className={className}>
      <Check aria-hidden />
      Replied
    </Badge>
  );
}

export function BouncedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="danger" className={className}>
      <X aria-hidden />
      Bounced
    </Badge>
  );
}
