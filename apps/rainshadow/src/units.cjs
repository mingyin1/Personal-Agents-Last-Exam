'use strict';
// Stored values are metric. Results are converted to the account's units and name them.
// Thresholds are compared on unrounded converted values; only displayed values are rounded.

const UNIT_NAMES = {
  metric: { temperature: 'C', wind: 'km/h', precipitation: 'mm' },
  us: { temperature: 'F', wind: 'mph', precipitation: 'in' },
};
const convert = {
  temperature: (c, unit) => (unit === 'F' ? c * 9 / 5 + 32 : c),
  wind: (kph, unit) => (unit === 'mph' ? kph / 1.609344 : kph),
  precipitation: (mm, unit) => (unit === 'in' ? mm / 25.4 : mm),
  percent: value => value,
  index: value => value,
};
const DECIMALS = { F: 1, mph: 1, in: 2 };
const round = (value, decimals) => { const f = 10 ** decimals; return Math.round((value + Number.EPSILON) * f) / f; };

// Value for display: metric values are returned exactly as stored; US values are rounded.
function shown(kind, metricValue, units) {
  const unit = UNIT_NAMES[units][kind];
  return unit in DECIMALS ? round(convert[kind](metricValue, unit), DECIMALS[unit]) : metricValue;
}

// Watch condition variables: stored field, quantity kind and the units a threshold may use.
const VARIABLES = {
  pop: { field: 'pop', kind: 'percent', units: ['%'] },
  thunder_prob: { field: 'thunder_prob', kind: 'percent', units: ['%'] },
  precip: { field: 'precip_mm', kind: 'precipitation', units: ['mm', 'in'] },
  wind_gust: { field: 'gust_kph', kind: 'wind', units: ['km/h', 'mph'] },
  wind_speed: { field: 'wind_kph', kind: 'wind', units: ['km/h', 'mph'] },
  temp: { field: 'temp_c', kind: 'temperature', units: ['C', 'F'] },
  apparent_temp: { field: 'apparent_temp_c', kind: 'temperature', units: ['C', 'F'] },
  aqi: { field: 'aqi', kind: 'index', units: ['index'] },
};
// Unit a threshold gets when the caller names none: the account's unit for that quantity.
function defaultUnit(variable, units) {
  const v = VARIABLES[variable];
  return v.units.length === 1 ? v.units[0] : UNIT_NAMES[units][v.kind];
}
// Stored metric value expressed in the threshold's own unit, unrounded.
const inUnit = (variable, metricValue, unit) => convert[VARIABLES[variable].kind](metricValue, unit);
const meets = (op, value, threshold) => (op === 'lte' ? value <= threshold : value >= threshold);

const AQI_BANDS = [[50, 'Good'], [100, 'Moderate'], [150, 'Unhealthy for Sensitive Groups'], [200, 'Unhealthy'], [300, 'Very Unhealthy'], [500, 'Hazardous']];
const aqiCategory = aqi => AQI_BANDS.find(([max]) => aqi <= max)[1];

const SEVERITY = ['minor', 'moderate', 'severe', 'extreme'];
const CATEGORY = ['flood', 'storm', 'winter', 'wind', 'temperature', 'fire', 'air_quality', 'other'];
const severityRank = s => SEVERITY.indexOf(s);

module.exports = { UNIT_NAMES, convert, round, shown, VARIABLES, defaultUnit, inUnit, meets, aqiCategory, SEVERITY, CATEGORY, severityRank };
