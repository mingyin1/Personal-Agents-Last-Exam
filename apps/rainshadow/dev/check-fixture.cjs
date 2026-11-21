#!/usr/bin/env node
'use strict';
// Authoring-time consistency check of fixtures/minimal.json, independent of the script
// that wrote it. `node dev/check-fixture.cjs` prints problems and exits 1 if there are any.
// It checks the promised scale, contiguous hours, value ranges, date and offset alignment
// per place, and that each daily row agrees with the hourly rows of the same local date.
// It cannot check realism or that names are fictional: that stays a human review item.
const path = require('node:path');
const { HOUR, ms, isoAt, localDate, addDays, writtenOffset, offsetMinutes } = require('../src/util.cjs');
const { alertStatus } = require('../src/model.cjs');

function check(data = require('../fixtures/minimal.json'), clock = require('../fixtures/clock.json').initial_time) {
  const problems = [], expect = (ok, message) => { if (!ok) problems.push(message); };
  const places = new Map(data.places.map(p => [p.id, p])), sources = new Map(data.sources.map(s => [s.id, s]));
  const weather = data.issuances.filter(i => sources.get(i.source_id).kind === 'weather'), air = data.issuances.filter(i => sources.get(i.source_id).kind === 'air_quality');

  // Scale promised in the proposal.
  const scale = {
    'time zones': [new Set(data.places.map(p => p.timezone)).size, 2], regions: [new Set(data.places.map(p => p.region)).size, 2], places: [data.places.length, 6], zones: [data.zones.length, 8],
    'weather sources': [data.sources.filter(s => s.kind === 'weather').length, 2], 'air-quality sources': [data.sources.filter(s => s.kind === 'air_quality').length, 1],
    'weather issuances': [weather.length, 36], 'air-quality issuances': [air.length, 18], observations: [data.observations.length, 12], 'alert threads': [data.alerts.length, 6],
    'saved places': [data.saved_places.length, 3], watches: [data.watches.length, 3], notices: [data.notices.length, 8],
  };
  for (const [name, [actual, wanted]] of Object.entries(scale)) expect(actual === wanted, name + ': ' + actual + ', expected ' + wanted);
  for (const p of data.places) for (const s of data.sources) {
    expect(data.issuances.filter(i => i.place_id === p.id && i.source_id === s.id).length === 3, 'three issuances per source and place: ' + s.id + ' / ' + p.id);
  }
  expect(data.zones.every(z => data.places.some(p => p.zone_ids.includes(z.id)) || data.alerts.some(a => a.zone_ids.includes(z.id))), 'every zone is used');

  for (const i of weather) {
    const tz = places.get(i.place_id).timezone, t0 = ms(i.issued_at);
    expect(i.hourly.length === 48 && i.daily.length === 7, i.id + ': 48 hourly and 7 daily rows');
    expect(writtenOffset(i.issued_at) === offsetMinutes(t0, tz), i.id + ': issued_at is written in the place offset');
    expect(ms(i.hourly[0].start) === t0, i.id + ': the first hour is the issue hour');
    i.hourly.forEach((r, n) => {
      expect(ms(r.start) === t0 + n * HOUR && r.start === isoAt(t0 + n * HOUR, tz), i.id + ': contiguous local hours at row ' + n);
      expect(r.gust_kph >= r.wind_kph && r.apparent_temp_c <= r.temp_c && r.thunder_prob <= r.pop && r.pop % 5 === 0 && (r.pop >= 30) === (r.precip_mm > 0), i.id + ': value relations at ' + r.start);
    });
    i.daily.forEach((d, n) => {
      expect(d.date === addDays(localDate(t0, tz), n), i.id + ': contiguous local dates at row ' + n);
      const rows = i.hourly.filter(r => localDate(ms(r.start), tz) === d.date), temps = rows.map(r => r.temp_c);
      expect(temps.every(v => v >= d.low_c && v <= d.high_c), i.id + ' ' + d.date + ': hourly temperatures lie within the daily low and high');
      if (rows.length === 24) expect(Math.max(...temps) === d.high_c && Math.min(...temps) === d.low_c, i.id + ' ' + d.date + ': daily high and low match the hourly rows');
      const local = r => new Date(ms(r.start) + offsetMinutes(ms(r.start), tz) * 60000).getUTCHours(), daytime = rows.filter(r => local(r) >= 6 && local(r) < 18);
      expect(daytime.every(r => r.pop <= d.pop_day), i.id + ' ' + d.date + ': daytime hours do not exceed pop_day');
      if (daytime.length === 12) expect(Math.max(...daytime.map(r => r.pop)) === d.pop_day, i.id + ' ' + d.date + ': pop_day matches the daytime hours');
      const number = /(\d+)%/.exec(d.headline);
      if (number) expect([d.pop_day, d.pop_night].includes(+number[1]), i.id + ' ' + d.date + ': the headline percentage is one of the daily probabilities');
    });
  }
  for (const i of air) {
    const tz = places.get(i.place_id).timezone;
    expect(!i.hourly && i.daily.length === 3 && i.daily.every((d, n) => d.date === addDays(localDate(ms(i.issued_at), tz), n)), i.id + ': three contiguous daily air-quality rows');
  }
  for (const o of data.observations) expect(writtenOffset(o.observed_at) === offsetMinutes(ms(o.observed_at), places.get(o.place_id).timezone) && ms(o.observed_at) <= ms(clock), o.id + ': observed before the clock, in the place offset');
  expect(data.issuances.every(i => ms(i.issued_at) <= ms(clock)), 'every issuance is issued at or before the clock');

  const statuses = new Set(data.alerts.map(a => alertStatus(a, ms(clock)))), types = new Set(data.alerts.flatMap(a => a.messages.map(m => m.type)));
  expect(['upcoming', 'active', 'expired', 'cancelled'].every(s => statuses.has(s)), 'alert threads cover every status at the clock');
  expect(['alert', 'update', 'cancel'].every(t => types.has(t)), 'alert threads cover every message type');

  expect(data.activity.every((a, n) => a.seq === n + 1), 'activity sequence is 1..n');
  expect(data.activity.every((a, n) => n === 0 || ms(a.at) >= ms(data.activity[n - 1].at)), 'activity time does not go back');
  expect(data.activity.every(a => ['agent', 'event'].includes(a.actor)), 'activity rows come from Agent writes and events only');
  for (const n of data.notices) {
    expect(ms(n.release_at) >= ms(n.created_at) && ms(n.release_at) <= ms(clock), n.id + ': released by the fixture clock');
    expect(n.wire !== undefined && n.wire.id === n.id && n.wire.time === n.release_at && n.wire.data.content.title === n.title && n.wire.data.content.body.text === n.body, n.id + ': a wire message that matches the notice and is dated at its release time');
    expect(data.activity.some(a => a.action === 'notice.created' && a.object_id === n.id && a.seq === n.seq), n.id + ': has its activity row');
  }
  expect(data.notices.some(n => ms(n.release_at) > ms(n.created_at)), 'one notice was written in quiet hours and released later');
  for (const w of data.watches) expect((w.aq_source_id !== undefined) === w.conditions.some(c => c.variable === 'aqi'), w.id + ': an air-quality source exactly when it has an aqi condition');
  return problems;
}

module.exports = { check };
if (require.main === module) {
  const problems = check();
  for (const p of problems) console.error('PROBLEM: ' + p);
  if (problems.length) process.exit(1);
  console.log('fixtures/minimal.json is consistent (' + path.basename(__filename) + ').');
}
