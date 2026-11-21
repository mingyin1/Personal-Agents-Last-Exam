'use strict';
// Single source for Rainshadow's business contracts. `node dev/build.cjs` writes
// tools.json, schemas/seed.schema.json, schemas/events.schema.json and
// schemas/state.schema.json from this file; `--check` reports drift.
// Only keywords supported by the public schema validator are used.

const APP = 'rainshadow';
const VERSION = '1.0.0';
const CORE_API = '1.2.0';

const SEVERITY = ['minor', 'moderate', 'severe', 'extreme'];
const CATEGORY = ['flood', 'storm', 'winter', 'wind', 'temperature', 'fire', 'air_quality', 'other'];
const URGENCY = ['immediate', 'expected', 'future', 'past', 'unknown'];
const CERTAINTY = ['observed', 'likely', 'possible', 'unlikely', 'unknown'];
const SKY = ['clear', 'mostly_clear', 'partly_cloudy', 'mostly_cloudy', 'cloudy', 'fog', 'haze', 'smoke', 'drizzle', 'rain', 'heavy_rain', 'thunderstorm', 'sleet', 'snow'];
const POLLUTANT = ['pm25', 'pm10', 'ozone', 'no2', 'so2', 'co'];
const VARIABLE = ['pop', 'thunder_prob', 'precip', 'wind_gust', 'wind_speed', 'temp', 'apparent_temp', 'aqi'];
const UNIT = ['%', 'mm', 'in', 'km/h', 'mph', 'C', 'F', 'index'];
const NOTICE_KIND = ['alert.issued', 'alert.updated', 'alert.cancelled', 'watch.triggered', 'watch.cleared'];
const AQI_CATEGORY = ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous'];
// Rainshadow has no clock event: time is the environment's (an event's own `at`, or Core's env.advance_time).
const EVENTS = ['forecast.issued', 'observation.recorded', 'alert.issued', 'alert.updated', 'alert.cancelled'].map(x => APP + '.' + x);

// ---- builders -------------------------------------------------------------
const str = (min = 1, max = 200) => ({ type: 'string', minLength: min, maxLength: max });
// Record IDs use the character set Mail accepts for object references, so any record can be named in a notice.
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' };
const idArg = str(1, 100);
// Caller-chosen request and event IDs are stored as given.
const callRef = str(1, 100);
const ts = { type: 'string', format: 'date-time' };
const date = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };
const hhmm = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };
const bool = { type: 'boolean' };
const int = (min, max) => ({ type: 'integer', minimum: min, ...(max === undefined ? {} : { maximum: max }) });
const num = (min, max) => ({ type: 'number', minimum: min, maximum: max });
const en = (...values) => ({ enum: values });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const arr = (items, extra = {}) => ({ type: 'array', items, ...extra });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const describe = (schema, description) => ({ ...schema, description });

// ---- stored records (seed / state data) -------------------------------------
const zone = obj({ id, name: str(1, 120) });
const place = obj({ id, name: str(1, 120), region: str(1, 120), timezone: str(1, 64), zone_ids: arr(id, { minItems: 1, maxItems: 8, uniqueItems: true }) });
const source = obj({ id, name: str(1, 120), kind: en('weather', 'air_quality') });
const hourlyRow = obj({
  start: ts, temp_c: num(-90, 60), apparent_temp_c: num(-110, 70), pop: num(0, 100), precip_mm: num(0, 500),
  wind_kph: num(0, 400), gust_kph: num(0, 500), thunder_prob: num(0, 100), sky: en(...SKY),
});
const dailyWeather = obj({ date, headline: str(1, 160), summary: str(1, 600), high_c: num(-90, 60), low_c: num(-90, 60), pop_day: num(0, 100), pop_night: num(0, 100) });
const dailyAir = obj({ date, aqi: int(0, 500), pollutant: en(...POLLUTANT) }, ['date', 'aqi']);
const issuance = obj({
  id, source_id: id, place_id: id, issued_at: ts,
  hourly: arr(hourlyRow, { maxItems: 240 }),
  daily: arr({ anyOf: [dailyWeather, dailyAir] }, { maxItems: 16 }),
}, ['id', 'source_id', 'place_id', 'issued_at']);
const observation = obj({
  id, place_id: id, source_id: id, observed_at: ts, temp_c: num(-90, 60), wind_kph: num(0, 400), gust_kph: num(0, 500),
  conditions: en(...SKY), humidity: num(0, 100),
}, ['id', 'place_id', 'source_id', 'observed_at', 'temp_c', 'wind_kph', 'gust_kph', 'conditions']);
const alertMessage = obj({
  message_id: id, type: en('alert', 'update', 'cancel'), sent_at: ts, event: str(1, 120), severity: en(...SEVERITY),
  urgency: en(...URGENCY), certainty: en(...CERTAINTY), onset: ts, ends: ts, headline: str(1, 200), description: str(1, 4000),
  instruction: str(1, 2000),
}, ['message_id', 'type', 'sent_at', 'headline', 'description']);
const alert = obj({
  id, source_id: id, category: en(...CATEGORY), zone_ids: arr(id, { minItems: 1, maxItems: 16, uniqueItems: true }),
  messages: arr(alertMessage, { minItems: 1, maxItems: 50 }),
});
const quietHours = obj({ enabled: bool, start: hhmm, end: hhmm });
const preferences = obj({ units: en('metric', 'us'), default_source_id: id, default_air_source_id: nullable(id), timezone: str(1, 64), quiet_hours: quietHours, email_notices: bool });
const alertRule = obj({ categories: arr(en(...CATEGORY), { maxItems: 8, uniqueItems: true }), min_severity: en(...SEVERITY), paused: bool });
const savedPlace = obj({ place_id: id, label: str(1, 80), alert_rule: alertRule, saved_at: ts });
const acknowledgement = obj({ alert_id: id, message_id: id, acknowledged_at: ts });
const thresholdCondition = obj({ variable: en(...VARIABLE), op: en('gte', 'lte'), value: num(-200, 1000), unit: en(...UNIT) });
const alertCondition = obj({ variable: { const: 'alert' }, category: en('any', ...CATEGORY), min_severity: en(...SEVERITY) });
const condition = { anyOf: [thresholdCondition, alertCondition] };
const match = obj({
  start: ts, date, alert_id: id, message_id: id, value: { type: 'number' }, unit: en(...UNIT),
  severity: en(...SEVERITY), category: en(...CATEGORY),
}, []);
const conditionResult = obj({ index: int(0, 5), evaluable: bool, met: bool, matches: arr(match, { maxItems: 240 }) });
const issuanceRef = obj({ id, issued_at: ts });
// What one evaluation used: the weather issuance for hourly conditions, the air-quality
// issuance for aqi conditions, and the window hours and local dates each covered or missed.
const evaluation = obj({
  status: en('no_data', 'clear', 'triggered'), evaluated_at: ts,
  cause: obj({ kind: str(1, 60), request_id: callRef, event_id: callRef }, ['kind']),
  issuance: nullable(issuanceRef), aq_issuance: nullable(issuanceRef),
  hours: obj({ considered: int(0, 240), missing: arr(ts, { maxItems: 240 }), frozen: bool }, ['considered', 'missing']),
  dates: obj({ considered: int(0, 12), missing: arr(date, { maxItems: 12 }) }),
  conditions: arr(conditionResult, { maxItems: 6 }),
}, ['status', 'evaluated_at']);
const linkedObject = obj({ app_id: str(1, 100), object_type: str(1, 60), object_id: str(1, 150) }, ['app_id', 'object_id']);
const watch = obj({
  id, seq: int(0), label: str(1, 80), place_id: id, source_id: id, aq_source_id: id, start: ts, end: ts,
  conditions: arr(condition, { minItems: 1, maxItems: 6 }), linked_object: linkedObject,
  created_at: ts, updated_at: ts, cancelled_at: ts, evaluation,
}, ['id', 'label', 'place_id', 'source_id', 'start', 'end', 'conditions', 'created_at', 'evaluation']);
const noticeObject = obj({ type: en('alert', 'watch'), id });
const notice = obj({
  id, seq: int(0), kind: en(...NOTICE_KIND), created_at: ts, object: noticeObject, message_id: id,
  place_ids: arr(id, { maxItems: 50, uniqueItems: true }), severity: en(...SEVERITY), title: str(1, 200), body: str(1, 2000),
  release_at: ts, cause: obj({ event_id: callRef }, []), wire: { type: 'object' },
}, ['id', 'kind', 'created_at', 'release_at', 'object', 'place_ids', 'title', 'body']);
const activity = obj({
  seq: int(1), at: ts, actor: en('agent', 'event'), action: str(1, 80), object_id: str(1, 150),
  request_id: callRef, event_id: callRef, details: { type: 'object' },
}, ['seq', 'at', 'actor', 'action', 'object_id']);

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Rainshadow account and world records',
  description: 'History accepted by env.load_seed and kept as App data. World records (zones, places, sources, issuances, observations, alerts) and one account (preferences, saved places, acknowledgements, watches, notices, activity). Every record in a seed counts as already issued. Time-based states are not stored: a notice carries its release time and a watch its window end, and both are read against the environment clock.',
  ...obj({
    account_id: id, owner_person_id: id,
    zones: arr(zone, { maxItems: 200 }), places: arr(place, { maxItems: 200 }), sources: arr(source, { minItems: 1, maxItems: 20 }),
    issuances: arr(issuance, { maxItems: 400 }), observations: arr(observation, { maxItems: 1000 }), alerts: arr(alert, { maxItems: 200 }),
    preferences, saved_places: arr(savedPlace, { maxItems: 50 }), acknowledgements: arr(acknowledgement, { maxItems: 1000 }),
    watches: arr(watch, { maxItems: 500 }), notices: arr(notice, { maxItems: 2000 }), activity: arr(activity, { maxItems: 20000 }),
  }),
};

// ---- incoming events ------------------------------------------------------------
const envelope = (operation, payload) => obj({ event_id: str(1, 100), at: ts, operation: { const: operation }, payload });
const fullMessage = type => obj({
  ...alertMessage.properties, type: { const: type },
}, ['message_id', 'type', 'sent_at', 'event', 'severity', 'urgency', 'certainty', 'onset', 'ends', 'headline', 'description']);
const cancelMessage = obj({ message_id: id, type: { const: 'cancel' }, sent_at: ts, headline: str(1, 200), description: str(1, 4000) });
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Rainshadow incoming events',
  description: 'Events Infra may apply with env.apply_event. Each is handled at its own `at`. There is no clock event: Infra moves time with an event or with Core\'s env.advance_time, which runs no App code.',
  type: 'object',
  oneOf: [
    envelope(EVENTS[0], obj({ issuance_id: id, source_id: id, place_id: id, issued_at: ts, hourly: issuance.properties.hourly, daily: issuance.properties.daily }, ['issuance_id', 'source_id', 'place_id', 'issued_at'])),
    envelope(EVENTS[1], obj({
      observation_id: id, place_id: id, source_id: id, observed_at: ts, temp_c: observation.properties.temp_c, wind_kph: observation.properties.wind_kph,
      gust_kph: observation.properties.gust_kph, conditions: observation.properties.conditions, humidity: observation.properties.humidity,
    }, ['observation_id', 'place_id', 'source_id', 'observed_at', 'temp_c', 'wind_kph', 'gust_kph', 'conditions'])),
    envelope(EVENTS[2], obj({ alert_id: id, source_id: id, category: en(...CATEGORY), zone_ids: alert.properties.zone_ids, message: fullMessage('alert') })),
    envelope(EVENTS[3], obj({ alert_id: id, message: fullMessage('update') })),
    envelope(EVENTS[4], obj({ alert_id: id, message: cancelMessage })),
  ],
};

// ---- tool results ---------------------------------------------------------------------
const version = obj({ epoch: int(1), revision: int(0) });
const unitNames = obj({ temperature: en('C', 'F'), wind: en('km/h', 'mph'), precipitation: en('mm', 'in') });
const placeRef = obj({ id, name: str(1, 120), region: str(1, 120), timezone: str(1, 64) });
const sourceRef = obj({ id, name: str(1, 120), kind: en('weather', 'air_quality') });
const placeOut = obj({ ...place.properties, saved: bool, label: nullable(str(1, 80)) });
const savedPlaceOut = obj({ ...place.properties, label: str(1, 80), alert_rule: alertRule, saved_at: ts, open_watches: int(0) });
const issuanceOut = obj({ id, issued_at: ts, is_latest: bool });
const hourlyOut = obj({
  start: ts, temp: { type: 'number' }, apparent_temp: { type: 'number' }, pop: num(0, 100), precip: { type: 'number' },
  wind: { type: 'number' }, gust: { type: 'number' }, thunder_prob: num(0, 100), sky: en(...SKY),
});
const dailyWeatherOut = obj({ date, headline: str(1, 160), summary: str(1, 600), high: { type: 'number' }, low: { type: 'number' }, pop_day: num(0, 100), pop_night: num(0, 100) });
const dailyAirOut = obj({ date, aqi: int(0, 500), category: en(...AQI_CATEGORY), pollutant: nullable(en(...POLLUTANT)) });
const coverageReason = nullable(en('no_issuance', 'outside_issuance', 'partial', 'no_hourly_product'));
const alertSummary = obj({
  id, source_id: id, category: en(...CATEGORY), zone_ids: alert.properties.zone_ids, status: en('upcoming', 'active', 'expired', 'cancelled'),
  event: str(1, 120), severity: en(...SEVERITY), urgency: en(...URGENCY), certainty: en(...CERTAINTY), onset: ts, ends: ts, headline: str(1, 200),
  latest_message_id: id, latest_message_type: en('alert', 'update', 'cancel'), message_count: int(1), acknowledged: bool,
});
const alertDetail = obj({
  ...alertSummary.properties, source: sourceRef, messages: alert.properties.messages,
  acknowledgements: arr(obj({ message_id: id, acknowledged_at: ts }), { maxItems: 50 }),
  affected_places: arr(obj({ id, name: str(1, 120), saved: bool, label: nullable(str(1, 80)) }), { maxItems: 200 }),
});
const watchOut = obj({
  id, label: str(1, 80), status: en('no_data', 'clear', 'triggered', 'ended', 'cancelled'), place: placeRef, source_id: id,
  aq_source_id: nullable(id), start: ts, end: ts, conditions: watch.properties.conditions, linked_object: nullable(linkedObject),
  created_at: ts, updated_at: nullable(ts), cancelled_at: nullable(ts), evaluation,
});
const noticeOut = obj({
  id, kind: en(...NOTICE_KIND), state: en('held', 'released'), created_at: ts, release_at: ts,
  object: noticeObject, message_id: nullable(id), place_ids: notice.properties.place_ids, severity: nullable(en(...SEVERITY)),
  title: str(1, 200), body: str(1, 2000), email_copy: bool,
});
const preferencesOut = obj({ ...preferences.properties, unit_names: unitNames, in_quiet_hours: bool });

// ---- tool inputs --------------------------------------------------------------------------
const conditionIn = {
  anyOf: [
    obj({ variable: en(...VARIABLE), op: en('gte', 'lte'), value: num(-200, 1000), unit: en(...UNIT) }, ['variable', 'value']),
    obj({ variable: { const: 'alert' }, category: en('any', ...CATEGORY), min_severity: en(...SEVERITY) }, ['variable']),
  ],
};
const conditionsIn = describe(arr(conditionIn, { minItems: 1, maxItems: 6 }),
  'One to six alternative conditions; one met condition in one hour is enough. Threshold: {variable, op (gte default, or lte), value, unit}. variable is pop or thunder_prob (%), precip (mm or in per hour), wind_gust or wind_speed (km/h or mph), temp or apparent_temp (C or F), or aqi (index, daily). unit defaults to the account units. Alert: {variable: "alert", category (default any), min_severity (default minor)} is met by an upcoming or active alert that affects the place and overlaps the window.');
const alertRuleIn = obj({ categories: alertRule.properties.categories, min_severity: alertRule.properties.min_severity, paused: bool }, []);
const windowStart = describe(ts, 'Window start, ISO 8601 with a UTC offset.');
const windowEnd = describe(ts, 'Window end (exclusive), ISO 8601 with a UTC offset.');
const cursor = describe(str(1, 100), 'Opaque value from next_cursor of the previous page.');
const write = { expected_version: describe(version, 'Version from the latest result you read. A stale version is rejected with stale_version.'), request_id: describe(str(1, 100), 'Unique ID for this write. Repeating it with the same input returns the stored result.') };

const READ = 'rainshadow.read', WRITE = 'rainshadow.write';
const tool = (name, read_only, resource_target, description, input, required, output, outputRequired = Object.keys(output)) => ({
  name: APP + '.' + name, description, scope: read_only ? READ : WRITE, resource_target, read_only,
  input: { ...input, ...(read_only ? {} : write) },
  required: [...required, ...(read_only ? [] : ['expected_version', 'request_id'])],
  output, outputRequired,
});

const TOOLS = [
  tool('places.search', true, 'gazetteer',
    'Search the place gazetteer by name or region (case-insensitive substring). Returns each place with its time zone, alert zones and whether it is saved in this account. No side effects.',
    { query: describe(str(1, 100), 'Text to find in a place name or region.'), limit: int(1, 50) }, ['query'],
    { places: arr(placeOut), total: int(0) }),
  tool('places.list', true, 'current account',
    'List the saved places of this account with their label, alert rule (categories, minimum severity, paused) and the number of open watches. No side effects.',
    {}, [], { places: arr(savedPlaceOut) }),
  tool('sources.list', true, 'forecast sources',
    'List forecast sources (weather or air quality). is_default marks the account\'s default weather source and its default air-quality source. No side effects.',
    {}, [], { sources: arr(obj({ ...source.properties, is_default: bool, issuance_count: int(0), latest_issued_at: nullable(ts) })) }),
  tool('forecast.issuances', true, 'place',
    'List the forecast issuances stored for a place, newest first. Each issuance is one source\'s forecast at one issue time. id is the place ID. No side effects.',
    { id: describe(idArg, 'Place ID.'), source_id: describe(idArg, 'Only issuances from this source.'), limit: int(1, 100), cursor }, ['id'],
    {
      place: placeRef,
      issuances: arr(obj({
        id, source_id: id, kind: en('weather', 'air_quality'), issued_at: ts, is_latest: bool,
        hourly: nullable(obj({ count: int(1), start: ts, end: ts })), daily: nullable(obj({ count: int(1), start_date: date, end_date: date })),
      })),
      next_cursor: nullable(str(1, 100)),
    }),
  tool('forecast.hourly', true, 'place',
    'Read hourly forecast rows for a place and window from one issuance. By default this is the latest issuance of the account default source; issuance_id returns an earlier one. The result always names the issuance (id, issued_at, is_latest). Rows are returned as issued, in the account units; coverage.missing lists requested hours the issuance does not contain. Rainshadow never interpolates and never falls back to another source. id is the place ID. No side effects.',
    {
      id: describe(idArg, 'Place ID.'), start: windowStart, end: windowEnd, source_id: describe(idArg, 'Weather source; defaults to the account default source.'),
      issuance_id: describe(idArg, 'A specific issuance for this place instead of the latest.'), limit: int(1, 240), cursor,
    }, ['id'],
    {
      place: placeRef, source: sourceRef, issuance: nullable(issuanceOut), units: unitNames, start: ts, end: ts, rows: arr(hourlyOut),
      coverage: obj({ requested_hours: int(0), covered_hours: int(0), missing: arr(ts, { maxItems: 240 }), reason: coverageReason }),
      next_cursor: nullable(str(1, 100)),
    }),
  tool('forecast.daily', true, 'place',
    'Read daily forecast rows for a place from one issuance: headline, summary, high, low and day and night precipitation probability for a weather source, or the air-quality index and its category for an air-quality source. The headline describes the whole day exactly as issued. The window selects the local dates it touches. id is the place ID. No side effects.',
    {
      id: describe(idArg, 'Place ID.'), start: windowStart, end: windowEnd, source_id: describe(idArg, 'Weather or air-quality source; defaults to the account\'s default weather source.'),
      issuance_id: describe(idArg, 'A specific issuance for this place instead of the latest.'),
    }, ['id'],
    {
      place: placeRef, source: sourceRef, issuance: nullable(issuanceOut), units: unitNames, start: ts, end: ts,
      rows: arr({ anyOf: [dailyWeatherOut, dailyAirOut] }),
      coverage: obj({ requested_days: int(0), covered_days: int(0), missing: arr(date, { maxItems: 32 }), reason: coverageReason }),
    }),
  tool('conditions.get', true, 'place',
    'Read the newest observation for a place and its age in minutes. observation is null when the place has none. id is the place ID. No side effects.',
    { id: describe(idArg, 'Place ID.'), source_id: describe(idArg, 'Only observations from this source.') }, ['id'],
    {
      place: placeRef, units: unitNames,
      observation: nullable(obj({
        id, source_id: id, observed_at: ts, age_minutes: int(0), temp: { type: 'number' }, wind: { type: 'number' }, gust: { type: 'number' },
        conditions: en(...SKY), humidity: nullable(num(0, 100)),
      })),
    }),
  tool('alerts.list', true, 'place',
    'List the alerts that affect a place (they share an alert zone) and overlap the window. Cancelled and expired alerts are hidden unless include_closed is true. Status is upcoming before onset, active until ends, then expired; cancelled after a cancel message. id is the place ID. No side effects.',
    { id: describe(idArg, 'Place ID.'), start: windowStart, end: windowEnd, include_closed: bool }, ['id'],
    { place: placeRef, start: ts, end: ts, alerts: arr(alertSummary) }),
  tool('alerts.get', true, 'alert thread',
    'Read one alert thread: every message in order (alert, update, cancel), its current status, the acknowledgement history and the places it affects. id is the alert ID. No side effects.',
    { id: describe(idArg, 'Alert ID.') }, ['id'], { alert: alertDetail }),
  tool('watches.list', true, 'current account',
    'List the weather watches of this account with their current status and latest evaluation. A watch reads ended once its window end has passed. Ended and cancelled watches are hidden unless include_closed is true. No side effects.',
    { place_id: describe(idArg, 'Only watches on this place.'), include_closed: bool }, [], { watches: arr(watchOut) }),
  tool('watches.get', true, 'watch',
    'Read one watch: place, window, weather source, air-quality source (when it has an aqi condition), conditions, status and the evaluation record, which names every issuance used, the hours and dates covered or missed and what met each condition. id is the watch ID. No side effects.',
    { id: describe(idArg, 'Watch ID.') }, ['id'], { watch: watchOut }),
  tool('notices.list', true, 'current account',
    'List the notices Rainshadow wrote for this account, newest first: alert notices for saved places and watch notices. Every notice has a release time: the time it was written, or the end of the quiet period it was written in. It reads held before that time and released from then on. No side effects.',
    { kind: en(...NOTICE_KIND), state: en('held', 'released'), since: describe(ts, 'Only notices created at or after this time.'), limit: int(1, 100), cursor }, [],
    { notices: arr(noticeOut), next_cursor: nullable(str(1, 100)) }),
  tool('preferences.get', true, 'current account',
    'Read the account preferences: units, default weather source, default air-quality source (null when none is set), home time zone, quiet hours and whether notices are also emailed. No side effects.',
    {}, [], { preferences: preferencesOut }),

  tool('places.save', false, 'current account',
    'Save a gazetteer place in this account under a label of the user\'s own, with an alert rule: which alert categories and minimum severity produce a notice for this place, and whether the rule is paused. id is the place ID. Errors: not_found, already_saved.',
    { id: describe(idArg, 'Place ID from places.search.'), label: str(1, 80), alert_rule: alertRuleIn }, ['id'],
    { id, place: savedPlaceOut }),
  tool('places.update', false, 'current account',
    'Change the label or alert rule of a saved place. Only the fields present in patch change. id is the place ID. Errors: not_found.',
    { id: describe(idArg, 'Place ID of a saved place.'), patch: obj({ label: str(1, 80), alert_rule: alertRuleIn }, []) }, ['id', 'patch'],
    { id, place: savedPlaceOut }),
  tool('places.remove', false, 'current account',
    'Remove a saved place and its alert rule. A place that an open watch still uses cannot be removed. id is the place ID. Errors: not_found, place_in_use.',
    { id: describe(idArg, 'Place ID of a saved place.') }, ['id'], { id, removed: { const: true } }),
  tool('preferences.update', false, 'current account',
    'Change account preferences. Only the fields present in patch change. Units change how values are returned, not what is stored. Quiet hours hold new notices until they end, except notices for extreme alerts; notices already written keep their release time. default_air_source_id is the air-quality source new watches use for aqi conditions; null clears it. Errors: not_found (an unknown default source, or one of the wrong kind), invalid_timezone, invalid_window (quiet hours that start and end at the same time).',
    {
      patch: obj({
        units: en('metric', 'us'), default_source_id: idArg, default_air_source_id: nullable(idArg), timezone: describe(str(1, 64), 'IANA time zone, for example America/Denver.'),
        quiet_hours: obj({ enabled: bool, start: hhmm, end: hhmm }, []), email_notices: bool,
      }, []),
    }, ['patch'],
    { id, preferences: preferencesOut }),
  tool('alerts.acknowledge', false, 'alert thread',
    'Acknowledge the latest message of an upcoming or active alert on behalf of the user. An update clears the acknowledgement. id is the alert ID. Errors: not_found, stale_message (message_id is not the latest message), already_acknowledged, invalid_state (the alert is cancelled or expired).',
    { id: describe(idArg, 'Alert ID.'), message_id: describe(idArg, 'The message that was read; it must be the latest one.') }, ['id', 'message_id'],
    { id, message_id: id, acknowledged_at: ts }),
  tool('watches.create', false, 'place',
    'Create a weather watch on a saved place: a time window, a weather source, an air-quality source when it has an aqi condition, and one to six alternative conditions. Rainshadow evaluates it at once (status no_data, clear or triggered) and again whenever a new issuance from one of its sources or an alert message arrives, and writes a notice when it becomes triggered or goes from triggered to clear. The watch ends when its window ends. id is the place ID; the result id is the new watch ID. Errors: not_found (the place is not saved, a source is unknown or of the wrong kind, or an aqi condition has no air-quality source to use), invalid_window (window already over, longer than 10 days, or start not before end), limit_exceeded (more than 20 open watches), invalid_arguments (aq_source_id without an aqi condition).',
    {
      id: describe(idArg, 'Place ID of a saved place.'), start: windowStart, end: windowEnd, conditions: conditionsIn,
      source_id: describe(idArg, 'Weather source to follow; defaults to the account default source.'),
      aq_source_id: describe(idArg, 'Air-quality source for aqi conditions; defaults to the account\'s default air-quality source. Only for a watch with an aqi condition.'),
      label: str(1, 80), linked_object: describe(linkedObject, 'Optional opaque reference supplied by the caller, for example a Calendar event. Rainshadow never reads it.'),
    }, ['id', 'start', 'end', 'conditions'],
    { id, watch: watchOut }),
  tool('watches.update', false, 'watch',
    'Change an open watch. Only the fields present in patch change. The watch is evaluated again and no notice is written, because the user caused the change. A watch that loses its last aqi condition drops its air-quality source. id is the watch ID. Errors: not_found, invalid_state (the watch is ended or cancelled), invalid_window, invalid_arguments (an empty patch, or aq_source_id without an aqi condition).',
    {
      id: describe(idArg, 'Watch ID.'),
      patch: obj({ label: str(1, 80), start: windowStart, end: windowEnd, conditions: conditionsIn, source_id: idArg, aq_source_id: idArg, linked_object: nullable(linkedObject) }, []),
    }, ['id', 'patch'],
    { id, watch: watchOut }),
  tool('watches.cancel', false, 'watch',
    'Cancel an open watch. It keeps its history and writes no further notices. id is the watch ID. Errors: not_found, invalid_state (already ended or cancelled).',
    { id: describe(idArg, 'Watch ID.') }, ['id'], { id, watch: watchOut }),
];

const failure = obj({ status: { type: 'string' }, message: { type: 'string' }, applied: { const: false }, version, current_version: version }, ['status', 'message', 'applied', 'version']);
function toolsJson() {
  return TOOLS.map(t => ({
    name: t.name, description: t.description, scope: t.scope, resource_target: t.resource_target, read_only: t.read_only,
    inputSchema: obj(t.input, t.required),
    outputSchema: {
      type: 'object',
      anyOf: [
        obj({ status: en('ok', 'committed'), app_id: { const: APP }, version, duplicate: bool, ...t.output }, ['status', 'app_id', 'version', ...t.outputRequired]),
        failure,
      ],
    },
  }));
}

// Core state envelope, identical to the provided template apart from App identity.
function stateSchema(template) {
  const s = JSON.parse(JSON.stringify(template));
  s.properties.package_version = { const: VERSION };
  s.properties.core_api_version = { const: CORE_API };
  s.properties.app_id = { const: APP };
  return s;
}

module.exports = {
  APP, VERSION, CORE_API, SEVERITY, CATEGORY, URGENCY, CERTAINTY, SKY, POLLUTANT, VARIABLE, UNIT, NOTICE_KIND, AQI_CATEGORY, EVENTS,
  seed, events, toolsJson, stateSchema,
};
