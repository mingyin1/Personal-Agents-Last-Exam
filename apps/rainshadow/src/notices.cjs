'use strict';
// The activity log, the notice log, quiet hours and the Mail wire message.
// Rainshadow never delivers anything itself: an Infra-run sender reads released
// notices from a snapshot and publishes their wire messages through Messaging.
const { fail, ms, isoAt, localDate, localMinutes, localToInstant, addDays, nextId } = require('./util.cjs');
const { noticeState } = require('./model.cjs');

// One row for every committed write, event and timer effect. Returns the row's sequence number.
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

// Write one notice at event time `at`. Inside quiet hours it is held until they end,
// unless `bypass` is set (notices for extreme alerts).
function createNotice(data, at, spec, eventId) {
  const preferences = data.preferences, t = ms(at);
  const notice = {
    id: nextId(data.notices.map(n => n.id), 'ntc-'), seq: 0, kind: spec.kind, created_at: at, object: spec.object,
    ...(spec.message_id ? { message_id: spec.message_id } : {}),
    place_ids: spec.place_ids,
    ...(spec.severity ? { severity: spec.severity } : {}),
    title: spec.title.slice(0, 200), body: spec.body.slice(0, 2000),
  };
  const held = !spec.bypass && inQuietHours(preferences, t);
  if (held) notice.release_at = isoAt(quietEnd(preferences, t), preferences.timezone);
  else notice.released_at = at;
  notice.cause = { event_id: eventId };
  if (!held && preferences.email_notices) notice.wire = wireMessage(data, notice, at);
  data.notices.push(notice);
  notice.seq = record(data, { at, actor: 'event', action: 'notice.created', object_id: notice.id, event_id: eventId, details: { kind: spec.kind, state: held ? 'held' : 'released' } });
  return notice;
}

// Timer effect: a held notice whose quiet period is over is released at its release time.
function releaseNotice(data, notice, eventId) {
  notice.released_at = notice.release_at;
  if (data.preferences.email_notices) notice.wire = wireMessage(data, notice, notice.release_at);
  record(data, { at: notice.release_at, actor: 'timer', action: 'notice.released', object_id: notice.id, event_id: eventId });
}

function presentNotice(notice, now) {
  return {
    id: notice.id, kind: notice.kind, state: noticeState(notice, now), created_at: notice.created_at,
    release_at: notice.release_at ?? null, released_at: notice.released_at ?? (notice.release_at && ms(notice.release_at) <= now ? notice.release_at : notice.release_at ? null : notice.created_at),
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

module.exports = { record, inQuietHours, quietEnd, wireMessage, createNotice, releaseNotice, presentNotice, list };
