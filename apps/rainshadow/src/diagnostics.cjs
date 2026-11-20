'use strict';
// Optional host hook; diagnostics must not change business results or throw.
function log(ctx, step, details = {}) {
  try { if (typeof ctx?.log === 'function') ctx.log(step, details); } catch {}
}
module.exports = { log };
