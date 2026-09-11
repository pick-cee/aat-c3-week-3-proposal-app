-- Deleting a draft.
--
-- `proposals` had read, insert and update policies but no DELETE policy. Under
-- RLS a missing policy DENIES the operation — and PostgREST reports that denial
-- as a successful statement affecting zero rows. So `deleteDraft` and
-- `discardIfEmpty` both returned without error and left the row exactly where
-- it was: the worst possible failure mode, because the code looked correct and
-- the UI reported success.
--
-- The same shape of bug as the missing `deliveries` insert policy: a read
-- policy without its matching write policy denies by default, and the denial is
-- silent.

-- Author-scoped, mirroring `proposals_update_own`, but narrowed to the two
-- statuses where the work is still only the salesperson's own.
--
-- The API checks this too. Both are wanted, and they are not redundant: the API
-- can EXPLAIN the refusal ("this has been submitted, so it is part of a record
-- someone else has acted on"), which a policy cannot, while the policy
-- guarantees that no code path — present or future, including one that forgets
-- the guard — can delete an approved or sent proposal.
create policy proposals_delete_own_draft on proposals
  for delete to authenticated
  using (
    author_id = auth.uid()
    and status in ('draft', 'changes_requested')
  );

comment on policy proposals_delete_own_draft on proposals is
  'A salesperson may delete only their own unsubmitted work. Once submitted, an approver has read it or a client has been sent it, and the record is not theirs alone to remove.';

-- ---------------------------------------------------------------------------
-- The rows that hang off a deleted proposal
-- ---------------------------------------------------------------------------
-- `proposal_sections`, `supporting_materials` and `activity_log` cascade from
-- `proposals`, so they need no policy of their own: the cascade runs as the
-- system, not as the caller.
--
-- `approvals` does NOT cascade — it is a permanent record, deliberately — so a
-- `changes_requested` draft carries an approval row that would block the
-- delete with a foreign key violation. `deleteDraft` removes it explicitly
-- first, which needs a policy.
--
-- Scoped to approvals belonging to the caller's own deletable drafts: an
-- approver must never be able to delete a decision, and a salesperson must
-- never be able to erase one on a proposal that has left their hands.
create policy approvals_delete_with_own_draft on approvals
  for delete to authenticated
  using (
    exists (
      select 1 from proposals p
      where p.id = approvals.proposal_id
        and p.author_id = auth.uid()
        and p.status in ('draft', 'changes_requested')
    )
  );

comment on policy approvals_delete_with_own_draft on approvals is
  'Only as part of deleting the draft the decision belongs to. A decision on a live proposal is permanent.';
