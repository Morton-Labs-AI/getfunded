-- 0010: expression index supporting recipient resolution.
--
-- The apply step joins funding_events to recipient_matches on
-- internal.norm_name(recipient_name). Without this index that is a sequential
-- scan plus 2.32M function evaluations in a single statement — which killed the
-- connection on first attempt (measured 2026-07-27). With it, each matched name
-- is an index lookup and the apply can run in small batches.
--
-- Partial: only grant rows are ever resolved this way (SBIR/Reg D recipients
-- arrive already linked), which keeps the index ~40% smaller.

create index ix_events_recipient_norm
  on internal.funding_events (internal.norm_name(recipient_name))
  where event_type = 'grant';
