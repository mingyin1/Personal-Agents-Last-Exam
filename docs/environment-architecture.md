# Environment architecture and extension plan

Keep one implementation per App and one shared runtime. Domains classify workflows; they are not separate runtime stacks. An App can span multiple domains. Mail and Calendar currently live in `examples/apps/` and remain the canonical reference implementations; do not create copies under individual domains.

## Ownership

| Component | Owns | Does not own |
| --- | --- | --- |
| App | Business records, transitions, tools, incoming-event effects and App data migrations | Task narrative, global clock scheduling or another App's state |
| Core | Shared validation, policy enforcement, state commits and lifecycle | Domain-specific migrations or a sample task's date |
| Messaging | Receiver contracts, trusted bindings, grants and delivery receipts | A second mailbox/calendar or task decisions |
| Task package (LifePack draft) | Persona, history, timeline, initial workspace, instructions and grading | A separate implementation of each App |
| Runner / user harness | Loading the task, scheduling sessions/events, user interaction and aligned evidence | App business rules |

The LifePack adapter, global scheduler and user harness are planned components. `examples/scenario.json` is an App event example, not a competing full task format.

## Current reference profile

`runtime/profiles/local-reference.json` describes the implemented lightweight host: stdio MCP, reviewer renderers, local/inline assets and small bundles. Its restrictions are not universal contribution rules. The public schemas can describe additional interfaces; declaring them does not implement their runtime support.

For Web/CUA, HTTP services, larger media or other interfaces, record the required adapter, responsible owner and acceptance test in the proposal. A reviewer should distinguish an App design defect from a missing platform capability. The current verifier must not report unimplemented adapters as supported.

## App development sources

- `runtime/contracts/schemas/` is the source for shared schemas; `runtime/contracts/schema-validator.cjs` is the single compiler.
- `runtime/sdk/templates/` owns the opt-in reference helper templates. Generated copies keep App-only tests independent of a host checkout; domain-specific helpers may remain App-owned.
- `node runtime/build-contracts.cjs` regenerates shared schema copies, reference helpers, declared operation lists and dependency identities. `--check` detects drift. Authors maintain business tool contracts in `tools.json` and dependency versions in `app.json`; generated lists in `contribution.json` follow those sources.
- Domain behavior, provenance, workflows and limitations remain authored content. Do not generate invented evidence or replace business tests with manifest checks.

## Time and reset

A trusted registry can set `initial_time`; without it, the deterministic baseline is the Unix epoch. The App-only reference launcher reads optional `fixtures/clock.json` for its example time. A task supplies its own `virtual_now` to Infra's `env.load_seed`. Core validates and records that time; reset restores the loaded time and data baseline. Agent callers cannot set the clock. Real diagnostic timestamps remain separate.

For later sessions, runtime 1.6.0 adds the Infra-only `env.advance_time` operation. It advances the clock/version without replacing business records or the reset baseline. The external caller must process earlier due events, synchronize all enabled instances, verify the clocks, then resume actors. Event handlers observe their event time during processing. See the [time contract and executable example](runtime-time.md). This is a per-App primitive, not a global scheduler; a runner still owns the event cursor, user-harness state and Agent timeline.

An optional `plugin.migrateState(raw, target)` performs App-owned data migration; Core validates the result before accepting it. Framework envelope migrations remain in Core. Never add `if app_id == ...` branches to Core for individual products.

## Registering resource access

Apps describe parent-object relationships through `assetReferences`. To enable access for a new object type, include a proposed registration at `runtime/registrations/<app-id>.json`:

```json
{"app_id":"shop","resource_access":{"order":"shop.order.get"}}
```

An Infra maintainer reviews this platform registration alongside the declared read tool and access tests. The loader rejects write-tool mappings and cross-App tool names. Registration does not grant access: the task policy, account, parent object and attachment relationship must still permit the read. Unknown mappings remain denied. Registrations belong to the selected trusted runtime, not to Agent input or an unreviewed App manifest.

## Validation and scaling

App-only CI selects changed packages and their reverse dependencies. Shared runtime, registrations, contracts and reference-workflow changes run the complete suite. A manual full workflow remains available. Each App's business tests must cover its approved workflows and actual receiving-App outcomes.

The first profile still pins exact App/Core versions. Preserve that reproducibility. Future work should add tested compatibility ranges for declarations and an assembly lock recording exact resolved versions, contract hashes and data revisions. Do not resolve floating versions during a scored run.

Before large datasets or hosted evaluation, implement separately:

1. A domain/App catalog with stable App IDs, owners and capabilities; explicit instance/account IDs for multiple instances of the same App.
2. Versioned external datasets and asset readers with hashes and local caching. Keep small fixtures in Git; do not embed full datasets in state JSON. This download/storage adapter is not implemented here.
3. A state backend and separate evidence storage suited to long runs. Current whole-JSON persistence and inline blobs are for the small reference profile.
4. Web/CUA adapters sharing the same authoritative business state, plus a global clock/session runner. Validate these through dedicated integration suites before accepting them as implemented capabilities.

Contribution policy lives in `CONTRIBUTING.md`; proposal and implementation criteria live in `docs/review/`. Templates, checklists and skills should reference these sources rather than introduce independent acceptance rules.
