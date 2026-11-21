'use strict';
const {fail, copy, references} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const APP = require('../app.json').app_id;
const TYPE = {files:'file', notes:'note', messages:'message', tasks:'task', contacts:'contact'}[APP];
function find(data, id) {
  const item = data[APP].find(item => item.id === id);
  if (!item) fail('not_found', 'Record does not exist in this account.');
  return item;
}
function active(item) {
  if (item.trashed || item.archived || item.retracted) fail('invalid_state', 'Restore the record before editing.');
  return item;
}
function nextId(data, prefix = TYPE) {
  let n = 1;
  const ids = new Set([...data[APP], ...(data.conversations || [])].map(r => r.id));
  while (ids.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}
function stamp(ctx, item, action) {
  if (!Number.isFinite(Date.parse(ctx.virtual_now)) || Date.parse(ctx.virtual_now) < Date.parse(item.updated_at)) {
    fail('invalid_time', 'The run clock must not precede the last record update.');
  }
  item.updated_at = ctx.virtual_now;
  item.history.push({at: ctx.virtual_now, action});
  log(ctx, APP + '.' + action, {record_id:item.id});
}
function create(ctx, data, fields) {
  const item = {id:nextId(data), account_id:data.account_id, created_at:ctx.virtual_now,
    updated_at:ctx.virtual_now, history:[], ...fields};
  stamp(ctx, item, 'created');
  data[APP].push(item);
  return item;
}
function patch(item, changes) {
  if (!changes || !Object.keys(changes).length) fail('invalid_arguments', 'Patch must contain a field.');
  Object.assign(item, copy(changes));
}
function person(ctx, id) {
  if (id !== null && !ctx.binding.people.some(p => p.person_id === id)) {
    fail('invalid_seed', 'Person reference is not in the task binding.');
  }
}
function read(ctx, data, name, args) {
  if (name === APP + '.list') {
    const query = (args.query || '').toLocaleLowerCase();
    const searchable = ['id','title','name','display_name','body','text','description','list','organization','notes','emails','phones','tags','groups'];
    const items = data[APP].filter(r => (args.include_inactive || !(r.trashed || r.archived || r.retracted)) &&
      searchable.map(k=>JSON.stringify(r[k] ?? '')).join(' ').toLocaleLowerCase().includes(query));
    return {items:copy(items)};
  }
  if (name === APP + '.get') return {item:copy(find(data, args.id))};
}
function attachment(ctx, data, name, args) {
  if (![APP+'.attachment.add', APP+'.attachment.read'].includes(name)) return;
  const item = find(data, args.id);
  if (name.endsWith('.read')) {
    if (!item.attachments.includes(args.asset_id)) fail('not_available', 'Attachment belongs to another record.');
    if (!ctx.assets?.read) fail('unsupported_capability', 'An attachment reader is required.');
    return {file:ctx.assets.read(args.asset_id)};
  }
  active(item);
  if (APP === 'messages' && (item.delivery_source || item.author_person_id !== data.owner_person_id)) {
    fail('permission_denied', 'Only the author can change attachments.');
  }
  if (!ctx.assets?.add) fail('unsupported_capability', 'An attachment writer is required.');
  const ids = ctx.assets.add({object_type:TYPE, object_id:item.id, files:args.files});
  item.attachments = [...new Set([...item.attachments, ...ids])];
  stamp(ctx, item, 'attachment_added');
  return {id:item.id};
}
module.exports = {APP, TYPE, fail, copy, references, log, find, active, nextId, stamp, create, patch, person, read, attachment};
