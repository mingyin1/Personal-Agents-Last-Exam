'use strict';
const {APP, copy, fail, log} = require('./common.cjs');
function applyEvent(ctx, data, event) {
  if (APP === 'messages' && event.operation === 'messages.receive') {
    return require('./messaging.cjs').receive(ctx, data, event);
  }
  if (event.operation !== APP + '.upsert') fail('invalid_event', 'Unsupported operation.');
  const item = copy(event.payload);
  if (item.updated_at !== event.at) fail('invalid_event', 'Event time must match the record update time.');
  const index = data[APP].findIndex(r => r.id === item.id);
  if (index >= 0) {
    const old = data[APP][index];
    if (JSON.stringify(item.delivery_source) !== JSON.stringify(old.delivery_source)) {
      fail('invalid_event', 'Delivery source is immutable for an existing record.');
    }
    if (item.created_at !== old.created_at || Date.parse(item.updated_at) < Date.parse(old.updated_at) ||
        JSON.stringify(item.history.slice(0, old.history.length)) !== JSON.stringify(old.history) || item.history.length <= old.history.length) {
      fail('invalid_event', 'Updates must retain creation time and extend existing history.');
    }
    for (const field of ['versions','revisions','edits']) {
      if (old[field] && JSON.stringify(item[field].slice(0, old[field].length)) !== JSON.stringify(old[field])) {
        fail('invalid_event', 'Existing revisions are immutable.');
      }
    }
    // Retain changed content even when a scenario author supplies only the new value.
    if (APP === 'notes' && (old.title !== item.title || old.body !== item.body)) {
      const previous = {at:old.updated_at, title:old.title, body:old.body};
      if (JSON.stringify(item.revisions[old.revisions.length]) !== JSON.stringify(previous)) item.revisions.splice(old.revisions.length,0,previous);
    }
    if (APP === 'messages' && old.text !== item.text) {
      const previous = {at:old.updated_at, text:old.text};
      if (JSON.stringify(item.edits[old.edits.length]) !== JSON.stringify(previous)) item.edits.splice(old.edits.length,0,previous);
    }
    data[APP][index] = item;
  } else data[APP].push(item);
  log(ctx, APP+'.event_prepared', {record_id:item.id, event_id:event.event_id});
  return data;
}
module.exports = {applyEvent};
