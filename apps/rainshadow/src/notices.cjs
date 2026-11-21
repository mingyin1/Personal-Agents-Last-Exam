'use strict';
// The activity log, the notice log, quiet hours and the Mail wire message.
// A notice is written once, with its release time: the time it was written, or the end of
// the quiet period it was written in. Nothing is rewritten when that time passes; `held`
// and `released` are read from the release time and the supplied clock.
// Rainshadow never delivers anything itself: an Infra-run sender (infra/sender.cjs) reads
// notices from a snapshot and publishes the stored wire messages through Messaging.
const { fail, ms, isoAt, localDate, localMinutes, localToInstant, addDays, nextId } = require('./util.cjs');
const { noticeState } = require('./model.cjs');

// One row for every committed Agent write, every applied event and every effect of an event
// (a notice written, a watch status changed). Time-driven changes run no App code and write
// no row. Returns the row's sequence number.
function record(data, row) {
  const seq = (data.activity.length ? data.activity[data.activity.length - 1].seq : 0) + 1;
  const clean = { seq };
  for (const key of ['at', 'actor', 'action', 'object_id', 'request_id', 'event_id', 'details']) if (row[key] !== undefined) clean[key] = row[key];
  data.activity.push(clean);
  return seq;
}

const minutes = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
function inQuietHours(preferences, t) {
  const q = preferences.quiet_hours;
  if (!q.enabled) return false;
  const now = localMinutes(t, preferences.timezone), start = minutes(q.start), end = minutes(q.end);
  return start < end ? now >= start && now < end : now >= start || now < end;
}
// End of the quiet period that contains instant `t`.
function quietEnd(preferences, t) {
  const tz = preferences.timezone, day = localDate(t, tz), today = localToInstant(day, preferences.quiet_hours.end, tz);
  return today > t ? today : localToInstant(addDays(day, 1), preferences.quiet_hours.end, tz);
}

// Full CloudEvents wire message for Mail's receive declaration (urn:pale:email-message:2).
function wireMessage(data, notice, time) {
  return {
    specversion: '1.0',
    id: notice.id,
    source: 'urn:pale:app:rainshadow:account:' + encodeURIComponent(data.account_id),
    type: 'org.pale.mail.notification.v1',
    time,
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email',
      recipient: { kind: 'person_ref', id: data.owner_person_id },
      source_object: { app_id: 'rainshadow', account_id: data.account_id, object_type: notice.object.type, object_id: notice.object.id },
      content: { title: notice.title, body: { format: 'text/plain', text: notice.body }, asset_ids: [] },
      subscription_ref: data.account_id + ':' + (notice.place_ids[0] || 'account'),
      extensions: [],
    },
  };
}

// Write one notice at event time `at`. Inside quiet hours its release time is the end of
// that quiet period, unless `bypass` is set (notices for extreme alerts); otherwise it is
// released as it is written. When email notices are on at this moment, the full wire
// message is stored with the notice, dated at the release time.
function createNotice(data, at, spec, eventId) {
  const preferences = data.preferences, t = ms(at);
  const held = !spec.bypass && inQuietHours(preferences, t);
  const notice = {
    id: nextId(data.notices.map(n => n.id), 'ntc-'), seq: 0, kind: spec.kind, created_at: at,
    release_at: held ? isoAt(quietEnd(preferences, t), preferences.timezone) : at, object: spec.object,
    ...(spec.message_id ? { message_id: spec.message_id } : {}),
    place_ids: spec.place_ids,
    ...(spec.severity ? { severity: spec.severity } : {}),
    title: spec.title.slice(0, 200), body: spec.body.slice(0, 2000),
    cause: { event_id: eventId },
  };
  if (preferences.email_notices) notice.wire = wireMessage(data, notice, notice.release_at);
  data.notices.push(notice);
  notice.seq = record(data, { at, actor: 'event', action: 'notice.created', object_id: notice.id, event_id: eventId, details: { kind: spec.kind, release_at: notice.release_at } });
  return notice;
}

function presentNotice(notice, now) {
  return {
    id: notice.id, kind: notice.kind, state: noticeState(notice, now), created_at: notice.created_at, release_at: notice.release_at,
    object: notice.object, message_id: notice.message_id ?? null, place_ids: notice.place_ids, severity: notice.severity ?? null,
    title: notice.title, body: notice.body, email_copy: notice.wire !== undefined,
  };
}

// Newest first; notices created at the same instant keep their creation order reversed.
function list(ctx, data, args) {
  const now = ms(ctx.virtual_now);
  if (args.cursor !== undefined && !/^\d{1,6}$/.test(args.cursor)) fail('invalid_arguments', 'cursor must be a next_cursor value from an earlier page.');
  const offset = args.cursor === undefined ? 0 : Number(args.cursor), limit = args.limit ?? 20;
  const all = data.notices.map((n, order) => ({ n, order }))
    .filter(({ n }) => (args.kind === undefined || n.kind === args.kind) && (args.state === undefined || noticeState(n, now) === args.state) && (args.since === undefined || ms(n.created_at) >= ms(args.since)))
    .sort((a, b) => ms(b.n.created_at) - ms(a.n.created_at) || b.order - a.order);
  return { notices: all.slice(offset, offset + limit).map(({ n }) => presentNotice(n, now)), next_cursor: offset + limit < all.length ? String(offset + limit) : null };
}

module.exports = { record, inQuietHours, quietEnd, wireMessage, createNotice, presentNotice, list };
