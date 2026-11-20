#!/usr/bin/env node
'use strict';
// Real-MCP checks on the public reference runtime, for what the common verifier does not
// exercise for this App: every tool through MCP with its declared output schema, Core
// contracts (T17), a task seed with its own virtual_now, failure atomicity, policy
// narrowing, the audit projection, and reset to the loaded seed and time (T18).
// Run from the public checkout:  node apps/rainshadow/tests/mcp.integration.cjs [report.json]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..'), root = path.resolve(appDir, '../..');
if (!require('./harness.cjs').publicRuntime()) { console.error('Public PALE runtime not found: run this from the public checkout, with the package at apps/rainshadow/.'); process.exit(2); }
const { prepare } = require(path.join(root, 'runtime/prepare.cjs')), { Client } = require(path.join(root, 'runtime/client.cjs'));
const A = 'rainshadow.', WREN = 'pl-wren-lake';
const at = (date, hhmm, offset = '-07:00') => date + 'T' + hhmm + ':00' + offset;
const clone = x => structuredClone(x);

async function main() {
  const prepared = prepare(appDir), clients = [], checks = [], started = Date.now();
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  const client = async (role, run = 'integration') => { const c = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'rainshadow-integration', { registry: prepared.registry }); clients.push(c); await c.initialize(); return c; };
  try {
    const infra = await client('infra'), agent = await client('agent');
    const snap = async () => (await infra.call('env.snapshot'));
    const version = async () => (await snap()).version;
    let n = 0;
    const write = async (name, args) => agent.call(A + name, { ...args, request_id: 'int-' + (++n), expected_version: await version() });
    const event = async e => infra.call('env.apply_event', { expected_version: await version(), event: e });

    // Discovery and policy narrowing under the default `scenario` profile.
    const scenarioTools = (await agent.request('tools/list')).result.tools.map(t => t.name);
    equal('scenario profile lists the 13 reads and 5 narrowed writes', [scenarioTools.length, scenarioTools.filter(x => x.startsWith('env.')).length], [18, 0]);
    check('a write outside the scenario profile is denied', (await write('places.save', { id: 'pl-tallowmere' })).status === 'permission_denied');
    const hike = { start: at('2026-11-21', '14:00'), end: at('2026-11-21', '17:00'), conditions: [{ variable: 'pop', value: 40 }] };
    check('an object outside the policy ids is denied', (await write('watches.create', { id: 'pl-marrowby', ...hike })).status === 'permission_denied');
    check('a field outside the policy fields is denied', (await write('places.update', { id: WREN, patch: { label: 'Elsewhere' } })).status === 'permission_denied');
    check('the allowed object and field commit', (await write('places.update', { id: WREN, patch: { alert_rule: { min_severity: 'severe' } } })).status === 'committed');
    for (const name of ['env.apply_event', 'env.reset', 'env.load_seed', 'env.snapshot']) check('Agent cannot call ' + name, (await agent.call(name, {})).status === 'permission_denied');

    // Every tool once through real MCP under `sandbox`; Core validates each result against tools.json.
    check('reset to the sandbox profile', (await infra.call('env.reset', { expected_version: await version(), profile: 'sandbox' })).status === 'ready');
    const baseline = (await snap()).snapshot;
    const all = (await agent.request('tools/list')).result.tools;
    equal('sandbox profile lists all 21 tools', [all.length, all.filter(t => t.annotations.readOnlyHint).length], [21, 13]);
    const window = { id: WREN, start: at('2026-11-21', '09:00'), end: at('2026-11-21', '16:00') };
    const reads = [
      ['places.search', { query: 'wren' }], ['places.list', {}], ['sources.list', {}], ['forecast.issuances', { id: WREN }], ['forecast.hourly', window], ['forecast.daily', window],
      ['forecast.daily', { ...window, source_id: 'src-aqb' }], ['conditions.get', { id: WREN }], ['alerts.list', { id: 'pl-marrowby', include_closed: true }], ['alerts.get', { id: 'al-0003' }],
      ['watches.list', { include_closed: true }], ['watches.get', { id: 'w-0002' }], ['notices.list', { limit: 100 }], ['preferences.get', {}],
    ];
    const timings = [];
    for (const [name, args] of reads) { const t0 = Date.now(), r = await agent.call(A + name, args); timings.push(Date.now() - t0); check('read ' + name + ' returns ok', r.status === 'ok' && r.app_id === 'rainshadow'); }
    equal('reads leave business data unchanged', (await snap()).snapshot.data, baseline.data);
    const saved = await write('places.save', { id: 'pl-tallowmere', label: 'Town' });
    const writes = [saved, await write('places.update', { id: 'pl-tallowmere', patch: { alert_rule: { paused: true } } }), await write('places.remove', { id: 'pl-tallowmere' }),
      await write('preferences.update', { patch: { units: 'us' } }), await write('alerts.acknowledge', { id: 'al-0002', message_id: 'al-0002-m2' })];
    const created = await write('watches.create', { id: WREN, ...hike, linked_object: { app_id: 'calendar', object_id: 'evt-hike' } });
    writes.push(created, await write('watches.update', { id: created.id, patch: { label: 'Afternoon', conditions: [{ variable: 'aqi', value: 101 }, { variable: 'alert' }] } }), await write('watches.cancel', { id: created.id }));
    equal('all 8 writes commit through MCP', writes.map(w => w.status), Array(8).fill('committed'));
    check('a committed write returns the object id and the new version', created.id === 'w-0004' && created.version.revision === (await version()).revision - 2);
    const after = (await snap()).snapshot;
    equal('each committed write added one activity row with its request_id', after.data.activity.slice(baseline.data.activity.length).map(a => [a.actor, a.action, a.request_id]), ['places.save', 'places.update', 'places.remove', 'preferences.update', 'alerts.acknowledge', 'watches.create', 'watches.update', 'watches.cancel'].map((x, i) => ['agent', x, 'int-' + (n - 7 + i)]));

    // T17: Core contracts.
    const v = await version(), args = { id: 'pl-port-brindle', label: 'Harbor', request_id: 'same-request', expected_version: v };
    const first = await agent.call(A + 'places.save', args), again = await agent.call(A + 'places.save', args);
    check('a repeated request_id returns the stored receipt', first.status === 'committed' && again.duplicate === true && again.version.revision === first.version.revision && again.place.label === 'Harbor');
    equal('the repeat did not write again', (await version()).revision, first.version.revision);
    check('the same request_id with different input is rejected', (await agent.call(A + 'places.save', { ...args, label: 'Other' })).status === 'idempotency_conflict');
    const stale = await agent.call(A + 'places.remove', { id: 'pl-port-brindle', request_id: 'stale-1', expected_version: v });
    check('a stale version is rejected and names the current one', stale.status === 'stale_version' && stale.applied === false && stale.current_version.revision === first.version.revision);
    check('caller cannot pass role or run', (await agent.call(A + 'places.list', { role: 'infra', run_id: 'other' })).status === 'invalid_arguments');
    check('a write without request_id is rejected', (await agent.call(A + 'places.remove', { id: 'pl-port-brindle', expected_version: await version() })).status === 'invalid_arguments');

    // Failure atomicity for a tool call and for an event.
    const beforeFail = (await snap()).snapshot, failed = await write('places.save', { id: 'pl-port-brindle' });
    const afterFail = (await snap()).snapshot;
    check('a business failure names its reason and applies nothing', failed.status === 'already_saved' && failed.applied === false);
    equal('a failed call leaves data and version unchanged', [afterFail.data, afterFail.revision], [beforeFail.data, beforeFail.revision]);
    check('Core appended a denial audit row', afterFail.audit.at(-1).decision === 'deny' && afterFail.audit.at(-1).reason === 'already_saved');
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    const early = await event({ ...scenario, event_id: 'too-early', at: at('2026-11-20', '19:00') });
    check('an event dated before the App clock is rejected', early.status === 'invalid_event' && early.applied === false);
    const bad = clone(scenario); bad.event_id = 'bad-rows'; bad.payload.hourly[0].start = at('2026-11-21', '09:30');
    check('an event with a half-hour row is rejected as invalid_event', (await event(bad)).status === 'invalid_event');
    equal('rejected events leave data unchanged', (await snap()).snapshot.data, afterFail.data);

    // An event through MCP: the timer-free path, the receipt, the audit projection.
    const applied = await event(scenario), stored = (await snap()).snapshot;
    check('the declared event commits and moves the clock', applied.status === 'committed' && stored.virtual_now === scenario.at);
    equal('the event receipt is queryable', (await infra.call('env.event_status', { event_id: scenario.event_id })).receipt.event_id, scenario.event_id);
    const watch = (await agent.call(A + 'watches.get', { id: 'w-0002' })).watch, newest = (await agent.call(A + 'notices.list', { limit: 1 })).notices[0];
    equal('the watch was evaluated again and a notice was written', [watch.status, watch.evaluation.issuance.id, newest.kind, newest.object.id], ['triggered', 'iss-pfo-wren-4', 'watch.triggered', 'w-0002']);
    await agent.call(A + 'forecast.hourly', window);
    const audit = (await snap()).snapshot.audit.at(-1);
    equal('the audit row of a read shows the place and the window', [audit.tool, audit.decision, audit.input], [A + 'forecast.hourly', 'allow', window]);

    // A task seed with its own clock, then reset to that seed and that time (T18).
    const task = clone(baseline.data), taskNow = '2026-11-21T06:30:00-06:00';
    task.saved_places = task.saved_places.slice(0, 1); task.watches = []; task.notices = []; task.acknowledgements = []; task.activity = [];
    task.preferences = { units: 'us', default_source_id: 'src-skyline', timezone: 'America/Chicago', quiet_hours: { enabled: false, start: '23:00', end: '06:00' }, email_notices: false };
    const loaded = await infra.call('env.load_seed', { expected_version: await version(), data: task, virtual_now: taskNow, request_id: 'task-seed' });
    check('Infra loads a task seed with its own virtual_now', loaded.status === 'ready' && loaded.loaded === 89);
    const taskSnap = (await snap()).snapshot;
    equal('the loaded seed and time are the baseline', [taskSnap.data, taskSnap.virtual_now, taskSnap.initial_virtual_now, taskSnap.audit.length], [task, taskNow, taskNow, 1]);
    const prefs = (await agent.call(A + 'preferences.get', {})).preferences;
    equal('the Agent sees the task account', [prefs.units, prefs.default_source_id, (await agent.call(A + 'places.list', {})).places.length], ['us', 'src-skyline', 1]);
    const unbound = clone(task); unbound.account_id = 'someone-else';
    check('a seed for an account the binding does not declare is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: unbound })).status === 'invalid_seed');
    const dangling = clone(task); dangling.issuances[0].place_id = 'pl-nowhere';
    check('a seed with a dangling reference is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: dangling })).status === 'invalid_seed');
    const offset = clone(task); offset.issuances.find(i => i.hourly).hourly[0].start = '2026-11-19T22:00:00';
    check('a seed timestamp without a UTC offset is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: offset })).status !== 'ready');
    equal('rejected seeds leave the loaded baseline', (await snap()).snapshot.data, task);
    const twin = [await write('watches.create', { id: WREN, ...hike }), await write('watches.create', { id: WREN, ...hike })];
    equal('the Agent works on the task seed; two identical watches are two records', twin.map(w => [w.status, w.id]), [['committed', 'w-0001'], ['committed', 'w-0002']]);
    check('the clock moves by event', (await event({ event_id: 'task-clock', at: '2026-11-21T09:00:00-06:00', operation: 'rainshadow.clock.advanced', payload: {} })).status === 'committed');
    const reset = await infra.call('env.reset', { expected_version: await version() }), restored = (await snap()).snapshot;
    check('reset returns ready', reset.status === 'ready');
    equal('reset restores the loaded seed and the loaded time, and clears the audit', [restored.data, restored.virtual_now, restored.audit.length, restored.epoch > taskSnap.epoch], [task, taskNow, 1, true]);
    check('a version from before the reset is stale', (await agent.call(A + 'places.remove', { id: WREN, request_id: 'old-epoch', expected_version: taskSnap.version || { epoch: taskSnap.epoch, revision: taskSnap.revision } })).status === 'stale_version');
    const peer = await client('infra', 'other-run');
    equal('another run still has the package fixture', [(await peer.call('env.snapshot')).snapshot.data.watches.length, (await peer.call('env.snapshot')).snapshot.virtual_now], [3, at('2026-11-20', '20:00')]);

    const report = { schema: 'rainshadow.mcp-integration.v1', app_version: require('../app.json').version, runtime_version: require(path.join(root, 'runtime/package.json')).version, node: process.version, checks: checks.length, passed: true, read_call_ms: { max: Math.max(...timings), mean: Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) }, duration_ms: Date.now() - started, names: checks };
    if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: ' + checks.length + ' real-MCP checks for rainshadow ' + report.app_version + ' on runtime ' + report.runtime_version + ' (' + report.duration_ms + ' ms; read calls mean ' + report.read_call_ms.mean + ' ms, max ' + report.read_call_ms.max + ' ms).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
