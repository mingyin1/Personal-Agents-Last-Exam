'use strict';
// App-only, in-memory test context. It needs nothing outside this package. It calls the real
// business functions the way the host does: a working copy per call, the seed rules after
// every change, arguments, results and state checked against tools.json and the schemas, an
// event handled at its own time, and a clock that Infra can move without running App code.
// It is not a second Core: permissions, versions, idempotency, persistence, reset and the
// real env.advance_time are checked against the public runtime in tests/mcp.integration.cjs.
const path = require('node:path');
const { compile } = require('./schema-validator.cjs'); // vendored copy of the public validator
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');

const APP = require('../app.json').app_id;
const root = path.resolve(__dirname, '..'), schemaDir = path.join(root, 'schemas');
const readOnly = new Map(tools.map(t => [t.name, t.read_only]));
const schemas = {
  seed: compile(require('../schemas/seed.schema.json'), schemaDir),
  event: compile(require('../schemas/events.schema.json'), schemaDir),
  input: new Map(tools.map(t => [t.name, compile(t.inputSchema, root)])),
  output: new Map(tools.map(t => [t.name, compile(t.outputSchema, root)])),
};
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function fixture({ seed, now, binding, logging = false } = {}) {
  const logs = [];
  const initial = structuredClone(seed ?? require('../fixtures/minimal.json'));
  let data = structuredClone(initial);
  let requests = 0;
  const ctx = {
    app_id: APP, run_id: 'unit', role: 'agent',
    virtual_now: now ?? require('../fixtures/clock.json').initial_time,
    binding: structuredClone(binding ?? require('../fixtures/binding.json')),
  };
  const loadedAt = ctx.virtual_now;
  if (logging) ctx.log = (step, details = {}) => logs.push({ step, details: structuredClone(details) });
  const check = (candidate, context = ctx) => {
    if (!schemas.seed(candidate)) fail('schema_mismatch', 'State does not match schemas/seed.schema.json');
    plugin.validateSeed(context, candidate);
  };
  check(data);
  return {
    ctx,
    get now() { return ctx.virtual_now; },
    get data() { return structuredClone(data); },
    get logs() { return structuredClone(logs); },
    // Call a tool by its short name, for example call('places.save', { id }).
    call(name, args = {}) {
      const full = APP + '.' + name, write = readOnly.get(full) === false;
      if (!readOnly.has(full)) fail('unknown_tool', full);
      const input = write ? { request_id: 'unit-' + (++requests), ...args } : { ...args };
      if (!schemas.input.get(full)(write ? { expected_version: { epoch: 1, revision: 0 }, ...input } : input)) fail('invalid_arguments', 'Arguments do not match inputSchema of ' + full);
      const before = JSON.stringify(data);
      const out = plugin.handleTool(ctx, structuredClone(data), full, structuredClone(input));
      if (!write && JSON.stringify(out.data) !== before) fail('invalid_plugin_result', 'Read tool ' + full + ' changed business data');
      check(out.data);
      if (!schemas.output.get(full)({ ...out.result, status: write ? 'committed' : 'ok', app_id: APP, version: { epoch: 1, revision: 0 } })) fail('schema_mismatch', 'Result of ' + full + ' does not match its outputSchema');
      data = out.data;
      return structuredClone(out.result);
    },
    // Apply an event the way Infra does with env.apply_event: the handler and the checks
    // after it see the event's own time; a rejected event changes neither data nor clock.
    event(event) {
      if (!schemas.event(event)) fail('invalid_arguments', 'Event does not match schemas/events.schema.json');
      if (Date.parse(event.at) < Date.parse(ctx.virtual_now)) fail('invalid_event', 'An event cannot move the App clock backwards');
      const during = { ...ctx, role: 'infra', virtual_now: event.at };
      const out = plugin.applyEvent(during, structuredClone(data), structuredClone(event));
      check(out, during);
      data = out;
      ctx.virtual_now = event.at;
      return structuredClone(data);
    },
    // Move the clock the way Infra does with Core's env.advance_time: no App code runs and
    // business data stays as it is. An earlier time is refused, as Core refuses it.
    advance(at) {
      if (!(Date.parse(at) >= Date.parse(ctx.virtual_now))) fail('invalid_time', 'The App virtual clock cannot move backwards');
      if (Date.parse(at) > Date.parse(ctx.virtual_now)) ctx.virtual_now = at;
      return ctx.virtual_now;
    },
    // The parts of an Infra snapshot that infra/sender.cjs reads.
    snapshot() {
      return { app_id: APP, epoch: 1, virtual_now: ctx.virtual_now, initial_virtual_now: loadedAt, data: structuredClone(data), initial_data: structuredClone(initial) };
    },
  };
}

module.exports = { fixture, plugin };
