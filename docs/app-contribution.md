# Contributing an App

Build a reusable App that tasks can populate and operate. Start with an [Environment proposal](../proposals/templates/environment-proposal.md), agree on scope, then add the implementation and evidence to the same PR. The [repository process](../CONTRIBUTING.md#review-and-implementation) remains authoritative.

The public checkout now contains the same local Core and Messaging implementation used for reference integration checks. Contributors can run business tests and real MCP integration without private source, credentials, a model API or a remote service. This is a proposed reference runtime, not a declaration that PALE production infrastructure is finalized.

## Where to start

- [Mail](../examples/apps/mail/README.md): a complete Mail reference package.
- [Calendar](../examples/apps/calendar/README.md): a separate Calendar reference package.
- [Shared personal Apps](personal-apps.md): Files, Messages, Notes, Tasks and Contacts packages, open-source design references and executable cross-App checks. New packages use `apps/<app-id>/`; Mail and Calendar stay in their existing reference locations.
- [App integration guide](app-integrations.md): **read this before connecting to an existing personal or external App**.
- [Public runtime](../runtime/README.md): launch, validation, state, diagnostics and current limitations.
- [Proposal review](review/environment-proposal.md) and [implementation review](review/app-implementation.md): review expectations.
- [App implementation acceptance checklist](review/app-implementation-checklist.md): scope, public delivery, actual GUI/MCP workflows and evidence required for acceptance.

Keep the reference Mail and Calendar under `examples/apps/`. New contributed Apps go under `apps/<app-id>/`, subject to maintainer scope/location review. Personal and external Apps use the same package contract. Do not copy an existing receiving App into your package to implement an integration.

See [architecture and extension boundaries](environment-architecture.md) for shared sources, task clocks, resource registration and the distinction between this reference profile and future Web/CUA or larger-data adapters.

## Common package structure

This tree describes common responsibilities. Each App supplies its own domain files; it is not a combined Mail/Calendar checklist.

```text
apps/<app-id>/
├── app.json                  # Identity, version, dependencies and package-local entry/file references
├── package.json              # Documented business test and example commands
├── tools.json                # Business operations: names, inputs, outputs and read/write effects
├── service.cjs               # Provided launcher for the public host; no business logic here
├── plugin.cjs                # Thin exports of the hooks required by the host
├── src/                      # Your business implementation, organized freely by domain
│   ├── model.cjs             # Record consistency, object IDs and cross-App/media relationships
│   ├── operations.cjs        # Tool handlers and business transitions
│   ├── events.cjs            # Handlers for declared incoming events, when supported
│   ├── diagnostics.cjs       # Optional safe ctx.log adapter
│   └── ...                   # Optional messaging, formats, helpers or larger business modules
├── schemas/                  # App-owned business rules plus matching provided public contracts
│   ├── seed.schema.json      # Account and business records accepted as initial/history data
│   ├── events.schema.json    # Declared incoming operations and the payload each handler accepts
│   ├── state.schema.json     # Provided Core state envelope referring to this App's data rules
│   ├── resources.schema.json # Provided resource descriptions/operations, when the App uses resources
│   ├── ...payload.schema.json # Optional channel-specific business content owned by the receiver
│   ├── router-message.schema.json # Optional generated CloudEvents + payload wire contract
│   └── ...                   # Matching provided asset, catalog, bundle, dataset and quality contracts
├── contribution/
│   ├── contribution.json     # Interfaces, lifecycle, dependencies and independent publishes/receives
│   ├── gui.json              # Optional renderer/GUI declaration when referenced by the manifest
│   ├── assets.catalog.json   # Asset identity, format, location, provenance and parent relationships
│   └── dataset.json          # Record/media sources, generation, counts and quality-review status
├── fixtures/                 # Minimal synthetic records; tasks may replace these with their history
│   ├── minimal.json          # Accounts and business records matching the seed schema
│   ├── binding.json          # Example people, accounts and object relationships
│   └── policies.json         # Provided local policy samples, applied by Core
├── assets/                   # Optional real fixture bytes; records reference asset IDs
├── gui/                      # Optional App-owned renderer; describe its actual intended audience
│   ├── src/                  # Components/pages use authorized interfaces and the same App state
│   └── README.md             # Host requirements, supported interactions and unimplemented UI scope
├── examples/                 # Runnable walkthrough and valid event/message inputs
│   ├── run.cjs               # Uses fresh synthetic data to show actual business state changes
│   ├── scenario.json         # One valid incoming event, if supported; does not schedule itself
│   └── ...                   # Optional message input or replacement Task-data example, as relevant
├── tests/                    # App business tests and inputs for common host checks
│   ├── business.test.cjs     # Domain success/failure tests; may delegate to additional test modules
│   ├── harness.cjs           # App-only in-memory test context; not a second Core implementation
│   └── cases.json            # Valid business-call input for the public verifier, including a read
├── README.md                 # Setup, workflow coverage, dependencies, commands and limitations
└── LICENSE                   # Code license; data/media reuse conditions belong in dataset.json
```

The runtime is a sibling shared component, not something each App author reimplements. Its `core/`, `messaging/`, contracts and tests live under [`runtime/`](../runtime/README.md).

Run `node runtime/build-contracts.cjs` after editing the canonical shared contracts or App tool/dependency declarations. Generated package copies allow standalone verification; do not hand-maintain duplicate schemas or operation lists. App-owned business schemas, behavior and provenance still need direct review.

### How the reference Apps differ

| Package | App-specific files and behavior |
| --- | --- |
| Mail | `src/messaging.cjs`, `publisher.cjs`, `message-envelope.cjs`; Email payload/wire schemas; incoming mail, text notifications and a separate file-bearing notification contract. |
| Calendar | `src/formats/ical.cjs` and `import-ical.cjs`; event attachments, calendar ranges, conflict/sequence rules and `calendar.upsert` examples. Its messaging send/receive lists are empty. |

Copy only capabilities relevant to your App. A Calendar-like App need not have an Email payload file; a send-only App need not implement a receiver.

## Implement business behavior

Keep `plugin.cjs` small; put business modules under `src/`. The current hooks are `validateSeed`, `handleTool`, `applyEvent`, `records`, `objects` and `references`; resource-bearing Apps also expose `assetReferences`. An App with no incoming events may reject all event operations and declare none.

`handleTool(ctx, data, name, args)` operates on a working copy and returns `{ data, result }`. `applyEvent` returns updated business data. Core validates input/output and business records, controls persistence, and returns the existing result/status/version through MCP. A read-only handler may not change business data.

Tasks supply actual accounts, history, preferences and scenario events. Apps define valid records and resulting transitions. Infra loads history with `env.load_seed`, applies changes with `env.apply_event`, and manages reset/snapshot. These administrative operations are unavailable to Agent connections, including when an Agent guesses their names.

Use the supplied `ctx.virtual_now` for current-time business fields. Infra advances idle Apps with Core's `env.advance_time` before later sessions; contributors do not implement that tool or change their schemas. Event handlers observe their event's `at` time. The [time contract and example](runtime-time.md) explain initial/history time, session synchronization, delivery time and reset behavior.

Contributors describe business effects and record relationships. Core enforces local policy; production Infra supplies trusted identities, credentials and deployment access controls. Authors do not implement token issuance or authentication policy.

## Connecting to another App

First inspect the receiving App's `tools.json`, `contribution/contribution.json` and referenced schemas. Use business tools for actions such as creating a Calendar event. Use a declared messaging receive contract for asynchronous-style notifications such as an order notice. [The integration guide](app-integrations.md) explains both paths, account binding, version matching and examples.

A message declaration is a capability, not a grant. Infra supplies permitted sources, target accounts and explicit grants. Do not choose arbitrary receiver URLs, write another App's state files, create a shadow inbox/calendar, or bypass its business handler.

## Business results and optional diagnostics

`{ data, result }` remains the business return. An optional `ctx.log(step, details)` channel records checks and prepared changes separately. The App-local diagnostics helper tolerates a missing or failing hook; it never decides that a commit occurred.

Use stable step names and minimal non-sensitive metadata: object IDs, counters, booleans and changed field names. Never log bodies, subject lines, addresses, authentication codes, tokens, raw requests or full state. Core adds trusted run/App/call identity, real and virtual times, and the outcome after persistence. Diagnostics do not appear in Agent tools, resources, MCP business returns or business state.

The public local host writes `<state-dir>/<run>/<app>.debug.jsonl`. Reset retains the separate diagnostic file. It is a best-effort sink, not a transactional archive; remote access, central collection, retention and alerts remain deployment concerns. Logging is optional unless included in the approved delivery scope.

## Data, media and history

`fixtures/` holds small reusable examples, not a complete evaluation task. A Task can supply different historical records using the same seed schema. Store asset bytes under `assets/`, associate them by ID, and describe MIME, integrity, parent objects and provenance in the catalog. UI images and content attachments are distinct uses.

The reference profile supports PDF, UTF-8 text, ICS, PNG/JPEG, MP3/WAV, MP4 and JSON in local bundles of at most 64 assets / 1 MiB. Attachment operations accept up to eight files per call. File storage and format checks do not perform OCR. New App resource-access mappings require platform review; unknown mappings deny access rather than trusting App-supplied authorization code.

## Verify before submission

Node.js 18+ is required. Current examples and runtime use Node built-ins and need no package installation.

App-only business checks still work with just that App directory:

```sh
cd examples/apps/mail
npm test
npm run example
```

From a full public checkout, run real host checks:

```sh
npm run app:verify -- --app examples/apps/mail --output .artifacts/mail.json
npm run app:verify -- --app examples/apps/calendar --output .artifacts/calendar.json
npm run example:delivery-to-mail
npm run example:mail-to-mail
npm test
```

For a new package, use `--app apps/<app-id>`. Supply each pinned App dependency with `--with PATH`; the verifier never silently substitutes an unavailable dependency. The common checker uses `tests/cases.json.read` and, for declared incoming events, `examples/scenario.json`. Missing business-test evidence is reported as not run. A legitimately different App interface needs an agreed validation adapter, not invented functionality just to satisfy a reference test.

The verifier copies exact packages to temporary state, loads real Core, uses separate Agent and Infra MCP connections, and records versioned results. Temporary directories are not containment of malicious code; inspect submissions before executing them. Local credentials are unnecessary.

`npm test` also checks media, concurrency, failure atomicity, logging, four messaging directions, delivery rejection, retries, source time, lost acknowledgements and a non-Mail receiver. Mail is an example destination, not a built-in routing requirement. These checks exercise the reference packages; a new App must add evidence for its own approved workflows.

## Submit and review

Submit the App package, exact commands, package/runtime versions, verification reports, workflow-to-test mapping and provenance. Generated state/logs stay out of source control. Reports should use synthetic data and be attached as review evidence.

CI reruns checks without production credentials. For App-only PRs, a separate job uses the base revision's public validator; modifying the candidate's validator cannot establish independent compatibility. Runtime changes require Infra review. During the initial runtime bootstrap, unavailable base-runtime checks are explicitly not run.

Maintainers reproduce essential outcomes and review business usefulness, GUI behavior where promised, media quality and provenance against the approved proposal. Public reference-runtime success is not automatic acceptance or evidence that production remote authentication is deployed.

## File-bearing workflows

See [attachment implementation and verification](app-attachments.md) for the receiver-owned contract, `ctx.assets` interface, Mail/Calendar tools, runnable example and the exact proposal fields to fill. Run `npm run example:attachments` from the repository root.
