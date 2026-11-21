# Mail / Calendar across sessions

Run from a public checkout with Node 18+:

```sh
node examples/workflows/session-time/run.cjs
# Optional machine-readable report:
node examples/workflows/session-time/run.cjs /tmp/session-time.json
```

The example uses real local MCP connections, the public Core and Messaging, and temporary synthetic state. It cleans up afterward and does not touch an existing demo. It needs no model API, remote service or private Infra source.

Mail and Calendar start at **October 26, 19:40 Pacific**. Before session 3, the caller applies a due Calendar event and advances both Apps to **October 29, 12:00 Pacific**. No new Mail arrives between those sessions. Agent sends a billing follow-up; Mail records October 29, not the stale October 26 time. Calendar's ICS export uses the same logical instant.

The second part binds Messaging, advances the receiver to 12:05, then delivers a synthetic notification carrying an older producer time. It checks the received mail, Core audit/receipt and Messaging receipt. Clock advancement preserves the receiver lifecycle binding and producer time remains distinct.

Checks also cover unchanged business data, Agent denial, fixed time during reads/writes, persisted clock/retry after restart, competing management calls and reset to the original task baseline. Unit cases in `runtime/tests/clock.test.cjs` cover malformed/backwards time, equal instants, all seven App packages and failed-event rollback.

See the [Infra calling contract](../../../docs/runtime-time.md) for discovery, parameters, acknowledgements and the required pause / due-events / advance / confirm sequence. This example demonstrates that sequence for two Apps; the full orchestrator owns the run-wide schedule and failure coordination.
