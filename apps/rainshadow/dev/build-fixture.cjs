#!/usr/bin/env node
'use strict';
// Authoring-time script, never run by the App or the host.
//   node dev/build-fixture.cjs          write fixtures/minimal.json
//   node dev/build-fixture.cjs --check  exit 1 if the committed fixture differs
//
// The fixture is a snapshot of a scripted, fully synthetic history: a small invented world
// (two regions in two time zones) and three days of forecasts, observations, alerts and
// account activity, replayed through the App's own business functions so that notices,
// watch evaluations and the activity log are consistent with the rules. Forecast numbers
// come from the closed-form toy model below (no random numbers, no observed weather).
const fs = require('node:fs'), path = require('node:path');
const { fixture } = require('../tests/harness.cjs');
const { HOUR, isoAt, localDate, localMinutes, localToInstant, addDays } = require('../src/util.cjs');

const MODEL_VERSION = '1';
const A = 'America/Denver', B = 'America/Los_Angeles';
const at = (date, hhmm, tz) => localToInstant(date, hhmm, tz);
const iso = (date, hhmm, tz) => isoAt(at(date, hhmm, tz), tz);
const WED = '2026-11-18', THU = '2026-11-19', FRI = '2026-11-20', SAT = '2026-11-21', SUN = '2026-11-22';

const zones = [
  ['z-wren', 'Wren Lake Basin'], ['z-tallow-valley', 'Tallowmere Valley'], ['z-tallow-high', 'Tallowmere High Country'], ['z-cinder', 'Cinderhorn Pass Corridor'],
  ['z-saltgrass-coast', 'Saltgrass Coast'], ['z-marrow', 'Marrowby Bay Shore'], ['z-tamsin', 'Tamsin Heights'], ['z-saltgrass-inland', 'Saltgrass Inland Valleys'],
].map(([id, name]) => ({ id, name }));

// Place records plus the toy-model parameters used only by this script.
const P = {
  wren: { id: 'pl-wren-lake', name: 'Wren Lake', region: 'Tallowmere County', tz: A, zones: ['z-wren'], base: 9, amp: 6, wind: 10 },
  tallow: { id: 'pl-tallowmere', name: 'Tallowmere', region: 'Tallowmere County', tz: A, zones: ['z-tallow-valley'], base: 11, amp: 7, wind: 8 },
  cinder: { id: 'pl-cinderhorn-pass', name: 'Cinderhorn Pass', region: 'Tallowmere County', tz: A, zones: ['z-tallow-high', 'z-cinder'], base: 2, amp: 5, wind: 28 },
  brindle: { id: 'pl-port-brindle', name: 'Port Brindle', region: 'Saltgrass Coast', tz: B, zones: ['z-saltgrass-coast'], base: 13, amp: 3, wind: 14 },
  marrow: { id: 'pl-marrowby', name: 'Marrowby', region: 'Saltgrass Coast', tz: B, zones: ['z-saltgrass-coast', 'z-marrow'], base: 12.5, amp: 3, wind: 16 },
  tamsin: { id: 'pl-tamsin-heights', name: 'Tamsin Heights', region: 'Saltgrass Coast', tz: B, zones: ['z-tamsin', 'z-saltgrass-inland'], base: 8, amp: 6, wind: 9 },
};
const places = Object.values(P).map(p => ({ id: p.id, name: p.name, region: p.region, timezone: p.tz, zone_ids: p.zones }));
const sources = [
  { id: 'src-pfo', name: 'Public Forecast Office', kind: 'weather' },
  { id: 'src-skyline', name: 'Skyline Weather', kind: 'weather' },
  { id: 'src-aqb', name: 'Regional Air Board', kind: 'air_quality' },
];

// ---- toy forecast model ---------------------------------------------------------------
const STORM_A = at(SAT, '21:00', A), RAIN_B = at(SUN, '08:00', B), WIND_CINDER = at(THU, '18:00', A), COLD_TAMSIN = at(SAT, '05:00', B);
const DAY_SHIFT = { '2026-11-18': 0.5, '2026-11-19': 0, '2026-11-20': -0.5, '2026-11-21': -1.5, '2026-11-22': -3, '2026-11-23': -2.5, '2026-11-24': -1, '2026-11-25': 0, '2026-11-26': 0.5, '2026-11-27': 1 };
// A later issuance moves the Saturday system earlier and makes it stronger; the second source lags by an hour.
const REV = {
  'src-pfo': [{ shift: 2, peak: 70, bias: 0 }, { shift: 1, peak: 75, bias: 0 }, { shift: 0, peak: 80, bias: 0 }],
  'src-skyline': [{ shift: 3, peak: 60, bias: 0.6 }, { shift: 2, peak: 65, bias: 0.6 }, { shift: 1, peak: 70, bias: 0.6 }],
};
const bump = (t, center, widthHours) => Math.exp(-((((t - center) / HOUR) / widthHours) ** 2));
const round5 = v => Math.round(v / 5) * 5;
const round1 = v => Math.round(v * 10) / 10;

function sample(p, t, rev) {
  const hour = localMinutes(t, p.tz) / 60, regionA = p.tz === A, day = Math.cos((2 * Math.PI * (hour - 15)) / 24);
  const system = regionA ? bump(t, STORM_A + rev.shift * HOUR, 6.53) : bump(t, RAIN_B + rev.shift * HOUR, 5);
  const pop = Math.min(100, round5(5 + (regionA ? rev.peak : rev.peak - 25) * system));
  const thunder = regionA && pop >= 30 ? round5(pop * 0.45) : round5(pop * 0.1);
  const gap = p === P.cinder ? bump(t, WIND_CINDER, 3.5) : 0;
  const wind = Math.round(p.wind + 4 * day + (regionA ? 12 * system : 6 * system) + 14 * gap);
  const cold = p === P.tamsin ? bump(t, COLD_TAMSIN, 4) : 0;
  const temp = round1(p.base + (DAY_SHIFT[localDate(t, p.tz)] ?? 0) + p.amp * day - 3 * system - 6 * cold + rev.bias);
  const sky = thunder >= 30 ? 'thunderstorm' : pop >= 70 ? 'heavy_rain' : pop >= 50 ? 'rain' : pop >= 30 ? 'mostly_cloudy' : hour >= 7 && hour < 18 ? (pop >= 15 ? 'partly_cloudy' : 'mostly_clear') : pop >= 15 ? 'partly_cloudy' : 'clear';
  return {
    start: isoAt(t, p.tz), temp_c: temp, apparent_temp_c: round1(temp - (wind > 20 ? (wind - 20) * 0.12 : 0) - (pop >= 60 ? 0.5 : 0)), pop,
    precip_mm: pop >= 30 ? round1((pop - 20) * 0.03) : 0, wind_kph: wind, gust_kph: Math.round(wind * (1.6 + 0.5 * system)), thunder_prob: thunder, sky,
  };
}

function dailyRow(p, date, rev) {
  const start = at(date, '00:00', p.tz), hours = [];
  for (let h = 0; h < 30; h++) hours.push(sample(p, start + h * HOUR, rev));
  const dayHours = hours.slice(0, 24), temps = dayHours.map(r => r.temp_c);
  const popDay = Math.max(...hours.slice(6, 18).map(r => r.pop)), popNight = Math.max(...hours.slice(18, 30).map(r => r.pop));
  const top = Math.max(popDay, popNight), storms = hours.slice(6, 30).some(r => r.thunder_prob >= 30), windy = Math.max(...dayHours.map(r => r.wind_kph)) >= 30;
  const high = Math.max(...temps), low = Math.min(...temps);
  let headline, summary;
  if (storms && top >= 60) { headline = popDay >= 30 ? 'Strong storms, ' + popDay + '%' : 'Storms at night, ' + popNight + '%'; summary = popNight > popDay ? 'Storms develop late in the day.' : 'Storms through the day.'; }
  else if (top >= 50) { headline = 'Rain likely, ' + top + '%'; summary = popNight > popDay ? 'Rain arrives in the evening.' : 'Periods of rain.'; }
  else if (top >= 30) { headline = 'Chance of showers, ' + top + '%'; summary = 'A few showers are possible.'; }
  else if (high <= 3) { headline = 'Cold and dry'; summary = windy ? 'Dry, cold and windy.' : 'Dry and cold with light winds.'; }
  else { headline = top >= 15 ? 'Partly cloudy' : 'Mostly sunny'; summary = windy ? 'Dry and breezy.' : 'Dry with light winds.'; }
  return { date, headline, summary, high_c: high, low_c: low, pop_day: popDay, pop_night: popNight };
}

function weatherIssuance(key, sourceId, n, date, hhmm) {
  const p = P[key], rev = REV[sourceId][n - 1], t0 = at(date, hhmm, p.tz), hourly = [], daily = [];
  for (let h = 0; h < 48; h++) hourly.push(sample(p, t0 + h * HOUR, rev));
  for (let d = 0; d < 7; d++) daily.push(dailyRow(p, addDays(date, d), rev));
  return { issuance_id: 'iss-' + (sourceId === 'src-pfo' ? 'pfo' : 'sky') + '-' + key + '-' + n, source_id: sourceId, place_id: p.id, issued_at: isoAt(t0, p.tz), hourly, daily };
}

// Air quality: wildfire smoke drifts over the coast on Thursday and Friday, then clears.
const AQ = {
  wren: [[24, 28, 31], [27, 30, 33], [29, 34, 30]], tallow: [[35, 38, 41], [37, 42, 44], [40, 43, 39]], cinder: [[18, 20, 22], [19, 22, 24], [21, 23, 20]],
  brindle: [[58, 95, 120], [132, 141, 110], [96, 62, 48]], marrow: [[52, 88, 112], [124, 133, 104], [90, 57, 44]], tamsin: [[44, 61, 78], [83, 90, 72], [66, 49, 38]],
};
function airIssuance(key, n, date) {
  const p = P[key], t0 = at(date, '10:00', p.tz), smoke = p.tz === B;
  return {
    issuance_id: 'aq-' + key + '-' + n, source_id: 'src-aqb', place_id: p.id, issued_at: isoAt(t0, p.tz),
    daily: AQ[key][n - 1].map((aqi, d) => ({ date: addDays(date, d), aqi, pollutant: smoke && aqi > 50 ? 'pm25' : 'ozone' })),
  };
}

function observation(key, n, hhmm) {
  const p = P[key], t = at(FRI, hhmm, p.tz), r = sample(p, t - 50 * 60000, REV['src-pfo'][2]);
  return { observation_id: 'ob-' + key + '-' + n, place_id: p.id, source_id: 'src-pfo', observed_at: isoAt(t, p.tz), temp_c: round1(r.temp_c + (n === 1 ? 0.4 : -0.2)), wind_kph: r.wind_kph, gust_kph: r.gust_kph, conditions: r.sky, humidity: regionHumidity(p, n) };
}
const regionHumidity = (p, n) => (p.tz === A ? 38 : 71) + n * 3;

// ---- scripted history -------------------------------------------------------------------
const steps = [];
const push = (t, run) => steps.push({ t, order: steps.length, run });
const event = (t, tz, operation, payload) => push(t, (app, id) => app.event({ event_id: id, at: isoAt(t, tz), operation: 'rainshadow.' + operation, payload }));
// An agent action happens in a session that Infra opens by moving the clock to that time
// (Core's env.advance_time on a real host; no App code runs and nothing is recorded).
const agent = (t, tz, name, args) => push(t, (app, id) => { app.advance(isoAt(t, tz)); app.call(name, { ...args, request_id: id.replace('ev', 'req') }); });
const message = (id, type, t, tz, fields) => ({ message_id: id, type, sent_at: isoAt(t, tz), ...fields });

for (const key of Object.keys(P)) {
  const tz = P[key].tz;
  [[1, WED], [2, THU], [3, FRI]].forEach(([n, date]) => event(at(date, '10:00', tz), tz, 'forecast.issued', airIssuance(key, n, date)));
  [[1, THU, '15:00'], [2, FRI, '03:00'], [3, FRI, '15:00']].forEach(([n, date, hhmm]) => event(at(date, hhmm, tz), tz, 'forecast.issued', weatherIssuance(key, 'src-pfo', n, date, hhmm)));
  [[1, THU, '18:00'], [2, FRI, '06:00'], [3, FRI, '18:00']].forEach(([n, date, hhmm]) => event(at(date, hhmm, tz), tz, 'forecast.issued', weatherIssuance(key, 'src-skyline', n, date, hhmm)));
  [[1, '17:50'], [2, '18:50']].forEach(([n, hhmm]) => event(at(FRI, hhmm, tz), tz, 'observation.recorded', observation(key, n, hhmm)));
}

let t = at(WED, '12:00', A);
event(t, A, 'alert.issued', {
  alert_id: 'al-0001', source_id: 'src-pfo', category: 'winter', zone_ids: ['z-cinder'],
  message: message('al-0001-m1', 'alert', t, A, { event: 'Winter Weather Advisory', severity: 'moderate', urgency: 'expected', certainty: 'likely', onset: iso(WED, '18:00', A), ends: iso(THU, '10:00', A), headline: 'Winter Weather Advisory from Wednesday evening to Thursday morning', description: 'Snow showers and slick roads are expected over the pass.', instruction: 'Slow down and allow extra travel time.' }),
});
t = at(THU, '09:00', A);
event(t, A, 'alert.issued', {
  alert_id: 'al-0002', source_id: 'src-pfo', category: 'wind', zone_ids: ['z-tallow-high'],
  message: message('al-0002-m1', 'alert', t, A, { event: 'Wind Advisory', severity: 'moderate', urgency: 'expected', certainty: 'likely', onset: iso(FRI, '12:00', A), ends: iso(SAT, '00:00', A), headline: 'Wind Advisory from Friday noon to midnight', description: 'West winds with strong gusts are expected in the high country.', instruction: 'Secure loose objects and use caution with high-profile vehicles.' }),
});
agent(at(THU, '12:00', A), A, 'alerts.acknowledge', { id: 'al-0002', message_id: 'al-0002-m1' });
agent(at(THU, '13:00', A), A, 'watches.create', {
  id: P.cinder.id, label: 'Drive up Thursday', start: iso(THU, '15:00', A), end: iso(THU, '20:00', A), conditions: [{ variable: 'wind_gust', op: 'gte', value: 60, unit: 'km/h' }],
});
t = at(THU, '16:00', B);
event(t, B, 'alert.issued', {
  alert_id: 'al-0003', source_id: 'src-aqb', category: 'air_quality', zone_ids: ['z-saltgrass-coast'],
  message: message('al-0003-m1', 'alert', t, B, { event: 'Air Quality Alert', severity: 'moderate', urgency: 'expected', certainty: 'likely', onset: iso(THU, '16:00', B), ends: iso(SAT, '12:00', B), headline: 'Air Quality Alert for wildfire smoke until Saturday noon', description: 'Smoke is expected to reach levels that are unhealthy for sensitive groups along the coast.', instruction: 'People with heart or lung disease, older adults and children should limit time outdoors.' }),
});
t = at(THU, '23:30', B);
event(t, B, 'alert.updated', {
  alert_id: 'al-0003',
  message: message('al-0003-m2', 'update', t, B, { event: 'Air Quality Alert', severity: 'severe', urgency: 'immediate', certainty: 'observed', onset: iso(THU, '16:00', B), ends: iso(SUN, '00:00', B), headline: 'Air Quality Alert extended to Saturday midnight; smoke is now unhealthy', description: 'Monitors along the coast report unhealthy smoke levels overnight.', instruction: 'Everyone should limit time outdoors; keep windows closed.' }),
});
t = at(FRI, '08:00', A);
event(t, A, 'alert.updated', {
  alert_id: 'al-0002',
  message: message('al-0002-m2', 'update', t, A, { event: 'Wind Advisory', severity: 'moderate', urgency: 'expected', certainty: 'likely', onset: iso(FRI, '12:00', A), ends: iso(SAT, '06:00', A), headline: 'Wind Advisory now lasts until Saturday 6 AM', description: 'Gusty west winds continue through Friday night in the high country.', instruction: 'Secure loose objects and use caution with high-profile vehicles.' }),
});
t = at(FRI, '07:30', B);
event(t, B, 'alert.issued', {
  alert_id: 'al-0004', source_id: 'src-pfo', category: 'flood', zone_ids: ['z-marrow'],
  message: message('al-0004-m1', 'alert', t, B, { event: 'Coastal Flood Advisory', severity: 'severe', urgency: 'expected', certainty: 'likely', onset: iso(FRI, '16:00', B), ends: iso(SAT, '04:00', B), headline: 'Coastal Flood Advisory from Friday 4 PM to Saturday 4 AM', description: 'High tides may flood low roads and parking areas along the bay shore.', instruction: 'Do not drive through flooded roads. Move vehicles from low parking areas.' }),
});
t = at(FRI, '09:00', B);
event(t, B, 'alert.cancelled', { alert_id: 'al-0003', message: message('al-0003-m3', 'cancel', t, B, { headline: 'Air Quality Alert cancelled', description: 'Onshore winds cleared the smoke earlier than forecast.' }) });
t = at(FRI, '11:00', B);
event(t, B, 'alert.issued', {
  alert_id: 'al-0005', source_id: 'src-pfo', category: 'temperature', zone_ids: ['z-tamsin'],
  message: message('al-0005-m1', 'alert', t, B, { event: 'Freeze Warning', severity: 'moderate', urgency: 'future', certainty: 'likely', onset: iso(SAT, '02:00', B), ends: iso(SAT, '09:00', B), headline: 'Freeze Warning from 2 AM to 9 AM Saturday', description: 'Temperatures near or below freezing are expected in the heights.', instruction: 'Protect tender plants and outdoor pipes.' }),
});
t = at(FRI, '13:00', A);
event(t, A, 'alert.issued', {
  alert_id: 'al-0006', source_id: 'src-pfo', category: 'other', zone_ids: ['z-tallow-valley'],
  message: message('al-0006-m1', 'alert', t, A, { event: 'Dense Fog Advisory', severity: 'minor', urgency: 'future', certainty: 'possible', onset: iso(SAT, '04:00', A), ends: iso(SAT, '09:00', A), headline: 'Dense Fog Advisory from 4 AM to 9 AM Saturday', description: 'Patchy dense fog may reduce visibility in the valley.', instruction: 'Use low beams and leave extra following distance.' }),
});
agent(at(FRI, '16:00', A), A, 'watches.create', {
  id: P.wren.id, start: iso(SAT, '10:00', A), end: iso(SAT, '13:00', A), conditions: [{ variable: 'pop', value: 40 }, { variable: 'thunder_prob', value: 20 }],
});
agent(at(FRI, '16:30', A), A, 'watches.create', {
  id: P.marrow.id, label: 'Mom\'s walk', start: iso(SAT, '08:00', B), end: iso(SAT, '18:00', B),
  conditions: [{ variable: 'aqi', value: 101 }, { variable: 'alert', category: 'air_quality', min_severity: 'moderate' }],
});

function base() {
  const all = ['flood', 'storm', 'winter', 'wind', 'temperature', 'fire', 'air_quality', 'other'];
  return {
    account_id: 'rainshadow-maya', owner_person_id: 'person-maya', zones, places, sources, issuances: [], observations: [], alerts: [],
    preferences: { units: 'metric', default_source_id: 'src-pfo', default_air_source_id: 'src-aqb', timezone: A, quiet_hours: { enabled: true, start: '22:00', end: '07:00' }, email_notices: true },
    saved_places: [
      { place_id: P.wren.id, label: 'Saturday hike', alert_rule: { categories: all, min_severity: 'moderate', paused: false }, saved_at: iso('2026-11-10', '19:20', A) },
      { place_id: P.marrow.id, label: 'Mom\'s house', alert_rule: { categories: ['flood', 'storm', 'wind', 'temperature', 'air_quality'], min_severity: 'minor', paused: false }, saved_at: iso('2026-11-10', '19:24', A) },
      { place_id: P.cinder.id, label: 'Ski cabin road', alert_rule: { categories: ['winter', 'wind'], min_severity: 'moderate', paused: false }, saved_at: iso('2026-11-12', '08:05', A) },
    ],
    acknowledgements: [], watches: [], notices: [], activity: [],
  };
}
const binding = { people: [{ person_id: 'person-maya', name: 'Maya Chen' }], accounts: [{ app_id: 'rainshadow', account_id: 'rainshadow-maya', owner_person_id: 'person-maya' }], objects: {} };
const CLOCK = iso(FRI, '20:00', A);

function build() {
  const app = fixture({ seed: base(), now: iso(WED, '08:00', A), binding });
  steps.sort((a, b) => a.t - b.t || a.order - b.order).forEach((step, i) => step.run(app, 'seed-ev-' + String(i + 1).padStart(3, '0')));
  app.advance(CLOCK);
  const data = app.data;
  const count = { zones: 8, places: 6, sources: 3, issuances: 54, observations: 12, alerts: 6, saved_places: 3, watches: 3, notices: 8 };
  for (const [key, n] of Object.entries(count)) if (data[key].length !== n) throw Error('Fixture count drift: ' + key + ' = ' + data[key].length + ', expected ' + n);
  return data;
}

// Compact but reviewable JSON: records whose values are all primitives stay on one line.
function print(value, indent = '') {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const flat = v => v === null || typeof v !== 'object';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every(flat)) return JSON.stringify(value);
    return '[\n' + value.map(v => indent + ' ' + print(v, indent + ' ')).join(',\n') + '\n' + indent + ']';
  }
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  if (entries.every(([, v]) => flat(v))) return '{' + entries.map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ') + '}';
  return '{\n' + entries.map(([k, v]) => indent + ' ' + JSON.stringify(k) + ': ' + print(v, indent + ' ')).join(',\n') + '\n' + indent + '}';
}

module.exports = { build, print, CLOCK, MODEL_VERSION, sample, dailyRow, P, REV };
if (require.main === module) {
  const file = path.join(__dirname, '../fixtures/minimal.json'), text = print(build()) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('fixtures/minimal.json differs from dev/build-fixture.cjs'); process.exit(1); }
    console.log('fixtures/minimal.json matches dev/build-fixture.cjs.');
  } else { fs.writeFileSync(file, text); console.log('Wrote fixtures/minimal.json (' + text.length + ' bytes).'); }
}
