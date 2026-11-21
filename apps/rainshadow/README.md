# Rainshadow

Rainshadow is a synthetic weather App for PALE: forecasts that always name their source and issue time, alerts that are message threads, and a personal layer of saved places, alert rules and weather watches. It follows the Environment proposal `proposals/environment/rainshadow.md` (PR #123). All data is invented; there is no weather model and no live service.

Status: first implementation pass, written before plan approval and kept on the author's fork until then. All four workflows, the five events, the optional Mail notices and the tests are in place for runtime 1.6.0. The evidence report for implementation review is written at submission, against the exact commit (see "Not done yet").

## Run locally

Node.js 18 or later. No package installation, credentials, GPU or network.

```sh
cd apps/rainshadow
npm test            # App-only business tests (node --test tests/business.test.cjs)
npm run example     # one declared event changing state, with the package fixture
```

Both run from a copy of this folder alone. Against the public reference runtime (1.6.0 or later), from the repository root:

```sh
npm run app:verify -- --app apps/rainshadow --output .artifacts/rainshadow.json
node apps/rainshadow/tests/mcp.integration.cjs --runtime runtime     # every tool, the Core contracts and env.advance_time through real MCP
node apps/rainshadow/tests/mail.integration.cjs --runtime runtime    # Rainshadow -> Messaging -> real Mail
```

The two scripts are given the runtime directory (`--runtime DIR`, or `PALE_RUNTIME_ROOT=DIR`); the first needs nothing else. The Mail flow also needs this package and the pinned Mail package inside that checkout, because the public Messaging router resolves a publisher package and its receiver registry relative to its own checkout. With `PALE_RUNTIME_ROOT` set, `npm test` runs both scripts as T17 and T15b; without it they are skipped and say so.

## What it does

| Workflow | Tools (`rainshadow.` prefix) |
| --- | --- |
| W1 Places and preferences | `places.search`, `places.list`, `places.save`, `places.update`, `places.remove`, `sources.list`, `preferences.get`, `preferences.update` |
| W2 Forecast evidence (read-only) | `forecast.issuances`, `forecast.hourly`, `forecast.daily`, `conditions.get` |
| W3 Alerts | `alerts.list`, `alerts.get`, `alerts.acknowledge` |
| W4 Watches and notices | `watches.list`, `watches.get`, `watches.create`, `watches.update`, `watches.cancel`, `notices.list` |

Thirteen tools read and eight write. Every write takes Core's `request_id` and `expected_version`. The target object is always the argument `id` (a place, an alert or a watch) and a time window is always `start` / `end`. `watches.create` takes the place as `id` and returns the new watch as `id`.

Five incoming events, applied by Infra with `env.apply_event`: `rainshadow.forecast.issued`, `rainshadow.observation.recorded`, `rainshadow.alert.issued`, `rainshadow.alert.updated`, `rainshadow.alert.cancelled`.

### Time

Time is the environment's. Rainshadow has no timers, no scheduler and no clock event. Infra moves `virtual_now` with an event or with Core's `env.advance_time`, which runs no App code.

- Every time-based state is stored as a due time and read against `ctx.virtual_now`: an alert's status from `onset` and `ends`, a notice's `held` or `released` from its `release_at`, a watch's `ended` from its window `end`. Nothing is rewritten when a due time passes.
- Writes use the same derivation. Once its window has ended, a watch cannot be edited or cancelled (`invalid_state`), no longer holds its place (`place_in_use`) and no longer counts towards the 20 open watches.
- An event is handled at its own `at`: a watch whose window has ended by then is not evaluated again, and a notice written then is held or released by the quiet hours at that time.
- The App never reads the wall clock.

### Rules worth knowing

- A forecast read returns the latest issuance of the chosen source for the place, and names it (`issuance.id`, `issued_at`, `is_latest`). The latest issuance is the stored one with the newest `issued_at`, whatever order they arrived in. Rows are returned as issued. `coverage.missing` lists requested hours or days the issuance does not contain. Nothing is interpolated and no other source is used as a fallback.
- Stored values are metric. Results are converted to the account's units, and `units` names them. A watch threshold keeps the unit it was given and is compared on unrounded values.
- An alert affects a place when they share a zone. Its status is `upcoming`, `active`, `expired` or `cancelled`.
- A watch needs a saved place. It stores a weather source and, exactly when it has an `aqi` condition, an air-quality source; each defaults to the account's default (`preferences.default_source_id`, `preferences.default_air_source_id`). It is evaluated when it is created or changed and whenever an issuance from one of its two sources for its place, or an alert message for its zones, arrives.
- Hourly conditions look at the window hours that have not started; if none is left, the earlier hourly results stand until the window ends. `aqi` conditions use the daily rows for the dates the rest of the window touches. The evaluation record names the weather issuance and the air-quality issuance it used, the hours and dates covered or missed, and what met each condition.
- Notices: one per alert message that matches a saved place's rule, and one when new information makes a watch `triggered` or takes it from `triggered` to `clear`. Other status changes (between `clear` and `no_data`, `triggered` to `no_data`) are recorded in the activity log without a notice. Changes made by the Agent write no notice.
- A notice written in quiet hours gets the end of that quiet period as its release time; any other notice is released as it is written. Notices for `extreme` alerts are not held; a cancellation is never treated as extreme.
- App errors: `not_found`, `already_saved`, `place_in_use`, `invalid_window`, `invalid_timezone`, `stale_message`, `already_acknowledged`, `invalid_state`, `limit_exceeded`. The App also answers `invalid_arguments` for what the input schema cannot express: an empty `patch`, a blank label, a unit that does not fit its variable, `aq_source_id` without an `aqi` condition, a cursor that is not a `next_cursor`. Events that would leave records inconsistent are rejected with `invalid_event`.

### Records for evaluators

- `data.activity`: one row for every committed Agent write, every applied event and every effect of an event (a notice written, a watch status changed), with sequence, virtual time, actor (`agent` or `event`), action, object ID and the `request_id` or `event_id` behind it.
- A replay (the same `request_id` or `event_id` again) returns the stored receipt marked `duplicate` and writes nothing: no activity row and no audit row. Count it as a retry of the original.
- A rejected call writes no activity row; Core appends one denial audit row for each attempt.
- Time-driven changes (a notice released, a watch ended, an alert becoming active or expired) run no App code and write no row. Read them from the stored due times and the clock; Core's audit has one row for each `env.advance_time` with the clock before and after.

## Data and seeds

`fixtures/minimal.json` is a snapshot of a scripted synthetic history (two invented regions in two time zones, 6 places, 8 zones, 3 sources, 54 issuances, 12 observations, 6 alert threads, one account with 3 saved places, 3 watches and 8 notices). `dev/build-fixture.cjs` rebuilds it by replaying that history through the App's own functions; `dev/check-fixture.cjs` checks it independently. The tests build their small variations from this fixture in code.

A task supplies its own records in the same shape (`schemas/seed.schema.json`) through `env.load_seed`, with its own `virtual_now`. The seed is history: every record in it counts as already issued. A seed stores no time-based state: a notice carries `release_at`, a watch its window, and both are read against the clock.

`tools.json` and the App-owned schemas are generated from `dev/contracts.cjs` (`node dev/build.cjs`, `--check` for drift). Nothing under `dev/` runs at run time.

## Package boundary

The package runs on its own. It imports only Node built-ins and its own files, reads no file outside its folder and uses no other App's files or state; a test checks this. `service.cjs` is the provided launcher, which finds the pinned runtime. `tests/schema-validator.cjs` is a copy of the public runtime's schema validator, so the App-only tests check every argument, result and state against the contracts without the runtime. The two real-MCP scripts are given the runtime's location.

## Other Apps

No App is required. Mail is optional and send-only. When `preferences.email_notices` is on at the moment a notice is written, the notice also carries the full wire message for Mail's existing receive declaration (Mail 1.3.0: `channel.email`, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`), dated at the notice's release time. `schemas/router-message.schema.json` is a copy of Mail's wire schema; Messaging compares the two by content. Rainshadow builds no inbox and never writes to another App.

Delivery is Infra's. `infra/sender.cjs` is an outbound adapter in the pattern of Mail's `src/publisher.cjs`: Infra runs it with its own connections and supplies both clients.

```js
const { publishReleased } = require('./infra/sender.cjs');
// source: an Infra MCP client of this Rainshadow instance; router: a publisher client of Messaging
const { stage, results, sent } = await publishReleased({ source, router, sent: previousLog });
```

- It reads notices through `env.snapshot`, treats a notice as released once the snapshot's `virtual_now` has reached its `release_at`, and calls `router.publish` with the stored wire message. A notice held at 23:10 is published by the first run after Infra has moved the clock to 07:00 or later, with no App event.
- Messaging decides from the run's bindings and grants whether the message reaches Mail. `infra/router.config.example.json` shows an Infra config that names this package as the publisher and grants the bound Mail account for `channel.email`; its paths are relative to the public checkout, as the router requires. Without a grant the delivery is rejected and Mail gets no record.
- Notices that came with the seed are history, unless they were still held when the seed was loaded.
- The sender never writes into Rainshadow. `sent` is the caller's log; pass it back on the next run. A rejected or unknown delivery does not roll anything back; Messaging stops the run on an unknown acknowledgement.
- Messaging deduplicates in one router session. After `env.reset` of Rainshadow, start Messaging with a new run, because notice IDs start again.

`tests/mail.integration.cjs` checks this with the real Mail package: the committed receipt, the message the Mail Agent reads, a held notice that is published only after `env.advance_time` has passed its release time, an identical retry, changed content, a forged source, a missing grant, and that Rainshadow's state is identical before and after dispatch.

## Workflow-to-test mapping

| Workflow | App-only tests (`tests/business.test.cjs`) | Real MCP |
| --- | --- | --- |
| W1 Places and preferences | T01, T02, T03 | `mcp.integration.cjs`: all W1 tools, policy narrowing by object and field |
| W2 Forecast evidence | T04, T05, T06, T07 | `mcp.integration.cjs`: reads leave data and version unchanged; the audit row of a read |
| W3 Alerts | T08, T09, T10, T11 | `mcp.integration.cjs`: alert status across `env.advance_time` |
| W4 Watches and notices | T12, T13, T13b, T14, T15 | `mcp.integration.cjs`: event, re-evaluation and notice; `mail.integration.cjs` (T15b) |
| All: the platform clock | T16, T16b | `mcp.integration.cjs`: `env.advance_time` with no App event |
| All: Core contracts | T17 runs `mcp.integration.cjs` | replays, stale versions, authority, failure atomicity |
| All: seeds, reset, activity log | T18 | `mcp.integration.cjs`: task seed with `virtual_now`, reset to the loaded seed and time |

## Not done yet

- The reproducible evidence report for implementation review (exact App, runtime and Mail versions, commands and reports), written at submission.
- Human review of realism (forecast numbers, alert and notice wording) and of the invented names.
