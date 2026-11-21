# Personal Apps validation report

Checked November 18, 2026 (America/Los_Angeles). Scope: the five version **1.0.0** packages in this PR, public runtime **1.6.0**, Core API **1.2.0**. Exact package hashes, runtime stages and workflow assertions are recorded in [personal-apps.json](personal-apps.json). Package hashes were compared across both Node runs and the independent base-runtime reports after the last App edit.

**Automated outcome: passed.** This is a maintainer implementation submitted directly for code review. Human workflow acceptance and provenance review remain pending; no approval is claimed. Technical scope and interfaces are documented in the suite guide rather than a separate community proposal.

## Reproduction and evidence

| Evidence | Result | What was actually exercised |
| --- | --- | --- |
| App-only business | 38 tests passed: Files 7, Messages 10, Notes 7, Tasks 7, Contacts 7 | Real App hooks, input/output/seed schemas, domain failures, history retention, read-only behavior, optional logging and escaped rendering |
| Isolated App package | All five passed | Public verifier copies each App without a sibling runtime, then executes its local tests and event example |
| Real public MCP | 185 common checks across the five packages passed | Discovery, argument/role restrictions, reads, history loading, event application/retry, reset, separate run and restarted process |
| Declared cross-App workflows | 83 assertions passed | Real business writes, receipts, destination records and actual attachment bytes, with negative controls |
| Node 18.20.8 | 22/22 full-suite stages passed | Existing Mail/Calendar/Core/Messaging regression suite plus the five-App suite |
| Node 22.14.0 | 22/22 full-suite stages passed | Same full-suite stages on the second supported runtime family |
| Independent base validator | All seven discovered packages passed | Unmodified main at `718a4cbc7709dee22bf1e4ad1cff984550d7e519` validated the candidate packages, including existing Mail/Calendar |
| Human review | Pending | Implementation scope, overlap, realistic coverage and provenance; automated green results do not grant acceptance |

The Node binaries were official releases with their archive SHA-256 checked against Node's published checksum file. All test data was synthetic; tests used temporary directories and local stdio MCP, without private services, user credentials or model APIs.

Run from the candidate checkout:

```sh
node --version
npm run contracts:check
npm run test:personal-apps
npm test
```

Run the independent package check from a separate checkout of the pinned base:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports
```

The base checker was not changed or supplied from the candidate. Its package/MCP/lifecycle checks are separate from candidate business tests. The new parent-resource registrations for Files, Notes and Messages are reviewed additions to the public host; actual resource and cross-App checks run with those registrations present. The clock follow-up changes Core management and event-context timing; Messaging business code and App package schemas remain unchanged. The base validator certifies package compatibility, not the new clock operation.

## Workflow evidence

| Preconditions → action | Expected and observed result | Failure/control |
| --- | --- | --- |
| Each App starts with scenario read permissions → attempt a write, then select sandbox and retry | First attempt denied; permitted write commits one record and revision; a restarted MCP process reads it | Stale version and changed reuse of a request ID rejected; identical retry has one effect; another run unchanged |
| Contacts contains Alex's stable person ID → assign a new Task | Tasks stores `person-alex`, independent of the display name | Unknown person and invalid deadline rejected; blockers prevent completion; cycles rejected; completed tasks require explicit reopen |
| Files contains a synthetic original receipt → attach to Mail draft → attach returned bytes to Notes | Both destination Apps retain readable original bytes and the same SHA-256 | Corrupt import preserves data and resources; restricted parent prevents both attachment-tool and raw-resource access |
| Order notifier has an approved source/account/grant → publish the Messages-owned `channel.chat` envelope | Messages creates a real record in the bound conversation and imports attachment bytes; receipt ties source event to committed receiver version/time | Source impersonation, unknown recipient, missing grant and invalid conversation rejected; no partial message on receiver refusal |
| Successful notification → same event retry, then altered payload | Same event has one effect and returns prior receipt; altered payload conflicts | Missing producer time remains null/absent while receive/commit times remain available |
| Messages account A has an own outgoing message → build envelope and publish to account B | B resolves A's bound person, creates its own message and original-byte attachments; A's state remains separate | Receiver account and conversation are explicit; local send is not treated as downstream delivery confirmation |
| Infra applies Notes/Messages content change → inspect business history | Previous text/content is retained alongside the new record | An event cannot erase existing history, creation time or prior revisions |

Individual App tests additionally cover file/folder cycles and collisions, immutable file versions, nonempty-folder trash rules, Notes archive/restore and revisions, Contacts duplicate/invalid emails, conversation membership and author-only message edits/retractions. Reads do not mark Messages as read; that is a separate write tool.

## Follow-up delivery review

The review reproduced and corrected two Messages defects before the final validation runs:

| Reproduced failure | Correction and regression evidence |
| --- | --- |
| Marking an outgoing message read at a later virtual time changed its CloudEvent identity/time, so a retry could create another receiving record. | Derive identity from content/destination/revision, and preserve original `sent_at`. App-only tests cover read changes and text edit/revert; real MCP advances time, marks read, republishes and verifies one receiver effect. |
| A service notification whose source account had the same owner as the recipient was editable as if locally authored. | Store optional immutable `delivery_source` on received records. App-only tests reject edit, retract, attachment changes and provenance removal; real MCP grants the edit tool but verifies that the App rejects editing a received notification and preserves its data. |

The new optional Messages record field is reflected in its seed/event/tool-output schemas. Existing historical fixtures remain valid. The chat wire contract and Messaging business implementation are unchanged. Core additionally provides the clock operation described below. Mail/Calendar now additionally include App-owned web pages and public Host metadata; their business logic and schemas are unchanged.

| Review gate | Outcome |
| --- | --- |
| Package and contracts | Passed authoritative package/schema checks; exact package hashes match both Node runs and the independent base validator. |
| App-only business | Passed from isolated copies with no runtime sibling, including the two new regressions. |
| Public runtime and independent integration | Passed real MCP, lifecycle/permission/media/delivery workflows and the unmodified base validator. Contacts/Tasks and Files/Mail/Notes coordination uses ordinary MCP tools; the two Messages delivery workflows use Router. |
| Workflow and human review | Automated workflow evidence passed. Browser acceptance is recorded separately below; human scope/provenance acceptance remains pending. |

## Review focus

Start with the [suite guide](../personal-apps.md) and each App's `src/`, `tools.json`, seed/event schemas and tests. Most package JSON files are copies of public contracts or explicit record/tool schemas needed for isolated verification. Shared schema copies are checked by `contracts:check`; the vendored test validator is compared to the canonical public validator.

Confirm the reuse boundary with #33 Personal Document Records and #85 Kinthread, especially the proposed `channel.chat` contract. Legacy reviewer renderers remain compatible. The optional `pale.web` extension now mounts business pages through the public Host and has separate real-browser evidence. Source/product references are documented as design inspiration; their code/assets are not redistributed.

Recommendation: ready for code and implementation review, with automated local evidence attached. Merge and acceptance remain maintainer decisions. This documentation does not change the repository's automated contribution gate.


## Business GUI acceptance

All seven Apps own their business pages/controllers in `gui/index.html` and `gui/src/app.js`. The public [Web Host](../../runtime/web/README.md) mounts them through a fixed Agent MCP connection. Legacy reviewer-renderer declarations remain compatible; the optional `pale.web` extension identifies the additional business surface. The base validator checks unchanged business contracts; it does not certify the new Web Host.

Browser verification uses pinned Playwright/Chromium, temporary synthetic state, actual buttons/forms and independent MCP inspection. It covers create/edit/reload on all seven Apps, scenario-event refresh, original attachment/file bytes, invalid Calendar overlap, Notes concurrent-edit refusal and lost-response retry, untrusted text, direct management denial and a narrow viewport. Host tests separately cover access sessions, origin/CSRF, forged roles, hidden paths, versions, restart and restricted profiles.

Reproduce with `npm ci`, `npx playwright install chromium`, `npm run test:web` and `npm run test:web:browser`. CI uploads screenshots and `.artifacts/web/report.json`. The committed [GUI evidence summary](personal-apps-gui.json) records the final package hashes and checked browser flows. Screenshots are supplementary; no model-agent benchmark or complete user-simulator integration is claimed.

This corrects the earlier delivery gap: MCP passing and renderer existence did not establish GUI delivery. GUI evidence is now separate and executable. The review-only checklist change is maintained independently in PR #104.

### Product interface refinement

The current browser report covers **109 checks**: Mail 17, Calendar 17, Files 14, Messages 15, Notes 17, Tasks 13, Contacts 13, plus 3 restricted-Calendar permission checks. The interfaces now have mailbox folders/readers, a month calendar, a file browser, conversation bubbles/composer, note navigation, task checkboxes and contact cards. App-owned GUI READMEs describe their controls.

Additional tests exercise Reply recipient/subject prefills, actual authorized image preview, missing-attachment fallback, month navigation/date-to-create, folder double-click, in-thread sending, pinned-note filtering, task-checkbox transitions and contact groups. Selection keeps prior-item actions disabled until the new item is loaded; folder double-click remains available during a read. Calendar accepts the existing valid event representation without an attachments array. These are interface fixes, not new backend operations.

The final package hashes were matched across Node 18, Node 22, the unmodified base validator and browser reports. Desktop and narrow live-preview layouts were also inspected without modifying user/demo records. This establishes the declared local workflows, not parity with complete commercial Apps. Business schema and MCP return changes are absent from this GUI refinement.

## Cross-session clock follow-up

Runtime **1.6.0** adds Infra-only `env.advance_time` and ensures event handlers observe `event.at` while they execute. App packages, business schemas and Agent tool response shapes remain unchanged. Core's remaining Chinese error/quality strings in `runtime.cjs`, `helpers.cjs` and `assets.cjs` are translated to English; status codes are unchanged.

[Calling contract](../runtime-time.md) · [Runnable example](../../examples/workflows/session-time/README.md) · [Recorded evidence](runtime-time.json)

- Seven clock unit cases cover preservation of data/resources/reset history, version and permission checks, valid/invalid/equal/backwards time, retries, all seven packages, event-handler time and rollback, and due-event ordering.
- **44 real MCP assertions** reproduce October 26 → October 29 with no incoming Mail, verify the sent timestamp and Calendar ICS timestamp, then trace delivery at the synchronized receiver time while retaining the older producer time. Restart, original retry receipts, conflicting management clients and reset are checked.
- Both Node 18 and 22 pass **22/22 stages**. The existing five-App common checks increase to **185** because the verifier also checks Agent denial of the new management operation. The 38 App-only business tests and 83 cross-App assertions still pass.
- All seven packages retain their prior hashes and pass the independent base validator. Browser acceptance still passes **109** checks.

The Infra caller must pause actors, process earlier due events, advance every enabled App and confirm snapshots before resuming. This repository supplies the per-App primitive and executable calling example; it does not verify the external orchestrator or provide a global scheduler.
