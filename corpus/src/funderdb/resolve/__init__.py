"""Entity resolution jobs (Phase 2).

Order matters and is enforced by the CLI:
    funds -> people -> recipients
`people` consumes the fund canonical map as org-graph evidence; `recipients`
resolves against canonical orgs. Nothing here ever merges, deletes, or
repoints a row — see migrations/0009_entity_resolution.sql.
"""
