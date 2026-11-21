'use strict';
// Record consistency, object IDs and the statuses that are derived from stored records
// and the supplied time. Core owns persistence, versions and policy.
const { fail, ms, unique, byId, validTimeZone, validDate, isLocalHour } = require('./util.cjs');
const { VARIABLES } = require('./units.cjs');

// ---- lookups --------------------------------------------------------------
function index(data) {
  return {
    zones: new Set(data.zones.map(z => z.id)),
    places: byId(data.places),
    sources: byId(data.sources),
    alerts: byId(data.alerts),
    watches: byId(data.watches),
    saved: new Map(data.saved_places.map(s => [s.place_id, s])),
  };
}
const newestFirst = (a, b) => ms(b.issued_at) - ms(a.issued_at) || (a.id < b.id ? 1 : -1);
// Issuances of one source for one place, newest first. Everything stored counts as issued.
const issuancesOf = (data, placeId, sourceId) => data.issuances.filter(i => i.place_id === placeId && i.source_id === sourceId).sort(newestFirst);

// ---- derived statuses -------------------------------------------------------------
const latestMessage = thread => thread.messages[thread.messages.length - 1];
// The latest message that carries timing and severity (a cancel message carries neither).
function effectiveMessage(thread) {
  for (let i = thread.messages.length - 1; i >= 0; i--) if (thread.messages[i].type !== 'cancel') return thread.messages[i];
  return thread.messages[0];
}
function alertStatus(thread, now) {
  const last = latestMessage(thread);
  if (last.type === 'cancel') return 'cancelled';
  if (now < ms(last.onset)) return 'upcoming';
  return now < ms(last.ends) ? 'active' : 'expired';
}
const alertOpen = (thread, now) => ['upcoming', 'active'].includes(alertStatus(thread, now));
const sharesZone = (place, thread) => place.zone_ids.some(z => thread.zone_ids.includes(z));
const isAcknowledged = (data, thread) => data.acknowledgements.some(a => a.alert_id === thread.id && a.message_id === latestMessage(thread).message_id);

// Time-based states are never stored. A watch is open until it is cancelled or its window
// end passes; a notice is held until its release time passes. Every read, every write check
// and the Infra-run sender derive them from the supplied time in this one place.
const watchOpen = (watch, now) => !watch.cancelled_at && ms(watch.end) > now;
function watchStatus(watch, now) {
  if (watch.cancelled_at) return 'cancelled';
  if (ms(watch.end) <= now) return 'ended';
  return watch.evaluation.status;
}
const noticeState = (notice, now) => (ms(notice.release_at) > now ? 'held' : 'released');

// ---- seed / state validation ------------------------------------------------------------------
function validateSeed(ctx, data) {
  const bad = message => fail('invalid_seed', message);
  const person = ctx.binding.people.some(p => p.person_id === data.owner_person_id);
  const account = ctx.binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!person || !account) bad('Account and owner must be declared in the supplied binding.');

  if (!unique(objects(data))) bad('Record IDs must be unique across zones, places, sources, issuances, observations, alerts, watches and notices.');
  const ix = index(data);

  for (const p of data.places) {
    if (!validTimeZone(p.timezone)) bad('Place ' + p.id + ' has an unknown time zone.');
    if (p.zone_ids.some(z => !ix.zones.has(z))) bad('Place ' + p.id + ' names an unknown zone.');
  }

  const issued = new Set();
  for (const i of data.issuances) {
    const source = ix.sources.get(i.source_id), place = ix.places.get(i.place_id);
    if (!source || !place) bad('Issuance ' + i.id + ' names an unknown source or place.');
    const key = i.source_id + '|' + i.place_id + '|' + ms(i.issued_at);
    if (issued.has(key)) bad('Issuance ' + i.id + ' repeats a source, place and issue time.');
    issued.add(key);
    const hourly = i.hourly || [], daily = i.daily || [];
    if (!hourly.length && !daily.length) bad('Issuance ' + i.id + ' has no rows.');
    if (source.kind === 'air_quality' && hourly.length) bad('Air-quality issuance ' + i.id + ' cannot carry hourly rows.');
    if (daily.some(r => ('aqi' in r) !== (source.kind === 'air_quality'))) bad('Issuance ' + i.id + ' has daily rows of the wrong kind for its source.');
    let previous = -Infinity;
    for (const row of hourly) {
      const t = ms(row.start);
      if (!isLocalHour(row.start, place.timezone)) bad('Issuance ' + i.id + ': hourly rows must be whole hours written with the place\'s own UTC offset.');
      if (t <= previous) bad('Issuance ' + i.id + ': hourly rows must be in ascending order without repeats.');
      previous = t;
    }
    let day = '';
    for (const row of daily) {
      if (!validDate(row.date) || row.date <= day) bad('Issuance ' + i.id + ': daily rows need valid dates in ascending order without repeats.');
      if ('high_c' in row && row.high_c < row.low_c) bad('Issuance ' + i.id + ': daily high is below the low.');
      day = row.date;
    }
  }

  const observed = new Set();
  for (const o of data.observations) {
    if (!ix.sources.has(o.source_id) || !ix.places.has(o.place_id)) bad('Observation ' + o.id + ' names an unknown source or place.');
    const key = o.source_id + '|' + o.place_id + '|' + ms(o.observed_at);
    if (observed.has(key)) bad('Observation ' + o.id + ' repeats a source, place and observation time.');
    observed.add(key);
  }

  const messageIds = [];
  for (const a of data.alerts) {
    if (!ix.sources.has(a.source_id)) bad('Alert ' + a.id + ' names an unknown source.');
    if (a.zone_ids.some(z => !ix.zones.has(z))) bad('Alert ' + a.id + ' names an unknown zone.');
    let sent = -Infinity;
    a.messages.forEach((m, n) => {
      messageIds.push(m.message_id);
      const expected = n === 0 ? ['alert'] : ['update', 'cancel'];
      if (!expected.includes(m.type)) bad('Alert ' + a.id + ': a thread starts with an alert message and continues with updates or one cancel.');
      if (m.type === 'cancel' && n !== a.messages.length - 1) bad('Alert ' + a.id + ': a cancel message closes the thread.');
      if (m.type !== 'cancel') {
        if (['event', 'severity', 'urgency', 'certainty', 'onset', 'ends'].some(k => m[k] === undefined)) bad('Alert message ' + m.message_id + ' lacks timing, severity or event.');
        if (ms(m.onset) >= ms(m.ends)) bad('Alert message ' + m.message_id + ': onset must be before ends.');
      }
      if (ms(m.sent_at) <= sent) bad('Alert ' + a.id + ': messages must be in sending order.');
      sent = ms(m.sent_at);
    });
  }
  if (!unique(messageIds)) bad('Alert message IDs must be unique.');

  const prefs = data.preferences, defaultSource = ix.sources.get(prefs.default_source_id);
  if (!defaultSource || defaultSource.kind !== 'weather') bad('The default source must be a weather source.');
  if (prefs.default_air_source_id !== null && ix.sources.get(prefs.default_air_source_id)?.kind !== 'air_quality') bad('The default air-quality source must be an air-quality source, or null.');
  if (!validTimeZone(prefs.timezone)) bad('The account time zone is unknown.');
  if (prefs.quiet_hours.start === prefs.quiet_hours.end) bad('Quiet hours cannot start and end at the same time.');

  if (!unique(data.saved_places.map(s => s.place_id))) bad('A place can be saved once.');
  if (data.saved_places.some(s => !ix.places.has(s.place_id))) bad('A saved place names an unknown place.');

  const acks = new Set();
  for (const a of data.acknowledgements) {
    const thread = ix.alerts.get(a.alert_id), key = a.alert_id + '|' + a.message_id;
    if (!thread || !thread.messages.some(m => m.message_id === a.message_id)) bad('An acknowledgement names an unknown alert message.');
    if (acks.has(key)) bad('An alert message can be acknowledged once.');
    acks.add(key);
  }

  const issuanceIds = new Set(data.issuances.map(i => i.id));
  for (const w of data.watches) {
    const source = ix.sources.get(w.source_id);
    if (!ix.places.has(w.place_id)) bad('Watch ' + w.id + ' names an unknown place.');
    if (!source || source.kind !== 'weather') bad('Watch ' + w.id + ' needs a weather source.');
    if (w.aq_source_id !== undefined && ix.sources.get(w.aq_source_id)?.kind !== 'air_quality') bad('Watch ' + w.id + ' names an unknown air-quality source.');
    if (w.conditions.some(c => c.variable === 'aqi') !== (w.aq_source_id !== undefined)) bad('Watch ' + w.id + ': a watch names an air-quality source exactly when it has an aqi condition.');
    if (ms(w.start) >= ms(w.end)) bad('Watch ' + w.id + ': start must be before end.');
    for (const c of w.conditions) {
      if (c.variable !== 'alert' && !VARIABLES[c.variable].units.includes(c.unit)) bad('Watch ' + w.id + ': unit ' + c.unit + ' does not fit ' + c.variable + '.');
    }
    for (const ref of [w.evaluation.issuance, w.evaluation.aq_issuance]) if (ref && !issuanceIds.has(ref.id)) bad('Watch ' + w.id + ': the evaluation names an unknown issuance.');
  }

  for (const n of data.notices) {
    if (n.object.type === 'alert') {
      const thread = ix.alerts.get(n.object.id);
      if (!thread || (n.message_id !== undefined && !thread.messages.some(m => m.message_id === n.message_id))) bad('Notice ' + n.id + ' names an unknown alert message.');
    } else if (!ix.watches.has(n.object.id)) bad('Notice ' + n.id + ' names an unknown watch.');
    if (n.place_ids.some(p => !ix.places.has(p))) bad('Notice ' + n.id + ' names an unknown place.');
    if (ms(n.release_at) < ms(n.created_at)) bad('Notice ' + n.id + ': the release time cannot be before the creation time.');
  }

  let seq = 0;
  for (const row of data.activity) {
    if (row.seq <= seq) bad('Activity rows must have increasing sequence numbers.');
    seq = row.seq;
  }
}

// One object ID per record, so record-only imports count the same things.
const records = data => [...data.zones, ...data.places, ...data.sources, ...data.issuances, ...data.observations, ...data.alerts, ...data.watches, ...data.notices];
function objects(data) { return records(data).map(x => x.id); }
// Rainshadow keeps no reference into another App: linked_object is opaque and never dereferenced.
const references = () => [];

module.exports = {
  validateSeed, records, objects, references,
  index, issuancesOf, latestMessage, effectiveMessage, alertStatus, alertOpen, sharesZone, isAcknowledged, watchOpen, watchStatus, noticeState,
};
