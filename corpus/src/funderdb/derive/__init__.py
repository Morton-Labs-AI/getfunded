"""Derived facts: counts computed from rows that are already in the database.

Nothing here downloads a file or calls a model. Each job writes a run
manifest (the rule in plain words), registers it in ``internal.raw_files``
like every other input, and records the run in the ledger, so a derived row
has the same provenance chain as a parsed one.

A derived count is a count. No job in this package may write a score, a
tier, a label or an eligibility field (AGENTS.md rule 6).
"""
