# Contributing to Personal Agents' Last Exam

**Proposal PRs are open now.** Choose Environment Track or Task Track. Keep the concept concise and provide a construction plan with scope, deliverables, quality checks, dependencies and estimated effort. The approved proposal is the baseline for implementation review and merge in the same PR. Code and run evidence follow approval; the first infrastructure release will provide implementation interfaces and run instructions.

## Start with a proposal

1. Check the [proposal list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/proposal-index/proposals/proposal-list.md) for related work, then copy the [Environment proposal template](proposals/templates/environment-proposal.md) or [Task proposal template](proposals/templates/task-proposal.md).
2. Replace the `[Fill in: …]` placeholders, then add the completed design to `proposals/environment/<slug>.md` or `proposals/task/<slug>.md` in your fork. Follow the required/optional labels; explain how any `TBD` decisions will be resolved.
3. Open a PR against `main`. Use the [PR summary template](proposals/templates/pr-summary.md) to describe the track, stage and proposal, and link the design file. Keep it Draft while writing; mark it Ready for review when ready. A reviewer is assigned automatically by Track and primary domain, preserving same-author continuity and existing manual assignments. See the [reviewer routing policy](docs/review/reviewer-routing.md).

### 🏷️ Proposal naming

| Track | Title format | Example |
| :--- | :--- | :--- |
| Environment | `[Environment Proposal] [<Domain>] <App or website name>` | `[Environment Proposal] [Work & business] Google Calendar` |
| Task | `[Task Proposal] [<Domain>] <Short task title>` | `[Task Proposal] [Travel & commuting + Money & insurance] Rebook a flight within the updated budget` |

Both tracks use the exact names in the [domain list](#environment-domains). Choose one primary domain for the main workflow and optional secondary domains for other workflows covered. List the primary domain first in the PR title; join secondary domains with ` + `.

## Review and implementation

> 📝 **Proposal PR** → 🔍 **Design review** → ✅ **Plan approved** → 🛠️ **Implement in the same PR** → 🧪 **Validate & merge**

**Owner-managed work:** DavidZWZ can review, approve and accept their own changes, including maintainer integrations, without another reviewer. Their PRs are not automatically assigned to the reviewer pools. Implementation evidence, commit-bound acceptance and required CI still apply. The non-author review requirements below apply to other contributors. See the [owner exception](docs/review/proposal-lifecycle.md).

- **Design review:** reviewers comment; the author revises. An assigned Track reviewer or non-author maintainer posts `/approve-plan <commit-sha>` using the full current commit SHA. The bot records the approved scope and commit and adds `plan-approved`. The PR stays open; this does not merge the proposal.
- **Implementation:** once the infrastructure is available, add code and evidence to the same PR. Request a design re-review for substantial scope changes.
- **Acceptance:** link implementation and verification evidence to each planned deliverable. Reviewers compare it with the approved scope, check outcomes and reproduce key results. Only the final validated merge counts as an accepted contribution.

**Environment v1 is due within 14 calendar days of the first plan approval.** Submit a runnable core implementation, fixtures/reset behavior, tests and reproduction evidence in the same PR. This is the first-version submission deadline, not the merge deadline. The bot records the UTC due date and flags overdue submissions; a maintainer can extend it with a reason. Task Track does not receive this deadline automatically.

Use `/start-implementation`, then `/submit-implementation <commit-sha> <https-evidence-url>`. A non-author maintainer records final validation with `/accept-implementation <commit-sha> <https-evidence-url>` before final GitHub approval and manual merge. See [lifecycle commands, deadlines and merge protection](docs/review/proposal-lifecycle.md). GitHub **Approve** alone does not approve a plan, and `plan-approved` alone does not satisfy the merge gate.

Approval does not reserve exclusive ownership. Link overlapping proposals; parallel work is allowed. Once related work merges, later submissions are assessed for additional value. Record when a PR is ready for final review; the merge timestamp records acceptance.

## Tracking proposals

Use the **PR number and URL** as the proposal reference. Lifecycle commands maintain stage labels; maintainers manage Track labels. Contributors fill the template and keep implementation evidence in the same PR.

The [proposal list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/proposal-index/proposals/proposal-list.md) automatically groups Environment and Task PRs with submission time, domains, track-specific summary, author, review progress and merge time. GitHub Actions reads each PR and its completed proposal file, including proposals that have not merged. Keep one proposal file per PR and preserve the template's field labels. No manual list updates are needed; an index update does not count as plan approval or contribution acceptance. See [automatic tracking](proposals/README.md#automatic-tracking).

| What | How to track it |
| :--- | :--- |
| Proposal | PR number, such as `#42` (illustrative) |
| Track | `track:environment` or `track:task` |
| Progress | `proposal` → `plan-approved` → `in-progress` → `validation`; merge records acceptance |
| Dependencies | Link related PRs and note whether they are available or blocking |
| Delivered artifact | A stable environment/task slug and version, confirmed before merge |

For example, Task proposal `#57` can depend on Environment proposal `#42`. These are examples, not existing PRs. The PR number tracks the contribution; the slug identifies the reusable environment or task. One proposal should have a clear scope; PR count alone does not determine contribution credit.

## 🏗️ Environment Track

The [App delivery guide](docs/app-contribution.md) and [public Core / Messaging runtime](runtime/README.md) provide reproducible local business and integration checks. Consult [existing App interfaces](docs/app-integrations.md) before building cross-App connections. Use the separate [proposal review](docs/review/environment-proposal.md) and [implementation review](docs/review/app-implementation.md) criteria; local runtime success does not replace maintainer acceptance or deployment-specific checks.

Propose a website or app you would like to build and the main workflows it could support. Choose one primary domain and any relevant secondary domains from the list below. Use these exact names in the proposal and PR title.

<a name="environment-domains"></a>

### Environment domains

<table>
<tr><td>💳 <strong>Money &amp; insurance</strong></td><td>🛍️ <strong>Shopping &amp; groceries</strong></td><td>✈️ <strong>Travel &amp; commuting</strong></td></tr>
<tr><td>🩺 <strong>Health &amp; care</strong></td><td>🍽️ <strong>Food &amp; dining</strong></td><td>💬 <strong>Social &amp; communities</strong></td></tr>
<tr><td>🏠 <strong>Home &amp; utilities</strong></td><td>🏛️ <strong>Public service &amp; law</strong></td><td>🎬 <strong>Media &amp; entertainment</strong></td></tr>
<tr><td>📚 <strong>Learning &amp; research</strong></td><td>💼 <strong>Work &amp; business</strong></td><td>📰 <strong>News &amp; information</strong></td></tr>
<tr><td>🌤️ <strong>Weather &amp; outdoors</strong></td><td>🎮 <strong>Games &amp; play</strong></td><td>🏃 <strong>Fitness &amp; wellbeing</strong></td></tr>
</table>

For shared personal apps or device interfaces, select domains by the proposed workflows and explain their cross-domain role. Connecting to an app does not by itself add a secondary domain. Link new-domain suggestions for maintainer discussion rather than introducing a new label silently.


- **App and scope:** the reference product, main workflows and value for personal-agent tasks.
- **Potential connections:** relationships with internal personal apps such as Mail, Calendar or Contacts, and with other apps or websites. Briefly explain the information they could exchange.
- **Construction plan and effort:** web/app construction, data and image acquisition or crawling, synthetic data/assets, app integration and validation/reset. For each applicable workstream, describe the method, planned scale, deliverable, quality check and effort in person-days. Mark reused components and record source/reuse information for collected assets.

Include milestone order, responsible contributors, expected calendar duration, dependencies and resource costs. Separate initial scope from future connections. Estimates may be ranges; explain how unresolved details will be settled.

After plan approval, develop the concrete interfaces and implementation details. Final review checks complete workflows, permissions, state consistency, reset behavior, and integration evidence.

For a proposed App package layout, locally testable Mail/Calendar examples and delivery instructions, see the [App contribution guide](docs/app-contribution.md).

“Complete” means each declared workflow operates end to end, including modification, cancellation, confirmations, and realistic errors where relevant. It does not mean recreating every feature of the reference product.

## 🧪 Task Track

Start with a realistic user situation and a clear personalization idea. The proposal should help reviewers understand the person, the story and what makes the task interesting.

- **Domains:** one primary domain and optional secondary domains from the same [domain list](#environment-domains).
- **User persona and prior history:** the background, preferences and experiences that matter to the task.
- **Story outline:** what the user wants, what happens or changes, and what a good outcome looks like. Include a rough time span only if relevant.
- **What makes this distinct and personal:** the central challenge or insight, why the person's context changes the right action, and what a generic assistant might miss.
- **Rubric, hint and reference solution:** forbidden and expected rubric items with their evidence and checks, the full-pass rule, the exact hint text, and one reference timeline that earns a full score.
- **Construction plan and effort:** persona/history/workspace construction, user rollout and scenario scripting, environment integration, rubrics/reference/hints, and agent rollouts with analysis. For each workstream, specify planned coverage, deliverables, quality checks and effort in person-days, plus owners, dependencies, milestone order and expected resources.

After plan approval, task authors develop the executable scenario, precise timeline, context, grader and replayable reference solution from the approved rubric. Authors then run the required model evaluations themselves and submit traces, scores, configurations, hint-assisted results and failure analysis for implementation review.

The user rollout describes planned user interactions, responses and branches across the story. Specify the **number of sessions**, **simulated world time span**, and **estimated total tokens for one complete scenario across all sessions**, including the token estimate's scope (dialogue, prior context, tool outputs, etc.). The scenario script implements user behavior and world events. An agent rollout is an actual model execution against the script. Plan the work for both; allow multiple valid agent strategies.

## Proposal review and implementation review

**Proposal review asks:** Are the domains and idea clear? For environments, are the main workflows and potential app relationships useful? For tasks, are the persona, story and personalization insight compelling? Does the construction plan define reviewable deliverables, quality checks, realistic effort and dependencies? Are scope boundaries and open decisions explicit?

**Implementation review asks:** Does the delivered environment or task match the approved design? Do resets and reference solutions work? Are graders valid, traces reproducible, and alternative solutions handled correctly?

## Acceptance criteria

These criteria apply to completed implementations.

- **Meaningful difficulty:** the challenge comes from reasoning, context, coordination, or execution, rather than broken tools or undiscoverable requirements.
- **Reproducibility:** record dependencies, seeds or event schedules, resource limits, reset behavior, and trial artifacts. External dependencies need a documented replay or controlled evaluation strategy.
- **Valid grading:** demonstrate that a reference solution passes, doing nothing fails, and representative incorrect or partial outcomes are handled correctly. Keep private evaluation artifacts outside the agent's accessible context.
- **Independent evidence:** include a fresh-environment reproduction and agent trials with a concise failure analysis. Reviewers should be able to reproduce the claim.
- **Integrity and maintenance:** disclose provenance and collaborators, respect data permissions, respond to feedback, and maintain accepted work.

<a name="task-difficulty-and-validation"></a>

## 🧪 Task difficulty and validation

Evaluate the **designated SOTA models from GPT, Claude, and Gemini at the time of evaluation**, each **as a personal agent**, with the task's tools, user context, memory, and permissions. Maintainers will specify the exact model from each family in a dated, versioned evaluation roster. For implementation review, submit **at least 1 independent unhinted rollout per designated model**. We recommend **5 rollouts per model**; complete five-rollout evidence receives higher review priority and can speed up verification. All three models must independently meet the qualification thresholds. Initial proposal PRs describe planned runs, required effort and expected evidence; completed runs follow plan approval.

Record each model's exact identifier/version, evaluation date, agent configuration, reasoning settings, and resource budget. Freeze the designated roster for the validation batch rather than using a moving model alias. The first infrastructure release will publish the initial roster; later evaluation rounds will specify updated SOTA models.

| Qualification | Independent unhinted rollouts | Full-task pass rate | Mean normalized rubric score | Hint-assisted validation |
| :--- | :--- | :--- | :--- | :--- |
| Accepted task | **At least 1; 5 recommended** per model | **0/n** | **Below 50%** | **100% rubric score and all success gates passed** |
| Flagship task | **At least 1; 5 recommended** per model | **0/n** | **Below 30%** | **100% rubric score and all success gates passed** |

**Scoring:** normalize each rollout's total earned rubric points to a percentage of available points, then average the percentages across all submitted valid unhinted rollouts for that model. Report the actual count `n` and observed pass rate `0/n`; a single failed rollout is `0/1`, not `0/5`. Apply the thresholds separately to each reference model; do not pool models to hide a stronger result. Full-task success is a separate outcome defined by the approved rubric and required gates. Both the failure-rate and score requirements must hold. Exactly 50% or 30% does not meet the respective strict cutoff.

**Run protocol:** freeze the task, rubric, model configuration, and resource budget before the independent fresh-state rollouts. Submit every trace and score, with seeds, tool versions, costs, and failure analysis. Do not select only unsuccessful runs. If the design changes, repeat the complete validation batch. Infrastructure faults do not establish task difficulty.

**Hint-assisted feasibility:** submit a separate run with a fixed, documented hint that directs attention to the decisive personal context or reasoning step. The agent must reach 100% and pass every success gate under the same task and budget. Record the hint and trace for each reference model. Hints must not expose grader internals or simply provide the final answer; hinted results do not count toward the unhinted rollout count.

These are proposed qualification thresholds for Personal Agents' Last Exam. They complement review of realism, novelty, grader quality, and reproducibility. Develop the validation details after plan approval; completed runs are required at implementation review.

## Authorship and credit

### Co-authorship bar for the first research paper

Our **co-authorship bar** is **3 distinct accepted tasks** or **3 distinct accepted environments**:

- **Task route:** at least **3 distinct accepted tasks**, each meeting the minimum rollout, below-50% rubric-score, and hint-assisted full-score requirements above. Cosmetic variations do not count as separate tasks.
- **Environment route:** at least **3 distinct accepted environments**, each delivering complete approved workflows, documented interfaces, reproducible evaluation support, and independent validation. Cosmetic variations do not count as separate environments.

These routes establish eligibility for authorship review. They also require substantive participation in analysis or manuscript drafting/revision, approval of the final manuscript, accountability for the contribution, and maintenance through release and submission.
