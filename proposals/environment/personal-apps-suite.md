# Environment Track proposal: Shared personal Apps

This scope record accompanies the maintainer-branch continuation of [PR #103](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/103). Implementation already exists; this document does not claim prior design approval or acceptance. Review the scope and exact implementation revision through the normal proposal lifecycle before merging.

## 1. App and domains

- **Authors / GitHub handles (required):** @skyve2012: original App packages, interfaces, shared runtime changes and verification. @DavidZWZ: maintainer integration, initialization recovery fix and regression tests.
- **Reference app or website / URL (required):** Files, Messages, Notes, Tasks and Contacts are original bounded simulators. Design references are [File Browser Quantum](https://github.com/gtsteffaniak/filebrowser), [Zulip](https://github.com/zulip/zulip), [Memos](https://github.com/usememos/memos), [Vikunja](https://github.com/go-vikunja/vikunja) and [Nextcloud Contacts](https://github.com/nextcloud/contacts). See [reuse decisions and capability boundaries](../../docs/personal-apps.md).
- **Primary domain (required):** Work & business
- **Secondary domains (optional):** Social & communities; Home & utilities; Learning & research

## 2. What you plan to build

**✍️ Your answer (required):** Deliver five reusable personal-App packages and real Web interfaces for all seven Apps, including the existing Mail and Calendar examples. Each interface reads and writes the same authoritative state as MCP. Support file versions, conversation messages, durable notes, task dependencies and contact lookup, with explicit permissions, reproducible state and cross-App evidence. These building blocks support personal-agent scenarios; they are not completed benchmark Tasks or full replicas of the reference products.

## 3. Potential app connections

- **Internal personal apps (required):** Standalone business tests need no sibling App. The combined attachment workflow requires Files, Mail and Notes; verify original bytes through their published tools and receiving contracts. Contacts supplies person references for Tasks assignment through explicit Agent/orchestrator calls, not a hidden import. Messages publishes and receives through its own contract. Mail and Calendar remain at version 1.3.0 under `examples/apps/`; new packages are version 1.0.0 under `apps/`. Exact tools, event/receive schemas and resource declarations live in each package and are checked at the reviewed commit.
- **Other apps and websites (required):** A synthetic send-only order notifier demonstrates delivery to Messages, including target records and receipts. No external service, real account, scraping endpoint or production website is required at runtime.

### Integration details

- **Operations and access (required):** MCP business tools plus App-owned Web pages/controllers. Shared Host fixes App, run and Agent role; the browser cannot reset, load history, inject events or access hidden snapshots. A separate trusted Infra connection manages lifecycle and time. Each package's `tools.json`, schemas and `contribution/gui.json` define its actual public surface.
- **State and lifecycle (required):** One persisted state per App/run; separate state roots for multiple instances. Core owns version checks, idempotent writes, seed loading, reset and snapshots. Web startup selects a new instance's policy atomically and preserves existing state and permissions, including after interrupted or concurrent startup. Snapshots are inspection evidence, not a general restore implementation. Sender and receiver commits are separate.
- **Events and notifications (required):** Each App declares supported Infra events. Messages owns explicit publish/receive declarations; tests cover account A to account B, duplicate delivery, refusals and missing producer time. `env.advance_time` advances one App's logical clock without triggering business events. Event handlers observe event time. An external orchestrator owns multi-App/session scheduling; no automatic reminders, global scheduler or cross-App transaction is claimed.
- **Shared data and dependencies (required):** Core API 1.2.0 / public runtime 1.6.0, Node 18+, shared people/account bindings and published media contracts. Packages run from their own files with the pinned runtime and declared public dependencies; they do not read another App's private implementation/state. Integration examples explicitly select required Apps using `apps.registry.json`; the default Mail/Calendar registry stays unchanged. Playwright 1.56.1 and Chromium are test-only dependencies for browser acceptance.

## 4. Construction plan and effort

The original implementation is already delivered in #103. The estimates below describe remaining integration and reviewer work, not retrospectively claimed author time.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Five packages and seven App-specific interfaces. Integrate current main; fix interrupted/concurrent Web initialization without resetting an existing run. | Independent package startup, real browser create/edit flows, MCP state agreement, persisted reloads and authorization failures. | 0.5–1 integration; 0.5–1 review |
| Data and image collection | No production data or reference-product assets are collected or redistributed. | Check per-package provenance and code/asset licensing declarations. | 0.25 review; collection N/A |
| Synthetic data and assets | Keep bounded reproducible fixtures: Files has two initial file/folder records; Messages one conversation and one message; Notes, Tasks and Contacts each start with one record. Tests create additional histories and states. | Valid IDs, binding consistency, original attachment bytes, version history and missing/corrupt media rejection. Fixture counts are not benchmark-scale coverage claims. | 0.25–0.5 review |
| App integrations | Reuse Files → Mail → Notes, Contacts → Tasks, notifier → Messages and Messages → Messages workflows. | Real destination records, attachment bytes, permission/refusal cases and retry-safe receipts; no sender-only substitute. | 0.5 review |
| Validation and reset | Run full public-runtime suite, isolated App validation, independent base validator and real browser acceptance. Add interrupted initialization, obsolete Web-lock, concurrent start and Infra-only initial-policy tests. | Exact commit/versions, commands, CI artifacts and browser reports; preserve data and permissions across restart. | 0.5–1 validation |

- **Milestones, owners and dependencies (required):** @DavidZWZ integrates main and fixes initialization; original implementation credit remains with @skyve2012. DavidZWZ reviews this scope and records implementation acceptance under the explicit owner-managed policy after exact-commit CI and workflow evidence. No additional reviewer is required for this maintainer integration. Proceed through the same continuation PR. The Environment two-week first-version rule starts only when the plan is actually approved; no backdated approval is claimed.
- **Resources and total effort (required):** Approximately 2.5–4.25 remaining person-days across integration, tests and review. Local Node processes plus CI/browser workers; no paid model/API account or bulk data download required. Original authoring effort was not independently logged here.
- **Scope boundary and open questions (required):** No production hosting, OAuth, user simulator, remote isolation, global clock scheduler, distributed locking, automatic reminders or full commercial-product parity. Core transaction-lock crash recovery is separate from the removed Web initialization lock. Review provenance and useful workflow realism manually; passing CI alone is not full acceptance. Related proposals may reuse these packages after compatibility review; this submission does not reserve their scope.
- **License and external dependencies (required):** Original package code/assets use the repository's MIT license. Reference products inform workflows but their source, branding and production data are not bundled. Runtime/business checks use Node built-ins; browser tests use the pinned public Playwright/Chromium dependencies. Package manifests and asset catalogs are the authoritative file-level declarations.
