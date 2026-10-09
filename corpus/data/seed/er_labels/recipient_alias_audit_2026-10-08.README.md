# Recipient alias audit, 2026-10-08

A random sample of 300 would-be links of the strict class (`resolve aliases --sample 300 --seed 20261008`),
judged before any link was applied.

**Who labelled it.** Language-model agents, not people: two independent labellers for each pair (one asked
"is this the same legal body or a part of it", the other tried first to name a different organisation it
could be), and a third reader for the pairs they disagreed on. Web search was allowed. No person has
labelled these pairs. Treat the result as a screen, not as a certified precision gate.

**Result.** 300 pairs: 292 same organisation, 8 affiliate (a named part of the linked organisation, or
carried by it), 0 different, 0 unclear. The two labellers agreed on 298 of 300 before adjudication.
Share not wrong: 100%. Wilson lower bound at 95%: 98.7%.

**Gate used.** Apply the strict class only if the Wilson lower bound is at least 95%. It passed.

**Labels.** `same`, `affiliate`, `different`, `unclear`. The page copy for a link says the charities "wrote
this name with its EIN"; it does not say the two are the same organisation, which is why `affiliate`
counts as not wrong.

Columns of the CSV: sample number, grant row id, the recipient as filed (name, city, state), the linked
registry record (name, city, state, EIN), how many charities named it, the label, who decided, the two
first-pass labels, and a one-sentence reason.
