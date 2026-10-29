# Judged labels

One JSONL file per eval case (list key, with characters outside `A-Za-z0-9._-` turned into `_`). Each line:

```json
{"case": "industries:B-place", "orgId": "<uuid>", "label": 2, "why": "one sentence", "judgedBy": "claude-opus-5-5", "at": "2026-10-26"}
```

2 is a strong lead (has funded this kind of work for this kind of place recently), 1 plausible, 0 not a fit. See ../../IMPROVE.md.
