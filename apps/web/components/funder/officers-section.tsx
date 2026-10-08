import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OFFICERS_NOTE, OFFICERS_TITLE } from "@/lib/content/copy";
import type { Officer, Provenance } from "@/lib/queries/corpus/types";

import { ProfileSection } from "./profile-section";
import { SourceWithSeal } from "./provenance";

export function OfficersSection({ officers, provenance, sourceLabel }: { officers: Officer[]; provenance: Provenance | null; sourceLabel: string | null }) {
  if (officers.length === 0) return null;
  return (
    <ProfileSection
      id="officers"
      title={OFFICERS_TITLE}
      aside={provenance && sourceLabel ? <SourceWithSeal label={sourceLabel} p={provenance} /> : undefined}
      note={OFFICERS_NOTE}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="text-right">Hours / week</TableHead>
            <TableHead className="text-right">Compensation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {officers.map((o) => (
            <TableRow key={`${o.objectId}-${o.seq}`}>
              <TableCell className="whitespace-normal font-medium">{o.personName ?? o.businessName ?? <Missing bare />}</TableCell>
              <TableCell className="whitespace-normal text-ink-2">{o.title ?? <Missing bare />}</TableCell>
              <TableCell className="tnum text-right text-ink-3">{o.hoursPerWeek ?? <Missing bare />}</TableCell>
              <TableCell className="text-right">
                <Money value={o.compensation} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ProfileSection>
  );
}
