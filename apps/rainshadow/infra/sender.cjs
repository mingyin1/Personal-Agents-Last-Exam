#!/usr/bin/env node
'use strict';
// Infra-run sender for Rainshadow notices. It is not part of the App and is never given
// to the Agent. It reads released notices from an Infra snapshot of Rainshadow and
// publishes their stored wire messages through Messaging (`router.publish`). It never
// writes into Rainshadow or into another App: whether a message reaches Mail is decided
// by Messaging from the run's bindings and grants, and the receipt comes from the receiver.
//
//   node apps/rainshadow/infra/sender.cjs --config ROUTER_CONFIG --run RUN --state-dir DIR
//
// The config is an Infra messaging config (see router.config.example.json) whose publisher
// is this package. Only notices released after the loaded baseline time are sent: notices
// that were already in the seed are history. A notice is published once per sender log
// (<state-dir>/<run>/rainshadow.sender.json); Messaging also deduplicates identical retries.
const fs = require('node:fs'), path = require('node:path');

// Notices to dispatch: built wire message, released after the baseline, not yet in `sent`.
function pending(snapshot, sent = {}) {
  const baseline = Date.parse(snapshot.initial_virtual_now ?? snapshot.virtual_now);
  return snapshot.data.notices.filter(n => n.wire !== undefined && n.released_at !== undefined && Date.parse(n.released_at) > baseline && sent[n.id] === undefined);
}

// `source` is an Infra MCP client of Rainshadow, `router` a publisher client of Messaging.
// Stops at the first result that is not committed, so nothing is skipped silently.
async function publishReleased({ source, router, sent = {} }) {
  const snapshot = (await source.call('env.snapshot')).snapshot, results = [];
  for (const notice of pending(snapshot, sent)) {
    const request_id = 'rainshadow:' + snapshot.epoch + ':' + notice.id;
    const result = await router.call('router.publish', { request_id, message: notice.wire });
    results.push({ notice_id: notice.id, request_id, result });
    if (result.status !== 'committed') break;
    sent[notice.id] = { request_id, event_id: result.event_id, target: result.target, committed_at: result.committed_at };
  }
  return { results, sent };
}

async function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--config', '--run', '--state-dir'].includes(key) || !value) throw Error('Usage: node apps/rainshadow/infra/sender.cjs --config ROUTER_CONFIG --run RUN --state-dir DIR');
    options[key.slice(2)] = value;
  }
  if (!options.config || !options.run || !options['state-dir']) throw Error('--config, --run and --state-dir are required');
  const appDir = path.resolve(__dirname, '..'), runtime = path.resolve(appDir, '../../runtime'), stateDir = path.resolve(options['state-dir']);
  const { Client } = require(path.join(runtime, 'client.cjs')), { prepare } = require(path.join(runtime, 'prepare.cjs'));
  const prepared = prepare(appDir), clients = [];
  const log = path.join(stateDir, options.run, 'rainshadow.sender.json');
  try {
    const source = new Client('rainshadow', 'infra', options.run, stateDir, 'rainshadow-sender', { registry: prepared.registry });
    clients.push(source); await source.initialize();
    const router = new Client(null, null, null, null, 'rainshadow-sender', { commandArgs: [path.join(runtime, 'messaging/service.cjs'), '--config', path.resolve(options.config), '--publisher', 'rainshadow', '--run', options.run, '--state-dir', stateDir] });
    clients.push(router); await router.initialize();
    const sent = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : {};
    const out = await publishReleased({ source, router, sent });
    fs.writeFileSync(log, JSON.stringify(out.sent, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ published: out.results.filter(r => r.result.status === 'committed').length, results: out.results }, null, 2));
    if (out.results.some(r => r.result.status !== 'committed')) process.exitCode = 1;
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

module.exports = { pending, publishReleased };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
