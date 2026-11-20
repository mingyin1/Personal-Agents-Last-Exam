'use strict';
// W2: forecast evidence. Every read names the issuance it used; rows are returned as
// issued, coverage lists what the issuance does not contain, and nothing is interpolated
// or taken from another source.
const { HOUR, DAY, fail, ms, isoAt, floorHour, hoursBetween, datesBetween } = require('./util.cjs');
const { index, issuancesOf } = require('./model.cjs');
const { UNIT_NAMES, shown, aqiCategory } = require('./units.cjs');
const { placeRef, sourceRef, needPlace, needSource } = require('./places.cjs');

const MAX_WINDOW = 10 * DAY;

function page(args, fallback) {
  if (args.cursor !== undefined && !/^\d{1,6}$/.test(args.cursor)) fail('invalid_arguments', 'cursor must be a next_cursor value from an earlier page.');
  return { offset: args.cursor === undefined ? 0 : Number(args.cursor), limit: args.limit ?? fallback };
}
const nextCursor = (offset, limit, total) => (offset + limit < total ? String(offset + limit) : null);

function window(args, tz, now, defaultLength) {
  const start = args.start === undefined ? floorHour(now, tz) : ms(args.start);
  const end = args.end === undefined ? start + defaultLength : ms(args.end);
  if (start >= end) fail('invalid_window', 'start must be before end.');
  if (end - start > MAX_WINDOW) fail('invalid_window', 'A window can cover at most 10 days.');
  return { start, end };
}

// The issuance a read uses: an explicit one for this place, or the latest of the source.
function pick(data, ix, place, args) {
  let source = needSource(ix, data, args.source_id), issuance = null;
  if (args.issuance_id !== undefined) {
    issuance = data.issuances.find(i => i.id === args.issuance_id && i.place_id === place.id);
    if (!issuance) fail('not_found', 'No issuance ' + args.issuance_id + ' for place ' + place.id + '. Use forecast.issuances.');
    if (args.source_id !== undefined && issuance.source_id !== source.id) fail('not_found', 'Issuance ' + issuance.id + ' is not from source ' + source.id + '.');
    source = ix.sources.get(issuance.source_id);
  }
  const latest = issuancesOf(data, place.id, source.id)[0] ?? null;
  issuance = issuance ?? latest;
  return { source, issuance, ref: issuance ? { id: issuance.id, issued_at: issuance.issued_at, is_latest: issuance.id === latest.id } : null };
}

function issuances(ctx, data, args) {
  const ix = index(data), place = needPlace(ix, args.id), tz = place.timezone;
  if (args.source_id !== undefined) needSource(ix, data, args.source_id);
  const { offset, limit } = page(args, 20);
  const all = data.issuances.filter(i => i.place_id === place.id && (args.source_id === undefined || i.source_id === args.source_id))
    .sort((a, b) => ms(b.issued_at) - ms(a.issued_at) || (a.id < b.id ? -1 : 1));
  const latest = new Map();
  for (const source of data.sources) { const first = issuancesOf(data, place.id, source.id)[0]; if (first) latest.set(source.id, first.id); }
  return {
    place: placeRef(place),
    issuances: all.slice(offset, offset + limit).map(i => {
      const hourly = i.hourly ?? [], daily = i.daily ?? [];
      return {
        id: i.id, source_id: i.source_id, kind: ix.sources.get(i.source_id).kind, issued_at: i.issued_at, is_latest: latest.get(i.source_id) === i.id,
        hourly: hourly.length ? { count: hourly.length, start: hourly[0].start, end: isoAt(ms(hourly[hourly.length - 1].start) + HOUR, tz) } : null,
        daily: daily.length ? { count: daily.length, start_date: daily[0].date, end_date: daily[daily.length - 1].date } : null,
      };
    }),
    next_cursor: nextCursor(offset, limit, all.length),
  };
}

function hourly(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), place = needPlace(ix, args.id), tz = place.timezone;
  const { start, end } = window(args, tz, now, 24 * HOUR), { offset, limit } = page(args, 48);
  const { source, issuance, ref } = pick(data, ix, place, args), units = data.preferences.units;
  const hours = hoursBetween(start, end, tz);
  const rows = new Map(((issuance && issuance.hourly) ?? []).map(r => [ms(r.start), r]));
  const covered = hours.filter(h => rows.has(h)), missing = hours.filter(h => !rows.has(h));
  const reason = !issuance ? 'no_issuance' : source.kind === 'air_quality' ? 'no_hourly_product' : !covered.length ? 'outside_issuance' : missing.length ? 'partial' : null;
  return {
    place: placeRef(place), source: sourceRef(source), issuance: ref, units: UNIT_NAMES[units], start: isoAt(start, tz), end: isoAt(end, tz),
    rows: covered.slice(offset, offset + limit).map(h => {
      const r = rows.get(h);
      return {
        start: r.start, temp: shown('temperature', r.temp_c, units), apparent_temp: shown('temperature', r.apparent_temp_c, units), pop: r.pop,
        precip: shown('precipitation', r.precip_mm, units), wind: shown('wind', r.wind_kph, units), gust: shown('wind', r.gust_kph, units),
        thunder_prob: r.thunder_prob, sky: r.sky,
      };
    }),
    coverage: { requested_hours: hours.length, covered_hours: covered.length, missing: missing.map(h => isoAt(h, tz)), reason },
    next_cursor: nextCursor(offset, limit, covered.length),
  };
}

function daily(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), place = needPlace(ix, args.id), tz = place.timezone;
  const { start, end } = window(args, tz, now, 7 * DAY);
  const { source, issuance, ref } = pick(data, ix, place, args), units = data.preferences.units;
  const dates = datesBetween(start, end, tz);
  const rows = new Map(((issuance && issuance.daily) ?? []).map(r => [r.date, r]));
  const covered = dates.filter(d => rows.has(d)), missing = dates.filter(d => !rows.has(d));
  const reason = !issuance ? 'no_issuance' : !covered.length ? 'outside_issuance' : missing.length ? 'partial' : null;
  return {
    place: placeRef(place), source: sourceRef(source), issuance: ref, units: UNIT_NAMES[units], start: isoAt(start, tz), end: isoAt(end, tz),
    rows: covered.map(d => {
      const r = rows.get(d);
      if (source.kind === 'air_quality') return { date: r.date, aqi: r.aqi, category: aqiCategory(r.aqi), pollutant: r.pollutant ?? null };
      return {
        date: r.date, headline: r.headline, summary: r.summary, high: shown('temperature', r.high_c, units), low: shown('temperature', r.low_c, units),
        pop_day: r.pop_day, pop_night: r.pop_night,
      };
    }),
    coverage: { requested_days: dates.length, covered_days: covered.length, missing, reason },
  };
}

function conditions(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), place = needPlace(ix, args.id), units = data.preferences.units;
  if (args.source_id !== undefined) needSource(ix, data, args.source_id);
  const newest = data.observations.filter(o => o.place_id === place.id && (args.source_id === undefined || o.source_id === args.source_id))
    .reduce((best, o) => (!best || ms(o.observed_at) > ms(best.observed_at) || (ms(o.observed_at) === ms(best.observed_at) && o.id > best.id) ? o : best), null);
  return {
    place: placeRef(place), units: UNIT_NAMES[units],
    observation: newest && {
      id: newest.id, source_id: newest.source_id, observed_at: newest.observed_at, age_minutes: Math.max(0, Math.floor((now - ms(newest.observed_at)) / 60000)),
      temp: shown('temperature', newest.temp_c, units), wind: shown('wind', newest.wind_kph, units), gust: shown('wind', newest.gust_kph, units),
      conditions: newest.conditions, humidity: newest.humidity ?? null,
    },
  };
}

module.exports = { issuances, hourly, daily, conditions };
