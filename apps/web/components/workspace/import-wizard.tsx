"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatEin } from "@/lib/format";
import { runImportAction } from "@/lib/workspace/actions";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import { IMPORT_MAX_ROWS, guessColumns, parseRows, type ImportColumns, type ImportRow } from "@/lib/workspace/import-match";

import { NativeSelect } from "./native-select";

type Parsed = { filename: string; headers: string[]; records: Record<string, string>[] };

/**
 * CSV import in three steps, all before anything is written:
 *  1. pick a file (parsed in the browser with papaparse; nothing uploads yet),
 *  2. confirm which columns hold the name, the EIN and the notes,
 *  3. review the first rows and start the import.
 * The server matches and writes, then sends the person to the report.
 */
export function ImportWizard() {
  const router = useRouter();
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [columns, setColumns] = React.useState<ImportColumns>({ name: null, ein: null, notes: null });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const fileId = React.useId();

  function onFile(file: File | undefined) {
    setError(null);
    setParsed(null);
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("That file is larger than 2 MB. Split it into smaller files.");
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
        if (headers.length === 0 || result.data.length === 0) {
          setError("We could not find a header row and data rows in that file.");
          return;
        }
        setParsed({ filename: file.name, headers, records: result.data });
        setColumns(guessColumns(headers));
      },
      error: () => setError("That file could not be read as a CSV."),
    });
  }

  const rows: ImportRow[] = React.useMemo(() => (parsed ? parseRows(parsed.records, columns) : []), [parsed, columns]);
  const usable = rows.filter((r) => r.name || r.ein);
  const tooMany = rows.length > IMPORT_MAX_ROWS;

  function start() {
    if (!parsed) return;
    startTransition(async () => {
      const result = await runImportAction({ filename: parsed.filename, rows: rows.slice(0, IMPORT_MAX_ROWS) });
      if (!result.ok) {
        toast.error("The import did not run", { description: result.message });
        return;
      }
      toast.success(`Added ${result.added} of ${result.total} rows`, { description: "The report lists every row." });
      router.push(`/app/import/${result.importId}`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border bg-card p-4 shadow-card">
        <h2 className="text-sm font-semibold text-foreground">1. Choose a CSV file</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">
          {WORKSPACE_COPY.import.columnsHint} Up to {IMPORT_MAX_ROWS} rows per file. Nothing is saved until you press Start.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Label htmlFor={fileId} className="sr-only">
            CSV file
          </Label>
          <input
            id={fileId}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block w-full max-w-md text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-input file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
          />
          {parsed ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
              <FileSpreadsheet className="size-4 text-ink-3" aria-hidden />
              {parsed.filename} · <span className="tnum">{parsed.records.length} rows</span>
            </span>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mt-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </section>

      {parsed ? (
        <section className="rounded-lg border bg-card p-4 shadow-card">
          <h2 className="text-sm font-semibold text-foreground">2. Confirm the columns</h2>
          <p className="mt-1 text-xs leading-5 text-ink-3">We guessed from the headers. Change any that are wrong. A name or an EIN is enough; both is best.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(["name", "ein", "notes"] as const).map((field) => (
              <div key={field} className="flex flex-col gap-1.5">
                <Label htmlFor={`${fileId}-${field}`}>{field === "ein" ? "EIN" : field === "name" ? "Organization name" : "Notes"}</Label>
                <NativeSelect
                  id={`${fileId}-${field}`}
                  size="default"
                  value={columns[field] ?? ""}
                  onChange={(e) => setColumns((c) => ({ ...c, [field]: e.target.value || null }))}
                >
                  <option value="">Not in this file</option>
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {parsed ? (
        <section className="rounded-lg border bg-card p-4 shadow-card">
          <h2 className="text-sm font-semibold text-foreground">3. Check the first rows, then start</h2>
          <p className="mt-1 text-xs leading-5 text-ink-3">
            <span className="tnum">{usable.length}</span> of <span className="tnum">{rows.length}</span> rows have a name or an EIN.
            {tooMany ? ` Only the first ${IMPORT_MAX_ROWS} rows will be imported; split the rest into another file.` : ""}
          </p>
          <div className="mt-3 rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Row</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>EIN</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 6).map((r) => (
                  <TableRow key={r.rowNumber}>
                    <TableCell className="tnum text-ink-3">{r.rowNumber}</TableCell>
                    <TableCell className="max-w-[18rem] truncate">{r.name ?? <span className="text-ink-4">blank</span>}</TableCell>
                    <TableCell className="tnum font-mono">{r.ein ? formatEin(r.ein) : <span className="font-sans text-ink-4">blank</span>}</TableCell>
                    <TableCell className="max-w-[18rem] truncate text-ink-2">{r.notes ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink-3">Rows that match exactly one organization join your list. Everything else is listed in the report for you to decide.</p>
            <Button onClick={start} disabled={pending || usable.length === 0 || (!columns.name && !columns.ein)}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              {pending ? "Matching…" : `Start import (${Math.min(usable.length, IMPORT_MAX_ROWS)} rows)`}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
