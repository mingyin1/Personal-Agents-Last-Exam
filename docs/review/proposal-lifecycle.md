# Proposal approval, delivery and merge

One PR carries the proposal, implementation and validation through to final acceptance. Design approval allows implementation to begin; it never merges the proposal.

**Owner-managed changes:** DavidZWZ may review, approve and accept their own or coauthored changes without another reviewer, including maintainer integrations of another contributor's PR. Their own PRs do not receive automatic reviewer requests. The exception is bound to GitHub account ID `57624585` and the current Write-or-higher permission in the trusted default-branch policy; mentions, labels and commit author names do not grant it. Commit-bound lifecycle records, implementation evidence, required CI and manual merge still apply. The non-author requirements below apply to everyone else.

## Reviewer workflow

1. Review the proposal in **Files changed**. Submit comments or **Request changes**, and let the author revise it in the same PR.
2. When the plan is sound, post `/approve-plan <commit-sha>` as a new PR conversation comment. Use the full current 40-character commit SHA from the PR's **Commits** tab. This binds approval to the exact proposal you reviewed and prevents a delayed command from approving a different commit.
3. The bot records the reviewer, approval time, approved commit and proposal content, then adds `plan-approved`. The PR stays open. GitHub's **Approve** button alone does not advance the plan stage.
4. The author implements the agreed scope in the same PR and supplies runnable code, tests and evidence. Final implementation approval is separate from design approval.
5. A maintainer verifies the implementation, records acceptance for the current commit, submits the final GitHub approval, and manually merges once all required checks pass.

An assigned reviewer must be a repository collaborator and appear in the Track roster in [review-policy.json](../../.github/review-policy.json). GitHub review-request history preserves the assignment after a review is submitted. Maintainers with Write, Maintain or Admin access can also approve plans. Except for DavidZWZ's owner-managed changes above, PR authors and declared coauthors cannot approve their own plans or accept their own implementations.

## Commands

Post one command per new conversation comment, outside code fences or quotations. Editing an old comment does not execute it again. Correct a rejected command by posting a new comment.

| Command | Who can use it | Result |
| :--- | :--- | :--- |
| `/approve-plan <commit-sha>` | Assigned Track reviewer or non-author maintainer | Records the reviewed scope, adds `plan-approved`, keeps the PR open |
| `/start-implementation` | Author, assigned reviewer or maintainer | Adds `in-progress`; requires a valid approved plan |
| `/submit-implementation <commit-sha> <https-evidence-url>` | Author, assigned reviewer or maintainer | Records implementation and evidence for this commit; adds `validation` |
| `/accept-implementation <commit-sha> <https-evidence-url>` | Non-author maintainer with Write or higher access | Records final validation for this commit; does not merge |
| `/extend-deadline YYYY-MM-DD <reason>` | Non-author maintainer with Write or higher access | Extends the Environment deadline to the end of that UTC date and records why |
| `/revoke-plan <reason>` | Assigned Track reviewer or non-author maintainer | Removes design and implementation approval; keeps the PR and delivery history |

Evidence should link to the reproducible run report, logs or validation attachments, including the commands and versions used. An HTTPS link is an index to evidence, not proof that its content is correct; reviewers must inspect and reproduce the relevant results.

Changing the approved proposal file requires another design review. Keep routine progress and implementation links in PR comments or the PR description so they do not silently alter the approved scope. Reapproval does not reset the original delivery deadline. Any new commit invalidates final implementation acceptance, so submit and accept the new commit before merging.

Commands normally run after the comment event. GitHub can coalesce queued runs; hourly reconciliation also recovers unprocessed commands and updates deadlines. Maintainers can use **Actions → Proposal lifecycle → Run workflow** to reconcile immediately. Replaying a processed command does not create another approval or reset dates.

## Environment first-version deadline

**Submit the first runnable version within 14 calendar days of the first plan approval.** The bot records the exact deadline in UTC in the PR and in the [live proposal list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/proposal-index/proposals/proposal-list.md). This is a submission deadline, not a requirement to complete review or merge within two weeks. Task Track does not receive this deadline automatically.

The first version should include:

- A runnable App under `apps/<slug>/` with local setup and start instructions.
- The core workflows agreed in the proposal, representative fixtures, and reset behavior.
- Tests for the key state changes and permissions, plus reproducible validation evidence.
- An explicit list of incomplete integrations or other remaining work.

Use `/submit-implementation` to record delivery. The bot checks that implementation files and an evidence link are present; the reviewer determines whether the version is actually runnable and meets the agreed scope. The list says **subject to review**, and a submission does not count as an accepted contribution or unlock merge.

When no first version has been submitted by the deadline, the bot adds `v1-overdue` and updates the PR progress record. It does not automatically close the PR, reassign credit, or accept an incomplete version. Authors should report blockers before the deadline; a maintainer may grant an extension with `/extend-deadline` and a reason. Dependencies and scope changes do not silently restart the clock. Plan approval still does not reserve exclusive ownership.

## Merge protection

The `contribution-ready` check is supplied by the trusted default-branch lifecycle workflow. Labels and ordinary comments cannot make it pass. For an Environment or Task contribution, it requires:

1. Exactly one completed proposal and a recorded approval matching its current content.
2. Implementation changes under `apps/` for Environment or `tasks/` for Task, rather than only a proposal, screenshots or documentation.
3. An implementation submission and maintainer acceptance for the exact current commit, each linked to evidence. Acceptance must be non-author except for the explicit DavidZWZ owner exception.
4. For Environment contributions, successful `public-runtime (18)`, `public-runtime (22)` and `base-runtime-compatibility` checks for that commit. Missing, failed, skipped or stale checks do not pass. Task validation currently requires maintainer review of the task's submitted harness results; this gate does not claim to run a universal Task evaluator.

Repository maintenance PRs that do not change contribution packages do not require a proposal, but still require normal branch review. Deleting a proposal, renaming its title, adding labels or using the same commit in another PR cannot turn an incomplete contribution into an accepted one.

Edits to existing worked examples explicitly listed in the default branch's `documentation_examples` policy are documentation maintenance, not accepted Task contributions. This exception applies only to modifications of those exact files. New proposals, additions, deletions, renames, App/Task implementation changes, an explicit contribution Track, or an existing contribution lifecycle record still trigger the contribution gate. A policy change in the PR itself cannot grant an exception. The final merge policy below still applies.

`main` also requires an up-to-date branch, a final approving review from a person with Write or higher access, dismissal of stale approvals, approval of the most recent reviewable push, and resolved review conversations. These requirements apply to administrators as well, with one explicit exception: repository owner **DavidZWZ** may complete final merges without a second review and use the owner-managed lifecycle route above. Required status checks, the contribution lifecycle gate, branch freshness, and conversation resolution remain enforced; proposal approval alone still does not permit merge. Auto-merge is disabled. Read-role reviewers can contribute scientific review, while a qualified maintainer provides the final branch-protection approval and merge.

The bot never calls the merge endpoint and never executes contributor code with its write token. Its state is stored in an authenticated GitHub Actions comment. The automatically generated index is published to `proposal-index`, so index updates need no exception to `main` protection.
