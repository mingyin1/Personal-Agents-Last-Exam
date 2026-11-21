# Virtual time: App / Core / Infra contract

An App uses `ctx.virtual_now` as its logical "now". Agent reads and writes do not advance it. Infra owns the scenario timeline and tells Core when time changes, even when no business event reaches an App. Wall-clock timestamps are for execution diagnostics, not task time.

This contract is implemented by public runtime **1.6.0**. The external Infra orchestrator is not in this repository; it must implement the coordination sequence below. [Runnable Mail / Calendar example](../examples/workflows/session-time/README.md).

## Responsibilities

| Owner | Responsibility |
| --- | --- |
| Task author | Supply the initial time, session/event times and the intended ordering of simultaneous events. Define business payload timestamps where needed. |
| Infra caller | Select the enabled App instances/accounts/run; pause actors and deliveries; process due events; advance each App and verify the barrier before starting/resuming a session. |
| Core | Expose Infra-only `env.advance_time`; validate the timestamp/version/request ID; commit the clock, acknowledgement and audit under the App's existing lock. Inject the resulting clock into business handlers. |
| App contributor | Use `ctx.virtual_now` for current-time business fields. Use event/payload timestamps according to the App contract. Do not use `Date.now()` as simulated time or implement a second scheduler. |
| Messaging | Deliver at the receiver's current virtual time. Preserve optional producer `CloudEvents.time` separately; never use it to advance the receiver. |

## Management operation

Call on each App's **Infra MCP connection**, after `tools/list` confirms `env.advance_time` is available. It is neither listed nor callable on the Agent connection. App/run/role are fixed by the launcher; they cannot be supplied as tool arguments.

```json
{
  "name": "env.advance_time",
  "arguments": {
    "request_id": "session-3-mail",
    "expected_version": { "epoch": 2, "revision": 0 },
    "virtual_now": "2026-10-29T12:00:00-07:00"
  }
}
```

Use the version returned by a fresh `env.snapshot`, not the literal example version. A first successful advance returns:

```json
{
  "status": "committed",
  "request_id": "session-3-mail",
  "previous_virtual_now": "2026-10-26T19:40:00-07:00",
  "virtual_now": "2026-10-29T12:00:00-07:00",
  "advanced": true,
  "app_id": "mail",
  "version": { "epoch": 2, "revision": 1 }
}
```

- Timestamp: valid date/time with explicit UTC offset or `Z`, using the runtime's date-time validator. Ordering compares instants, not string spelling. Sub-millisecond distinctions are not supported by the reference clock.
- Strictly later time: update `virtual_now` and increment `revision` once. Keep the epoch, business data, resources, IDs, permissions, previous receipts/audit and loaded reset baseline unchanged. No App event, business handler, reminder or outbound message is triggered.
- Equal instant: acknowledge with `advanced: false`, preserve the stored timestamp spelling and revision, and record the request receipt/audit. Existing observations remain usable.
- Earlier time: `invalid_time`; malformed/missing arguments: `invalid_arguments`; outdated version: `stale_version`; Agent caller: `permission_denied`. Failures do not change the clock or business state; the ordinary denial audit remains.
- Retry the **same request ID and target** after an unconfirmed reply. The original receipt is returned with `duplicate: true`, even if the supplied version is now old. It describes that original operation, not the current clock; verify the current state with `env.snapshot`.
- Reusing an accepted ID for another target returns `idempotency_conflict`. Clock IDs are scoped to the App instance/run/epoch, separate from business request IDs. Reset/seed replacement clears them along with existing receipts.
- A successful MCP acknowledgement follows the existing atomic state-file persistence. The clock receipt is in `snapshot.receipts["clock:<request_id>"]`; successful audit rows include `clock.from`, `clock.requested`, `clock.to` and the request ID. Core diagnostics record the call and persistence outcome. `env.event_status` remains for business events.

An advanced clock invalidates old write observations because they share the App revision. A stale caller must inspect the new snapshot and decide whether its operation is still appropriate; it must not blindly overwrite the version. There is no cross-App atomic commit.

## Required Infra sequence

For session start or any later logical-time boundary `T`:

1. Pause Agent/user actions and asynchronous deliveries for the participating run. Initialize newly enabled App instances before including them in the barrier. Check clock-tool support on every enabled instance; an older host must be upgraded or explicitly rejected for this workflow.
2. Process due scenario events **in chronological order before advancing beyond them**. At each event boundary, synchronize participating clocks as needed before event-triggered cross-App delivery. Wait for confirmed event and delivery outcomes. Task-defined tie ordering resolves simultaneous events.
3. Read each enabled instance's current version and call `env.advance_time(T)` on each. This includes Apps that received no events. A single App failure leaves the next session paused; other successful advances are not rolled back. Inspect, fix and retry using persisted receipts/current snapshots.
4. Confirm that every enabled instance's snapshot clock equals `T` as an instant, then resume Agent/user actions. Do the same for subsequent within-session time changes and delivery boundaries; one session-start update cannot cover a later jump.

Core cannot detect a missing App or an unprocessed Task event: these are caller obligations. A pending event at 09:05 will be rejected after that App has already advanced to 12:00. Do not move backwards, substitute its time, reload the seed or fabricate a business event to repair a missed scheduling boundary.

## Event and message time

`env.apply_event` still advances to `event.at`, but now exposes that time to `plugin.applyEvent` and subsequent validation **during** event processing. On rejection, both data and time roll back. The receipt's `virtual_received_at` remains the pre-event clock; `applied_at` is the accepted event time.

Business timestamps are distinct. For example, a Mail record's `received_at` follows its incoming event contract; Calendar `start` / `end` describe the appointment, not when the event was injected. Old records are not rewritten on clock advancement. A producer's optional `CloudEvents.time` can be older than delivery; Messaging preserves it and applies the notification at the already synchronized receiver clock. Wall-clock receive/process/commit observations remain separate.

## Compatibility and contributor impact

The existing Core API **1.2.0**, App business/state schemas, tool responses and generated App contribution declarations remain unchanged. `runtime/core/admin-tools.cjs` separates the six portable lifecycle operations from the host-provided clock extension. The SDK continues generating the portable baseline; contributors do not implement or duplicate this platform operation.

Old packages run on the new host without edits. An old host does not gain clock support from those packages; Infra must discover the operation or require runtime 1.6.0+. Independent base-runtime checks prove App package compatibility, not support for this new host capability.

`env.load_seed` continues to define the initial/reset clock, and `env.reset` restores it. Neither is a session synchronization substitute: they replace lifecycle/history state. Initial clocks in `fixtures/clock.json` remain useful for App-only examples. All seven existing Apps are checked against the same new Core operation, with no App package edits.
