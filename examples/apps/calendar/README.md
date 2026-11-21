# Calendar App example

A synthetic App contribution package using the current reference manifest, tool schemas and contribution declarations. Business code is in `src/`; `plugin.cjs` exports the functions consumed by the platform.

## Run locally

Requires Node.js 18 or later; no package installation, credentials or platform source is needed.

```sh
cd examples/apps/calendar
npm test
npm run example
```

Tests call the real App business functions with an in-memory fixture. They check domain behavior and errors. They do not implement or certify platform permissions, persistence, reset, concurrency, MCP transport or cross-App routing. `tests/cases.json` supplies a valid tool call for platform validation.

## Platform execution

`service.cjs` is the provided launcher for the public runtime. It can start from this example directory in the full checkout; use the common verifier to drive MCP automatically. App-only business tests still need no runtime.

The manifest and contribution declarations retain the reference format, including host-provided lifecycle behavior. A declaration is not proof that the local fixture implements that behavior. Public sample checks and platform integration evidence are reported separately.

## Files to follow

- `app.json`, `tools.json`, `schemas/`: identity, business interfaces and data formats.
- `plugin.cjs`, `src/`: domain validation, operations, event handlers and record relationships.
- `contribution/`: capabilities, renderer, asset catalog and data provenance.
- `fixtures/`: minimal synthetic records and bindings. Policy samples are supplied with the template.
- `assets/`, `gui/`: media bytes and optional renderer.
- `examples/`, `tests/`: a local event demonstration, unit tests and platform input examples.

Data and media provenance is recorded in `contribution/dataset.json`; the inherited synthetic media review remains pending. Review asset reuse before final merge. See [the contribution guide](../../../docs/app-contribution.md).

## Business results and step diagnostics

`handleTool` still returns `{ data, result }`. The host validates and commits the data, then returns the business result through MCP. Diagnostic steps are not part of the result, tool schema or App state.

Key operations and incoming events call the optional `ctx.log(step, details)` hook through `src/diagnostics.cjs`. The helper tolerates a missing or failing hook so older hosts and standalone business use keep the same behavior. App steps describe checks and prepared changes; only the host can confirm a persisted commit. Use fixed step names and minimal IDs/counts, not message text, addresses, credentials, codes or complete records.

The local test fixture exposes `fixture().logs`. `npm run example` prints a separate `diagnostic_steps` section, and `npm test` checks successful and failed paths, unchanged results/state, and absent/failing log hooks. This collector is in-memory only: it is not the platform log service or proof of persistence.

The platform owns correlation IDs, timestamps, storage, access and retention. See [the contributor logging contract](../../../docs/app-contribution.md#business-results-and-optional-diagnostics) for the division of responsibilities. Diagnostic persistence requires the host logging extension; a host without that optional extension can still run the business operations.


## Public runtime integration

This App now launches with the public runtime in the same checkout. Existing business tool schemas and MCP response envelopes are preserved. App 1.3.0 adds attachment tools; use public runtime 1.4.0 for these additions. From the repository root:

```sh
npm run app:verify -- --app examples/apps/calendar --output .artifacts/calendar.json
npm test
```

See [App integration instructions](../../../docs/app-integrations.md) before using this App from another package. Inspect this App's `tools.json` and declared receive contracts; do not copy its backend or write its state files. Public local verification does not establish remote deployment authentication.

## Attachment workflows

`calendar.attachment.add` accepts `id`, `files`, `expected_version` and `request_id`. Each file supplies a filename, MIME type, canonical base64 bytes and SHA-256, plus media metadata when applicable. `calendar.attachment.get` takes `id` and `asset_id`, and returns `file`; `calendar.attachment.remove` removes the selected record's reference. Core applies parent-record access checks and commits bytes with business state. Removed references are no longer readable; reset restores the loaded baseline.

The App calls the injected `ctx.assets.add` / `ctx.assets.read`; it does not implement storage, permissions or reset. App-only tests use a small fake context to test business decisions. The public runtime suite separately checks actual bytes, hashes, access, rollback, retry and persistence.

From the repository root, run `npm run example:attachments` for the complete order notification → Mail → Calendar workflow. See [attachment implementation and acceptance](../../../docs/app-attachments.md).

## ICS import and event versions

`calendar.import_ics` takes `text`, `expected_version` and `request_id`. It accepts one VEVENT with UTC DTSTART/DTEND, UID, DTSTAMP and SUMMARY, plus LOCATION, SEQUENCE and CONFIRMED/CANCELLED status. Repeated UID/sequence/content reuses the existing event; a newer sequence updates it; stale or equal-but-conflicting versions are rejected. Unsupported calendar properties are rejected explicitly. Export uses the supplied virtual clock for DTSTAMP.

Calendar event updates preserve UID and reject lower sequences. Attachments belong to their event; cancelled events cannot receive attachment edits. Calendar remains independently usable through its business tools and Infra events.

## Interactive business Web App

See [GUI startup and boundaries](gui/README.md). From the public repository root run `node runtime/web/server.cjs --app calendar --run web-demo --profile sandbox`. The App owns its controls in `gui/src/app.js`; the shared Host exposes only the fixed Agent connection.
