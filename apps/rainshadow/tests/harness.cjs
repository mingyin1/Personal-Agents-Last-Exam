'use strict';
// App-only, in-memory test context. It calls the real business functions the way the host
// does (a working copy per call, the seed rules after every change, the event time becomes
// the clock) but it is not a second Core: permissions, versions, idempotency, persistence
// and reset are checked against the real runtime in tests/mcp.integration.cjs.
const fs = require('node:fs'), path = require('node:path');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');

const APP = require('../app.json').app_id;
const readOnly = new Map(tools.map(t => [t.name, t.read_only]));

// The public runtime, when this package sits in the public checkout at apps/<app-id>/.
// A standalone copy (for example the common verifier's temporary copy) has none.
function publicRuntime() {
  const dir = path.resolve(__dirname, '../../../runtime');
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === '@pale/app-runtime' ? dir : null; } catch { return null; }
}
// With the public checkout present, every argument and result is also checked against
// tools.json and every state against the seed schema. Standalone copies skip this.
function loadSchemas() {
  const runtime = publicRuntime();
  if (!runtime) return null;
  const { compile } = require(path.join(runtime, 'contracts/schema-validator.cjs')), root = path.resolve(__dirname, '..');
  return {
    seed: compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas')),
    event: compile(require('../schemas/events.schema.json'), path.join(root, 'schemas')),
    input: new Map(tools.map(t => [t.name, compile(t.inputSchema, root)])),
    output: new Map(tools.map(t => [t.name, compile(t.outputSchema, root)])),
  };
}
const schemas = loadSchemas();
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function fixture({ seed, now, binding, logging = false } = {}) {
  const logs = [];
  let data = structuredClone(seed ?? require('../fixtures/minimal.json'));
  let requests = 0;
  const ctx = {
    app_id: APP, run_id: 'unit', role: 'agent',
    virtual_now: now ?? require('../fixtures/clock.json').initial_time,
    binding: structuredClone(binding ?? require('../fixtures/binding.json')),
  };
  if (logging) ctx.log = (step, details = {}) => logs.push({ step, details: structuredClone(details) });
  const check = candidate => {
    if (schemas && !schemas.seed(candidate)) fail('schema_mismatch', 'State does not match schemas/seed.schema.json');
    plugin.validateSeed(ctx, candidate);
  };
  check(data);
  return {
    ctx, schemas: !!schemas,
    get now() { return ctx.virtual_now; },
    get data() { return structuredClone(data); },
    get logs() { return structuredClone(logs); },
    // Call a tool by its short name, for example call('places.save', { id }).
    call(name, args = {}) {
      const full = APP + '.' + name, write = readOnly.get(full) === false;
      if (!readOnly.has(full)) fail('unknown_tool', full);
      const input = write ? { request_id: 'unit-' + (++requests), ...args } : { ...args };
      if (schemas && !schemas.input.get(full)(write ? { expected_version: { epoch: 1, revision: 0 }, ...input } : input)) fail('invalid_arguments', 'Arguments do not match inputSchema of ' + full);
      const before = JSON.stringify(data);
      const out = plugin.handleTool(ctx, structuredClone(data), full, structuredClone(input));
      if (!write && JSON.stringify(out.data) !== before) fail('invalid_plugin_result', 'Read tool ' + full + ' changed business data');
      check(out.data);
      if (schemas && !schemas.output.get(full)({ ...out.result, status: write ? 'committed' : 'ok', app_id: APP, version: { epoch: 1, revision: 0 } })) fail('schema_mismatch', 'Result of ' + full + ' does not match its outputSchema');
      data = out.data;
      return structuredClone(out.result);
    },
    // Apply an event the way Infra does; its time becomes the App clock.
    event(event) {
      if (schemas && !schemas.event(event)) fail('invalid_arguments', 'Event does not match schemas/events.schema.json');
      if (Date.parse(event.at) < Date.parse(ctx.virtual_now)) fail('invalid_event', 'An event cannot move the App clock backwards');
      const out = plugin.applyEvent({ ...ctx, role: 'infra' }, structuredClone(data), structuredClone(event));
      check(out);
      data = out;
      ctx.virtual_now = event.at;
      return structuredClone(data);
    },
    // Move the clock without other information.
    advance(at, id) { return this.event({ event_id: id ?? 'unit-clock-' + (++requests), at, operation: APP + '.clock.advanced', payload: {} }); },
  };
}

module.exports = { fixture, plugin, publicRuntime };
