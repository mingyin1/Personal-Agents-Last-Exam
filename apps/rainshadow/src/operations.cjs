'use strict';
// Tool dispatch. Handlers work on the copy Core supplies; a read never changes it.
const { fail } = require('./util.cjs');
const places = require('./places.cjs'), forecast = require('./forecast.cjs'), alerts = require('./alerts.cjs'), watches = require('./watches.cjs'), notices = require('./notices.cjs');
const { log } = require('./diagnostics.cjs');

const handlers = {
  'places.search': places.search, 'places.list': places.list, 'sources.list': places.sources,
  'forecast.issuances': forecast.issuances, 'forecast.hourly': forecast.hourly, 'forecast.daily': forecast.daily, 'conditions.get': forecast.conditions,
  'alerts.list': alerts.list, 'alerts.get': alerts.get, 'watches.list': watches.list, 'watches.get': watches.get,
  'notices.list': notices.list, 'preferences.get': places.getPreferences,
  'places.save': places.save, 'places.update': places.update, 'places.remove': places.remove, 'preferences.update': places.updatePreferences,
  'alerts.acknowledge': alerts.acknowledge, 'watches.create': watches.create, 'watches.update': watches.update, 'watches.cancel': watches.cancel,
};

function handleTool(ctx, data, name, args = {}) {
  const short = String(name).startsWith('rainshadow.') ? name.slice(11) : '', handler = handlers[short];
  if (!handler) fail('not_found', 'Unknown Rainshadow tool ' + name + '.');
  const result = handler(ctx, data, args);
  log(ctx, 'rainshadow.' + short.replace(/\./g, '_') + '.prepared', typeof result.id === 'string' ? { object_id: result.id } : {});
  return { data, result };
}

module.exports = { handleTool, tools: Object.keys(handlers) };
