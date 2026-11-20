'use strict';
// W3: alert threads. Messages arrive as events; the Agent reads them and acknowledges
// the latest message. Status is derived from the latest message and the supplied time.
const { DAY, fail, ms, isoAt } = require('./util.cjs');
const { index, latestMessage, effectiveMessage, alertStatus, alertOpen, sharesZone, isAcknowledged } = require('./model.cjs');
const { severityRank } = require('./units.cjs');
const { record, createNotice } = require('./notices.cjs');
const { placeRef, sourceRef, needPlace } = require('./places.cjs');

function summary(data, thread, now) {
  const last = latestMessage(thread), eff = effectiveMessage(thread);
  return {
    id: thread.id, source_id: thread.source_id, category: thread.category, zone_ids: thread.zone_ids, status: alertStatus(thread, now),
    event: eff.event, severity: eff.severity, urgency: eff.urgency, certainty: eff.certainty, onset: eff.onset, ends: eff.ends, headline: last.headline,
    latest_message_id: last.message_id, latest_message_type: last.type, message_count: thread.messages.length, acknowledged: isAcknowledged(data, thread),
  };
}
function needAlert(ix, id) {
  const thread = ix.alerts.get(id);
  if (!thread) fail('not_found', 'No alert ' + id + '. Use alerts.list for a place.');
  return thread;
}

function list(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), place = needPlace(ix, args.id), tz = place.timezone;
  const start = args.start === undefined ? now : ms(args.start), end = args.end === undefined ? start + 7 * DAY : ms(args.end);
  if (start >= end) fail('invalid_window', 'start must be before end.');
  const alerts = data.alerts.filter(a => {
    const eff = effectiveMessage(a);
    return sharesZone(place, a) && ms(eff.onset) < end && ms(eff.ends) > start && (args.include_closed === true || alertOpen(a, now));
  }).sort((a, b) => ms(effectiveMessage(a).onset) - ms(effectiveMessage(b).onset) || (a.id < b.id ? -1 : 1));
  return { place: placeRef(place), start: isoAt(start, tz), end: isoAt(end, tz), alerts: alerts.map(a => summary(data, a, now)) };
}

function get(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), thread = needAlert(ix, args.id);
  return {
    alert: {
      ...summary(data, thread, now), source: sourceRef(ix.sources.get(thread.source_id)), messages: thread.messages,
      acknowledgements: data.acknowledgements.filter(a => a.alert_id === thread.id).map(a => ({ message_id: a.message_id, acknowledged_at: a.acknowledged_at })),
      affected_places: data.places.filter(p => sharesZone(p, thread)).map(p => ({ id: p.id, name: p.name, saved: ix.saved.has(p.id), label: ix.saved.get(p.id)?.label ?? null })),
    },
  };
}

function acknowledge(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), thread = needAlert(ix, args.id), last = latestMessage(thread);
  if (!thread.messages.some(m => m.message_id === args.message_id)) fail('not_found', 'Alert ' + thread.id + ' has no message ' + args.message_id + '.');
  if (!alertOpen(thread, now)) fail('invalid_state', 'Alert ' + thread.id + ' is ' + alertStatus(thread, now) + ' and can no longer be acknowledged.');
  if (args.message_id !== last.message_id) fail('stale_message', 'Message ' + args.message_id + ' was superseded by ' + last.message_id + '. Read the alert again.');
  if (isAcknowledged(data, thread)) fail('already_acknowledged', 'Message ' + last.message_id + ' is already acknowledged.');
  data.acknowledgements.push({ alert_id: thread.id, message_id: last.message_id, acknowledged_at: ctx.virtual_now });
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'alerts.acknowledge', object_id: thread.id, request_id: args.request_id, details: { message_id: last.message_id } });
  return { id: thread.id, message_id: last.message_id, acknowledged_at: ctx.virtual_now };
}

// One notice per alert message when a saved place shares a zone with the thread, its rule
// includes the category, the severity reaches the rule's minimum and the rule is not paused.
function alertNotice(data, thread, kind, at, eventId) {
  const ix = index(data), last = latestMessage(thread), eff = effectiveMessage(thread);
  const matches = data.saved_places.filter(s => !s.alert_rule.paused && s.alert_rule.categories.includes(thread.category)
    && severityRank(eff.severity) >= severityRank(s.alert_rule.min_severity) && sharesZone(ix.places.get(s.place_id), thread));
  if (!matches.length) return null;
  const place = ix.places.get(matches[0].place_id), source = ix.sources.get(thread.source_id);
  const where = (matches[0].label === place.name ? place.name : place.name + ' (saved as ' + matches[0].label + ')') + (matches.length > 1 ? ' and ' + (matches.length - 1) + ' more saved place' + (matches.length > 2 ? 's' : '') : '');
  const zones = 'zone' + (thread.zone_ids.length > 1 ? 's ' : ' ') + thread.zone_ids.join(', ');
  const effect = 'In effect ' + eff.onset + ' to ' + eff.ends + '.';
  const text = {
    'alert.issued': [eff.event + ' for ' + where, source.name + ' issued a ' + eff.event + ' (severity: ' + eff.severity + ') for ' + zones + '. ' + effect + ' Open Rainshadow for the full text.'],
    'alert.updated': ['Updated: ' + eff.event + ' for ' + where, source.name + ' updated the ' + eff.event + ' (severity: ' + eff.severity + ') for ' + zones + '. ' + effect + ' Open Rainshadow for the full text.'],
    'alert.cancelled': ['Cancelled: ' + eff.event + ' for ' + where, source.name + ' cancelled the ' + eff.event + ' for ' + zones + '. ' + last.description],
  }[kind];
  return createNotice(data, at, {
    kind, object: { type: 'alert', id: thread.id }, message_id: last.message_id, place_ids: matches.map(s => s.place_id), severity: eff.severity,
    title: text[0], body: text[1], bypass: kind !== 'alert.cancelled' && eff.severity === 'extreme',
  }, eventId);
}

module.exports = { list, get, acknowledge, alertNotice, summary };
