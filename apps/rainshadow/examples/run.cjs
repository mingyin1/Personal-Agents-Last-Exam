'use strict';
// Local walkthrough with the App's real business functions and the package fixture.
// It shows one declared event changing business state: a newer forecast issuance for
// Wren Lake moves Saturday's storms into the hours a saved watch covers.
// Platform MCP, permissions, versions and persistence are verified separately.
const { fixture } = require('../tests/harness.cjs');
const app = fixture(), event = require('./scenario.json');
const window = { id: 'pl-wren-lake', start: '2026-11-21T10:00:00-07:00', end: '2026-11-21T13:00:00-07:00' };
const brief = () => {
  const f = app.call('forecast.hourly', window), w = app.call('watches.get', { id: 'w-0002' }).watch;
  return {
    clock: app.now, issuance: f.issuance, hours: f.rows.map(r => ({ start: r.start, pop: r.pop, thunder_prob: r.thunder_prob })),
    daily_headline: app.call('forecast.daily', window).rows[0].headline, watch: { id: w.id, label: w.label, status: w.status, issuance_used: w.evaluation.issuance },
    notices: app.call('notices.list', { limit: 100 }).notices.length,
  };
};
const before = brief();
app.event(event);
const after = brief(), notice = app.call('notices.list', { limit: 1 }).notices[0];
console.log(JSON.stringify({ example: 'rainshadow', mode: 'local business functions', event: { event_id: event.event_id, at: event.at, operation: event.operation }, before, after, new_notice: notice }, null, 2));
if (before.watch.status !== 'clear' || after.watch.status !== 'triggered' || after.notices !== before.notices + 1 || notice.kind !== 'watch.triggered') {
  console.error('FAIL: the example did not produce the expected state change.');
  process.exit(1);
}
console.log('PASS: local App event example. Platform MCP, permissions and persistence are validated separately.');
