'use strict';
// Infra-run sender for Rainshadow notices: an outbound adapter, in the pattern of Mail's
// src/publisher.cjs. It is not part of the App's business entrypoint and is never given to
// the Agent. Infra runs it with its own trusted connections and supplies both clients:
//
//   source  an Infra MCP client of this Rainshadow instance (`call(name, args)`)
//   router  a publisher client of Messaging for this package (`call('router.publish', ...)`)
//
// It imports nothing outside this file. It reads notices through `env.snapshot`, treats a
// notice as released once the snapshot's `virtual_now` has reached its release time, and
// publishes the wire message that the App stored with the notice. Whether a message reaches
// Mail is decided by Messaging from the run's bindings and grants, and the receipt comes
// from the receiver. The sender never writes into Rainshadow or into another App, so no
// cross-App transaction is assumed.
//
// Time needs no App event: a notice held at 23:10 with release time 07:00 is published by
// the first run of this adapter after Infra has moved the clock to 07:00 or later, whether
// that was an event or Core's `env.advance_time`.
//
// What counts as already sent:
//   - Notices that were in the loaded seed are history, unless they were still held at the
//     time the seed was loaded; those are published once their release time has passed.
//   - `sent` is the caller's own log ({ [notice_id]: receipt summary }). Pass it back on the
//     next run so that nothing is published twice; Messaging also returns the first receipt
//     for an identical retry inside one router session.

const instant = value => Date.parse(value);

// Notices to dispatch now: a stored wire message, release time reached, not history and not in `sent`.
function pending(snapshot, sent = {}) {
  const now = instant(snapshot.virtual_now), loadedAt = instant(snapshot.initial_virtual_now ?? snapshot.virtual_now);
  const history = new Set(((snapshot.initial_data && snapshot.initial_data.notices) || []).map(n => n.id));
  return snapshot.data.notices.filter(n => n.wire !== undefined && instant(n.release_at) <= now
    && (!history.has(n.id) || instant(n.release_at) > loadedAt) && sent[n.id] === undefined);
}

// Publishes every pending notice in order and stops at the first result that is not
// committed, so nothing is skipped silently. Returns the results and the updated log.
async function publishReleased({ source, router, sent = {} }) {
  const read = await source.call('env.snapshot');
  if (read.status !== 'ok') return { stage: 'source_read', result: read, results: [], sent };
  const snapshot = read.snapshot, results = [];
  for (const notice of pending(snapshot, sent)) {
    const request_id = 'rainshadow:' + snapshot.epoch + ':' + notice.id;
    const result = await router.call('router.publish', { request_id, message: notice.wire });
    results.push({ notice_id: notice.id, request_id, result });
    if (result.status !== 'committed') return { stage: 'router_rejected', results, sent };
    sent[notice.id] = { request_id, event_id: result.event_id, target: result.target, committed_at: result.committed_at };
  }
  return { stage: results.length ? 'delivered' : 'nothing_pending', virtual_now: snapshot.virtual_now, results, sent };
}

module.exports = { pending, publishReleased };
