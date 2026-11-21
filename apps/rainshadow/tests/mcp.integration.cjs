#!/usr/bin/env node
'use strict';
// Real-MCP checks on the public reference runtime, for what the common verifier does not
// exercise for this App: every tool through MCP with its declared output schema, Core
// contracts (T17), failure atomicity, replays and how they are counted, policy narrowing,
// the audit projection, time moved with Core's env.advance_time and no App event (T16),
// a task seed with its own virtual_now, and reset to the loaded seed and time (T18).
//
//   node tests/mcp.integration.cjs --runtime DIR [--report FILE]
//
// DIR is the `runtime` directory of a public PALE checkout, 1.6.0 or later (the clock
// operation). PALE_RUNTIME_ROOT=DIR works too. Nothing else outside this package is read.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..');
const sender = require('../infra/sender.cjs');

function options() {
  const out = { runtime: process.env.PALE_RUNTIME_ROOT };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--runtime', '--report'].includes(key) || !value) return null;
    out[key.slice(2)] = value;
  }
  return out.runtime ? out : null;
}
function runtimeAt(dir) {
  const root = path.resolve(dir);
  try { const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); return pkg.name === '@pale/app-runtime' ? { root, version: pkg.version } : null; } catch { return null; }
}
const opts = options(), runtime = opts && runtimeAt(opts.runtime);
if (!runtime) {
  console.error('Usage: node tests/mcp.integration.cjs --runtime DIR [--report FILE]\nDIR must be the runtime directory of a public PALE checkout (package @pale/app-runtime).');
  process.exit(2);
}
const { prepare } = require(path.join(runtime.root, 'prepare.cjs')), { Client } = require(path.join(runtime.root, 'client.cjs'));
const A = 'rainshadow.', WREN = 'pl-wren-lake';
const FRI = '2026-11-20', SAT = '2026-11-21', SUN = '2026-11-22';
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
    const state = async () => (await snap()).snapshot;
    const version = async () => (await snap()).version;
    let n = 0;
    const write = async (name, args) => agent.call(A + name, { ...args, request_id: 'int-' + (++n), expected_version: await version() });
    const event = async e => infra.call('env.apply_event', { expected_version: await version(), event: e });
    const advance = async (request_id, virtual_now) => infra.call('env.advance_time', { request_id, expected_version: await version(), virtual_now });

    // The App-only tests validate with a vendored copy of the host's schema validator.
    check('tests/schema-validator.cjs is identical to the validator of this runtime', fs.readFileSync(path.join(appDir, 'tests/schema-validator.cjs')).equals(fs.readFileSync(path.join(runtime.root, 'contracts/schema-validator.cjs'))));

    // Discovery and policy narrowing under the default `scenario` profile.
    const scenarioTools = (await agent.request('tools/list')).result.tools.map(t => t.name);
    equal('scenario profile lists the 13 reads and 5 narrowed writes', [scenarioTools.length, scenarioTools.filter(x => x.startsWith('env.')).length], [18, 0]);
    const infraTools = (await infra.request('tools/list')).result.tools.map(t => t.name).filter(x => x.startsWith('env.')).sort();
    check('the host offers its clock operation on the Infra connection (runtime 1.6.0 or later)', infraTools.includes('env.advance_time'));
    check('a write outside the scenario profile is denied', (await write('places.save', { id: 'pl-tallowmere' })).status === 'permission_denied');
    const hike = { start: at(SAT, '14:00'), end: at(SAT, '17:00'), conditions: [{ variable: 'pop', value: 40 }] };
    check('an object outside the policy ids is denied', (await write('watches.create', { id: 'pl-marrowby', ...hike })).status === 'permission_denied');
    check('a field outside the policy fields is denied', (await write('places.update', { id: WREN, patch: { label: 'Elsewhere' } })).status === 'permission_denied');
    check('the allowed object and field commit', (await write('places.update', { id: WREN, patch: { alert_rule: { min_severity: 'severe' } } })).status === 'committed');
    for (const name of ['env.apply_event', 'env.reset', 'env.load_seed', 'env.snapshot', 'env.advance_time']) check('Agent cannot call ' + name, (await agent.call(name, {})).status === 'permission_denied');

    // Every tool once through real MCP under `sandbox`; Core validates each result against tools.json.
    check('reset to the sandbox profile', (await infra.call('env.reset', { expected_version: await version(), profile: 'sandbox' })).status === 'ready');
    const baseline = await state();
    const all = (await agent.request('tools/list')).result.tools;
    equal('sandbox profile lists all 21 tools', [all.length, all.filter(t => t.annotations.readOnlyHint).length], [21, 13]);
    const window = { id: WREN, start: at(SAT, '09:00'), end: at(SAT, '16:00') };
    const reads = [
      ['places.search', { query: 'wren' }], ['places.list', {}], ['sources.list', {}], ['forecast.issuances', { id: WREN }], ['forecast.hourly', window], ['forecast.daily', window],
      ['forecast.daily', { ...window, source_id: 'src-aqb' }], ['conditions.get', { id: WREN }], ['alerts.list', { id: 'pl-marrowby', include_closed: true }], ['alerts.get', { id: 'al-0003' }],
      ['watches.list', { include_closed: true }], ['watches.get', { id: 'w-0002' }], ['notices.list', { limit: 100 }], ['preferences.get', {}],
    ];
    const timings = [];
    for (const [name, args] of reads) { const t0 = Date.now(), r = await agent.call(A + name, args); timings.push(Date.now() - t0); check('read ' + name + ' returns ok', r.status === 'ok' && r.app_id === 'rainshadow'); }
    const afterReads = await state();
    equal('reads leave business data and the version unchanged', [afterReads.data, afterReads.revision], [baseline.data, baseline.revision]);
    equal('each allowed read has one audit row', afterReads.audit.slice(-reads.length).map(r => [r.tool, r.decision]), reads.map(([name]) => [A + name, 'allow']));
    const saved = await write('places.save', { id: 'pl-tallowmere', label: 'Town' });
    const writes = [saved, await write('places.update', { id: 'pl-tallowmere', patch: { alert_rule: { paused: true } } }), await write('places.remove', { id: 'pl-tallowmere' }),
      await write('preferences.update', { patch: { units: 'us' } }), await write('alerts.acknowledge', { id: 'al-0002', message_id: 'al-0002-m2' })];
    const created = await write('watches.create', { id: WREN, ...hike, linked_object: { app_id: 'calendar', object_id: 'evt-hike' } });
    writes.push(created, await write('watches.update', { id: created.id, patch: { label: 'Afternoon', conditions: [{ variable: 'aqi', value: 101 }, { variable: 'alert' }] } }), await write('watches.cancel', { id: created.id }));
    equal('all 8 writes commit through MCP', writes.map(w => w.status), Array(8).fill('committed'));
    check('a committed write returns the object id and the new version', created.id === 'w-0004' && created.version.revision === (await version()).revision - 2);
    equal('a watch that gains an aqi condition takes the account\'s default air-quality source', writes[6].watch.aq_source_id, 'src-aqb');
    const after = await state();
    equal('each committed write added one activity row with its request_id', after.data.activity.slice(baseline.data.activity.length).map(a => [a.actor, a.action, a.request_id]), ['places.save', 'places.update', 'places.remove', 'preferences.update', 'alerts.acknowledge', 'watches.create', 'watches.update', 'watches.cancel'].map((x, i) => ['agent', x, 'int-' + (n - 7 + i)]));

    // T17: Core contracts, and how a replay and a rejection appear in the evaluator records.
    const v = await version(), args = { id: 'pl-port-brindle', label: 'Harbor', request_id: 'same-request', expected_version: v };
    const first = await agent.call(A + 'places.save', args), once = await state();
    const again = await agent.call(A + 'places.save', args), twice = await state();
    check('a repeated request_id returns the stored receipt', first.status === 'committed' && again.duplicate === true && again.version.revision === first.version.revision && again.place.label === 'Harbor');
    equal('the replay wrote nothing: same version, no activity row and no audit row', [twice.revision, twice.data.activity.length, twice.audit.length], [once.revision, once.data.activity.length, once.audit.length]);
    check('the same request_id with different input is rejected', (await agent.call(A + 'places.save', { ...args, label: 'Other' })).status === 'idempotency_conflict');
    const stale = await agent.call(A + 'places.remove', { id: 'pl-port-brindle', request_id: 'stale-1', expected_version: v });
    check('a stale version is rejected and names the current one', stale.status === 'stale_version' && stale.applied === false && stale.current_version.revision === first.version.revision);
    check('caller cannot pass role or run', (await agent.call(A + 'places.list', { role: 'infra', run_id: 'other' })).status === 'invalid_arguments');
    check('a write without request_id is rejected', (await agent.call(A + 'places.remove', { id: 'pl-port-brindle', expected_version: await version() })).status === 'invalid_arguments');

    // Failure atomicity for a tool call and for an event.
    const beforeFail = await state(), failed = await write('places.save', { id: 'pl-port-brindle' });
    const afterFail = await state();
    check('a business failure names its reason and applies nothing', failed.status === 'already_saved' && failed.applied === false);
    equal('a failed call leaves data and version unchanged and writes no activity row', [afterFail.data, afterFail.revision], [beforeFail.data, beforeFail.revision]);
    equal('Core appended one denial audit row for the rejected attempt', [afterFail.audit.length, afterFail.audit.at(-1).decision, afterFail.audit.at(-1).reason], [beforeFail.audit.length + 1, 'deny', 'already_saved']);
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    const early = await event({ ...scenario, event_id: 'too-early', at: at(FRI, '19:00') });
    check('an event dated before the App clock is rejected', early.status === 'invalid_event' && early.applied === false);
    const bad = clone(scenario); bad.event_id = 'bad-rows'; bad.payload.hourly[0].start = at(SAT, '09:30');
    check('an event with a half-hour row is rejected as invalid_event', (await event(bad)).status === 'invalid_event');
    const gone = { event_id: 'no-clock-event', at: at(FRI, '20:10'), operation: 'rainshadow.clock.advanced', payload: {} };
    check('Rainshadow has no clock event: the old operation name is rejected', (await event(gone)).status !== 'committed');
    const afterRejected = await state();
    equal('rejected events leave data and the clock unchanged', [afterRejected.data, afterRejected.virtual_now], [afterFail.data, afterFail.virtual_now]);

    // An event through MCP: handled at its own time, with a receipt and the audit projection.
    const applied = await event(scenario), stored = await state();
    check('the declared event commits and moves the clock to its own time', applied.status === 'committed' && stored.virtual_now === scenario.at);
    equal('the event receipt is queryable', (await infra.call('env.event_status', { event_id: scenario.event_id })).receipt.event_id, scenario.event_id);
    const watch = (await agent.call(A + 'watches.get', { id: 'w-0002' })).watch, newest = (await agent.call(A + 'notices.list', { limit: 1 })).notices[0];
    equal('the watch was evaluated again and a notice was written at the event time', [watch.status, watch.evaluation.issuance.id, watch.evaluation.evaluated_at, newest.kind, newest.object.id, newest.created_at, newest.release_at], ['triggered', 'iss-pfo-wren-4', scenario.at, 'watch.triggered', 'w-0002', scenario.at, scenario.at]);
    const beforeReplay = await state(), replayed = await event(scenario), afterReplay = await state();
    equal('a repeated event returns the stored receipt and writes nothing: same version, no activity row and no audit row', [replayed.duplicate, afterReplay.revision, afterReplay.data.activity.length, afterReplay.audit.length], [true, beforeReplay.revision, beforeReplay.data.activity.length, beforeReplay.audit.length]);
    await agent.call(A + 'forecast.hourly', window);
    const audit = (await state()).audit.at(-1);
    equal('the audit row of a read shows the place and the window', [audit.tool, audit.decision, audit.input], [A + 'forecast.hourly', 'allow', window]);

    // T16: the platform clock. Infra moves time with env.advance_time; no App code runs.
    const alert = { event_id: 'ev-al-0030', at: at(FRI, '23:10'), operation: 'rainshadow.alert.issued', payload: { alert_id: 'al-0030', source_id: 'src-pfo', category: 'flood', zone_ids: ['z-wren'], message: { message_id: 'al-0030-m1', type: 'alert', sent_at: at(FRI, '23:10'), event: 'Flood Watch', severity: 'moderate', urgency: 'future', certainty: 'possible', onset: at(SAT, '18:00'), ends: at(SUN, '02:00'), headline: 'Flood Watch from Saturday evening through late Saturday night', description: 'Heavy rain may cause flooding of creeks and low crossings.', instruction: 'Be ready to move to higher ground.' } } };
    check('an alert that arrives in quiet hours commits', (await event(alert)).status === 'committed');
    const t0 = await state(), heldNotice = t0.data.notices.at(-1);
    const noticeState = async () => (await agent.call(A + 'notices.list', { limit: 1 })).notices[0].state;
    const alertStatus = async () => (await agent.call(A + 'alerts.get', { id: 'al-0030' })).alert.status;
    const watchStatus = async () => (await agent.call(A + 'watches.get', { id: 'w-0002' })).watch.status;
    equal('the notice is held with a release time at the end of the quiet period, and its wire message is dated then', [heldNotice.created_at, heldNotice.release_at, heldNotice.wire.time, await noticeState(), await alertStatus(), await watchStatus()], [at(FRI, '23:10'), at(SAT, '07:00'), at(SAT, '07:00'), 'held', 'upcoming', 'triggered']);
    equal('before the release time the sender has only the notice that is already released', sender.pending(t0).map(x => x.id), ['ntc-0009']);
    const backwards = await advance('clock-back', at(FRI, '22:00'));
    check('an earlier time is refused with invalid_time', backwards.status === 'invalid_time');
    const moved = await advance('clock-0700', at(SAT, '07:00')), t1 = await state();
    equal('env.advance_time commits, names the clock before and after and adds one revision', [moved.status, moved.advanced, moved.previous_virtual_now, moved.virtual_now, moved.version.revision], ['committed', true, at(FRI, '23:10'), at(SAT, '07:00'), t0.revision + 1]);
    equal('moving the clock changes no business record and writes no activity row', [t1.data, t1.virtual_now], [t0.data, at(SAT, '07:00')]);
    equal('the held notice now reads released, with no App event', await noticeState(), 'released');
    equal('and the sender picks it up from the snapshot', sender.pending(t1).map(x => [x.id, x.wire.time]), [['ntc-0009', scenario.at], [heldNotice.id, at(SAT, '07:00')]]);
    const clockRow = t1.audit.at(-1);
    equal('Core records the clock move: an audit row with the clock before and after, and a receipt', [clockRow.tool, clockRow.decision, clockRow.clock, t1.receipts['clock:clock-0700'] !== undefined], ['env.advance_time', 'allow', { request_id: 'clock-0700', from: at(FRI, '23:10'), requested: at(SAT, '07:00'), to: at(SAT, '07:00') }, true]);
    const sameClock = await infra.call('env.advance_time', { request_id: 'clock-0700', expected_version: t0.version || { epoch: t0.epoch, revision: t0.revision }, virtual_now: at(SAT, '07:00') });
    equal('a repeated clock request returns the stored receipt and moves nothing', [sameClock.duplicate, (await state()).revision], [true, t1.revision]);
    check('the same clock request ID for another time is rejected', (await advance('clock-0700', at(SAT, '08:00'))).status === 'idempotency_conflict');
    const still = await advance('clock-0700-again', at(SAT, '07:00'));
    equal('the same instant is acknowledged without advancing', [still.status, still.advanced, (await state()).revision], ['committed', false, t1.revision]);
    check('a write with a version from before the clock move is stale', (await agent.call(A + 'watches.cancel', { id: 'w-0002', request_id: 'old-observation', expected_version: { epoch: t0.epoch, revision: t0.revision } })).status === 'stale_version');

    check('the clock moves to the end of the watch window', (await advance('clock-1300', at(SAT, '13:00'))).status === 'committed');
    equal('a watch past its window reads ended and is listed as closed', [await watchStatus(), (await agent.call(A + 'watches.list', {})).watches.map(w => w.id)], ['ended', ['w-0003']]);
    equal('an ended watch cannot be edited or cancelled', [(await write('watches.update', { id: 'w-0002', patch: { label: 'Too late' } })).status, (await write('watches.cancel', { id: 'w-0002' })).status], ['invalid_state', 'invalid_state']);
    equal('an ended watch no longer holds its place', (await write('places.remove', { id: WREN })).status, 'committed');
    equal('the alert is still upcoming', await alertStatus(), 'upcoming');
    await advance('clock-1800', at(SAT, '18:00'));
    equal('the alert reads active from its onset', await alertStatus(), 'active');
    await advance('clock-0200', at(SUN, '02:00'));
    equal('the alert reads expired from its end', await alertStatus(), 'expired');
    const t2 = await state();
    equal('across the clock moves only the Agent\'s own write changed business data', [t2.data.activity.length - t1.data.activity.length, t2.data.activity.at(-1).action, t2.data.watches, t2.data.notices, t2.data.alerts], [1, 'places.remove', t1.data.watches, t1.data.notices, t1.data.alerts]);
    equal('one audit row per clock move', t2.audit.filter(r => r.tool === 'env.advance_time' && r.decision === 'allow').map(r => r.clock.to), [at(SAT, '07:00'), at(SAT, '07:00'), at(SAT, '13:00'), at(SAT, '18:00'), at(SUN, '02:00')]);
    const missed = await event({ ...scenario, event_id: 'missed-boundary', at: at(SAT, '09:00'), payload: { ...scenario.payload, issuance_id: 'iss-pfo-wren-missed', issued_at: at(SAT, '09:00') } });
    check('an event dated before the advanced clock is rejected', missed.status === 'invalid_event');

    // A task seed with its own clock, then reset to that seed and that time (T18).
    const task = clone(baseline.data), taskNow = '2026-11-21T06:30:00-06:00';
    task.saved_places = task.saved_places.slice(0, 1); task.watches = []; task.notices = []; task.acknowledgements = []; task.activity = [];
    task.preferences = { units: 'us', default_source_id: 'src-skyline', default_air_source_id: null, timezone: 'America/Chicago', quiet_hours: { enabled: false, start: '23:00', end: '06:00' }, email_notices: false };
    const loaded = await infra.call('env.load_seed', { expected_version: await version(), data: task, virtual_now: taskNow, request_id: 'task-seed' });
    check('Infra loads a task seed with its own virtual_now', loaded.status === 'ready' && loaded.loaded === 89);
    const taskSnap = await state();
    equal('the loaded seed and time are the baseline', [taskSnap.data, taskSnap.virtual_now, taskSnap.initial_virtual_now, taskSnap.audit.length], [task, taskNow, taskNow, 1]);
    const prefs = (await agent.call(A + 'preferences.get', {})).preferences;
    equal('the Agent sees the task account', [prefs.units, prefs.default_source_id, prefs.default_air_source_id, (await agent.call(A + 'places.list', {})).places.length], ['us', 'src-skyline', null, 1]);
    const unbound = clone(task); unbound.account_id = 'someone-else';
    check('a seed for an account the binding does not declare is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: unbound })).status === 'invalid_seed');
    const dangling = clone(task); dangling.issuances[0].place_id = 'pl-nowhere';
    check('a seed with a dangling reference is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: dangling })).status === 'invalid_seed');
    const offset = clone(task); offset.issuances.find(i => i.hourly).hourly[0].start = '2026-11-19T22:00:00';
    check('a seed timestamp without a UTC offset is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: offset })).status !== 'ready');
    const stale1 = clone(baseline.data); stale1.notices[0].released_at = stale1.notices[0].release_at;
    check('a seed that stores a time-based state is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: stale1 })).status !== 'ready');
    equal('rejected seeds leave the loaded baseline', (await state()).data, task);
    const noAir = await write('watches.create', { id: WREN, ...hike, conditions: [{ variable: 'aqi', value: 101 }] });
    check('an aqi condition without any air-quality source to use is refused', noAir.status === 'not_found' && noAir.applied === false);
    const twin = [await write('watches.create', { id: WREN, ...hike }), await write('watches.create', { id: WREN, ...hike })];
    equal('the Agent works on the task seed; two identical watches are two records', twin.map(w => [w.status, w.id]), [['committed', 'w-0001'], ['committed', 'w-0002']]);
    check('Infra moves the task clock', (await advance('task-clock', '2026-11-21T09:00:00-06:00')).status === 'committed');
    const reset = await infra.call('env.reset', { expected_version: await version() }), restored = await state();
    check('reset returns ready', reset.status === 'ready');
    equal('reset restores the loaded seed and the loaded time, and clears the audit and the clock receipts', [restored.data, restored.virtual_now, restored.audit.length, restored.epoch > taskSnap.epoch, Object.keys(restored.receipts).filter(k => k.startsWith('clock:'))], [task, taskNow, 1, true, []]);
    check('a version from before the reset is stale', (await agent.call(A + 'places.remove', { id: WREN, request_id: 'old-epoch', expected_version: taskSnap.version || { epoch: taskSnap.epoch, revision: taskSnap.revision } })).status === 'stale_version');
    const peer = await client('infra', 'other-run');
    equal('another run still has the package fixture', [(await peer.call('env.snapshot')).snapshot.data.watches.length, (await peer.call('env.snapshot')).snapshot.virtual_now], [3, at(FRI, '20:00')]);

    const report = { schema: 'rainshadow.mcp-integration.v2', app_version: require('../app.json').version, runtime_version: runtime.version, node: process.version, checks: checks.length, passed: true, read_call_ms: { max: Math.max(...timings), mean: Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) }, duration_ms: Date.now() - started, names: checks };
    if (opts.report) fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: ' + checks.length + ' real-MCP checks for rainshadow ' + report.app_version + ' on runtime ' + report.runtime_version + ' (' + report.duration_ms + ' ms; read calls mean ' + report.read_call_ms.mean + ' ms, max ' + report.read_call_ms.max + ' ms).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
