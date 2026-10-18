# Recoverable file archive

This folder is reserved for files explicitly removed from their active location
as part of authorized work. No files were removed or moved here when this folder
was created on October 18, 2026.

Preserve each file under `<UTC timestamp>/<original repository-relative path>`.
Never overwrite an existing archive. Append an entry to the private
`manifest.jsonl` containing the original path, archived path, SHA-256, timestamp
and reason. Preserve an existing destination during restoration too; resolve a
collision before restoring. Do not automatically expire or clean up this folder.

Archived payloads and the manifest are ignored by Git, because removed files may
contain credentials, publisher material or private research. The local archive
is recoverable storage, not an off-device backup. Keep secrets and raw research
out of commits.

Database rows cannot be restored by moving files here. The funder campaign
retains database records and source snapshots. For future candidate changes,
save exact selected rows as private before-images under the campaign directory,
then use the existing candidate path with explicit ID and expected-state guards.
Do not delete rows, drop objects, mark human review, or publish automatically.

The SQL-warning audit for the October 18 continuation found eight updates to
existing candidate rows, all with `WHERE` conditions, and no `DROP`, `DELETE` or
`TRUNCATE` statements. Those eight rows remain present and unpublished. The
initial procedural request expired; guarded updates were subsequently completed
and read back through the existing Supabase connection.
