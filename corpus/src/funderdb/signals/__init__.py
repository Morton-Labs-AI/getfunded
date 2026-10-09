"""Funder signals — dated, sourced news about a funder (migration 0035).

Pipeline (each step is a `funderdb signals ...` command and is re-entrant):

  load-sources   data/seed/signal_sources.csv  -> internal.signal_sources
  add            a URL (+ EIN)                  -> a 'candidate' row
  poll           every due source               -> new 'candidate' rows
  process        candidates without extraction  -> fetched, snapshotted, classified, org-linked
  publish        candidate -> published (human decision, or --auto above a confidence floor)
  status         counts and the last runs

Doctrine lives in migrations/0032_funder_signals.sql and docs/FUNDER-SIGNALS.md.
"""
