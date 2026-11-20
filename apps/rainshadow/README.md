# Rainshadow

Rainshadow is a synthetic weather App for PALE: forecasts that always name their source and issue time, alerts that are message threads, and a personal layer of saved places, alert rules and weather watches. It follows the approved Environment proposal `proposals/environment/rainshadow.md`. All data is invented; there is no weather model and no live service.

Status: work in progress on the first version. Business behavior for all four workflows and the six events is implemented and covered by `npm test`; the Mail sender script and the evidence report are still to come (see "Not done yet").

## Run locally

Node.js 18 or later. No package installation, credentials, GPU or network.

```sh
cd apps/rainshadow
npm test            # App-only business tests (node --test tests/business.test.cjs)
npm run example     # one declared event changing state, with the package fixture
```

From the repository root, against the public reference runtime:

```sh
npm run app:verify -- --app apps/rainshadow --output .artifacts/rainshadow.json
node apps/rainshadow/tests/mcp.integration.cjs
```

## What it does

| Workflow | Tools (`rainshadow.` prefix) |
| --- | --- |
| W1 Places and preferences | `places.search`, `places.list`, `places.save`, `places.update`, `places.remove`, `sources.list`, `preferences.get`, `preferences.update` |
| W2 Forecast evidence (read-only) | `forecast.issuances`, `forecast.hourly`, `forecast.daily`, `conditions.get` |
| W3 Alerts | `alerts.list`, `alerts.get`, `alerts.acknowledge` |
| W4 Watches and notices | `watches.list`, `watches.get`, `watches.create`, `watches.update`, `watches.cancel`, `notices.list` |

Thirteen tools read and eight write. Every write takes Core's `request_id` and `expected_version`. The target object is always the argument `id` (a place, an alert or a watch) and a time window is always `start` / `end`. `watches.create` takes the place as `id` and returns the new watch as `id`.

Incoming events, applied by Infra with `env.apply_event`: `rainshadow.forecast.issued`, `rainshadow.observation.recorded`, `rainshadow.alert.issued`, `rainshadow.alert.updated`, `rainshadow.alert.cancelled`, `rainshadow.clock.advanced`. The App clock moves only through events. For an event at time T the App first runs timers due at or before T (held notices are released, watches end; due time, then ID), then applies the event, then evaluates the watches it affects and writes notices.

### Rules worth knowing

- A forecast read returns the latest issuance of the chosen source for the place, and names it (`issuance.id`, `issued_at`, `is_latest`). Rows are returned as issued. `coverage.missing` lists requested hours or days the issuance does not contain. Nothing is interpolated and no other source is used as a fallback.
- Stored values are metric. Results are converted to the account's units, and `units` names them. A watch threshold keeps the unit it was given and is compared on unrounded values.
- An alert's status is derived from its latest message and the clock: `upcoming`, `active`, `expired`, or `cancelled`. An alert affects a place when they share a zone.
- A watch needs a saved place. It is evaluated when it is created or changed and whenever a new issuance of its source or an alert message for its zones arrives. Hourly conditions look at the window hours that have not started; if none is left, the earlier hourly results stand until the window ends. `aqi` conditions use the latest daily air-quality forecast.
- Notices: one per alert message that matches a saved place's rule, and one when a watch becomes `triggered` or goes from `triggered` to `clear`. Other status changes (`clear` to `no_data`, `triggered` to `no_data`) are recorded in the activity log without a notice. Changes made by the Agent write no notice.
- Quiet hours hold a new notice until they end. Notices for `extreme` alerts are not held; a cancellation is never treated as extreme.
- App errors: `not_found`, `already_saved`, `place_in_use`, `invalid_window`, `invalid_timezone`, `stale_message`, `already_acknowledged`, `invalid_state`, `limit_exceeded`. The App also answers `invalid_arguments` for argument problems the input schema cannot express: an empty `patch`, a blank label, a unit that does not fit its variable, a cursor that is not a `next_cursor`. Events that would leave records inconsistent are rejected with `invalid_event`.
- `data.activity` has one row for every committed write, event and timer effect, with sequence, virtual time, actor (`agent`, `event`, `timer`), action, object ID and the `request_id` or `event_id` that caused it.

## Data and seeds

`fixtures/minimal.json` is a snapshot of a scripted synthetic history (two invented regions in two time zones, 6 places, 8 zones, 3 sources, 54 issuances, 12 observations, 6 alert threads, one account with 3 saved places, 3 watches and 8 notices). `dev/build-fixture.cjs` rebuilds it by replaying that history through the App's own functions; `dev/check-fixture.cjs` checks it independently. A task supplies its own records in the same shape (`schemas/seed.schema.json`) through `env.load_seed`, with its own `virtual_now`. The seed is history: every record in it counts as already issued.

`tools.json` and the App-owned schemas are generated from `dev/contracts.cjs` (`node dev/build.cjs`, `--check` for drift). Nothing under `dev/` runs at run time.

## Other Apps

No App is required. Mail is optional and send-only: when `preferences.email_notices` is on, each released notice also carries the full wire message for Mail's existing receive declaration (`channel.email`, `urn:pale:email-message:2`, see `schemas/router-message.schema.json`, a copy of Mail's schema). Rainshadow builds no inbox and never writes to another App.

## Not done yet

- The Infra-run sender script that publishes released notices through Messaging, and its Rainshadow → Mail integration test. Until then the `channel.email` publish declaration is marked `declared`, not `implemented`.
- The workflow-to-test mapping and reproducible evidence report for implementation review.
- Human review of realism (forecast numbers, alert and notice wording) and of the invented names.
