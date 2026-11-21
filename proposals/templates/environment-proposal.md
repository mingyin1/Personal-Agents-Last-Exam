# Environment Track proposal

**PR title format:** `[Environment Proposal] [<Domain>] <App or website name>`

Example: `[Environment Proposal] [Work & business] Google Calendar`

Copy this template to `proposals/environment/<slug>.md`. Keep the overview concise. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

After design approval, use the [App contribution guide](../../docs/app-contribution.md) and [public Core / Messaging runtime](../../runtime/README.md) to reproduce local integration checks. For connections to existing Apps, consult their [business and receive contracts](../../docs/app-integrations.md) before implementing the sender.

## 1. App and domains

- **Authors / GitHub handles (required):** `[Fill in: names and @handles]`
- **Reference app or website / URL (required):** `[Fill in: app or website name and reference URL]`
- **Primary domain (required):** `[Fill in: one domain from the table below]`
- **Secondary domains (optional):** `[Fill in: other relevant domains, or None]`

### Domain names

Use the exact names from the [homepage](../../README.md#environment-domains). Choose one primary domain and optional secondary domains; list the primary first in the PR title and join others with ` + `.

<table>
<tr><td>💳 <strong>Money &amp; insurance</strong></td><td>🛍️ <strong>Shopping &amp; groceries</strong></td><td>✈️ <strong>Travel &amp; commuting</strong></td></tr>
<tr><td>🩺 <strong>Health &amp; care</strong></td><td>🍽️ <strong>Food &amp; dining</strong></td><td>💬 <strong>Social &amp; communities</strong></td></tr>
<tr><td>🏠 <strong>Home &amp; utilities</strong></td><td>🏛️ <strong>Public service &amp; law</strong></td><td>🎬 <strong>Media &amp; entertainment</strong></td></tr>
<tr><td>📚 <strong>Learning &amp; research</strong></td><td>💼 <strong>Work &amp; business</strong></td><td>📰 <strong>News &amp; information</strong></td></tr>
<tr><td>🌤️ <strong>Weather &amp; outdoors</strong></td><td>🎮 <strong>Games &amp; play</strong></td><td>🏃 <strong>Fitness &amp; wellbeing</strong></td></tr>
</table>

## 2. What you plan to build

Briefly describe the main workflows and why this environment would be useful for personal-agent tasks.

**✍️ Your answer (required):** `[Fill in: the workflows you plan to build and their value]`

## 3. Potential app connections

Name possible connections and briefly explain their purpose. Internal personal apps include Mail, Calendar, Contacts and similar tools. Use `None` if no connection applies, or `TBD` if undecided.

For internal personal Apps, state which workflow needs each App and whether the connection is required or optional. Link the existing public interface/version, or identify the missing capability, owner and fallback.

- **Internal personal apps (required):** `[Fill in: personal apps and what could be read or updated, or None / TBD]`
- **Other apps and websites (required):** `[Fill in: services and potential shared workflows, or None / TBD]`

### Integration details

- **Operations and access (required):** `[Fill in: MCP, API or GUI entry points; agent-facing actions; setup, reset and event-injection operations used by the platform]`
- **State and lifecycle (required):** `[Fill in: how app, account and run state is separated; initial data, reset and snapshot behavior; write confirmation, retries and concurrent updates]`
- **Events and notifications (required):** `[Fill in: external events the app accepts and notifications it sends; channels and example input/output data, or None. Task scenarios define when events occur.]`
- **Shared data and dependencies (required):** `[Fill in: people, accounts and object references; media and attachment formats; shared components or services needed to run the app; confirm the App package runs on its own with only the shared runtime and these declared dependencies]`

## 4. Construction plan and effort

Specify how the environment will be built, what will be collected or synthesized, and how each deliverable will be checked. Include expected counts or coverage where relevant. Effort estimates may be ranges; use person-days for human work. Mark reusable components and explain any workstream that is not applicable.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | `[Fill in: pages, workflows and state to build; components to reuse]` | `[Fill in: working flows and expected outcomes to verify]` | `[Fill in: estimate]` |
| Data and image collection | `[Fill in: sources, crawling or reuse method, expected records/images and cleaning work]` | `[Fill in: collected assets, source/reuse records and checks for completeness and broken media]` | `[Fill in: estimate, or N/A with reason]` |
| Synthetic data and assets | `[Fill in: records/images to generate, quantities, generation method and realistic variation]` | `[Fill in: generated fixtures and checks for consistency, duplication and realism]` | `[Fill in: estimate, or N/A with reason]` |
| App integrations | `[Fill in: internal personal apps and other services in initial scope; reads/writes, existing tool/receive contracts to reuse, data or file formats and dependencies]` | `[Fill in: connected workflows, observable receiver records/files and state-consistency checks]` | `[Fill in: estimate, or N/A with reason]` |
| Validation and reset | `[Fill in: local business tests plus public-runtime MCP, workflow/error, history-loading and reset checks; declared cross-App flows and expected receiver state/receipts where applicable]` | `[Fill in: after implementation: exact App/runtime versions, commands and reproducible reports covering permissions, state consistency, reset and declared integrations; note remaining manual or deployment checks]` | `[Fill in: estimate]` |

- **Milestones, owners and dependencies (required):** `[Fill in: work order, responsible contributors, expected calendar duration and dependencies; link related PRs]`
- **Resources and total effort (required):** `[Fill in: total person-days, expected collection/generation costs and storage/compute needs; estimates or explained TBDs]`
- **Scope boundary and open questions (required):** `[Fill in: what is excluded or deferred, and how unresolved decisions will be settled]`
- **License and external dependencies (required):** `[Fill in: license for code and assets, and whether any part is hosted instead of redistributed; any external service needed at run time and how it is replayed or controlled, or None]`

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
