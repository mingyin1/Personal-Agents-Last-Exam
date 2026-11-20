#!/usr/bin/env node
'use strict';
// Rainshadow -> Mail through Messaging on the public reference runtime, with real Mail as
// the receiver. Run from the public checkout:  node apps/rainshadow/tests/mail.integration.cjs
// It checks the receiver's own record and receipt, an identical retry, a rejected delivery
// without a grant, and that dispatch never changes Rainshadow's state.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..'), root = path.resolve(appDir, '../..');
if (!require('./harness.cjs').publicRuntime() || !fs.existsSync(path.join(root, 'examples/apps/mail/app.json'))) { console.error('Public PALE runtime with the Mail reference App not found: run this from the public checkout.'); process.exit(2); }
const { prepare } = require(path.join(root, 'runtime/prepare.cjs')), { Client } = require(path.join(root, 'runtime/client.cjs'));
const { publishReleased, pending } = require('../infra/sender.cjs');
const CONFIG = path.join(appDir, 'infra/router.config.example.json'), MAIL_REGISTRY = path.join(root, 'examples/registry.mail.json');

async function main() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-rainshadow-mail-')), prepared = prepare(appDir), clients = [], checks = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  const open = async client => { clients.push(client); await client.initialize(); return client; };
  const rainshadow = (role, run) => open(new Client('rainshadow', role, run, state, 'rainshadow-mail-test', { registry: prepared.registry }));
  const router = (run, config = CONFIG) => open(new Client(null, null, null, null, 'rainshadow-mail-test', { commandArgs: [path.join(root, 'runtime/messaging/service.cjs'), '--config', config, '--publisher', 'rainshadow', '--run', run, '--state-dir', state] }));
  const mailAgent = run => open(new Client('mail', 'agent', run, state, 'mail-reader', { registry: MAIL_REGISTRY }));
  const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
  try {
    const infra = await rainshadow('infra', 'flow'), publisher = await router('flow'), mail = await mailAgent('flow');
    const capabilities = await publisher.call('router.capabilities');
    equal('Messaging reads a send-only declaration from the Rainshadow package', [capabilities.app_messaging.direction, capabilities.channels.map(c => [c.channel, c.schema_id])], ['publish-only', [['channel.email', 'urn:pale:email-message:2']]]);
    const inbox = async () => (await mail.call('mail.search', { query: 'Watch triggered' })).messages;
    const start = (await infra.call('env.snapshot')).snapshot;
    equal('notices that came with the seed are history and are not dispatched', [start.data.notices.length, pending(start).length, (await publishReleased({ source: infra, router: publisher })).results.length, (await inbox()).length], [8, 0, 0, 0]);

    check('a new issuance triggers the saved watch', (await infra.call('env.apply_event', { expected_version: start.version || { epoch: start.epoch, revision: start.revision }, event: scenario })).status === 'committed');
    const before = (await infra.call('env.snapshot')).snapshot, notice = before.data.notices.at(-1);
    equal('the released notice carries its wire message', [notice.id, notice.kind, notice.wire.data.recipient, pending(before).map(n => n.id)], ['ntc-0009', 'watch.triggered', { kind: 'person_ref', id: 'person-maya' }, ['ntc-0009']]);
    const sent = {}, first = await publishReleased({ source: infra, router: publisher, sent });
    const receipt = first.results[0].result;
    equal('Messaging commits the delivery to the bound Mail account', [first.results.length, receipt.status, receipt.target, receipt.channel, receipt.cloud_event.id, receipt.cloud_event.time], [1, 'committed', { app_id: 'mail', account_id: 'mail-maya' }, 'channel.email', 'ntc-0009', notice.released_at]);
    const received = await mail.call('mail.get', { id: receipt.event_id });
    equal('the Mail Agent reads the notice as a received message', [received.status, received.message.subject, received.message.body], ['ok', notice.title, notice.body]);
    equal('one inbox record', (await inbox()).length, 1);

    equal('the sender does not publish a notice twice', (await publishReleased({ source: infra, router: publisher, sent })).results.length, 0);
    const retry = await publisher.call('router.publish', { request_id: 'rainshadow:retry:ntc-0009', message: notice.wire });
    equal('an identical retry returns the first receipt and leaves one inbox record', [retry.duplicate, retry.event_id, (await inbox()).length], [true, receipt.event_id, 1]);
    const changed = structuredClone(notice.wire); changed.data.content.title = 'Changed';
    check('the same notice ID with different content is rejected', (await publisher.call('router.publish', { request_id: 'rainshadow:changed:ntc-0009', message: changed })).code === 'idempotency_conflict');
    const forged = structuredClone(notice.wire); forged.id = 'ntc-forged'; forged.source = 'urn:pale:app:rainshadow:account:someone-else'; forged.data.source_object.account_id = 'someone-else';
    check('a message for another source account is rejected', (await publisher.call('router.publish', { request_id: 'rainshadow:forged', message: forged })).code === 'source_identity_mismatch');
    const after = (await infra.call('env.snapshot')).snapshot;
    equal('dispatch does not change Rainshadow', [after.data, after.revision], [before.data, before.revision]);

    // Without a grant the delivery is rejected before dispatch and Mail has no record.
    const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); config.publishers[0].allowed_recipients = [];
    const deniedConfig = path.join(state, 'denied.config.json'); fs.writeFileSync(deniedConfig, JSON.stringify(config));
    const infra2 = await rainshadow('infra', 'denied'), denied = await router('denied', deniedConfig), mail2 = await mailAgent('denied');
    const s2 = (await infra2.call('env.snapshot')).snapshot;
    await infra2.call('env.apply_event', { expected_version: { epoch: s2.epoch, revision: s2.revision }, event: scenario });
    const refused = await publishReleased({ source: infra2, router: denied });
    equal('no grant: the delivery is rejected', [refused.results.length, refused.results[0].result.status, refused.results[0].result.code, Object.keys(refused.sent).length], [1, 'rejected', 'recipient_not_authorized', 0]);
    equal('no grant: Mail has no record', (await mail2.call('mail.search', { query: 'Watch triggered' })).messages.length, 0);
    check('no grant: the Rainshadow notice is unaffected', (await infra2.call('env.snapshot')).snapshot.data.notices.at(-1).id === 'ntc-0009');

    console.log('PASS: ' + checks.length + ' Rainshadow -> Mail checks through Messaging (real Mail receiver, receipt, retry, rejection, no write-back).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(state, { recursive: true, force: true });
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
