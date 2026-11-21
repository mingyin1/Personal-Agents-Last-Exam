'use strict';
// W4: weather watches. A watch is a saved place, a time window, a weather source, an
// air-quality source when it has an aqi condition, and one to six alternative conditions.
// It is evaluated when it is created or edited and whenever new information arrives (an
// issuance from one of its two sources for its place, or an alert message for its zones).
// Time alone only ends it, and that is never stored: a watch is open while the supplied
// time is before its window end (model.watchOpen).
const { DAY, fail, ms, isoAt, hoursBetween, datesBetween, nextId } = require('./util.cjs');
const { index, issuancesOf, latestMessage, effectiveMessage, alertOpen, sharesZone, watchOpen, watchStatus } = require('./model.cjs');
const { VARIABLES, defaultUnit, inUnit, meets, round, severityRank } = require('./units.cjs');
const { record, createNotice } = require('./notices.cjs');
const { placeRef, needSaved, needSource, cleanLabel } = require('./places.cjs');

const MAX_OPEN = 20;
const MAX_WINDOW = 10 * DAY;

function normalizeConditions(list, units) {
  return list.map(c => {
    if (c.variable === 'alert') return { variable: 'alert', category: c.category ?? 'any', min_severity: c.min_severity ?? 'minor' };
    const unit = c.unit ?? defaultUnit(c.variable, units);
    if (!VARIABLES[c.variable].units.includes(unit)) fail('invalid_arguments', 'Unit ' + unit + ' does not fit ' + c.variable + '; use ' + VARIABLES[c.variable].units.join(' or ') + '.');
    return { variable: c.variable, op: c.op ?? 'gte', value: c.value, unit };
  });
}

// Evaluate a watch at time `at`. `previous` is passed only when new information arrives:
// if no window hour is left that has not started, the earlier hourly results stand.
// Returns null when there is nothing to re-evaluate.
function evaluate(data, watch, at, cause, previous) {
  const now = ms(at), ix = index(data), place = ix.places.get(watch.place_id), tz = place.timezone;
  const start = ms(watch.start), end = ms(watch.end);
  const hourlyIdx = [], aqiIdx = [], alertIdx = [];
  watch.conditions.forEach((c, i) => (c.variable === 'alert' ? alertIdx : c.variable === 'aqi' ? aqiIdx : hourlyIdx).push(i));
  const results = watch.conditions.map((c, i) => ({ index: i, evaluable: false, met: false, matches: [] }));
  let issuanceRef = null, aqRef = null, hours = { considered: 0, missing: [] }, days = { considered: 0, missing: [] };

  if (hourlyIdx.length) {
    const remaining = hoursBetween(start, end, tz).filter(h => h >= now);
    if (!remaining.length && previous) {
      if (!previous.conditions || previous.conditions.length !== results.length) return null;
      for (const i of hourlyIdx) results[i] = { ...previous.conditions[i], index: i };
      issuanceRef = previous.issuance ?? null;
      hours = { considered: previous.hours?.considered ?? 0, missing: previous.hours?.missing ?? [], frozen: true };
    } else {
      const issuance = issuancesOf(data, place.id, watch.source_id)[0];
      const rows = new Map(((issuance && issuance.hourly) ?? []).map(r => [ms(r.start), r]));
      const covered = remaining.filter(h => rows.has(h));
      if (issuance) issuanceRef = { id: issuance.id, issued_at: issuance.issued_at };
      hours = { considered: covered.length, missing: remaining.filter(h => !rows.has(h)).map(h => isoAt(h, tz)) };
      for (const i of hourlyIdx) {
        const c = watch.conditions[i], r = results[i];
        r.evaluable = covered.length > 0;
        for (const h of covered) {
          const row = rows.get(h), value = inUnit(c.variable, row[VARIABLES[c.variable].field], c.unit);
          if (meets(c.op, value, c.value)) r.matches.push({ start: row.start, value: round(value, 2), unit: c.unit });
        }
        r.met = r.matches.length > 0;
      }
    }
  }

  if (aqiIdx.length) {
    const issuance = watch.aq_source_id === undefined ? undefined : issuancesOf(data, place.id, watch.aq_source_id)[0];
    const from = Math.max(start, now), dates = from < end ? datesBetween(from, end, tz) : [];
    const rows = new Map(((issuance && issuance.daily) ?? []).map(r => [r.date, r]));
    const covered = dates.filter(d => rows.has(d));
    if (issuance) aqRef = { id: issuance.id, issued_at: issuance.issued_at };
    days = { considered: covered.length, missing: dates.filter(d => !rows.has(d)) };
    for (const i of aqiIdx) {
      const c = watch.conditions[i], r = results[i];
      r.evaluable = covered.length > 0;
      for (const d of covered) if (meets(c.op, rows.get(d).aqi, c.value)) r.matches.push({ date: d, value: rows.get(d).aqi, unit: 'index' });
      r.met = r.matches.length > 0;
    }
  }

  if (alertIdx.length) {
    const threads = data.alerts.filter(a => {
      const eff = effectiveMessage(a);
      return alertOpen(a, now) && sharesZone(place, a) && ms(eff.onset) < end && ms(eff.ends) > start;
    });
    for (const i of alertIdx) {
      const c = watch.conditions[i], r = results[i];
      r.evaluable = true;
      for (const a of threads) {
        const eff = effectiveMessage(a);
        if ((c.category === 'any' || c.category === a.category) && severityRank(eff.severity) >= severityRank(c.min_severity)) {
          r.matches.push({ alert_id: a.id, message_id: latestMessage(a).message_id, severity: eff.severity, category: a.category });
        }
      }
      r.met = r.matches.length > 0;
    }
  }

  const forecast = [...hourlyIdx, ...aqiIdx];
  const status = results.some(r => r.met) ? 'triggered' : forecast.length && forecast.every(i => !results[i].evaluable) ? 'no_data' : 'clear';
  return { status, evaluated_at: at, cause, issuance: issuanceRef, aq_issuance: aqRef, hours, dates: days, conditions: results };
}

function present(data, ix, watch, now) {
  return {
    id: watch.id, label: watch.label, status: watchStatus(watch, now), place: placeRef(ix.places.get(watch.place_id)), source_id: watch.source_id,
    aq_source_id: watch.aq_source_id ?? null, start: watch.start, end: watch.end, conditions: watch.conditions, linked_object: watch.linked_object ?? null,
    created_at: watch.created_at, updated_at: watch.updated_at ?? null, cancelled_at: watch.cancelled_at ?? null, evaluation: watch.evaluation,
  };
}
function needWatch(ix, id) {
  const watch = ix.watches.get(id);
  if (!watch) fail('not_found', 'No watch ' + id + '. Use watches.list.');
  return watch;
}
function checkWindow(start, end, now) {
  if (ms(start) >= ms(end)) fail('invalid_window', 'start must be before end.');
  if (ms(end) <= now) fail('invalid_window', 'The window is already over.');
  if (ms(end) - ms(start) > MAX_WINDOW) fail('invalid_window', 'A watch window can cover at most 10 days.');
}
// A watch names an air-quality source exactly when it has an aqi condition: the one named
// in this call, else the one it already has (`kept`), else the account's default.
function airSource(ix, data, conditions, named, kept) {
  if (!conditions.some(c => c.variable === 'aqi')) {
    if (named !== undefined) fail('invalid_arguments', 'aq_source_id applies only to a watch with an aqi condition.');
    return undefined;
  }
  if (named !== undefined) return needSource(ix, data, named, 'air_quality').id;
  if (kept !== undefined) return kept;
  const fallback = data.preferences.default_air_source_id;
  if (fallback === null) fail('not_found', 'This account has no default air-quality source. Pass aq_source_id (see sources.list) or set default_air_source_id with preferences.update.');
  return fallback;
}
const cause = (kind, args) => ({ kind, ...(args.request_id === undefined ? {} : { request_id: args.request_id }) });

function list(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now);
  if (args.place_id !== undefined && !ix.places.has(args.place_id)) fail('not_found', 'No place ' + args.place_id + '.');
  const watches = data.watches.filter(w => (args.place_id === undefined || w.place_id === args.place_id) && (args.include_closed === true || watchOpen(w, now)))
    .sort((a, b) => ms(a.start) - ms(b.start) || (a.id < b.id ? -1 : 1));
  return { watches: watches.map(w => present(data, ix, w, now)) };
}

function get(ctx, data, args) {
  const ix = index(data);
  return { watch: present(data, ix, needWatch(ix, args.id), ms(ctx.virtual_now)) };
}

function create(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), { place, saved } = needSaved(ix, args.id);
  const source = needSource(ix, data, args.source_id, 'weather');
  const conditions = normalizeConditions(args.conditions, data.preferences.units);
  const aq = airSource(ix, data, conditions, args.aq_source_id);
  checkWindow(args.start, args.end, now);
  if (data.watches.filter(w => watchOpen(w, now)).length >= MAX_OPEN) fail('limit_exceeded', 'An account can have at most ' + MAX_OPEN + ' open watches. Cancel one first.');
  const watch = {
    id: nextId(data.watches.map(w => w.id), 'w-'), seq: 0, label: args.label === undefined ? saved.label : cleanLabel(args.label),
    place_id: place.id, source_id: source.id, ...(aq === undefined ? {} : { aq_source_id: aq }), start: args.start, end: args.end, conditions,
    ...(args.linked_object === undefined ? {} : { linked_object: args.linked_object }), created_at: ctx.virtual_now,
  };
  watch.evaluation = evaluate(data, watch, ctx.virtual_now, cause('create', args));
  data.watches.push(watch);
  watch.seq = record(data, { at: ctx.virtual_now, actor: 'agent', action: 'watches.create', object_id: watch.id, request_id: args.request_id, details: { status: watch.evaluation.status } });
  return { id: watch.id, watch: present(data, ix, watch, now) };
}

function update(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), watch = needWatch(ix, args.id), patch = args.patch, changed = Object.keys(patch);
  if (!watchOpen(watch, now)) fail('invalid_state', 'Watch ' + watch.id + ' is ' + watchStatus(watch, now) + ' and can no longer be changed.');
  if (!changed.length) fail('invalid_arguments', 'patch names no field to change.');
  if (patch.label !== undefined) watch.label = cleanLabel(patch.label);
  if (patch.source_id !== undefined) watch.source_id = needSource(ix, data, patch.source_id, 'weather').id;
  if (patch.conditions !== undefined) watch.conditions = normalizeConditions(patch.conditions, data.preferences.units);
  const aq = airSource(ix, data, watch.conditions, patch.aq_source_id, watch.aq_source_id);
  if (aq === undefined) delete watch.aq_source_id; else watch.aq_source_id = aq;
  if (patch.start !== undefined) watch.start = patch.start;
  if (patch.end !== undefined) watch.end = patch.end;
  checkWindow(watch.start, watch.end, now);
  if (patch.linked_object === null) delete watch.linked_object; else if (patch.linked_object !== undefined) watch.linked_object = patch.linked_object;
  watch.updated_at = ctx.virtual_now;
  const before = watch.evaluation.status;
  watch.evaluation = evaluate(data, watch, ctx.virtual_now, cause('update', args));
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'watches.update', object_id: watch.id, request_id: args.request_id, details: { changed_fields: changed, from: before, to: watch.evaluation.status } });
  return { id: watch.id, watch: present(data, ix, watch, now) };
}

function cancel(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), watch = needWatch(ix, args.id);
  if (!watchOpen(watch, now)) fail('invalid_state', 'Watch ' + watch.id + ' is already ' + watchStatus(watch, now) + '.');
  watch.cancelled_at = ctx.virtual_now;
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'watches.cancel', object_id: watch.id, request_id: args.request_id });
  return { id: watch.id, watch: present(data, ix, watch, now) };
}

function describe(watch, result) {
  const c = watch.conditions[result.index], m = result.matches[0];
  if (c.variable === 'alert') return 'alert ' + m.alert_id + ' (' + m.severity + ' ' + m.category + ') overlaps the watch window';
  const unit = c.unit === 'index' ? '' : c.unit === '%' ? '%' : ' ' + c.unit;
  return c.variable + ' ' + m.value + unit + ' ' + (m.start ? 'at ' + m.start : 'on ' + m.date) + ' meets ' + c.variable + (c.op === 'lte' ? ' <= ' : ' >= ') + c.value + unit;
}

// New information arrived for this watch at event time `at`. A change into `triggered`, or
// from `triggered` to `clear`, writes one notice; any other status change (between `clear`
// and `no_data`, or from `triggered` to `no_data`) is recorded in the activity log only.
// `news` says what arrived: { source_id } for an issuance, { alert } for an alert message.
function reevaluate(data, watch, at, kind, eventId, news) {
  const previous = watch.evaluation, next = evaluate(data, watch, at, { kind, event_id: eventId }, previous);
  if (!next) return;
  watch.evaluation = next;
  if (next.status === previous.status) return;
  record(data, { at, actor: 'event', action: 'watch.status_changed', object_id: watch.id, event_id: eventId, details: { from: previous.status, to: next.status } });
  const ix = index(data), place = ix.places.get(watch.place_id);
  // The notice names the information the evaluation used from the source that just spoke.
  let basis = 'Latest information';
  if (news.alert) basis = ix.sources.get(news.alert.source_id).name + ' alert message ' + latestMessage(news.alert).message_id;
  else {
    const used = news.source_id === watch.aq_source_id ? next.aq_issuance : next.issuance;
    if (used) basis = ix.sources.get(news.source_id).name + ' forecast issued ' + used.issued_at;
  }
  if (next.status === 'triggered') {
    const met = next.conditions.filter(r => r.met), all = met.flatMap(r => r.matches);
    const tally = [['hour', 'start'], ['day', 'date'], ['alert', 'alert_id']].map(([word, key]) => [word, new Set(all.filter(m => m[key] !== undefined).map(m => m[key])).size])
      .filter(([, n]) => n > 0).map(([word, n]) => n + ' ' + word + (n === 1 ? '' : 's')).join(' and ');
    const verb = all.length === 1 ? ' meets' : ' meet';
    createNotice(data, at, {
      kind: 'watch.triggered', object: { type: 'watch', id: watch.id }, place_ids: [place.id],
      title: 'Watch triggered: ' + watch.label + ' (' + place.name + ')',
      body: basis + ': ' + describe(watch, met[0]) + '. In all, ' + tally + ' in the watch window (' + watch.start + ' to ' + watch.end + ')' + verb + ' a condition. Open Rainshadow for details.',
    }, eventId);
  } else if (previous.status === 'triggered' && next.status === 'clear') {
    createNotice(data, at, {
      kind: 'watch.cleared', object: { type: 'watch', id: watch.id }, place_ids: [place.id],
      title: 'Watch cleared: ' + watch.label + ' (' + place.name + ')',
      body: basis + ': no condition of this watch is met any more in the window ' + watch.start + ' to ' + watch.end + '.',
    }, eventId);
  }
}

module.exports = { MAX_OPEN, normalizeConditions, evaluate, reevaluate, list, get, create, update, cancel };
