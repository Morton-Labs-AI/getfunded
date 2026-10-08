import Link from "next/link";
import { Calendar, FileText, Mail, NotebookPen, Phone, Settings2, Users } from "lucide-react";

import { formatDateTime } from "@/lib/format";
import type { Activity, ActivityKind } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<ActivityKind, string> = {
  note: "Note",
  email: "Email",
  call: "Call",
  meeting: "Meeting",
  letter: "Letter",
  event: "Event",
  system: "Record",
};

const KIND_ICON = {
  note: NotebookPen,
  email: Mail,
  call: Phone,
  meeting: Users,
  letter: FileText,
  event: Calendar,
  system: Settings2,
} as const;

/** The YOURS timeline for a funder (or the workspace): newest first. Server-renderable. */
export function ActivityTimeline({ activities, showFunder = false }: { activities: Activity[]; showFunder?: boolean }) {
  return (
    <ol className="flex flex-col">
      {activities.map((a) => {
        const Icon = KIND_ICON[a.kind];
        const system = a.kind === "system";
        return (
          <li key={a.id} className="flex gap-3 border-l-2 border-yours-border py-2 pl-3 last:pb-0">
            <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", system ? "bg-inset text-ink-3" : "bg-yours-tint text-yours")}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm", system ? "text-ink-2" : "text-foreground")}>
                {showFunder && a.funderName && a.savedFunderId ? <span className="font-medium">{a.funderName}: </span> : null}
                <span className="whitespace-pre-wrap">{a.body}</span>
              </p>
              <p className="tnum mt-0.5 text-xs text-ink-3">
                {KIND_LABEL[a.kind]} · {formatDateTime(a.occurredAt)}
                {a.createdByName ? ` · ${a.createdByName}` : ""}
                {typeof a.meta.import_id === "string" ? (
                  <>
                    {" · "}
                    <Link href={`/app/import/${a.meta.import_id}`} className="text-primary hover:underline">
                      Import report
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
