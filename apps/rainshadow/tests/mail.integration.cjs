#!/usr/bin/env node
'use strict';
// Rainshadow -> Mail through Messaging on the public reference runtime, with the real Mail
// package as the receiver. It checks the receiver's own record and receipt, a notice that is
// held until Infra moves the clock past its release time (no App event), an identical retry,
// changed content, a forged source, a delivery without a grant, and that dispatch never
// changes Rainshadow's state.
//
//   node tests/mail.integration.cjs --runtime DIR
//
// DIR is the `runtime` directory of a public PALE checkout, 1.6.0 or later;
// PALE_RUNTIME_ROOT=DIR works too. The public Messaging router resolves a publisher package
// and its receiver registry relative to its own checkout, so this flow needs the package
// inside that checkout (for example at apps/rainshadow) and the pinned Mail package there
// (examples/apps/mail with examples/registry.mail.json).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..');
const { publishReleased, pending } = require('../infra/sender.cjs');

function fail(message) { console.error(message + '\nUsage: node tests/mail.integration.cjs --runtime DIR'); process.exit(2); }
const given = process.argv[2] === '--runtime' ? process.argv[3] : process.argv.length > 2 ? null : process.env.PALE_RUNTIME_ROOT;
if (!given) fail('The runtime directory of a public PALE checkout is required.');
const runtime = path.resolve(given), checkout = path.dirname(runtime);
try { if (JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).name !== '@pale/app-runtime') throw Error(); } catch { fail('Not a PALE runtime directory: ' + runtime); }
const MAIL_REGISTRY = 'examples/registry.mail.json';
if (!fs.existsSync(path.join(checkout, MAIL_REGISTRY))) fail('The pinned Mail package was not found in that checkout (' + MAIL_REGISTRY + ').');
// Compare real paths: the package may be reached through a symlink.
const packageRoot = path.relative(fs.realpathSync(checkout), fs.realpathSync(appDir)).split(path.sep).join('/');
if (!packageRoot || packageRoot.startsWith('..') || path.isAbsolute(packageRoot)) fail('The Mail flow needs this package inside that checkout, because Messaging resolves a publisher package relative to its own checkout.');
const { prepare } = require(path.join(runtime, 'prepare.cjs')), { Client } = require(path.join(runtime, 'client.cjs'));

const FRI = '2026-11-20', SAT = '2026-11-21', SUN = '2026-11-22';
const at = (date, hhmm) => date + 'T' + hhmm + ':00-07:00';

async function main() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-rainshadow-mail-')), prepared = prepare(appDir), clients = [], checks = [];
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  const open = async client => { clients.push(client); await client.initialize(); return client; };
  // The Infra messaging config of the run: this package publishes, the bound Mail account is granted.
  const example = JSON.parse(fs.readFileSync(path.join(appDir, 'infra/router.config.example.json'), 'utf8'));
  const writeConfig = (name, grants) => {
    const config = structuredClone(example);
    config.registry = MAIL_REGISTRY; config.publishers[0].package_root = packageRoot;
    if (grants !== undefined) config.publishers[0].allowed_recipients = grants;
    const file = path.join(state, name); fs.writeFileSync(file, JSON.stringify(config)); return file;
  };
  const rainshadow = (role, run) => open(new Client('rainshadow', role, run, state, 'rainshadow-mail-test', { registry: prepared.registry }));
  const router = (run, config) => open(new Client(null, null, null, null, 'rainshadow-mail-test', { commandArgs: [path.join(runtime, 'messaging/service.cjs'), '--config', config, '--publisher', 'rainshadow', '--run', run, '--state-dir', state] }));
  const mailClient = (role, run) => open(new Client('mail', role, run, state, 'mail-' + role, { registry: path.join(checkout, MAIL_REGISTRY) }));
  const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
  const versionOf = s => ({ epoch: s.epoch, revision: s.revision });
  try {
    const infra = await rainshadow('infra', 'flow'), publisher = await router('flow', writeConfig('flow.config.json')), mail = await mailClient('agent', 'flow'), mailInfra = await mailClient('infra', 'flow');
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot;
    // Infra keeps the receiving App at the same time as the sending App before a delivery.
    const syncMail = async (id, to) => mailInfra.call('env.advance_time', { request_id: id, expected_version: versionOf((await mailInfra.call('env.snapshot')).snapshot), virtual_now: to });
    const capabilities = await publisher.call('router.capabilities');
    equal('Messaging reads a send-only declaration from the Rainshadow package', [capabilities.app_messaging.direction, capabilities.channels.map(c => [c.channel, c.schema_id])], ['publish-only', [['channel.email', 'urn:pale:email-message:2']]]);
    const inbox = async query => (await mail.call('mail.search', { query })).messages;
    const start = await snapshot();
    equal('notices that came with the seed are history and are not dispatched', [start.data.notices.length, pending(start).length, (await publishReleased({ source: infra, router: publisher })).results.length, (await inbox('Watch triggered')).length], [8, 0, 0, 0]);

    // A notice that is released as it is written.
    check('a new issuance triggers the saved watch', (await infra.call('env.apply_event', { expected_version: versionOf(start), event: scenario })).status === 'committed');
    const before = await snapshot(), notice = before.data.notices.at(-1);
    equal('the notice carries its wire message, dated at its release time', [notice.id, notice.kind, notice.release_at, notice.wire.time, notice.wire.data.recipient, pending(before).map(n => n.id)], ['ntc-0009', 'watch.triggered', scenario.at, scenario.at, { kind: 'person_ref', id: 'person-maya' }, ['ntc-0009']]);
    check('Infra brings Mail to the same time', (await syncMail('sync-2030', scenario.at)).status === 'committed');
    const sent = {}, first = await publishReleased({ source: infra, router: publisher, sent });
    const receipt = first.results[0].result;
    equal('Messaging commits the delivery to the bound Mail account', [first.stage, first.results.length, receipt.status, receipt.target, receipt.channel, receipt.cloud_event.id, receipt.cloud_event.time], ['delivered', 1, 'committed', { app_id: 'mail', account_id: 'mail-maya' }, 'channel.email', 'ntc-0009', notice.release_at]);
    const received = await mail.call('mail.get', { id: receipt.event_id });
    equal('the Mail Agent reads the notice as a received message', [received.status, received.message.subject, received.message.body], ['ok', notice.title, notice.body]);
    equal('one inbox record', (await inbox('Watch triggered')).length, 1);

    equal('the sender does not publish a notice twice', (await publishReleased({ source: infra, router: publisher, sent })).results.length, 0);
    const retry = await publisher.call('router.publish', { request_id: 'rainshadow:retry:ntc-0009', message: notice.wire });
    equal('an identical retry returns the first receipt and leaves one inbox record', [retry.duplicate, retry.event_id, (await inbox('Watch triggered')).length], [true, receipt.event_id, 1]);
    const changed = structuredClone(notice.wire); changed.data.content.title = 'Changed';
    check('the same notice ID with different content is rejected', (await publisher.call('router.publish', { request_id: 'rainshadow:changed:ntc-0009', message: changed })).code === 'idempotency_conflict');
    const forged = structuredClone(notice.wire); forged.id = 'ntc-forged'; forged.source = 'urn:pale:app:rainshadow:account:someone-else'; forged.data.source_object.account_id = 'someone-else';
    check('a message for another source account is rejected', (await publisher.call('router.publish', { request_id: 'rainshadow:forged', message: forged })).code === 'source_identity_mismatch');
    const after = await snapshot();
    equal('dispatch does not change Rainshadow', [after.data, after.revision], [before.data, before.revision]);

    // A notice written in quiet hours: published only after Infra has moved the clock past
    // its release time. No App event is involved.
    const alert = { event_id: 'ev-al-0030', at: at(FRI, '23:10'), operation: 'rainshadow.alert.issued', payload: { alert_id: 'al-0030', source_id: 'src-pfo', category: 'flood', zone_ids: ['z-wren'], message: { message_id: 'al-0030-m1', type: 'alert', sent_at: at(FRI, '23:10'), event: 'Flood Watch', severity: 'moderate', urgency: 'future', certainty: 'possible', onset: at(SAT, '18:00'), ends: at(SUN, '02:00'), headline: 'Flood Watch from Saturday evening through late Saturday night', description: 'Heavy rain may cause flooding of creeks and low crossings.', instruction: 'Be ready to move to higher ground.' } } };
    check('an alert arrives in quiet hours', (await infra.call('env.apply_event', { expected_version: versionOf(after), event: alert })).status === 'committed');
    const night = await snapshot(), held = night.data.notices.at(-1);
    equal('its notice is held until 07:00 and already carries the wire message for that time', [held.id, held.kind, held.created_at, held.release_at, held.wire.time, pending(night, sent).length], ['ntc-0010', 'alert.issued', at(FRI, '23:10'), at(SAT, '07:00'), at(SAT, '07:00'), 0]);
    await syncMail('sync-2310', at(FRI, '23:10'));
    equal('a held notice is not published', [(await publishReleased({ source: infra, router: publisher, sent })).stage, (await inbox('Flood Watch')).length], ['nothing_pending', 0]);
    const tooEarly = await infra.call('env.advance_time', { request_id: 'night-0659', expected_version: versionOf(night), virtual_now: '2026-11-21T06:59:59-07:00' });
    equal('one second before the release time it is still held', [tooEarly.status, (await publishReleased({ source: infra, router: publisher, sent })).results.length], ['committed', 0]);
    const morning = await infra.call('env.advance_time', { request_id: 'morning-0700', expected_version: tooEarly.version, virtual_now: at(SAT, '07:00') });
    await syncMail('sync-0700', at(SAT, '07:00'));
    check('Infra moves the clock to 07:00 with env.advance_time', morning.status === 'committed' && morning.advanced === true);
    const day = await snapshot();
    equal('the clock move changed no Rainshadow record', day.data, night.data);
    const second = await publishReleased({ source: infra, router: publisher, sent }), receipt2 = second.results[0].result;
    equal('the released notice is published once the clock has passed its release time', [second.stage, second.results.map(r => r.notice_id), receipt2.status, receipt2.cloud_event.id, receipt2.cloud_event.time], ['delivered', ['ntc-0010'], 'committed', 'ntc-0010', at(SAT, '07:00')]);
    const morningMail = await mail.call('mail.get', { id: receipt2.event_id });
    equal('Mail has the alert notice, received at the synchronized time', [morningMail.status, morningMail.message.subject, morningMail.message.received_at, (await inbox('Flood Watch')).length], ['ok', held.title, at(SAT, '07:00'), 1]);
    equal('the sender log holds both deliveries and Rainshadow is unchanged by them', [Object.keys(sent), (await snapshot()).revision], [['ntc-0009', 'ntc-0010'], day.revision]);

    // Without a grant the delivery is rejected before dispatch and Mail has no record.
    const infra2 = await rainshadow('infra', 'denied'), denied = await router('denied', writeConfig('denied.config.json', [])), mail2 = await mailClient('agent', 'denied');
    const s2 = (await infra2.call('env.snapshot')).snapshot;
    await infra2.call('env.apply_event', { expected_version: versionOf(s2), event: scenario });
    const refused = await publishReleased({ source: infra2, router: denied });
    equal('no grant: the delivery is rejected', [refused.stage, refused.results.length, refused.results[0].result.status, refused.results[0].result.code, Object.keys(refused.sent).length], ['router_rejected', 1, 'rejected', 'recipient_not_authorized', 0]);
    equal('no grant: Mail has no record', (await mail2.call('mail.search', { query: 'Watch triggered' })).messages.length, 0);
    check('no grant: the Rainshadow notice is unaffected', (await infra2.call('env.snapshot')).snapshot.data.notices.at(-1).id === 'ntc-0009');

    console.log('PASS: ' + checks.length + ' Rainshadow -> Mail checks through Messaging (real Mail receiver, receipts, a held notice released by the platform clock, retry, rejection, no write-back).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
    fs.rmSync(state, { recursive: true, force: true });
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
