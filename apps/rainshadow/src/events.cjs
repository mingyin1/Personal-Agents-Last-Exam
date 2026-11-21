'use strict';
// Incoming events. Time is the environment's: Rainshadow has no timers, no scheduler and no
// clock event. An event is handled at its own time T (`event.at`, which the host also
// supplies as ctx.virtual_now while the handler runs): the event is stored, then the open
// watches it affects are evaluated again and notices are written. A watch whose window has
// ended by T is not open and is left alone; a notice written at T is held or released by
// the quiet hours at T.
const { fail, ms } = require('./util.cjs');
const { validateSeed, objects, index, latestMessage, sharesZone, watchOpen } = require('./model.cjs');
const { record } = require('./notices.cjs');
const { alertNotice } = require('./alerts.cjs');
const { reevaluate } = require('./watches.cjs');
const { log } = require('./diagnostics.cjs');

const APP = 'rainshadow.';
const reject = message => fail('invalid_event', message);

const notLater = (value, T, name) => { if (ms(value) > T) reject(name + ' is later than the event time.'); };
const newId = (data, id) => { if (objects(data).includes(id)) reject('ID ' + id + ' is already in use.'); };
const newMessageId = (data, id) => { if (data.alerts.some(a => a.messages.some(m => m.message_id === id))) reject('Message ID ' + id + ' is already in use.'); };
function openWatches(data, T, test) {
  return data.watches.filter(w => watchOpen(w, T) && test(w)).sort((a, b) => (a.id < b.id ? -1 : 1));
}

const handlers = {
  'forecast.issued'(data, event, T) {
    const p = event.payload, ix = index(data), source = ix.sources.get(p.source_id), place = ix.places.get(p.place_id);
    if (!source || !place) reject('Unknown source or place.');
    notLater(p.issued_at, T, 'issued_at');
    newId(data, p.issuance_id);
    const issuance = { id: p.issuance_id, source_id: source.id, place_id: place.id, issued_at: p.issued_at };
    if (p.hourly !== undefined) issuance.hourly = p.hourly;
    if (p.daily !== undefined) issuance.daily = p.daily;
    data.issuances.push(issuance);
    record(data, { at: event.at, actor: 'event', action: 'forecast.issued', object_id: issuance.id, event_id: event.event_id });
    for (const w of openWatches(data, T, w => w.place_id === place.id && (w.source_id === source.id || w.aq_source_id === source.id))) reevaluate(data, w, event.at, 'forecast.issued', event.event_id, { source_id: source.id });
    return issuance.id;
  },
  'observation.recorded'(data, event, T) {
    const p = event.payload, ix = index(data);
    if (!ix.sources.has(p.source_id) || !ix.places.has(p.place_id)) reject('Unknown source or place.');
    notLater(p.observed_at, T, 'observed_at');
    newId(data, p.observation_id);
    const { observation_id: id, ...rest } = p;
    data.observations.push({ id, ...rest });
    record(data, { at: event.at, actor: 'event', action: 'observation.recorded', object_id: id, event_id: event.event_id });
    return id;
  },
  'alert.issued'(data, event, T) {
    const p = event.payload, ix = index(data);
    if (!ix.sources.has(p.source_id)) reject('Unknown source.');
    if (p.zone_ids.some(z => !ix.zones.has(z))) reject('Unknown zone.');
    notLater(p.message.sent_at, T, 'sent_at');
    newId(data, p.alert_id);
    newMessageId(data, p.message.message_id);
    const thread = { id: p.alert_id, source_id: p.source_id, category: p.category, zone_ids: p.zone_ids, messages: [p.message] };
    data.alerts.push(thread);
    return afterAlert(data, thread, event, T, 'alert.issued');
  },
  'alert.updated'(data, event, T) { return followUp(data, event, T, 'alert.updated'); },
  'alert.cancelled'(data, event, T) { return followUp(data, event, T, 'alert.cancelled'); },
};

function followUp(data, event, T, kind) {
  const p = event.payload, thread = index(data).alerts.get(p.alert_id);
  if (!thread) reject('Unknown alert ' + p.alert_id + '.');
  if (latestMessage(thread).type === 'cancel') reject('Alert ' + thread.id + ' is cancelled and takes no further messages.');
  notLater(p.message.sent_at, T, 'sent_at');
  newMessageId(data, p.message.message_id);
  thread.messages.push(p.message);
  return afterAlert(data, thread, event, T, kind);
}

function afterAlert(data, thread, event, T, kind) {
  const ix = index(data);
  record(data, { at: event.at, actor: 'event', action: kind, object_id: thread.id, event_id: event.event_id, details: { message_id: latestMessage(thread).message_id } });
  alertNotice(data, thread, kind, event.at, event.event_id);
  const affected = w => w.conditions.some(c => c.variable === 'alert') && sharesZone(ix.places.get(w.place_id), thread);
  for (const w of openWatches(data, T, affected)) reevaluate(data, w, event.at, kind, event.event_id, { alert: thread });
  return thread.id;
}

function applyEvent(ctx, data, event) {
  const name = String(event.operation).startsWith(APP) ? event.operation.slice(APP.length) : '', handler = handlers[name];
  if (!handler) reject('Unknown Rainshadow event ' + event.operation + '.');
  const objectId = handler(data, event, ms(event.at));
  // Anything an event would leave inconsistent is the event's fault, not the seed's.
  try { validateSeed(ctx, data); } catch (e) { if (e.code === 'invalid_seed') reject(e.message); throw e; }
  log(ctx, 'rainshadow.event.prepared', { operation: event.operation, object_id: objectId });
  return data;
}

module.exports = { applyEvent };
