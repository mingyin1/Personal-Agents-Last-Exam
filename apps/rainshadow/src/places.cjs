'use strict';
// W1: the gazetteer, saved places with their alert rules, sources and account preferences.
const { fail, ms, validTimeZone } = require('./util.cjs');
const { index, watchOpen } = require('./model.cjs');
const { UNIT_NAMES, CATEGORY } = require('./units.cjs');
const { record, inQuietHours } = require('./notices.cjs');

const placeRef = p => ({ id: p.id, name: p.name, region: p.region, timezone: p.timezone });
const sourceRef = s => ({ id: s.id, name: s.name, kind: s.kind });
function needPlace(ix, id) {
  const place = ix.places.get(id);
  if (!place) fail('not_found', 'No place ' + id + '. Use places.search to find a place ID.');
  return place;
}
function needSaved(ix, id) {
  const place = needPlace(ix, id), saved = ix.saved.get(id);
  if (!saved) fail('not_found', 'Place ' + id + ' is not saved in this account. Save it with places.save first.');
  return { place, saved };
}
// The source a call names, or the account default. `kind` restricts it to weather or air quality.
function needSource(ix, data, id, kind) {
  const source = ix.sources.get(id ?? data.preferences.default_source_id);
  if (!source || (kind && source.kind !== kind)) fail('not_found', 'No ' + (kind ? kind.replace('_', '-') + ' ' : '') + 'source ' + id + '. Use sources.list.');
  return source;
}
function cleanLabel(value) {
  const label = value.trim();
  if (!label) fail('invalid_arguments', 'A label needs at least one visible character.');
  return label;
}
const ordered = categories => CATEGORY.filter(c => categories.includes(c));
function presentSaved(data, ix, saved, now) {
  const place = ix.places.get(saved.place_id);
  return {
    ...place, label: saved.label, alert_rule: saved.alert_rule, saved_at: saved.saved_at,
    open_watches: data.watches.filter(w => w.place_id === place.id && watchOpen(w, now)).length,
  };
}
function presentPreferences(data, now) {
  const p = data.preferences;
  return { ...p, unit_names: UNIT_NAMES[p.units], in_quiet_hours: inQuietHours(p, now) };
}

function search(ctx, data, args) {
  const ix = index(data), q = args.query.trim().toLowerCase();
  const hits = data.places.filter(p => p.name.toLowerCase().includes(q) || p.region.toLowerCase().includes(q));
  return {
    places: hits.slice(0, args.limit ?? 20).map(p => ({ ...p, saved: ix.saved.has(p.id), label: ix.saved.get(p.id)?.label ?? null })),
    total: hits.length,
  };
}

function list(ctx, data) {
  const ix = index(data), now = ms(ctx.virtual_now);
  return { places: data.saved_places.map(s => presentSaved(data, ix, s, now)) };
}

function sources(ctx, data) {
  return {
    sources: data.sources.map(s => {
      const mine = data.issuances.filter(i => i.source_id === s.id);
      const latest = mine.reduce((best, i) => (!best || ms(i.issued_at) > ms(best.issued_at) ? i : best), null);
      const isDefault = s.id === data.preferences.default_source_id || s.id === data.preferences.default_air_source_id;
      return { ...s, is_default: isDefault, issuance_count: mine.length, latest_issued_at: latest ? latest.issued_at : null };
    }),
  };
}

function save(ctx, data, args) {
  const ix = index(data), place = needPlace(ix, args.id);
  if (ix.saved.has(place.id)) fail('already_saved', 'Place ' + place.id + ' is already saved. Use places.update to change its label or alert rule.');
  const rule = args.alert_rule ?? {};
  const saved = {
    place_id: place.id,
    label: args.label === undefined ? place.name.slice(0, 80) : cleanLabel(args.label),
    alert_rule: { categories: ordered(rule.categories ?? CATEGORY), min_severity: rule.min_severity ?? 'moderate', paused: rule.paused ?? false },
    saved_at: ctx.virtual_now,
  };
  data.saved_places.push(saved);
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'places.save', object_id: place.id, request_id: args.request_id });
  return { id: place.id, place: presentSaved(data, index(data), saved, ms(ctx.virtual_now)) };
}

function update(ctx, data, args) {
  const ix = index(data), { place, saved } = needSaved(ix, args.id), patch = args.patch, changed = Object.keys(patch);
  if (!changed.length) fail('invalid_arguments', 'patch names no field to change.');
  if (patch.label !== undefined) saved.label = cleanLabel(patch.label);
  if (patch.alert_rule !== undefined) {
    const rule = patch.alert_rule;
    if (rule.categories !== undefined) saved.alert_rule.categories = ordered(rule.categories);
    if (rule.min_severity !== undefined) saved.alert_rule.min_severity = rule.min_severity;
    if (rule.paused !== undefined) saved.alert_rule.paused = rule.paused;
  }
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'places.update', object_id: place.id, request_id: args.request_id, details: { changed_fields: changed } });
  return { id: place.id, place: presentSaved(data, ix, saved, ms(ctx.virtual_now)) };
}

function remove(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), { place } = needSaved(ix, args.id);
  const user = data.watches.find(w => w.place_id === place.id && watchOpen(w, now));
  if (user) fail('place_in_use', 'Watch ' + user.id + ' still uses place ' + place.id + '. Cancel the watch first.');
  data.saved_places = data.saved_places.filter(s => s.place_id !== place.id);
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'places.remove', object_id: place.id, request_id: args.request_id });
  return { id: place.id, removed: true };
}

function getPreferences(ctx, data) {
  return { preferences: presentPreferences(data, ms(ctx.virtual_now)) };
}

function updatePreferences(ctx, data, args) {
  const ix = index(data), patch = args.patch, changed = Object.keys(patch), p = data.preferences;
  if (!changed.length) fail('invalid_arguments', 'patch names no field to change.');
  if (patch.units !== undefined) p.units = patch.units;
  if (patch.default_source_id !== undefined) p.default_source_id = needSource(ix, data, patch.default_source_id, 'weather').id;
  // The default air-quality source is what a new watch with an aqi condition uses; null clears it.
  if (patch.default_air_source_id !== undefined) p.default_air_source_id = patch.default_air_source_id === null ? null : needSource(ix, data, patch.default_air_source_id, 'air_quality').id;
  if (patch.timezone !== undefined) {
    if (!validTimeZone(patch.timezone)) fail('invalid_timezone', 'Unknown time zone ' + patch.timezone + '. Use an IANA name such as America/Denver.');
    p.timezone = patch.timezone;
  }
  if (patch.quiet_hours !== undefined) {
    const q = { ...p.quiet_hours, ...patch.quiet_hours };
    if (q.start === q.end) fail('invalid_window', 'Quiet hours cannot start and end at the same time.');
    p.quiet_hours = { enabled: q.enabled, start: q.start, end: q.end };
  }
  if (patch.email_notices !== undefined) p.email_notices = patch.email_notices;
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'preferences.update', object_id: data.account_id, request_id: args.request_id, details: { changed_fields: changed } });
  return { id: data.account_id, preferences: presentPreferences(data, ms(ctx.virtual_now)) };
}

module.exports = { placeRef, sourceRef, needPlace, needSaved, needSource, cleanLabel, search, list, sources, save, update, remove, getPreferences, updatePreferences };
