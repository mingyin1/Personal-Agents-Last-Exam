'use strict';
// App-only business tests T01-T18 of the proposal. They call the real business functions
// through tests/harness.cjs with the package fixture (clock: Friday 2026-11-20 20:00 -07:00)
// and need nothing outside this package. Core behavior (T17, the real env.advance_time of
// T16, reset in T18) needs the public runtime and lives in tests/mcp.integration.cjs; the
// Mail flow lives in tests/mail.integration.cjs. Both run from here only when
// PALE_RUNTIME_ROOT names the runtime directory of a public checkout.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { fixture, plugin } = require('./harness.cjs');
const sender = require('../infra/sender.cjs');

const FRI = '2026-11-20', SAT = '2026-11-21', SUN = '2026-11-22';
const at = (date, hhmm, offset = '-07:00') => date + 'T' + hhmm + (hhmm.length === 5 ? ':00' : '') + offset;
const WREN = 'pl-wren-lake', MARROW = 'pl-marrowby', CINDER = 'pl-cinderhorn-pass';
const HIKE = { id: WREN, start: at(SAT, '10:00'), end: at(SAT, '13:00') };
const scenario = () => structuredClone(require('../examples/scenario.json'));
const seedCopy = () => structuredClone(require('../fixtures/minimal.json'));

// A failing call or event must leave business data exactly as it was.
function rejects(app, fn, code) {
  const before = app.data;
  assert.throws(fn, { code });
  assert.deepEqual(app.data, before);
}
const row = (hour, fields = {}) => ({ start: at(SAT, String(hour).padStart(2, '0') + ':00'), temp_c: 10, apparent_temp_c: 9, pop: 5, precip_mm: 0, wind_kph: 10, gust_kph: 18, thunder_prob: 0, sky: 'partly_cloudy', ...fields });
// forecast.issued for Wren Lake from the default source; rows = [[hour, fields], ...] on Saturday.
const issued = (id, when, rows, extra = {}) => ({
  event_id: 'ev-' + id, at: when, operation: 'rainshadow.forecast.issued',
  payload: { issuance_id: id, source_id: 'src-pfo', place_id: WREN, issued_at: when, hourly: rows.map(([h, f]) => row(h, f)), ...extra },
});
const message = (id, type, sent, fields = {}) => ({
  message_id: id, type, sent_at: sent, event: 'Flood Watch', severity: 'moderate', urgency: 'future', certainty: 'possible', onset: at(SAT, '18:00'), ends: at(SUN, '02:00'),
  headline: 'Flood Watch from Saturday evening through late Saturday night', description: 'Heavy rain may cause flooding of creeks and low crossings.', instruction: 'Be ready to move to higher ground.', ...fields,
});
const alertIssued = (id, when, fields = {}, thread = {}) => ({
  event_id: 'ev-' + id, at: when, operation: 'rainshadow.alert.issued',
  payload: { alert_id: id, source_id: 'src-pfo', category: 'flood', zone_ids: ['z-wren'], ...thread, message: message(id + '-m1', 'alert', when, fields) },
});
const alertUpdated = (id, n, when, fields = {}) => ({ event_id: 'ev-' + id + '-m' + n, at: when, operation: 'rainshadow.alert.updated', payload: { alert_id: id, message: message(id + '-m' + n, 'update', when, fields) } });
const alertCancelled = (id, n, when) => ({ event_id: 'ev-' + id + '-m' + n, at: when, operation: 'rainshadow.alert.cancelled', payload: { alert_id: id, message: { message_id: id + '-m' + n, type: 'cancel', sent_at: when, headline: 'Flood Watch cancelled', description: 'The threat has ended.' } } });
const notices = app => app.call('notices.list', { limit: 100 }).notices;
const scenarioWire = () => { const app = fixture(); app.event(scenario()); return app.data.notices.at(-1).wire; };
const actions = (app, from = 0) => app.data.activity.slice(from).map(a => a.actor + ':' + a.action + ':' + a.object_id);

test('T01 [W1] search, save, update label and rule, list; duplicate and unknown IDs', () => {
  const app = fixture(), found = app.call('places.search', { query: 'tallow' });
  assert.equal(found.total, 3);
  assert.equal(found.places.find(p => p.id === WREN).label, 'Saturday hike');
  assert.equal(found.places.find(p => p.id === 'pl-tallowmere').saved, false);
  assert.equal(app.call('places.search', { query: 'tallow', limit: 1 }).places.length, 1);

  const saved = app.call('places.save', { id: 'pl-tallowmere', label: 'Dad\'s shop', alert_rule: { categories: ['wind', 'flood'], min_severity: 'severe' } });
  assert.equal(saved.id, 'pl-tallowmere');
  assert.deepEqual(saved.place.alert_rule, { categories: ['flood', 'wind'], min_severity: 'severe', paused: false });
  assert.equal(saved.place.saved_at, app.now);
  rejects(app, () => app.call('places.save', { id: 'pl-tallowmere' }), 'already_saved');
  rejects(app, () => app.call('places.save', { id: 'pl-nowhere' }), 'not_found');
  rejects(app, () => app.call('places.save', { id: 'pl-port-brindle', label: '   ' }), 'invalid_arguments');

  const updated = app.call('places.update', { id: 'pl-tallowmere', patch: { label: 'Workshop', alert_rule: { paused: true } } }).place;
  assert.equal(updated.label, 'Workshop');
  assert.deepEqual(updated.alert_rule, { categories: ['flood', 'wind'], min_severity: 'severe', paused: true });
  rejects(app, () => app.call('places.update', { id: 'pl-port-brindle', patch: { label: 'Harbor' } }), 'not_found');
  rejects(app, () => app.call('places.update', { id: 'pl-tallowmere', patch: {} }), 'invalid_arguments');

  const plain = app.call('places.save', { id: 'pl-port-brindle' }).place;
  assert.equal(plain.label, 'Port Brindle');
  assert.equal(plain.alert_rule.min_severity, 'moderate');
  assert.equal(plain.alert_rule.categories.length, 8);
  const list = app.call('places.list').places;
  assert.deepEqual(list.map(p => p.id), [WREN, MARROW, CINDER, 'pl-tallowmere', 'pl-port-brindle']);
  assert.deepEqual(list.map(p => p.open_watches), [1, 1, 0, 0, 0]);
});

test('T02 [W1] remove a place with and without an open watch', () => {
  const app = fixture();
  rejects(app, () => app.call('places.remove', { id: WREN }), 'place_in_use');
  app.call('watches.cancel', { id: 'w-0002' });
  assert.deepEqual(app.call('places.remove', { id: WREN }), { id: WREN, removed: true });
  assert.deepEqual(app.call('places.remove', { id: CINDER }), { id: CINDER, removed: true }, 'an ended watch does not hold a place');
  assert.deepEqual(app.call('places.list').places.map(p => p.id), [MARROW]);
  rejects(app, () => app.call('places.remove', { id: WREN }), 'not_found');
  rejects(app, () => app.call('watches.create', { ...HIKE, conditions: [{ variable: 'pop', value: 40 }] }), 'not_found');
  assert.equal(app.call('watches.get', { id: 'w-0002' }).watch.status, 'cancelled', 'the watch history stays');
});

test('T03 [W1] preferences: units, quiet hours, time zone and default source', () => {
  const app = fixture(), window = { id: WREN, start: at(SAT, '18:00'), end: at(SAT, '19:00') };
  const metric = app.call('forecast.hourly', window), stored = app.data.issuances;
  assert.deepEqual(metric.units, { temperature: 'C', wind: 'km/h', precipitation: 'mm' });
  assert.deepEqual([metric.rows[0].temp, metric.rows[0].gust, metric.rows[0].precip], [9.3, 46, 1.5]);

  const prefs = app.call('preferences.update', { patch: { units: 'us' } });
  assert.equal(prefs.id, 'rainshadow-maya');
  assert.deepEqual(prefs.preferences.unit_names, { temperature: 'F', wind: 'mph', precipitation: 'in' });
  const us = app.call('forecast.hourly', window);
  assert.deepEqual(us.units, { temperature: 'F', wind: 'mph', precipitation: 'in' });
  assert.deepEqual([us.rows[0].temp, us.rows[0].gust, us.rows[0].precip], [48.7, 28.6, 0.06]);
  assert.deepEqual([us.rows[0].pop, us.rows[0].thunder_prob], [70, 30], 'probabilities have no unit');
  assert.deepEqual(app.data.issuances, stored, 'stored values stay metric');
  assert.equal(app.call('forecast.daily', window).rows[0].high, 54.1);
  const observed = app.data.observations.find(o => o.id === 'ob-wren-2').temp_c;
  assert.equal(app.call('conditions.get', { id: WREN }).observation.temp, Math.round((observed * 9 / 5 + 32) * 10) / 10);

  rejects(app, () => app.call('preferences.update', { patch: { timezone: 'Mars/Olympus_Mons' } }), 'invalid_timezone');
  rejects(app, () => app.call('preferences.update', { patch: { quiet_hours: { start: '07:00' } } }), 'invalid_window');
  rejects(app, () => app.call('preferences.update', { patch: { default_source_id: 'src-none' } }), 'not_found');
  rejects(app, () => app.call('preferences.update', { patch: { default_source_id: 'src-aqb' } }), 'not_found');
  rejects(app, () => app.call('preferences.update', { patch: { default_air_source_id: 'src-none' } }), 'not_found');
  rejects(app, () => app.call('preferences.update', { patch: { default_air_source_id: 'src-pfo' } }), 'not_found');
  rejects(app, () => app.call('preferences.update', { patch: {} }), 'invalid_arguments');
  assert.equal(app.call('preferences.get').preferences.default_air_source_id, 'src-aqb');

  assert.equal(app.call('preferences.get').preferences.in_quiet_hours, false);
  const next = app.call('preferences.update', { patch: { timezone: 'America/Chicago', quiet_hours: { start: '20:30' }, default_source_id: 'src-skyline', email_notices: false } }).preferences;
  assert.deepEqual(next.quiet_hours, { enabled: true, start: '20:30', end: '07:00' });
  assert.equal(next.in_quiet_hours, true, '20:00 in Denver is 21:00 in Chicago');
  assert.equal(app.call('forecast.hourly', window).source.id, 'src-skyline');
  const defaults = () => app.call('sources.list').sources.map(s => [s.id, s.kind, s.is_default, s.issuance_count]);
  assert.deepEqual(defaults(), [['src-pfo', 'weather', false, 18], ['src-skyline', 'weather', true, 18], ['src-aqb', 'air_quality', true, 18]], 'one default per kind');
  assert.equal(app.call('preferences.update', { patch: { default_air_source_id: null } }).preferences.default_air_source_id, null);
  assert.deepEqual(defaults().map(d => d[2]), [false, true, false]);
  assert.equal(app.call('preferences.update', { patch: { default_air_source_id: 'src-aqb' } }).preferences.default_air_source_id, 'src-aqb');
});

test('T04 [W2] the latest issuance per source and place; explicit issuance_id; is_latest', () => {
  const app = fixture(), window = { id: WREN, start: at(SAT, '09:00'), end: at(SAT, '16:00') };
  assert.equal(app.call('forecast.hourly', window).issuance.id, 'iss-pfo-wren-3');
  app.event(scenario());
  app.advance(at(FRI, '20:45'));
  const before = app.data, latest = app.call('forecast.hourly', window);
  assert.deepEqual(latest.issuance, { id: 'iss-pfo-wren-4', issued_at: at(FRI, '20:30'), is_latest: true });
  assert.deepEqual(latest.coverage, { requested_hours: 7, covered_hours: 7, missing: [], reason: null });
  assert.deepEqual(latest.rows.map(r => r.pop), [15, 20, 30, 45, 55, 65, 75]);
  assert.ok(latest.rows.every(r => r.start.endsWith('-07:00')));
  assert.deepEqual(latest.rows[3], { start: at(SAT, '12:00'), temp: 14, apparent_temp: 13, pop: 45, precip: 0.4, wind: 12, gust: 24, thunder_prob: 10, sky: 'mostly_cloudy' });

  const earlier = app.call('forecast.hourly', { ...window, issuance_id: 'iss-pfo-wren-3' });
  assert.deepEqual(earlier.issuance, { id: 'iss-pfo-wren-3', issued_at: at(FRI, '15:00'), is_latest: false });
  assert.deepEqual(earlier.rows.map(r => r.pop), [10, 10, 15, 15, 25, 30, 40]);
  const other = app.call('forecast.hourly', { ...window, source_id: 'src-skyline' });
  assert.deepEqual(other.issuance, { id: 'iss-sky-wren-3', issued_at: at(FRI, '18:00'), is_latest: true });
  assert.equal(app.call('forecast.hourly', { ...window, id: 'pl-tallowmere' }).issuance.id, 'iss-pfo-tallow-3', 'another place is not affected');

  rejects(app, () => app.call('forecast.hourly', { ...window, id: 'pl-tallowmere', issuance_id: 'iss-pfo-wren-3' }), 'not_found');
  rejects(app, () => app.call('forecast.hourly', { ...window, source_id: 'src-skyline', issuance_id: 'iss-pfo-wren-3' }), 'not_found');
  rejects(app, () => app.call('forecast.hourly', { ...window, id: 'pl-nowhere' }), 'not_found');
  rejects(app, () => app.call('forecast.hourly', { ...window, source_id: 'src-none' }), 'not_found');

  const list = app.call('forecast.issuances', { id: WREN, source_id: 'src-pfo' }).issuances;
  assert.deepEqual(list.map(i => [i.id, i.is_latest]), [['iss-pfo-wren-4', true], ['iss-pfo-wren-3', false], ['iss-pfo-wren-2', false], ['iss-pfo-wren-1', false]]);
  assert.deepEqual(list[0].hourly, { count: 8, start: at(SAT, '09:00'), end: at(SAT, '17:00') });
  assert.deepEqual(list[1].daily, { count: 7, start_date: FRI, end_date: '2026-11-26' });
  const all = app.call('forecast.issuances', { id: WREN, limit: 4 });
  assert.equal(all.issuances.length, 4);
  assert.equal(all.next_cursor, '4');
  assert.equal(app.call('forecast.issuances', { id: WREN, limit: 4, cursor: '8' }).next_cursor, null);
  assert.deepEqual(app.data, before, 'reads leave state identical');

  // The latest issuance is the one with the newest issued_at, whatever order they arrive in.
  app.event(issued('iss-pfo-wren-late', at(FRI, '20:50'), [[12, { pop: 95 }]], { issued_at: at(FRI, '19:00') }));
  assert.deepEqual(app.call('forecast.hourly', window).issuance, { id: 'iss-pfo-wren-4', issued_at: at(FRI, '20:30'), is_latest: true }, 'a late arrival with an older issue time does not take over');
  assert.deepEqual(app.call('forecast.issuances', { id: WREN, source_id: 'src-pfo' }).issuances.slice(0, 3).map(i => [i.id, i.is_latest]), [['iss-pfo-wren-4', true], ['iss-pfo-wren-late', false], ['iss-pfo-wren-3', false]]);
  assert.deepEqual(app.call('forecast.hourly', { ...window, issuance_id: 'iss-pfo-wren-late' }).issuance, { id: 'iss-pfo-wren-late', issued_at: at(FRI, '19:00'), is_latest: false });
  assert.equal(app.call('watches.get', { id: 'w-0002' }).watch.evaluation.issuance.id, 'iss-pfo-wren-4', 'the watch is evaluated against the latest issuance, not the last arrival');
});

test('T05 [W2] coverage and gaps; no issuance; pagination; no fallback to another source', () => {
  const app = fixture(), late = { id: WREN, start: at(SAT, '13:00'), end: at(SAT, '17:00'), issuance_id: 'iss-pfo-wren-1' };
  const partial = app.call('forecast.hourly', late);
  assert.deepEqual(partial.rows.map(r => r.start), [at(SAT, '13:00'), at(SAT, '14:00')]);
  assert.deepEqual(partial.coverage, { requested_hours: 4, covered_hours: 2, missing: [at(SAT, '15:00'), at(SAT, '16:00')], reason: 'partial' });
  const beyond = app.call('forecast.hourly', { id: WREN, start: at('2026-11-25', '00:00'), end: at('2026-11-25', '03:00') });
  assert.deepEqual([beyond.rows.length, beyond.coverage.covered_hours, beyond.coverage.missing.length, beyond.coverage.reason], [0, 0, 3, 'outside_issuance']);
  assert.equal(beyond.issuance.id, 'iss-pfo-wren-3', 'the issuance is still named');
  const half = app.call('forecast.hourly', { id: WREN, start: at(SAT, '09:30'), end: at(SAT, '10:30') });
  assert.deepEqual(half.rows.map(r => r.start), [at(SAT, '09:00'), at(SAT, '10:00')], 'hours that intersect the window');

  const seed = seedCopy();
  seed.issuances = seed.issuances.filter(i => !(i.source_id === 'src-skyline' && i.place_id === WREN));
  const sparse = fixture({ seed }), none = sparse.call('forecast.hourly', { id: WREN, start: at(SAT, '09:00'), end: at(SAT, '11:00'), source_id: 'src-skyline' });
  assert.equal(none.issuance, null);
  assert.deepEqual(none.rows, []);
  assert.deepEqual(none.coverage, { requested_hours: 2, covered_hours: 0, missing: [at(SAT, '09:00'), at(SAT, '10:00')], reason: 'no_issuance' });
  assert.equal(none.source.id, 'src-skyline', 'no fallback to the other source');
  assert.equal(sparse.call('forecast.daily', { id: WREN, source_id: 'src-skyline' }).coverage.reason, 'no_issuance');
  assert.equal(app.call('forecast.hourly', { id: WREN, source_id: 'src-aqb' }).coverage.reason, 'no_hourly_product');

  const window = { id: WREN, start: at(SAT, '09:00'), end: at(SAT, '16:00') };
  const first = app.call('forecast.hourly', { ...window, limit: 3 }), second = app.call('forecast.hourly', { ...window, limit: 3, cursor: first.next_cursor });
  const third = app.call('forecast.hourly', { ...window, limit: 3, cursor: second.next_cursor });
  assert.deepEqual([first.rows.length, second.rows.length, third.rows.length, third.next_cursor], [3, 3, 1, null]);
  assert.equal(first.coverage.covered_hours, 7, 'coverage describes the whole window');
  assert.deepEqual([...first.rows, ...second.rows, ...third.rows], app.call('forecast.hourly', window).rows);
  rejects(app, () => app.call('forecast.hourly', { ...window, cursor: 'abc' }), 'invalid_arguments');
  rejects(app, () => app.call('forecast.hourly', { id: WREN, start: at(SAT, '12:00'), end: at(SAT, '12:00') }), 'invalid_window');
  rejects(app, () => app.call('forecast.hourly', { id: WREN, start: at(SAT, '00:00'), end: at('2026-12-02', '00:00') }), 'invalid_window');
  const fallback = app.call('forecast.hourly', { id: WREN });
  assert.deepEqual([fallback.start, fallback.end, fallback.rows.length], [at(FRI, '20:00'), at(SAT, '20:00'), 24], 'default window is the next 24 hours');
});

test('T06 [W2] rows as issued; date boundaries in the place\'s time zone, for two zones', () => {
  const app = fixture(), day = { start: at(SAT, '00:00'), end: at(SUN, '00:00') };
  const wren = app.call('forecast.daily', { id: WREN, ...day });
  assert.deepEqual(wren.rows, [{ date: SAT, headline: 'Strong storms, 60%', summary: 'Storms develop late in the day.', high: 12.3, low: 1.5, pop_day: 60, pop_night: 85 }]);
  assert.deepEqual(wren.coverage, { requested_days: 1, covered_days: 1, missing: [], reason: null });
  const morning = app.call('forecast.hourly', { id: WREN, start: at(SAT, '09:00'), end: at(SAT, '13:00') });
  assert.ok(morning.rows.every(r => r.pop <= 15), 'the hours a morning visitor cares about differ from the daily headline');
  assert.deepEqual(app.data.issuances.find(i => i.id === 'iss-pfo-wren-3').hourly.filter(r => r.start >= at(SAT, '09:00') && r.start < at(SAT, '13:00')).map(r => [r.start, r.temp_c, r.pop]), morning.rows.map(r => [r.start, r.temp, r.pop]));

  const coast = app.call('forecast.daily', { id: MARROW, ...day });
  assert.deepEqual(coast.rows.map(r => r.date), [FRI, SAT], 'the same instants touch two local dates one zone to the west');
  assert.deepEqual([coast.start, coast.end], [at(FRI, '23:00', '-08:00'), at(SAT, '23:00', '-08:00')]);
  const hours = app.call('forecast.hourly', { id: MARROW, start: at(SAT, '09:00'), end: at(SAT, '11:00') });
  assert.deepEqual(hours.rows.map(r => r.start), [at(SAT, '08:00', '-08:00'), at(SAT, '09:00', '-08:00')]);

  const air = app.call('forecast.daily', { id: MARROW, source_id: 'src-aqb', start: at(FRI, '00:00', '-08:00'), end: at('2026-11-24', '00:00', '-08:00') });
  assert.deepEqual(air.issuance, { id: 'aq-marrow-3', issued_at: at(FRI, '10:00', '-08:00'), is_latest: true });
  assert.deepEqual(air.rows, [{ date: FRI, aqi: 90, category: 'Moderate', pollutant: 'pm25' }, { date: SAT, aqi: 57, category: 'Moderate', pollutant: 'pm25' }, { date: SUN, aqi: 44, category: 'Good', pollutant: 'ozone' }]);
  assert.deepEqual(air.coverage, { requested_days: 4, covered_days: 3, missing: ['2026-11-23'], reason: 'partial' });
  const smoke = app.call('forecast.daily', { id: MARROW, source_id: 'src-aqb', issuance_id: 'aq-marrow-2', start: at(FRI, '00:00', '-08:00'), end: at(FRI, '12:00', '-08:00') });
  assert.deepEqual([smoke.rows[0].aqi, smoke.rows[0].category, smoke.issuance.is_latest], [133, 'Unhealthy for Sensitive Groups', false]);
});

test('T07 [W2] conditions.get picks the newest observation and reports its age', () => {
  const app = fixture(), now = app.call('conditions.get', { id: WREN });
  assert.deepEqual([now.observation.id, now.observation.observed_at, now.observation.age_minutes], ['ob-wren-2', at(FRI, '18:50'), 70]);
  app.event({ event_id: 'ev-ob-9', at: at(FRI, '20:10'), operation: 'rainshadow.observation.recorded', payload: { observation_id: 'ob-wren-9', place_id: WREN, source_id: 'src-skyline', observed_at: at(FRI, '20:05'), temp_c: 7.5, wind_kph: 8, gust_kph: 14, conditions: 'clear' } });
  const newer = app.call('conditions.get', { id: WREN }).observation;
  assert.deepEqual(newer, { id: 'ob-wren-9', source_id: 'src-skyline', observed_at: at(FRI, '20:05'), age_minutes: 5, temp: 7.5, wind: 8, gust: 14, conditions: 'clear', humidity: null });
  assert.equal(app.call('conditions.get', { id: WREN, source_id: 'src-pfo' }).observation.id, 'ob-wren-2');
  assert.equal(app.call('conditions.get', { id: WREN, source_id: 'src-aqb' }).observation, null);
  const seed = seedCopy();
  seed.observations = seed.observations.filter(o => o.place_id !== WREN);
  assert.equal(fixture({ seed }).call('conditions.get', { id: WREN }).observation, null);
  rejects(app, () => app.call('conditions.get', { id: 'pl-nowhere' }), 'not_found');
});

test('T08 [W3] thread lifecycle from events; status at the onset and ends boundaries', () => {
  const app = fixture(), count = notices(app).length;
  app.event(alertIssued('al-0012', at(FRI, '20:10')));
  const status = () => app.call('alerts.get', { id: 'al-0012' }).alert.status;
  assert.equal(status(), 'upcoming');
  const created = notices(app);
  assert.equal(created.length, count + 1);
  assert.deepEqual([created[0].kind, created[0].object, created[0].message_id, created[0].place_ids, created[0].title], ['alert.issued', { type: 'alert', id: 'al-0012' }, 'al-0012-m1', [WREN], 'Flood Watch for Wren Lake (saved as Saturday hike)']);
  app.advance(at(SAT, '17:59:59'));
  assert.equal(status(), 'upcoming');
  app.advance(at(SAT, '18:00'));
  assert.equal(status(), 'active');
  app.event(alertUpdated('al-0012', 2, at(SAT, '19:00'), { severity: 'severe', ends: at(SUN, '03:00') }));
  const updated = app.call('alerts.get', { id: 'al-0012' }).alert;
  assert.deepEqual([updated.status, updated.severity, updated.ends, updated.latest_message_id, updated.message_count], ['active', 'severe', at(SUN, '03:00'), 'al-0012-m2', 2]);
  assert.deepEqual(updated.messages.map(m => m.type), ['alert', 'update']);
  app.advance(at(SUN, '02:59:59'));
  assert.equal(status(), 'active');
  app.advance(at(SUN, '03:00'));
  assert.equal(status(), 'expired');
  assert.deepEqual(notices(app).slice(0, 2).map(n => n.kind), ['alert.updated', 'alert.issued']);

  const other = fixture();
  other.event(alertIssued('al-0013', at(FRI, '20:10')));
  other.event(alertCancelled('al-0013', 2, at(FRI, '21:00')));
  const cancelled = other.call('alerts.get', { id: 'al-0013' }).alert;
  assert.deepEqual([cancelled.status, cancelled.latest_message_type, cancelled.event, cancelled.onset, cancelled.headline], ['cancelled', 'cancel', 'Flood Watch', at(SAT, '18:00'), 'Flood Watch cancelled']);
  assert.equal(notices(other)[0].kind, 'alert.cancelled');
});

test('T09 [W3] zone matching; alerts.list filters by place and window and hides closed threads', () => {
  const app = fixture(), ids = args => app.call('alerts.list', args).alerts.map(a => a.id);
  assert.deepEqual(ids({ id: MARROW }), ['al-0004']);
  assert.deepEqual(ids({ id: MARROW, include_closed: true, start: at('2026-11-19', '00:00'), end: at(SUN, '00:00') }), ['al-0003', 'al-0004']);
  assert.deepEqual(ids({ id: 'pl-port-brindle', include_closed: true, start: at('2026-11-19', '00:00'), end: at(SUN, '00:00') }), ['al-0003'], 'only the shared coast zone');
  assert.deepEqual(ids({ id: 'pl-tamsin-heights' }), ['al-0005']);
  assert.deepEqual(ids({ id: 'pl-tamsin-heights', start: at(SAT, '10:00', '-08:00'), end: at(SAT, '12:00', '-08:00') }), [], 'the alert ends before the window');
  assert.deepEqual(ids({ id: CINDER, start: at('2026-11-18', '00:00'), end: at(SUN, '00:00') }), ['al-0002']);
  assert.deepEqual(ids({ id: CINDER, start: at('2026-11-18', '00:00'), end: at(SUN, '00:00'), include_closed: true }), ['al-0001', 'al-0002']);
  assert.deepEqual(ids({ id: WREN }), []);
  const listed = app.call('alerts.list', { id: CINDER }).alerts[0];
  assert.deepEqual([listed.status, listed.latest_message_id, listed.message_count, listed.acknowledged, listed.ends], ['active', 'al-0002-m2', 2, false, at(SAT, '06:00')]);
  const detail = app.call('alerts.get', { id: 'al-0003' }).alert;
  assert.deepEqual(detail.affected_places, [{ id: 'pl-port-brindle', name: 'Port Brindle', saved: false, label: null }, { id: MARROW, name: 'Marrowby', saved: true, label: 'Mom\'s house' }]);
  assert.deepEqual([detail.status, detail.source.id, detail.messages.length, detail.severity], ['cancelled', 'src-aqb', 3, 'severe']);
  rejects(app, () => app.call('alerts.list', { id: 'pl-nowhere' }), 'not_found');
  rejects(app, () => app.call('alerts.list', { id: WREN, start: at(SAT, '10:00'), end: at(SAT, '09:00') }), 'invalid_window');
  rejects(app, () => app.call('alerts.get', { id: 'al-9999' }), 'not_found');
});

test('T10 [W3] acknowledgement: the latest message only, cleared by an update, repeat, closed thread', () => {
  const app = fixture();
  assert.deepEqual(app.call('alerts.get', { id: 'al-0002' }).alert.acknowledgements, [{ message_id: 'al-0002-m1', acknowledged_at: at('2026-11-19', '12:00') }]);
  assert.equal(app.call('alerts.get', { id: 'al-0002' }).alert.acknowledged, false, 'the update cleared it');
  rejects(app, () => app.call('alerts.acknowledge', { id: 'al-0002', message_id: 'al-0002-m1' }), 'stale_message');
  assert.deepEqual(app.call('alerts.acknowledge', { id: 'al-0002', message_id: 'al-0002-m2' }), { id: 'al-0002', message_id: 'al-0002-m2', acknowledged_at: app.now });
  assert.equal(app.call('alerts.get', { id: 'al-0002' }).alert.acknowledged, true);
  rejects(app, () => app.call('alerts.acknowledge', { id: 'al-0002', message_id: 'al-0002-m2' }), 'already_acknowledged');
  rejects(app, () => app.call('alerts.acknowledge', { id: 'al-0003', message_id: 'al-0003-m3' }), 'invalid_state');
  rejects(app, () => app.call('alerts.acknowledge', { id: 'al-0001', message_id: 'al-0001-m1' }), 'invalid_state');
  rejects(app, () => app.call('alerts.acknowledge', { id: 'al-9999', message_id: 'x' }), 'not_found');
  rejects(app, () => app.call('alerts.acknowledge', { id: 'al-0002', message_id: 'al-0004-m1' }), 'not_found');
  app.event(alertUpdated('al-0002', 3, at(FRI, '21:00'), { event: 'Wind Advisory', onset: at(FRI, '12:00'), ends: at(SAT, '09:00') }));
  const after = app.call('alerts.get', { id: 'al-0002' }).alert;
  assert.equal(after.acknowledged, false);
  assert.deepEqual(after.acknowledgements.map(a => a.message_id), ['al-0002-m1', 'al-0002-m2']);
});

test('T11 [W3] invalid events leave state unchanged', () => {
  const app = fixture();
  app.event(alertIssued('al-0012', at(FRI, '20:10')));
  const invalid = event => rejects(app, () => app.event(event), 'invalid_event');
  invalid(alertUpdated('al-4040', 2, at(FRI, '20:20')));
  invalid(alertCancelled('al-4040', 2, at(FRI, '20:20')));
  invalid(alertIssued('al-0013', at(FRI, '20:20'), { sent_at: at(FRI, '20:21') }));
  invalid(alertIssued('al-0012', at(FRI, '20:20')));
  invalid({ ...alertIssued('al-0013', at(FRI, '20:20')), payload: { ...alertIssued('al-0013', at(FRI, '20:20')).payload, message: message('al-0012-m1', 'alert', at(FRI, '20:20')) } });
  invalid(alertIssued('al-0013', at(FRI, '20:20'), {}, { zone_ids: ['z-nowhere'] }));
  invalid(alertIssued('al-0013', at(FRI, '20:20'), { onset: at(SUN, '02:00'), ends: at(SAT, '18:00') }));
  invalid({ ...alertUpdated('al-0012', 2, at(FRI, '20:20')), payload: { alert_id: 'al-0012', message: message('al-0012-m1', 'update', at(FRI, '20:20')) } });
  invalid(alertUpdated('al-0012', 2, at(FRI, '20:20'), { sent_at: at(FRI, '20:05') }));
  invalid(issued('iss-pfo-wren-3', at(FRI, '20:20'), [[12, {}]]));
  invalid(issued('iss-x', at(FRI, '20:20'), [[12, {}]], { issued_at: at(FRI, '20:30') }));
  invalid(issued('iss-x', at(FRI, '20:20'), [[12, { start: at(SAT, '12:30') }]]));
  invalid(issued('iss-x', at(FRI, '20:20'), [[12, { start: '2026-11-21T19:00:00Z' }]]));
  invalid(issued('iss-x', at(FRI, '20:20'), [[12, {}], [11, {}]]));
  invalid({ ...issued('iss-x', at(FRI, '20:20'), [[12, {}]]), payload: { ...issued('iss-x', at(FRI, '20:20'), [[12, {}]]).payload, place_id: 'pl-nowhere' } });
  invalid({ ...issued('iss-x', at(FRI, '20:20'), []), payload: { issuance_id: 'iss-x', source_id: 'src-pfo', place_id: WREN, issued_at: at(FRI, '20:20'), daily: [{ date: SAT, aqi: 40 }] } });
  invalid({ event_id: 'ev-ob', at: at(FRI, '20:20'), operation: 'rainshadow.observation.recorded', payload: { observation_id: 'ob-x', place_id: WREN, source_id: 'src-pfo', observed_at: at(FRI, '20:25'), temp_c: 7, wind_kph: 8, gust_kph: 14, conditions: 'clear' } });
  invalid({ event_id: 'ev-ob', at: at(FRI, '20:20'), operation: 'rainshadow.observation.recorded', payload: { observation_id: 'ob-x', place_id: WREN, source_id: 'src-pfo', observed_at: at(FRI, '18:50'), temp_c: 7, wind_kph: 8, gust_kph: 14, conditions: 'clear' } });
  assert.throws(() => plugin.applyEvent(app.ctx, app.data, { event_id: 'ev-unknown', at: at(FRI, '20:20'), operation: 'rainshadow.unknown', payload: {} }), { code: 'invalid_event' });
  app.event(alertCancelled('al-0012', 2, at(FRI, '20:30')));
  invalid(alertUpdated('al-0012', 3, at(FRI, '20:40')));
  invalid(alertCancelled('al-0012', 3, at(FRI, '20:40')));
  assert.equal(app.call('alerts.get', { id: 'al-0012' }).alert.message_count, 2);
});

test('T12 [W4] create and evaluate to clear, triggered and no_data; every condition variable', () => {
  const app = fixture(), make = (conditions, extra = {}) => app.call('watches.create', { ...HIKE, conditions, ...extra }).watch;
  const clear = make([{ variable: 'pop', value: 40 }, { variable: 'thunder_prob', value: 20 }]);
  assert.deepEqual([clear.id, clear.status, clear.label, clear.source_id, clear.aq_source_id], ['w-0004', 'clear', 'Saturday hike', 'src-pfo', null]);
  assert.deepEqual(clear.conditions, [{ variable: 'pop', op: 'gte', value: 40, unit: '%' }, { variable: 'thunder_prob', op: 'gte', value: 20, unit: '%' }]);
  assert.deepEqual(clear.evaluation.issuance, { id: 'iss-pfo-wren-3', issued_at: at(FRI, '15:00') });
  assert.deepEqual(clear.evaluation.hours, { considered: 3, missing: [] });
  assert.equal(clear.evaluation.cause.kind, 'create');

  const hit = make([{ variable: 'pop', value: 15 }]);
  assert.equal(hit.status, 'triggered');
  assert.deepEqual(hit.evaluation.conditions, [{ index: 0, evaluable: true, met: true, matches: [{ start: at(SAT, '11:00'), value: 15, unit: '%' }, { start: at(SAT, '12:00'), value: 15, unit: '%' }] }]);

  const beyond = make([{ variable: 'pop', value: 40 }], { start: at(SUN, '16:00'), end: at(SUN, '18:00') });
  assert.equal(beyond.status, 'no_data');
  assert.deepEqual(beyond.evaluation.hours, { considered: 0, missing: [at(SUN, '16:00'), at(SUN, '17:00')] });
  const partial = make([{ variable: 'pop', value: 40 }], { start: at(SUN, '13:00'), end: at(SUN, '17:00') });
  assert.deepEqual([partial.status, partial.evaluation.hours.considered, partial.evaluation.hours.missing], ['clear', 2, [at(SUN, '15:00'), at(SUN, '16:00')]]);

  const evening = { start: at(SAT, '18:00'), end: at(SAT, '22:00') };
  const first = (condition, extra = evening) => make([condition], extra).evaluation.conditions[0];
  assert.deepEqual(first({ variable: 'precip', value: 1.9 }).matches.map(m => [m.start.slice(11, 13), m.value]), [['20', 2], ['21', 2]]);
  assert.deepEqual(first({ variable: 'wind_gust', value: 47 }).matches.map(m => m.value), [47, 48]);
  assert.deepEqual(first({ variable: 'wind_speed', value: 23 }).matches.length, 3);
  assert.deepEqual(first({ variable: 'temp', op: 'lte', value: 5 }).matches, [{ start: at(SAT, '21:00'), value: 4.5, unit: 'C' }]);
  assert.equal(first({ variable: 'apparent_temp', op: 'lte', value: 3 }).met, false);
  assert.equal(first({ variable: 'thunder_prob', value: 40 }).matches.length, 2);

  const coast = { id: MARROW, start: at(SAT, '08:00', '-08:00'), end: at(SAT, '18:00', '-08:00') };
  const air = app.call('watches.create', { ...coast, conditions: [{ variable: 'aqi', value: 50 }] }).watch;
  assert.deepEqual([air.status, air.aq_source_id, air.evaluation.aq_issuance.id], ['triggered', 'src-aqb', 'aq-marrow-3'], 'the air-quality source defaults to the account\'s and is stored on the watch');
  assert.deepEqual(air.evaluation.conditions[0].matches, [{ date: SAT, value: 57, unit: 'index' }]);
  assert.deepEqual([air.evaluation.issuance, air.evaluation.dates], [null, { considered: 1, missing: [] }], 'the record names the issuance used and the dates covered');
  const far = app.call('watches.create', { id: MARROW, start: at(SUN, '08:00', '-08:00'), end: at('2026-11-24', '08:00', '-08:00'), conditions: [{ variable: 'aqi', value: 50 }] }).watch;
  assert.deepEqual([far.status, far.evaluation.dates], ['clear', { considered: 1, missing: ['2026-11-23', '2026-11-24'] }], 'dates the air-quality issuance does not cover are listed');
  const tonight = { id: MARROW, start: at(FRI, '20:00', '-08:00'), end: at(SAT, '02:00', '-08:00') };
  const flood = app.call('watches.create', { ...tonight, conditions: [{ variable: 'alert', category: 'flood', min_severity: 'severe' }, { variable: 'alert', category: 'wind' }, { variable: 'alert', min_severity: 'extreme' }] }).watch;
  assert.equal(flood.status, 'triggered');
  assert.deepEqual(flood.evaluation.conditions.map(c => [c.evaluable, c.met]), [[true, true], [true, false], [true, false]]);
  assert.deepEqual(flood.evaluation.conditions[0].matches, [{ alert_id: 'al-0004', message_id: 'al-0004-m1', severity: 'severe', category: 'flood' }]);
  assert.deepEqual(flood.conditions[2], { variable: 'alert', category: 'any', min_severity: 'extreme' });
  assert.equal(app.call('watches.create', { ...tonight, start: at(SAT, '05:00', '-08:00'), end: at(SAT, '09:00', '-08:00'), conditions: [{ variable: 'alert' }] }).watch.status, 'clear', 'the alert ends before this window');

  app.call('watches.cancel', { id: flood.id });
  app.call('preferences.update', { patch: { units: 'us' } });
  const us = make([{ variable: 'wind_gust', value: 29 }, { variable: 'temp', op: 'lte', value: 41 }, { variable: 'precip', value: 0.07 }], evening);
  assert.deepEqual(us.conditions.map(c => c.unit), ['mph', 'F', 'in']);
  assert.deepEqual(us.evaluation.conditions.map(c => c.matches.map(m => [m.start.slice(11, 13), m.value])), [[['19', 29.2], ['20', 29.83]], [['21', 40.1]], [['19', 0.07], ['20', 0.08], ['21', 0.08]]]);
  assert.equal(make([{ variable: 'wind_gust', value: 47, unit: 'km/h' }], evening).evaluation.conditions[0].matches.length, 2, 'an explicit unit is kept');
  rejects(app, () => make([{ variable: 'pop', value: 40, unit: 'mph' }]), 'invalid_arguments');
  rejects(app, () => app.call('watches.create', { ...HIKE, id: 'pl-tallowmere', conditions: [{ variable: 'pop', value: 40 }] }), 'not_found');
  rejects(app, () => make([{ variable: 'pop', value: 40 }], { source_id: 'src-aqb' }), 'not_found');
  rejects(app, () => make([{ variable: 'aqi', value: 100 }], { aq_source_id: 'src-pfo' }), 'not_found');
  rejects(app, () => make([{ variable: 'pop', value: 40 }], { aq_source_id: 'src-aqb' }), 'invalid_arguments');
  app.call('preferences.update', { patch: { default_air_source_id: null } });
  rejects(app, () => make([{ variable: 'aqi', value: 100 }]), 'not_found');
  assert.equal(make([{ variable: 'aqi', value: 100 }], { aq_source_id: 'src-aqb' }).aq_source_id, 'src-aqb', 'a named air-quality source needs no default');
});

test('T13 [W4] re-evaluation only on new information (weather and air-quality issuances); one notice per change; edits write none', () => {
  const app = fixture(), count = notices(app).length, watch = () => app.call('watches.get', { id: 'w-0002' }).watch;
  const created = watch().evaluation;
  app.advance(at(FRI, '20:15'));
  assert.deepEqual(watch().evaluation, created, 'time alone does not evaluate');
  app.event({ ...issued('iss-sky-wren-9', at(FRI, '20:20'), [[12, { pop: 90, thunder_prob: 60 }]]), payload: { ...issued('iss-sky-wren-9', at(FRI, '20:20'), [[12, { pop: 90, thunder_prob: 60 }]]).payload, source_id: 'src-skyline' } });
  assert.deepEqual(watch().evaluation, created, 'another source is not this watch\'s information');
  assert.equal(notices(app).length, count);

  app.event(scenario());
  const triggered = watch();
  assert.equal(triggered.status, 'triggered');
  assert.deepEqual(triggered.evaluation.issuance, { id: 'iss-pfo-wren-4', issued_at: at(FRI, '20:30') });
  assert.deepEqual(triggered.evaluation.cause, { kind: 'forecast.issued', event_id: 'example-forecast-2030' });
  assert.deepEqual(triggered.evaluation.conditions[0].matches, [{ start: at(SAT, '12:00'), value: 45, unit: '%' }]);
  let list = notices(app);
  assert.equal(list.length, count + 1);
  assert.deepEqual([list[0].kind, list[0].object, list[0].state], ['watch.triggered', { type: 'watch', id: 'w-0002' }, 'released']);
  assert.match(list[0].body, /pop 45% at 2026-11-21T12:00:00-07:00 meets pop >= 40%/);

  app.event(issued('iss-pfo-wren-5', at(FRI, '20:50'), [[10, {}], [11, {}], [12, { pop: 60, thunder_prob: 30 }]]));
  assert.equal(watch().status, 'triggered');
  assert.equal(watch().evaluation.issuance.id, 'iss-pfo-wren-5', 'the evaluation names the newest issuance');
  assert.equal(notices(app).length, count + 1, 'still triggered: no second notice');

  app.event(issued('iss-pfo-wren-6', at(FRI, '21:10'), [[10, {}], [11, { pop: 20 }], [12, { pop: 35, thunder_prob: 15 }]]));
  assert.equal(watch().status, 'clear');
  list = notices(app);
  assert.deepEqual([list.length, list[0].kind], [count + 2, 'watch.cleared']);

  const edited = app.call('watches.update', { id: 'w-0002', patch: { conditions: [{ variable: 'pop', value: 30 }] } }).watch;
  assert.deepEqual([edited.status, edited.evaluation.cause.kind, edited.updated_at], ['triggered', 'update', at(FRI, '21:10')]);
  assert.equal(notices(app).length, count + 2, 'a change the user made writes no notice');
  app.event(issued('iss-pfo-wren-7', at(FRI, '21:30'), [[13, { pop: 90 }]]));
  assert.equal(watch().status, 'no_data', 'the newest issuance covers none of the window');
  assert.equal(notices(app).length, count + 2, 'only changes into or out of triggered-to-clear write a notice');

  const stored = app.data;
  app.advance(at(SAT, '13:00'));
  assert.equal(watch().status, 'ended', 'time alone only ends a watch');
  assert.deepEqual(app.data, stored, 'and it does so without changing a record');
  app.event(issued('iss-pfo-wren-8', at(SAT, '13:05'), [[14, { pop: 90 }]]));
  assert.equal(watch().evaluation.issuance.id, 'iss-pfo-wren-7', 'an ended watch is not evaluated again');
  assert.equal(notices(app).length, count + 2);

  // An air-quality issuance is new information for a watch with an aqi condition.
  const coast = fixture(), walk = () => coast.call('watches.get', { id: 'w-0003' }).watch;
  const airIssued = (id, when, values, issuedAt = when) => ({ event_id: 'ev-' + id, at: when, operation: 'rainshadow.forecast.issued', payload: { issuance_id: id, source_id: 'src-aqb', place_id: MARROW, issued_at: issuedAt, daily: values.map(([date, aqi]) => ({ date, aqi, pollutant: 'pm25' })) } });
  assert.deepEqual([walk().status, walk().aq_source_id, walk().evaluation.aq_issuance.id], ['clear', 'src-aqb', 'aq-marrow-3']);
  const quiet = walk().evaluation;
  coast.event(issued('iss-pfo-wren-5', at(FRI, '20:10'), [[12, { pop: 90 }]]));
  assert.deepEqual(walk().evaluation, quiet, 'an issuance for another place is not this watch\'s information');
  const base = notices(coast).length;
  coast.event(airIssued('aq-marrow-4', at(FRI, '20:20'), [[SAT, 110], [SUN, 60]]));
  const smoky = walk();
  assert.deepEqual([smoky.status, smoky.evaluation.aq_issuance, smoky.evaluation.cause], ['triggered', { id: 'aq-marrow-4', issued_at: at(FRI, '20:20') }, { kind: 'forecast.issued', event_id: 'ev-aq-marrow-4' }]);
  assert.deepEqual(smoky.evaluation.conditions[0], { index: 0, evaluable: true, met: true, matches: [{ date: SAT, value: 110, unit: 'index' }] });
  assert.deepEqual(smoky.evaluation.dates, { considered: 1, missing: [] });
  let air = notices(coast);
  assert.deepEqual([air.length, air[0].kind, air[0].object], [base + 1, 'watch.triggered', { type: 'watch', id: 'w-0003' }]);
  assert.match(air[0].body, /^Regional Air Board forecast issued 2026-11-20T20:20:00-07:00: aqi 110 on 2026-11-21 meets aqi >= 101\./);
  coast.event(airIssued('aq-marrow-5', at(FRI, '20:40'), [[SAT, 125]]));
  assert.deepEqual([walk().status, walk().evaluation.aq_issuance.id, notices(coast).length], ['triggered', 'aq-marrow-5', base + 1], 'still triggered: the record moves on, no second notice');
  coast.event(airIssued('aq-marrow-6', at(FRI, '21:00'), [[SAT, 80]]));
  air = notices(coast);
  assert.deepEqual([walk().status, air.length, air[0].kind], ['clear', base + 2, 'watch.cleared']);
  coast.event(airIssued('aq-marrow-old', at(FRI, '21:10'), [[SAT, 300]], at(FRI, '12:00')));
  assert.deepEqual([walk().status, walk().evaluation.aq_issuance.id, notices(coast).length], ['clear', 'aq-marrow-6', base + 2], 'a late arrival with an older issue time changes nothing');
});

test('T13b [W4] alert conditions follow alert messages; the last started hour freezes hourly results', () => {
  const app = fixture(), count = notices(app).length;
  const w = app.call('watches.create', { ...HIKE, start: at(SAT, '16:00'), end: at(SAT, '20:00'), conditions: [{ variable: 'alert', category: 'flood', min_severity: 'severe' }] }).watch;
  assert.equal(w.status, 'clear');
  app.event(alertIssued('al-0012', at(FRI, '20:10')));
  assert.equal(app.call('watches.get', { id: w.id }).watch.status, 'clear', 'moderate is below the condition');
  app.event(alertUpdated('al-0012', 2, at(FRI, '20:20'), { severity: 'severe' }));
  assert.equal(app.call('watches.get', { id: w.id }).watch.status, 'triggered');
  app.event(alertCancelled('al-0012', 3, at(FRI, '20:40')));
  assert.equal(app.call('watches.get', { id: w.id }).watch.status, 'clear');
  assert.deepEqual(notices(app).slice(0, 5).map(n => n.kind), ['watch.cleared', 'alert.cancelled', 'watch.triggered', 'alert.updated', 'alert.issued']);
  assert.equal(notices(app).length, count + 5);

  const late = fixture();
  late.event(scenario());
  late.advance(at(SAT, '12:10'));
  late.event(issued('iss-pfo-wren-9', at(SAT, '12:20'), [[12, {}], [13, {}]]));
  const frozen = late.call('watches.get', { id: 'w-0002' }).watch;
  assert.deepEqual([frozen.status, frozen.evaluation.hours.frozen, frozen.evaluation.issuance.id], ['triggered', true, 'iss-pfo-wren-4']);
});

test('T14 [W4] update and cancel rules and limits', () => {
  const app = fixture(), pop = [{ variable: 'pop', value: 40 }];
  rejects(app, () => app.call('watches.create', { id: WREN, start: at(FRI, '10:00'), end: at(FRI, '20:00'), conditions: pop }), 'invalid_window');
  rejects(app, () => app.call('watches.create', { id: WREN, start: at(SAT, '13:00'), end: at(SAT, '10:00'), conditions: pop }), 'invalid_window');
  rejects(app, () => app.call('watches.create', { id: WREN, start: at(SAT, '10:00'), end: at('2026-12-01', '10:00:01'), conditions: pop }), 'invalid_window');
  assert.equal(app.call('watches.create', { id: WREN, start: at(SAT, '10:00'), end: at('2026-12-01', '10:00'), conditions: pop }).id, 'w-0004', 'exactly 10 days is allowed');

  rejects(app, () => app.call('watches.update', { id: 'w-0001', patch: { label: 'Again' } }), 'invalid_state');
  rejects(app, () => app.call('watches.cancel', { id: 'w-0001' }), 'invalid_state');
  rejects(app, () => app.call('watches.update', { id: 'w-9999', patch: { label: 'x' } }), 'not_found');
  rejects(app, () => app.call('watches.update', { id: 'w-0002', patch: {} }), 'invalid_arguments');
  rejects(app, () => app.call('watches.update', { id: 'w-0002', patch: { end: at(FRI, '19:00'), start: at(FRI, '18:00') } }), 'invalid_window');
  const link = { app_id: 'calendar', object_type: 'event', object_id: 'evt-hike' };
  const moved = app.call('watches.update', { id: 'w-0002', patch: { label: 'Hike, later start', start: at(SAT, '14:00'), end: at(SAT, '17:00'), linked_object: link } }).watch;
  assert.deepEqual([moved.label, moved.status, moved.linked_object, moved.evaluation.conditions[0].matches.map(m => m.value)], ['Hike, later start', 'triggered', link, [40, 50]]);
  assert.equal(app.call('watches.update', { id: 'w-0002', patch: { linked_object: null } }).watch.linked_object, null);
  const air = app.call('watches.update', { id: 'w-0003', patch: { conditions: [{ variable: 'alert' }] } }).watch;
  assert.equal(air.aq_source_id, null, 'no aqi condition, no air-quality source');
  rejects(app, () => app.call('watches.update', { id: 'w-0003', patch: { aq_source_id: 'src-aqb' } }), 'invalid_arguments');
  rejects(app, () => app.call('watches.update', { id: 'w-0003', patch: { conditions: [{ variable: 'aqi', value: 101 }], aq_source_id: 'src-skyline' } }), 'not_found');
  assert.equal(app.call('watches.update', { id: 'w-0003', patch: { conditions: [{ variable: 'aqi', value: 101 }] } }).watch.aq_source_id, 'src-aqb', 'a new aqi condition takes the account default');

  const cancelled = app.call('watches.cancel', { id: 'w-0002' }).watch;
  assert.deepEqual([cancelled.status, cancelled.cancelled_at], ['cancelled', app.now]);
  rejects(app, () => app.call('watches.cancel', { id: 'w-0002' }), 'invalid_state');
  rejects(app, () => app.call('watches.update', { id: 'w-0002', patch: { label: 'x' } }), 'invalid_state');
  assert.deepEqual(app.call('watches.list').watches.map(w => w.id), ['w-0003', 'w-0004']);
  assert.deepEqual(app.call('watches.list', { include_closed: true, place_id: WREN }).watches.map(w => [w.id, w.status]), [['w-0004', 'triggered'], ['w-0002', 'cancelled']]);
  rejects(app, () => app.call('watches.list', { place_id: 'pl-nowhere' }), 'not_found');

  for (let n = 0; n < 18; n++) app.call('watches.create', { ...HIKE, conditions: pop });
  assert.equal(app.call('watches.list').watches.length, 20);
  rejects(app, () => app.call('watches.create', { ...HIKE, conditions: pop }), 'limit_exceeded');
  app.call('watches.cancel', { id: 'w-0004' });
  assert.equal(app.call('watches.create', { ...HIKE, conditions: pop }).id, 'w-0023');
});

test('T15 [W4] notices: rule matching, one per alert message, quiet hours and release time, extreme bypass, email copy', () => {
  const app = fixture(), count = notices(app).length;
  app.event(alertIssued('al-0020', at(FRI, '20:05'), { severity: 'minor' }));
  app.event(alertIssued('al-0021', at(FRI, '20:06'), {}, { category: 'fire', zone_ids: ['z-marrow'] }));
  app.call('places.update', { id: WREN, patch: { alert_rule: { paused: true } } });
  app.event(alertIssued('al-0022', at(FRI, '20:07')));
  assert.equal(notices(app).length, count, 'below the minimum severity, outside the categories, or paused: no notice');
  app.call('places.update', { id: WREN, patch: { alert_rule: { paused: false } } });
  app.event(alertUpdated('al-0022', 2, at(FRI, '20:08'), {}));
  app.event(alertIssued('al-0023', at(FRI, '20:09'), {}, { zone_ids: ['z-wren', 'z-marrow'] }));
  let list = notices(app);
  assert.equal(list.length, count + 2, 'one notice per alert message');
  assert.deepEqual([list[1].kind, list[1].message_id, list[1].place_ids], ['alert.updated', 'al-0022-m2', [WREN]]);
  assert.deepEqual([list[0].place_ids, list[0].title, list[0].email_copy], [[WREN, MARROW], 'Flood Watch for Wren Lake (saved as Saturday hike) and 1 more saved place', true]);
  assert.deepEqual([list[0].state, list[0].release_at], ['released', at(FRI, '20:09')], 'outside quiet hours the release time is the creation time');
  assert.equal(app.data.notices.at(-1).wire.data.subscription_ref, 'rainshadow-maya:pl-wren-lake');

  // Quiet hours are 22:00-07:00 in the account's time zone.
  app.event(alertIssued('al-0024', at(FRI, '23:10')));
  app.event(alertIssued('al-0025', at(FRI, '23:10'), { severity: 'extreme', event: 'Flash Flood Emergency' }));
  app.event(alertUpdated('al-0024', 2, at(FRI, '23:20'), { severity: 'severe' }));
  list = notices(app);
  assert.deepEqual(list.slice(0, 3).map(n => [n.message_id, n.state, n.created_at, n.release_at, n.email_copy]), [
    ['al-0024-m2', 'held', at(FRI, '23:20'), at(SAT, '07:00'), true],
    ['al-0025-m1', 'released', at(FRI, '23:10'), at(FRI, '23:10'), true],
    ['al-0024-m1', 'held', at(FRI, '23:10'), at(SAT, '07:00'), true],
  ]);
  assert.deepEqual(app.call('notices.list', { state: 'held' }).notices.map(n => n.id), [list[0].id, list[2].id]);
  assert.equal(app.call('preferences.get').preferences.in_quiet_hours, true);
  const wires = () => Object.fromEntries(app.data.notices.filter(n => n.wire).map(n => [n.id, n.wire.time]));
  assert.deepEqual([wires()[list[0].id], wires()[list[1].id], wires()[list[2].id]], [at(SAT, '07:00'), at(FRI, '23:10'), at(SAT, '07:00')], 'the stored wire message is dated at the release time');

  // Nothing is rewritten when a release time passes: the state is read from it and the clock.
  const stored = app.data;
  app.advance(at(SAT, '06:59:59'));
  assert.equal(app.call('notices.list', { state: 'held' }).notices.length, 2);
  app.advance(at(SAT, '07:00'));
  assert.deepEqual(app.call('notices.list', { state: 'held' }).notices, []);
  assert.deepEqual(app.call('notices.list', { since: at(FRI, '23:00') }).notices.map(n => [n.state, n.release_at]), [['released', at(SAT, '07:00')], ['released', at(FRI, '23:10')], ['released', at(SAT, '07:00')]]);
  assert.deepEqual(app.data, stored);

  // The email copy is decided when the notice is written, not when it is released.
  app.call('preferences.update', { patch: { email_notices: false } });
  app.event(alertUpdated('al-0024', 3, at(SAT, '23:30'), { severity: 'severe' }));
  const silent = notices(app)[0];
  assert.deepEqual([silent.message_id, silent.state, silent.release_at, silent.email_copy], ['al-0024-m3', 'held', at(SUN, '07:00'), false]);
  app.call('preferences.update', { patch: { email_notices: true, quiet_hours: { enabled: false } } });
  app.advance(at(SUN, '07:00'));
  assert.deepEqual([notices(app)[0].state, notices(app)[0].email_copy, app.data.notices.at(-1).wire], ['released', false, undefined]);
  assert.equal(app.call('notices.list', { state: 'held' }).notices.length, 0, 'turning quiet hours off does not move a release time that was already set');
  app.event(alertCancelled('al-0024', 4, at(SUN, '23:30')));
  const last = notices(app)[0];
  assert.deepEqual([last.kind, last.state, last.release_at, last.email_copy, last.severity], ['alert.cancelled', 'released', at(SUN, '23:30'), true, 'severe']);

  assert.deepEqual(app.call('notices.list', { kind: 'watch.triggered' }).notices.map(n => n.id), ['ntc-0003']);
  const page = app.call('notices.list', { limit: 5 });
  assert.deepEqual([page.notices.length, page.next_cursor], [5, '5']);
  assert.ok(app.call('notices.list', { limit: 5, cursor: '5' }).notices.every(n => !page.notices.some(p => p.id === n.id)));
  rejects(app, () => app.call('notices.list', { cursor: 'x' }), 'invalid_arguments');
});

test('T16 [all] the platform clock: time moves with no App event', () => {
  // app.advance() stands for Core's env.advance_time here: it moves the clock and runs no App
  // code. The same sequence runs against the real operation in tests/mcp.integration.cjs.
  const app = fixture(), pop = [{ variable: 'pop', value: 40 }];
  app.event(alertIssued('al-0030', at(FRI, '23:10')));
  const held = notices(app)[0], status = () => app.call('alerts.get', { id: 'al-0030' }).alert.status;
  assert.deepEqual([held.state, held.release_at, held.email_copy, status()], ['held', at(SAT, '07:00'), true, 'upcoming']);
  for (let n = 0; n < 18; n++) app.call('watches.create', { ...HIKE, conditions: pop });
  rejects(app, () => app.call('watches.create', { ...HIKE, conditions: pop }), 'limit_exceeded');
  rejects(app, () => app.call('places.remove', { id: WREN }), 'place_in_use');
  const sent = {};
  assert.deepEqual(sender.pending(app.snapshot(), sent), [], 'seed notices are history and a held notice is not due');

  const stored = app.data, moves = [];
  const move = to => { app.advance(to); moves.push(to); assert.deepEqual(app.data, stored, 'moving the clock to ' + to + ' changes no business record'); };
  assert.throws(() => app.advance(at(FRI, '23:00')), { code: 'invalid_time' });
  move(at(SAT, '06:59:59'));
  assert.equal(notices(app)[0].state, 'held');
  move(at(SAT, '07:00'));
  assert.equal(notices(app)[0].state, 'released', 'a held notice reads released once the clock reaches its release time');
  assert.deepEqual(sender.pending(app.snapshot(), sent).map(n => [n.id, n.wire.id, n.wire.time]), [[held.id, held.id, at(SAT, '07:00')]], 'and the sender picks it up');

  move(at(SAT, '12:59:59'));
  assert.equal(app.call('watches.get', { id: 'w-0002' }).watch.status, 'clear');
  move(at(SAT, '13:00'));
  assert.equal(app.call('watches.get', { id: 'w-0002' }).watch.status, 'ended', 'a watch past its window reads ended');
  assert.deepEqual(app.call('watches.list').watches.map(w => w.id), ['w-0003']);
  assert.equal(app.call('watches.list', { include_closed: true }).watches.filter(w => w.status === 'ended').length, 20);
  rejects(app, () => app.call('watches.update', { id: 'w-0002', patch: { label: 'Too late' } }), 'invalid_state');
  rejects(app, () => app.call('watches.cancel', { id: 'w-0002' }), 'invalid_state');
  assert.equal(status(), 'upcoming');
  move(at(SAT, '18:00'));
  assert.equal(status(), 'active');
  move(at(SUN, '02:00'));
  assert.equal(status(), 'expired');
  rejects(app, () => app.call('alerts.acknowledge', { id: 'al-0030', message_id: 'al-0030-m1' }), 'invalid_state');

  // Writes use the same derivation: ended watches hold no place and do not count towards the limit.
  assert.equal(app.call('places.list').places.find(p => p.id === WREN).open_watches, 0);
  assert.equal(app.call('watches.create', { id: WREN, start: at(SUN, '10:00'), end: at(SUN, '13:00'), conditions: pop }).id, 'w-0022', 'the limit counts open watches only');
  app.call('watches.cancel', { id: 'w-0022' });
  assert.deepEqual(app.call('places.remove', { id: WREN }), { id: WREN, removed: true });
  assert.deepEqual(app.data.activity.slice(stored.activity.length).map(a => a.actor + ':' + a.action), ['agent:watches.create', 'agent:watches.cancel', 'agent:places.remove'], 'no activity row for a time-driven change');

  // The sender adapter with stand-in clients: selection, the request it builds, and its log.
  // The real Messaging and Mail flow is tests/mail.integration.cjs.
  return (async () => {
    const before = app.data;
    const published = [], source = { call: async name => (name === 'env.snapshot' ? { status: 'ok', snapshot: app.snapshot() } : { status: 'permission_denied' }) };
    const router = { call: async (name, args) => { published.push([name, args.request_id, args.message.id]); return { status: 'committed', event_id: 'mail-1', target: { app_id: 'mail', account_id: 'mail-maya' }, committed_at: 'x' }; } };
    const first = await sender.publishReleased({ source, router, sent });
    assert.deepEqual([first.stage, published, Object.keys(sent)], ['delivered', [['router.publish', 'rainshadow:1:' + held.id, held.id]], [held.id]]);
    const again = await sender.publishReleased({ source, router, sent });
    assert.deepEqual([again.stage, again.results.length, published.length], ['nothing_pending', 0, 1], 'a notice in the sender log is not published twice');
    const refusing = { call: async () => ({ status: 'rejected', code: 'recipient_not_authorized' }) };
    const refused = await sender.publishReleased({ source, router: refusing, sent: {} });
    assert.deepEqual([refused.stage, refused.results.length, Object.keys(refused.sent)], ['router_rejected', 1, []], 'a rejected delivery is reported and not logged as sent');
    assert.deepEqual(app.data, before, 'the sender writes nothing back');
  })();
});

test('T16b [all] a seed notice that is still held when the seed is loaded is published after its release time', () => {
  const seed = seedCopy(), prior = seed.notices.at(-1);
  seed.notices.push({ ...prior, id: 'ntc-0009', seq: prior.seq + 1000, created_at: at(FRI, '19:30'), release_at: at(SAT, '07:00'), title: prior.title + ' (held)', wire: { ...prior.wire, id: 'ntc-0009', time: at(SAT, '07:00') } });
  const app = fixture({ seed });
  assert.equal(notices(app)[0].state, 'held');
  assert.deepEqual(sender.pending(app.snapshot()), []);
  app.advance(at(SAT, '07:00'));
  assert.deepEqual(sender.pending(app.snapshot()).map(n => n.id), ['ntc-0009'], 'history that was already released at load time stays history');
});

const RUNTIME = process.env.PALE_RUNTIME_ROOT;
test('T17 [all] Core contracts and the real env.advance_time on the public runtime (real MCP)', t => {
  if (!RUNTIME) return t.skip('set PALE_RUNTIME_ROOT to the runtime directory of a public checkout, or run tests/mcp.integration.cjs --runtime DIR');
  const run = spawnSync(process.execPath, [path.join(__dirname, 'mcp.integration.cjs'), '--runtime', RUNTIME], { encoding: 'utf8', timeout: 180000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('T15b [W4] Rainshadow -> Mail through Messaging on the public runtime (real MCP)', t => {
  if (!RUNTIME) return t.skip('set PALE_RUNTIME_ROOT to the runtime directory of a public checkout that holds this package and the Mail package, or run tests/mail.integration.cjs --runtime DIR');
  const run = spawnSync(process.execPath, [path.join(__dirname, 'mail.integration.cjs'), '--runtime', RUNTIME], { encoding: 'utf8', timeout: 180000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('T18 [all] seed validation failures; one activity row per write, event and event effect, none for a time-driven change', () => {
  const app = fixture(), bad = change => { const seed = seedCopy(); change(seed); assert.throws(() => plugin.validateSeed(app.ctx, seed), { code: 'invalid_seed' }); };
  plugin.validateSeed(app.ctx, seedCopy());
  bad(s => { s.account_id = 'unbound-account'; });
  bad(s => { s.owner_person_id = 'person-nobody'; });
  bad(s => { s.places[1].id = s.places[0].id; });
  bad(s => { s.watches[0].id = s.alerts[0].id; });
  bad(s => { s.places[0].timezone = 'Nowhere/Land'; });
  bad(s => { s.places[0].zone_ids = ['z-nowhere']; });
  bad(s => { s.issuances[0].place_id = 'pl-nowhere'; });
  bad(s => { s.issuances[1].issued_at = s.issuances[0].issued_at; s.issuances[1].source_id = s.issuances[0].source_id; s.issuances[1].place_id = s.issuances[0].place_id; });
  bad(s => { const i = s.issuances.find(x => x.hourly); i.hourly[0].start = i.hourly[0].start.replace(':00:00', ':30:00'); });
  bad(s => { const i = s.issuances.find(x => x.hourly); i.hourly[0].start = new Date(Date.parse(i.hourly[0].start)).toISOString().replace('.000Z', 'Z'); });
  bad(s => { const i = s.issuances.find(x => x.hourly); i.hourly[1].start = i.hourly[0].start; });
  bad(s => { const i = s.issuances.find(x => x.hourly); i.daily[0] = { date: i.daily[0].date, aqi: 50 }; });
  bad(s => { const i = s.issuances.find(x => !x.hourly); i.hourly = [s.issuances.find(x => x.hourly).hourly[0]]; });
  bad(s => { const i = s.issuances.find(x => x.hourly); i.daily[1].date = '2026-02-30'; });
  bad(s => { s.observations[0].source_id = 'src-none'; });
  bad(s => { s.observations[1].observed_at = s.observations[0].observed_at; s.observations[1].place_id = s.observations[0].place_id; });
  bad(s => { s.alerts[0].messages[0].type = 'update'; });
  bad(s => { const a = s.alerts.find(x => x.id === 'al-0003'); a.messages.push({ ...a.messages[1], message_id: 'al-0003-m4', sent_at: at(FRI, '12:00') }); });
  bad(s => { s.alerts[1].messages[1].message_id = s.alerts[0].messages[0].message_id; });
  bad(s => { s.alerts[0].messages[0].ends = s.alerts[0].messages[0].onset; });
  bad(s => { delete s.alerts[0].messages[0].severity; });
  bad(s => { s.alerts[1].messages[1].sent_at = s.alerts[1].messages[0].sent_at; });
  bad(s => { s.alerts[0].zone_ids = ['z-nowhere']; });
  bad(s => { s.preferences.default_source_id = 'src-aqb'; });
  bad(s => { s.preferences.default_air_source_id = 'src-pfo'; });
  bad(s => { s.preferences.default_air_source_id = 'src-none'; });
  bad(s => { s.preferences.timezone = 'Nowhere/Land'; });
  bad(s => { s.preferences.quiet_hours.end = s.preferences.quiet_hours.start; });
  bad(s => { s.saved_places.push({ ...s.saved_places[0] }); });
  bad(s => { s.saved_places[0].place_id = 'pl-nowhere'; });
  bad(s => { s.acknowledgements[0].message_id = 'al-0001-m1'; });
  bad(s => { s.acknowledgements.push({ ...s.acknowledgements[0] }); });
  bad(s => { s.watches[0].source_id = 'src-aqb'; });
  bad(s => { s.watches[2].aq_source_id = 'src-pfo'; });
  bad(s => { delete s.watches[2].aq_source_id; });
  bad(s => { s.watches[0].aq_source_id = 'src-aqb'; });
  bad(s => { s.watches[0].end = s.watches[0].start; });
  bad(s => { s.watches[0].conditions[0].unit = 'F'; });
  bad(s => { s.watches[0].evaluation.issuance.id = 'iss-none'; });
  bad(s => { s.notices[2].object.id = 'w-9999'; });
  bad(s => { s.notices[0].message_id = 'al-0002-m1'; });
  bad(s => { s.notices[0].place_ids = ['pl-nowhere']; });
  bad(s => { s.notices[4].release_at = at('2026-11-19', '23:00', '-08:00'); });
  bad(s => { s.activity[1].seq = s.activity[0].seq; });
  // Shapes the seed schema refuses: time-based state is never stored.
  const refused = change => { const seed = seedCopy(); change(seed); assert.throws(() => fixture({ seed }), { code: 'schema_mismatch' }); };
  refused(s => { delete s.notices[0].release_at; });
  refused(s => { s.notices[0].released_at = s.notices[0].release_at; });
  refused(s => { s.watches[0].ended_at = s.watches[0].end; });
  refused(s => { s.activity[0].actor = 'timer'; });
  refused(s => { delete s.preferences.default_air_source_id; });
  const noAir = seedCopy(); noAir.preferences.default_air_source_id = null;
  plugin.validateSeed(app.ctx, noAir);

  const rows = () => app.data.activity.length;
  let n = rows();
  for (const read of [['places.list'], ['forecast.hourly', { id: WREN }], ['alerts.list', { id: MARROW }], ['watches.list'], ['notices.list'], ['preferences.get']]) app.call(...read);
  assert.equal(rows(), n, 'reads write no row');
  const writes = [
    ['places.save', { id: 'pl-tallowmere' }], ['places.update', { id: 'pl-tallowmere', patch: { label: 'Town' } }], ['places.remove', { id: 'pl-tallowmere' }],
    ['preferences.update', { patch: { units: 'us' } }], ['alerts.acknowledge', { id: 'al-0002', message_id: 'al-0002-m2' }],
    ['watches.create', { ...HIKE, conditions: [{ variable: 'pop', value: 40 }] }], ['watches.update', { id: 'w-0004', patch: { label: 'Second' } }], ['watches.cancel', { id: 'w-0004' }],
  ];
  for (const [name, args] of writes) {
    const result = app.call(name, { ...args, request_id: 'req-' + name }), last = app.data.activity.at(-1);
    assert.equal(rows(), ++n, name + ' writes one row');
    assert.deepEqual([last.actor, last.action, last.object_id, last.request_id, last.at, last.seq], ['agent', name, result.id, 'req-' + name, app.now, n]);
  }
  rejects(app, () => app.call('places.save', { id: 'pl-nowhere' }), 'not_found');
  assert.equal(rows(), n, 'a rejected call writes no row');
  app.advance(at(FRI, '20:30'));
  assert.equal(rows(), n, 'moving the clock writes no row');
  app.event(alertIssued('al-0040', at(FRI, '20:40'), {}, { zone_ids: ['z-tamsin'] }));
  assert.equal(rows(), ++n, 'an event with no further effect writes one row');
  app.event(alertIssued('al-0041', at(FRI, '20:50')));
  assert.equal(rows(), n += 2, 'the event and the notice it creates');
  assert.deepEqual(app.data.activity.slice(-2).map(a => [a.actor, a.action, a.event_id]), [['event', 'alert.issued', 'ev-al-0041'], ['event', 'notice.created', 'ev-al-0041']]);
  app.call('watches.create', { ...HIKE, conditions: [{ variable: 'pop', value: 40 }], request_id: 'req-second-watch' });
  n = rows();
  app.event(issued('iss-pfo-wren-9', at(FRI, '21:00'), [[10, {}], [11, {}], [12, { pop: 45 }]]));
  assert.deepEqual(app.data.activity.slice(n).map(a => [a.actor, a.action, a.object_id, a.event_id, a.at]), [
    ['event', 'forecast.issued', 'iss-pfo-wren-9', 'ev-iss-pfo-wren-9', at(FRI, '21:00')],
    ['event', 'watch.status_changed', 'w-0002', 'ev-iss-pfo-wren-9', at(FRI, '21:00')], ['event', 'notice.created', 'ntc-0010', 'ev-iss-pfo-wren-9', at(FRI, '21:00')],
    ['event', 'watch.status_changed', 'w-0005', 'ev-iss-pfo-wren-9', at(FRI, '21:00')], ['event', 'notice.created', 'ntc-0011', 'ev-iss-pfo-wren-9', at(FRI, '21:00')],
  ], 'one row for the event and one for each of its effects');
  n = rows();
  app.advance(at(SUN, '12:00'));
  assert.deepEqual([rows(), app.call('watches.list').watches.length, app.call('watches.list', { include_closed: true }).watches.filter(w => w.status === 'ended').length], [n, 0, 4], 'watches ended by time alone leave no row');
  assert.ok(app.data.activity.every(a => ['agent', 'event'].includes(a.actor)));
  const stored = app.data;
  assert.equal(stored.watches.find(w => w.id === 'w-0004').seq, stored.activity.find(a => a.action === 'watches.create' && a.object_id === 'w-0004').seq);
  assert.equal(stored.notices.at(-1).seq, stored.activity.at(-1).seq);
});

test('contracts, fixture and declarations are in step', () => {
  const dev = path.join(__dirname, '../dev');
  for (const [ref, text] of Object.entries(require(path.join(dev, 'build.cjs')).outputs())) assert.equal(fs.readFileSync(path.join(__dirname, '..', ref), 'utf8'), text, ref + ' differs from dev/contracts.cjs');
  const builder = require(path.join(dev, 'build-fixture.cjs'));
  assert.equal(fs.readFileSync(path.join(__dirname, '../fixtures/minimal.json'), 'utf8'), builder.print(builder.build()) + '\n', 'fixtures/minimal.json differs from dev/build-fixture.cjs');
  assert.deepEqual(require(path.join(dev, 'check-fixture.cjs')).check(), []);
  const manifest = require('../app.json'), tools = require('../tools.json'), declared = require('../contribution/contribution.json');
  assert.deepEqual(tools.map(t => t.name.slice(11)).sort(), require('../src/operations.cjs').tools.slice().sort());
  assert.deepEqual([tools.filter(t => t.read_only).length, tools.filter(t => !t.read_only).length], [13, 8]);
  assert.deepEqual(declared.events.accepts.map(e => e.type), manifest.event_types);
  assert.deepEqual(manifest.event_types.map(e => e.slice(11)), ['forecast.issued', 'observation.recorded', 'alert.issued', 'alert.updated', 'alert.cancelled'], 'five events and no clock event');
  assert.deepEqual(require('../schemas/events.schema.json').oneOf.map(e => e.properties.operation.const), manifest.event_types);
  assert.deepEqual(declared.messaging.receives, []);
  assert.deepEqual(declared.messaging.publishes.map(p => [p.channel, p.schema_id, p.status]), [['channel.email', 'urn:pale:email-message:2', 'implemented']]);
  const wire = scenarioWire();
  assert.deepEqual([wire.specversion, wire.id, wire.source, wire.type, wire.dataschema, wire.time, wire.data.channel, wire.data.recipient, wire.data.source_object, wire.data.subscription_ref, wire.data.content.asset_ids],
    ['1.0', 'ntc-0009', 'urn:pale:app:rainshadow:account:rainshadow-maya', 'org.pale.mail.notification.v1', 'urn:pale:email-payload:1', at(FRI, '20:30'), 'channel.email', { kind: 'person_ref', id: 'person-maya' },
      { app_id: 'rainshadow', account_id: 'rainshadow-maya', object_type: 'watch', object_id: 'w-0002' }, 'rainshadow-maya:pl-wren-lake', []]);
  // Every stored wire message passes the package's copy of Mail's wire schema (urn:pale:email-message:2).
  const wireSchema = require('../schemas/router-message.schema.json'), wireValid = require('./schema-validator.cjs').compile(wireSchema, path.join(__dirname, '../schemas'));
  assert.equal(wireSchema.$id, 'urn:pale:email-message:2');
  const quiet = fixture();
  quiet.event(alertIssued('al-0030', at(FRI, '23:10')));
  const heldWire = quiet.data.notices.at(-1).wire;
  assert.equal(heldWire.time, at(SAT, '07:00'), 'a held notice is dated at its release time');
  for (const candidate of [wire, heldWire, ...seedCopy().notices.map(n => n.wire)]) assert.ok(wireValid(candidate), 'wire message ' + candidate.id + ' matches Mail\'s schema');
  const noRecipient = structuredClone(wire); delete noRecipient.data.recipient;
  const otherType = { ...structuredClone(wire), type: 'org.pale.other.v1' };
  assert.deepEqual([wireValid(noRecipient), wireValid(otherType)], [false, false], 'broken variants fail');
  assert.equal(require('../fixtures/clock.json').initial_time, builder.CLOCK);
  assert.equal(require('../contribution/dataset.json').expected_counts.records, plugin.records(seedCopy()).length);
  const event = scenario();
  assert.ok(manifest.event_types.includes(event.operation));
});

test('the package runs on its own: no import or file path leaves its folder', () => {
  const root = path.resolve(__dirname, '..'), files = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.(cjs|js|mjs)$/.test(e.name)) files.push(f); } };
  walk(root);
  assert.ok(files.length >= 20);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8'), rel = path.relative(root, file);
    for (const m of text.matchAll(/require\(\s*(['"`])([^'"`]+)\1\s*\)/g)) {
      const target = m[2];
      if (target.startsWith('node:')) continue;
      assert.ok(target.startsWith('.'), rel + ' requires ' + target + ': only Node built-ins and package files are allowed');
      const resolved = path.resolve(path.dirname(file), target);
      assert.ok(resolved === root || resolved.startsWith(root + path.sep), rel + ' requires a file outside the package: ' + target);
    }
    // A literal path may climb at most to the package root (the file's own depth below it).
    const depth = rel.split(path.sep).length - 1;
    for (const m of text.matchAll(/['"`](\.\.(?:\/[^'"`]*)?)['"`]/g)) {
      const parts = m[1].split('/'), climbs = parts.findIndex(x => x !== '..');
      assert.ok((climbs === -1 ? parts.length : climbs) <= depth, rel + ' has a path that leaves the package: ' + m[0]);
    }
  }
  // The business entrypoint and everything under src/ never touch the file system, the network or a child process.
  for (const file of files.filter(f => path.relative(root, f).startsWith('src' + path.sep) || path.relative(root, f) === 'plugin.cjs')) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /node:(fs|child_process|net|http|https|dgram|worker_threads)|Date\.now\(|new Date\(\)/, path.relative(root, file));
  }
});
