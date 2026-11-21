# Proposals

[📋 View all proposals and progress](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/proposal-index/proposals/proposal-list.md) · [📖 Contribution guide](../CONTRIBUTING.md)

## Templates

| Template | What to prepare | Where it goes |
| :--- | :--- | :--- |
| [Environment proposal](templates/environment-proposal.md) | App or website, domains, workflows, connections and construction plan | `proposals/environment/<slug>.md` in your PR branch |
| [Task proposal](templates/task-proposal.md) | Domains, user persona, story, personalization insight, rubric, hint, reference solution and construction plan | `proposals/task/<slug>.md` in your PR branch |
| [PR summary](templates/pr-summary.md) | Track, stage, design link, summary and progress | Your PR description |

Replace each `[Fill in: …]` with your answer. Required and optional fields are marked; explain how unresolved decisions will be settled.

## One PR through review and implementation

Review requests are assigned automatically by Track and primary domain, with continuity for repeated proposals from the same author in that domain. Drafts wait for Ready for review. Existing manual assignments are preserved. The [routing policy](../docs/review/reviewer-routing.md) lists the six reviewers, exceptions and workload counts.

DavidZWZ's PRs are owner-managed: no automatic reviewer assignment or external approval is required. The owner may record their own plan and implementation acceptance; evidence and CI requirements remain. Other contributors follow the reviewer process below.

Submit the completed proposal in a PR. An assigned Track reviewer or non-author maintainer posts `/approve-plan <commit-sha>`; the bot records the approved scope and applies `plan-approved`. The PR stays open. Add implementation and evidence against the agreed deliverables to the same PR. Substantial scope changes receive another design review. Only the final validated merge counts as acceptance.

The [proposal list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/proposal-index/proposals/proposal-list.md) updates automatically on the generated `proposal-index` branch, including proposals whose implementation has not merged. Keep your design and progress current in your PR; neither authors nor maintainers need to edit the list. Listing a proposal does not approve it or reserve exclusive scope.

## Where proposals live

Create one completed proposal file in your fork or branch, then open a PR against `main`:

```text
proposals/
├── README.md
├── proposal-list.md             # Stable link to the automatically generated index
├── templates/                   # Reusable blank templates
├── environment/<slug>.md        # Completed Environment proposals
└── task/<slug>.md               # Completed Task proposals
```

Before acceptance, the completed file lives in the PR branch and is accessible from the list. It enters `main` when that PR is finally merged. The `environment/` and `task/` folders therefore appear on `main` with the first accepted proposals. The short `.github/` PR entry links to the templates here.

## Automatic tracking

| Information | Source |
| :--- | :--- |
| Proposal ID, author and submission time | GitHub PR number, author and creation timestamp |
| Track | PR title, checked Track field, or maintainer `track:environment` / `track:task` label |
| Domains and app/task summary | Completed proposal file in the PR branch |
| Review progress | GitHub review requests, approvals and change requests |
| Implementation stage | Lifecycle records and labels: `plan-approved`, `in-progress`, `validation` |
| Acceptance and merge time | GitHub merge state and timestamp |

Preserve template headings and field labels so the index can read your answers. Use the prescribed PR title throughout the contribution. Review approval and `plan-approved` are distinct. Use the [lifecycle commands](../docs/review/proposal-lifecycle.md) after design review. Environment v1 is due 14 calendar days after first approval; deadlines and submissions appear in the live list. Final acceptance requires validation and a maintainer merge.

The sync workflows activate when merged into `main`. PR changes and reviews trigger a refresh; a scheduled run every 15 minutes catches missed events and may be delayed by GitHub. Closed and merged proposals remain in the list. Unchanged data creates no commit.

The workflow uses the repository's built-in `GITHUB_TOKEN` with `contents: write` and `pull-requests: read`; repository Actions policy must permit it to update `proposal-index`. It cannot publish generated content to `main`; the stable entry on `main` links to the live list. It reads proposal text through the API and runs only default-branch code. To retry a failed refresh, use **Actions → Sync proposal list → Run workflow**. For a local preview, run `python3 scripts/sync_proposals.py`; GitHub is only updated with the explicit `--publish` option.
