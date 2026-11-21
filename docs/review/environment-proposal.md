# Environment proposal review

Review a plan for useful, reusable App behavior. Working implementation or completed Agent rollouts are not prerequisites at this stage. The repository's [contribution process](../../CONTRIBUTING.md#review-and-implementation) governs approval: a maintainer records the approved scope and commit; implementation continues in the same PR.

## Review baseline

Read the proposal, PR body, comments, explicitly related tasks/environments and current template. Record exact revision and review scope. The public App/runtime is a reference profile, not permanently frozen infrastructure. Distinguish blocking dependencies, optional reuse and merely related work. See the [extension boundaries](../environment-architecture.md).

When proposals overlap, notify the author and link the existing work; suggest collaboration or a clear division of scope. Approval does not reserve ownership or prevent parallel implementation. Do not reject solely because another proposal is approved. Once related work merges, assess later submissions for additional value. Only a validated merge counts as an accepted contribution.

| Dimension | Evidence to request | Reason for the check |
| --- | --- | --- |
| Usefulness and reuse | Intended workflows, task demand or independent rationale, overlap and added value | An App should expose reusable behavior rather than encode one task's answer. Overlap alone does not reserve ownership. |
| Complete declared workflows | Entities, transitions, reads/writes, applicable confirm/modify/cancel/error paths | Page count or a screenshot does not establish operational completeness. Scope need not reproduce every feature of the reference product. |
| Entry points and callers | MCP/API/GUI modes, Agent business operations, Infra setup/history/reset/events | Keep privileged management separate. A reviewer console is not automatically an Agent CUA interface. |
| State and lifecycle | App/account/run isolation; seed/history; commit evidence, retries, concurrency and reset/restore boundaries | Prevent duplicate effects, silent conflicts and irreproducible state. Snapshot alone does not promise restore. |
| Events, time and messaging | Accepted events, business timeout effects, independent send/receive directions, relevant receiver-owned contracts | Tasks choose scenario content/timing; Apps define effects; Infra schedules and binds accounts. Mail is only one possible receiver. |
| Data and media | IDs/references, formats/bytes/counts, collection/synthesis, provenance, licenses and missing-data behavior | A schema accepting a MIME string does not establish runtime support or usable original assets. |
| Dependencies and effort | Required versus optional services, owners, sequence, effort and resource costs; the package boundary: what runs from the App package alone and what needs the shared runtime or pinned Apps | Attribute platform dependencies correctly instead of calling them contributor defects. Require a reproducible package boundary: no undeclared dependencies, hard-coded paths into the repository, or access to another App's private implementation/state. Pinned shared runtime and declared public dependencies are allowed. |
| Verifiability | Core success/error examples, expected state/receipt, business tests, public-runtime checks and human review | An independent reviewer needs observable acceptance criteria rather than a promised test count. |

## Integration expectations

Authors should consult the [existing App contracts](../app-integrations.md) and reuse receiver business interfaces. They implement their own business, publish declarations and compatible messages; they do not implement a replacement personal inbox/calendar just to connect to it. A required receiver/channel that does not exist is an explicit dependency.

For each planned connection, check the linked App/tool/receive-schema version, whether the dependency is required or optional, the direction and data/file formats, and the observable outcome in the receiving App. The plan should identify who supplies a missing capability and how the integration will be demonstrated. A sender's successful return alone is not a sufficient acceptance criterion.

### Verify the dependency, not only its name

Inventory the personal Apps needed by the declared workflows, including Apps the Agent calls separately rather than through Messaging. Also list other receiving/sending Apps. For each connection, record:

| Workflow and required effect | App and required/optional scope | Reviewed implementation revision and public interface | Capability check and planned evidence | Missing capability, owner and fallback |
| --- | --- | --- | --- | --- |
| Example: order confirmation reaches an inbox | Mail; required for this workflow | Pinned App package, receive declaration, operation and payload/wire schema | Check the example against the receiver schema; later verify the actual inbox record and receipt | Record any missing feature; do not infer it from the App name |

This is a reviewer evidence table, not a second App registry or an extra author configuration file. Use the proposal's existing connections, integrations and validation fields to request missing information.

1. **Check availability at the reviewed revision.** Open the package and interface files; distinguish an implemented capability from a proposal, test fixture or planned adapter. At the introduction of this check, the canonical personal App examples are Mail and Calendar under `examples/apps/`. Recheck the current tree for each review; the template's mention of Contacts does not establish an implementation. A shared person/account binding is not a Contacts App.
2. **Check the specific effect and caller.** An existing App may lack the required feature. Calendar has business tools and Infra event handlers but currently no Messaging receiver. Distinguish Agent tool use, authorized business-client calls, task-supplied seed/events and App-to-App messages. Do not infer automatic Calendar updates from an email or require every App to connect to Mail.
3. **Read the contract, not just its identifier.** Check input/output shape, required fields, file support, receive operation and version against the proposed use. When an example is supplied, compare it with the actual schema; use the public validator when feasible and record the result. A payload fragment is not a full wire message. If no concrete example is supplied, record compatibility as unverified and request only the detail needed to judge the design. Proposal review does not require a finished App or integration test.
4. **Check completion and failure semantics.** Separate sender commit, receiver commit and any business result returned to the caller. Delivery acknowledgement does not imply a payment decision, a Calendar update or rollback of the sender. Check rejection, retry and unknown outcomes for the proposed workflow. Identify required platform support explicitly rather than assuming a cross-App transaction or request/response interface.
5. **Close or bound the gap.** An unavailable receiver/operation needs an owner, sequence and feasible fallback, or exclusion from the initial scope. Optional future links do not block an independently useful first version. If a linked Task requires the optional connection, record that Task's narrower dependency separately.

### Use App records and the supplied execution trace

Treat Agent execution records as a supplied evaluation input. This review covers the App and public runtime in this repository, not implementation of the external execution recorder. Core runs and commits individual Apps; Messaging delivers between Apps. A field missing from Core audit does not by itself require a Core change.

The reference Core records ordinary successful reads and rejected tool calls in `state.audit`, persisted with App state and available through the administrative snapshot. Rejection discards the attempted business-data change, not the denial audit row. MCP adds connection identity, times, selected inputs and result summaries. Its fixed projection omits search queries, arbitrary App-specific target fields and full publication text. See [Core outcomes](../../runtime/core/runtime.cjs), [MCP projection/persistence](../../runtime/core/mcp.cjs) and [diagnostics](../../runtime/core/app-log.cjs).

For an App such as Forkyard, distinguish its business records from derived evaluation records:

| Promised record | App-owned implementation | Evidence used for evaluation |
| --- | --- | --- |
| Public writes and revisions | Preserve full text, revisions, audience/reach and normalized hashes, including history needed after edit/delete | Join the preserved revision to the supplied call/result and Core commit/version |
| Subject index | Define person/name matching, object ownership and surface rules; compute in the App or an App-owned evaluator helper | Reproducible matches over retained revisions and declared rules |
| Cross-surface links | Resolve and preserve links among comments, posts and notes | App history; links within one App need no new Messaging feature |
| Attention/read record | Define which targets count and how objects map to people; keep read handlers from mutating business data | Supplied tool arguments/results provide queries and read targets; join with App history and existing audit |
| Pressure counters, including rejected attempts | Define grouping, overlap thresholds and logical-attempt counting | Combine App history with rejected attempts in supplied execution records and audit; a rejected change is already audited |

An evaluator can assemble these records from App history, snapshots/audit and the supplied execution trace; the App need not mutate a derived report on every read. The plan should describe the join and counting rules. Distinguish new actions from transport retries and successful idempotent replays: successful replay currently returns before another audit row, while repeated rejected requests can add rows. Reset/seed replacement clears prior audit and receipts, so retain the necessary snapshot before reset.

Optional `ctx.log` is filtered, best-effort diagnostics, not automatically a grading archive. If delivery evidence is missing, name the missing artifact or App-owned record; do not automatically prescribe a Core extension or weaken read-only behavior. The default path above needs no new Core API or App business schema.

Public Core/Messaging makes reference integration reproducible by contributors. Authors identify intended checks and required runtime capabilities in the existing Validation and reset workstream. Do not require token policies, TLS deployment, log retention design or completed tests in a proposal. Optional step logging becomes a delivery requirement only when included in approved scope.

## Findings and outcome

Separate:

- **Design gaps:** core behavior cannot complete, authority contradicts requirements, or an essential dependency has no feasible path. Ask for a specific design/range change.
- **Clarifications/platform decisions:** ambiguous timeout, retry, interface mapping, format budget or responsibility. State the concrete consequence, owner and smallest useful clarification.
- **Optional improvements:** outside first-version scope; do not expand acceptance silently.

For each core workflow, write a precondition → action/event → expected business outcome → relevant failure/control example. Record source, finding, consequence, requested change and follow-up evidence. Existing author questions are acknowledged as open decisions, not misrepresented as omissions.

Recommend ready for scope approval, needs design changes, or insufficient evidence. The recommendation does not itself approve or merge. Substantial scope changes require another design review. Do not invent numeric proposal thresholds or reuse Task three-model/difficulty requirements as Environment proposal gates.

After implementation, apply the separate [App acceptance review](app-implementation.md).
