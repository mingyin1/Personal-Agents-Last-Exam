# Tasks App

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. Data is synthetic. See `tools.json` for exact inputs and outputs and `schemas/seed.schema.json` for records. Business logic lives in `src/`; `plugin.cjs` exports the standard hooks.

## Run locally

Requires Node.js 18 or newer. No package install, private Core, account or remote service is needed for these commands (from repository root):

```sh
node --test apps/tasks/tests/business.test.cjs
node apps/tasks/examples/run.cjs
node runtime/cli.cjs verify --app apps/tasks --output .artifacts/tasks.json
```

With only this App folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` from inside it. The test harness uses a transaction-local asset stub and copied public schema validator. Full MCP, permissions, real byte validation, persistence and replay are checked by the public runtime. `service.cjs` uses that runtime or `PALE_RUNTIME_ROOT`; it does not embed a second server.

## State and time

`fixtures/minimal.json` is initial history, `fixtures/binding.json` binds people/accounts, and `fixtures/policies.json` grants local scenario/sandbox actions. `fixtures/clock.json` sets the example clock. Task authors replace fixtures through Infra's `env.load_seed`; Agents cannot load history, reset or inject events. Writes use the run's virtual time, `expected_version` and `request_id`. Core owns commit receipts and audit; the App owns business history. Optional `ctx.log` contains identifiers and operation steps, not message/file contents.

`examples/scenario.json` demonstrates a `tasks.upsert` event, applied through `env.apply_event` at the supplied time. Updates must extend history, preserve creation time and retain existing revisions. `examples/task-data/` contains editable inputs. `env.snapshot`, `env.event_status` and `env.reset` expose inspection/replay to Infra.

## Integration and review

`contribution/contribution.json` declares actual Agent/Infra operations, events and messaging directions. Inspect the destination App's `tools.json`, receive declaration and schema before implementing a connection. No other App is required to run this package. Add pinned dependencies when an integration requires another package. See [cross-App guide](../../docs/app-integrations.md) and [implementation review](../../docs/review/app-implementation.md).

`gui/src/view.js` is an escaped, read-only reviewer renderer for host-provided records. The additive `pale.web` extension provides an interactive business Web App through the public Host; the legacy renderer profile stays compatible. MCP and the Web App share authoritative state. Asset bytes and metadata are separate; attachment reads use the parent record and platform registration. The public local media profile applies (64 assets, 1 MiB per instance).

## Package map

```text
app.json                     Package identity, entrypoints and pinned dependencies
tools.json                   Agent operations and input/output schemas
service.cjs                  Public MCP launcher (platform-provided entry)
plugin.cjs                   Standard hooks delegating to src/
src/                         Business operations, invariants, events and diagnostics
schemas/                     Seed/state/event rules and copied public media contracts
contribution/                Capabilities, GUI declaration, media catalog and provenance
gui/                         Business page/controller plus compatible reviewer renderer
assets/                      Actual fixture bytes (catalog references live here)
fixtures/                    Initial records, account bindings, policy and clock
examples/run.cjs             Runnable event example without a host
examples/scenario.json       Input to an Infra event injection, not an automatic scheduler
examples/task-data/          Replaceable task seed/binding/policy examples
tests/                       App-only tests, schema validator and transaction-local harness
LICENSE                      MIT for this implementation and synthetic fixtures
```

The full suite and open-source design references are documented in [personal Apps](../../docs/personal-apps.md). The implementation is original PALE code; it is not a fork or deployment of the reference products.

## Interactive business Web App

See [GUI startup and boundaries](gui/README.md). From the public repository root run `node runtime/web/server.cjs --app tasks --run web-demo --profile sandbox`. The App owns its controls in `gui/src/app.js`; the shared Host exposes only the fixed Agent connection.
