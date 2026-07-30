-- Let a user remove a lead from their list for good.
--
-- Soft delete, not a hard one. `lead_assignments` has unique (user_id,
-- company_id), and that constraint is what stops the daily-list engine from
-- handing the same company to the same user twice. A hard DELETE would free the
-- pair and the company would come back on the next morning's list — the exact
-- thing the user was trying to avoid.
--
-- A `deleted_at` column rather than a `lead_status = 'deleted'` enum value:
--   * status is the user's CRM pipeline and is rendered directly as the board's
--     columns. Deletion is orthogonal to it — you can delete a lead that was
--     'contacted' — so folding it into the enum would force a phantom column
--     into the board and lose which pipeline state the lead had.
--   * keeping the timestamp records *when*, which is what an undo would need.
--
-- Engine semantics (see src/lib/leads/daily-list-core.ts): a deleted row still
-- counts towards "already assigned" so the company is never re-handed out, but
-- is excluded from the unworked count and from both trash tiers.

alter table public.lead_assignments
  add column if not exists deleted_at timestamptz;

-- Every read path (board, engine) filters on `deleted_at is null`, so index for
-- that rather than for the deleted rows.
create index if not exists lead_assignments_user_active_not_deleted_idx
  on public.lead_assignments (user_id, list_date desc)
  where deleted_at is null;
