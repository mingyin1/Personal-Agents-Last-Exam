# Environment proposal checklist · agent version

Follows the 8 review dimensions of the [proposal review guide](../environment-proposal.md), with 3 checks each. Every check ends in one of four verdicts.

## How to use this file

Run it on one proposal PR. Give your agent (Claude Code, Codex or similar, with `gh` available) this prompt:

> Read `docs/review/environment-proposal-checklist/agent.en.md`. Review PR #<number> of MatrAIx-ai/Personal-Agents-Last-Exam against it. Get the title, description, comments and file list with `gh pr view <number> --repo MatrAIx-ai/Personal-Agents-Last-Exam --json title,body,comments,files,headRefOid`, and read the proposal file with `gh api "repos/MatrAIx-ai/Personal-Agents-Last-Exam/contents/<path>?ref=refs/pull/<number>/head" -H "Accept: application/vnd.github.raw"`. Follow the steps, then output the workflow traces, the verdict table and the recommendation. Do not post anything on GitHub.

The reviewer then works through `human.en.md` (or `human.zh-Hans.md`). These checks follow the [proposal review guide](../environment-proposal.md), the [contribution process](../../../CONTRIBUTING.md#review-and-implementation) and the [runtime extension boundaries](../../environment-architecture.md). Record the revision of these guides with each review. They are a draft and have not yet been validated against reviewed proposals.

## How to run

1. **Baseline.** Read the proposal file, the PR description and comments, related proposals and the current template. Record the PR number, head commit, date and scope.
2. **Can the bot read it?** Check what `scripts/sync_proposals.py` reads: the PR title format, exactly one file at `proposals/environment/<slug>.md`, unchanged headings and field labels, no `[Fill in: …]`, and an exact primary domain. If the proposal cannot be read, stop with “insufficient evidence”.
3. **Trace core workflows and dependencies.** For each core workflow write one line: precondition → action or event → expected business outcome → a failure or control example. Follow the guide's [dependency verification steps](../environment-proposal.md#verify-the-dependency-not-only-its-name): list every required/optional personal App, including separate Agent tool use, then other App connections. Open the actual versioned interfaces, distinguish implementations from proposals, and record capability gaps, owners and fallbacks. Check supplied examples against existing receiver schemas when feasible; record what was checked versus what remains a plan.
4. **Judge D1–D8.** Give each of the 24 checks one verdict and quote the proposal.
5. **Write the report.** Header, workflow traces, dependency evidence table, the 24-row table, findings grouped as design gaps, clarifications and optional improvements, the Human judge list and the recommendation. Include the receiver/runtime revision and any example-validation results; do not describe schema checks as completed App integration tests.
6. **Hand to the user.** Do not post comments or push. The user decides what happens next.

## Verdicts

- **✓ Approve**: The proposal meets the check; quote the line that shows it.
- **◐ Partial approve**: A clarification or platform decision is needed. Name the consequence, the owner and the smallest useful clarification.
- **? Human judge**: The call needs a person: value, realism, licensing or a platform choice. Give the evidence on both sides.
- **✗ Reject**: A design gap: core behavior cannot complete, authority contradicts the requirements, or an essential dependency has no feasible path. Ask for a specific change.

## Rules

- Quote the proposal as path:line for every verdict.
- A missing platform capability is a dependency, not the author’s defect: use Partial approve or Human judge, not Reject.
- The author’s own open questions are open decisions, not omissions. Missing detail alone does not prove an unsafe design; request clarification and reserve Reject for an evidenced design gap.
- Notify authors of overlapping proposals and link them. Approval is non-exclusive; parallel implementation is allowed. Only validated merge counts as acceptance.
- The lightweight reference host is one runtime profile, not the universal limit for Web/CUA or larger-data proposals. Record any required adapter and owner.
- Do not invent numeric thresholds, apply Task difficulty gates, or require token policies, TLS, log retention or completed tests.
- Ideas outside the first version are optional improvements; do not widen acceptance.

## Recommendation

- Needs design changes: at least one Reject.
- Insufficient evidence: the proposal cannot be read, or most checks have no evidence either way.
- Ready for scope approval: no Reject; list all remaining clarifications and Human judge items. The maintainer resolves scope-blocking decisions before recording approval.
- The recommendation does not approve or merge. A maintainer records the approved scope.

## Output example

Fictional Ternway Air proposal.

### Workflow traces

| Workflow | Precondition | Action or event | Expected outcome | Failure or control |
| :--- | :--- | :--- | :--- | :--- |
| Rebook | A segment is cancelled | The traveler picks another flight | The booking moves to the new flight and the fare difference is charged once | No seat on the new flight: the booking is unchanged and an error is returned |

### Verdict table

| ID | Verdict | Evidence (path:line) | Requested change |
| :--- | :--- | :--- | :--- |
| D2.2 | ✓ Approve | `proposals/environment/ternway-air.md:14` “A cancelled segment can be rebooked onto another flight; the fare difference is charged.” | — |
| D4.2 | ◐ Partial approve | `proposals/environment/ternway-air.md:41` “Changes are confirmed by the agent.” | Clarify how retries avoid duplicate charges and how stale writes are detected. The reference runtime provides `request_id` and `expected_version`; equivalent adapter guarantees need review. |
| D5.3 | ? Human judge | `proposals/environment/ternway-air.md:37` “A rebooking updates the traveler’s calendar.” | Calendar has no messaging receiver yet. Either the agent updates Calendar with its tools, or the platform adds a receiver. The reviewer decides. |

Recommendation: ready for scope approval after the maintainer resolves the retry clarification (D4.2) and platform decision (D5.3). Neither missing detail nor an unavailable platform receiver is itself a Reject.

## The 8 review dimensions

### D1 · Usefulness and reuse (§2)

Guide: “An App should expose reusable behavior rather than encode one task’s answer. Overlap alone does not reserve ownership.”

#### D1.1 · Intended workflows and their value

- **What to check:** §2 names the intended workflows and why they matter for personal-agent tasks.
- **Look at:** §2.
- **✓ Approve:** Workflows are named, and the value is tied to the person (their history, preferences, household or other apps), with an example.
- **◐ Partial approve:** Workflows are named, but the value is stated only in general terms.
- **? Human judge:** The value is plausible but depends on how often tasks will need this domain.
- **✗ Reject:** No workflows are named, or the only value given is that the product is popular.
- **Source:** Guide · Usefulness and reuse; template §2

#### D1.2 · Reusable behavior, not one task’s answer

- **What to check:** The App serves several tasks instead of encoding one scripted story.
- **Look at:** §2; §4 Synthetic data and assets; fixtures.
- **✓ Approve:** Two or more distinct task situations, or a task-independent rationale; the data can be re-seeded for each task.
- **◐ Partial approve:** Reuse is implied, but only one situation is described.
- **? Human judge:** It is unclear whether the fixtures or rules are built around one specific task.
- **✗ Reject:** The App hard-codes one task’s outcome or storyline.
- **Source:** Guide · Usefulness and reuse

#### D1.3 · Overlap and added value

- **What to check:** Link overlapping proposals and notify the author. Suggest collaboration or a division of scope; distinguish approved plans from merged implementations.
- **Look at:** The current proposal list; §3 Other apps and websites; §4 Milestones; the PR description.
- **✓ Approve:** Overlaps are linked and acknowledged, or “none found” is stated with the date. Open or approved proposals may proceed in parallel. For already merged implementations, added value is explained.
- **◐ Partial approve:** Ask the author to acknowledge relevant overlap or clarify the value beyond an already merged implementation. Do not make collaboration mandatory.
- **? Human judge:** The value beyond an already merged implementation is debatable, or coordination would benefit from a maintainer decision.
- **✗ Reject:** It duplicates an already merged implementation with no additional value. Never reject solely because another proposal is open or approved; final validated merge determines acceptance.
- **Source:** Guide · Usefulness and reuse; CONTRIBUTING · Review and implementation

### D2 · Complete declared workflows (§2, §4)

Guide: “Page count or a screenshot does not establish operational completeness. Scope need not reproduce every feature of the reference product.”

#### D2.1 · Entities and transitions

- **What to check:** Each core workflow names its entities and state transitions.
- **Look at:** §2; §4 Web / app construction.
- **✓ Approve:** Entities (such as order, seat hold, ticket) and transitions (held → paid → refunded) are named for every core workflow.
- **◐ Partial approve:** Entities are named; transitions are only implied.
- **? Human judge:** Transitions are named, but whether they match the domain’s real rules needs a person.
- **✗ Reject:** Workflows are described only as pages or screenshots.
- **Source:** Guide · Complete declared workflows

#### D2.2 · Reads, writes and an end-to-end trace

- **What to check:** For each core workflow you can write: precondition → action or event → expected business outcome.
- **Look at:** §2; §3 Operations and access.
- **✓ Approve:** The trace can be written for every core workflow from the text, with the reads and writes named.
- **◐ Partial approve:** The trace works for most core workflows; one has no clear outcome.
- **? Human judge:** A trace can be written, but the expected outcome is ambiguous.
- **✗ Reject:** No core workflow ends in a state that can be checked.
- **Source:** Guide · Complete declared workflows; Findings and outcome

#### D2.3 · Confirm, modify, cancel and error paths

- **What to check:** The applicable confirm, modify, cancel and error paths are covered, without copying every feature of the reference product.
- **Look at:** §2; §4 Scope boundary and open questions.
- **✓ Approve:** Each applicable path is listed per workflow, or marked not applicable with a reason, and the scope boundary says what v1 leaves out.
- **◐ Partial approve:** The happy path and some other paths are covered; the rest are missing but easy to add.
- **? Human judge:** Whether a path applies is debatable, such as refunds for a free service.
- **✗ Reject:** Only happy paths, where the reference product clearly supports cancelling or changing (for example, bookings).
- **Source:** Guide · Complete declared workflows; CONTRIBUTING · “Complete” definition

### D3 · Entry points and callers (§3)

Guide: “Keep privileged management separate. A reviewer console is not automatically an Agent CUA interface.”

#### D3.1 · Agent business operations and modes

- **What to check:** Agent-facing operations are listed with their mode (MCP, API or GUI) and their read or write effect.
- **Look at:** §3 Operations and access.
- **✓ Approve:** Each operation is named as a verb on an object, with its mode and its read or write effect.
- **◐ Partial approve:** Operations are listed; modes or effects are missing for some.
- **? Human judge:** The choice between GUI and MCP changes what tasks can test and needs a person.
- **✗ Reject:** Only “will provide an MCP server”, with no operations.
- **Source:** Guide · Entry points and callers; template §3 · Operations and access

#### D3.2 · Infra operations kept separate

- **What to check:** Setup, history, reset and event operations belong to Infra and are not on the agent connection.
- **Look at:** §3 Operations and access; State and lifecycle.
- **✓ Approve:** Infra operations (such as `env.load_seed`, `env.apply_event`, `env.reset`) are named and stated as unavailable to the agent.
- **◐ Partial approve:** Infra operations are named, but the separation is not stated.
- **? Human judge:** The caller of an operation is ambiguous, such as a reset button inside the agent’s GUI.
- **✗ Reject:** The agent can load history, reset or inject events.
- **Source:** Guide · Entry points and callers; PR #12 docs/app-contribution.md

#### D3.3 · Reviewer console versus agent interface

- **What to check:** Any reviewer or admin console is kept apart from the agent’s interface.
- **Look at:** §3 Operations and access; §4 Web / app construction.
- **✓ Approve:** The agent’s GUI and any reviewer console are separate, or there is no console.
- **◐ Partial approve:** A console exists, but its audience is not stated.
- **? Human judge:** The console’s role in tasks is unclear.
- **✗ Reject:** A reviewer console is presented as the agent’s CUA interface.
- **Source:** Guide · Entry points and callers

### D4 · State and lifecycle (§3)

Guide: “Prevent duplicate effects, silent conflicts and irreproducible state. Snapshot alone does not promise restore.”

#### D4.1 · Isolation, seed and history

- **What to check:** App, account and run state are separated, and tasks can load accounts and history.
- **Look at:** §3 State and lifecycle; Shared data and dependencies; §4 Synthetic data and assets.
- **✓ Approve:** It says what is App, account and run state, and which records a task can load as history through the seed schema.
- **◐ Partial approve:** Isolation is stated; loading history is vague.
- **? Human judge:** It is unclear whether task histories fit the planned records.
- **✗ Reject:** One shared state with no account or run separation, or user data that cannot be set per task.
- **Source:** Guide · State and lifecycle; PR #12 docs/app-contribution.md (seed, env.load_seed)

#### D4.2 · Commit evidence, retries and concurrency

- **What to check:** Writes return evidence, retries do not repeat effects, and conflicts are visible.
- **Look at:** §3 State and lifecycle; Operations and access.
- **✓ Approve:** Writes return a receipt and a version; the same `request_id` returns the same result; a stale `expected_version` is rejected; reads do not mutate business state. If evaluator records are promised, map them to App history, existing Core audit and the supplied Agent execution records. Ordinary reads and denials already have audit rows; describe caller/commit correlation, replay counting and snapshot retention before reset. Missing fields in Core audit alone do not require a Core change.
- **◐ Partial approve:** Retry, commit or concurrency behavior is incompletely described, or required evaluator fields have no verified source. Identify the missing App-owned record, supplied evidence artifact or correlation/counting rule; do not infer that rejected calls leave no audit or that optional diagnostics provide complete evidence. Review the App evidence plan without adding an external recorder implementation requirement.
- **? Human judge:** Domain-specific conflicts, such as two people buying the last seat, need a decision on the expected behavior.
- **✗ Reject:** A retry can repeat an effect (a double charge), or conflicting writes silently overwrite each other.
- **Source:** Guide · State and lifecycle; PR #12 docs/review/app-implementation.md (Versions and concurrency)

#### D4.3 · Reset and restore boundaries

- **What to check:** Reset returns this App to its loaded baseline, and restore promises are explicit.
- **Look at:** §3 State and lifecycle; §4 Validation and reset.
- **✓ Approve:** Reset returns this App instance to the loaded baseline (`reset_scope: app_instance`) without touching other Apps, and anything promised beyond a snapshot is stated.
- **◐ Partial approve:** Reset is described; the boundary with other Apps is not.
- **? Human judge:** Whether side effects already delivered elsewhere (such as sent mail) should be undone is unclear.
- **✗ Reject:** No reset, or a reset that also clears other Apps.
- **Source:** Guide · State and lifecycle; PR #12 contribution.json · reset_scope

### D5 · Events, time and messaging (§3)

Guide: “Tasks choose scenario content/timing; Apps define effects; Infra schedules and binds accounts. Mail is only one possible receiver.”

#### D5.1 · Accepted events and their effects

- **What to check:** Each event the App accepts has an example and a defined business effect, or the field says `None`.
- **Look at:** §3 Events and notifications.
- **✓ Approve:** Each accepted operation has an example in `{event_id, at, operation, payload}` form, with a UTC offset in `at`, and its effect on business state.
- **◐ Partial approve:** Events are named without an effect or an example.
- **? Human judge:** It is unclear whether an event belongs to the App or to the task scenario.
- **✗ Reject:** The App decides when scenario events happen, which belongs to the task.
- **Source:** Guide · Events, time and messaging; PR #12 examples (scenario.json)

#### D5.2 · Business timeouts and time

- **What to check:** Time-based effects run on the supplied virtual time.
- **Look at:** §3 Events and notifications; State and lifecycle.
- **✓ Approve:** Timeouts and windows (a hold that expires, a refund window) have rules that run on the supplied virtual time.
- **◐ Partial approve:** Time-based effects are mentioned without the rule.
- **? Human judge:** Whether a timeout is needed at all is a design choice.
- **✗ Reject:** It depends on real wall-clock time.
- **Source:** Guide · Events, time and messaging; PR #12 docs/review/app-implementation.md (Events and time)

#### D5.3 · Send and receive directions and receiver contracts

- **What to check:** Send and receive are declared separately, and each message targets an actual receiver-owned contract. Open the pinned declaration, schema and receiving operation; a contract name alone is not evidence of compatibility.
- **Look at:** §3 Internal personal apps; Other apps and websites; Events and notifications.
- **✓ Approve:** Each direction is stated (send-only, receive-only, both or none), the reviewed receiver interface supports the intended fields/files and effect, and supplied examples agree with its versioned schema. Record whether an example is a payload or a full wire message, and any validation performed. `None` is valid when the declared workflows need no messaging; do not require Mail integration by default.
- **◐ Partial approve:** Contract links or required fields are missing, compatibility is unverified, or a supplied example does not match the existing schema. State the exact gap and smallest correction; do not require finished implementation evidence.
- **? Human judge:** The receiver it needs does not exist yet (for example, Calendar has no messaging receiver): a platform decision.
- **✗ Reject:** It plans a private copy of Mail or Calendar, or assumes a notification creates a Calendar event on its own.
- **Source:** Guide · Events, time and messaging; Integration expectations; PR #12 docs/app-integrations.md

### D6 · Data and media (§3, §4)

Guide: “A schema accepting a MIME string does not establish runtime support or usable original assets.”

#### D6.1 · IDs and references

- **What to check:** People, accounts and objects are referenced by shared IDs instead of copies.
- **Look at:** §3 Shared data and dependencies.
- **✓ Approve:** Shared IDs are used across Apps (as in `binding.json`), and the source of truth for each object is clear.
- **◐ Partial approve:** References are named; the linking rules are vague.
- **? Human judge:** Which App owns a shared object is unclear.
- **✗ Reject:** Each App keeps its own copy of the same people or accounts.
- **Source:** Guide · Data and media; PR #12 fixtures/binding.json

#### D6.2 · Formats, sizes and counts

- **What to check:** Media formats, sizes and counts are stated and fit the reference profile, or the gap is flagged.
- **Look at:** §3 Shared data and dependencies; §4 Data and image collection; Synthetic data and assets.
- **✓ Approve:** Formats, sizes and counts are given and fit the reference profile (PDF, UTF-8 text, ICS, PNG/JPEG, MP3/WAV, MP4, JSON; at most 64 assets and at most 1 MiB of decoded bytes per App bundle), or an extension is flagged as a platform dependency with an owner and validation plan. These are reference-profile limits, not project-wide dataset limits.
- **◐ Partial approve:** Formats are named; sizes or counts are missing.
- **? Human judge:** A format outside the profile may be needed: a platform decision.
- **✗ Reject:** It relies on a format just because a schema accepts its MIME type, or on media that exist only as live links.
- **Source:** Guide · Data and media; PR #12 docs/app-contribution.md (reference profile)

#### D6.3 · Provenance, licenses, synthesis and missing data

- **What to check:** Collected and synthetic data have provenance and licenses, and missing data has defined behavior.
- **Look at:** §4 Data and image collection; Synthetic data and assets; License and external dependencies.
- **✓ Approve:** Each source has provenance and reuse terms, synthetic data has a stated method, any reused brand assets have an explicit permitted basis, and the App’s behavior when data is missing is defined.
- **◐ Partial approve:** Provenance and licenses are stated; missing-data behavior is not.
- **? Human judge:** The license terms are ambiguous, such as a site whose terms forbid scraping.
- **✗ Reject:** Collected assets have no provenance or license, or brand assets are copied without a permitted basis.
- **Source:** Guide · Data and media; template §4 · License and external dependencies

### D7 · Dependencies and effort (§4)

Guide: “Attribute platform dependencies correctly instead of calling them contributor defects.”

#### D7.1 · Required versus optional dependencies

- **What to check:** First enumerate which personal Apps each workflow needs, including separate Agent tool calls; also enumerate other App connections. Check whether the required App and operation actually exist at the reviewed revision, not merely whether the proposal names them. Confirm the package runs independently with only its own files, the pinned shared runtime and declared dependencies.
- **Look at:** §3 Internal personal apps; Other apps and websites; §4 App integrations; License and external dependencies.
- **✓ Approve:** Each dependency is required or optional for a named workflow, links the reviewed package and exact public interface/version, and has the needed implemented capability. A planned capability is explicitly bounded by an owner, sequence and feasible fallback or scope exclusion. Run-time external services are replayed or controlled; an optional App integration may still be required by a particular linked Task. The proposal states the standalone package boundary and its declared dependencies.
- **◐ Partial approve:** Dependencies lack scope/version links, an App exists but the needed operation is unverified, a capability gap has no clear owner/fallback yet, or the standalone package boundary is missing. Ask the author to supply missing information rather than reject for omission alone. Shared IDs do not establish a Contacts implementation; test fixtures do not establish a production Messages App.
- **? Human judge:** Whether a dependency should be required, a new receiver should be built, or an adapter/fallback is acceptable needs a maintainer/platform decision.
- **✗ Reject:** A required capability that does not exist is treated as available, or the design requires undeclared dependencies, hard-coded repository-relative paths outside the package, or access to another App's private implementation or state. A pinned shared runtime and declared dependencies used through public interfaces are allowed.
- **Source:** Guide · Dependencies and effort; Integration expectations; PR #12 docs/app-integrations.md; docs/review/app-implementation.md (Package and contract)

#### D7.2 · Owners and sequence

- **What to check:** Milestones have an order, owners and a calendar duration, and platform dependencies are attributed to the platform.
- **Look at:** §4 Milestones, owners and dependencies.
- **✓ Approve:** Each milestone has an owner, an order and what it waits for, and waits on the platform are labeled as platform dependencies.
- **◐ Partial approve:** Order or owners are missing for some milestones.
- **? Human judge:** The sequence depends on platform timelines, such as the infrastructure release.
- **✗ Reject:** There are no milestones or owners.
- **Source:** Guide · Dependencies and effort; template §4

#### D7.3 · Effort and resource costs

- **What to check:** Effort is in person-days per workstream with a total, plus collection, generation, storage and compute costs.
- **Look at:** §4 Effort column; Resources and total effort.
- **✓ Approve:** Every workstream has person-days (ranges are fine), the total matches, and costs are numbers or explained TBDs.
- **◐ Partial approve:** Effort is given, but the total or the costs are missing.
- **? Human judge:** Whether the effort is realistic for the scope needs a person.
- **✗ Reject:** There are no effort estimates.
- **Source:** Guide · Dependencies and effort; template §4 · Resources and total effort

### D8 · Verifiability (§4)

Guide: “An independent reviewer needs observable acceptance criteria rather than a promised test count.”

#### D8.1 · Success and error examples

- **What to check:** Each core workflow has a success example and an error example with the expected state or receipt.
- **Look at:** §2; §4 Validation and reset.
- **✓ Approve:** Every core workflow has both, each with the expected state or receipt.
- **◐ Partial approve:** Success examples only.
- **? Human judge:** The expected outcomes are domain-specific and need confirmation.
- **✗ Reject:** Only “we will test thoroughly” or a test count.
- **Source:** Guide · Verifiability; Findings and outcome

#### D8.2 · Business tests and receiver-side checks

- **What to check:** The Validation and reset row plans business tests, reset checks and integration checks that look at the receiving App and the actual result the caller needs.
- **Look at:** §4 Validation and reset; App integrations.
- **✓ Approve:** Business tests, reset checks and public-runtime integration checks are named. Each integration checks the receiving App's records/files or receipt, distinguishes delivery acknowledgement from a business decision, and defines sender/receiver outcomes on relevant rejection, retry or unknown acknowledgement paths. The plan does not assume automatic sender rollback.
- **◐ Partial approve:** Integration checks rely on sender success, assume an unverified business result in a delivery receipt, or leave failure/commit boundaries unclear. Identify the needed interface or platform decision.
- **? Human judge:** Which runtime capabilities are needed is a platform decision.
- **✗ Reject:** There is no validation plan.
- **Source:** Guide · Verifiability; Integration expectations; PR #12 docs/app-attachments.md

#### D8.3 · Observable acceptance criteria

- **What to check:** Each deliverable has an observable pass condition that an independent reviewer can check.
- **Look at:** §4 Deliverable / quality check column.
- **✓ Approve:** Every deliverable has a pass condition someone else can observe, and the points that need human review are named. For promised evaluation records, identify the source and join: App revisions/state, Core outcome evidence and supplied tool calls/arguments/results. Plan checks of required content and failure coverage; optional diagnostic logs alone do not establish that coverage.
- **◐ Partial approve:** Some deliverables have no pass condition.
- **? Human judge:** Acceptance depends on subjective quality, such as how realistic the assets look.
- **✗ Reject:** Acceptance rests on a promised number of tests or screenshots.
- **Source:** Guide · Verifiability; template §4
