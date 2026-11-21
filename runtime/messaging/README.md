# Messaging

Infra-owned one-hop messaging over local MCP stdio with a CloudEvents 1.0 JSON envelope. The implementation is public; operational grants, accounts and credentials remain run configuration. [App integration guide](../../docs/app-integrations.md).

```sh
npm run example:delivery-to-mail
npm run example:mail-to-mail
node runtime/tests/non-mail-routing.cjs
node runtime/messaging/tests/test_contract.cjs
node runtime/messaging/tests/test_messaging.cjs
node runtime/messaging/tests/test_time_trace.cjs .artifacts/time-trace.json
```

Run commands from the repository root. `service.cjs --config CONFIG --publisher APP --run RUN --state-dir DIR` exposes `router.capabilities` and, only for a declared publisher, `router.publish`. Configuration paths for packages and the receiver registry are relative to the public repository root. Do not pass this publisher connection to the Agent.

## Implementation responsibilities

| Module | Responsibility |
| --- | --- |
| `src/contracts.cjs` | Load App-owned send/receive declarations and versioned schemas; infer directions without a second registry of capabilities. |
| `src/config.cjs` | Validate trusted run configuration, enabled publisher and explicit grants. |
| `src/bindings.cjs` | Resolve one enabled receiver/account; check run, epoch and binding stability. |
| `src/authorization.cjs` | Match fixed source identity and allowed recipient/channel grants. |
| `src/router.cjs` | Call the declared receiver through MCP; only confirm delivery after its committed response. |
| `src/receipts.cjs` | Deduplicate request IDs and CloudEvents `(source,id)` in process; record metadata receipts without message bodies. |

No module implements Mail business rules or selects a destination by product name. A sender and receiver must agree on channel, type, payload/wire version and actual schema content. An explicit recipient and run grant are also required. Empty grant arrays deny delivery; missing grants reject configuration. Same owner alone is not authorization. Ambiguous recipients never broadcast.

Internal → external, external → internal and other directions use the same rules. A new channel needs an actual receiver contract/handler. Calendar currently has no messaging directions. The Noticebox custom-channel fixture proves the generic path but is not a full personal messaging product.

## Standards and PALE conventions

MCP supplies tool discovery/calls. CloudEvents supplies the envelope (`specversion: "1.0"`); this implementation uses the 1.0.2 specification's JSON object profile. It requires JSON object `data`, `datacontenttype`, and `dataschema`; it does not support binary/batch delivery or arbitrary context extensions. AsyncAPI is not included.

PALE defines its own routing fields, source URI naming, account grants, result receipts and MCP message argument. No official CloudEvents-over-MCP binding is claimed. The text Email wire format remains unchanged. File-bearing Email uses the additional `channel.email.attachments` declaration and `schemas/router-attachments.schema.json`. Common wire copies are checked with `npm run contracts:check`.

## Receipts, failure and time

A committed result contains the target account, event ID, state version and CloudEvents identity. Identical retries reuse the first receipt; changed content under either deduplication key is rejected. Every retry still checks receiver lifecycle. A reset or binding change invalidates the old route.

`cloud_event.time` preserves producer-reported time exactly when supplied; otherwise it is absent. Messaging `received_at` is arrival wall time, `applied_at` is receiver virtual time, and `committed_at` is when Messaging receives the successful acknowledgement. `receiver_trace` preserves Core's event receipt metadata. Core `processed_at` precedes durable persistence and is not itself a commit timestamp.

Infra must synchronize participating App clocks with `env.advance_time` before resuming actions/deliveries at a later logical-time boundary, after processing earlier due events. Messaging does not infer the current session time from the producer envelope. Advancing the receiver clock preserves its epoch/binding; a conflicting concurrent update is still rejected through the observed version. See the [time contract](../../docs/runtime-time.md) and [cross-session delivery example](../../examples/workflows/session-time/README.md).

Join receipt `event_id` to Infra `env.event_status` and the receiver audit within the same run/account/epoch. Mail's created record ID equals the delivery event ID; other receivers may expose a different documented relationship. Timestamps alone do not prove global order or identity.

If the receiver commits but acknowledgement is lost, the result is `unknown`, includes the attempted event ID, has no confirmed commit time and stops the run. Inspect receiver evidence before retrying. Deduplication is in-process; old-run reconnection is rejected. Logs are not a recovery queue and source/target commits are not atomic.

## Remote deployment remains separate

Trusted local launch identity is not remote authentication. HTTPS/OAuth, issuer/audience/scope/run checks, token lifecycle, separate destination credentials, delivery-only receiver access, network isolation and data/attachment authorization require deployment integration. Configuring `oauth` is rejected; it does not enable an unimplemented security layer. No production secrets are needed for these examples.
