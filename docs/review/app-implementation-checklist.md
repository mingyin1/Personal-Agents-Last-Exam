# App implementation acceptance checklist

Use with [the implementation review guide](app-implementation.md). Record App commit/hash, Host revision and scope. For each item record **passed / failed / not run / not applicable**, evidence and the owner of a missing dependency. Check a box only when the applicable requirement passed.

## 1. Scope and public package

- [ ] Establish promised workflows and modes (MCP/API/GUI) from the original request, approved proposal and review decisions, not only the current capability declarations. Missing implementation cannot redefine a requirement as optional.
- [ ] Verify versions, manifest paths, schemas, tools, hooks, events and dependencies against actual files. Distinguish a complete App, a renderer and a test fixture.
- [ ] Reproduce documented startup/tests from a clean public checkout, with identified public Host dependencies. A demo outside the submitted package is not delivered evidence.
- [ ] Required receiving Apps exist at compatible pinned versions; integrations reuse their contracts rather than copying their state or backend.

## 2. Business behavior

- [ ] App-only tests run without private runtime code and exercise real functions, invalid transitions, missing objects and read-only behavior.
- [ ] Applicable create/read/update/cancel flows produce expected state/history; invalid operations preserve business data.
- [ ] Data/media references, original bytes and provenance are valid. A MIME declaration is not proof of parsing, OCR or visual quality.
- [ ] Optional diagnostics do not change business results or require a missing hook.

## 3. Runtime and interaction

- [ ] Real MCP/API discovery and calls match contracts and committed state.
- [ ] Business callers cannot seed history, reset, inject events or inspect hidden snapshots by guessing operations. Object/field/attachment authorization applies on the backend.
- [ ] Seed/reset, separate runs/Apps, versions, retries, events and supplied time have observable success and failure evidence.
- [ ] Declared messaging checks actual receiver records/files and receipts, including refusals and duplicate requests.
- [ ] Candidate and independently selected compatible base validators are run against exact packages. Unsupported Host features and skipped stages are separately reported.

### GUI acceptance, when required

A Web App is a valid App interface. Native desktop/mobile packaging is required only if promised. The App owns pages and business interactions; a documented public Host may supply serving, connections and identity. Do not require GUI for an approved MCP-only App.

- [ ] **Runnable delivery:** the package contains its page/controller or a documented public dependency, and the Host starts a reachable business interface. A renderer, screenshot, placeholder URL or presentation-only demo is insufficient.
- [ ] **Actual controls:** use a real browser for applicable navigation, search, selection, forms, create/edit/cancel and primary read/write flows. Direct API calls do not substitute for clicks.
- [ ] **Shared state:** inspect the same run/account through MCP after a browser write; reload and verify persistence. Apply a separate permitted MCP write or scenario event, refresh and verify the new state.
- [ ] **Failure behavior:** invalid input, denied operations, stale edits and failed writes remain visible without false success. Retrying must not silently repeat effects.
- [ ] **Business-only access:** Agent pages and backend routes expose no management controls, snapshots or hidden future events. Also send a forbidden request directly; hiding buttons is insufficient.
- [ ] **Files and content:** where supported, upload/download actual bytes under parent authorization; untrusted text must not execute HTML. Check relevant denied/missing cases.
- [ ] **Evidence:** record commands, App/Host/browser versions, actions, state/receipts and browser errors. Screenshots supplement behavior evidence; browser automation is not a model-agent benchmark.

If the Host is missing, mark GUI integration **not run** and identify its owner. Missing App-owned controls are an App implementation gap. Neither is a full GUI pass. A user-simulator integration needs its own evidence when promised; an available interface alone does not prove simulator integration.

## 4. Human workflow acceptance

- [ ] Every essential workflow has suitable evidence; human review covers useful realism, failure behavior, usability and provenance.
- [ ] Report backend, MCP/API, GUI, messaging and manual outcomes separately. One mode cannot substitute for another required mode.
- [ ] List remaining App gaps and Host dependencies. Recommend complete acceptance only when all essential requirements have evidence.

## Review report

| Requirement / mode | Required? Scope source | Verdict | Command or browser action | Observed state / receipt / artifact | Gap and owner |
| --- | --- | --- | --- | --- | --- |
| Package and business tests | | | | | |
| Public runtime and independent base | | | | | |
| Cross-App integration | | | | | |
| GUI workflows and isolation | | | | | |
| Human workflow / provenance | | | | | |

Contribution-policy checks, approval and merge remain separate maintainer decisions. This checklist changes neither proposal requirements nor production deployment policy.
